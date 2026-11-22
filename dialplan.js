/*
 * Dialplan generation engine.
 *
 * Pure client-side JavaScript. The same file runs in the browser (as
 * window.Dialplan) and in Node (as a CommonJS module) so the production
 * call-connection rules can be verified without a server.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Dialplan = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Constants                                                          */
  /* ------------------------------------------------------------------ */

  var TRUNKS = {
    airtel: {
      id: 'airtel',
      label: 'Bangalore Airtel',
      channel: 'SIP/airteltrunk',
      trunk: 'airteltrunk',
      header: '',
      tata: false,
      note: 'Airtel IMS trunk. No P-Preferred-Identity header is added.'
    },
    tata: {
      id: 'tata',
      label: 'Bangalore TATA',
      channel: 'SIP/tata',
      trunk: 'tata',
      header: '<sip:67519000@10.0.78.9>',
      tata: true,
      note: 'TATA trunk. The production P-Preferred-Identity header is added in both contexts.'
    }
  };

  var STICKY_MODES = {
    none: 'No Sticky (Pure Round Robin)',
    outbound: 'Outbound Sticky (ODBC_TDUCESTICKYAPILASTCALL)',
    inbound: 'Inbound Sticky (ODBC_INBARERA)'
  };

  var AUDIO_MODES = {
    none: 'No Audio / Direct Queue',
    welcome: 'Welcome Audio Only (Playback)',
    ivr: 'With IVR Menu (Read DTMF + Options)'
  };

  var TATA_PREFERRED_IDENTITY = '<sip:67519000@10.0.78.9>';
  var STICKY_RING_SECONDS = 30;
  var QUEUE_AGENT_TIMEOUT = 30;
  var MIN_QUEUE_TIMEOUT = 5;
  var MAX_QUEUE_TIMEOUT = 600;
  var MIN_RING_TIME = 1;
  var MAX_RING_TIME = 300;

  var CUSTOMER_RE = /^[a-z0-9][a-z0-9_-]{1,30}$/;
  var GROUP_RE = /^[A-Za-z0-9_-]{2,48}$/;
  var AUDIO_RE = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;
  var DECIMAL_RE = /^(\d+)\.0+$/;

  /* ------------------------------------------------------------------ */
  /* Normalisation                                                      */
  /* ------------------------------------------------------------------ */

  function toText(value) {
    return value == null ? '' : String(value);
  }

  function digits(value) {
    return toText(value).replace(/[^0-9]/g, '');
  }

  /** Return a bare 10-digit Indian mobile number, or null. */
  function normalizeMobile(value) {
    var text = toText(value).trim().replace(/^['"]+|['"]+$/g, '');
    if (!text || /^(none|nan|null)$/i.test(text)) return null;

    var decimal = DECIMAL_RE.exec(text);
    if (decimal) text = decimal[1];

    var number = digits(text);
    if (!number) return null;

    if (number.indexOf('00') === 0) number = number.slice(2);
    number = number.replace(/^0+/, '');

    if (number.indexOf('91') === 0 && number.length === 12) number = number.slice(2);
    if (number.length > 10) number = number.slice(-10);

    return number.length === 10 ? number : null;
  }

  function normalizeDisplayNumber(value) {
    var text = toText(value).trim();
    if (!text) return '';
    var plus = text.charAt(0) === '+';
    var number = digits(text);
    if (!number) return '';
    return (plus ? '+' : '') + number;
  }

  function normalizeDid(value) {
    var number = digits(value);
    if (!number) return null;

    if (number.length === 14 && number.indexOf('009180') === 0) number = number.slice(6);
    else if (number.length === 12 && number.indexOf('9180') === 0) number = number.slice(4);
    else if (number.length === 11 && number.indexOf('080') === 0) number = number.slice(3);
    else if (number.length === 10 && number.indexOf('80') === 0) number = number.slice(2);
    else if (number.length === 10 && number.indexOf('91') === 0) number = number.slice(2);
    else if (number.length === 9 && number.charAt(0) === '0') number = number.slice(1);

    return number.length === 8 ? number : null;
  }

  function normalizeCustomer(value) {
    return toText(value).trim().toLowerCase().replace(/\s+/g, '');
  }

  function sanitizeAudio(value) {
    var name = toText(value).trim().replace(/^.*[\\/]/, '');
    name = name.replace(/\.(gsm|wav|mp3|m4a|ogg|aac)$/i, '');
    return name.replace(/[^A-Za-z0-9._-]/g, '').replace(/\.\.+/g, '.');
  }

  function normalizeAudio(value) {
    return sanitizeAudio(value);
  }

  function normalizeAgents(values) {
    var list = Array.isArray(values) ? values : [];
    var agents = [];
    var invalid = [];
    var seen = {};

    list.forEach(function (raw, index) {
      if (toText(raw).trim() === '') return;
      var number = normalizeMobile(raw);
      if (!number) {
        invalid.push({ index: index, value: toText(raw) });
        return;
      }
      if (seen[number]) return;
      seen[number] = true;
      agents.push(number);
    });

    return { agents: agents, invalid: invalid };
  }

  function normalizeIvrOptions(rows) {
    var options = [];
    var errors = [];
    var seen = {};

    (Array.isArray(rows) ? rows : []).forEach(function (row, index) {
      var item = row && typeof row === 'object' ? row : {};
      var digit = digits(item.digit).slice(0, 1);
      var type = item.type === 'number' ? 'number' : 'queue';
      var number = type === 'number' ? normalizeMobile(item.number) : '';

      if (!digit) return;

      if (digit < '1' || digit > '5') {
        errors.push('IVR row ' + (index + 1) + ': DTMF option must be a digit from 1 to 5.');
        return;
      }
      if (seen[digit]) {
        errors.push('IVR row ' + (index + 1) + ': DTMF option ' + digit + ' is used more than once.');
        return;
      }
      if (type === 'number' && !number) {
        errors.push('IVR row ' + (index + 1) + ': enter a valid 10-digit mobile number for the direct-dial option.');
        return;
      }

      seen[digit] = true;
      options.push({ digit: digit, type: type, number: number });
    });

    return { options: options, errors: errors };
  }

  function normalizeConfig(input) {
    var src = input && typeof input === 'object' ? input : {};
    var rrSrc = src.rr && typeof src.rr === 'object' ? src.rr : {};
    var trunkKey = TRUNKS[src.trunkKey] ? src.trunkKey : 'airtel';
    var trunk = TRUNKS[trunkKey];
    var did = normalizeDid(src.did);
    var agents = normalizeAgents(src.agents);
    var ivr = normalizeIvrOptions(rrSrc.ivrOptions);
    var sticky = STICKY_MODES[rrSrc.sticky] ? rrSrc.sticky : 'none';
    var audioMode = AUDIO_MODES[rrSrc.audioMode] ? rrSrc.audioMode : 'none';

    return {
      customer: normalizeCustomer(src.customer),
      did: did,
      didRaw: toText(src.did),
      trunkKey: trunkKey,
      trunk: trunk,
      action: src.action === 'tone' ? 'tone' : 'connect',
      // "Play tone" is now a pre-routing audio step, not a hangup-only action.
      playTone: src.action === 'tone' || src.playTone === true,
      forward: src.forward === 'groups' || src.forward === 'roundrobin' ? src.forward : 'contacts',
      groupName: toText(src.groupName).trim(),
      displayNumber: normalizeDisplayNumber(src.displayNumber),
      callerId: normalizeDisplayNumber(src.displayNumber) || did || '',
      welcomeAudio: normalizeAudio(src.welcomeAudio),
      ringTimeRaw: toText(src.ringTime),
      ringTime: parseInt(toText(src.ringTime), 10),
      timeMode: src.timeMode === 'specific' ? 'specific' : 'always',
      days: Array.isArray(src.days) ? src.days.slice() : [],
      from: toText(src.from),
      to: toText(src.to),
      offHoursAudio: normalizeAudio(src.offHoursAudio),
      agents: agents.agents,
      invalidAgents: agents.invalid,
      rr: {
        sticky: sticky,
        stickyLabel: STICKY_MODES[sticky],
        audioMode: audioMode,
        audioLabel: AUDIO_MODES[audioMode],
        audioFile: normalizeAudio(rrSrc.audioFile),
        queueTimeoutRaw: toText(rrSrc.queueTimeout),
        queueTimeout: parseInt(toText(rrSrc.queueTimeout), 10),
        ivrOptions: ivr.options,
        ivrErrors: ivr.errors
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Validation                                                         */
  /* ------------------------------------------------------------------ */

  function validateConfig(config) {
    var errors = [];
    var warnings = [];

    function error(field, message) {
      errors.push({ field: field, message: message });
    }

    function warn(field, message) {
      warnings.push({ field: field, message: message });
    }

    if (!config.customer) {
      error('customer', 'Customer Context Name is required.');
    } else if (!CUSTOMER_RE.test(config.customer)) {
      error('customer', 'Customer Context Name must be 2-31 characters using lowercase letters, numbers, underscores or hyphens.');
    }

    if (!config.did) {
      error('did', 'DID / Virtual Number must be exactly 8 digits (for example 45549493).');
    }

    if (config.displayNumber && !/^\+?[0-9]{6,15}$/.test(config.displayNumber)) {
      error('displayNumber', 'Display CallerID must contain 6-15 digits, optionally starting with +.');
    }

    // Welcome / hold audio is always optional. Blank or unusual input is simply
    // sanitised by normalizeAudio() and omitted from the generated dialplan.

    if (config.timeMode === 'specific') {
      if (!config.days.length) {
        error('days', 'Select at least one call-connect day.');
      }
      if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(config.from) ||
          !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(config.to)) {
        error('time', 'Call connect start and end times must be valid HH:MM values.');
      } else if (config.from >= config.to) {
        error('time', 'Call connect start time must be earlier than the end time.');
      }
      if (config.offHoursAudio && (!AUDIO_RE.test(config.offHoursAudio) || config.offHoursAudio.indexOf('..') !== -1)) {
        error('offHoursAudio', 'Off-hours fallback audio must be a filename without a path or extension.');
      }
    }

    // With Play Tone selected, an empty agent list is valid: the audio plays and
    // the call ends. As soon as any agent row is present, normal routing rules
    // apply so the call can continue after the audio.
    var hasAgentRows = config.agents.length > 0 || config.invalidAgents.length > 0;
    var requireAgents = config.action !== 'tone' || hasAgentRows;

    if (config.forward === 'groups' && requireAgents) {
      if (!config.groupName) {
        error('groupName', 'Group Name is required when Forward To is Groups.');
      } else if (!GROUP_RE.test(config.groupName)) {
        error('groupName', 'Group Name must be 2-48 characters using letters, numbers, underscores or hyphens.');
      }
    }

    if (!config.agents.length && requireAgents) {
      error('agents', 'Add at least one valid 10-digit agent mobile number.');
    }
    config.invalidAgents.forEach(function (item) {
      error('agents', 'Agent row ' + (item.index + 1) + ' ("' + item.value + '") is not a valid 10-digit mobile number.');
    });

    if (config.agents.some(function (number) { return '6789'.indexOf(number.charAt(0)) === -1; })) {
      warn('agents', 'Some agent numbers do not start with 6-9. Confirm them before loading the queue.');
    }

    if (requireAgents) {
      if (config.forward === 'roundrobin') {
        validateRoundRobin(config, error, warn);
      } else if (!Number.isInteger(config.ringTime) || config.ringTime < MIN_RING_TIME || config.ringTime > MAX_RING_TIME) {
        error('ringTime', 'Ring Time must be a whole number from 1 to 300 seconds.');
      }
    }

    return { errors: errors, warnings: warnings };
  }

  function validateRoundRobin(config, error, warn) {
    var rr = config.rr;

    if (!Number.isInteger(rr.queueTimeout) || rr.queueTimeout < MIN_QUEUE_TIMEOUT || rr.queueTimeout > MAX_QUEUE_TIMEOUT) {
      error('queueTimeout', 'Queue Timeout must be a whole number from 5 to 600 seconds.');
    }

    // Audio files are optional. If the prompt is blank, Playback()/Read() and
    // the DTMF checks are omitted instead of raising a validation error.
    if (rr.audioMode === 'ivr' && rr.audioFile) {
      rr.ivrErrors.forEach(function (message) {
        error('ivrOptions', message);
      });
      if (!rr.ivrOptions.length && !rr.ivrErrors.length) {
        error('ivrOptions', 'Add at least one IVR DTMF option (1-5).');
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Formatting helpers                                                 */
  /* ------------------------------------------------------------------ */

  function pad(value) {
    return (value < 10 ? '0' : '') + value;
  }

  function breakLine() {
    return '';
  }

  function rule(label) {
    var bar = new Array(77).join('=');
    return '; ' + bar + '\n; ' + label + '\n; ' + bar;
  }

  function join(lines) {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n') + '\n';
  }

  function exten(app, label) {
    return 'exten => _X.,n' + (label ? '(' + label + ')' : '') + ',' + app;
  }

  function formatDaySpec(days) {
    var order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    var selected = order.filter(function (day) { return days.indexOf(day) !== -1; });
    if (!selected.length || selected.length === 7) return '*';

    var groups = [];
    var start = selected[0];
    var previous = selected[0];
    for (var i = 1; i < selected.length; i += 1) {
      var day = selected[i];
      if (order.indexOf(day) === order.indexOf(previous) + 1) {
        previous = day;
      } else {
        groups.push([start, previous]);
        start = day;
        previous = day;
      }
    }
    groups.push([start, previous]);
    return groups.map(function (group) {
      return group[0] === group[1] ? group[0] : group[0] + '-' + group[1];
    }).join(',');
  }

  function timeSpec(config) {
    return config.from + '-' + config.to + ',' + formatDaySpec(config.days) + ',*,*';
  }

  function queueName(customer) {
    return customer + 'roundrobin';
  }

  function dialContext(customer) {
    return customer + 'roundrobin-dial';
  }

  function ivrVariable(customer) {
    return customer.replace(/[^a-z0-9]/g, '') + 'digito';
  }

  function trunkHeaderLines(trunk) {
    return trunk.tata
      ? ['exten => _X.,n,SipAddHeader(P-Preferred-Identity: ' + TATA_PREFERRED_IDENTITY + ')']
      : [];
  }

  function preamble(config) {
    var callerId = config.forward === 'roundrobin'
      ? (config.did || '')
      : (config.displayNumber || config.did || '');

    var lines = [
      'exten => _X.,1,SET(TELEDUCE_CREDITS=${ODBC_CREDITS(${EXTEN})})',
      'exten => _X.,n,GotoIf($[${TELEDUCE_CREDITS} < 1]?endcall)',
      'exten => _X.,n,Answer()',
      'exten => _X.,n,Set(fname=${FILTER(0123456789,${UNIQUEID})})',
      'exten => _X.,n,MixMonitor(/var/spool/asterisk/monitor/${fname}.wav)',
      'exten => _X.,n,Log(NOTICE, ${CALLERID(all)})',
      'exten => _X.,n,SET(INCOMNUM=${CALLERID(num)})',
      'exten => _X.,n,SET(CALLERID(num)=' + callerId + ')'
    ];

    // Caller ID and the TATA header run before every sticky/IVR GotoIf so both
    // the newcall and oldcall branches inherit them.
    return lines.concat(trunkHeaderLines(config.trunk));
  }

  function ivrReadLines(config) {
    var rr = config.rr;
    if (rr.audioMode === 'welcome' && rr.audioFile) {
      // Play Tone already plays the Section 01 welcome/hold audio before the
      // IVR block, so do not emit a duplicate Playback() here.
      if (config.playTone && config.welcomeAudio) return [];
      return [exten('Playback(' + rr.audioFile + ')')];
    }
    if (rr.audioMode !== 'ivr' || !rr.audioFile) return [];

    var variable = ivrVariable(config.customer);
    var lines = [exten('Read(' + variable + ',' + rr.audioFile + ',1,2)')];
    rr.ivrOptions.forEach(function (option) {
      lines.push(exten('GotoIf($[${' + variable + '} = ' + option.digit + ']?ivr' + option.digit + ')'));
    });
    return lines;
  }

  function queueCallLines(config) {
    var queue = queueName(config.customer);
    return [
      exten('Queue(' + queue + ',Tt,,,' + config.rr.queueTimeout + ')'),
      exten('Verbose(${QUEUESTATUS})'),
      exten('GotoIf($["${QUEUESTATUS}"="JOINEMPTY"]?endcall:endcall)')
    ];
  }

  function stickyLines(config) {
    var outbound = config.rr.sticky === 'outbound';
    var direction = outbound ? 'Outbound' : 'Inbound';
    var fn = outbound ? 'ODBC_TDUCESTICKYAPILASTCALL' : 'ODBC_INBARERA';
    var queue = queueName(config.customer);
    var channel = config.trunk.channel;

    return [
      '',
      '; --- ' + direction + ' Sticky Check (Last ' + direction + ' Agent) ---',
      exten('SET(DIAL_NUMBER=${' + fn + '(${INCOMNUM:-10},+9180${EXTEN})})'),
      exten('Verbose(2, [DEBUG] Last ' + direction + ' Sticky Agent = ${DIAL_NUMBER})'),
      exten('GotoIf($[${LEN(${DIAL_NUMBER})} == 0]?newcall:oldcall)'),
      '',
      '; --- if No ' + direction + ' Sticky Match -> ' + queue + ' ---',
      exten('Queue(' + queue + ',Tt,,,' + config.rr.queueTimeout + ')', 'newcall'),
      exten('Verbose(${QUEUESTATUS})'),
      exten('GotoIf($["${QUEUESTATUS}"="JOINEMPTY"]?endcall:endcall)'),
      '',
      '; --- if ' + direction + ' Sticky Match Found ---',
      exten('Dial(' + channel + '/0${DIAL_NUMBER:-10},' + STICKY_RING_SECONDS + ',m)', 'oldcall'),
      exten('GotoIf($[ ${DIALSTATUS} != "ANSWER"]?endcall:endcall)')
    ];
  }

  function ivrBranchLines(config) {
    if (config.rr.audioMode !== 'ivr' || !config.rr.audioFile) return [];

    var channel = config.trunk.channel;
    var lines = ['', '; --- IVR DTMF options (direct dials use 0 + 10-digit mobile) ---'];
    config.rr.ivrOptions.forEach(function (option) {
      if (option.type === 'queue') {
        lines.push(exten('Queue(' + queueName(config.customer) + ',Tt,,,' + config.rr.queueTimeout + ')', 'ivr' + option.digit));
        lines.push(exten('Verbose(${QUEUESTATUS})'));
        lines.push(exten('GotoIf($["${QUEUESTATUS}"="JOINEMPTY"]?endcall:endcall)'));
      } else {
        lines.push(exten('Dial(' + channel + '/0' + option.number + ',' + STICKY_RING_SECONDS + ',m)', 'ivr' + option.digit));
        lines.push(exten('GotoIf($[ ${DIALSTATUS} != "ANSWER"]?endcall:endcall)'));
      }
    });
    return lines;
  }

  /* ------------------------------------------------------------------ */
  /* Builders                                                           */
  /* ------------------------------------------------------------------ */

  function buildFromTrunk(config) {
    return join([
      rule('[from-trunk] - DID routing entries'),
      '; Customer : ' + config.customer,
      '; DID      : ' + config.did,
      '',
      '; 1) Add under the Airtel / TATA DID check section',
      'exten => _[+0-9]X.,n,GotoIf($[${pseudodid} = ' + config.did + ']?' + config.customer + ')',
      '',
      '; 2) Add under the Goto jump section',
      'exten => _[+0-9]X.,n(' + config.customer + '),Goto(inb' + config.customer + ',${pseudodid},1)'
    ]);
  }

  function buildRoundRobinExtensions(config) {
    var queue = queueName(config.customer);
    var context = dialContext(config.customer);

    var lines = [
      rule('[inb' + config.customer + '] - inbound context'),
      '; Trunk   : ' + config.trunk.label + ' (' + config.trunk.channel + ')',
      '; Routing : ' + config.rr.stickyLabel,
      '; Audio   : ' + config.rr.audioLabel,
      '; Queue   : ' + queue,
      '',
      '[inb' + config.customer + ']'
    ];

    // Caller ID and the TATA header must be in place before the IVR read and
    // before the sticky GotoIf. Play Tone inserts the optional welcome/hold
    // audio here so it is heard before any queue or IVR routing.
    lines = lines.concat(preamble(config));
    if (config.playTone && config.welcomeAudio) {
      lines.push(exten('Playback(' + config.welcomeAudio + ')'));
    }

    if (!config.agents.length && config.playTone) {
      // Audio-only call: no members to queue, so end immediately after playback.
      lines.push('');
      lines.push('; No agents configured - audio played, end the call');
      lines.push(exten('Hangup()', 'endcall'));
    } else {
      lines = lines.concat(ivrReadLines(config));

      if (config.rr.sticky === 'none') {
        lines = lines.concat(queueCallLines(config));
      } else {
        lines = lines.concat(stickyLines(config));
      }

      lines = lines.concat(ivrBranchLines(config));
      lines.push('');
      lines.push(exten('Hangup()', 'endcall'));
    }
    lines.push('');
    lines.push(rule('[' + context + '] - queue member dial context'));
    lines.push('; Queue members are dialled as Local/0<mobile>@' + context + '/n');
    lines.push('');
    lines.push('[' + context + ']');
    lines.push('exten => _X.,1,SET(CALLERID(num)=' + config.did + ')');
    lines.push('exten => _X.,n,Set(fname=${FILTER(0123456789,${UNIQUEID})})');
    lines.push('exten => _X.,n,MixMonitor(/var/spool/asterisk/monitor/${fname}.wav)');
    lines = lines.concat(trunkHeaderLines(config.trunk));
    lines.push('exten => _X.,n,Dial(' + config.trunk.channel + '/${EXTEN},,Tt)');
    lines.push('exten => _X.,n,Hangup()');

    return join(lines);
  }

  function buildQueue(config) {
    var queue = queueName(config.customer);
    return join([
      rule('queues.conf - ' + queue),
      '[' + queue + ']',
      'announce-frequency=0',
      'announce-holdtime=no',
      'announce-position=no',
      'autofill=yes',
      'autopause=no',
      'autopausebusy=no',
      'autopausedelay=0',
      'autopauseunavail=no',
      ';eventmemberstatus=yes',
      ';eventwhencalled=yes',
      'joinempty=paused,invalid,inuse,unavailable',
      'leavewhenempty=no',
      'maxlen=0',
      'memberdelay=0',
      'penaltymemberslimit=0',
      'periodic-announce=busy',
      'periodic-announce-frequency=10',
      'queue-callswaiting=silence/1',
      'queue-thereare=silence/1',
      'queue-youarenext=silence/1',
      'reportholdtime=no',
      'ringinuse=no',
      'strategy=rrmemory',
      'timeout = ' + QUEUE_AGENT_TIMEOUT,
      'timeoutpriority = conf'
    ]);
  }

  function buildCli(config) {
    var queue = queueName(config.customer);
    var context = dialContext(config.customer);

    var lines = [
      rule('Asterisk CLI - reload and attach agents to ' + queue),
      'asterisk -rx "dialplan reload"',
      'asterisk -rx "queue reload all"',
      '',
      '; Attach each agent to ' + queue
    ];

    config.agents.forEach(function (agent) {
      lines.push('queue add member Local/0' + agent + '@' + context + '/n to ' + queue);
    });

    lines.push('');
    lines.push('asterisk -rx "queue show ' + queue + '"');
    return join(lines);
  }

  function buildContactsExtensions(config) {
    var lines = [
      rule('[inb' + config.customer + '] - inbound context'),
      '; Trunk   : ' + config.trunk.label + ' (' + config.trunk.channel + ')',
      '; Forward : ' + (config.playTone
        ? (config.agents.length ? 'Play tone then sequential contacts' : 'Play tone and hang up')
        : 'Sequential contacts'),
      '; Window  : ' + (config.timeMode === 'specific' ? timeSpec(config) : '24/7'),
      '; Ring    : ' + config.ringTime + ' seconds',
      '',
      '[inb' + config.customer + ']'
    ];

    lines = lines.concat(preamble(config));

    if (config.timeMode === 'specific') {
      lines.push('');
      lines.push('; Call window: ' + timeSpec(config));
      lines.push(exten('GotoIfTime(' + timeSpec(config) + '?officehours:offhours)'));
      lines.push('');
      lines.push('; Off-hours fallback');
      lines.push(exten('NoOp(Off hours)', 'offhours'));
      if (config.offHoursAudio) {
        lines.push(exten('Playback(' + config.offHoursAudio + ')'));
      }
      lines.push(exten('Hangup()'));
      lines.push('');
      lines.push('; Office hours');
      lines.push(exten('NoOp(Office hours)', 'officehours'));
    } else {
      lines.push('');
      lines.push('; 24/7 routing');
    }

    if (config.welcomeAudio) {
      lines.push(exten('Playback(' + config.welcomeAudio + ')'));
    }

    if (config.agents.length) {
      lines.push('');
      lines.push('; Sequential contacts (11-digit: 0 + 10-digit mobile)');
      config.agents.forEach(function (agent) {
        lines.push(exten('Dial(' + config.trunk.channel + '/0' + agent + ',' + config.ringTime + ',m)'));
      });
      lines.push(exten('Hangup()'));
    } else {
      lines.push('');
      lines.push('; No agents configured - audio played, end the call');
      lines.push(exten('Hangup()'));
    }

    lines.push('');
    lines.push('; Credit failure / end of call');
    lines.push(exten('Hangup()', 'endcall'));
    return join(lines);
  }

  function buildGroupsExtensions(config) {
    var lines = [
      rule('[inb' + config.customer + '] - inbound context'),
      '; Trunk   : ' + config.trunk.label + ' (' + config.trunk.channel + ')',
      '; Forward : ' + (config.playTone
        ? (config.agents.length ? 'Play tone then ring all agents (DIALGROUP)' : 'Play tone and hang up')
        : 'Ring all agents simultaneously (DIALGROUP)'),
      '; Window  : ' + (config.timeMode === 'specific' ? timeSpec(config) : '24/7'),
      '; Ring    : ' + config.ringTime + ' seconds',
      '',
      '[inb' + config.customer + ']'
    ];

    lines = lines.concat(preamble(config));

    if (config.timeMode === 'specific') {
      lines.push('');
      lines.push('; Call window: ' + timeSpec(config));
      lines.push(exten('GotoIfTime(' + timeSpec(config) + '?officehours:offhours)'));
      lines.push('');
      lines.push('; Off-hours fallback');
      lines.push(exten('NoOp(Off hours)', 'offhours'));
      if (config.offHoursAudio) {
        lines.push(exten('Playback(' + config.offHoursAudio + ')'));
      }
      lines.push(exten('Hangup()'));
      lines.push('');
      lines.push('; Office hours');
      lines.push(exten('NoOp(Office hours)', 'officehours'));
    } else {
      lines.push('');
      lines.push('; 24/7 routing');
    }

    if (config.welcomeAudio) {
      lines.push(exten('Playback(' + config.welcomeAudio + ')'));
    }

    if (config.agents.length) {
      lines.push('');
      lines.push('; Ring all agents simultaneously');
      config.agents.forEach(function (agent) {
        lines.push(exten('SET(DIALGROUP(' + config.groupName + ',add)=' + config.trunk.channel + '/0' + agent + ')'));
      });
      lines.push(exten('Dial(${DIALGROUP(' + config.groupName + ')},' + config.ringTime + ',m)'));
      lines.push(exten('Hangup()'));
    } else {
      lines.push('');
      lines.push('; No agents configured - audio played, end the call');
      lines.push(exten('Hangup()'));
    }
    lines.push('');
    lines.push('; Credit failure / end of call');
    lines.push(exten('Hangup()', 'endcall'));
    return join(lines);
  }

  /* ------------------------------------------------------------------ */
  /* Public entry point                                                 */
  /* ------------------------------------------------------------------ */

  function routingLabel(config) {
    var base;
    if (config.forward === 'roundrobin') base = config.rr.stickyLabel;
    else if (config.forward === 'groups') base = 'Groups (DIALGROUP)';
    else base = 'Contacts (sequential)';

    if (!config.playTone) return base;
    return config.agents.length ? 'Play tone then ' + base : 'Play tone and hang up';
  }

  function generate(input) {
    var config = normalizeConfig(input);
    var validation = validateConfig(config);

    if (validation.errors.length) {
      return {
        config: config,
        errors: validation.errors,
        warnings: validation.warnings,
        blocks: [],
        meta: {
          routingLabel: routingLabel(config),
          generatedAt: new Date().toISOString()
        }
      };
    }

    // Play Tone with no agents is an audio-only call: one small context that
    // plays the prompt and hangs up. With agents present, forwarding is routed
    // normally after the audio, whichever forwarding mode is selected.
    var shouldRoute = !config.playTone || config.agents.length > 0;

    var blocks;
    if (shouldRoute && config.forward === 'roundrobin') {
      blocks = [
        {
          id: 'fromTrunk',
          step: '01',
          title: '[from-trunk] Lines',
          file: 'extensions.conf',
          subtitle: 'DID match and Goto jump for the incoming context.',
          code: buildFromTrunk(config)
        },
        {
          id: 'extensions',
          step: '02',
          title: 'extensions.conf Contexts',
          file: 'extensions.conf',
          subtitle: '[inb' + config.customer + '] and [' + dialContext(config.customer) + '].',
          code: buildRoundRobinExtensions(config)
        },
        {
          id: 'queues',
          step: '03',
          title: 'queues.conf Queue',
          file: 'queues.conf',
          subtitle: 'Production rrmemory queue with no static members.',
          code: buildQueue(config)
        },
        {
          id: 'cli',
          step: '04',
          title: 'Asterisk CLI Commands',
          file: 'Asterisk CLI',
          subtitle: 'Reload the dialplan and queue, then attach every agent.',
          code: buildCli(config)
        }
      ];
    } else if (shouldRoute && config.forward === 'groups') {
      blocks = [{
        id: 'extensions',
        step: '01',
        title: 'extensions.conf Context',
        file: 'extensions.conf',
        subtitle: config.playTone
          ? '[inb' + config.customer + '] plays the welcome audio, then rings all agents (DIALGROUP).'
          : '[inb' + config.customer + '] with a simultaneous DIALGROUP.',
        code: buildGroupsExtensions(config)
      }];
    } else {
      blocks = [{
        id: 'extensions',
        step: '01',
        title: 'extensions.conf Context',
        file: 'extensions.conf',
        subtitle: config.playTone
          ? '[inb' + config.customer + '] plays the welcome audio and ' +
            (config.agents.length ? 'then dials contacts sequentially.' : 'hangs up.')
          : '[inb' + config.customer + '] with sequential contacts.',
        code: buildContactsExtensions(config)
      }];
    }

    return {
      config: config,
      errors: [],
      warnings: validation.warnings,
      blocks: blocks,
      meta: {
        routingLabel: routingLabel(config),
        generatedAt: new Date().toISOString()
      }
    };
  }

  function resultText(result) {
    if (!result || !result.blocks || !result.blocks.length) return '';
    return result.blocks.map(function (block) {
      return '; ===== ' + block.title + ' (' + block.file + ') =====\n' + block.code;
    }).join('\n') + '\n';
  }

  return {
    TRUNKS: TRUNKS,
    STICKY_MODES: STICKY_MODES,
    AUDIO_MODES: AUDIO_MODES,
    TATA_PREFERRED_IDENTITY: TATA_PREFERRED_IDENTITY,
    QUEUE_AGENT_TIMEOUT: QUEUE_AGENT_TIMEOUT,
    MIN_QUEUE_TIMEOUT: MIN_QUEUE_TIMEOUT,
    MAX_QUEUE_TIMEOUT: MAX_QUEUE_TIMEOUT,
    MIN_RING_TIME: MIN_RING_TIME,
    MAX_RING_TIME: MAX_RING_TIME,
    digits: digits,
    normalizeMobile: normalizeMobile,
    normalizeDisplayNumber: normalizeDisplayNumber,
    normalizeDid: normalizeDid,
    normalizeCustomer: normalizeCustomer,
    normalizeAudio: normalizeAudio,
    normalizeConfig: normalizeConfig,
    validateConfig: validateConfig,
    formatDaySpec: formatDaySpec,
    generate: generate,
    resultText: resultText
  };
});
