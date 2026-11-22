/*
 * Static UI controller for the Asterisk dialplan generator.
 *
 * No network calls: everything is generated in the browser by dialplan.js.
 * Works from file:// and GitHub Pages.
 */
(function () {
  'use strict';

  var D = window.Dialplan;
  if (!D) return;

  /* ------------------------------------------------------------------ */
  /* Small DOM helpers                                                  */
  /* ------------------------------------------------------------------ */

  function $(id) { return document.getElementById(id); }
  function qa(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }
  function setHidden(node, hidden) {
    if (node) node.hidden = !!hidden;
  }
  function makeHelp(tip) {
    var button = el('button', 'help', '?');
    button.type = 'button';
    button.setAttribute('data-tip', tip);
    button.setAttribute('aria-label', 'More information');
    button.setAttribute('aria-expanded', 'false');
    return button;
  }
  function checkedValue(name) {
    var input = document.querySelector('input[name="' + name + '"]:checked');
    return input ? input.value : '';
  }

  /* ------------------------------------------------------------------ */
  /* Constants                                                          */
  /* ------------------------------------------------------------------ */

  var DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  var DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  var DEFAULT_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];

  var DEFAULTS = {
    customer: 'nivashanprop',
    did: '45549493',
    displayNumber: '+918045549493',
    welcomeAudio: 'nivashanpropwelcome',
    groupName: 'nivashanproppgrp',
    queueTimeout: '90',
    rrAudio: 'nivashanpropwelcome',
    ringTime: '30',
    from: '09:00',
    to: '18:00'
  };

  var DEFAULT_AGENTS = ['8000447127', '8904721417'];
  var DEFAULT_IVR = [
    { digit: '1', type: 'queue', number: '' },
    { digit: '2', type: 'number', number: '8000447127' }
  ];

  /* ------------------------------------------------------------------ */
  /* State                                                              */
  /* ------------------------------------------------------------------ */

  var state = {
    agents: DEFAULT_AGENTS.slice(),
    days: new Set(DEFAULT_DAYS),
    ivrRows: DEFAULT_IVR.map(function (row) { return { digit: row.digit, type: row.type, number: row.number }; }),
    lastResult: null,
    timer: null,
    toastTimer: null
  };

  /* ------------------------------------------------------------------ */
  /* Elements                                                           */
  /* ------------------------------------------------------------------ */

  var ui = {
    form: $('ruleForm'),
    preset: $('preset'),
    presetNote: $('presetNote'),
    trunk: $('trunk'),
    pilotHeader: $('pilotHeader'),
    customer: $('customer'),
    did: $('did'),
    displayNumber: $('displayNumber'),
    welcomeAudio: $('welcomeAudio'),

    timeFields: $('timeFields'),
    dayPills: $('dayPills'),
    fromHour: $('fromHour'),
    fromMinute: $('fromMinute'),
    fromMeridiem: $('fromMeridiem'),
    toHour: $('toHour'),
    toMinute: $('toMinute'),
    toMeridiem: $('toMeridiem'),
    offHoursAudio: $('offHoursAudio'),

    forwardCard: $('forwardCard'),
    playToneHint: $('playToneHint'),
    groupNameField: $('groupNameField'),
    groupName: $('groupName'),
    agentsRequired: $('agentsRequired'),
    agentBlock: $('agentBlock'),
    agentHome: $('agentHome'),
    rrAgentSlot: $('rrAgentSlot'),
    agentList: $('agentList'),
    addAgentBtn: $('addAgentBtn'),
    bulkToggle: $('bulkToggle'),
    bulkPanel: $('bulkPanel'),
    bulkText: $('bulkText'),
    bulkAddBtn: $('bulkAddBtn'),
    bulkNote: $('bulkNote'),

    rrPanel: $('rrPanel'),
    rrQueuePreview: $('rrQueuePreview'),
    stickyMode: $('stickyMode'),
    queueTimeout: $('queueTimeout'),
    rrAudioMode: $('rrAudioMode'),
    rrAudioField: $('rrAudioField'),
    rrAudio: $('rrAudio'),
    rrAudioHelp: $('rrAudioHelp'),
    ivrPanel: $('ivrPanel'),
    ivrOptions: $('ivrOptions'),
    ivrRequired: $('ivrRequired'),
    addIvrOption: $('addIvrOption'),

    ringCard: $('ringCard'),
    ringTime: $('ringTime'),
    resetBtn: $('resetBtn'),

    validationHint: $('validationHint'),
    sumCustomer: $('sumCustomer'),
    sumContext: $('sumContext'),
    sumDid: $('sumDid'),
    sumTrunk: $('sumTrunk'),
    sumForward: $('sumForward'),
    sumAgents: $('sumAgents'),
    sumDetail: $('sumDetail'),
    summaryStatus: $('summaryStatus'),

    outputSection: $('outputSection'),
    outputTitle: $('outputTitle'),
    outputMeta: $('outputMeta'),
    statusBadge: $('statusBadge'),
    downloadAll: $('downloadAll'),

    errorBanner: $('errorBanner'),
    errorTitle: $('errorTitle'),
    errorList: $('errorList'),
    warningBanner: $('warningBanner'),
    warningList: $('warningList'),
    outputEmpty: $('outputEmpty'),
    outputBlocks: $('outputBlocks'),

    toast: $('toast')
  };

  /* ------------------------------------------------------------------ */
  /* Defaults and static option lists                                   */
  /* ------------------------------------------------------------------ */

  function fillSelect(select, values, selected) {
    clear(select);
    values.forEach(function (value) {
      var option = el('option', null, value);
      option.value = value;
      if (value === selected) option.selected = true;
      select.appendChild(option);
    });
  }

  function populateTimeSelects() {
    var hours = [];
    for (var i = 1; i <= 12; i += 1) hours.push(String(i));

    var minutes = [];
    for (var m = 0; m < 60; m += 5) minutes.push((m < 10 ? '0' : '') + m);

    fillSelect(ui.fromHour, hours, '9');
    fillSelect(ui.fromMinute, minutes, '00');
    ui.fromMeridiem.value = 'AM';

    fillSelect(ui.toHour, hours, '6');
    fillSelect(ui.toMinute, minutes, '00');
    ui.toMeridiem.value = 'PM';
  }

  function setTime(prefix, value) {
    var match = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/.exec(value || '');
    if (!match) return;

    var hour24 = Number(match[1]);
    var minute = match[2];
    var meridiem = hour24 >= 12 ? 'PM' : 'AM';
    var hour12 = hour24 % 12;
    if (hour12 === 0) hour12 = 12;

    var hourSelect = prefix === 'from' ? ui.fromHour : ui.toHour;
    var minuteSelect = prefix === 'from' ? ui.fromMinute : ui.toMinute;
    var meridiemSelect = prefix === 'from' ? ui.fromMeridiem : ui.toMeridiem;

    hourSelect.value = String(hour12);
    if (minuteSelect.querySelector('option[value="' + minute + '"]')) {
      minuteSelect.value = minute;
    } else {
      var option = el('option', null, minute);
      option.value = minute;
      minuteSelect.appendChild(option);
      minuteSelect.value = minute;
    }
    meridiemSelect.value = meridiem;
  }

  function readTime(prefix) {
    var hourSelect = prefix === 'from' ? ui.fromHour : ui.toHour;
    var minuteSelect = prefix === 'from' ? ui.fromMinute : ui.toMinute;
    var meridiemSelect = prefix === 'from' ? ui.fromMeridiem : ui.toMeridiem;

    var hour = parseInt(hourSelect.value, 10);
    var minute = parseInt(minuteSelect.value, 10);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return '';

    if (meridiemSelect.value === 'PM' && hour !== 12) hour += 12;
    if (meridiemSelect.value === 'AM' && hour === 12) hour = 0;

    return (hour < 10 ? '0' : '') + hour + ':' + (minute < 10 ? '0' : '') + minute;
  }

  /* ------------------------------------------------------------------ */
  /* Radios, help tips                                                  */
  /* ------------------------------------------------------------------ */

  function syncRadioCards(name) {
    qa('input[name="' + name + '"]').forEach(function (input) {
      var card = input.closest('.radio-card');
      if (card) card.classList.toggle('is-selected', input.checked);
    });
  }

  function closeHelpTips(except) {
    qa('.help.is-open').forEach(function (button) {
      if (button === except) return;
      button.classList.remove('is-open');
      button.setAttribute('aria-expanded', 'false');
    });
  }

  // Delegated so help badges generated with IVR rows work too. Hovering is
  // handled in CSS via .help:hover::after; click toggles a persistent popover.
  function bindHelpTips() {
    document.addEventListener('click', function (event) {
      var help = event.target && event.target.closest ? event.target.closest('.help') : null;
      if (!help) {
        closeHelpTips(null);
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      var open = !help.classList.contains('is-open');
      closeHelpTips(help);
      help.classList.toggle('is-open', open);
      help.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) help.focus();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeHelpTips(null);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Trunk preset                                                       */
  /* ------------------------------------------------------------------ */

  function applyPreset(key) {
    var trunk = D.TRUNKS[key] || D.TRUNKS.airtel;
    ui.trunk.value = trunk.channel + '/';
    ui.pilotHeader.value = trunk.header;
    ui.presetNote.textContent = trunk.note;
  }

  /* ------------------------------------------------------------------ */
  /* Day pills                                                          */
  /* ------------------------------------------------------------------ */

  function renderDays() {
    clear(ui.dayPills);
    DAY_ORDER.forEach(function (day) {
      var button = el('button', 'day-pill', DAY_LABELS[day]);
      button.type = 'button';
      button.setAttribute('aria-pressed', state.days.has(day) ? 'true' : 'false');
      button.addEventListener('click', function () {
        if (state.days.has(day)) state.days.delete(day);
        else state.days.add(day);
        renderDays();
        schedule();
      });
      ui.dayPills.appendChild(button);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Agent list                                                         */
  /* ------------------------------------------------------------------ */

  function renderAgents(focusLast) {
    clear(ui.agentList);

    if (!state.agents.length) state.agents.push('');

    state.agents.forEach(function (raw, index) {
      var row = el('div', 'agent-row');

      var badge = el('span', 'agent-index', String(index + 1));
      badge.setAttribute('aria-hidden', 'true');

      var input = el('input', 'mono agent-input');
      input.type = 'tel';
      input.value = raw;
      input.placeholder = '10-digit mobile e.g. 8904033940';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.inputMode = 'tel';
      input.setAttribute('aria-label', 'Agent mobile number ' + (index + 1));
      input.addEventListener('input', function () {
        state.agents[index] = input.value;
        schedule();
      });

      var remove = el('button', 'icon-btn', '\u00d7');
      remove.type = 'button';
      remove.title = 'Remove agent';
      remove.setAttribute('aria-label', 'Remove agent number ' + (index + 1));
      remove.addEventListener('click', function () {
        if (state.agents.length === 1) {
          state.agents[0] = '';
        } else {
          state.agents.splice(index, 1);
        }
        renderAgents();
        schedule();
      });

      row.appendChild(badge);
      row.appendChild(input);
      row.appendChild(remove);
      ui.agentList.appendChild(row);
    });

    if (focusLast) {
      var inputs = qa('.agent-input', ui.agentList);
      if (inputs.length) inputs[inputs.length - 1].focus();
    }
  }

  function addAgent() {
    state.agents.push('');
    renderAgents(true);
    schedule();
  }

  /* ------------------------------------------------------------------ */
  /* Bulk paste                                                         */
  /* ------------------------------------------------------------------ */

  function parseBulk(text) {
    var source = String(text || '').replace(/\r/g, '');
    var tokens = [];

    // Commas, semicolons and newlines are hard separators. Spaces can be part
    // of a formatted number ("+91 98660 33416"), so only treat a whitespace
    // separated segment as several numbers when its digit count is too large.
    source.split(/[\n,;]+/).forEach(function (segment) {
      var value = segment.trim();
      if (!value) return;

      var compact = value.replace(/[^0-9]/g, '');
      if (compact.length >= 10 && compact.length <= 14) {
        tokens.push(value);
        return;
      }

      value.split(/\s+/).forEach(function (token) {
        if (token) tokens.push(token);
      });
    });

    var valid = [];
    var invalid = [];
    var seen = {};

    tokens.forEach(function (token) {
      var number = D.normalizeMobile(token);
      if (!number) {
        invalid.push(token);
        return;
      }
      if (seen[number]) return;
      seen[number] = true;
      valid.push(number);
    });

    return { valid: valid, invalid: invalid };
  }

  function addBulkNumbers() {
    var parsed = parseBulk(ui.bulkText.value);
    if (!parsed.valid.length && !parsed.invalid.length) {
      ui.bulkNote.textContent = 'Paste at least one mobile number first.';
      return;
    }

    var existing = {};
    var added = 0;

    state.agents = state.agents.filter(function (raw) { return raw.trim() !== ''; });
    state.agents.forEach(function (raw) {
      var number = D.normalizeMobile(raw);
      if (number) existing[number] = true;
    });

    parsed.valid.forEach(function (number) {
      if (existing[number]) return;
      existing[number] = true;
      state.agents.push(number);
      added += 1;
    });

    if (!state.agents.length) state.agents.push('');
    renderAgents();

    if (parsed.invalid.length) {
      ui.bulkNote.textContent = 'Added ' + added + '. Skipped invalid: ' + parsed.invalid.join(', ');
      toast('Added ' + added + ' number' + (added === 1 ? '' : 's') + ', skipped ' + parsed.invalid.length + ' invalid.');
    } else {
      ui.bulkNote.textContent = 'Added ' + added + ' number' + (added === 1 ? '' : 's') + '.';
      toast('Added ' + added + ' number' + (added === 1 ? '' : 's') + '.');
    }

    ui.bulkText.value = '';
    schedule();
  }

  /* ------------------------------------------------------------------ */
  /* IVR rows                                                           */
  /* ------------------------------------------------------------------ */

  function nextIvrDigit() {
    var used = {};
    state.ivrRows.forEach(function (row) { used[row.digit] = true; });
    for (var digit = 1; digit <= 5; digit += 1) {
      if (!used[String(digit)]) return String(digit);
    }
    return '';
  }

  function renderIvrRows() {
    clear(ui.ivrOptions);

    if (!state.ivrRows.length) {
      state.ivrRows.push({ digit: '1', type: 'queue', number: '' });
    }

    state.ivrRows.forEach(function (row, index) {
      var wrapper = el('div', 'ivr-row');

      var digitCell = el('div', 'ivr-cell');
      var digitHead = el('div', 'label-row ivr-label-row');
      digitHead.appendChild(el('label', null, 'Press'));
      digitHead.appendChild(makeHelp('DTMF digit the caller presses to choose this option. Digits 1 to 5 are supported and each digit can be used once.'));
      digitCell.appendChild(digitHead);
      var digitSelect = el('select', 'ivr-digit');
      for (var digit = 1; digit <= 5; digit += 1) {
        var digitOption = el('option', null, String(digit));
        digitOption.value = String(digit);
        if (String(digit) === row.digit) digitOption.selected = true;
        digitSelect.appendChild(digitOption);
      }
      digitSelect.setAttribute('aria-label', 'DTMF option ' + (index + 1) + ' digit');
      digitSelect.addEventListener('change', function () {
        row.digit = digitSelect.value;
        schedule();
      });
      digitCell.appendChild(digitSelect);

      var typeCell = el('div', 'ivr-cell');
      var typeHead = el('div', 'label-row ivr-label-row');
      typeHead.appendChild(el('label', null, 'Action'));
      typeHead.appendChild(makeHelp('Route to Round Robin Queue sends this digit to the queue. Direct Dial Single Number dials one 10-digit mobile with a 0 prefix.'));
      typeCell.appendChild(typeHead);
      var typeSelect = el('select', 'ivr-type');
      [
        { value: 'queue', label: 'Route to Round Robin Queue' },
        { value: 'number', label: 'Direct Dial Single Number' }
      ].forEach(function (choice) {
        var option = el('option', null, choice.label);
        option.value = choice.value;
        if (choice.value === row.type) option.selected = true;
        typeSelect.appendChild(option);
      });
      typeSelect.setAttribute('aria-label', 'DTMF option ' + (index + 1) + ' action');
      typeSelect.addEventListener('change', function () {
        row.type = typeSelect.value;
        renderIvrRows();
        schedule();
      });
      typeCell.appendChild(typeSelect);

      var numberCell = el('div', 'ivr-cell ivr-number-cell');
      var numberHead = el('div', 'label-row ivr-label-row');
      numberHead.appendChild(el('label', null, 'Direct number'));
      numberHead.appendChild(makeHelp('Single 10-digit mobile dialled when this DTMF option is chosen. Asterisk dials it as 0 + 10 digits. Enabled only for the direct-dial action.'));
      numberCell.appendChild(numberHead);
      var numberInput = el('input', 'mono ivr-number');
      numberInput.type = 'tel';
      numberInput.value = row.number;
      numberInput.placeholder = '10-digit mobile';
      numberInput.autocomplete = 'off';
      numberInput.spellcheck = false;
      numberInput.inputMode = 'tel';
      numberInput.disabled = row.type !== 'number';
      numberInput.setAttribute('aria-label', 'DTMF option ' + (index + 1) + ' direct-dial number');
      numberInput.addEventListener('input', function () {
        row.number = numberInput.value;
        schedule();
      });
      numberCell.appendChild(numberInput);

      var remove = el('button', 'ivr-remove', '\u00d7');
      remove.type = 'button';
      remove.title = 'Remove IVR option';
      remove.setAttribute('aria-label', 'Remove IVR option ' + (index + 1));
      remove.disabled = state.ivrRows.length <= 1;
      remove.addEventListener('click', function () {
        if (state.ivrRows.length <= 1) return;
        state.ivrRows.splice(index, 1);
        renderIvrRows();
        schedule();
      });

      wrapper.appendChild(digitCell);
      wrapper.appendChild(typeCell);
      wrapper.appendChild(numberCell);
      wrapper.appendChild(remove);
      ui.ivrOptions.appendChild(wrapper);
    });
  }

  function addIvrRow() {
    var digit = nextIvrDigit();
    if (!digit) {
      toast('All five DTMF digits (1-5) are already used.', true);
      return;
    }
    state.ivrRows.push({ digit: digit, type: 'queue', number: '' });
    renderIvrRows();
    schedule();
  }

  /* ------------------------------------------------------------------ */
  /* Read form                                                          */
  /* ------------------------------------------------------------------ */

  function readConfig() {
    return {
      trunkKey: ui.preset.value,
      customer: ui.customer.value,
      did: ui.did.value,
      displayNumber: ui.displayNumber.value,
      welcomeAudio: ui.welcomeAudio.value,
      action: checkedValue('directAction') === 'tone' ? 'tone' : 'connect',
      forward: checkedValue('forwardTo') || 'contacts',
      groupName: ui.groupName.value,
      ringTime: ui.ringTime.value,
      timeMode: checkedValue('connectTime') === 'specific' ? 'specific' : 'always',
      days: Array.from(state.days),
      from: readTime('from'),
      to: readTime('to'),
      offHoursAudio: ui.offHoursAudio.value,
      agents: state.agents.slice(),
      rr: {
        sticky: ui.stickyMode.value,
        queueTimeout: ui.queueTimeout.value,
        audioMode: ui.rrAudioMode.value,
        audioFile: ui.rrAudio.value,
        ivrOptions: state.ivrRows.map(function (row) {
          return { digit: row.digit, type: row.type, number: row.number };
        })
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Visibility                                                         */
  /* ------------------------------------------------------------------ */

  function syncVisibility() {
    var action = checkedValue('directAction') === 'tone' ? 'tone' : 'connect';
    var forward = checkedValue('forwardTo') || 'contacts';
    var timeMode = checkedValue('connectTime') === 'specific' ? 'specific' : 'always';
    var audioMode = ui.rrAudioMode.value || 'none';
    var isTone = action === 'tone';
    var isRr = forward === 'roundrobin';

    setHidden(ui.timeFields, timeMode !== 'specific');
    // Play tone is a pre-routing audio step, so forwarding stays available.
    setHidden(ui.forwardCard, false);
    setHidden(ui.groupNameField, forward !== 'groups');
    setHidden(ui.rrPanel, !isRr);
    setHidden(ui.ringCard, isRr);
    setHidden(ui.rrAudioField, audioMode === 'none');
    setHidden(ui.ivrPanel, audioMode !== 'ivr');
    setHidden(ui.playToneHint, !isTone);
    setHidden(ui.agentsRequired, isTone);

    // Move the shared agent inputs after the RR configuration when RR is
    // selected, and back to their normal home for Contacts / Groups.
    if (isRr) {
      if (ui.agentBlock.parentNode !== ui.rrAgentSlot) ui.rrAgentSlot.appendChild(ui.agentBlock);
    } else if (ui.agentBlock.parentNode !== ui.agentHome) {
      ui.agentHome.appendChild(ui.agentBlock);
    }

    var audioPresent = !!ui.rrAudio.value.trim();
    setHidden(ui.ivrRequired, !(audioMode === 'ivr' && audioPresent));
    ui.rrAudioHelp.textContent = audioMode === 'ivr'
      ? (audioPresent
        ? 'Read with Read() before the DTMF checks. Use a filename without a path or extension.'
        : 'Leave blank to skip Read() and the DTMF checks. No validation error is shown.')
      : (audioPresent
        ? 'Played once with Playback() before the queue.'
        : 'Leave blank to skip Playback(). No validation error is shown.');

    var customer = D.normalizeCustomer(ui.customer.value) || 'customer';
    ui.rrQueuePreview.textContent = customer + 'roundrobin';

    syncRadioCards('connectTime');
    syncRadioCards('directAction');
    syncRadioCards('forwardTo');

    applyPreset(ui.preset.value);
  }

  /* ------------------------------------------------------------------ */
  /* Summary                                                            */
  /* ------------------------------------------------------------------ */

  function summaryChip(label, value) {
    var chip = el('span', 'summary-chip');
    chip.appendChild(el('span', null, label));
    chip.appendChild(el('b', null, value));
    return chip;
  }

  function renderSummary(result) {
    var config = result.config;
    var customer = config.customer;

    ui.sumCustomer.textContent = customer || '\u2014';
    ui.sumContext.textContent = customer ? 'inb' + customer : 'inb\u2026';
    ui.sumDid.textContent = config.did || '\u2014';
    ui.sumTrunk.textContent = config.trunk.label;
    ui.sumForward.textContent = config.forward === 'roundrobin'
      ? 'Round Robin / Sticky Queue'
      : (config.forward === 'groups' ? 'Groups (DIALGROUP)' : 'Contacts');
    ui.sumAgents.textContent = String(config.agents.length);

    clear(ui.sumDetail);

    if (config.timeMode === 'specific') {
      ui.sumDetail.appendChild(summaryChip('Window', config.from + ' \u2013 ' + config.to));
      ui.sumDetail.appendChild(summaryChip('Days', D.formatDaySpec(config.days)));
    } else {
      ui.sumDetail.appendChild(summaryChip('Window', '24/7'));
    }

    if (config.playTone) {
      ui.sumDetail.appendChild(summaryChip('Action', config.agents.length ? 'Tone + route' : 'Tone only'));
      if (config.welcomeAudio) ui.sumDetail.appendChild(summaryChip('Prompt', config.welcomeAudio));
    }

    if (config.forward === 'roundrobin') {
      ui.sumDetail.appendChild(summaryChip('Sticky', config.rr.stickyLabel));
      ui.sumDetail.appendChild(summaryChip('Queue', config.rr.queueTimeout + 's'));
      ui.sumDetail.appendChild(summaryChip('Audio', config.rr.audioFile ? config.rr.audioLabel : config.rr.audioLabel + ' (no file)'));
      if (config.rr.audioMode === 'ivr' && config.rr.audioFile) {
        ui.sumDetail.appendChild(summaryChip('DTMF', config.rr.ivrOptions.length + ' option' + (config.rr.ivrOptions.length === 1 ? '' : 's')));
      }
    } else if (config.forward === 'groups') {
      ui.sumDetail.appendChild(summaryChip('Ring', config.ringTime + 's'));
      if (config.groupName) ui.sumDetail.appendChild(summaryChip('DIALGROUP', config.groupName));
    } else {
      ui.sumDetail.appendChild(summaryChip('Ring', config.ringTime + 's'));
    }

    if (config.trunk.tata) {
      ui.sumDetail.appendChild(summaryChip('Header', 'TATA'));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Validation highlighting                                            */
  /* ------------------------------------------------------------------ */

  function clearInvalidMarks() {
    qa('.invalid').forEach(function (node) { node.classList.remove('invalid'); });
  }

  function markInvalid(field) {
    var targets = [];

    if (field === 'agents') targets = qa('.agent-input', ui.agentList);
    else if (field === 'days') targets = [ui.dayPills];
    else if (field === 'time') targets = [ui.fromHour, ui.toHour];
    else if (field === 'ivrOptions') targets = [ui.ivrOptions];
    else if (field === 'rrAudio') targets = [ui.rrAudio];
    else if (ui[field] && ui[field].classList) targets = [ui[field]];

    targets.forEach(function (node) {
      if (node) node.classList.add('invalid');
    });
  }

  /* ------------------------------------------------------------------ */
  /* Output rendering                                                   */
  /* ------------------------------------------------------------------ */

  function renderMessages(errors, warnings) {
    clear(ui.errorList);
    if (errors.length) {
      errors.forEach(function (item) { ui.errorList.appendChild(el('li', null, item.message)); });
      setHidden(ui.errorBanner, false);
    } else {
      setHidden(ui.errorBanner, true);
    }

    clear(ui.warningList);
    if (warnings.length) {
      warnings.forEach(function (item) { ui.warningList.appendChild(el('li', null, item.message)); });
      setHidden(ui.warningBanner, false);
    } else {
      setHidden(ui.warningBanner, true);
    }
  }

  function renderBlocks(blocks) {
    clear(ui.outputBlocks);

    blocks.forEach(function (block) {
      var card = el('article', 'code-card');

      var head = el('div', 'code-card-head');
      var title = el('div', 'code-card-title');
      title.appendChild(el('span', 'code-step', block.step));

      var text = el('div');
      text.appendChild(el('h3', null, block.title));
      text.appendChild(el('p', null, block.subtitle));
      text.appendChild(el('span', 'code-file', block.file));
      title.appendChild(text);

      var copyBtn = el('button', 'btn light small copy-btn', 'Copy');
      copyBtn.type = 'button';
      copyBtn.addEventListener('click', function () {
        copyText(block.code).then(function (ok) {
          if (!ok) {
            toast('Copy failed. Select the block text manually.', true);
            return;
          }
          copyBtn.textContent = 'Copied';
          copyBtn.classList.add('copied');
          window.setTimeout(function () {
            copyBtn.textContent = 'Copy';
            copyBtn.classList.remove('copied');
          }, 1400);
          toast(block.title + ' copied.');
        });
      });

      head.appendChild(title);
      head.appendChild(copyBtn);

      var pre = el('pre');
      pre.textContent = block.code;

      card.appendChild(head);
      card.appendChild(pre);
      ui.outputBlocks.appendChild(card);
    });
  }

  function setStatus(node, text, tone) {
    node.textContent = text;
    node.classList.remove('good', 'bad');
    if (tone) node.classList.add(tone);
  }

  function updateOutput(result, errors, warnings) {
    renderMessages(errors, warnings);

    var hasBlocks = result.blocks && result.blocks.length > 0;

    if (hasBlocks) {
      renderBlocks(result.blocks);
      setHidden(ui.outputEmpty, true);
      setHidden(ui.outputBlocks, false);
      ui.downloadAll.disabled = false;

      var time = new Date(result.meta.generatedAt);
      var stamp = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      ui.outputMeta.textContent = result.blocks.length + ' block' + (result.blocks.length === 1 ? '' : 's') +
        ' \u00b7 ' + result.meta.routingLabel + ' \u00b7 generated ' + stamp;
      ui.outputTitle.textContent = result.blocks.length === 1 ? 'Generated configuration' : 'Generated configuration (4 blocks)';

      if (warnings.length) setStatus(ui.statusBadge, 'Check warnings', null);
      else setStatus(ui.statusBadge, 'Ready to copy', 'good');
    } else {
      clear(ui.outputBlocks);
      setHidden(ui.outputBlocks, true);

      var heading = ui.outputEmpty.querySelector('strong');
      var copy = ui.outputEmpty.querySelector('p');
      if (heading) heading.textContent = errors.length ? 'Output paused' : 'No configuration generated yet';
      if (copy) {
        copy.textContent = errors.length
          ? 'Fix the highlighted fields above. The copy-ready blocks return automatically.'
          : 'Fill in the customer, DID and agent numbers. The copy-ready blocks appear here automatically.';
      }

      setHidden(ui.outputEmpty, false);
      ui.downloadAll.disabled = true;
      ui.outputMeta.textContent = errors.length
        ? 'Fix ' + errors.length + ' issue' + (errors.length === 1 ? '' : 's') + ' to generate the Asterisk blocks.'
        : 'Fill in the form to build the Asterisk blocks.';
      ui.outputTitle.textContent = 'Generated configuration';
      setStatus(ui.statusBadge, errors.length ? 'Needs input' : 'Waiting', errors.length ? 'bad' : null);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Main render                                                        */
  /* ------------------------------------------------------------------ */

  function render() {
    syncVisibility();

    var result = D.generate(readConfig());
    state.lastResult = result;

    renderSummary(result);
    updateOutput(result, result.errors, result.warnings);

    clearInvalidMarks();
    result.errors.forEach(function (error) { markInvalid(error.field); });

    if (result.errors.length) {
      setStatus(ui.summaryStatus, 'Needs input', 'bad');
      ui.validationHint.textContent = 'Fix ' + result.errors.length + ' highlighted issue' +
        (result.errors.length === 1 ? '' : 's') + ' to generate.';
    } else if (result.warnings.length) {
      setStatus(ui.summaryStatus, 'Check', null);
      ui.validationHint.textContent = 'Generated with ' + result.warnings.length + ' warning' +
        (result.warnings.length === 1 ? '' : 's') + '. Review the banner below.';
    } else {
      setStatus(ui.summaryStatus, 'Ready', 'good');
      ui.validationHint.textContent = 'All checks passed. The output updates as you type.';
    }

    return result;
  }

  function schedule() {
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(render, 160);
  }

  /* ------------------------------------------------------------------ */
  /* Clipboard and download                                             */
  /* ------------------------------------------------------------------ */

  function legacyCopy(text) {
    var area = el('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.left = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);

    var ok = false;
    try {
      area.select();
      area.setSelectionRange(0, area.value.length);
      ok = document.execCommand('copy');
    } catch (error) {
      ok = false;
    }

    document.body.removeChild(area);
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () {
        return true;
      }).catch(function () {
        return legacyCopy(text);
      });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function downloadAll() {
    if (!state.lastResult || !state.lastResult.blocks.length) return;

    var text = D.resultText(state.lastResult);
    var customer = state.lastResult.config.customer || 'dialplan';
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = customer + '-dialplan.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Downloaded ' + link.download);
  }

  function toast(message, isError) {
    ui.toast.textContent = message;
    ui.toast.classList.toggle('error', !!isError);
    ui.toast.classList.add('show');
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(function () {
      ui.toast.classList.remove('show');
    }, 2600);
  }

  /* ------------------------------------------------------------------ */
  /* Reset                                                              */
  /* ------------------------------------------------------------------ */

  function resetDefaults() {
    if (!window.confirm('Reset the form and generated output to the defaults?')) return;

    ui.form.reset();

    state.agents = DEFAULT_AGENTS.slice();
    state.days = new Set(DEFAULT_DAYS);
    state.ivrRows = DEFAULT_IVR.map(function (row) {
      return { digit: row.digit, type: row.type, number: row.number };
    });

    ui.customer.value = DEFAULTS.customer;
    ui.did.value = DEFAULTS.did;
    ui.displayNumber.value = DEFAULTS.displayNumber;
    ui.welcomeAudio.value = DEFAULTS.welcomeAudio;
    ui.groupName.value = DEFAULTS.groupName;
    ui.queueTimeout.value = DEFAULTS.queueTimeout;
    ui.rrAudio.value = DEFAULTS.rrAudio;
    ui.ringTime.value = DEFAULTS.ringTime;
    ui.offHoursAudio.value = '';

    ui.preset.value = 'airtel';
    ui.stickyMode.value = 'none';
    ui.rrAudioMode.value = 'none';
    ui.bulkText.value = '';
    ui.bulkNote.textContent = 'Spaces, +91 and leading zeros are stripped automatically.';
    setHidden(ui.bulkPanel, true);
    ui.bulkToggle.setAttribute('aria-expanded', 'false');

    setTime('from', DEFAULTS.from);
    setTime('to', DEFAULTS.to);

    renderDays();
    renderAgents();
    renderIvrRows();
    render();

    toast('Defaults restored.');
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                             */
  /* ------------------------------------------------------------------ */

  function bindEvents() {
    ui.form.addEventListener('input', function () {
      schedule();
    });

    ui.form.addEventListener('change', function () {
      syncVisibility();
      schedule();
    });

    // Radio cards keep their selected styling in sync immediately.
    qa('input[type="radio"]').forEach(function (input) {
      input.addEventListener('change', function () {
        syncRadioCards(input.name);
        syncVisibility();
        schedule();
      });
    });

    ui.preset.addEventListener('change', function () {
      applyPreset(ui.preset.value);
      schedule();
    });

    ui.addAgentBtn.addEventListener('click', addAgent);

    ui.bulkToggle.addEventListener('click', function () {
      var open = ui.bulkPanel.hidden;
      setHidden(ui.bulkPanel, !open);
      ui.bulkToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) ui.bulkText.focus();
    });

    ui.bulkAddBtn.addEventListener('click', addBulkNumbers);

    ui.bulkText.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        addBulkNumbers();
      }
    });

    ui.addIvrOption.addEventListener('click', addIvrRow);

    ui.resetBtn.addEventListener('click', resetDefaults);

    ui.downloadAll.addEventListener('click', downloadAll);

    ui.form.addEventListener('submit', function (event) {
      event.preventDefault();
      window.clearTimeout(state.timer);
      var result = render();
      if (result.blocks.length) {
        ui.outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        toast('Generated ' + result.blocks.length + ' block' + (result.blocks.length === 1 ? '' : 's') + '.');
      } else {
        toast('Fix the highlighted issues first.', true);
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Init                                                               */
  /* ------------------------------------------------------------------ */

  function init() {
    populateTimeSelects();
    renderDays();
    renderAgents();
    renderIvrRows();
    bindEvents();
    bindHelpTips();
    applyPreset(ui.preset.value);
    render();
  }

  init();
})();
