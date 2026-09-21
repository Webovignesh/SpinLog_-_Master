// ════════════════════════════════════════════════════════════════════════
// SPINLOG — DATE PICKER
//
// A calendar in the app's own skin, replacing the browser's.
//
// ── Why not the native one ───────────────────────────────────────────
// `<input type="date">` gives you a free picker and no say in how it looks. On
// Chrome desktop that is a small grey-and-blue panel with its own typeface and
// its own idea of an accent colour, dropped on top of a black-and-orange page.
// It cannot be themed — not the header, not the selected day, not one pixel of
// it — and on a page this opinionated it reads as a different application.
//
// Working around that is also what broke the fields it sat in. To keep the native
// picker reachable, the date shells covered themselves with a transparent input at
// `inset: 0` and then absolutely positioned the visible text around it at hardcoded
// offsets — `left: 56px; right: 54px`, re-stated at four breakpoints. Change the
// leading icon's width and every one of those offsets is wrong, which is exactly
// how the icons came to sit off-centre.
//
// So the input becomes a value holder and nothing else: it keeps its `name`, its
// `required`, its ISO value, and every form in the app serialises exactly as before.
// The shell goes back to being an ordinary flex row, which is why the icons line up
// again.
//
// ── What it adds that the native one cannot ──────────────────────────
// The quick row. Setting a next-due date by hand is arithmetic he should not be
// doing: a service is due some round number of months after the last one, so the
// chips offer +3, +6 and +12 months measured FROM THE SERVICE DATE in the same
// form, not from today. Picking "6 months" after entering a service date of
// 14 March gives 14 September, which is the answer he was going to work out on his
// fingers. For an ordinary date field the chips are Today and Yesterday, which
// covers the case of logging a service the morning after.
//
// Keyboard: arrows move by a day, PageUp/PageDown by a month, Home/End to the ends
// of the week, Enter picks, Escape closes. The native picker does this and losing
// it would be a real regression rather than a cosmetic one.
// ════════════════════════════════════════════════════════════════════════

(function (root) {
  'use strict';

  const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  // How far the year dropdown reaches. A service log is about a bike he owns, so
  // there is no reason to offer 1974 or 2090.
  const YEARS_BACK = 30;
  const YEARS_FORWARD = 12;

  let panel = null;      // the one popover, reused
  let openFor = null;    // the input it belongs to right now
  let viewYear = 0;      // the month on screen, which is not the selection
  let viewMonth = 0;
  let cursor = null;     // the day the keyboard is on, as a Date

  // ── Dates, in local time ────────────────────────────────────────────
  //
  // Never toISOString(): that is UTC, and east of Greenwich it returns yesterday
  // for the whole evening. The same bug already cost this app a day on its
  // "next service in N days" counter — see localIso() in sage-ai.js.

  function iso(date) {
    if (!date) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function fromIso(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function today() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function sameDay(a, b) {
    return !!a && !!b && a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  /**
   * Add months, keeping the day of the month where the month is long enough.
   *
   * 31 August + 6 months is 28 February, not 3 March. Date's own month
   * arithmetic overflows into the next month and would quietly put a service due
   * date in the wrong one.
   */
  function addMonths(date, count) {
    const day = date.getDate();
    const out = new Date(date.getFullYear(), date.getMonth() + count, 1);
    const lastDay = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
    out.setDate(Math.min(day, lastDay));
    return out;
  }

  function clampToRange(date, input) {
    const min = fromIso(input.min);
    const max = fromIso(input.max);
    if (min && date < min) return null;
    if (max && date > max) return null;
    return date;
  }

  function isDisabled(date, input) {
    return clampToRange(date, input) === null;
  }

  // ── The quick row ───────────────────────────────────────────────────

  /**
   * Which chips this field gets.
   *
   * A next-due field is offsets from the service date; anything else is Today and
   * Yesterday. Decided from the input's own name so nothing has to be annotated in
   * the markup, and so the filter-by-date fields do not get service-interval chips
   * that make no sense for them.
   */
  function chipsFor(input) {
    const name = String(input.name || input.id || '').toLowerCase();
    const isDue = /due|next/.test(name);

    if (!isDue) {
      const now = today();
      return [
        { label: 'Today', date: now },
        { label: 'Yesterday', date: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1) },
      ];
    }

    // Measured from the service date in the same form when there is one, because a
    // due date six months after TODAY is the wrong answer for a service he is
    // logging three weeks late.
    const form = input.form || input.closest('form');
    const from = fromIso(form?.querySelector('input[name="date"]')?.value) || today();
    const anchored = !!fromIso(form?.querySelector('input[name="date"]')?.value);

    return [
      { label: '+3 mo', date: addMonths(from, 3), note: anchored ? 'from the service date' : 'from today' },
      { label: '+6 mo', date: addMonths(from, 6), note: anchored ? 'from the service date' : 'from today' },
      { label: '+1 yr', date: addMonths(from, 12), note: anchored ? 'from the service date' : 'from today' },
    ];
  }

  // ── Building it ─────────────────────────────────────────────────────

  function build() {
    const el = document.createElement('div');
    el.className = 'dk-cal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-label', 'Choose a date');
    el.hidden = true;
    el.innerHTML = `
      <div class="dk-cal-head">
        <button type="button" class="dk-cal-step" data-step="-1" aria-label="Previous month">
          <i class="fas fa-chevron-left" aria-hidden="true"></i>
        </button>
        <div class="dk-cal-title">
          <select class="dk-cal-month" aria-label="Month"></select>
          <select class="dk-cal-year" aria-label="Year"></select>
        </div>
        <button type="button" class="dk-cal-step" data-step="1" aria-label="Next month">
          <i class="fas fa-chevron-right" aria-hidden="true"></i>
        </button>
      </div>
      <div class="dk-cal-quick" role="group" aria-label="Quick choices"></div>
      <div class="dk-cal-week" aria-hidden="true">
        ${WEEKDAYS.map(d => `<span>${d}</span>`).join('')}
      </div>
      <div class="dk-cal-grid" role="grid"></div>
      <div class="dk-cal-foot">
        <button type="button" class="dk-cal-clear">Clear</button>
        <p class="dk-cal-note" aria-live="polite"></p>
      </div>`;
    document.body.appendChild(el);

    const year = el.querySelector('.dk-cal-year');
    const thisYear = today().getFullYear();
    for (let y = thisYear - YEARS_BACK; y <= thisYear + YEARS_FORWARD; y += 1) {
      const option = document.createElement('option');
      option.value = String(y);
      option.textContent = String(y);
      year.appendChild(option);
    }
    const month = el.querySelector('.dk-cal-month');
    MONTHS.forEach((name, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = name;
      month.appendChild(option);
    });

    el.addEventListener('mousedown', ev => ev.preventDefault()); // keep focus in the grid
    el.addEventListener('click', onPanelClick);
    month.addEventListener('change', () => { viewMonth = Number(month.value); paint(); });
    year.addEventListener('change', () => { viewYear = Number(year.value); paint(); });

    return el;
  }

  function onPanelClick(ev) {
    const step = ev.target.closest('[data-step]');
    if (step) {
      shiftMonth(Number(step.dataset.step));
      return;
    }
    const day = ev.target.closest('[data-iso]');
    if (day && !day.disabled) {
      commit(fromIso(day.dataset.iso));
      return;
    }
    if (ev.target.closest('.dk-cal-clear')) {
      commit(null);
    }
  }

  function shiftMonth(by) {
    const next = new Date(viewYear, viewMonth + by, 1);
    viewYear = next.getFullYear();
    viewMonth = next.getMonth();
    paint();
  }

  // ── Painting ────────────────────────────────────────────────────────

  function paint() {
    if (!panel || !openFor) return;
    panel.querySelector('.dk-cal-month').value = String(viewMonth);
    panel.querySelector('.dk-cal-year').value = String(viewYear);

    const selected = fromIso(openFor.value);
    const now = today();
    const grid = panel.querySelector('.dk-cal-grid');

    // Always six rows. A month that needs five leaves the panel a row shorter, and
    // a popover that changes height as you step through months is jarring in a way
    // that is hard to name and easy to feel.
    const first = new Date(viewYear, viewMonth, 1);
    const start = new Date(viewYear, viewMonth, 1 - first.getDay());

    let html = '';
    for (let i = 0; i < 42; i += 1) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const outside = date.getMonth() !== viewMonth;
      const off = isDisabled(date, openFor);
      const classes = ['dk-cal-day'];
      if (outside) classes.push('is-outside');
      if (sameDay(date, now)) classes.push('is-today');
      if (sameDay(date, selected)) classes.push('is-selected');
      if (cursor && sameDay(date, cursor)) classes.push('is-cursor');
      html += `<button type="button" class="${classes.join(' ')}" data-iso="${iso(date)}"
        role="gridcell" tabindex="-1"${off ? ' disabled' : ''}
        aria-label="${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}"
        ${sameDay(date, selected) ? 'aria-selected="true"' : ''}>${date.getDate()}</button>`;
    }
    grid.innerHTML = html;

    paintQuick();
  }

  function paintQuick() {
    const row = panel.querySelector('.dk-cal-quick');
    const selected = fromIso(openFor.value);
    row.innerHTML = chipsFor(openFor).map(chip => {
      const off = isDisabled(chip.date, openFor);
      const on = sameDay(chip.date, selected);
      return `<button type="button" class="dk-cal-chip${on ? ' is-on' : ''}"
        data-iso="${iso(chip.date)}"${off ? ' disabled' : ''}
        title="${chip.note ? `${chip.label} — ${chip.note}` : chip.label}">${chip.label}</button>`;
    }).join('');

    const note = chipsFor(openFor).find(c => c.note);
    panel.querySelector('.dk-cal-note').textContent = note ? note.note : '';
  }

  // ── Position ────────────────────────────────────────────────────────

  /**
   * Under the field, or above it when there is no room below.
   *
   * position: fixed and measured against the VISUAL viewport, so the panel is not
   * pushed off screen by the on-screen keyboard, and does not need the page to
   * scroll to be seen.
   */
  function place(shell) {
    const box = shell.getBoundingClientRect();
    const vv = root.visualViewport;
    const vw = vv ? vv.width : window.innerWidth;
    const vh = vv ? vv.height : window.innerHeight;

    panel.hidden = false;
    const own = panel.getBoundingClientRect();
    const gap = 8;
    const margin = 10;

    let top = box.bottom + gap;
    if (top + own.height > vh - margin) {
      const above = box.top - gap - own.height;
      top = above >= margin ? above : Math.max(margin, vh - own.height - margin);
    }

    let left = box.left;
    if (left + own.width > vw - margin) left = vw - own.width - margin;
    if (left < margin) left = margin;

    panel.style.top = `${Math.round(top)}px`;
    panel.style.left = `${Math.round(left)}px`;
  }

  // ── Open / close / commit ───────────────────────────────────────────

  function open(input) {
    if (!input) return;
    if (openFor === input) { close(); return; }
    panel = panel || build();
    openFor = input;

    const selected = fromIso(input.value) || today();
    viewYear = selected.getFullYear();
    viewMonth = selected.getMonth();
    cursor = fromIso(input.value) || today();

    paint();
    const shell = input.closest('.date-shell') || input.parentElement;
    place(shell);
    shell?.classList.add('is-picking');
    panel.classList.add('is-open');

    // Focus the panel, not a day: focusing a day scrolls the page on some mobile
    // browsers, and the keydown handler is on the panel anyway.
    panel.setAttribute('tabindex', '-1');
    try { panel.focus({ preventScroll: true }); } catch { panel.focus(); }
  }

  function close() {
    if (!panel || !openFor) return;
    const shell = openFor.closest('.date-shell') || openFor.parentElement;
    shell?.classList.remove('is-picking');
    panel.classList.remove('is-open');
    panel.hidden = true;
    const wasFor = openFor;
    openFor = null;
    cursor = null;
    // Focus goes back to what opened it, so a keyboard user is not dropped at the
    // top of the document.
    try { (shell || wasFor).focus({ preventScroll: true }); } catch { /* not focusable */ }
  }

  function commit(date) {
    if (!openFor) return;
    const input = openFor;
    input.value = date ? iso(date) : '';
    // Both, in this order: script.js's updateDateUI listens for either, and other
    // code (the service-type rule that clears next-due, the filter controls) listens
    // for `change`. Dispatched rather than called so nothing has to know this file
    // exists.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    close();
  }

  // ── Keyboard ────────────────────────────────────────────────────────

  function onKeyDown(ev) {
    if (!openFor || !panel || panel.hidden) return;
    const step = {
      ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
    }[ev.key];

    if (step) {
      ev.preventDefault();
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + step);
      viewYear = cursor.getFullYear();
      viewMonth = cursor.getMonth();
      paint();
      return;
    }
    if (ev.key === 'PageUp' || ev.key === 'PageDown') {
      ev.preventDefault();
      cursor = addMonths(cursor, ev.key === 'PageUp' ? -1 : 1);
      viewYear = cursor.getFullYear();
      viewMonth = cursor.getMonth();
      paint();
      return;
    }
    if (ev.key === 'Home' || ev.key === 'End') {
      ev.preventDefault();
      const shift = ev.key === 'Home' ? -cursor.getDay() : 6 - cursor.getDay();
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + shift);
      paint();
      return;
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (cursor && !isDisabled(cursor, openFor)) commit(cursor);
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    }
  }

  // ── Wiring ──────────────────────────────────────────────────────────

  /**
   * Take over a date field.
   *
   * The input stays exactly where it is, with its name and its value. It simply
   * stops being the thing you click: `readOnly` keeps the native picker and the
   * typing cursor out of the way while leaving the value in the form, since a
   * disabled input is not submitted and a hidden one loses its validation.
   */
  function attach(input) {
    if (!input || input.dataset.dkCal === 'true') return;
    input.dataset.dkCal = 'true';
    input.readOnly = true;
    // Chrome still shows its indicator on a readonly date input; the CSS hides it,
    // and this stops a stray tap reaching it on browsers where it does not.
    input.setAttribute('tabindex', '-1');
    input.setAttribute('aria-hidden', 'true');

    const shell = input.closest('.date-shell') || input.parentElement;
    if (!shell) return;
    shell.classList.add('dk-cal-host');
    shell.setAttribute('role', 'button');
    shell.setAttribute('tabindex', '0');
    shell.setAttribute('aria-haspopup', 'dialog');

    shell.addEventListener('click', ev => {
      ev.preventDefault();
      open(input);
    });
    shell.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'ArrowDown') {
        ev.preventDefault();
        open(input);
      }
    });
  }

  function scan(scope) {
    (scope || document).querySelectorAll?.('input[type="date"][data-date-ui]').forEach(attach);
  }

  // Document-level listeners go on once. setup() itself is safe to call again —
  // script.js re-runs its date wiring when a section lazy-loads, and scan() is
  // guarded per input.
  let wired = false;

  function setup() {
    scan(document);
    if (wired) return;
    wired = true;
    document.addEventListener('keydown', onKeyDown, true);
    // Anything outside the panel and outside the field it belongs to closes it.
    document.addEventListener('pointerdown', ev => {
      if (!openFor || !panel || panel.hidden) return;
      if (panel.contains(ev.target)) return;
      const shell = openFor.closest('.date-shell') || openFor.parentElement;
      if (shell && shell.contains(ev.target)) return;
      close();
    }, true);
    // A scroll or a resize moves the field out from under the panel.
    window.addEventListener('scroll', () => { if (openFor) close(); }, true);
    window.addEventListener('resize', () => { if (openFor) close(); });
    console.log('[SpinLog] ✅ Date picker ready');
  }

  root.dkDatePicker = { setup, scan, attach, open, close, iso, fromIso, addMonths };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup, { once: true });
  } else {
    setup();
  }
})(typeof self !== 'undefined' ? self : this);
