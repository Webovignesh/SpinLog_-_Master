// ════════════════════════════════════════════════════════════════════════
// SPINLOG — SAGE UI
//
// Sage's face. Right now that means the settings modal: the Gemini key, when
// she is allowed to talk, and what she talks about.
//
// Settings live in two places on purpose. The key is localStorage because only
// the page ever needs it. The notification limits go through the scheduler into
// IndexedDB, because the service worker has to obey them too.
// ════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // Friendly labels for the scheduler's category keys. Anything the scheduler
  // knows about but this map doesn't gets a generated label, so adding a
  // category can never leave a blank row in the UI.
  const CATEGORY_LABELS = {
    serviceDue: { name: 'Service coming up', hint: 'Distance or date approaching' },
    serviceOverdue: { name: 'Service overdue', hint: 'Past the interval' },
    insuranceReminder: { name: 'Insurance renewal', hint: '30, 15 and 7 days out' },
    insuranceExpiring: { name: 'Cover expiring', hint: 'The last day or two' },
    documentExpiry: { name: 'Documents expiring', hint: 'PUC, RC, licence' },
    longTimeParked: { name: 'Still parked', hint: 'Every couple of hours' },
    parkingSaved: { name: 'Parking saved', hint: 'Confirmation when you park' },
    recordSaved: { name: 'Record saved', hint: 'Confirmation when you log something' },
    reEngagement: { name: 'Missing you', hint: 'After a couple of quiet days' },
    anniversary: { name: 'Anniversary', hint: 'Once a year' },
    healthInsight: { name: 'Weekly health report', hint: 'Sunday summary' },
  };

  const HOUR_LABELS = Array.from({ length: 24 }, (_, h) =>
    `${String(h).padStart(2, '0')}:00`);

  let els = null;
  let lastFocused = null;
  let modelsSeen = null;

  function $(id) { return document.getElementById(id); }

  function cache() {
    if (els) return els;
    els = {
      modal: $('sageSettingsModal'),
      close: $('sageSettingsClose'),
      keyInput: $('sageKeyInput'),
      keyReveal: $('sageKeyReveal'),
      keyCheck: $('sageKeyCheck'),
      keyForget: $('sageKeyForget'),
      keyStatus: $('sageKeyStatus'),
      keyList: $('sageKeyList'),
      model: $('sageModelSelect'),
      quietStart: $('sageQuietStart'),
      quietEnd: $('sageQuietEnd'),
      quietNote: $('sageQuietNote'),
      dailyCap: $('sageDailyCap'),
      dailyCapOut: $('sageDailyCapOut'),
      minGap: $('sageMinGap'),
      minGapOut: $('sageMinGapOut'),
      critQuiet: $('sageCritQuiet'),
      catList: $('sageCategoryList'),
      test: $('sageTestNotif'),
      save: $('sageSettingsSave'),
      status: $('sageSettingsStatus'),
    };
    return els;
  }

  function setStatus(el, message, kind) {
    if (!el) return;
    el.textContent = message || '';
    el.classList.remove('is-ok', 'is-bad', 'is-warn');
    if (kind) el.classList.add(`is-${kind}`);
  }

  // ══ Hour + range controls ════════════════════════════════════════════

  function fillHours(select, selected) {
    if (!select) return;
    select.innerHTML = HOUR_LABELS
      .map((label, h) => `<option value="${h}"${h === selected ? ' selected' : ''}>${label}</option>`)
      .join('');
  }

  function describeQuiet(start, end) {
    if (start === end) return 'Quiet hours off — she can talk at any hour.';
    const span = start < end ? end - start : 24 - start + end;
    const wraps = start > end ? ' (over midnight)' : '';
    return `Silent for ${span} hour${span === 1 ? '' : 's'}${wraps}. `
      + `Last message by ${HOUR_LABELS[start]}, next from ${HOUR_LABELS[end]}.`;
  }

  function refreshQuietNote() {
    const e = cache();
    if (!e.quietNote) return;
    e.quietNote.textContent = describeQuiet(Number(e.quietStart.value), Number(e.quietEnd.value));
  }

  function refreshRangeOutputs() {
    const e = cache();
    if (e.dailyCapOut) e.dailyCapOut.textContent = e.dailyCap.value;
    if (e.minGapOut) e.minGapOut.textContent = `${e.minGap.value}h`;
  }

  // ══ Categories ═══════════════════════════════════════════════════════

  function labelFor(category) {
    if (CATEGORY_LABELS[category]) return CATEGORY_LABELS[category];
    // Turn 'someNewThing' into 'Some new thing' rather than showing nothing.
    const spaced = category.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
    return { name: spaced.charAt(0).toUpperCase() + spaced.slice(1), hint: '' };
  }

  function renderCategories(limits) {
    const e = cache();
    const S = window.SageScheduler;
    if (!e.catList || !S) return;

    const muted = (limits && limits.categories) || {};
    const categories = Object.keys(S.CATEGORY_META).sort((a, b) =>
      (S.CATEGORY_META[b].priority || 0) - (S.CATEGORY_META[a].priority || 0));

    e.catList.innerHTML = categories.map(cat => {
      const { name, hint } = labelFor(cat);
      const on = muted[cat] !== false;
      const id = `sageCat_${cat}`;
      return `
        <label class="sage-toggle" for="${id}">
          <input type="checkbox" id="${id}" data-sage-category="${cat}"${on ? ' checked' : ''} />
          <span class="sage-toggle-mark" aria-hidden="true"></span>
          <span class="sage-toggle-text">${name}${hint ? `<small>${hint}</small>` : ''}</span>
        </label>`;
    }).join('');
  }

  function readCategories() {
    const e = cache();
    const out = {};
    if (!e.catList) return out;
    e.catList.querySelectorAll('[data-sage-category]').forEach(box => {
      // Only record the mutes. An absent key means "on", which keeps the stored
      // object small and means new categories default to enabled.
      if (!box.checked) out[box.dataset.sageCategory] = false;
    });
    return out;
  }

  // ══ Model list ═══════════════════════════════════════════════════════

  function renderModels(available) {
    const e = cache();
    const AI = window.SageAI;
    if (!e.model || !AI) return;
    const current = AI.getModel();
    const options = AI.preferredModels(available);
    if (options.indexOf(current) === -1) options.unshift(current);
    e.model.innerHTML = options
      .map(m => `<option value="${m}"${m === current ? ' selected' : ''}>${m}</option>`)
      .join('');
  }

  // ══ Load + save ══════════════════════════════════════════════════════

  async function load() {
    const e = cache();
    const S = window.SageScheduler;
    const AI = window.SageAI;

    const limits = S ? await S.getLimits() : null;

    if (AI) {
      // No key value is ever written into the field. The ring below shows what
      // is stored, masked; this box only ever adds a new one.
      e.keyInput.value = '';
      e.keyInput.placeholder = 'Paste your key';
      renderKeys();
      // Prefer what this session just learned, then the catalog cached from a
      // previous check, so the list is real rather than the built-in guess.
      renderModels(modelsSeen || AI.getKnownModels());

      const ring = AI.getKeys();
      const resting = ring.filter(k => AI.keyResting(k.id)).length;
      let note = 'No keys yet — using her built-in lines.';
      let tone = null;
      if (ring.length) {
        note = `${ring.length} key${ring.length === 1 ? '' : 's'} on the ring`;
        note += resting ? `, ${resting} resting. ` : '. ';
        // Free-tier flash is metered per day, so the day's usage is the number
        // that actually explains why she has gone quiet.
        const used = AI.requestsToday();
        note += `Today: ${used.chat} chat, ${used.auto} background `
          + `(${AI.autoBudgetLeft()} of ${AI.DAILY_AUTO_BUDGET} background left).`;
        tone = resting < ring.length ? 'ok' : 'warn';
      }
      setStatus(e.keyStatus, note, tone);
    }

    if (limits) {
      fillHours(e.quietStart, limits.quietStart);
      fillHours(e.quietEnd, limits.quietEnd);
      e.dailyCap.value = limits.dailyCap;
      e.minGap.value = Math.round(limits.minGapMs / 3600000);
      e.critQuiet.checked = limits.criticalInQuietHours !== false;
      renderCategories(limits);
    }

    refreshQuietNote();
    refreshRangeOutputs();
    setStatus(e.status, '');
  }

  async function save() {
    const e = cache();
    const S = window.SageScheduler;
    if (!S) { setStatus(e.status, 'Scheduler unavailable, nothing saved.', 'bad'); return false; }

    await S.setLimits({
      quietStart: Number(e.quietStart.value),
      quietEnd: Number(e.quietEnd.value),
      dailyCap: Number(e.dailyCap.value),
      minGapMs: Number(e.minGap.value) * 3600000,
      criticalInQuietHours: !!e.critQuiet.checked,
      categories: readCategories(),
    });

    if (window.SageAI && e.model.value) window.SageAI.setModel(e.model.value);

    setStatus(e.status, 'Saved. She will behave accordingly.', 'ok');
    console.log('[SpinLog] ✅ Sage settings saved');
    return true;
  }

  // ══ Key check ════════════════════════════════════════════════════════

  /** The key ring, with a live status against each one. */
  function renderKeys() {
    const e = cache();
    const AI = window.SageAI;
    if (!e.keyList || !AI) return;

    const ring = AI.getKeys();
    if (!ring.length) {
      e.keyList.innerHTML = '<p class="sage-set-note sage-set-note--tight">No keys yet.</p>';
      return;
    }

    e.keyList.innerHTML = ring.map((k, i) => {
      const resting = AI.keyResting(k.id);
      return `<div class="sage-key-item${resting ? ' is-resting' : ''}">
        <span class="sage-key-dot" aria-hidden="true"></span>
        <span class="sage-key-mask">${escapeHtml(AI.maskKey(k.key))}</span>
        <span class="sage-key-state">${resting ? 'resting' : (i === 0 ? 'in use' : 'standby')}</span>
        <button type="button" class="sage-icon-btn sage-key-remove" data-key-id="${escapeHtml(k.id)}"
                aria-label="Remove key ${escapeHtml(AI.maskKey(k.key))}">
          <i class="fas fa-xmark" aria-hidden="true"></i>
        </button>
      </div>`;
    }).join('');
  }

  async function checkAndAddKey() {
    const e = cache();
    const AI = window.SageAI;
    if (!AI) return;

    const typed = e.keyInput.value.trim();
    if (!typed) {
      setStatus(e.keyStatus, 'Paste a key first.', 'bad');
      e.keyInput.focus();
      return;
    }

    // Refuse a duplicate before spending a request on it.
    if (AI.getKeys().some(k => k.id === AI.keyId(typed))) {
      setStatus(e.keyStatus, 'That key is already on the ring.', 'warn');
      return;
    }

    e.keyCheck.disabled = true;
    setStatus(e.keyStatus, 'Checking with Gemini…');

    const result = await AI.validateKey(typed, e.model.value);
    e.keyCheck.disabled = false;

    if (!result.ok) {
      // A bad key is never stored, so a typo can't silently break her voice.
      setStatus(e.keyStatus, result.error, 'bad');
      return;
    }

    const added = AI.addKey(typed);
    if (!added.ok) {
      setStatus(e.keyStatus, 'That key is already on the ring.', 'warn');
      return;
    }

    if (result.models) {
      modelsSeen = result.models;
      renderModels(modelsSeen);
    }
    e.keyInput.value = '';
    renderKeys();

    const total = AI.getKeys().length;
    const plural = total === 1 ? 'key' : 'keys';
    setStatus(e.keyStatus,
      result.warning || `Key added — ${total} ${plural} on the ring. Writing her first few lines…`,
      result.warning ? 'warn' : 'ok');

    // Warm the pools straight away so the very next notification is hers, not a
    // built-in fallback.
    if (!result.warning && AI.refreshPools) {
      const written = await AI.refreshPools().catch(() => 0);
      setStatus(e.keyStatus,
        written ? `Key added. She has written ${written} fresh batch${written === 1 ? '' : 'es'} of lines.`
                : `Key added — ${total} ${plural} on the ring.`, 'ok');
    }
  }

  function forgetKeyPools() {
    // Lines written by a key you no longer have are not yours to keep.
    if (window.SageAI?.clearPools) window.SageAI.clearPools().catch(() => {});
  }

  function removeOneKey(id) {
    const e = cache();
    const AI = window.SageAI;
    if (!AI) return;
    AI.removeKey(id);
    renderKeys();
    const left = AI.getKeys().length;
    if (!left) {
      forgetKeyPools();
      setStatus(e.keyStatus, 'Last key removed. Back to her built-in lines.', 'warn');
    } else {
      setStatus(e.keyStatus, `Key removed — ${left} left on the ring.`, 'ok');
    }
  }

  function forgetKey() {
    const e = cache();
    const AI = window.SageAI;
    if (!AI) return;
    AI.clearKey();
    forgetKeyPools();
    e.keyInput.value = '';
    e.keyInput.placeholder = 'Paste your key';
    renderKeys();
    setStatus(e.keyStatus, 'All keys removed. Back to her built-in lines.', 'warn');
  }

  // ══ Test notification ════════════════════════════════════════════════

  async function sendTest() {
    const e = cache();
    setStatus(e.status, 'Asking her to say something…');

    // This is a real button press, so it is the right moment to ask if we
    // haven't already. Nothing else in the app prompts.
    const granted = window.requestNotifPermission
      ? await window.requestNotifPermission()
      : false;
    if (!granted) {
      setStatus(e.status, 'Notifications are blocked for this site. Allow them in your browser settings.', 'bad');
      return;
    }

    const S = window.SageScheduler;
    const mood = S ? S.moodAt(Date.now(), await S.getLimits()) : null;

    // Deliberately bypasses the queue. A test that got deferred three hours by
    // the daily cap would be a useless test.
    const sent = await window.sendSageTestNotif(mood);
    setStatus(e.status,
      sent ? `Sent — she is feeling ${mood} right now.` : 'Could not send. Check notification permission.',
      sent ? 'ok' : 'bad');
  }

  // ══ Open / close ═════════════════════════════════════════════════════

  function open() {
    const e = cache();
    if (!e.modal) return;
    lastFocused = document.activeElement;
    e.modal.classList.add('sl-modal--open');
    e.modal.setAttribute('aria-hidden', 'false');
    load().then(() => {
      setTimeout(() => e.close?.focus({ preventScroll: true }), 60);
    });
    document.addEventListener('keydown', onKeydown);
  }

  function close() {
    const e = cache();
    if (!e.modal) return;
    e.modal.classList.remove('sl-modal--open');
    e.modal.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', onKeydown);
    // Send focus back where it came from rather than to the top of the page.
    if (lastFocused && lastFocused.focus) lastFocused.focus({ preventScroll: true });
    lastFocused = null;
  }

  function isOpen() {
    const e = cache();
    return !!e.modal && e.modal.classList.contains('sl-modal--open');
  }

  function onKeydown(ev) {
    if (!isOpen()) return;
    if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
    if (ev.key !== 'Tab') return;

    // Keep Tab inside the dialog while it is open.
    const e = cache();
    const focusable = e.modal.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }

  // ══ Wiring ═══════════════════════════════════════════════════════════

  function setup() {
    const e = cache();
    if (!e.modal) return;

    e.close?.addEventListener('click', close);
    e.modal.addEventListener('click', ev => { if (ev.target === e.modal) close(); });

    e.keyReveal?.addEventListener('click', () => {
      const showing = e.keyInput.type === 'text';
      e.keyInput.type = showing ? 'password' : 'text';
      e.keyReveal.setAttribute('aria-pressed', String(!showing));
      e.keyReveal.setAttribute('aria-label', showing ? 'Show key' : 'Hide key');
      e.keyReveal.innerHTML = `<i class="fas fa-${showing ? 'eye' : 'eye-slash'}" aria-hidden="true"></i>`;
    });

    e.keyCheck?.addEventListener('click', checkAndAddKey);
    e.keyForget?.addEventListener('click', forgetKey);
    e.keyInput?.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); checkAndAddKey(); }
    });
    // Delegated: the list is rebuilt whenever the ring changes.
    e.keyList?.addEventListener('click', ev => {
      const btn = ev.target.closest('.sage-key-remove');
      if (btn) removeOneKey(btn.dataset.keyId);
    });

    e.quietStart?.addEventListener('change', refreshQuietNote);
    e.quietEnd?.addEventListener('change', refreshQuietNote);
    e.dailyCap?.addEventListener('input', refreshRangeOutputs);
    e.minGap?.addEventListener('input', refreshRangeOutputs);

    e.test?.addEventListener('click', sendTest);
    e.save?.addEventListener('click', async () => {
      if (await save()) setTimeout(close, 700);
    });

    console.log('[SpinLog] ✅ Sage settings ready');
  }

  // ══════════════════════════════════════════════════════════════════════
  // CHAT
  // The bike talks back. Grounded in the same service data the notifications
  // use, so what she says here matches what the home screen shows.
  // ══════════════════════════════════════════════════════════════════════

  const CHAT_STORAGE = 'sage_chat_history';
  const CHAT_KEEP = 40;            // turns kept on disk
  const CHAT_INPUT_MAX_ROWS = 5;

  const SUGGESTIONS = [
    'when\'s my next service?',
    'how are you holding up?',
    'what have i spent on you?',
    'anything i\'m forgetting?',
  ];

  let chat = null;
  let chatBusy = false;

  function chatEls() {
    if (chat) return chat;
    chat = {
      section: document.getElementById('sage'),
      log: document.getElementById('sageChatLog'),
      form: document.getElementById('sageChatForm'),
      input: document.getElementById('sageChatInput'),
      send: document.getElementById('sageChatSend'),
      status: document.getElementById('sageChatStatus'),
      mood: document.getElementById('sageChatMood'),
      clear: document.getElementById('sageChatClear'),
      settings: document.getElementById('sageChatSettings'),
      suggest: document.getElementById('sageChatSuggest'),
    };
    return chat;
  }

  function readHistory() {
    try {
      const raw = JSON.parse(localStorage.getItem(CHAT_STORAGE) || '[]');
      return Array.isArray(raw) ? raw.filter(t => t && t.role && t.text) : [];
    } catch { return []; }
  }

  function writeHistory(turns) {
    try { localStorage.setItem(CHAT_STORAGE, JSON.stringify(turns.slice(-CHAT_KEEP))); }
    catch { /* quota — the conversation is not worth failing over */ }
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function bubble(turn) {
    const mine = turn.role === 'user';
    const time = turn.at
      ? new Date(turn.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
    return `<div class="sage-msg ${mine ? 'is-me' : 'is-sage'}">
      <p>${escapeHtml(turn.text)}</p>
      ${time ? `<time>${time}</time>` : ''}
    </div>`;
  }

  function renderChat() {
    const e = chatEls();
    if (!e.log) return;
    const turns = readHistory();

    if (!turns.length) {
      e.log.innerHTML = `<div class="sage-chat-empty">
        <img src="./assets/img/sage.webp" alt="" decoding="async" />
        <p>She's listening. Ask her about her service, her papers, or just say hello.</p>
      </div>`;
    } else {
      e.log.innerHTML = turns.map(bubble).join('');
    }
    e.log.scrollTop = e.log.scrollHeight;
    renderSuggestions(turns.length === 0);
  }

  function renderSuggestions(show) {
    const e = chatEls();
    if (!e.suggest) return;
    if (!show) { e.suggest.innerHTML = ''; return; }
    e.suggest.innerHTML = SUGGESTIONS
      .map(s => `<button type="button" class="sage-chip">${escapeHtml(s)}</button>`)
      .join('');
  }

  function appendTurn(turn) {
    const turns = readHistory();
    turns.push(turn);
    writeHistory(turns);
    renderChat();
  }

  function showThinking(on) {
    const e = chatEls();
    if (!e.log) return;
    const existing = e.log.querySelector('.sage-msg.is-thinking');
    if (!on) { existing?.remove(); return; }
    if (existing) return;
    e.log.insertAdjacentHTML('beforeend',
      `<div class="sage-msg is-sage is-thinking" aria-hidden="true">
        <p><span></span><span></span><span></span></p>
      </div>`);
    e.log.scrollTop = e.log.scrollHeight;
  }

  /** Turn a failure reason into something a person can act on. */
  function chatProblem(reason, retryInMs) {
    if (reason === 'no-key') return 'She needs a Gemini key before she can talk. Add one in settings.';
    if (reason === 'offline') return 'You are offline, so she cannot answer right now.';
    if (reason === 'backoff') {
      // Every model in the chain is resting, not just the preferred one.
      const secs = Math.max(5, Math.round((retryInMs || 0) / 1000));
      return secs < 90
        ? `All her models are busy. Try again in about ${secs} seconds.`
        : `All her models are busy. Try again in about ${Math.round(secs / 60)} minutes.`;
    }
    if (reason === 'empty') return '';
    return 'She went quiet. Try again in a moment.';
  }

  async function sendChat(text) {
    const e = chatEls();
    const AI = window.SageAI;
    const asked = String(text || '').trim();
    if (!asked || chatBusy) return;

    if (!AI) { setStatus(e.status, 'Sage is not loaded.', 'bad'); return; }

    chatBusy = true;
    if (e.send) e.send.disabled = true;
    setStatus(e.status, '');

    appendTurn({ role: 'user', text: asked, at: Date.now() });
    showThinking(true);

    // The turn just added is the question itself, so it is excluded from the
    // history Gemini sees — it arrives as the prompt instead.
    const history = readHistory().slice(0, -1).map(t => ({ role: t.role, text: t.text }));
    const result = await AI.askSage(asked, { history });

    showThinking(false);
    chatBusy = false;
    if (e.send) e.send.disabled = false;

    if (!result.ok) {
      setStatus(e.status, chatProblem(result.reason, result.retryInMs), 'bad');
      return;
    }

    appendTurn({ role: 'sage', text: result.text, at: Date.now() });
    if (result.mood) refreshChatMood(result.mood);
    e.input?.focus({ preventScroll: true });
  }

  function autoGrow(el) {
    if (!el) return;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = `${Math.min(el.scrollHeight, line * CHAT_INPUT_MAX_ROWS + 16)}px`;
  }

  const MOOD_CAPTION = {
    sleepy: 'barely awake',
    eager: 'ready to ride',
    bored: 'bored senseless',
    flirty: 'in a mood',
    clingy: 'feeling needy',
    quiet: 'half asleep',
  };

  async function refreshChatMood(known) {
    const e = chatEls();
    const S = window.SageScheduler;
    if (!e.mood || !S) return;
    let mood = known;
    if (!mood) {
      try { mood = S.moodAt(Date.now(), await S.getLimits()); } catch { mood = null; }
    }
    const caption = MOOD_CAPTION[mood];
    e.mood.textContent = caption ? `Duke 250 · ${caption}` : 'Duke 250 Gen 3';
  }

  function clearChat() {
    try { localStorage.removeItem(CHAT_STORAGE); } catch { /* ignore */ }
    renderChat();
    setStatus(chatEls().status, 'Conversation cleared.', 'ok');
  }

  function setupChat() {
    const e = chatEls();
    if (!e.form || !e.input) return;

    e.form.addEventListener('submit', ev => {
      ev.preventDefault();
      const text = e.input.value;
      e.input.value = '';
      autoGrow(e.input);
      sendChat(text);
    });

    // Enter sends, Shift+Enter makes a new line.
    e.input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        e.form.requestSubmit ? e.form.requestSubmit() : e.form.dispatchEvent(new Event('submit'));
      }
    });
    e.input.addEventListener('input', () => autoGrow(e.input));

    e.suggest?.addEventListener('click', ev => {
      const chip = ev.target.closest('.sage-chip');
      if (!chip) return;
      sendChat(chip.textContent);
    });

    e.clear?.addEventListener('click', clearChat);
    e.settings?.addEventListener('click', open);

    renderChat();
    refreshChatMood();
    console.log('[SpinLog] ✅ Sage chat ready');
  }

  /** Called when the Sage section is opened. */
  function onSageSection() {
    renderChat();
    refreshChatMood();
    const e = chatEls();
    // Don't steal focus on a touch device — it would throw the keyboard up.
    const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
    if (!coarse) setTimeout(() => e.input?.focus({ preventScroll: true }), 80);
    // A fresh conversation is a good moment to top her lines up.
    if (window.SageAI?.refreshPools) window.SageAI.refreshPools().catch(() => {});
  }

  // ══════════════════════════════════════════════════════════════════════
  // HEALTH CARD
  // Sage's weekly read on herself, on the home screen. The numbers come from
  // local data so this always renders; her prose appears on top when it can.
  // ══════════════════════════════════════════════════════════════════════

  const VERDICT_TONE = {
    'needs attention': 'is-bad',
    'something due soon': 'is-warn',
    'worth a look': 'is-warn',
    steady: 'is-ok',
  };

  let healthBusy = false;

  function healthEls() {
    return {
      card: document.getElementById('sageHealthCard'),
      word: document.getElementById('sageHealthWord'),
      flags: document.getElementById('sageHealthFlags'),
      stats: document.getElementById('sageHealthStats'),
      foot: document.getElementById('sageHealthFoot'),
      refresh: document.getElementById('sageHealthRefresh'),
    };
  }

  function inr(n) {
    if (n === null || n === undefined) return null;
    return `₹${Math.round(n).toLocaleString('en-IN')}`;
  }

  function statRow(label, value) {
    if (value === null || value === undefined || value === '') return '';
    return `<div class="sage-health-stat">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(String(value))}</dd>
    </div>`;
  }

  function renderHealth(insight) {
    const e = healthEls();
    if (!e.card) return;

    if (!insight || !insight.facts) {
      e.card.hidden = true;
      return;
    }
    const f = insight.facts;
    e.card.hidden = false;

    // Her own words when available, otherwise a plain factual line so the card
    // never looks broken just because there is no key.
    e.word.textContent = insight.prose || describeVerdict(f);
    e.word.className = `sage-health-word ${VERDICT_TONE[f.verdict] || ''}`;

    const flags = [];
    f.overdue.forEach(o => flags.push({
      tone: 'is-bad', icon: 'fa-circle-exclamation', text: `${o.what} — ${o.detail}`,
    }));
    f.upcoming.forEach(u => flags.push({
      tone: u.days <= 7 ? 'is-warn' : '',
      icon: 'fa-clock',
      text: `${u.what} in ${u.days} day${u.days === 1 ? '' : 's'}`,
    }));
    f.unusual.forEach(u => flags.push({ tone: 'is-warn', icon: 'fa-eye', text: u }));

    e.flags.innerHTML = flags.slice(0, 5).map(fl =>
      `<span class="sage-health-flag ${fl.tone}">
        <i class="fas ${fl.icon}" aria-hidden="true"></i>${escapeHtml(fl.text)}
      </span>`).join('');

    e.stats.innerHTML = [
      statRow('Services logged', f.serviceCount || null),
      statRow('Spent so far', f.totalSpend ? inr(f.totalSpend) : null),
      statRow('Average per visit', f.avgCost ? inr(f.avgCost) : null),
      statRow('Last 90 days', f.spendLast90 ? inr(f.spendLast90) : null),
      statRow('Typical gap', f.avgKmBetweenServices ? `${f.avgKmBetweenServices.toLocaleString('en-IN')} km` : null),
      statRow('Interval', f.adherence),
      statRow('Since last service', f.daysSinceLastService !== null ? `${f.daysSinceLastService} days` : null),
    ].join('');

    const bits = [];
    if (f.estimatedOdoNow) {
      bits.push(`Odometer around ${f.estimatedOdoNow.toLocaleString('en-IN')} km${f.odoIsEstimate ? ' (estimated)' : ''}`);
    }
    bits.push(`Updated ${new Date(insight.createdAt).toLocaleDateString('en-GB')}`);
    if (!insight.prose) bits.push('Add a Gemini key for Sage\'s own take');
    e.foot.textContent = bits.join(' · ');
  }

  /** Plain-language stand-in for when Sage has no key to write her own line. */
  function describeVerdict(f) {
    if (f.overdue.length) {
      return `${f.overdue.length} thing${f.overdue.length === 1 ? '' : 's'} need attention: `
        + f.overdue.map(o => `${o.what.toLowerCase()} ${o.detail}`).join('; ') + '.';
    }
    const soon = f.upcoming[0];
    if (soon && soon.days <= 7) {
      return `${soon.what} is due in ${soon.days} day${soon.days === 1 ? '' : 's'}.`;
    }
    if (f.unusual.length) return `Mostly fine, but worth a look: ${f.unusual[0]}.`;
    if (soon) return `Nothing urgent. ${soon.what} is the next thing, in ${soon.days} days.`;
    return 'Nothing outstanding. Everything logged and up to date.';
  }

  async function loadHealth(force) {
    const e = healthEls();
    const AI = window.SageAI;
    if (!e.card || !AI) return null;
    if (healthBusy) return null;

    healthBusy = true;
    if (e.refresh) e.refresh.disabled = true;
    try {
      const insight = await AI.buildHealthInsight({ force: !!force });
      renderHealth(insight);
      return insight;
    } catch {
      return null;
    } finally {
      healthBusy = false;
      if (e.refresh) e.refresh.disabled = false;
    }
  }

  function setupHealth() {
    const e = healthEls();
    if (!e.card) return;
    e.refresh?.addEventListener('click', () => loadHealth(true));
    console.log('[SpinLog] ✅ Sage health card ready');
  }

  window.SageUI = {
    open, close, isOpen, setup, load, save,
    // chat
    setupChat, renderChat, sendChat, clearChat, onSageSection, refreshChatMood,
    readHistory, writeHistory,
    // health card
    setupHealth, loadHealth, renderHealth, describeVerdict,
  };
  window.openSageSettings = open;
  window.sageOnSectionOpen = onSageSection;
  // Called by updateHomeServiceInfo() once service data has landed, so the card
  // is built from real records rather than an empty snapshot.
  window.sageRefreshHealthCard = () => loadHealth(false);

  function boot() {
    setup();
    setupChat();
    setupHealth();

    // If a refresh restored the Sage section, script.js already switched to it
    // before this file ran, so its ensureSectionData() call found no
    // sageOnSectionOpen to invoke. Pick that up here.
    if (document.getElementById('sage')?.classList.contains('active')) {
      onSageSection();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
