// ════════════════════════════════════════════════════════════════════════
// SPINLOG — SAGE UI
//
// Sage's face: the conversation, the health card, and the settings dialog —
// her memory, her key ring, when she is allowed to talk, and what about.
//
// What is in here lives in three different places, each for a reason:
//
//   the key ring      localStorage. Only the page ever needs it, and a key is
//                     not something to sync to a server.
//   the limits        IndexedDB via SageScheduler, because the service worker
//                     has to obey them too and cannot see localStorage.
//   her memory        Supabase via SageMemory, with a localStorage mirror. It
//                     is the one thing here that is his rather than a setting,
//                     so it is the one thing that follows him between devices.
//
// The settings dialog is four tabs rather than one scroll. Memory came first
// because it is now the biggest thing in the dialog and the only part of it
// that is personal data — and because burying it under the key ring meant
// nobody found the controls for it.
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
    parkTimeLimit: { name: 'Parking runs out', hint: '15 minutes before a limit you set' },
    parkingSaved: { name: 'Parking saved', hint: 'Confirmation when you park' },
    recordSaved: { name: 'Record saved', hint: 'Confirmation when you log something' },
    reEngagement: { name: 'Missing you', hint: 'After a couple of quiet days' },
    anniversary: { name: 'Anniversary', hint: 'Once a year' },
    healthInsight: { name: 'Weekly health report', hint: 'Sunday summary' },
    planReminder: { name: 'Your plans', hint: 'Something you said you would do' },
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
      heroNote: $('sageSetHeroNote'),
      // tabs
      tabs: $('sageSetTabs'),
      panels: {
        memory: $('sagePanelMemory'),
        voice: $('sagePanelVoice'),
        timing: $('sagePanelTiming'),
        alerts: $('sagePanelAlerts'),
      },
      memBadge: $('sageMemBadge'),
      // voice
      keyInput: $('sageKeyInput'),
      keyReveal: $('sageKeyReveal'),
      keyCheck: $('sageKeyCheck'),
      keyForget: $('sageKeyForget'),
      keyStatus: $('sageKeyStatus'),
      keyList: $('sageKeyList'),
      modelNote: $('sageModelNote'),
      modelChain: $('sageModelChain'),
      keyDanger: $('sageKeyDanger'),
      keyCount: $('sageKeyCount'),
      keyAddToggle: $('sageKeyAddToggle'),
      addKey: $('sageAddKey'),
      // key vault
      vaultIcon: $('sageVaultIcon'),
      vaultTitle: $('sageVaultTitle'),
      vaultState: $('sageVaultState'),
      vaultPassRow: $('sageVaultPassRow'),
      vaultPass: $('sageVaultPass'),
      vaultUnlock: $('sageVaultUnlock'),
      vaultActions: $('sageVaultActions'),
      vaultBackup: $('sageVaultBackup'),
      vaultRestore: $('sageVaultRestore'),
      vaultLock: $('sageVaultLock'),
      vaultDelete: $('sageVaultDelete'),
      vaultCheck: $('sageVaultCheck'),
      vaultReplace: $('sageVaultReplace'),

      vaultFoot: $('sageVaultFoot'),
      vaultStatus: $('sageVaultStatus'),
      usageCard: $('sageUsageCard'),
      usageState: $('sageUsageState'),
      usageMeters: $('sageUsageMeters'),
      usageFoot: $('sageUsageFoot'),
      // alerts
      permCard: $('sagePermCard'),
      permIcon: $('sagePermIcon'),
      permTitle: $('sagePermTitle'),
      permState: $('sagePermState'),
      permAllow: $('sagePermAllow'),
      permFoot: $('sagePermFoot'),
      // timing
      quietStart: $('sageQuietStart'),
      quietEnd: $('sageQuietEnd'),
      quietNote: $('sageQuietNote'),
      dailyCap: $('sageDailyCap'),
      dailyCapOut: $('sageDailyCapOut'),
      minGap: $('sageMinGap'),
      minGapOut: $('sageMinGapOut'),
      critQuiet: $('sageCritQuiet'),
      // alerts
      catList: $('sageCategoryList'),
      // memory
      memList: $('sageMemList'),
      memForget: $('sageMemForget'),
      memStatus: $('sageMemStatus'),
      memStats: $('sageMemStats'),
      memFilters: $('sageMemFilters'),
      memSearch: $('sageMemSearch'),
      memSearchClear: $('sageMemSearchClear'),
      memRecap: $('sageMemRecap'),
      memRecapText: $('sageMemRecapText'),
      memRecapFoot: $('sageMemRecapFoot'),
      memEpisodesWrap: $('sageMemEpisodesWrap'),
      memEpisodes: $('sageMemEpisodes'),
      memExport: $('sageMemExport'),
      memImport: $('sageMemImport'),
      memImportFile: $('sageMemImportFile'),
      // sync
      syncPill: $('sageSyncPill'),
      syncPillText: $('sageSyncPillText'),
      syncCard: $('sageSyncCard'),
      syncIcon: $('sageSyncIcon'),
      syncTitle: $('sageSyncTitle'),
      syncState: $('sageSyncState'),
      syncNow: $('sageSyncNow'),
      syncStatus: $('sageSyncStatus'),
      // Restore IS the chooser now. There is no separate Pick button: "take
      // everything" answers "nothing new" on a device that is already in step,
      // which is a button that does nothing, and the useful work was hidden behind
      // a second segment.
      memRestore: $('sageMemRestore'),

      // selective restore

      memPick: $('sageMemPick'),
      memPickTitle: $('sageMemPickTitle'),
      memPickClose: $('sageMemPickClose'),
      memPickAll: $('sageMemPickAll'),
      memPickNone: $('sageMemPickNone'),
      memPickCount: $('sageMemPickCount'),
      memPickList: $('sageMemPickList'),
      memPickGo: $('sageMemPickGo'),
      memPickKill: $('sageMemPickKill'),
      // footer
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

  /**
   * Ask before destroying something, through the app's one slide dialog.
   *
   * Everything in here used to arm itself on the first press and act on the
   * second, with a five-second window and the button relabelling itself to say
   * so. Three separate copies of that, three sets of module-level flags and
   * timers, and open() and close() both had to remember to disarm all three or a
   * stale armed button would fire on the next single press.
   *
   * The slide replaces all of it. It is one deliberate gesture rather than two
   * ambiguous presses, it cannot be left armed behind a closed dialog, and it
   * says what will happen in a sentence instead of a five-word button label.
   *
   * Answers false when the dialog is missing, so a stale cached build refuses to
   * delete rather than deleting without asking.
   */
  function askSlide(options) {
    const C = window.SageConfirm;
    if (!C || typeof C.slide !== 'function') {
      console.warn('[SpinLog] Slide-to-delete is not loaded, so the action was refused.');
      return Promise.resolve(false);
    }
    return C.slide(options);
  }

  // Segmented pills (.sage-seg) need no controller. They are plain buttons in a
  // shared rounded container, so there is nothing to open, close, position or
  // trap focus in — which is the point. The split buttons they replaced needed a
  // menu controller, a viewport-collision check, arrow-key navigation and two
  // extra branches in the dialog's Escape and Tab handling, all so that the one
  // action available on a locked vault could sit behind an unlabelled chevron.

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

  // ══ Tabs ═════════════════════════════════════════════════════════════

  const TABS = ['memory', 'voice', 'timing', 'alerts'];
  let activeTab = 'memory';

  /**
   * Show one panel.
   *
   * `hidden` does the hiding rather than a class, so the browser takes the
   * inactive panels out of the tab order for us — which matters because the
   * focus trap below walks every focusable element in the dialog.
   */
  function showTab(name) {
    const e = cache();
    const wanted = TABS.indexOf(name) === -1 ? 'memory' : name;
    activeTab = wanted;

    TABS.forEach(tab => {
      const panel = e.panels[tab];
      const button = e.tabs?.querySelector(`[data-sage-tab="${tab}"]`);
      const on = tab === wanted;
      if (panel) {
        // The outgoing panel lifts out while the incoming one drops in, so the two
        // read as a pair moving past each other rather than one blinking off and the
        // next blinking on. sagePanelIn was already doing the arrival half.
        if (on) {
          // sagePanelIn in styles.css already plays the arrival, so this only has
          // to make the element present — animating it here as well would run two
          // things over each other.
          if (window.dkCancelMotionFor) window.dkCancelMotionFor(panel);
          panel.hidden = false;
        } else if (window.dkSlideShut && !panel.hidden) {
          window.dkSlideShut(panel, 120, { y: '-6px' });
        } else {
          panel.hidden = true;
        }
        panel.classList.toggle('is-on', on);
      }
      if (button) {
        button.classList.toggle('is-on', on);
        button.setAttribute('aria-selected', String(on));
        // Roving tabindex: one stop for the whole rail, arrows move within it.
        button.tabIndex = on ? 0 : -1;
      }
    });

    // A tall memory list left the next panel scrolled halfway down.
    const body = e.modal?.querySelector('.sage-settings-body');
    if (body) body.scrollTop = 0;
  }

  /** Left/right arrows move between tabs, which is what a tablist promises. */
  function onTabKeydown(ev) {
    const step = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    ev.preventDefault();
    const at = TABS.indexOf(activeTab);
    const next = TABS[(at + step + TABS.length) % TABS.length];
    showTab(next);
    cache().tabs?.querySelector(`[data-sage-tab="${next}"]`)?.focus();
  }

  // ══ Memory ═══════════════════════════════════════════════════════════

  // What the list is currently narrowed to. Held here rather than read back off
  // the DOM so a repaint triggered by a background sync cannot lose it.
  let memQuery = '';
  let memKind = '';

  const KIND_LABEL = {
    promise: 'promises',
    plan: 'plans',
    person: 'people',
    preference: 'likes',
    feeling: 'feelings',
    ride: 'riding',
    fact: 'facts',
  };

  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : (many || `${one}s`)}`;
  }

  function daysWord(days) {
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 14) return `${days} days ago`;
    if (days < 60) return `${Math.round(days / 7)} weeks ago`;
    return `${Math.round(days / 30)} months ago`;
  }

  function daysSince(at) {
    if (!at) return null;
    return Math.max(0, Math.floor((Date.now() - Number(at)) / 86400000));
  }

  /** Four figures, chosen as the ones that answer "what does she actually have". */
  function renderMemoryStats(stats) {
    const e = cache();
    if (!e.memStats) return;
    if (!stats || !stats.total) { e.memStats.innerHTML = ''; return; }

    const rel = window.SageMemory?.relationship();
    const cells = [
      { label: 'Remembers', value: stats.total, accent: true },
      { label: 'Pinned', value: stats.pinned },
      { label: 'Talks', value: stats.episodes || (rel?.conversations ?? 0) },
      { label: 'Known', value: rel?.knownDays ? `${rel.knownDays}d` : '—' },
    ];

    e.memStats.innerHTML = cells.map(c => `<dl class="sage-stat${c.accent ? ' is-accent' : ''}">
      <dt>${escapeHtml(c.label)}</dt>
      <dd>${escapeHtml(String(c.value))}</dd>
    </dl>`).join('');
  }

  /** Her rolling note, shown so nothing she keeps about him is hidden from him. */
  function renderRecap(state) {
    const e = cache();
    if (!e.memRecap) return;
    const text = state?.recap?.text;
    if (!text) { e.memRecap.hidden = true; return; }

    e.memRecap.hidden = false;
    e.memRecapText.textContent = text;
    const days = daysSince(state.recap.at);
    e.memRecapFoot.textContent = days === null
      ? ''
      : `Written ${daysWord(days)}, from conversations too old for her to still see.`;
  }

  /**
   * Filter chips, built from what is actually in the bank.
   *
   * Offering a filter for a kind she has nothing of is how you get an empty list
   * and no idea why, so the chips are generated from the counts rather than from
   * the list of possible kinds.
   */
  function renderMemoryFilters(stats) {
    const e = cache();
    if (!e.memFilters) return;
    if (!stats || !stats.total) { e.memFilters.innerHTML = ''; return; }

    const kinds = Object.keys(stats.byKind || {})
      .sort((a, b) => stats.byKind[b] - stats.byKind[a]);

    const chip = (value, label, count, on) =>
      `<button type="button" class="sage-filter-chip${on ? ' is-on' : ''}"
               data-mem-kind="${escapeHtml(value)}" aria-pressed="${on}">
        ${escapeHtml(label)}${count === null ? '' : ` <b>${count}</b>`}
      </button>`;

    const parts = [chip('', 'All', stats.total, !memKind)];
    if (stats.pinned) parts.push(chip('__pinned', 'Pinned', stats.pinned, memKind === '__pinned'));
    kinds.forEach(k => parts.push(chip(k, KIND_LABEL[k] || k, stats.byKind[k], memKind === k)));

    e.memFilters.innerHTML = parts.join('');
  }

  /** One memory. The sentence leads; everything else is metadata beneath it. */
  function memoryRow(f) {
    const meta = [`<span class="sage-mem-kind">${escapeHtml(f.kind || 'fact')}</span>`];
    if (f.topic && f.topic !== 'general') {
      meta.push(`<span class="sage-mem-dot">·</span><span>${escapeHtml(f.topic)}</span>`);
    }
    const age = daysSince(f.at);
    if (age !== null) {
      meta.push(`<span class="sage-mem-dot">·</span><span>${escapeHtml(daysWord(age))}</span>`);
    }
    if (f.hits) {
      meta.push(`<span class="sage-mem-dot">·</span><span>mentioned ${f.hits + 1}×</span>`);
    }
    // A plan he has not got to yet reads very differently from one long past.
    if (f.expiresAt && f.expiresAt > Date.now()) {
      meta.push('<span class="sage-mem-dot">·</span><span class="sage-mem-ahead">still ahead</span>');
    }
    if ((f.confidence ?? 1) < 0.6) {
      meta.push('<span class="sage-mem-dot">·</span><span class="sage-mem-unsure">not sure</span>');
    }

    const pinned = !!f.pinned;
    const id = escapeHtml(f.id);
    const safe = escapeHtml(f.text);

    return `<div class="sage-mem-item${pinned ? ' is-pinned' : ''}">
      <span class="sage-mem-text">${safe}</span>
      <span class="sage-mem-meta">${meta.join('')}</span>
      <button type="button" class="sage-icon-btn sage-mem-pin" data-mem-pin="${id}"
              aria-pressed="${pinned}"
              title="${pinned ? 'Let her forget this normally' : 'Never let her forget this'}"
              aria-label="${pinned ? 'Unpin' : 'Pin'}: ${safe}">
        <i class="fas fa-thumbtack" aria-hidden="true"></i>
      </button>
      <button type="button" class="sage-icon-btn sage-mem-remove" data-mem-id="${id}"
              title="Make her forget this" aria-label="Make her forget: ${safe}">
        <i class="fas fa-xmark" aria-hidden="true"></i>
      </button>
    </div>`;
  }

  function emptyState(icon, message) {
    return `<p class="sage-mem-empty">
      <i class="fas ${icon}" aria-hidden="true"></i>${message}
    </p>`;
  }

  /** Her conversation timeline. Counted locally, so it costs no quota. */
  function renderEpisodes() {
    const e = cache();
    const M = window.SageMemory;
    if (!e.memEpisodes || !e.memEpisodesWrap) return;

    const list = M ? M.episodes(8) : [];
    // One conversation is not a timeline, it is the conversation you are in.
    if (list.length < 2) { e.memEpisodesWrap.hidden = true; return; }

    e.memEpisodesWrap.hidden = false;
    e.memEpisodes.innerHTML = list.map(ep => {
      const about = ep.topics?.length ? ep.topics.join(', ') : 'nothing in particular';
      const mins = Math.max(1, Math.round((ep.endedAt - ep.startedAt) / 60000));
      return `<li>
        <time>${escapeHtml(daysWord(daysSince(ep.endedAt)))}</time>
        ${escapeHtml(plural(ep.messages, 'message'))} over ${escapeHtml(plural(mins, 'minute'))}
        <em>— ${escapeHtml(about)}</em>
      </li>`;
    }).join('');
  }

  /** Everything she has written down about him, most important first. */
  function renderMemory() {
    const e = cache();
    const M = window.SageMemory;
    if (!e.memList) return;

    if (!M) {
      e.memList.innerHTML = emptyState('fa-triangle-exclamation', 'Her memory is not loaded.');
      return;
    }

    const state = M.read();
    const stats = M.stats();
    const rel = M.relationship();

    renderMemoryStats(stats);
    renderRecap(state);
    renderMemoryFilters(stats);
    renderEpisodes();
    renderSync();

    if (e.memBadge) {
      e.memBadge.hidden = !stats.total;
      e.memBadge.textContent = String(stats.total);
    }

    // Searching goes through her own retrieval rather than a substring match, so
    // the panel finds a memory the same way she does.
    let list = memQuery
      ? M.recall(memQuery)
      : M.facts(memKind === '__pinned' ? { pinned: true } : { kind: memKind || undefined });

    if (memQuery && memKind) {
      list = memKind === '__pinned'
        ? list.filter(f => f.pinned)
        : list.filter(f => f.kind === memKind);
    }

    if (!list.length) {
      // Three different nothings, and telling them apart is the whole value of
      // the message: she is new, the filter is too narrow, or the search missed.
      if (memQuery) {
        e.memList.innerHTML = emptyState('fa-magnifying-glass',
          `Nothing she remembers matches “${escapeHtml(memQuery)}”.`);
      } else if (memKind) {
        e.memList.innerHTML = emptyState('fa-filter', 'Nothing of that kind yet.');
      } else if (rel) {
        e.memList.innerHTML = emptyState('fa-feather',
          'Nothing written down yet — she picks things up as you talk.');
      } else {
        e.memList.innerHTML = emptyState('fa-comment-dots',
          'Nothing yet. Say something to her and she will start remembering.');
      }
    } else {
      e.memList.innerHTML = list.map(memoryRow).join('');
    }

    // The status line answers "how much of this am I looking at", which only
    // needs saying when it is not all of it.
    if (memQuery || memKind) {
      setStatus(e.memStatus, `Showing ${plural(list.length, 'memory', 'memories')} of ${stats.total}.`);
    } else if (rel && rel.knownDays >= 1) {
      setStatus(e.memStatus,
        `${plural(stats.total, 'thing')} remembered · `
        + `${plural(rel.messages, 'message')} over ${plural(rel.knownDays, 'day')}.`);
    } else {
      setStatus(e.memStatus, '');
    }
  }

  function setMemoryFilter(kind) {
    memKind = memKind === kind ? '' : kind;
    renderMemory();
  }

  function setMemoryQuery(text) {
    const e = cache();
    memQuery = String(text || '').trim();
    if (e.memSearchClear) e.memSearchClear.hidden = !memQuery;
    renderMemory();
  }

  /**
   * Forget one thing. A soft delete, and the status line now says so.
   *
   * The row stays in the table with archived_at set, because that is what makes
   * the forget reach his other devices instead of being pushed straight back up
   * by the next one to sync. The consequence is that this is reversible and the
   * memory is still in the database, which is worth saying out loud — the panel
   * used to report "Forgotten: …" and leave you to discover both facts later.
   */
  async function forgetOneMemory(id) {
    const e = cache();
    const M = window.SageMemory;
    if (!M) return;
    const fact = M.facts().find(f => f.id === id);
    M.forget(id);
    renderMemory();
    if (fact) {
      setStatus(e.memStatus,
        `Forgotten: “${fact.text}” — still in the cloud, so Pick can bring it back `
        + 'or delete it for good.', 'warn');
    }

    // Push now rather than on commit()'s 1.5s debounce, then re-read. Without
    // this the Forgotten count in the facts row above is a second and a half
    // behind the list, and the two disagreeing is exactly the bug this panel
    // exists to make impossible.
    await M.push().catch(() => {});
    await refreshMemCloud();
  }

  function pinOneMemory(id) {
    const M = window.SageMemory;
    if (!M) return;
    const fact = M.facts().find(f => f.id === id);
    if (!fact) return;
    M.pin(id, !fact.pinned);
    renderMemory();
    setStatus(cache().memStatus,
      fact.pinned ? 'Unpinned. It can fade like anything else now.'
                  : 'Pinned. She will never let go of that one.',
      'ok');
  }

  /**
   * Wipe everything.
   *
   * This removes the cloud copy too, unlike anything else here, so there is
   * genuinely nothing to undo it with. The count goes in the question: "forget
   * everything" is abstract, "forget the 34 things she knows about you" is not.
   *
   * THE CONVERSATION GOES WITH IT. It used to be left behind, on the reasoning
   * that a transcript is not a memory and the chat header has its own clear
   * button. That reasoning does not survive contact with her own controls:
   * search_conversation reads those rows, so she could still recite what he had
   * just asked her to forget, and consolidate() writes a recap from them, so the
   * next conversation would rebuild her memory out of the transcript that
   * survived the wipe. "Forget everything" that leaves the record of everything
   * is not forgetting, it is tidying the index.
   *
   * Park spots and settings stay. Where he left the bike is not something she
   * knows about him, and his purchase-date override is configuration.
   */
  async function forgetAllMemory() {
    const e = cache();
    const M = window.SageMemory;
    if (!M) return;

    const held = M.count();
    const said = window.dkCloudStore?.chatHistory().length || 0;

    // EVERY ROW OF HERS, not just the live facts.
    //
    // This used to gate on count() alone, which counts live facts and nothing
    // else — so it refused to run in exactly the state that needs it most. Delete
    // every memory through the chooser and the table is still holding the
    // relationship counters, the conversation episodes, her recap and every
    // archived fact; count() reports 0, the button said "there is nothing to
    // forget yet", and there was no way left to clear any of it.
    //
    // Local state answers this for this device, and remoteSummary() answers it for
    // the table — which matters when the leftovers were written on his other
    // phone. Either one being non-zero is reason enough to offer the wipe.
    const localRows = (() => {
      if (!M.read) return held;
      const st = M.read();
      return (st.facts?.length || 0)
        + (st.episodes?.length || 0)
        + (st.recap?.text ? 1 : 0)
        + (st.rel?.firstSeenAt ? 1 : 0);
    })();
    const cloudRows = memCloud ? (memCloud.rows || 0) : 0;

    if (!localRows && !cloudRows && !said) {
      setStatus(e.memStatus, 'There is nothing to forget yet.', 'warn');
      return;
    }

    // Name what is actually going, which is the whole reason the count alone was
    // not enough. With no live memories left, "clear everything she is holding"
    // over an empty list reads as a dialog with nothing to do — so in that case it
    // says what the leftovers ARE. It still never lists what it leaves alone: a
    // forget dialog that says what it will not touch invites you to wonder what
    // else it might.
    const going = [];
    if (held) going.push(`the ${held} thing${held === 1 ? '' : 's'} she knows`);
    if (said) going.push('your whole conversation');
    if (!held) {
      const st = M.read ? M.read() : null;
      const archived = st ? st.facts.filter(f => f.archivedAt).length : 0;
      const talks = st?.episodes?.length || 0;
      if (archived) going.push(`${archived} forgotten note${archived === 1 ? '' : 's'}`);
      if (talks) going.push(`${talks} logged conversation${talks === 1 ? '' : 's'}`);
      if (st?.recap?.text) going.push('her own recap');
      if (st?.rel?.firstSeenAt) going.push('how long you have known each other');
      // Rows only another device knows about. Named vaguely on purpose — this
      // count comes from the table, so it cannot say what they are.
      if (!going.length && cloudRows) {
        going.push(`${cloudRows} row${cloudRows === 1 ? '' : 's'} still in the cloud`);
      }
    }

    const ok = await askSlide({
      title: held
        ? (held === 1 ? 'Forget what she knows about you?' : `Forget all ${held} things she knows?`)
        : 'Clear everything she is still holding?',
      message: `${going.length ? going.join(', ') : 'Everything of hers'} — `
        + 'gone here and in the cloud. Nothing brings it back.',
      label: 'Slide to forget',
      confirmed: 'Forgetting…',
      icon: 'fa-eraser',
    });
    if (!ok) {
      setStatus(e.memStatus, 'Left alone. She still remembers everything.', 'ok');
      return;
    }

    setStatus(e.memStatus, 'Forgetting…');
    // Awaited. It used to fire and forget, so refreshMemCloud() below read the
    // cloud back BEFORE the delete had landed and reported counts from rows that
    // were about to disappear — which is half of why this looked like it only
    // worked on screen.
    const wiped = await M.clear();
    // Deletes by record_type, so it takes the turns this device never saw as well.
    const chatGone = said ? await window.dkCloudStore?.clearChat() : true;
    if (said) renderChat();

    memQuery = '';
    memKind = '';
    if (e.memSearch) e.memSearch.value = '';
    renderMemory();
    await refreshMemCloud();

    if (wiped.pending || chatGone === false) {
      techNote('memory clear', wiped.reason || 'conversation rows refused');
      setStatus(e.memStatus, wipeTrouble(wiped.pending ? wiped : null, 'Forgotten'), 'warn');
      return;
    }
    setStatus(e.memStatus, 'Forgotten. She starts again from nothing.', 'warn');
  }

  // ══ Export / import ══════════════════════════════════════════════════

  function exportMemory() {
    const e = cache();
    const M = window.SageMemory;
    if (!M) return;

    const dump = M.exportAll();
    if (!dump.facts.length && !dump.recap) {
      setStatus(e.memStatus, 'Nothing to export yet.', 'warn');
      return;
    }

    try {
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sage-memory-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      // Revoked on a delay: revoking immediately cancels the download in Safari.
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setStatus(e.memStatus, `Exported ${plural(dump.facts.length, 'memory', 'memories')}.`, 'ok');
    } catch {
      setStatus(e.memStatus, 'Could not build the export file.', 'bad');
    }
  }

  async function importMemory(file) {
    const e = cache();
    const M = window.SageMemory;
    if (!M || !file) return;

    try {
      const text = await file.text();
      const result = M.importAll(text);
      if (!result.ok) {
        const why = {
          unreadable: 'That file is not readable JSON.',
          'not-mine': 'That is not one of her memory exports.',
        }[result.reason] || 'That file could not be imported.';
        setStatus(e.memStatus, why, 'bad');
        return;
      }
      renderMemory();
      setStatus(e.memStatus,
        result.added
          ? `Imported ${plural(result.added, 'memory', 'memories')}. She already knew the rest.`
          : 'Nothing new in that file — she already knew all of it.',
        'ok');
    } catch {
      setStatus(e.memStatus, 'Could not read that file.', 'bad');
    } finally {
      if (e.memImportFile) e.memImportFile.value = '';
    }
  }

  // ══ Sync state ═══════════════════════════════════════════════════════

  /**
   * Where her memory is, in one line.
   *
   * Plain language only. Every branch here used to name the SQL file to run, the
   * table, the missing column or the row-level security policy — accurate, and a
   * developer's error log printed into a settings panel. The cause still gets
   * reported in full, to the console, where it belongs: see techNote() below.
   */
  function describeSync(state, stats) {
    // Every icon below is Font Awesome 6 *Free*. cloud-slash and
    // cloud-exclamation would read better and are Pro only, so they render as
    // nothing at all on this kit — which is worse than a less apt glyph.
    if (!state) {
      return { tone: null, icon: 'fa-triangle-exclamation', pill: 'Unavailable', line: 'Her memory is not loaded yet.' };
    }

    if (!state.hasClient) {
      return {
        tone: 'warn', icon: 'fa-hard-drive', pill: 'Waiting',
        line: 'She cannot reach her memory right now. Nothing is lost.',
      };
    }
    // Schema and policy failures are the owner's to fix, not something to explain
    // in a settings panel. One honest sentence here; the fix goes to the console.
    if (state.lastError === 'schema' || /row.level security|permission denied|column .* does not exist|mem_key/i.test(state.lastError || '')) {
      techNote('memory', state.lastError);
      return {
        tone: 'bad', icon: 'fa-database', pill: 'Needs setup',
        line: 'Her memory bank is not ready yet, so nothing is being saved.',
      };
    }
    if (!state.lastPullAt && !state.lastPushAt) {
      return {
        tone: 'warn', icon: 'fa-cloud-arrow-up', pill: 'Not saved yet',
        line: state.online
          ? 'She has not reached her memory bank yet.'
          : 'Offline. She will save herself when you are back.',
      };
    }
    if (!state.online) {
      return {
        tone: 'warn', icon: 'fa-hard-drive', pill: 'Offline',
        line: state.pending
          ? `${plural(state.pending, 'change')} waiting. They go up when you are back online.`
          : 'Offline, but everything she knows is already saved.',
      };
    }
    if (state.pending) {
      return {
        tone: 'warn', icon: 'fa-cloud-arrow-up', pill: 'Saving',
        line: `${plural(state.pending, 'change')} still to save.`,
      };
    }
    if (state.lastError) {
      techNote('memory', state.lastError);
      return {
        tone: 'bad', icon: 'fa-triangle-exclamation', pill: 'Problem',
        line: 'Her last save did not go through. She will try again.',
      };
    }

    const saved = daysSince(state.lastPushAt || state.lastPullAt);
    return {
      tone: 'ok', icon: 'fa-circle-check', pill: 'Saved',
      line: `${plural(stats?.total ?? 0, 'memory', 'memories')} saved`
        + `${saved === null ? '' : `, last ${daysWord(saved)}`}. `
        + 'She will still know you on a new phone.',
    };
  }

  /**
   * The technical cause, to the console, once per distinct message.
   *
   * The settings panel is not a log viewer. It used to print the SQL filename to
   * run, the missing column and the name of the row-level security policy —
   * which is the right information for exactly one person and noise for the
   * screen it was on. None of it is lost, it just moved somewhere a panel does
   * not have to read like a stack trace.
   *
   * Deduplicated because renderSync() runs on every repaint, and a sync problem
   * would otherwise fill the console with the same line a hundred times.
   */
  const techSeen = new Set();

  function techNote(what, detail) {
    if (!detail) return;
    const line = `${what}: ${detail}`;
    if (techSeen.has(line)) return;
    techSeen.add(line);
    console.warn(`[SpinLog] ⚙️ ${line}`
      + ' — run the matching file in supabase/ once if this persists.');
  }

  /**
   * Why a wipe did not finish, in words he can do something about.
   *
   * Every unfinished wipe used to say the same thing — "the saved copy goes when
   * the connection is back" — and for a refused delete that is simply false.
   * Nothing retries it, so the rows are still there next week, which is how a lone
   * `relationship counters` row came to look like the app lying about its own
   * delete. It partly was: a delete with no matching policy affects zero rows and
   * returns NO error, so success was the only thing it could report. It reads the
   * table back now, and this turns what it found into a sentence.
   *
   * @param {{reason?:string, left?:number}|null} result
   * @param {string} verb Past tense, for the local half that did work — the local
   *   copy is genuinely gone either way.
   */
  function wipeTrouble(result, verb) {
    const reason = (result && result.reason) || '';
    const here = `${verb} here.`;
    if (reason === 'no-delete-policy') {
      const n = result.left;
      const rows = n ? ` ${n} row${n === 1 ? '' : 's'} still there.` : '';
      return `${here} The database refused the delete.${rows}`
        + ' Run supabase/cloud_routing.sql once, then try again.';
    }
    if (reason === 'no-table') {
      return `${here} Her cloud table does not exist yet — run supabase/sage_memory.sql.`;
    }
    if (reason === 'no-client' || reason === 'offline') {
      return `${here} The saved copy goes when the connection is back.`;
    }
    return `${here} The saved copy could not be reached.`;
  }

  function renderSync() {
    const e = cache();
    const M = window.SageMemory;
    const state = M ? M.syncState() : null;
    const stats = M ? M.stats() : null;
    const view = describeSync(state, stats);

    if (e.syncPill) {
      e.syncPill.classList.remove('is-ok', 'is-warn', 'is-bad', 'is-busy');
      if (view.tone) e.syncPill.classList.add(`is-${view.tone}`);
      if (state?.syncing) e.syncPill.classList.add('is-busy');
      // While syncing it becomes a drawn ring rather than a spun glyph, for the
      // same reason the step spinner did — see .sl-spinner in styles.css.
      e.syncPill.querySelector('i')?.setAttribute('class',
        state?.syncing ? 'sl-spinner' : `fas ${view.icon}`);
      if (e.syncPillText) e.syncPillText.textContent = state?.syncing ? 'Syncing…' : view.pill;
    }

    if (e.syncIcon) {
      e.syncIcon.className = `sage-sync-icon${view.tone ? ` is-${view.tone}` : ''}`;
      e.syncIcon.innerHTML = `<i class="fas ${view.icon}" aria-hidden="true"></i>`;
    }
    if (e.syncState) e.syncState.textContent = view.line;
    if (e.syncTitle) {
      e.syncTitle.textContent = view.tone === 'ok' ? 'Memory bank · cloud' : 'Memory bank';
    }
  }

  // What the cloud holds for her memory. null = not looked yet.
  let memCloud = null;

  /** Read the cloud side without pulling, so the panel can show real numbers. */
  async function refreshMemCloud() {
    const M = window.SageMemory;
    if (!M || !M.remoteSummary) { memCloud = null; return; }
    memCloud = await M.remoteSummary().catch(() => null);
    renderMemCloudFacts();
  }

  /**
   * What the cloud is holding, expressed on the Pick button rather than as a
   * table of figures.
   *
   * There used to be a four-cell readout here: In the cloud / On this device /
   * Forgotten / Restorable. It was added to tell an empty memory bank apart from
   * an unreachable one, and it did that — but four raw counts in the middle of a
   * settings panel is instrumentation, and the same information reads better as
   * "3 memories to bring back or delete" on the button that acts on them.
   */
  function renderMemCloudFacts() {
    const e = cache();
    const M = window.SageMemory;
    if (!M) return;

    const forgotten = memCloud ? (memCloud.archivedFacts || 0) : 0;
    const waiting = memCloud === null ? null : (memCloud.missingHere || 0) + forgotten;

    if (e.memRestore) {
      e.memRestore.title = waiting === null
        ? 'See what is saved, bring it back or delete it'
        : (waiting
          ? `${plural(waiting, 'memory', 'memories')} to bring back or delete for good`
          : 'Nothing saved that she does not already know');
      // A dot on the button when there is something worth opening it for. This is
      // what the four raw counts were actually for.
      e.memRestore.classList.toggle('has-more', !!waiting);
    }

    // The one case worth a sentence: rows exist but she remembers none of them,
    // which without explanation reads as a bug rather than as a record of things
    // deliberately forgotten.
    if (memCloud && memCloud.rows && !memCloud.facts && forgotten) {
      setStatus(e.syncStatus,
        `She remembers nothing right now, but ${plural(forgotten, 'memory', 'memories')} `
        + 'can still be brought back. Press Pick.',
        'warn');
    }
  }

  // "Recover forgotten" used to be its own button here.
  //
  // It is gone, and the chooser below does the job. The reason is that recovering
  // a forgotten memory and destroying one are the two halves of the same
  // decision: you look at the list to work out which of the two you want. Two
  // separate controls in two places meant the panel could offer to bring
  // something back while having nowhere to say "no, get rid of it".

  // ══ The chooser ══════════════════════════════════════════════════════
  //
  // "Restore everything" is the right default and the wrong only option.
  //
  // The cloud copy is shared between devices and accumulates over months, so it
  // can hold one thing she got wrong next to thirty she got right. A device
  // coming back from a wipe should not have to take the mistake to get the rest,
  // and there was no way to say "those, not that one".
  //
  // Two lists, because they come back by two different routes: live facts this
  // device lacks (restore) and archived ones (recoverForgotten). Keeping them in
  // one list would mean hiding the fact that a forgotten memory is a deliberate
  // decision being reversed, which is the one thing worth flagging.

  // Keys the user has ticked, and what listRemote() last returned for them.
  let pickChosen = new Set();
  let pickRows = { restorable: [], forgotten: [] };

  function pickRow(entry, forgotten) {
    const key = escapeHtml(entry.key);
    const on = pickChosen.has(entry.key);
    const bits = [escapeHtml(entry.kind || 'fact')];
    if (entry.topic && entry.topic !== 'general') bits.push(escapeHtml(entry.topic));
    const age = daysSince(entry.at);
    if (age !== null) bits.push(escapeHtml(daysWord(age)));
    if (forgotten) bits.push('<span class="is-forgotten">forgotten</span>');

    return `<label class="sage-pick-row${on ? ' is-on' : ''}">
      <input type="checkbox" data-pick-key="${key}"${on ? ' checked' : ''} />
      <span>
        <span class="sage-pick-text">${escapeHtml(entry.text)}</span>
        <span class="sage-pick-meta">${bits.join(' · ')}</span>
      </span>
    </label>`;
  }

  /** Build the list. Only on open and after an action — see syncMemPickState. */
  function renderMemPick() {
    const e = cache();
    if (!e.memPickList) return;

    const { restorable, forgotten } = pickRows;
    const total = restorable.length + forgotten.length;

    if (!total) {
      // Reached by pressing Restore on a device that is already in step, which is
      // most of the time. It has to say that plainly rather than showing an empty
      // box — the old separate Restore button's whole failing was answering
      // "nothing to do" in a way that looked like it was broken.
      e.memPickList.innerHTML = `<p class="sage-pick-empty">
        <i class="fas fa-circle-check" aria-hidden="true"></i>
        Nothing to bring back — she already knows everything that is saved.
      </p>`;
    } else {
      const parts = [];
      if (restorable.length) {
        parts.push('<p class="sage-pick-group">In the cloud, not on this device</p>');
        parts.push(restorable.map(entry => pickRow(entry, false)).join(''));
      }
      if (forgotten.length) {
        parts.push('<p class="sage-pick-group">Forgotten — bringing these back undoes that</p>');
        parts.push(forgotten.map(entry => pickRow(entry, true)).join(''));
      }
      e.memPickList.innerHTML = parts.join('');
    }
    syncMemPickState();
  }

  /**
   * Bring the rows, the count and the buttons in line with what is ticked,
   * without rebuilding the list.
   *
   * Ticking a box used to re-render the whole thing, which threw away the
   * checkbox that was just clicked along with the scroll position — so on a cloud
   * copy of forty memories, every tick jumped the list back to the top and lost
   * the keyboard's place in it.
   */
  function syncMemPickState() {
    const e = cache();
    if (!e.memPickList) return;
    const total = pickRows.restorable.length + pickRows.forgotten.length;

    e.memPickList.querySelectorAll('input[data-pick-key]').forEach(box => {
      const on = pickChosen.has(box.dataset.pickKey);
      // Assigning unconditionally would fight the browser on the very box the
      // user just clicked, so only correct it when it actually disagrees.
      if (box.checked !== on) box.checked = on;
      box.closest('.sage-pick-row')?.classList.toggle('is-on', on);
    });

    if (e.memPickCount) {
      e.memPickCount.textContent = total ? `${pickChosen.size} of ${total} chosen` : '';
    }
    if (e.memPickGo) {
      e.memPickGo.disabled = !pickChosen.size;
      e.memPickGo.innerHTML = '<i class="fas fa-cloud-arrow-down" aria-hidden="true"></i> '
        + (pickChosen.size ? `Bring back ${pickChosen.size}` : 'Bring back');
    }
    if (e.memPickKill) {
      e.memPickKill.disabled = !pickChosen.size;
      e.memPickKill.innerHTML = '<i class="fas fa-trash-can" aria-hidden="true"></i> '
        + (pickChosen.size ? `Delete ${pickChosen.size} for good` : 'Delete for good');
    }
    if (e.memPickAll) e.memPickAll.disabled = !total || pickChosen.size === total;
    if (e.memPickNone) e.memPickNone.disabled = !pickChosen.size;
  }

  function closeMemPick() {
    const e = cache();
    // Fades and lifts out rather than blinking off. sagePickIn already handled the
    // arrival; `hidden` landing in the same frame as the class removal is what left
    // it with no departure. The state below is cleared immediately either way —
    // reopening to find a stale selection waiting is how you delete the wrong thing.
    if (e.memPick) {
      if (window.dkSlideShut) window.dkSlideShut(e.memPick, 130, { y: '-6px' });
      else e.memPick.hidden = true;
    }
    pickChosen = new Set();
    pickRows = { restorable: [], forgotten: [] };
  }

  /** Open the chooser and fill it from the cloud. */
  async function openMemPick() {
    const e = cache();
    const M = window.SageMemory;
    if (!e.memPick) return;

    if (!M || !M.listRemote) {
      setStatus(e.syncStatus,
        'Her memory bank is not available yet. Reload and try again.', 'bad');
      return;
    }

    e.memPick.hidden = false;
    pickChosen = new Set();
    pickRows = { restorable: [], forgotten: [] };
    e.memPickList.innerHTML = `<p class="sage-pick-empty">
      <i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i> Reading the cloud…
    </p>`;
    setStatus(e.syncStatus, '');

    const listed = await M.listRemote();
    if (!listed.ok) {
      e.memPick.hidden = true;
      setStatus(e.syncStatus, memProblem(listed.reason), 'bad');
      return;
    }

    pickRows = { restorable: listed.restorable, forgotten: listed.forgotten };
    renderMemPick();
    // Straight to the list rather than to the top of the panel: the chooser can
    // open below the fold on a phone.
    e.memPick.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function toggleMemPick(key, on) {
    if (on) pickChosen.add(key);
    else pickChosen.delete(key);
    syncMemPickState();
  }

  function selectAllMemPick(on) {
    pickChosen = on
      ? new Set([...pickRows.restorable, ...pickRows.forgotten].map(entry => entry.key))
      : new Set();
    syncMemPickState();
  }

  /** Bring back exactly what was ticked, and nothing else. */
  async function runMemPick() {
    const e = cache();
    const M = window.SageMemory;
    if (!M || !pickChosen.size) return;

    // Split by route. A forgotten fact needs its archive flag cleared; a fact
    // this device simply never saw only needs merging in. Sending either down the
    // other path silently does nothing, which is how "restore not working" looked
    // before listRemote() existed to tell them apart.
    const live = pickRows.restorable.filter(entry => pickChosen.has(entry.key)).map(r => r.key);
    const dead = pickRows.forgotten.filter(entry => pickChosen.has(entry.key)).map(r => r.key);

    e.memPickGo.disabled = true;
    setStatus(e.syncStatus, 'Bringing them back…');

    let restored = 0;
    let recovered = 0;
    const failed = [];

    if (live.length) {
      const result = await M.restore({ keys: live });
      if (result.ok) restored = result.restored || 0;
      else failed.push(memProblem(result.reason));
    }
    if (dead.length) {
      const result = await M.recoverForgotten({ keys: dead });
      if (result.ok) recovered = result.recovered || 0;
      else failed.push(memProblem(result.reason));
    }

    renderMemory();
    await refreshMemCloud();

    if (failed.length) {
      setStatus(e.syncStatus, failed[0], 'bad');
      e.memPickGo.disabled = false;
      return;
    }

    const bits = [];
    if (restored) bits.push(`${plural(restored, 'memory', 'memories')} restored`);
    if (recovered) bits.push(`${plural(recovered, 'memory', 'memories')} un-forgotten`);

    closeMemPick();
    setStatus(e.syncStatus,
      bits.length
        ? `${bits.join(' and ')}.`
        : 'Nothing changed — she already knew all of those under different wording.',
      bits.length ? 'ok' : 'warn');
  }

  /**
   * Destroy what was ticked. No archive, no way back.
   *
   * This is the half that was missing. Forgetting a memory is a soft delete on
   * purpose — the row stays with archived_at set so the forget reaches his other
   * devices instead of being pushed back up by the next one to sync — but the
   * consequence was that "forgotten" only ever grew, and a memory he had
   * deliberately dropped stayed listed as recoverable for good.
   *
   * Both lists can be purged, not just the forgotten one. "Delete this for good"
   * should not require forgetting it first.
   */
  async function killMemPick() {
    const e = cache();
    const M = window.SageMemory;
    if (!M || !pickChosen.size) return;

    if (!M.purge) {
      setStatus(e.syncStatus,
        'Permanent delete is not available yet. Reload and try again.', 'bad');
      return;
    }

    const keys = [...pickChosen];
    const chosen = [...pickRows.restorable, ...pickRows.forgotten]
      .filter(entry => pickChosen.has(entry.key));
    // One memory: quote it. Several: count them. A list of thirty in a dialog is
    // not something anyone reads before sliding.
    const only = chosen.length === 1 ? chosen[0] : null;

    const ok = await askSlide({
      title: keys.length === 1
        ? 'Delete this memory for good?'
        : `Delete ${keys.length} memories for good?`,
      // html, not message: this needs a line break, and slide() escapes `message`
      // for the callers that pass raw database text. The memory's own wording is
      // escaped here instead, since that is the only untrusted part.
      html: (only ? `<b>“${escapeHtml(only.text)}”</b><br>` : '')
        + 'Deleted outright, not archived. Nothing brings this back.',
      label: 'Slide to delete',
      confirmed: 'Deleting…',
      icon: 'fa-trash-can',
    });
    if (!ok) {
      setStatus(e.syncStatus, 'Left alone. Nothing was deleted.', 'ok');
      return;
    }

    e.memPickKill.disabled = true;
    e.memPickGo.disabled = true;
    setStatus(e.syncStatus, 'Deleting…');

    const result = await M.purge(keys);
    renderMemory();
    await refreshMemCloud();

    if (!result.ok) {
      setStatus(e.syncStatus, memProblem(result.reason), 'bad');
      syncMemPickState();
      return;
    }

    closeMemPick();
    if (result.pending) {
      // The local copy is already gone and the deletes are queued, so this is
      // "not yet" rather than "did not work" — worth the distinction, because one
      // of them is something to do about it and the other is not.
      techNote('memory delete', result.error || result.reason);
      setStatus(e.syncStatus,
        `${plural(result.purged, 'memory', 'memories')} gone. `
        + 'Her memory bank catches up on the next sync.',
        'warn');
      return;
    }
    setStatus(e.syncStatus,
      `${plural(result.purged, 'memory', 'memories')} deleted for good.`, 'ok');
  }

  // restoreMemory() used to live here: a blind "pull everything, push nothing".
  //
  // It is gone, and the Restore button opens the chooser instead. On any device
  // that is already in step — which is nearly always — it answered "nothing new,
  // she already knows all of it", so it was a button whose whole job was to tell
  // you it had nothing to do. Meanwhile the thing you actually wanted, seeing what
  // is saved and choosing what comes back or gets destroyed, was hidden behind a
  // second segment nobody would think to press.
  //
  // Deleted rather than left unwired. An unused function in this file has twice
  // ended up attached to the wrong button. Taking everything back is still one
  // gesture: open Restore, Select all, Bring back.

  /** Why it did not work, in a sentence anyone can read. */
  function memProblem(reason) {
    techNote('memory', reason);
    return {
      offline: 'You are offline, so her memory bank cannot be read.',
      'no-client': 'She cannot reach her memory bank right now.',
      'no-table': 'Her memory bank is not ready yet.',
      schema: 'Her memory bank is not ready yet.',
      denied: 'Her memory bank would not let her in.',
    }[reason] || 'That did not work. What she knows here is untouched.';
  }

  async function syncNow() {
    const e = cache();
    const M = window.SageMemory;
    if (!M) return;

    if (e.syncNow) e.syncNow.disabled = true;
    setStatus(e.syncStatus, '');
    e.syncPill?.classList.add('is-busy');
    if (e.syncPillText) e.syncPillText.textContent = 'Syncing…';

    const result = await M.sync({ force: true });
    renderMemory();

    if (result.ok) {
      if (e.syncNow) e.syncNow.disabled = false;
      setStatus(e.syncStatus, 'Memory saved and up to date.', 'ok');
      return;
    }

    // Offline needs no investigation and nothing can be done about it.
    if (result.reason === 'offline') {
      if (e.syncNow) e.syncNow.disabled = false;
      setStatus(e.syncStatus, 'You are offline. She will save herself when you are back.', 'bad');
      return;
    }

    // Everything else still gets diagnosed — a sync can break at six points that
    // look identical from here — but the finding goes to the console. The panel
    // gets one sentence, because the six fixes are all the same job for the person
    // who owns the database and none of them are actions the screen can offer.
    setStatus(e.syncStatus, 'Working out what went wrong…');
    const found = await M.diagnose().catch(() => null);
    if (e.syncNow) e.syncNow.disabled = false;
    renderMemory();

    techNote('sync', (found && found.fix)
      || result.error || result.push?.error || result.pull?.error || result.reason);
    setStatus(e.syncStatus, 'She could not save just now. Nothing she knows is lost.', 'bad');
  }

  // ══ Model list ═══════════════════════════════════════════════════════

  /**
   * Report the fallback chain instead of offering a choice.
   *
   * A picker was the wrong shape for this: the free tier meters each model
   * separately and retires names without notice, so a pinned favourite could
   * only ever make her quieter than letting the chain walk itself.
   */
  function renderModels(available) {
    const e = cache();
    const AI = window.SageAI;
    if (!e.modelNote || !AI) return;

    const chain = AI.modelChain();
    if (!chain.length) {
      e.modelNote.textContent = 'She picks her own model and falls back automatically when one is busy or retired.';
      return;
    }

    const resting = chain.filter(m => AI.modelResting(m)).length;
    const live = chain.find(m => !AI.modelResting(m)) || chain[0];
    const spare = Math.max(0, chain.length - 1);

    let note = `Using ${live}`;
    note += spare ? `, with ${spare} more behind it. ` : '. ';
    note += resting
      ? `${resting} resting right now — she moves down the list on her own.`
      : 'She moves down the list on her own when one is busy or retired.';
    if (available?.length) note += ` Your key can see ${available.length} models.`;

    e.modelNote.textContent = note;

    // The chain drawn out, so "she falls back on her own" is something you can
    // see rather than something you have to take on trust.
    if (e.modelChain) {
      e.modelChain.innerHTML = chain.map(m => {
        const isResting = !!AI.modelResting(m);
        const cls = isResting ? 'is-resting' : (m === live ? 'is-live' : '');
        return `<span class="sage-model-pill ${cls}" title="${isResting ? 'Resting' : (m === live ? 'In use' : 'Standby')}">
          ${escapeHtml(m)}
        </span>`;
      }).join('');
    }
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
      renderKeys();
      // Prefer what this session just learned, then the catalog cached from a
      // previous check, so the list is real rather than the built-in guess.
      renderModels(modelsSeen || AI.getKnownModels());

      // The ring state and the day's usage are drawn as their own panel now,
      // rather than crammed into this status line. The line is left for the
      // result of whatever you just pressed.
      renderUsage();
      setStatus(e.keyStatus, '');
      toggleAddKey(false);
    }

    renderPermission();
    renderVault();
    setStatus(e.vaultStatus, '');
    // How many keys the cloud holds needs no passphrase, so it can be read on
    // open and used to offer a restore. Unawaited — the panel is already drawn.
    refreshVaultCount().then(autoBackup).catch(() => {});

    if (limits) {
      fillHours(e.quietStart, limits.quietStart);
      fillHours(e.quietEnd, limits.quietEnd);
      e.dailyCap.value = limits.dailyCap;
      e.minGap.value = Math.round(limits.minGapMs / 3600000);
      e.critQuiet.checked = limits.criticalInQuietHours !== false;
      renderCategories(limits);
    }

    // Paints from the local mirror, so the panel is filled in before any
    // network call. The pull below repaints it if the cloud knows more.
    renderMemory();
    refreshQuietNote();
    refreshRangeOutputs();
    refreshHeroNote();
    setStatus(e.status, '');

    // Opening settings is the natural moment to reconcile with the cloud, and
    // it is the one screen where being a few seconds stale would show. Left
    // unawaited: the panel must not wait on the network to appear.
    window.SageMemory?.sync().then(() => {
      renderMemory();
      return refreshMemCloud();
    }).catch(() => {});
  }

  /** Her mood in the hero, so the dialog does not feel detached from the chat. */
  async function refreshHeroNote() {
    const e = cache();
    const S = window.SageScheduler;
    if (!e.heroNote || !S) return;
    try {
      const mood = S.moodAt(Date.now(), await S.getLimits());
      const caption = MOOD_CAPTION[mood];
      e.heroNote.textContent = caption ? `Duke 250 · ${caption}` : 'Duke 250 Gen 3';
    } catch {
      e.heroNote.textContent = 'Duke 250 Gen 3';
    }
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

    setStatus(e.status, 'Saved. She will behave accordingly.', 'ok');
    console.log('[SpinLog] ✅ Sage settings saved');
    return true;
  }

  // ══ Key check ════════════════════════════════════════════════════════

  /** "in 4m", "in 2h" — how long a resting key or model has left. */
  function waitWord(ms) {
    const secs = Math.max(0, Math.round((ms || 0) / 1000));
    if (!secs) return 'any moment';
    if (secs < 90) return `in ${secs}s`;
    const mins = Math.round(secs / 60);
    if (mins < 90) return `in ${mins}m`;
    return `in ${Math.round(mins / 60)}h`;
  }

  /**
   * The key ring.
   *
   * Each row says what the key is actually doing and, when it is resting, when
   * it comes back — "resting" on its own told you nothing about whether to wait
   * or to add another key. The first key that is not resting is the one in use,
   * which is not necessarily the first key on the ring.
   */
  function renderKeys() {
    const e = cache();
    const AI = window.SageAI;
    if (!e.keyList || !AI) return;

    const ring = AI.getKeys();
    if (e.keyDanger) e.keyDanger.hidden = !ring.length;

    // The count goes in the heading, so the list itself does not have to carry
    // a summary row and five keys read as a list rather than a wall.
    if (e.keyCount) {
      e.keyCount.hidden = !ring.length;
      e.keyCount.textContent = String(ring.length);
    }
    // Scrolls only once the grid is taller than four rows, which is eight keys.
    e.keyList.classList.toggle('is-long', ring.length > 8);

    if (!ring.length) {
      const canRestore = vaultRemote > 0;
      e.keyList.innerHTML = `<p class="sage-mem-empty">
        <i class="fas fa-key" aria-hidden="true"></i>${
          canRestore
            ? `No keys on this device. ${vaultRemote} still in the encrypted backup below.`
            : 'No keys yet — she is using her built-in lines.'
        }
      </p>`;
      return;
    }

    const liveId = (ring.find(k => !AI.keyResting(k.id)) || {}).id;

    e.keyList.innerHTML = ring.map((k, i) => {
      const resting = AI.keyResting(k.id);
      const inUse = !resting && k.id === liveId;
      const state = resting
        ? `back ${waitWord(AI.keyRestRemainingMs ? AI.keyRestRemainingMs(k.id) : 0)}`
        : (inUse ? 'in use' : 'standby');
      const cls = resting ? ' is-resting' : (inUse ? ' is-live' : '');
      const mask = AI.maskKey(k.key);
      return `<div class="sage-key-tile${cls}">
        <span class="sage-key-num" aria-hidden="true">${i + 1}</span>
        <span class="sage-key-state">${escapeHtml(state)}</span>
        <button type="button" class="sage-icon-btn sage-key-remove" data-key-id="${escapeHtml(k.id)}"
                title="Remove this key"
                aria-label="Remove key ${escapeHtml(mask)}">
          <i class="fas fa-xmark" aria-hidden="true"></i>
        </button>
        <span class="sage-key-mask">${escapeHtml(mask)}</span>
      </div>`;
    }).join('');
  }

  function toggleAddKey(force) {
    const e = cache();
    if (!e.addKey) return;
    const open = force !== undefined ? force : e.addKey.hidden;
    e.addKey.hidden = !open;
    e.keyAddToggle?.setAttribute('aria-expanded', String(open));
    if (open) setTimeout(() => e.keyInput?.focus({ preventScroll: true }), 40);
  }

  // ══ Encrypted key backup ═════════════════════════════════════════════

  // How many keys the cloud holds, and how many of those this device is missing.
  // Both read without the passphrase — the row's key_id is the same fingerprint
  // the ring uses — so a restore can be offered, and sized, before anything has
  // been unlocked. null = not yet known.
  let vaultRemote = null;
  let vaultMissing = null;

  /**
   * The backup panel.
   *
   * Says which of five states it is in, because they need different actions:
   * unsupported, no table yet, nothing backed up, locked (keys exist in the
   * cloud but no passphrase this session), and unlocked.
   */
  function renderVault() {
    const e = cache();
    const V = window.SageKeyVault;
    if (!e.vaultState) return;

    if (!V) {
      e.vaultState.textContent = 'Backup is not loaded.';
      return;
    }

    const s = V.syncState();
    let tone = 'warn';
    let icon = 'fa-lock';
    let title = 'Backup';
    let line = '';
    let showPass = false;
    let showActions = false;
    let foot = '';
    let busy = false;

    if (!s.available) {
      tone = 'bad'; icon = 'fa-triangle-exclamation';
      title = 'Not available here';
      line = 'This browser cannot encrypt, so keys cannot be backed up safely.';
    } else if (!s.hasClient) {
      tone = 'warn'; icon = 'fa-plug-circle-xmark';
      title = 'No connection';
      line = 'Cannot reach the database from this device.';
    } else if (s.lastError === 'no-table' || s.lastError === 'schema') {
      // One state, one sentence. Which of the two it is, and what to run, goes to
      // the console — it is the same job either way for the one person who can do
      // anything about it, and it is not an instruction this screen can carry out.
      techNote('backup', s.lastError);
      tone = 'warn'; icon = 'fa-database';
      title = 'Not available yet';
      line = 'Encrypted backup is not set up on this account.';
    } else if (s.unlocked) {
      tone = 'ok'; icon = 'fa-lock-open';
      title = 'Backed up';
      showActions = true;
      if (vaultRemote === null) {
        line = `${s.keysOnRing} key${s.keysOnRing === 1 ? '' : 's'} on this device.`;
      } else {
        line = `${vaultRemote} key${vaultRemote === 1 ? '' : 's'} encrypted in the cloud.`;
        // Sizing the restore is the difference between a button you trust and
        // one you press to find out what it does.
        if (vaultMissing) line += ` ${vaultMissing} of them are not on this device.`;
      }
      foot = 'Restoring and backing up are separate buttons on purpose — neither happens '
        + 'on its own. Lock when you are done on a shared machine.';
    } else if (vaultRemote === null) {
      // NOT KNOWN YET, which is not the same as zero. countRemote() is two network
      // reads fired unawaited when the panel opens, so this is the state for the
      // second or two before they answer.
      //
      // Without this branch, null fell through to the "Not backed up" case below:
      // the card told him he had no backup while he had six keys in the cloud, put
      // a passphrase field up to create one, and then corrected itself — and the
      // correction changed the card's height, which is what shifted every button
      // under it while he was reading. Saying "checking" costs a second and is true.
      tone = 'warn'; busy = true;
      title = 'Backup';
      line = 'Checking your backup…';
    } else if (vaultRemote) {
      tone = 'warn'; icon = 'fa-lock';
      title = 'Locked';
      showPass = true;
      line = `${vaultRemote} key${vaultRemote === 1 ? '' : 's'} in the cloud. `
        + 'Enter your passphrase to restore or update them.';
    } else {
      tone = 'warn'; icon = 'fa-lock';
      title = 'Not backed up';
      showPass = true;
      line = 'Choose a passphrase and your keys are encrypted before they leave this device.';
      foot = 'The passphrase is never sent anywhere, so nobody — including whoever can '
        + 'read the database — can decrypt the backup without it. Lose it and the backup '
        + 'is gone for good.';
    }

    e.vaultIcon.className = `sage-vault-icon is-${tone}`;
    e.vaultIcon.innerHTML = busy
      ? '<i class="sl-spinner" aria-hidden="true"></i>'
      : `<i class="fas ${icon}" aria-hidden="true"></i>`;
    e.vaultTitle.textContent = title;
    e.vaultState.textContent = line;
    if (e.vaultPassRow) e.vaultPassRow.hidden = !showPass;

    // The actions row stays in the DOM and the buttons are DISABLED rather than
    // the whole row being hidden. Hiding it is what left "press Restore" as
    // advice with no Restore button on screen to press.
    if (e.vaultActions) {
      e.vaultActions.hidden = false;
      const usable = showActions;

      // Only the three segments that move keys need the passphrase. They are
      // DISABLED rather than the row being hidden — hiding it is what left "press
      // Restore" as advice with no Restore button on screen to press.
      [e.vaultBackup, e.vaultReplace].forEach(btn => {
        if (!btn) return;
        btn.disabled = !usable;
      });
      // Optional chaining throughout this block, not tidiness: a stale cached
      // index.html has no segments for these ids, and an unguarded property write
      // would throw here and leave the whole panel half-painted.
      if (e.vaultBackup) {
        e.vaultBackup.title = usable
          ? 'Encrypt anything new and send it up'
          : 'Unlock the backup first';
      }
      if (e.vaultReplace) {
        e.vaultReplace.title = usable
          ? 'Make the backup match this device, dropping any spares'
          : 'Unlock the backup first';
      }

      // Restoring is worth offering the moment the cloud has something, even
      // locked — pressing it then says exactly what to do next. And saying what
      // it would actually do, so it is not a button you press to find out.
      if (e.vaultRestore) {
        e.vaultRestore.disabled = !usable && !vaultRemote;
        e.vaultRestore.title = usable
          ? (vaultMissing
            ? `Add ${vaultMissing} key${vaultMissing === 1 ? '' : 's'} from the backup`
            : 'Nothing in the backup is missing here')
          : (vaultRemote
            ? `Enter your passphrase to decrypt ${vaultRemote} key${vaultRemote === 1 ? '' : 's'}`
            : 'Nothing in the backup yet');
      }

      // Lock and Delete backup live outside the pill, and their rules are not the
      // pill's rules.
      //
      // Lock only means something while unlocked. Delete backup needs no
      // passphrase at all — forget() is a DELETE by key_id, nothing is decrypted
      // — and it used to be disabled along with everything else, which meant that
      // losing your passphrase also lost the only way to clear the unreadable
      // backup it left behind. That is precisely when you want it.
      if (e.vaultLock) {
        e.vaultLock.hidden = !usable;
        e.vaultLock.title = 'Forget the passphrase on this device. The backup stays.';
      }
      if (e.vaultDelete) {
        e.vaultDelete.hidden = !vaultRemote;
        e.vaultDelete.title = usable
          ? 'Delete the encrypted backup. Your keys here are untouched.'
          : 'Delete the backup you can no longer decrypt. No passphrase needed.';
      }
    }

    // The four-cell readout that used to sit here — In the cloud / On this device
    // / Restorable / Passphrase — is gone. It existed because a failure report
    // could not tell an empty vault from an unreachable one, and the state line
    // above now carries both of those in a sentence. Four raw counts under a
    // settings card is instrumentation, not interface.

    if (e.vaultFoot) e.vaultFoot.textContent = foot;
  }

  /**
   * The vault module, or null after saying plainly that it is not there.
   *
   * Every one of these handlers used to `return` silently when
   * window.SageKeyVault was missing, which is indistinguishable from a button
   * that does nothing — and a missing module is entirely possible, because
   * sage-keyvault.js is a new file and a stale cached index.html has no script
   * tag for it.
   */
  function vaultModule() {
    const V = window.SageKeyVault;
    if (V) return V;
    techNote('backup', 'src/js/sage-keyvault.js did not load — stale cached index.html, or it failed to parse');
    setStatus(cache().vaultStatus,
      'Backup is not available yet. Reload the app and try again.', 'bad');
    return null;
  }

  /** Learn how many keys the cloud holds, then repaint. Cheap, no passphrase. */
  async function refreshVaultCount() {
    const V = window.SageKeyVault;
    if (!V) { vaultRemote = null; vaultMissing = null; renderVault(); return; }
    vaultRemote = await V.countRemote().catch(() => null);
    vaultMissing = await V.missingHere().catch(() => null);
    renderVault();
  }

  /**
   * Check the backup and say whether it is healthy.
   *
   * The answer is now one of two sentences rather than the diagnosis itself. The
   * full finding — which of the six failure points it is, and the file to run —
   * goes to the console, because every version of "it is broken" here resolves to
   * the same action for the one person who can take it, and none of them are
   * something the panel can do.
   */
  async function checkVault() {
    const e = cache();
    const V = vaultModule();
    if (!V) return;
    e.vaultCheck.disabled = true;
    setStatus(e.vaultStatus, 'Checking…');
    const found = await V.diagnose().catch(err => ({ fix: `the check itself failed: ${err?.message}` }));
    e.vaultCheck.disabled = false;
    await refreshVaultCount();

    if (found.ok) {
      const rows = found.detail?.rows ?? 0;
      setStatus(e.vaultStatus,
        `All good — ${rows} key${rows === 1 ? '' : 's'} backed up, and this device can read them.`,
        'ok');
      return;
    }
    techNote('backup', found.fix || found.problem);
    setStatus(e.vaultStatus, 'Something is wrong with the backup. Your keys here are safe.', 'bad');
  }

  /**
   * Back up anything not in the vault yet, whenever settings are opened.
   *
   * Without this, a key added on a locked vault never reached the cloud and the
   * backup silently fell behind the ring — so "Restore" had less than the user
   * expected, or nothing at all, and no step had visibly failed.
   */
  async function autoBackup() {
    const V = window.SageKeyVault;
    const AI = window.SageAI;
    if (!V || !AI || !V.hasPassphrase()) return;
    const onRing = AI.getKeys().length;
    if (!onRing || (vaultRemote !== null && vaultRemote >= onRing)) return;
    const result = await V.push().catch(() => null);
    if (result && result.ok && result.pushed) {
      await refreshVaultCount();
      setStatus(cache().vaultStatus,
        `${result.pushed} new key${result.pushed === 1 ? '' : 's'} backed up automatically.`, 'ok');
    }
  }

  async function unlockVault() {
    const e = cache();
    const V = vaultModule();
    if (!V) return;

    const pass = e.vaultPass.value;
    if (!pass) {
      setStatus(e.vaultStatus, 'Enter a passphrase first.', 'bad');
      e.vaultPass.focus();
      return;
    }

    e.vaultUnlock.disabled = true;
    setStatus(e.vaultStatus, 'Working…');
    const result = await V.setPassphrase(pass);
    e.vaultUnlock.disabled = false;

    if (!result.ok) {
      const why = {
        'too-short': 'Use at least 8 characters.',
        'wrong-passphrase': 'That passphrase does not match the backup already in the cloud.',
        'no-crypto': 'This browser cannot encrypt, so backup is unavailable.',
      }[result.reason] || 'That did not work.';
      setStatus(e.vaultStatus, why, 'bad');
      renderVault();
      return;
    }

    e.vaultPass.value = '';
    await refreshVaultCount();

    // Unlocking grants access and nothing more.
    //
    // It used to call sync(), which pulled — so entering the passphrase restored
    // keys without being asked. Restore is its own button, for the same reason
    // removing a key is not allowed to touch the backup: one action, one effect.
    //
    // Backing up is the exception, and only because it is purely additive: it
    // can add a row to the cloud but can never change or remove anything here.
    await autoBackup();

    const missing = vaultMissing || 0;
    setStatus(e.vaultStatus,
      missing
        ? `Unlocked. ${missing} key${missing === 1 ? '' : 's'} in the backup that this device `
          + 'does not have — press Restore to add them.'
        : 'Unlocked. Nothing in the backup is missing from this device.',
      'ok');
  }

  /**
   * Say why a backup or restore failed, specifically.
   *
   * The vault can fail at six points that all look identical from here, so
   * rather than a generic line it asks diagnose() which one it actually was.
   */
  async function explainVaultFailure(reason) {
    const e = cache();
    const V = window.SageKeyVault;
    // Still diagnosed, still logged in full — just no longer printed on screen as
    // a repair instruction naming a file and a policy.
    const found = await V.diagnose().catch(() => null);
    if (found && found.fix) techNote('backup', found.fix);

    if (found && found.problem === 'empty') {
      setStatus(e.vaultStatus, 'There is nothing backed up yet.', 'warn');
      return;
    }
    setStatus(e.vaultStatus, vaultProblem(reason), 'bad');
  }

  async function backupVault() {
    const e = cache();
    const V = vaultModule();
    if (!V) return;
    e.vaultBackup.disabled = true;
    setStatus(e.vaultStatus, 'Encrypting…');
    const result = await V.push();
    e.vaultBackup.disabled = false;
    await refreshVaultCount();

    if (!result.ok) {
      await explainVaultFailure(result.reason);
      return;
    }
    setStatus(e.vaultStatus,
      result.pushed
        ? `${result.pushed} key${result.pushed === 1 ? '' : 's'} encrypted and backed up.`
        : `Already backed up — all ${vaultRemote || 0} of them.`,
      'ok');
  }

  async function restoreVault() {
    const e = cache();
    const V = vaultModule();
    if (!V) return;
    e.vaultRestore.disabled = true;
    setStatus(e.vaultStatus, 'Decrypting…');
    const result = await V.pull();
    e.vaultRestore.disabled = false;
    renderKeys();
    renderUsage();
    await refreshVaultCount();

    if (!result.ok) {
      await explainVaultFailure(result.reason);
      return;
    }
    if (result.restored) {
      setStatus(e.vaultStatus,
        `${result.restored} key${result.restored === 1 ? '' : 's'} restored.`, 'ok');
      return;
    }
    // Nothing came back. Distinguishing "already had them all" from "the vault
    // is empty" is the whole difference between working and broken.
    if (!result.total) {
      await explainVaultFailure('empty');
      return;
    }
    setStatus(e.vaultStatus,
      `Nothing to restore — she already has all ${result.total} key${result.total === 1 ? '' : 's'} in the backup.`,
      'ok');
  }

  /** Why it did not work, without naming a table, a column or a file. */
  function vaultProblem(reason) {
    techNote('backup', reason);
    return {
      locked: 'Enter your passphrase first.',
      'wrong-passphrase': 'That passphrase does not match this backup.',
      'no-table': 'Encrypted backup is not set up on this account.',
      schema: 'Encrypted backup is not set up on this account.',
      'no-client': 'No connection right now.',
      'no-crypto': 'This browser cannot encrypt.',
      'no-ai': 'The key ring is not loaded yet.',
    }[reason] || 'That did not work. Your keys here are safe.';
  }

  /**
   * Make the backup match this device exactly — the one action that removes keys
   * from the cloud without deleting the whole vault, and so the only way to lose
   * a backed-up key by accident.
   *
   * Confirmed only when it would actually drop something. Asking about a
   * no-op teaches people to slide without reading, which is how the confirmation
   * stops being one.
   */
  async function replaceBackup() {
    const e = cache();
    const V = vaultModule();
    if (!V) return;

    const onRing = window.SageAI?.getKeys().length || 0;
    const extra = Math.max(0, (vaultRemote || 0) - onRing);

    if (extra) {
      const ok = await askSlide({
        title: `Drop ${extra} key${extra === 1 ? '' : 's'} from the backup?`,
        message: `The backup has ${vaultRemote}, this device has ${onRing}. `
          + `Matching removes the ${extra} spare. If you still want ${extra === 1 ? 'it' : 'them'}, `
          + 'restore first.',
        label: 'Slide to match',
        confirmed: 'Matching…',
        icon: 'fa-arrows-rotate',
      });
      if (!ok) {
        setStatus(e.vaultStatus, 'Left alone. The backup still has all of them.', 'ok');
        return;
      }
    }

    e.vaultReplace.disabled = true;
    setStatus(e.vaultStatus, 'Matching…');
    const result = await V.replace();
    e.vaultReplace.disabled = false;
    await refreshVaultCount();

    if (!result.ok) {
      await explainVaultFailure(result.reason);
      return;
    }
    const bits = [];
    if (result.pushed) bits.push(`${result.pushed} added`);
    if (result.removed) bits.push(`${result.removed} removed`);
    setStatus(e.vaultStatus,
      bits.length ? `Backup now matches this device — ${bits.join(', ')}.` : 'Already matching.',
      'ok');
  }

  function lockVault() {
    const e = cache();
    window.SageKeyVault?.lock();
    renderVault();
    setStatus(e.vaultStatus, 'Locked. The backup stays in the cloud.', 'ok');
  }

  function meter(label, used, total, tone) {
    const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
    return `<div class="sage-meter${tone ? ` is-${tone}` : ''}">
      <div class="sage-meter-top">
        <span>${escapeHtml(label)}</span>
        <b>${used}${total ? ` / ${total}` : ''}</b>
      </div>
      <div class="sage-meter-track"><span style="width:${pct}%"></span></div>
    </div>`;
  }

  /**
   * What she has spent today.
   *
   * Free-tier flash is metered per DAY, not per minute, so "how much is left" is
   * the answer to almost every "why has she gone quiet" — it used to be the tail
   * of a sentence under the key list. Chat has no ceiling of our own (you asked,
   * so she answers), which is why only the background allowance gets a total.
   */
  function renderUsage() {
    const e = cache();
    const AI = window.SageAI;
    if (!e.usageMeters || !AI) return;

    const ring = AI.getKeys();
    if (!ring.length) {
      if (e.usageState) {
        e.usageState.textContent = 'No key yet';
        e.usageState.className = 'sage-usage-state is-warn';
      }
      e.usageMeters.innerHTML = '';
      if (e.usageFoot) {
        e.usageFoot.textContent = 'Add a key and she writes her own notifications and replies. '
          + 'Without one she uses the lines built into the app.';
      }
      return;
    }

    const used = AI.requestsToday();
    const left = AI.autoBudgetLeft();
    const resting = ring.filter(k => AI.keyResting(k.id)).length;
    const state = AI.ready();

    let label = 'Ready';
    let tone = 'ok';
    if (!state.ok) {
      label = { 'no-key': 'No key', offline: 'Offline', backoff: 'All resting' }[state.reason] || 'Not ready';
      tone = state.reason === 'offline' ? 'warn' : 'bad';
    } else if (resting) {
      label = `${resting} of ${ring.length} resting`;
      tone = 'warn';
    }
    if (e.usageState) {
      e.usageState.textContent = label;
      e.usageState.className = `sage-usage-state is-${tone}`;
    }

    const budget = AI.autoBudget();
    e.usageMeters.innerHTML = [
      meter('Background allowance', used.auto, budget,
        left === 0 ? 'bad' : (left <= 2 ? 'warn' : null)),
      meter('Your conversations', used.chat, 0, null),
    ].join('');

    const bits = [`${ring.length} key${ring.length === 1 ? '' : 's'} on the ring`];
    if (left === 0) {
      bits.push('background allowance spent — she will use her built-in lines until midnight, '
        + 'but chat still works');
    } else {
      // Naming the per-key rate makes it obvious that another key buys more.
      bits.push(`${left} of ${budget} background requests left today `
        + `(${AI.AUTO_BUDGET_PER_KEY} per key)`);
    }
    if (state.reason === 'backoff' && state.retryInMs) {
      bits.push(`back ${waitWord(state.retryInMs)}`);
    }
    if (e.usageFoot) e.usageFoot.textContent = `${bits.join(' · ')}.`;
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

    // No second argument: the key is checked against whatever she would pick
    // herself, which is now the only thing that decides the model.
    const result = await AI.validateKey(typed);
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
    renderUsage();
    toggleAddKey(false);

    // Straight into the backup while the passphrase is still unlocked, so the
    // new key is not the one missing after a reinstall.
    if (window.SageKeyVault?.hasPassphrase()) {
      window.SageKeyVault.push().then(() => refreshVaultCount()).catch(() => {});
    }

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
    renderUsage();
    renderVault();

    // The backup is deliberately NOT touched.
    //
    // This used to call dropKey(id), on the reasoning that removing a key
    // deliberately means it should not return on the next restore. That
    // conflated two different wishes — "not on this device" and "gone
    // everywhere" — and the cost was that tidying the list silently ate the
    // backup one key at a time, which is exactly how a restore ended up with
    // nothing to give back. Making the cloud match the device is now its own
    // button in the backup panel.
    const left = AI.getKeys().length;
    const backed = vaultRemote || 0;
    if (!left) {
      forgetKeyPools();
      setStatus(e.keyStatus,
        backed
          ? `Last key removed from this device. The backup still has ${backed} — press Restore to bring them back.`
          : 'Last key removed. Back to her built-in lines.',
        'warn');
    } else {
      setStatus(e.keyStatus, `Key removed from this device — ${left} left on the ring.`, 'ok');
    }
  }

  async function forgetKey() {
    const e = cache();
    const AI = window.SageAI;
    if (!AI) return;

    const onRing = AI.getKeys().length;
    if (!onRing) {
      setStatus(e.keyStatus, 'There are no keys on this device to remove.', 'warn');
      return;
    }
    const backed = vaultRemote || 0;

    // The honest stake depends entirely on whether there is a backup, and that is
    // the one thing the old single-press button never said.
    const ok = await askSlide({
      title: `Remove ${onRing === 1 ? 'the key' : `all ${onRing} keys`} from this device?`,
      message: backed
        ? `The backup keeps ${backed}, so Restore brings them back.`
        : 'There is no backup, so you would have to paste them in again.',
      label: 'Slide to remove',
      confirmed: 'Removing…',
      icon: 'fa-key',
    });
    if (!ok) {
      setStatus(e.keyStatus, 'Left alone. Her keys are still here.', 'ok');
      return;
    }

    AI.clearKey();
    forgetKeyPools();
    e.keyInput.value = '';
    renderKeys();
    renderUsage();
    // The encrypted backup is deliberately LEFT ALONE.
    //
    // This used to wipe it as well, which made Restore useless in the one
    // situation people actually reach for it: clear the device, then put the
    // keys back. Deleting the backup is now its own button in the backup panel.
    renderVault();
    setStatus(e.keyStatus,
      backed
        ? `All ${backed} key${backed === 1 ? '' : 's'} removed from this device. `
          + 'The encrypted backup is untouched — press Restore to bring them back.'
        : 'All keys removed. Back to her built-in lines.',
      'warn');
  }

  /**
   * Delete the cloud copy.
   *
   * There is nothing to undo this with. The whole design means nobody — this app
   * included — can decrypt or recover it afterwards, which is worth saying in the
   * dialog rather than leaving as an implication of the word "delete".
   */
  async function deleteBackup() {
    const e = cache();
    const V = vaultModule();
    if (!V) return;

    const backed = vaultRemote || 0;
    const onRing = window.SageAI?.getKeys().length || 0;

    const ok = await askSlide({
      title: backed
        ? `Delete the backup of ${backed} key${backed === 1 ? '' : 's'}?`
        : 'Delete the backup?',
      message: onRing
        ? `The ${onRing} on this device stay. Nothing brings the backup back, `
          + 'passphrase or not.'
        : 'This device has no keys left, so they would be gone for good. Restore first.',
      label: 'Slide to delete',
      confirmed: 'Deleting…',
      icon: 'fa-trash-can',
    });
    if (!ok) {
      setStatus(e.vaultStatus, 'Left alone. The backup is still there.', 'ok');
      return;
    }

    await V.forget();
    vaultRemote = 0;
    renderVault();
    setStatus(e.vaultStatus, 'Backup deleted. Your keys on this device are untouched.', 'warn');
  }

  // ══ Notification permission ══════════════════════════════════════════

  function permissionState() {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;   // 'granted' | 'denied' | 'default'
  }

  /**
   * Whether she may notify at all, and whether she can do it with the app shut.
   *
   * Both were invisible before. The only route to granting permission was
   * pressing Send a test and reading a failure message, and nothing anywhere
   * said that without background sync a notification cannot arrive while the app
   * is closed — which is the honest answer to "why do they only appear when I
   * open it".
   */
  function renderPermission() {
    const e = cache();
    if (!e.permCard) return;
    const state = permissionState();

    const view = {
      granted: {
        tone: 'ok', icon: 'fa-bell', title: 'Notifications on',
        line: 'She is allowed to message you.',
      },
      denied: {
        tone: 'bad', icon: 'fa-bell-slash', title: 'Notifications blocked',
        line: 'Blocked at browser level, so this app cannot ask again. Allow them in '
          + 'the site settings — the padlock beside the address bar.',
      },
      default: {
        tone: 'warn', icon: 'fa-bell', title: 'Notifications not set up',
        line: 'She cannot message you until you allow it.',
      },
      unsupported: {
        tone: 'bad', icon: 'fa-bell-slash', title: 'Not supported here',
        line: 'This browser has no notification support. An installed app usually does.',
      },
    }[state];

    e.permIcon.className = `sage-perm-icon is-${view.tone}`;
    e.permIcon.innerHTML = `<i class="fas ${view.icon}" aria-hidden="true"></i>`;
    e.permTitle.textContent = view.title;
    e.permState.textContent = view.line;
    e.permAllow.hidden = state !== 'default';

    // Background delivery, stated plainly rather than left to be discovered.
    const bits = [];
    if (state === 'granted') {
      if (window.dkBackgroundSync) {
        bits.push('Background checks are running, so she can reach you while the app is closed.');
      } else {
        bits.push('Background checks are not available on this device, so notifications arrive '
          + 'when you open the app. Installing it to your home screen and using it regularly '
          + 'is what unlocks them.');
      }
    }
    e.permFoot.textContent = bits.join(' ');
  }

  async function askPermission() {
    const e = cache();
    if (!window.requestNotifPermission) return;
    await window.requestNotifPermission();
    renderPermission();
    const state = permissionState();
    if (state === 'granted') {
      setStatus(e.status, 'Allowed. She can message you now.', 'ok');
      // Anything the pump discarded while it had no permission is long gone, but
      // whatever is queued can go out now.
      window.sagePump?.();
    } else if (state === 'denied') {
      setStatus(e.status, 'Refused. You can still allow it from the browser\'s site settings.', 'bad');
    } else {
      setStatus(e.status, 'No answer given — the prompt was dismissed. Try again when you are ready.', 'warn');
    }
  }

  // ══ Test notification ════════════════════════════════════════════════

  async function sendTest() {
    const e = cache();
    setStatus(e.status, 'Asking her to say something…');

    if (typeof window.sendSageTestNotif !== 'function') {
      setStatus(e.status, 'The notification code did not load. Reload the app and try again.', 'bad');
      return;
    }

    // A real button press, so it is the right moment to ask if we have not
    // already. Nothing else in the app prompts.
    const before = permissionState();
    if (before === 'default' && window.requestNotifPermission) {
      await window.requestNotifPermission();
    }

    // Each of these used to produce the same "Could not send. Check notification
    // permission." Naming the actual one matters because only some are fixable
    // here, and one of them is not about permission at all.
    const state = permissionState();
    renderPermission();
    if (state === 'unsupported') {
      setStatus(e.status, 'This browser cannot show notifications.', 'bad');
      return;
    }
    if (state === 'denied') {
      setStatus(e.status, 'Notifications are blocked for this site. Allow them in your browser\'s '
        + 'site settings, then try again.', 'bad');
      return;
    }
    if (state === 'default') {
      setStatus(e.status, 'The permission prompt was dismissed, so nothing can be sent yet.', 'warn');
      return;
    }

    const S = window.SageScheduler;
    const mood = S ? S.moodAt(Date.now(), await S.getLimits()) : null;

    // Deliberately bypasses the queue. A test that got deferred three hours by
    // the daily cap would be a useless test.
    let sent = false;
    try {
      sent = await window.sendSageTestNotif(mood);
    } catch (err) {
      setStatus(e.status, `The browser refused it: ${err?.message || 'unknown error'}`, 'bad');
      return;
    }

    if (sent) {
      const quiet = mood === 'quiet';
      setStatus(e.status,
        quiet
          ? `Sent silently — it is her quiet hours, so it will not make a sound.`
          : `Sent — she is feeling ${mood} right now.`,
        'ok');
      return;
    }

    // Permission is granted and the send still failed. That is the service
    // worker or the OS, not this app.
    setStatus(e.status, 'Permission is granted but the notification would not show. '
      + 'Check that notifications are on for this app in your system settings, and that '
      + 'Do Not Disturb or a focus mode is not filtering them.', 'bad');
  }

  // ══ Open / close ═════════════════════════════════════════════════════

  function open(tab) {
    const e = cache();
    if (!e.modal) return;
    lastFocused = document.activeElement;

    // Open on a clean slate. A filter or a half-typed search left over from
    // last time looks like a bug: the list comes up short with no visible cause.
    memQuery = '';
    memKind = '';
    if (e.memSearch) e.memSearch.value = '';
    if (e.memSearchClear) e.memSearchClear.hidden = true;
    closeMemPick();
    showTab(tab || 'memory');

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
    // Nothing to disarm any more. The three two-press buttons that used to need
    // resetting here are one slide dialog now, and it cannot outlive its own
    // promise — closing this dialog cannot leave a destructive button armed.
    // The chooser can still be open with rows ticked, though, and reopening to
    // find a stale selection waiting is how you delete the wrong thing.
    closeMemPick();
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

  /**
   * Everything in the dialog that can actually take focus right now.
   *
   * The filter is the point. Three of the four panels are `hidden` at any time
   * and the import file input always is, so a plain querySelectorAll returns
   * controls that cannot be focused — and Tab from the last visible control
   * would then call focus() on nothing and go to the browser chrome instead of
   * wrapping. offsetParent is null for anything hidden or inside something
   * hidden, which is exactly the test needed.
   */
  function focusables() {
    const e = cache();
    if (!e.modal) return [];
    return Array.from(e.modal.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => el.offsetParent !== null && el.tabIndex !== -1);
  }

  function onKeydown(ev) {
    if (!isOpen()) return;
    // `e` is the element cache, and it has to be taken here like every other
    // function in this file does. It was missing, and the cost was the whole
    // keyboard contract of this dialog: the first `e.memPick` read below threw
    // ReferenceError, so Escape never closed the dialog and Tab never trapped —
    // focus walked straight out into the page behind it. Silent, because the
    // throw happens inside a listener and nothing above it was watching.
    const e = cache();

    // The slide dialog opens over this one and keeps its own keys. Without this,
    // Escape cancelled the slide AND closed the settings dialog behind it in the
    // same keypress, and Tab was pulled back out of the dialog asking the
    // question into the one that is not currently in front.
    if (window.SageConfirm?.isOpen()) return;

    // The chooser is the innermost thing on screen when it is up, so it is what
    // Escape should shut. Closing the whole dialog because the chooser was open
    // would throw away the tab, the search and the scroll position with it.
    if (ev.key === 'Escape' && e.memPick && !e.memPick.hidden) {
      ev.preventDefault();
      closeMemPick();
      setStatus(e.syncStatus, '');
      e.memRestore?.focus({ preventScroll: true });
      return;
    }

    if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
    if (ev.key !== 'Tab') return;

    // Keep Tab inside the dialog while it is open.
    const list = focusables();
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }

  // ══ Wiring ═══════════════════════════════════════════════════════════

  function setup() {
    const e = cache();
    if (!e.modal) return;

    // The model picker is gone, so an override stored by an older build is now
    // unreachable — and could pin her to a retired name forever. Drop it once.
    window.SageAI?.setModel('');

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
    e.keyAddToggle?.addEventListener('click', () => toggleAddKey());

    // ── Encrypted backup ──
    e.vaultUnlock?.addEventListener('click', unlockVault);
    e.vaultPass?.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); unlockVault(); }
    });
    e.vaultBackup?.addEventListener('click', backupVault);
    e.vaultRestore?.addEventListener('click', restoreVault);
    e.vaultLock?.addEventListener('click', lockVault);
    e.vaultDelete?.addEventListener('click', deleteBackup);
    e.vaultCheck?.addEventListener('click', checkVault);
    e.vaultReplace?.addEventListener('click', replaceBackup);
    e.keyInput?.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); checkAndAddKey(); }
    });
    // Delegated: the list is rebuilt whenever the ring changes.
    e.keyList?.addEventListener('click', ev => {
      const btn = ev.target.closest('.sage-key-remove');
      if (btn) removeOneKey(btn.dataset.keyId);
    });

    // ── Tabs ──
    e.tabs?.addEventListener('click', ev => {
      const tab = ev.target.closest('[data-sage-tab]');
      if (tab) showTab(tab.dataset.sageTab);
    });
    e.tabs?.addEventListener('keydown', onTabKeydown);

    // ── Memory ──
    e.memForget?.addEventListener('click', forgetAllMemory);
    // Delegated: the list is rebuilt whenever a memory is added, pinned or
    // dropped, so a handler bound to a row would not survive the first click.
    e.memList?.addEventListener('click', ev => {
      const pin = ev.target.closest('.sage-mem-pin');
      if (pin) { pinOneMemory(pin.dataset.memPin); return; }
      const drop = ev.target.closest('.sage-mem-remove');
      if (drop) forgetOneMemory(drop.dataset.memId);
    });
    e.memFilters?.addEventListener('click', ev => {
      const chip = ev.target.closest('[data-mem-kind]');
      if (chip) setMemoryFilter(chip.dataset.memKind);
    });

    e.memSearch?.addEventListener('input', () => setMemoryQuery(e.memSearch.value));
    e.memSearch?.addEventListener('keydown', ev => {
      // Enter would submit nothing; Escape clearing the field is the expectation.
      if (ev.key === 'Escape' && e.memSearch.value) {
        ev.preventDefault();
        ev.stopPropagation();   // and not close the dialog
        e.memSearch.value = '';
        setMemoryQuery('');
      }
    });
    e.memSearchClear?.addEventListener('click', () => {
      e.memSearch.value = '';
      setMemoryQuery('');
      e.memSearch.focus({ preventScroll: true });
    });

    e.syncNow?.addEventListener('click', syncNow);
    // Restore opens the chooser rather than pulling everything blindly. Bringing
    // all of it back is still one gesture in there — Select all, then Bring back.
    e.memRestore?.addEventListener('click', openMemPick);
    e.memExport?.addEventListener('click', exportMemory);
    e.memImport?.addEventListener('click', () => e.memImportFile?.click());

    // ── The chooser ──
    e.memPickClose?.addEventListener('click', () => {
      closeMemPick();
      setStatus(e.syncStatus, '');
    });
    e.memPickAll?.addEventListener('click', () => selectAllMemPick(true));
    e.memPickNone?.addEventListener('click', () => selectAllMemPick(false));
    e.memPickGo?.addEventListener('click', runMemPick);
    e.memPickKill?.addEventListener('click', killMemPick);
    // Delegated: the list is rebuilt on every tick, so a handler bound to a row
    // would not survive the first one.
    e.memPickList?.addEventListener('change', ev => {
      const box = ev.target.closest('input[data-pick-key]');
      if (box) toggleMemPick(box.dataset.pickKey, box.checked);
    });
    e.memImportFile?.addEventListener('change', () => {
      const file = e.memImportFile.files?.[0];
      if (file) importMemory(file);
    });

    // A background sync, or a memory she writes mid-conversation, repaints the
    // panel underneath him rather than leaving it stale.
    window.SageMemory?.onChange(reason => {
      if (!isOpen()) return;
      if (reason === 'sync' || reason === 'pull' || reason === 'push' || reason === 'external') {
        renderMemory();
      } else {
        renderSync();
      }
    });

    e.quietStart?.addEventListener('change', refreshQuietNote);
    e.quietEnd?.addEventListener('change', refreshQuietNote);
    e.dailyCap?.addEventListener('input', refreshRangeOutputs);
    e.minGap?.addEventListener('input', refreshRangeOutputs);

    e.permAllow?.addEventListener('click', askPermission);
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

  // The conversation is in the database now — one sage_memory row per message —
  // so there is no storage key here any more. See readHistory/writeHistory.
  const CHAT_KEEP = 80;            // turns kept
  const CHAT_INPUT_MAX_ROWS = 5;

  // What the button under her reply says when she offers a page. Keyed by the
  // section names dkApp.openSection accepts, so an unknown one renders nothing
  // rather than a button that goes somewhere that does not exist.
  const NAV_LABELS = {
    home: { label: 'Open home', icon: 'fa-house' },
    service: { label: 'Open service history', icon: 'fa-screwdriver-wrench' },
    docs: { label: 'Open documents', icon: 'fa-folder-open' },
    sage: { label: 'Open chat', icon: 'fa-comment-dots' },
  };

  // Two of these are deliberately instructions rather than questions, because
  // nothing on screen otherwise tells you she can now change things.
  const SUGGESTIONS = [
    'when\'s my next service?',
    'what have i spent on you?',
    'update my insurance date',
    'what did you get serviced last time?',
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
      attachBtn: document.getElementById('sageChatAttach'),
      file: document.getElementById('sageChatFile'),
      attachBar: document.getElementById('sageAttachBar'),
      attachList: document.getElementById('sageAttachList'),
      attachCount: document.getElementById('sageAttachCount'),
      attachClear: document.getElementById('sageAttachClear'),
    };
    return chat;
  }

  // ══ ATTACHMENTS ══════════════════════════════════════════════════════
  // The file clipped to the next message. She reads it as part of the
  // conversation, and her upload controls act on it — which is how a service
  // logged through chat gets its bill, and how a document gets filed without
  // leaving the chat.

  const ATTACH_MAX_BYTES = 9 * 1024 * 1024;
  // Per message. Four is what the composer can list without the chips needing a
  // scroller of their own on a phone, and the model's request has a size ceiling
  // that a dozen photos would walk straight into.
  const ATTACH_MAX_FILES = 4;
  const ATTACH_MAX_TOTAL = 20 * 1024 * 1024;

  /** The files clipped to the NEXT message. Emptied when it is sent. */
  let pending = [];

  function prettySize(bytes) {
    const n = Number(bytes) || 0;
    return n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
  }

  // A glyph per kind, so a list of four is scannable without reading the names.
  const ATTACH_ICON = {
    pdf: 'fa-file-pdf',
    jpg: 'fa-file-image', jpeg: 'fa-file-image', png: 'fa-file-image',
    webp: 'fa-file-image', gif: 'fa-file-image', heic: 'fa-file-image', heif: 'fa-file-image',
    mp3: 'fa-file-audio', wav: 'fa-file-audio', m4a: 'fa-file-audio',
    mp4: 'fa-file-video', mov: 'fa-file-video', webm: 'fa-file-video',
  };

  function attachIcon(name) {
    return ATTACH_ICON[String(name || '').split('.').pop().toLowerCase()] || 'fa-file-lines';
  }

  function attachedBytes() {
    return pending.reduce((n, f) => n + (f.size || 0), 0);
  }

  function renderAttachment() {
    const e = chatEls();
    if (!e.attachBar) return;

    if (!pending.length) {
      e.attachBar.hidden = true;
      if (e.attachList) e.attachList.innerHTML = '';
      e.attachBtn?.classList.remove('has-file');
      if (e.file) e.file.value = '';
      return;
    }

    e.attachBar.hidden = false;
    if (e.attachCount) {
      e.attachCount.textContent = pending.length === 1
        ? prettySize(attachedBytes())
        : `${pending.length} files · ${prettySize(attachedBytes())}`;
    }

    // The index is the handle rather than the name: two files picked from two
    // folders can share a name, and dropping the wrong one is unrecoverable
    // because the File objects cannot be re-created from markup.
    e.attachList.innerHTML = pending.map((f, i) => `
      <li class="sage-attach-chip" title="${escapeHtml(f.name)}">
        <i class="fas ${attachIcon(f.name)}" aria-hidden="true"></i>
        <span class="sage-attach-name">${escapeHtml(f.name)}</span>
        <span class="sage-attach-size">${prettySize(f.size)}</span>
        <button type="button" class="sage-attach-drop" data-drop="${i}"
                aria-label="Remove ${escapeHtml(f.name)}">
          <i class="fas fa-xmark" aria-hidden="true"></i>
        </button>
      </li>`).join('');

    e.attachBtn?.classList.add('has-file');
    // Cleared every time, because picking the SAME file again fires no change
    // event while it is still the input's value — so the second attempt would
    // silently do nothing.
    if (e.file) e.file.value = '';
  }

  /**
   * Take files for the next message, and say what was refused.
   *
   * Refusals are reported per file rather than aborting the batch: dragging in
   * five photos when one is oversized should attach the four that fit and name the
   * one that did not, not throw all five away.
   */
  function attachFiles(list) {
    const e = chatEls();
    const incoming = Array.from(list || []).filter(Boolean);
    if (!incoming.length) return false;

    const refused = [];
    let added = 0;

    for (const file of incoming) {
      if (pending.length >= ATTACH_MAX_FILES) {
        refused.push(`${file.name} — ${ATTACH_MAX_FILES} files is the limit`);
        continue;
      }
      if (!file.size) { refused.push(`${file.name} is empty`); continue; }
      if (file.size > ATTACH_MAX_BYTES) {
        refused.push(`${file.name} is ${prettySize(file.size)}, over the ${prettySize(ATTACH_MAX_BYTES)} limit`);
        continue;
      }
      // The same file twice is a mis-tap, not an instruction.
      if (pending.some(p => p.name === file.name && p.size === file.size)) {
        refused.push(`${file.name} is already attached`);
        continue;
      }
      if (attachedBytes() + file.size > ATTACH_MAX_TOTAL) {
        refused.push(`${file.name} would take the message past ${prettySize(ATTACH_MAX_TOTAL)}`);
        continue;
      }
      pending.push(file);
      added += 1;
    }

    renderAttachment();

    if (refused.length) {
      setStatus(e.status, refused.join('. '), added ? 'warn' : 'bad');
    } else {
      setStatus(e.status, pending.length === 1
        ? 'Attached. Tell her what to do with it.'
        : `${pending.length} files attached. Tell her what to do with them.`, 'ok');
    }
    if (added) e.input?.focus({ preventScroll: true });
    return added > 0;
  }

  function clearAttachment() {
    pending = [];
    // The app's queue goes too, so a later tool call cannot pick up a stale file.
    window.dkApp?.releaseFile?.();
    renderAttachment();
  }

  /** Drop one file and leave the rest of the message alone. */
  function dropAttachment(index) {
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= pending.length) return;
    const [gone] = pending.splice(i, 1);
    window.dkApp?.releaseFile?.(gone);
    renderAttachment();
  }

  /** Wire the paperclip, drag-and-drop onto the log, and paste. */
  function setupAttachments() {
    const e = chatEls();
    if (!e.attachBtn || !e.file) return;

    e.attachBtn.addEventListener('click', () => e.file.click());
    e.file.addEventListener('change', () => attachFiles(e.file.files));
    e.attachClear?.addEventListener('click', () => {
      clearAttachment();
      setStatus(e.status, '');
    });
    // Delegated, because the chip list is rebuilt from scratch on every change.
    e.attachList?.addEventListener('click', ev => {
      const btn = ev.target.closest('[data-drop]');
      if (!btn) return;
      dropAttachment(btn.dataset.drop);
      setStatus(e.status, pending.length
        ? `${pending.length} file${pending.length === 1 ? '' : 's'} still attached.`
        : '', pending.length ? 'ok' : '');
    });

    // Dropping a file anywhere on the conversation attaches it.
    const log = e.log;
    if (log) {
      const stop = ev => { ev.preventDefault(); ev.stopPropagation(); };
      ['dragenter', 'dragover'].forEach(type => log.addEventListener(type, ev => {
        stop(ev);
        log.classList.add('is-dropping');
      }));
      ['dragleave', 'dragend'].forEach(type => log.addEventListener(type, ev => {
        stop(ev);
        log.classList.remove('is-dropping');
      }));
      log.addEventListener('drop', ev => {
        stop(ev);
        log.classList.remove('is-dropping');
        attachFiles(ev.dataTransfer?.files);
      });
    }

    // Pasting screenshots straight into the box. A clipboard can hold several.
    e.input?.addEventListener('paste', ev => {
      const files = Array.from(ev.clipboardData?.files || []);
      if (files.length) { ev.preventDefault(); attachFiles(files); }
    });
  }

  /**
   * The conversation, in the cloud.
   *
   * Picking the phone up should continue the conversation the laptop was having
   * rather than starting a second one — the same reason her memory is up there.
   * One row per message, so a new turn is one insert rather than a rewrite of the
   * whole log.
   *
   * Only role and text are required; `file` is metadata for the bubble and is
   * never sent to the model.
   */
  function readHistory() {
    const store = window.dkCloudStore;
    if (!store) return [];
    return store.chatHistory().filter(t => t && t.role && t.text);
  }

  function writeHistory(turns) {
    const store = window.dkCloudStore;
    if (store) store.setChat(turns.slice(-CHAT_KEEP));
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
    // A message that carried a file says so, so the log still makes sense later
    // when you are reading back why she filed something.
    // `files` is the list; `file` is the single-attachment shape every turn stored
    // before this, and it still has to render.
    const carried = Array.isArray(turn.files) && turn.files.length
      ? turn.files
      : (turn.file?.name ? [turn.file] : []);
    // Wrapped, so ONE rule separates the clips from her words however many there
    // are. Per-clip borders would draw three dividers for three files, and
    // :last-of-type cannot pick the last clip here — the trace badges below are
    // spans too, and they are siblings.
    const clip = carried.length
      ? `<span class="sage-msg-files">${carried.map(f =>
        `<span class="sage-msg-file"><i class="fas fa-paperclip" aria-hidden="true"></i>${escapeHtml(f.name || 'file')}</span>`
      ).join('')}</span>`
      : '';
    return `<div class="sage-msg ${mine ? 'is-me' : 'is-sage'}">
      ${clip}
      <p>${escapeHtml(turn.text)}</p>
      ${mine ? '' : traceMarkup(turn)}
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

  // ══ WHAT SHE IS DOING ════════════════════════════════════════════════
  // Reaching for a control takes a second or two, and it used to be reported as
  // one line of grey text under the composer — the least looked-at pixel on the
  // screen, well away from the conversation it was about. So an action she took
  // was invisible, and a pause with no explanation looked like a hang.
  //
  // The steps now appear where the reply will, and survive as a trail on the
  // finished message. That second part matters more than the animation: it is
  // the difference between her saying she read your history and you being able
  // to see that she did.

  /** Steps in the turn currently being answered. */
  let steps = [];

  function noteStep(name) {
    const T = window.SageTools;
    // Whatever she was doing a moment ago is finished now.
    steps.forEach(s => { if (s.state === 'doing') s.state = 'done'; });
    steps.push({
      name,
      phrase: T?.describe ? T.describe(name) : 'working on something',
      icon: T?.iconFor ? T.iconFor(name) : 'fa-gear',
      state: 'doing',
    });
    renderThinking();
  }

  function stepRow(step) {
    // A span with .sl-spinner, not a spun fa-circle-notch: the glyph's ink is not
    // centred in its inline box, so it orbited instead of spinning. See .sl-spinner.
    const mark = step.state === 'doing'
      ? '<span class="sl-spinner sage-step-spin" aria-hidden="true"></span>'
      : '<i class="fas fa-check sage-step-tick" aria-hidden="true"></i>';
    return `<li class="sage-step is-${step.state}">
      <i class="fas ${escapeHtml(step.icon)} sage-step-ico" aria-hidden="true"></i>
      <span class="sage-step-text">She's ${escapeHtml(step.phrase)}</span>
      ${mark}
    </li>`;
  }

  function renderThinking() {
    const e = chatEls();
    if (!e.log) return;
    const bubbleEl = e.log.querySelector('.sage-msg.is-thinking');
    if (!bubbleEl) return;

    // No tools yet: she is simply composing, so the dots are the honest signal.
    const body = steps.length
      ? `<ol class="sage-steps">${steps.map(stepRow).join('')}</ol>`
      : '<p class="sage-dots"><span></span><span></span><span></span></p>';

    bubbleEl.innerHTML = body;
    e.log.scrollTop = e.log.scrollHeight;
  }

  function showThinking(on) {
    const e = chatEls();
    if (!e.log) return;
    const existing = e.log.querySelector('.sage-msg.is-thinking');
    if (!on) { existing?.remove(); return; }
    if (existing) { renderThinking(); return; }
    // aria-live on the log already announces this; the steps are decorative
    // narration of something that gets announced properly when she replies.
    e.log.insertAdjacentHTML('beforeend',
      '<div class="sage-msg is-sage is-thinking" aria-hidden="true"></div>');
    renderThinking();
  }

  /**
   * The trail under a finished reply: what she actually did, and anything she
   * wrote down or dropped. Kept on the stored turn so it is still there when the
   * conversation is re-read tomorrow.
   */
  function traceMarkup(turn) {
    const out = [];

    // A control whose OUTCOME is shown below does not also need a chip saying she
    // was busy doing it. "writing something down" sitting above "Noted: he wants
    // to go to Munnar tomorrow" is two orange pills for one note, and the
    // second one is strictly better — it says what she wrote, not that she was
    // writing. The chip only survives when its badge did not appear, which is how
    // a refused or already-known write still leaves a trace.
    const SPOKEN_FOR = {
      remember: (turn.learned || []).length,
      update_memory: (turn.revised || []).length,
      forget: (turn.forgot || []).length,
      forget_everything: (turn.forgot || []).length,
    };

    // Her checking her own memory is not news. It changes nothing, the answer is in
    // the reply already, and left in the trail it sits next to "Noted: …" as a
    // second pill about the same subject that happens to say less. Reads that touch
    // the BIKE stay — "reading your service history" tells him where a figure came
    // from, which is worth keeping.
    const PRIVATE_LOOKUP = new Set([
      'recall_memory', 'list_memories', 'memory_stats', 'read_recap',
      'list_episodes', 'search_conversation',
    ]);

    const trace = (turn.trace || []).filter(step => step
      && !SPOKEN_FOR[step.name]
      // A failure still shows: "she went looking and could not" is news.
      && !(PRIVATE_LOOKUP.has(step.name) && step.ok !== false));

    if (trace.length) {
      const chips = trace.map(step => {
        const tone = step.ok === false ? ' is-bad' : (step.write ? ' is-write' : '');
        return `<span class="sage-trace-chip${tone}">
          <i class="fas ${escapeHtml(step.icon || 'fa-gear')}" aria-hidden="true"></i>${escapeHtml(step.phrase || step.name)}
        </span>`;
      }).join('');
      out.push(`<div class="sage-trace">${chips}</div>`);
    }

    // Her memory changing is worth showing plainly rather than only in her own
    // wording, which is easy to miss and impossible to verify.
    //
    // All three labels are things she DID to her memory, in the past tense:
    //
    //   Noted:    a new line written down
    //   Updated:  an existing line filled in, not a second one beside it
    //   Forgot:   a line dropped because he corrected her
    //
    // "Remembered:" was the first of these and it was the wrong word — it reads as
    // her RECALLING something, which is the opposite event and the one thing none
    // of these badges ever means. Her looking something up shows nothing at all
    // now (see PRIVATE_LOOKUP above), so if a retrieval label is ever wanted,
    // "Remembered" is free for it.
    const notes = [];
    (turn.learned || []).forEach(text => notes.push(
      `<span class="sage-note-badge is-learned">
        <i class="fas fa-brain" aria-hidden="true"></i>Noted: ${escapeHtml(text)}
      </span>`));
    // A page she is offering rather than one she has opened.
    //
    // open_section used to navigate, and the screen changed underneath him
    // mid-conversation — he asks a question and the chat he was reading is replaced
    // by the service form. It is a button now, so going somewhere is his decision.
    if (turn.nav && NAV_LABELS[turn.nav.section]) {
      const nav = NAV_LABELS[turn.nav.section];
      out.push(`<button type="button" class="sage-msg-go" data-go-section="${escapeHtml(turn.nav.section)}"
        ${turn.nav.highlight ? `data-go-highlight="${escapeHtml(turn.nav.highlight)}"` : ''}>
        <i class="fas ${nav.icon}" aria-hidden="true"></i>${escapeHtml(nav.label)}
        <i class="fas fa-arrow-right sage-msg-go-arrow" aria-hidden="true"></i>
      </button>`);
    }

    // A note she filled in, not a second one about the same thing. Labelled
    // differently on purpose: two "Noted" chips for one plan is what made it look
    // like she was keeping two memories of it.
    (turn.revised || []).forEach(text => notes.push(
      `<span class="sage-note-badge is-learned">
        <i class="fas fa-brain" aria-hidden="true"></i>Updated: ${escapeHtml(text)}
      </span>`));
    (turn.forgot || []).forEach(text => notes.push(
      `<span class="sage-note-badge is-forgot">
        <i class="fas fa-eraser" aria-hidden="true"></i>Forgot: ${escapeHtml(text)}
      </span>`));
    if (notes.length) out.push(`<div class="sage-notes">${notes.join('')}</div>`);

    return out.join('');
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
    // Nothing but punctuation is nothing. A phone keyboard turns a double space
    // into ". " and an autocomplete tap into a stray full stop, and two "." turns
    // had landed in his log between real messages — each one a bubble, a counted
    // message, and an API call spent asking her to interpret a full stop.
    //
    // Emoji are NOT punctuation. "❤️" on its own is a message, and a reply to it
    // is the right behaviour.
    const asked = /^[\s\p{P}\p{S}]*$/u.test(String(text || ''))
        && !/\p{Extended_Pictographic}/u.test(String(text || ''))
      ? ''
      : String(text || '').trim();
    // Files on their own are a valid message: clip a bill, press send, and she
    // works out what it is.
    if ((!asked && !pending.length) || chatBusy) return;

    if (!AI) { setStatus(e.status, 'Sage is not loaded.', 'bad'); return; }

    chatBusy = true;
    if (e.send) e.send.disabled = true;
    setStatus(e.status, '');
    steps = [];

    // The attachments are taken now, so clearing the composer cannot lose them and
    // a second message cannot reuse them by accident.
    const attached = pending.slice();
    pending = [];
    renderAttachment();

    appendTurn({
      role: 'user',
      text: asked || (attached.length === 1
        ? `(sent you ${attached[0].name})`
        : `(sent you ${attached.length} files)`),
      at: Date.now(),
      files: attached.length
        ? attached.map(f => ({ name: f.name, size: f.size }))
        : undefined,
    });
    // Counters only — how long they have known each other and how often they
    // talk. Costs nothing and is what lets her open with something other than
    // a greeting for a stranger.
    window.SageMemory?.noteMessage();
    showThinking(true);

    // Hand the files to the app so her upload controls have something to act on.
    // They are a queue: each control takes the one that suits its kind and
    // releases only that, so three bills in one message become three records.
    if (attached.length) window.dkApp?.holdFiles?.(attached);

    // The turn just added is the question itself, so it is excluded here —
    // askSage appends it to the conversation itself.
    const history = readHistory().slice(0, -1).map(t => ({ role: t.role, text: t.text }));
    const result = await AI.askSage(asked || (attached.length > 1
      ? 'Take a look at these and tell me what they are.'
      : 'Take a look at this and tell me what it is.'), {
      history,
      attachments: attached,
      // Reaching for a control takes a second or two, so show what she is doing,
      // in the conversation rather than in a status line nobody looks at. It
      // also makes an action visible rather than merely claimed.
      onTool: noteStep,
    });

    // Whatever she was mid-way through is finished by the time she answers.
    steps.forEach(s => { if (s.state === 'doing') s.state = 'done'; });
    const trace = steps.map(s => ({
      name: s.name,
      phrase: s.phrase,
      icon: s.icon,
      ok: (result.calls || []).find(c => c.name === s.name)?.result?.ok !== false,
      // Marked so a change to his data stands out from a lookup. This replaces
      // the old "Done: …" status line, which said the same thing in grey text
      // below the composer and was gone the moment he typed again.
      write: !!window.SageTools?.isWrite(s.name),
    }));
    steps = [];

    showThinking(false);
    setStatus(e.status, '');
    chatBusy = false;
    if (e.send) e.send.disabled = false;

    if (!result.ok) {
      setStatus(e.status, chatProblem(result.reason, result.retryInMs), 'bad');
      return;
    }

    // The trail rides on the stored turn, so what she did is still legible when
    // the conversation is read back days later.
    appendTurn({
      role: 'sage',
      text: result.text,
      at: Date.now(),
      trace: trace.length ? trace : undefined,
      // A page she offered. The LAST one wins if she offered two, because the
      // second is the one she settled on.
      nav: (() => {
        const offer = (result.calls || [])
          .filter(c => c.name === 'open_section' && c.result?.ok && c.result.offered)
          .pop();
        return offer ? { section: offer.result.offered, highlight: offer.result.highlight || null } : undefined;
      })(),
      learned: result.learned?.length ? result.learned : undefined,
      revised: result.revised?.length ? result.revised : undefined,
      forgot: result.forgot?.length ? result.forgot : undefined,
    });
    if (result.mood) refreshChatMood(result.mood);

    // Nothing to clear here any more. The composer emptied itself at send, and the
    // app's queue is now per file: each upload control releases the one it stored
    // and leaves the rest held, so "file the bill, and put the photo in the
    // archive too" works across two turns. Clearing the whole queue after any one
    // successful upload — which is what this used to do — threw the others away.

    // Fold whatever has scrolled past her window into the rolling recap. Left
    // unawaited and rate limited inside: the conversation must never wait on it,
    // and it is charged to the background budget rather than to chat.
    window.SageMemory?.consolidate(readHistory()).catch(() => {});

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

  /**
   * Bin the visible conversation.
   *
   * Confirmed now, because the button sits next to the settings gear in the chat
   * header and there is no undo — the log only exists in localStorage. Skipped
   * when there is nothing to clear, so the empty state does not ask a question
   * with no consequence.
   */
  async function clearChat() {
    const turns = readHistory().length;
    if (!turns) {
      setStatus(chatEls().status, 'There is nothing to clear.', 'warn');
      return;
    }

    const held = window.SageMemory?.count() || 0;
    const ok = await askSlide({
      title: `Clear ${turns === 1 ? 'this message' : `all ${turns} messages`}?`,
      message: held
        ? `The messages and her record of them. She still knows the ${held} thing`
          + `${held === 1 ? '' : 's'} she has learned about you.`
        : 'The messages and her record of them.',
      label: 'Slide to clear',
      confirmed: 'Clearing…',
      icon: 'fa-comment-slash',
    });
    if (!ok) return;

    // Deletes the rows, so the conversation is gone on the other device too rather
    // than the two of them arguing about it on the next load.
    await window.dkCloudStore?.clearChat();

    // And her record OF the conversation, which used to survive it: the episodes
    // are when each of them happened, the recap summarises messages that are now
    // deleted, and the relationship row counts them. With nothing else saved, this
    // is why clearing the chat left one lonely "relationship counters" row in the
    // table and no control could shift it.
    //
    // Her FACTS are untouched — that is the whole difference between clearing a
    // chat and forgetting someone, and it is what the dialog above promises.
    const recordGone = await window.SageMemory?.forgetConversations?.();

    renderChat();
    // The settings panel lists the episodes and the recap, so it is stale now.
    renderMemory();

    // Worth naming the count — "she still remembers you" is easy to read as
    // reassuring boilerplate, whereas a number is evidence.
    const kept = held
      ? ` She still remembers ${held} thing${held === 1 ? '' : 's'} about you.`
      : '';
    if (recordGone && recordGone.pending) {
      techNote('conversation clear', recordGone.reason);
      setStatus(chatEls().status, wipeTrouble(recordGone, 'Cleared') + kept, 'warn');
      return;
    }
    setStatus(chatEls().status, `Conversation cleared.${kept}`, 'ok');
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

    // Taking up a page she offered. Delegated, because the log is rebuilt whenever
    // a message arrives and a handler bound to the button would not survive it.
    e.log?.addEventListener('click', ev => {
      const go = ev.target.closest('[data-go-section]');
      if (!go) return;
      window.dkApp?.goToSection({
        section: go.dataset.goSection,
        highlight: go.dataset.goHighlight || null,
      });
    });

    e.clear?.addEventListener('click', clearChat);
    // Wrapped, not passed directly: open() takes a tab name and would otherwise
    // be handed the click event.
    e.settings?.addEventListener('click', () => open());

    setupAttachments();
    keepComposerAboveKeyboard(e);
    renderChat();
    refreshChatMood();
    console.log('[SpinLog] ✅ Sage chat ready');
  }

  /**
   * Keep what he is typing above the keyboard.
   *
   * `interactive-widget=resizes-content` on the viewport meta does the real work —
   * it makes the keyboard shrink the layout viewport, so the chat card's `dvh`
   * heights contract and the composer is inside the page again rather than behind
   * half a screen of keys.
   *
   * This is the second half. The layout resize does not scroll anything, so on a
   * long page the composer can end up correctly sized and still off-screen. And
   * the resize arrives while the keyboard is still animating, so a scroll issued
   * on `focus` alone aims at where the page was a moment ago.
   *
   * So: scroll on focus, and again when the viewport actually settles. visualViewport
   * is the only event that fires when the keyboard finishes moving; on a browser
   * without it the focus scroll alone is the same behaviour as before, only aimed
   * at the right element.
   */
  function keepComposerAboveKeyboard(e) {
    if (!e.input) return;
    const anchor = e.form || e.input;
    let typing = false;

    // Is the composer already somewhere he can see? Checked against the VISUAL
    // viewport, whose height is what the keyboard actually takes away.
    //
    // This is what keeps the whole thing from being a nuisance. sendChat() refocuses
    // the input after every reply with `preventScroll: true`, on purpose, so the
    // page does not jump — and scrolling here unconditionally would undo that. It
    // also makes the desktop case a no-op, where the composer never moves.
    const inView = () => {
      const box = anchor.getBoundingClientRect();
      const limit = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      return box.top >= 0 && box.bottom <= limit - 4;
    };

    const bring = () => {
      if (!typing || inView()) return;
      // block:'end' rather than 'center': the composer is the last thing in the
      // card, so its bottom edge is what has to clear the keyboard.
      anchor.scrollIntoView({ block: 'end', behavior: 'smooth' });
    };

    e.input.addEventListener('focus', () => {
      typing = true;
      // Two frames: one for the focus to commit, one for the browser's own
      // scroll-on-focus to land, so this does not fight it.
      requestAnimationFrame(() => requestAnimationFrame(bring));
    });
    e.input.addEventListener('blur', () => { typing = false; });

    // The only event that fires when the keyboard has finished moving. A scroll
    // issued on focus alone aims at where the page was before it opened.
    //
    // Resize only. Visual-viewport SCROLL is his gesture, and following it would
    // mean fighting him for control of the page while he reads.
    if (window.visualViewport) window.visualViewport.addEventListener('resize', bring);
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

  // The verdict, said out loud. It has always been in the facts and was only ever
  // read for its colour; these are the same four strings shortened enough to sit
  // in a label without wrapping.
  const VERDICT_LABEL = {
    'needs attention': 'Needs attention',
    'something due soon': 'Due soon',
    'worth a look': 'Worth a look',
    steady: 'All steady',
  };

  function healthEls() {
    return {
      card: document.getElementById('sageHealthCard'),
      bubble: document.getElementById('sageHealthBubble'),
      verdict: document.getElementById('sageHealthVerdict'),
      writing: document.getElementById('sageHealthWriting'),
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
    //
    // The tone class moved off the sentence and onto the label and the bubble's
    // left edge. Amber body text across a full-width panel was the least readable
    // thing on the home screen, and it is the line that matters most.
    const tone = VERDICT_TONE[f.verdict] || '';
    e.word.textContent = insight.prose || describeVerdict(f);
    e.word.className = 'sage-health-word';
    if (e.bubble) e.bubble.className = `sage-health-bubble ${tone}`;
    if (e.verdict) {
      e.verdict.textContent = VERDICT_LABEL[f.verdict] || f.verdict || '';
      e.verdict.className = `sage-health-verdict ${tone}`;
    }

    // Flags are only things that need doing. Anything overdue, then the two
    // nearest deadlines. The "worth a look" observations stay in the facts for
    // Sage to mention in her own words, but they are not a to-do item and they
    // were the noisiest thing on the card — a raw ISO date and a cost comparison
    // nobody asked for.
    const flags = [
      ...f.overdue.map(o => ({ tone: 'is-bad', icon: 'fa-circle-exclamation', text: `${o.what} — ${o.detail}` })),
      ...f.upcoming.slice(0, 2).map(u => ({
        tone: u.days <= 7 ? 'is-warn' : '',
        icon: 'fa-clock',
        text: `${u.what} in ${u.days} day${u.days === 1 ? '' : 's'}`,
      })),
    ];

    e.flags.innerHTML = flags.slice(0, 4).map(fl =>
      `<span class="sage-health-flag ${fl.tone}">
        <i class="fas ${fl.icon}" aria-hidden="true"></i>${escapeHtml(fl.text)}
      </span>`).join('');

    // Four stats, chosen as the ones worth a glance before a ride. Average per
    // visit, spend over 90 days, typical gap and interval adherence were all
    // real but none of them change a decision, and six figures side by side
    // stopped any of them being read at all.
    const odo = f.estimatedOdoNow || f.lastOdo || null;
    e.stats.innerHTML = [
      statRow('Odometer', odo ? `${odo.toLocaleString('en-IN')} km` : null),
      statRow('Next service', f.nextServiceDays !== null && f.nextServiceDays !== undefined
        ? `${f.nextServiceDays} days`
        : null),
      statRow('Spent so far', f.totalSpend ? inr(f.totalSpend) : null),
      statRow('Services logged', f.serviceCount || null),
    ].join('');

    const bits = [];
    if (f.estimatedOdoNow && f.odoIsEstimate) bits.push('Odometer is estimated from your riding');
    if (f.lastServiceDate) bits.push(`Last serviced ${f.daysSinceLastService} days ago`);
    if (!insight.prose) {
      // Her words are withheld whenever they would contradict the figures above,
      // so say which reason it is rather than always blaming a missing key.
      if (!window.SageAI?.hasKey()) bits.push('Add a Gemini key for Sage\'s own take');
      else if (insight.waitingToRewrite) bits.push('Her summary is out of date — tap Refresh');
      else bits.push('She could not put it in her own words this time');
    }
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
    // Say that she is writing, rather than leaving stale words on screen with a
    // dimmed Refresh button as the only clue. Only on a forced refresh: the
    // unforced path is usually a cache hit and would flash the label for a frame.
    if (force) {
      e.card.classList.add('is-writing');
      if (e.writing) e.writing.hidden = false;
    }
    try {
      const insight = await AI.buildHealthInsight({ force: !!force });
      renderHealth(insight);
      return insight;
    } catch {
      return null;
    } finally {
      healthBusy = false;
      if (e.refresh) e.refresh.disabled = false;
      e.card.classList.remove('is-writing');
      if (e.writing) e.writing.hidden = true;
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
    // tabs
    showTab, TABS,
    // chat
    setupChat, renderChat, sendChat, clearChat, onSageSection, refreshChatMood,
    readHistory, writeHistory,
    // voice + alerts
    renderKeys, renderUsage, renderModels, renderPermission, askPermission,
    permissionState, sendTest, waitWord, toggleAddKey,
    // key vault
    renderVault, refreshVaultCount, autoBackup, unlockVault, backupVault,
    restoreVault, lockVault, deleteBackup, checkVault, replaceBackup, vaultModule,
    vaultProblem, explainVaultFailure,
    // memory
    renderMemory, forgetOneMemory, pinOneMemory, forgetAllMemory,
    setMemoryFilter, setMemoryQuery, renderEpisodes, renderSync, describeSync,
    syncNow, refreshMemCloud, renderMemCloudFacts,
    memProblem, exportMemory, importMemory,
    // the chooser: selective restore and permanent delete
    openMemPick, closeMemPick, renderMemPick, syncMemPickState, toggleMemPick,
    selectAllMemPick, runMemPick, killMemPick,
    // confirmation
    askSlide,
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
