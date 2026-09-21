// ════════════════════════════════════════════════════════════════════════
// SpinLog | DOES THIS DEVICE WANT MOTION?
//
// One answer, at true top level, because this file has several independent
// top-level scopes and three of them need it: the section swap inside the
// DOMContentLoaded closure, the search-jump highlight in the home-insights IIFE,
// and the overlay helpers below. Asking matchMedia in each place is cheap, but
// DECLARING it in each place is how you end up with two that disagree.
//
// Read live rather than cached. The preference can be changed while the app is
// open — on a phone it flips with the battery saver — and a cached boolean would
// keep animating for the rest of the session.
//
// It is also the reason every timer in this file that waits for a transition has
// to check: the reduced-motion block at the top of styles.css collapses durations
// to 0.001ms, so a 200ms setTimeout would sit there long after the CSS had
// finished, and a dialog would appear to hang on close.
// ════════════════════════════════════════════════════════════════════════
window.dkReduceMotion = function dkReduceMotion() {
  try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
};

// ════════════════════════════════════════════════════════════════════════
// SpinLog | ANIMATING SOMETHING THAT IS HIDDEN BY THE hidden ATTRIBUTE
//
// `[hidden] { display: none !important }` at the top of styles.css is absolute on
// purpose — the note above that rule lists nine elements that were silently
// failing to hide before it existed. The cost is that no element hidden that way
// can animate out: the attribute lands and the element is gone in the same frame.
//
// ── WHY THIS IS THE WEB ANIMATIONS API AND NOT A CSS TRANSITION ──────
//
// The first version of this added an `.is-closing` class that styles.css gave a
// fade to, waited for it with a timer, then set `hidden`. Everything about it
// looked right — the class landed, the computed `transition` on the element read
// `opacity 0.12s ease-in`, reduced motion was off — and the opacity still went
// from 1 to 0 between two frames with nothing in between.
//
// So did an INLINE `style.transition` + `style.opacity = 0` on the same element,
// which rules out every question about specificity, the cascade and the `!important`
// chains. A CSS transition simply would not start on `.dk-search-panel`, while the
// dialogs two blocks above it transition perfectly in the same browser on the same
// page. Rather than keep guessing at why — a `backdrop-filter` layer, the
// absolutely-positioned subtree, the ancestor that had just finished its own
// animation, all plausible and none provable from here — this stopped using the
// transition machinery.
//
// `el.animate()` does not care. It takes the keyframes, runs them on the
// compositor, and hands back a promise that resolves when the last frame has been
// committed. That promise is a better signal than a `setTimeout` guess anyway: it
// cannot drift, and it cannot fire early on a device that is dropping frames.
//
// Four surfaces use this — the search results, Sage's restore chooser, her four
// settings tab panels, and the two parking panes — and they are exactly the four
// that are hidden by the attribute rather than by a class.
//
// Both halves are idempotent. The running animation is parked on the element, so a
// second call cancels the first rather than leaving two fighting over one opacity.
// ════════════════════════════════════════════════════════════════════════

/** The shape each surface moves through. `x` slides sideways, `y` vertically. */
function dkMotionFrames(shift) {
  const s = shift || {};
  const x = s.x || '0px';
  const y = s.y || '0px';
  return [
    { opacity: 0, transform: `translate(${x}, ${y})` },
    { opacity: 1, transform: 'translate(0px, 0px)' },
  ];
}

function dkCancelMotion(el) {
  if (el && el._slAnim) {
    try { el._slAnim.cancel(); } catch { /* already finished */ }
    el._slAnim = null;
  }
}
// Exported for the one caller that shows an element WITHOUT animating it here,
// because CSS already owns its entrance: showTab() in sage-ui.js, where
// sagePanelIn plays the arrival. It still has to clear a forwards-filled exit
// from the previous tab switch, or the panel comes back at opacity 0.
window.dkCancelMotionFor = dkCancelMotion;

/**
 * Hide `el`, playing it out first.
 *
 * @param {Element} el
 * @param {number} [ms]        Duration. 150 unless the surface wants otherwise.
 * @param {object} [shift]     {x, y} — where it leaves to. Fade only if omitted.
 * @param {Function} [after]   Run once it is actually hidden.
 */
window.dkSlideShut = function dkSlideShut(el, ms = 150, shift, after) {
  if (!el) return;
  dkCancelMotion(el);
  const done = () => {
    el.hidden = true;
    el._slAnim = null;
    if (typeof after === 'function') after();
  };
  // Nothing to play: already gone, no motion wanted, or no support for it.
  if (el.hidden || window.dkReduceMotion() || typeof el.animate !== 'function') {
    done();
    return;
  }
  const anim = el.animate(dkMotionFrames(shift).slice().reverse(), {
    duration: ms,
    easing: 'ease-in',
    fill: 'forwards',
  });
  el._slAnim = anim;
  anim.finished
    .then(() => {
      // A newer call may have cancelled this one and started an open; if so the
      // element is not ours to hide any more.
      if (el._slAnim !== anim) return;
      done();
      // The forwards fill has to come off, or the element stays at opacity 0 the
      // next time it is shown.
      try { anim.cancel(); } catch { /* fine */ }
    })
    .catch(() => { /* cancelled by a newer call, which owns the element now */ });
};

/**
 * Show `el`, playing it in.
 *
 * @param {Element} el
 * @param {number} [ms]
 * @param {object} [shift]  {x, y} — where it arrives from.
 */
window.dkSlideOpen = function dkSlideOpen(el, ms = 190, shift) {
  if (!el) return;
  dkCancelMotion(el);
  el.hidden = false;
  if (window.dkReduceMotion() || typeof el.animate !== 'function') return;
  const anim = el.animate(dkMotionFrames(shift), { duration: ms, easing: 'ease-out' });
  el._slAnim = anim;
  anim.finished.then(() => { if (el._slAnim === anim) el._slAnim = null; }).catch(() => {});
};

// ════════════════════════════════════════════════════════════════════════
// SpinLog | BACK CLOSES WHAT IS ON TOP
//
// On a phone the back gesture is the primary way out of anything. This app had
// nothing between it and the section router: with a dialog open, an edge swipe
// went back a PAGE and left the dialog sitting over the section you had just
// arrived at. Worse on the last entry in the stack, where it closed the installed
// app outright with a modal still up.
//
// An overlay IS a page as far as the user is concerned, so it gets a history entry
// of its own, and back spends that entry instead of a section.
//
// ── HOW IT WORKS, AND THE THREE THINGS THAT MAKE IT SAFE ────────────
//
// 1. THE PUSHED ENTRY DOES NOT CHANGE THE URL. `pushState(state, '', location.href)`
//    adds a stack entry at the same address, so popping it cannot fire
//    `hashchange` — and `hashchange` is what drives the section router. Without
//    this, dismissing a dialog would also navigate a section back.
//
// 2. IT IS DRIVEN BY OBSERVATION, NOT BY CALL SITES. There are nine of these
//    surfaces and between them roughly twenty ways to close one — an X, a Cancel,
//    a backdrop click, Escape, a save that closes on success, a promise resolving.
//    Hooking each would mean editing every one and would still miss the next one
//    added. A MutationObserver on the roots watches the attributes that actually
//    carry the state, so every path is covered by construction.
//
// 3. CLOSING IS DELEGATED TO ESCAPE. Every one of these overlays already has a
//    working Escape handler, including the nesting rules between them — the slide
//    dialog swallows the key in the capture phase so it cannot also close the
//    settings dialog behind it, and the settings dialog closes its memory chooser
//    before itself. Dispatching Escape reuses all of that, along with each
//    overlay's own state cleanup. Re-deriving "which one is on top" here would be
//    a second copy of rules that already exist, and the two would drift.
//
// `held` is the whole state machine, and it is set to false BEFORE the close runs
// on a real back press. That is what stops the observer seeing the close, thinking
// it owns the entry, and calling history.back() a second time — which would eat a
// section or leave the app.
// ════════════════════════════════════════════════════════════════════════
(function dkBackGuard() {
  'use strict';

  /** Press a control if it is there, and report whether it was. */
  function tap(el) {
    if (!el) return false;
    el.click();
    return true;
  }

  /** Send Escape to a specific element, for the handlers bound to one. */
  function escape(target) {
    (target || document).dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
      bubbles: true, cancelable: true,
    }));
    return true;
  }

  /**
   * Every surface a back press should shut: how to tell it is up, and how to shut
   * it. Innermost first, because that is the order they stack on screen and the
   * first match is what gets closed.
   *
   * EACH ONE NAMES ITS OWN CLOSE, and the first version of this did not — it just
   * dispatched Escape at the document and trusted every overlay to have a handler.
   * Most do. The cover-date editor did not, so back pressed against it did nothing
   * at all, twice over: no Escape handler to catch the key, and no other route in.
   * (That gap is now filled as well, because a modal you cannot dismiss from the
   * keyboard is a fault on its own.)
   *
   * Pressing the overlay's own close BUTTON rather than reaching into its state is
   * deliberate. Every one of these has cleanup attached to that control — a promise
   * to resolve, a timer to clear, an interval polling a distance, focus to hand
   * back — and half of it lives in closures nothing out here can reach.
   */
  const SURFACES = [
    {
      // Created and removed at runtime by sage-confirm.js, so it is found by
      // selector rather than by id. `is-leaving` means it is already going.
      find: () => document.querySelector('.sl-slide-overlay:not(.is-leaving)'),
      // Its own API, which resolves the promise the caller is awaiting. Cancelling
      // any other way would leave that promise pending for ever.
      close: () => { window.SageConfirm?.dismiss(false); return true; },
    },
    {
      find: () => document.querySelector('.sl-modal-overlay.sl-modal--open'),
      close: (el) => tap(el.querySelector('.sl-modal-close, [data-sl-close]')) || escape(),
    },
    {
      find: () => document.querySelector('#docs .docs-modal.show'),
      close: (el) => tap(el.querySelector('.docs-modal-close, #historicNotesSkip')) || escape(),
    },
    {
      find: () => document.querySelector('.docs-player.is-open'),
      close: () => tap(document.getElementById('docsPlayerClose')) || escape(),
    },
    {
      // The loading / result popup. Included on purpose: one left up by a failed
      // write is exactly the kind of thing you try to back out of.
      find: () => document.querySelector('#customPopup.show'),
      close: () => { window.hidePopup?.(); return true; },
    },
    {
      find: () => {
        const p = document.getElementById('dkSearchPanel');
        return p && !p.hidden ? p : null;
      },
      // Its Escape handler is bound to the INPUT, not the document.
      close: () => escape(document.getElementById('dkSearchInput')),
    },
    {
      // Both dropdown menus listen for Escape on the document.
      find: () => document.querySelector('.custom-entry-select.is-open, .custom-history-select.is-open'),
      close: () => escape(),
    },
  ];

  function openSurface() {
    for (const surface of SURFACES) {
      let el = null;
      try { el = surface.find(); } catch { el = null; }
      if (el) return { el, surface };
    }
    return null;
  }

  let held = false;
  // Visible so tools/ can assert the state machine rather than infer it from
  // whether something happened to close.
  const debug = { pops: 0, pushes: 0, spends: 0 };
  Object.defineProperty(window, 'dkBackGuardState', {
    get: () => ({ held, open: !!openSurface(), ...debug }),
  });

  function sync() {
    const open = !!openSurface();
    if (open && !held) {
      held = true;
      debug.pushes += 1;
      // Same URL, so popping this cannot move the section router.
      try { history.pushState({ dkOverlay: true }, '', location.href); } catch { held = false; }
      return;
    }
    if (!open && held) {
      // Closed by its own UI rather than by back, so the entry we added is still on
      // the stack and has to be spent — otherwise back would need two presses.
      held = false;

      // ONLY IF OUR ENTRY IS STILL THE TOP ONE.
      //
      // Some surfaces close by navigating. Picking a result in the command-centre
      // search shuts the panel and then jumps to a section, and in that order: the
      // panel hides, the section pushes `#service`, and only then does this
      // observer run — MutationObserver callbacks are microtasks, so they land
      // after the click handler has finished. Spending unconditionally popped the
      // section that had just been pushed, so searching for a service record
      // dropped you back on whatever page you started from. It looked like the
      // search was picking the wrong section.
      //
      // `history.state` is the test. Ours carries `dkOverlay`; a section push
      // carries null. If the top of the stack is not ours, the entry is buried
      // under a real navigation and must be left alone — one stale entry costs a
      // single extra back press somewhere harmless, and undoing a navigation the
      // user asked for does not.
      try {
        if (history.state && history.state.dkOverlay) {
          debug.spends += 1;
          history.back();
        }
      } catch { /* nothing to go back to */ }
    }
  }

  window.addEventListener('popstate', () => {
    debug.pops += 1;
    if (!held) return;                  // not ours: let the section router have it
    const found = openSurface();
    if (!found) { held = false; return; }
    // BEFORE the close, so the observer below sees held === false and does not try
    // to spend an entry the browser has already popped. Getting this the wrong way
    // round eats a section, or exits the app.
    held = false;
    try { found.surface.close(found.el); } catch { /* leave it up rather than break */ }
  });

  function watch() {
    // Feature-checked rather than assumed. Every browser this app supports has it,
    // but tools/audit-boot.mjs evaluates these files against a minimal stub of a
    // document and reports any ReferenceError as a real fault — which is exactly
    // the signal it exists to give, so it should not be spent on a missing DOM API.
    if (!document.body || typeof MutationObserver !== 'function') return;
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      subtree: true,
      childList: true,                  // the slide overlay is added and removed
      attributes: true,
      attributeFilter: ['class', 'hidden', 'aria-hidden'],
    });
    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();

// ════════════════════════════════════════════════════════════════════════
// SpinLog | WHEN WAS THIS FILE ACTUALLY FROM?
//
// An upload's date should be the date the thing HAPPENED, not the date it was
// uploaded. Those are the same for a photo taken minutes ago and years apart for
// everything else in this archive — the point of "Historic Audio & Images" is that
// most of it is older than the app.
//
// FOUR SOURCES, best first, because each is wrong in a different way:
//
//   1. EXIF DateTimeOriginal. The only thing that means "when the shutter opened".
//      JPEG only, and absent from anything re-encoded by a messaging app.
//
//   2. The ISO-BMFF creation time, from the `mvhd` box. MP4, M4A and MOV all carry
//      one, which matters here because half this archive is engine-sound recordings
//      whose filenames say the mileage rather than the date.
//
//   3. The FILENAME. Cameras and messaging apps both stamp it, and this is the one
//      that survives everything else: `20260320_125133.jpg` and `WhatsApp Video
//      2026-04-19 at 3.11.15 PM.mp4` are both in this archive, and for the second
//      one it is the ONLY correct source — WhatsApp rewrites lastModified to the
//      moment you downloaded it. Human forms like "27th june" are read too, with
//      the year taken from a reference date, because a person writing that means
//      the one that has just happened.
//
//   4. file.lastModified. Always present, and for a file copied between devices it
//      is the copy time. Last resort rather than first.
//
// The reader is split so both callers can share it: an upload has a File in hand,
// while the backfill for files already in the bucket has only a range of bytes
// fetched over HTTP. Neither should have its own copy of an EXIF parser.
// ════════════════════════════════════════════════════════════════════════
window.dkMediaDate = (function () {
  'use strict';

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  /**
   * A month number from a written month, or -1.
   *
   * WHOLE WORD, not the first three letters. Slicing to three and looking them up in
   * MONTHS meant "Marathon 12, 2025" read as 12 March and "Service-3-2025" as 3
   * September — a word that merely starts like a month became a date. The abbreviation
   * has to be one anybody actually writes: Sep, Sept, September.
   */
  function monthIndex(word) {
    const w = String(word || '').trim().toLowerCase();
    if (!/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)([a-z]*)$/.test(w)) return -1;
    const short = w.slice(0, 3);
    const full = ['january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'];
    const idx = MONTHS.indexOf(short);
    if (idx === -1) return -1;
    // Either the bare abbreviation, the conventional four-letter "Sept", or the whole
    // word. Anything else that happens to start with three month letters is not one.
    if (w === short || w === 'sept' || w === full[idx]) return idx;
    return -1;
  }

  /**
   * A Date, or null if it is not one worth believing.
   *
   * Both ends of the window are load-bearing. Nothing here predates digital
   * cameras, and nothing in an archive of things that have already happened is in
   * the future — and both DO turn up: a device with a flat battery and a wrong
   * clock, a filename whose digits merely look like a date, and an `mvhd` box full
   * of zeroes, which decodes to 1904.
   */
  function ok(d) {
    if (!d || Number.isNaN(d.getTime())) return null;
    const year = d.getFullYear();
    if (year < 1995 || d.getTime() > Date.now() + 86400000) return null;
    return d;
  }

  /** The LOCAL calendar day, as YYYY-MM-DD. Never toISOString().slice(10). */
  function iso(d) {
    const good = ok(d);
    if (!good) return null;
    return `${good.getFullYear()}-${String(good.getMonth() + 1).padStart(2, '0')}`
      + `-${String(good.getDate()).padStart(2, '0')}`;
  }

  /**
   * The full instant, as an ISO string, or null.
   *
   * This is the part that used to be thrown away. EXIF carries DateTimeOriginal to
   * the second and `mvhd` carries a creation time to the second, and both were being
   * truncated to a day to fit a `date` column — so the Record History table, which
   * prints the day over the time, lost its time line the moment a row was dated.
   * The time it showed before that came from upload_date, which is the minute the
   * file arrived dressed up as the minute it was recorded.
   */
  function stamp(d) {
    const good = ok(d);
    return good ? good.toISOString() : null;
  }

  /**
   * Does this source know a real clock reading, or only a day?
   *
   * @param {Date|null} d
   * @param {string} source One of detail()'s source strings.
   *
   * Matched against the marker rather than against a list of good sources, so a
   * reader added later is trusted by default and has to opt out. The check used to be
   * `source !== 'day-only'`, a string nothing has ever produced — it answered true for
   * everything, including the bare-date-in-a-filename case it existed to catch.
   */
  function hasClock(d, source) {
    if (!ok(d)) return false;
    return !/day only/i.test(String(source || ''));
  }

  /** Four ASCII bytes at `at`, or null. Chunk and box type tags. */
  function fourCC(view, at) {
    if (at < 0 || at + 4 > view.byteLength) return null;
    let s = '';
    for (let i = 0; i < 4; i += 1) s += String.fromCharCode(view.getUint8(at + i));
    return s;
  }

  /**
   * A capture time out of a TIFF header, wherever that header happens to be.
   *
   * SEPARATE FROM THE JPEG WALK ON PURPOSE. This used to be inlined in fromExif and
   * therefore reachable only through a JPEG's APP1 marker — which meant a PNG whose
   * `eXIf` chunk holds the identical bytes got nothing, and so did a WebP, a HEIC and
   * a raw TIFF. The container and the metadata are two different questions.
   *
   * @param {DataView} view
   * @param {number} tiff Offset of the byte-order mark: 'II' or 'MM'.
   * @returns {Date|null}
   */
  function readExifTiff(view, tiff) {
    if (tiff < 0 || tiff + 8 > view.byteLength) return null;
    const order = view.getUint16(tiff);
    if (order !== 0x4949 && order !== 0x4D4D) return null;         // not II or MM
    const little = order === 0x4949;
    const get16 = (o) => (o + 2 <= view.byteLength ? view.getUint16(o, little) : null);
    const get32 = (o) => (o + 4 <= view.byteLength ? view.getUint32(o, little) : null);
    if (get16(tiff + 2) !== 0x2A) return null;                     // the 42 magic

    const readIfd = (offset, tag) => {
      if (offset < 0 || offset + 2 > view.byteLength) return null;
      const count = get16(offset);
      // A real IFD has a handful of entries. Four digits of them means this is not
      // an IFD at all, which matters because fromTiffScan guesses at the offset.
      if (count === null || count === 0 || count > 512) return null;
      for (let i = 0; i < count; i += 1) {
        const entry = offset + 2 + i * 12;
        if (entry + 12 > view.byteLength) return null;
        if (get16(entry) === tag) return get32(entry + 8);
      }
      return null;
    };

    /** The 19 ASCII bytes of "YYYY:MM:DD HH:MM:SS" at a tag's value offset. */
    const readStamp = (offset) => {
      if (offset === null || tiff + offset + 19 > view.byteLength) return null;
      let text = '';
      for (let i = 0; i < 19; i += 1) {
        const c = view.getUint8(tiff + offset + i);
        if (!c) break;
        text += String.fromCharCode(c);
      }
      const m = text.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
      if (!m) return null;
      return ok(new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    };

    const ifd0Rel = get32(tiff + 4);
    if (ifd0Rel === null) return null;
    const ifd0 = tiff + ifd0Rel;

    // Three tags, in order of how much they mean:
    //   0x9003 DateTimeOriginal   when the shutter opened
    //   0x9004 DateTimeDigitized  when it was scanned or transferred
    // both inside the Exif sub-IFD that 0x8769 points at, and
    //   0x0132 DateTime           in IFD0, the file's own modification stamp
    // The third is what an editor writes on export and what most PNG eXIf blocks
    // carry, and it is still a real clock reading — better than lastModified, which
    // is the only thing below it.
    const exifPtr = readIfd(ifd0, 0x8769);
    if (exifPtr !== null) {
      const shot = readStamp(readIfd(tiff + exifPtr, 0x9003))
        || readStamp(readIfd(tiff + exifPtr, 0x9004));
      if (shot) return shot;
    }
    return readStamp(readIfd(ifd0, 0x0132));
  }

  // ── EXIF, from a JPEG's APP1 block ──────────────────────────────────
  function fromExif(view) {
    if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return null;   // not a JPEG

    let at = 2;
    while (at + 4 < view.byteLength) {
      if (view.getUint8(at) !== 0xFF) { at += 1; continue; }
      const marker = view.getUint8(at + 1);
      const size = view.getUint16(at + 2);
      // APP1 is usually EXIF and sometimes XMP, and a file can carry both in either
      // order — so a non-EXIF APP1 must be stepped over rather than ending the walk.
      if (marker === 0xE1 && fourCC(view, at + 4) === 'Exif') {
        const found = readExifTiff(view, at + 10);           // past "Exif\0\0"
        if (found) return found;
      }
      if (marker === 0xDA) break;          // start of scan: no metadata past here
      if (size < 2) break;
      at += 2 + size;
    }
    return null;
  }

  // ── PNG ─────────────────────────────────────────────────────────────
  /**
   * PNG carries three possible answers and none of them is EXIF-in-a-JPEG.
   *
   *   eXIf           a whole TIFF block, same bytes a JPEG would hold (PNG 1.5+)
   *   tEXt / iTXt    a "Creation Time" keyword, which is a free-form date string
   *   tIME           7 bytes of last-modification time, and it is UTC
   *
   * SCANNED FOR THE CHUNK TYPE rather than walked from the signature, and that is
   * deliberate. A PNG larger than the 256KB slice we hold ends a proper walk at the
   * first IDAT — megabytes of pixels we do not have — and the tail slice this is also
   * handed has no PNG signature at the front of it. So a walk finds nothing in
   * exactly the two cases a walk was meant to help with.
   *
   * Four bytes could match by accident. Every candidate then has to survive a real
   * parse and ok()'s 1995-to-now window, so the cost of a coincidence is one failed
   * read rather than a wrong date.
   */
  function fromPng(view) {
    let exifHit = null;
    let textHit = null;
    let timeHit = null;
    for (let i = 0; i + 8 <= view.byteLength; i += 1) {
      // Gated on the first byte before building a string, or this allocates a
      // four-character string per byte of a 256KB slice. Every type below starts with
      // 'e', 't' or 'i'. Same trick the mvhd scan uses with 'm'.
      const b0 = view.getUint8(i);
      if (b0 !== 0x65 && b0 !== 0x74 && b0 !== 0x69) continue;
      const type = fourCC(view, i);
      if (type === null) break;
      // Chunk layout: length(4) type(4) data(length) crc(4). `i` is at the type, so
      // the length is behind it and the data starts in front.
      const data = i + 4;
      if (!exifHit && type === 'eXIf') exifHit = readExifTiff(view, data);
      else if (!timeHit && type === 'tIME') timeHit = readPngTime(view, data);
      else if (!textHit && (type === 'tEXt' || type === 'iTXt')) {
        const len = i >= 4 ? view.getUint32(i - 4) : 0;
        textHit = readPngCreationTime(view, data, len);
      }
      if (exifHit) break;                  // nothing below it can be better
    }
    return exifHit || textHit || timeHit || null;
  }

  /** tIME: year(2) month day hour minute second, in UTC per the spec. */
  function readPngTime(view, at) {
    if (at + 7 > view.byteLength) return null;
    const y = view.getUint16(at);
    const mo = view.getUint8(at + 2);
    const d = view.getUint8(at + 3);
    const h = view.getUint8(at + 4);
    const mi = view.getUint8(at + 5);
    const s = view.getUint8(at + 6);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;
    return ok(new Date(Date.UTC(y, mo - 1, d, h, mi, s)));
  }

  /**
   * A tEXt or iTXt chunk whose keyword is "Creation Time".
   *
   * The value is whatever the writer felt like — RFC 1123, ISO 8601, or a local
   * format — so it goes through Date's own parser rather than a regex, and then
   * through ok(). iTXt has compression and language bytes between the keyword and
   * the text; they are skipped by taking everything after the last NUL.
   */
  function readPngCreationTime(view, at, len) {
    const cap = Math.min(view.byteLength, at + Math.min(len || 0, 512));
    if (cap <= at) return null;
    let text = '';
    for (let i = at; i < cap; i += 1) text += String.fromCharCode(view.getUint8(i));
    const parts = text.split('\0');
    if (!/^creation\s*time$/i.test((parts[0] || '').trim())) return null;
    const value = parts[parts.length - 1].trim();
    if (!value) return null;
    const parsed = new Date(value);
    return ok(Number.isNaN(parsed.getTime()) ? null : parsed);
  }

  /**
   * Last resort for a container nothing above recognises: find the TIFF header.
   *
   * WebP keeps EXIF in a RIFF `EXIF` chunk, HEIC in a `meta` item, and both hold the
   * same 'II*\0' or 'MM\0*' block a JPEG does. Rather than learn two more container
   * formats to reach identical bytes, look for the bytes.
   */
  function fromTiffScan(view) {
    for (let i = 0; i + 8 <= view.byteLength; i += 1) {
      const b0 = view.getUint8(i);
      if (b0 !== 0x49 && b0 !== 0x4D) continue;                  // 'I' or 'M'
      const order = view.getUint16(i);
      if (order !== 0x4949 && order !== 0x4D4D) continue;
      const found = readExifTiff(view, i);
      if (found) return found;
    }
    return null;
  }

  // ── ISO base media: MP4, M4A, MOV ───────────────────────────────────
  //
  // The creation time lives in `moov` > `mvhd`, and `moov` is at the front of the
  // file on some encoders and behind a multi-megabyte `mdat` on others — a phone
  // camera usually writes it last. So: walk the top-level boxes properly, and if
  // the walk runs off the end of the bytes we have, fall back to scanning them for
  // the `mvhd` signature. The scan can in principle hit four matching bytes inside
  // compressed audio; the date window in ok() is what makes that harmless, and the
  // backfill shows every value for review before writing any of it.
  //
  // The epoch is 1904-01-01 UTC, not 1970. Sixty-six years, which is exactly the
  // kind of off-by-a-lifetime that looks like a working parser until you read a
  // date.
  const MP4_EPOCH_OFFSET = 2082844800;

  function readMvhd(view, at) {
    // at points to the start of the mvhd box body, just past size+type.
    if (at + 20 > view.byteLength) return null;
    const version = view.getUint8(at);
    let seconds;
    if (version === 1) {
      if (at + 12 > view.byteLength) return null;
      // 64-bit. The high word is zero for every real date, so the low word is the
      // whole answer and this avoids BigInt.
      const high = view.getUint32(at + 4);
      const low = view.getUint32(at + 8);
      if (high !== 0) return null;
      seconds = low;
    } else if (version === 0) {
      seconds = view.getUint32(at + 4);
    } else {
      return null;
    }
    if (!seconds) return null;                       // zeroed, which means unset
    return ok(new Date((seconds - MP4_EPOCH_OFFSET) * 1000));
  }

  function typeAt(view, at) {
    if (at + 8 > view.byteLength) return null;
    let s = '';
    for (let i = 0; i < 4; i += 1) s += String.fromCharCode(view.getUint8(at + 4 + i));
    return s;
  }

  function fromIsoBmff(view) {
    // Only bother if this looks like one: box 1 is normally `ftyp`.
    // Walk the top level looking for moov, then its children for mvhd.
    let at = 0;
    let sawBox = false;
    while (at + 8 <= view.byteLength) {
      const size = view.getUint32(at);
      const type = typeAt(view, at);
      if (!type || !/^[a-zA-Z0-9 ]{4}$/.test(type)) break;
      sawBox = true;
      if (type === 'moov') {
        // Children start right after this box's header.
        let child = at + 8;
        const stop = Math.min(view.byteLength, size > 8 ? at + size : view.byteLength);
        while (child + 8 <= stop) {
          const csize = view.getUint32(child);
          const ctype = typeAt(view, child);
          if (ctype === 'mvhd') return readMvhd(view, child + 8);
          if (!csize || csize < 8) break;
          child += csize;
        }
        break;
      }
      if (size === 0) break;              // "to end of file"
      if (size < 8) break;                // 1 means a 64-bit largesize; not worth it
      at += size;
    }

    if (!sawBox) return null;

    // moov was not in the bytes we hold. Scan for the signature instead.
    for (let i = 0; i + 12 <= view.byteLength; i += 1) {
      if (view.getUint8(i) !== 0x6D) continue;                 // 'm'
      if (typeAt(view, i - 4) !== 'mvhd') continue;
      const found = readMvhd(view, i + 4);
      if (found) return found;
    }
    return null;
  }

  // ── The filename ────────────────────────────────────────────────────
  /**
   * @param {string} name
   * @param {Date|number|null} [reference] Used only to supply a YEAR to a name that
   *   gives a day and a month and no year — "27th june". A person writing that means
   *   the one that has just happened, so the year is the reference's, stepped back
   *   by one if that would put the date in the reference's future.
   */
  function fromName(name, reference) {
    const text = String(name || '');

    // A COLON IS ILLEGAL IN A FILENAME, on Windows and on macOS both, so no writer
    // that stamps a time into one can use the obvious separator. Every pattern below
    // therefore accepts '.', '_', '-' or ':' between the parts of the clock reading,
    // and that is why they cannot simply look for HH:MM:SS.
    const CLOCK = '(\\d{1,2})[._:-](\\d{2})(?:[._:-](\\d{2}))?\\s*(AM|PM)?';
    const numeric = [
      // WhatsApp: "2026-04-19 at 3.11.15 PM". Also plain "2026-09-21 14.16.47" and
      // "2026-09-21, 14_16", which the `at` used to be required for.
      new RegExp(`(\\d{4})-(\\d{2})-(\\d{2})(?:\\s+at\\s+|,?\\s+)${CLOCK}`, 'i'),
      // Camera: 20260320_125133  /  IMG_20240712_143500
      /(?:^|[^\d])(\d{4})(\d{2})(\d{2})[_\-T](\d{2})(\d{2})(\d{2})(?:[^\d]|$)/,
      // Screenshot / plain date: 2026-04-19, 20260320
      /(?:^|[^\d])(\d{4})-(\d{2})-(\d{2})(?:[^\d]|$)/,
      /(?:^|[^\d])(\d{4})(\d{2})(\d{2})(?:[^\d]|$)/,
    ];
    for (const re of numeric) {
      const m = text.match(re);
      if (!m) continue;
      // Whether the pattern that matched actually captured a clock reading. The
      // first two do; the last two are a bare date and get noon, which is a
      // placeholder and must not be presented as a time.
      const timed = !!m[4];
      let hour = timed ? Number(m[4]) : 12;
      const mer = m[7];
      if (mer) {
        if (/pm/i.test(mer) && hour < 12) hour += 12;
        if (/am/i.test(mer) && hour === 12) hour = 0;
      }
      const found = ok(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
        hour, m[5] ? Number(m[5]) : 0, m[6] ? Number(m[6]) : 0));
      if (found) { found.dkTimed = timed; return found; }
    }

    // ── A WRITTEN MONTH WITH A FULL YEAR AND A CLOCK READING ──
    //
    // "ChatGPT Image Sep 21, 2026, 02_16_47 PM.png" — and every other tool that names
    // an export the way a person would write the date. None of the numeric patterns
    // above touch it, so it used to fall through to the day-and-month reader below,
    // which returns a DAY: the file said 2:16 pm and the row showed no time at all.
    //
    // Distinct from that reader because this form carries its own year and its own
    // time, so it needs no reference date and loses nothing.
    const written = [
      // "Sep 21, 2026, 02_16_47 PM"  ·  "September 21 2026 at 2.16 PM"
      new RegExp(`([a-z]{3,9})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`
        + `(?:,|\\s+at)?\\s+${CLOCK}`, 'i'),
      // "21 Sep 2026 14.16"  ·  "21st June 2025, 9.30 PM"
      new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+([a-z]{3,9})\\.?,?\\s+(\\d{4})`
        + `(?:,|\\s+at)?\\s+${CLOCK}`, 'i'),
    ];
    for (let i = 0; i < written.length; i += 1) {
      const m = text.match(written[i]);
      if (!m) continue;
      const monthText = i === 0 ? m[1] : m[2];
      const dayText = i === 0 ? m[2] : m[1];
      const month = monthIndex(monthText);
      const day = Number(dayText);
      if (month === -1 || !(day >= 1 && day <= 31)) continue;
      let hour = Number(m[4]);
      const mer = m[7];
      if (mer) {
        if (/pm/i.test(mer) && hour < 12) hour += 12;
        if (/am/i.test(mer) && hour === 12) hour = 0;
      }
      const found = ok(new Date(Number(m[3]), month, day,
        hour, m[5] ? Number(m[5]) : 0, m[6] ? Number(m[6]) : 0));
      if (found) { found.dkTimed = true; return found; }
    }

    // "27th june", "3 Aug", "Dec 14". Only used when there is a reference to take
    // the year from — a bare day and month on its own is a guess, not a date.
    if (reference) {
      const ref = new Date(reference);
      if (!Number.isNaN(ref.getTime())) {
        const dayFirst = text.match(/(?:^|[^\d])(\d{1,2})(?:st|nd|rd|th)?[\s\-_.]*([a-z]{3,})/i);
        const monthFirst = text.match(/([a-z]{3,})[\s\-_.]*(\d{1,2})(?:st|nd|rd|th)?(?:[^\d]|$)/i);
        for (const m of [dayFirst, monthFirst]) {
          if (!m) continue;
          const isDayFirst = m === dayFirst;
          const dayText = isDayFirst ? m[1] : m[2];
          const monthText = isDayFirst ? m[2] : m[1];
          const month = monthIndex(monthText);
          const day = Number(dayText);
          if (month === -1 || !(day >= 1 && day <= 31)) continue;
          let year = ref.getFullYear();
          let d = new Date(year, month, day, 12, 0, 0);
          // A month later than the reference means last year's one.
          if (d.getTime() > ref.getTime() + 86400000) d = new Date(year - 1, month, day, 12, 0, 0);
          const found = ok(d);
          // "27th june" is a day. The noon is arithmetic, not a time.
          if (found) { found.dkTimed = false; return found; }
        }
      }
    }
    return null;
  }

  // ── Public ──────────────────────────────────────────────────────────

  /**
   * Read the metadata out of bytes already in hand.
   * @returns {{date: string, source: string}|null}
   */
  function fromBytes(buffer, name) {
    if (!buffer || !buffer.byteLength) return null;
    const view = new DataView(buffer);

    // Sniffed by content, not by extension, because half these filenames have been
    // through a messaging app and an `.m4a` that is really an MP4 is routine.
    //
    // Every reader below is accurate to the second, so anything that answers here
    // carries a real time as well as a day.
    let found = null;
    if (view.byteLength > 3 && view.getUint16(0) === 0xFFD8) found = fromExif(view);
    if (found) return { date: iso(found), at: stamp(found), source: 'exif' };

    // PNG, checked by signature at the front OR by extension, because the tail slice
    // of a large file has no signature in it and is where a late tIME chunk lives.
    const isPng = (view.byteLength > 8 && view.getUint32(0) === 0x89504E47)
      || /\.png$/i.test(String(name || ''));
    if (isPng) {
      found = fromPng(view);
      if (found) return { date: iso(found), at: stamp(found), source: 'png' };
    }

    found = fromIsoBmff(view);
    if (found) return { date: iso(found), at: stamp(found), source: 'mvhd' };

    // Nothing recognised the container. The EXIF block may still be in there — WebP
    // and HEIC both hold one — so look for the bytes rather than for the wrapper.
    found = fromTiffScan(view);
    if (found) return { date: iso(found), at: stamp(found), source: 'exif' };

    return null;
  }

  /**
   * Everything knowable about a File the user has just chosen.
   * @returns {Promise<{date: string|null, at: string|null, source: string}>}
   *   `date` is the local calendar day. `at` is the full instant, and is null when
   *   the source only knew a day — a bare date in a filename, or a lastModified that
   *   is really a copy time. A row with a null `at` shows no clock reading, which is
   *   the honest outcome: inventing "12:00 am" would claim a precision the file did
   *   not have.
   */
  async function detail(file) {
    if (!file) return { date: null, at: null, source: 'none' };
    try {
      // 256KB from the front covers every EXIF block and a front-loaded moov.
      const head = file.slice ? await file.slice(0, 262144).arrayBuffer().catch(() => null) : null;
      let hit = head ? fromBytes(head, file.name) : null;

      // A phone camera writes moov AFTER the media data, so for anything of any
      // size the front of the file will not have it. One more read from the tail.
      if (!hit && file.slice && file.size > 262144) {
        const tail = await file.slice(Math.max(0, file.size - 262144)).arrayBuffer().catch(() => null);
        if (tail) hit = fromBytes(tail, file.name);
      }
      if (hit && hit.date) return { date: hit.date, at: hit.at, source: hit.source };

      const named = fromName(file.name, file.lastModified || Date.now());
      if (named) {
        const day = iso(named);
        let at = named.dkTimed ? stamp(named) : null;
        let source = named.dkTimed ? 'name' : 'name (day only)';
        // The name knew a day and no time — "Screenshot 2026-04-19.png", "27th june".
        // lastModified knows a time, and whether it is worth anything depends entirely
        // on WHICH DAY it lands on. The same day as the name means a file that was
        // written here and left alone, and its clock reading is probably the real one.
        // A different day means it has been copied since, and then the time says when
        // the copy happened and nothing at all about the recording.
        if (!at) {
          const mod = file.lastModified ? new Date(file.lastModified) : null;
          if (ok(mod) && iso(mod) === day) {
            at = stamp(mod);
            source = 'name + timestamp';
          }
        }
        return { date: day, at, source };
      }

      // lastModified, and it DOES get to supply a clock reading.
      //
      // It used to return at: null, on the grounds that for anything copied between
      // devices this is the copy time rather than the capture time. That reasoning is
      // still true and it is still the weakest source here — but refusing it meant a
      // file with no EXIF, no mvhd and no date in its name could never show a time at
      // all, which is most graphics and most screenshots. "Title.png" uploaded with a
      // day and no time, and there was nowhere to say otherwise.
      //
      // What changed is that the answer is now editable. It lands in a Time field the
      // rider is looking at, beside the Date field this same value already filled, and
      // emptying it is one tap. A suggestion that can be corrected beats a blank.
      //
      // The BACKFILL is unaffected and must stay that way: it works from bytes fetched
      // over HTTP, has no File and so never reaches this branch. Nothing it writes
      // without someone reading it first is a guess of this strength.
      const mod = file.lastModified ? new Date(file.lastModified) : null;
      if (ok(mod)) return { date: iso(mod), at: stamp(mod), source: 'lastModified' };
      return { date: null, at: null, source: 'none' };
    } catch {
      return { date: null, at: null, source: 'none' };
    }
  }

  /** Just the day, for the callers that only ever wanted that. */
  async function fromFile(file) {
    return (await detail(file)).date;
  }

  return { detail, fromFile, fromBytes, fromName, iso, stamp, ok, hasClock };
})();

/** Kept as the name the upload path calls, and the one the audits assert. */
window.dkFileDate = function dkFileDate(file) {
  return window.dkMediaDate.fromFile(file);
};

/**
 * The clock reading from `stamp`, moved onto `day`. '' when there is no reading.
 *
 * Used whenever a DAY is corrected on a row that already has real metadata, which is
 * the common case: the correction is usually off-by-one, a file recorded at 11pm on
 * the 26th that every reader agrees is the 27th. Moving the day and keeping 23:14
 * preserves the one fact the file actually reported; the alternative is throwing the
 * time away because the day beside it moved.
 *
 * AT TRUE TOP LEVEL, and that is not tidiness. Four callers need it and they are in
 * three different scopes — the backfill above, the Record History edit sheet inside
 * the big DOMContentLoaded closure, and Sage's set_media_date tool. None of those can
 * see the others' locals, and a second copy is how two of them end up disagreeing
 * about what "keep the time" means.
 */
function historicStampOnDay(stamp, day) {
  if (!stamp || !/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return '';
  const from = new Date(stamp);
  if (Number.isNaN(from.getTime())) return '';
  const [y, m, d] = String(day).split('-').map(Number);
  // Built from LOCAL parts so the clock reading the rider can see is the one that is
  // kept. Rebuilding it in UTC moves the displayed time by the timezone offset.
  const moved = new Date(y, m - 1, d, from.getHours(), from.getMinutes(), from.getSeconds());
  return Number.isNaN(moved.getTime()) ? '' : moved.toISOString();
}

/**
 * An instant as the 'HH:MM' an <input type="time"> wants, in the rider's own zone.
 * '' when there is no instant, which is what an empty time field means.
 */
function historicClockOf(stamp) {
  if (!stamp) return '';
  const d = new Date(stamp);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * The reverse: a local day plus 'HH:MM' back into an ISO instant.
 *
 * Returns '' for a blank time rather than midnight, and that distinction is the
 * whole point of the field. Midnight is a real reading that some files genuinely
 * have; blank means nobody knows, and the two must not collapse into each other.
 */
function historicStampFrom(day, clock) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return '';
  const m = String(clock || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const [y, mo, d] = String(day).split('-').map(Number);
  const at = new Date(y, mo - 1, d, Number(m[1]), Number(m[2]), 0);
  return Number.isNaN(at.getTime()) ? '' : at.toISOString();
}

// ════════════════════════════════════════════════════════════════════════
// SpinLog | DATING THE UPLOADS THAT ARE ALREADY IN THE BUCKET
//
// dkFileDate only helps a file being chosen now. Everything uploaded before it
// existed has `historic_date` null and shows its upload date instead, which for an
// archive of old recordings is the one date that is never interesting: an engine
// sound from the 27th of June reads as uploaded in August, because it was.
//
// The metadata is still there. It is just inside a file in a private bucket rather
// than in a File object, so this fetches enough of each one to read it — a signed
// URL and an HTTP Range request, 256KB from the front and, when that is not where
// the encoder put the `moov` box, 256KB from the back. Nothing is downloaded whole.
//
// ── IT IS A DRY RUN UNLESS YOU SAY OTHERWISE ────────────────────────
//
//   await dkBackfillMediaDates()                → prints a table, writes nothing
//   await dkBackfillMediaDates({ apply: true }) → writes the ones it is sure of
//
// This edits real rows in a live database, so the default has to be the harmless
// one, and every proposed value has to be visible before anything is committed. The
// table names the SOURCE for each date as well as the date, because "exif" and
// "name" and "mvhd" do not deserve equal trust and the person reading it is the
// only one who knows which files came through WhatsApp.
//
// Three rules it will not break:
//   · A row that already has a `taken_at` is never touched. That is the most complete
//     answer there is — an instant, from the file — and nothing here can improve it.
//   · A row that has a `historic_date` and no `taken_at` is re-read, but only its
//     TIME can be added. If the metadata disagrees about the day, the stored day
//     wins: it was either set by hand in the edit sheet or written by an earlier run
//     of this, and a correction someone made on purpose is not up for revision.
//   · A row whose date cannot be worked out is left alone rather than being given
//     its upload date, which is what it already falls back to on screen. Writing a
//     guess would turn "unknown" into "wrong" and hide it from the next attempt.
//     The same goes for the time: a source that only knew a day leaves taken_at
//     null, because an invented "12:00 am" reads exactly like a real reading.
// ════════════════════════════════════════════════════════════════════════
window.dkBackfillMediaDates = async function dkBackfillMediaDates(options) {
  'use strict';
  const opts = options || {};
  const apply = opts.apply === true;
  const BUCKET = 'historic-media';
  const CHUNK = 262144;

  const sb = window.supabaseClient;
  if (!sb) { console.error('[SpinLog] No database connection.'); return null; }

  // `*` rather than a column list, for the same reason cloud-store uses it: naming
  // `taken_at` on a database that has not run media_taken_at.sql 400s the whole read,
  // and this tool would report "could not read the uploads" over a column it is only
  // checking. `*` cannot be wrong about the schema.
  const { data: rows, error } = await sb.from('media_files').select('*')
    .order('id', { ascending: true });
  if (error) { console.error('[SpinLog] Could not read the uploads:', error.message); return null; }
  if (rows.length && !('taken_at' in rows[0])) {
    console.warn('[SpinLog] media_files has no taken_at column, so only DAYS can be '
      + 'written — run supabase/media_taken_at.sql once, then run this again for the times.');
  }

  /** One ranged read. Returns an ArrayBuffer or null; never throws. */
  async function range(url, from, to) {
    try {
      const res = await fetch(url, { headers: { Range: `bytes=${from}-${to}` } });
      // 206 is a real partial response. A 200 means the server ignored the header
      // and sent everything, which is still usable — just bigger than asked for.
      if (!res.ok && res.status !== 206) return null;
      return await res.arrayBuffer();
    } catch { return null; }
  }

  const plan = [];
  for (const row of rows) {
    const current = row.historic_date ? String(row.historic_date).slice(0, 10) : null;
    const timed = row.taken_at ? String(row.taken_at) : null;
    // An instant already on the row is the complete answer. Nothing below can beat
    // it, so the file is not even fetched.
    if (timed) {
      plan.push({ row, current, timed, next: null, at: null, source: 'already timed' });
      continue;
    }

    // The filename first, because it costs nothing and is the most trustworthy
    // source for anything that has been through a messaging app.
    const named = window.dkMediaDate.fromName(row.original_name, row.upload_date);
    let next = named ? window.dkMediaDate.iso(named) : null;
    // Only when the pattern that matched actually captured a clock reading.
    // "WhatsApp Video 2026-04-19 at 3.11.15 PM" did; "20260320" did not, and the
    // noon it was given is arithmetic rather than a time.
    let at = named && named.dkTimed ? window.dkMediaDate.stamp(named) : null;
    let source = next ? (at ? 'name' : 'name (day only)') : null;

    // Fetched when there is no date at all, and ALSO when there is a date but no
    // time — which after the first run of this is every remaining row. The bytes are
    // the only place a clock reading can come from for a camera file.
    if (!next || !at) {
      const { data: signed } = await sb.storage.from(BUCKET)
        .createSignedUrl(row.file_name, 300);
      const url = signed?.signedUrl;
      if (url) {
        const head = await range(url, 0, CHUNK - 1);
        let hit = head ? window.dkMediaDate.fromBytes(head, row.original_name) : null;
        if (!hit) {
          // The encoder put moov at the end. Ask for the last chunk; the server
          // clamps a suffix range for us.
          const tail = await range(url, -CHUNK, '');
          const tail2 = tail || await range(url, 0, CHUNK * 8);
          if (tail2) hit = window.dkMediaDate.fromBytes(tail2, row.original_name);
        }
        // exif and mvhd are both to the second, so a hit here always carries a time.
        if (hit && hit.at) { next = hit.date; at = hit.at; source = hit.source; }
        else if (hit && hit.date && !next) { next = hit.date; source = hit.source; }
      }
    }

    // A day someone already stored outranks a day guessed here, so the metadata gets
    // to supply the TIME and not to move the date. Without this, re-running to pick
    // up times would quietly revise dates that were corrected by hand.
    if (current && at && window.dkMediaDate.iso(new Date(at)) !== current) {
      at = historicStampOnDay(at, current);
      source += ' (time only)';
    }

    plan.push({ row, current, timed, next: current || next, at, source: source || 'no date found' });
  }

  // ── Report ──────────────────────────────────────────────────────────
  const clock = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—'
      : d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  };
  const table = plan.map(p => ({
    id: p.row.id,
    kind: p.row.media_type,
    file: p.row.original_name,
    'day now': p.current || (p.row.upload_date || '').slice(0, 10) + ' (upload)',
    'time now': clock(p.timed),
    'day would be': p.next || '—',
    'time would be': clock(p.at),
    from: p.source,
  }));
  console.log(`[SpinLog] ${apply ? 'APPLYING' : 'DRY RUN — nothing is being written'}`);
  (console.table || console.log)(table);

  // Worth writing when it adds a day the row does not have, or a time it does not
  // have. A row where both already match what was found is left alone.
  const todo = plan.filter(p => (p.next && p.next !== p.current) || (p.at && !p.timed));
  const times = todo.filter(p => p.at).length;
  console.log(`[SpinLog] ${todo.length} of ${plan.length} uploads can be improved from their own `
    + `metadata — ${times} of them with a real clock reading.`);
  if (!apply) {
    console.log('[SpinLog] Run dkBackfillMediaDates({ apply: true }) to write these.');
    return { dryRun: true, plan: table, would: todo.length, withTime: times };
  }

  // ── Write ───────────────────────────────────────────────────────────
  //
  // THROUGH dkCloudStore, not straight at the table. Its setters already do both
  // halves — the row and the in-memory cache the Record History table renders from —
  // so going round them meant writing the row here and then calling a setter to fix
  // the cache, which issued a second, identical PATCH for every upload. Twenty round
  // trips for ten rows. One path, one write.
  //
  // setTakenAt for anything with a clock reading, because it writes the instant AND
  // the day it falls on. setUploadDate only for the day-only rows: it does not touch
  // taken_at, so a file that never reported a time is not handed one.
  let done = 0;
  let timed = 0;
  const failed = [];
  const store = window.dkCloudStore;
  for (const p of todo) {
    let err = null;
    if (p.at && store && typeof store.setTakenAt === 'function') {
      const saved = await store.setTakenAt(p.row.id, p.at);
      if (saved === false) err = 'the database refused it';
      else timed += 1;
    } else if (store && typeof store.setUploadDate === 'function') {
      const saved = await store.setUploadDate(p.row.id, p.next);
      if (saved === false) err = 'the database refused it';
    } else {
      const patch = p.at ? { historic_date: p.next, taken_at: p.at } : { historic_date: p.next };
      const res = await sb.from('media_files').update(patch).eq('id', p.row.id);
      err = res.error && res.error.message;
    }
    if (err) { failed.push(`${p.row.id}: ${err}`); continue; }
    done += 1;
  }

  if (failed.length) {
    console.error('[SpinLog] Some rows refused the update:', failed);
    // A missing column is the one failure worth naming, because the fix is a file
    // in this repo rather than anything about the data.
    if (failed.some(f => /historic_date/.test(f))) {
      console.error('[SpinLog] media_files has no historic_date column — '
        + 'run supabase/cloud_routing.sql once.');
    }
    if (failed.some(f => /taken_at/.test(f))) {
      console.error('[SpinLog] media_files has no taken_at column — '
        + 'run supabase/media_taken_at.sql once.');
    }
  }
  console.log(`[SpinLog] ✅ Updated ${done} upload(s) from their own metadata`
    + `${timed ? `, ${timed} of them with a real time` : ''}.`);
  if (typeof window.loadHistoricUploads === 'function') window.loadHistoricUploads();
  return { applied: done, withTime: timed, failed };
};

// ════════════════════════════════════════════════════════════════════════
// SpinLog | APP VERSION
//
// One literal, in the <meta name="version"> tag, painted into every element
// carrying [data-app-version]. One of those exists today — a chip at the foot of
// Home — and a second needs markup only, no code.
//
// Top level, outside the DOMContentLoaded closure below, because the version
// is also useful to anything that wants to stamp a log or a bug report.
// ════════════════════════════════════════════════════════════════════════
window.dkAppVersion = (function () {
  'use strict';

  const meta = document.querySelector('meta[name="version"]');
  const version = (meta?.getAttribute('content') || '').trim();

  function paint() {
    // Nothing shown at all is better than the word "undefined" on the home
    // screen, so an empty meta leaves the em dash that is already in the markup.
    if (!version) return;
    for (const el of document.querySelectorAll('[data-app-version]')) {
      el.textContent = `v${version}`;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', paint);
  } else {
    paint();
  }

  return version;
})();

// ════════════════════════════════════════════════════════════════════════
// PAGE CONTROLS
//
// Both Record History tables rendered every row they had. Twenty-four uploads was
// twenty-four rows and the only route to the oldest one was past every newer one;
// the service table has no ceiling at all and grows for the life of the bike.
//
// One controller for both, because they are the same control — a rows-per-page
// select, a "showing 1–10 of 24" line, and a numbered strip — even though what sits
// behind them could not be less alike. The documents table is rendered once and
// filtered by toggling a class on the DOM, so paging it means hiding rows. The
// service table is rebuilt from an array on every keystroke, so paging it means
// slicing that array and never building the rest. This module knows nothing about
// either: it owns the arithmetic and the footer, and hands back a {from, to}.
//
// Deliberately outside the DOMContentLoaded closure. The docs table is driven by a
// top-level IIFE further down this file and the service table from inside that
// closure, and neither can see the other's scope.
// ════════════════════════════════════════════════════════════════════════
window.dkPager = function dkPager(config) {
  'use strict';

  const ids = config.ids || {};
  const noun = config.noun || ['record', 'records'];
  // 'All' is 0, which is why every comparison below is `per > 0` rather than a
  // truthiness check on a number that is legitimately allowed to be zero.
  const ALLOWED = [10, 25, 50, 0];
  const STORE_KEY = config.key ? `spinlogPerPage.${config.key}` : null;
  // Seven slots. Past that the strip is wider than the count beside it and the
  // ellipsis is doing more work than the numbers.
  const SLOTS = 7;

  let page = 1;
  let per = readPer();
  let total = 0;
  let wired = false;

  function el(id) { return id ? document.getElementById(id) : null; }

  function readPer() {
    if (!STORE_KEY) return 10;
    let saved = null;
    try { saved = localStorage.getItem(STORE_KEY); } catch { /* private mode */ }
    // The emptiness check is separate and comes FIRST, because Number(null) and
    // Number('') are both 0 — and 0 is a legitimate stored value here, the one that
    // means "All". Without this line a first run reads as "the user chose All" and the
    // page controls arrive switched off, which is exactly how this shipped once.
    if (saved === null || saved === '') return 10;
    const n = Number(saved);
    return ALLOWED.includes(n) ? n : 10;
  }

  function writePer(value) {
    if (!STORE_KEY) return;
    try { localStorage.setItem(STORE_KEY, String(value)); } catch { /* private mode */ }
  }

  function pageCount() {
    if (per <= 0) return 1;
    return Math.max(1, Math.ceil(total / per));
  }

  function clamp() {
    const last = pageCount();
    if (page > last) page = last;
    if (page < 1) page = 1;
  }

  /** The half-open range of item indexes this page covers. */
  function slice() {
    clamp();
    if (per <= 0) return { from: 0, to: total };
    const from = (page - 1) * per;
    return { from, to: Math.min(total, from + per) };
  }

  /**
   * How wide the strip is allowed to be, which is a question about the screen.
   *
   * Measured at 320: five numbers plus two ellipses plus the two arrows comes to 316px
   * inside 296 of usable width, so the wide strip simply does not fit on the narrowest
   * phone still in use. Dropping the current page's NEIGHBOURS rather than shrinking the
   * buttons is the right trade — 34px is already the floor for something a thumb has to
   * hit, and "1 … 6 … 12" answers the same question as "1 … 5 6 7 … 12" in five slots
   * instead of seven.
   *
   * `slots` is also the threshold below which every page gets a button of its own.
   */
  function stripShape() {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
    // Measured, not guessed. The strip gets the footer's width minus the two arrows and
    // the gaps around them, and a button plus its gap is 38px on a phone:
    //
    //   320px viewport -> 136px for the strip -> 3 buttons
    //   360px          -> 176px               -> 4
    //   412px          -> 228px               -> 5
    //
    // `slots` is also the count below which every page gets a button of its own, so it has
    // to be the number that FITS, not the number that would be nice. Below 360 the two
    // ellipses are hidden in CSS as well — at 3 slots the jump between 1, 4 and 12 is
    // self-evident, and they are aria-hidden decoration either way.
    if (w < 360) return { slots: 3, around: 0 };
    if (w < 400) return { slots: 4, around: 0 };
    if (w < 460) return { slots: 5, around: 0 };
    return { slots: SLOTS, around: 1 };
  }

  /**
   * Which numbers the strip shows: always the first and the last, always the current
   * one and (where there is room) its neighbours, and an ellipsis wherever that skips
   * something.
   */
  function strip() {
    const last = pageCount();
    const { slots, around } = stripShape();
    if (last <= slots) {
      return Array.from({ length: last }, (_, i) => i + 1);
    }
    const wanted = new Set([1, last, page]);
    for (let i = 1; i <= around; i += 1) {
      wanted.add(page - i);
      wanted.add(page + i);
    }
    // Pad toward whichever end has room, so the strip is always the same width and the
    // buttons under the cursor do not move as you page through.
    let n = around + 1;
    while (wanted.size < slots - 2 && n < last) {
      if (page < last / 2) wanted.add(page + n);
      else wanted.add(page - n);
      n += 1;
    }
    const list = [...wanted].filter(v => v >= 1 && v <= last).sort((a, b) => a - b);
    const out = [];
    list.forEach((v, i) => {
      if (i && v - list[i - 1] > 1) out.push(null);
      out.push(v);
    });
    return out;
  }

  function announce() {
    const node = el(ids.count);
    if (!node) return;
    if (!total) { node.textContent = ''; return; }
    const { from, to } = slice();
    const word = total === 1 ? noun[0] : noun[1];
    // An en dash, not a hyphen: this is a range, and the two characters mean different
    // things to anything reading it aloud.
    node.textContent = `Showing ${from + 1}\u2013${to} of ${total} ${word}`;
  }

  function paint() {
    clamp();
    const root = el(ids.root);
    if (!root) return;

    // An empty table has nothing to say about how much of it you are looking at, and
    // the two empty states below already say so in the table itself.
    root.hidden = total === 0;

    announce();

    const select = el(ids.per);
    if (select && String(select.value) !== String(per)) select.value = String(per);

    const last = pageCount();
    const prev = el(ids.prev);
    const next = el(ids.next);
    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = page >= last;

    // THE NAV STAYS, EVEN ON ONE PAGE.
    //
    // It used to be hidden there, on the reasoning that a lone "1" between two dead arrows
    // is three controls saying there is nowhere to go. That reasoning was wrong about what
    // a reader does with it: the strip is where you look to find out where you are, so an
    // empty right-hand side reads as a control that has broken rather than as a list that
    // fits on one page. It also meant the footer changed shape the moment an eleventh file
    // arrived. Disabled arrows say "nowhere to go" perfectly well while the "1" still says
    // where you are.
    const nav = el(ids.nav);
    if (nav) nav.hidden = false;

    const pages = el(ids.pages);
    if (pages) {
      pages.innerHTML = strip().map(n => (n === null
        ? '<span class="dk-pager-gap" aria-hidden="true">&hellip;</span>'
        : `<button type="button" class="dk-pager-num${n === page ? ' is-current' : ''}"`
          + ` data-page="${n}"${n === page ? ' aria-current="page"' : ''}`
          + ` aria-label="Page ${n}">${n}</button>`)).join('');
    }
  }

  function goTo(next, { quiet = false } = {}) {
    const last = pageCount();
    const target = Math.min(Math.max(1, Number(next) || 1), last);
    if (target === page) { paint(); return false; }
    page = target;
    paint();
    if (!quiet) config.onChange?.();
    return true;
  }

  /** Move to whichever page holds item `index` of the current list. */
  function showIndex(index) {
    if (per <= 0) return false;
    const i = Number(index);
    if (!Number.isFinite(i) || i < 0) return false;
    return goTo(Math.floor(i / per) + 1, { quiet: true });
  }

  function wire() {
    if (wired) return;
    const root = el(ids.root);
    if (!root) return;
    wired = true;

    el(ids.per)?.addEventListener('change', event => {
      const value = Number(event.target.value);
      per = ALLOWED.includes(value) ? value : 10;
      writePer(per);
      // Back to the top of the list. Page 3 of ten-at-a-time and page 3 of fifty-at-a-
      // time are different places, and keeping the number means landing somewhere you
      // did not ask for.
      page = 1;
      paint();
      config.onChange?.();
    });

    el(ids.prev)?.addEventListener('click', () => goTo(page - 1));
    el(ids.next)?.addEventListener('click', () => goTo(page + 1));

    // Delegated, because the strip is rewritten on every paint.
    el(ids.pages)?.addEventListener('click', event => {
      const btn = event.target.closest('.dk-pager-num');
      if (btn) goTo(Number(btn.dataset.page));
    });

    // The strip drops the current page's neighbours below 400px, so crossing that line —
    // by rotating a phone, or by dragging a window — has to redraw it. Debounced, because
    // a drag fires this continuously and repainting the strip mid-drag is pure churn.
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(paint, 180);
    }, { passive: true });
  }

  wire();

  return {
    /** @returns {boolean} whether the page had to move to stay in range. */
    setTotal(next) {
      total = Math.max(0, Number(next) || 0);
      const before = page;
      clamp();
      return before !== page;
    },
    slice,
    paint,
    goTo,
    showIndex,
    reset() { page = 1; },
    page: () => page,
    per: () => per,
    wire,
  };
};

// ════════════════════════════════════════════════════════════════════════
// SpinLog | VEHICLE IDENTITY
//
// The bike's own facts had no single owner. The purchase date in particular
// existed twice — as "27-06-2025" text in the Ownership Snapshot and as the
// ISO literal '2025-06-27' passed to checkAnniversaryNotif() — so "how old is
// she" could not be answered without scraping markup. This module is now the
// one place that knows, and it is read by the Vehicle Overview age row, the
// anniversary notification and Sage's context builder.
//
// Deliberately outside the DOMContentLoaded closure: the command-center IIFE
// at the bottom of this file needs it too, and neither can see the other's
// scope.
// ════════════════════════════════════════════════════════════════════════
window.dkVehicle = (function () {
  'use strict';

  const FACTS = {
    make: 'KTM',
    name: 'Duke 250 Gen 3',
    registration: 'TN 60 BV 1227',
    engineNo: 'S-962*15524*',
    vin: 'MD2JPEXC0SN078159',
    purchaseDate: '2025-06-27',   // ISO. Shown as 27-06-2025 in the snapshot.
    purchasePrice: 284000,
    primaryUse: 'Daily + Weekend Rides',
    // Age counts from HERE, not from purchaseDate, and the two are deliberately
    // three days apart. This is the date she was registered and handed over —
    // what KTM's own app counts from — while purchaseDate is the date the sale
    // was recorded in SpinLog and is what the anniversary notification uses.
    // If your papers say something else, call dkVehicle.setAgeFrom('YYYY-MM-DD')
    // once and it sticks; nothing here needs editing.
    registeredDate: '2025-06-24',
  };

  // A correction to the registration date, so it can be aligned with the KTM app
  // without touching source.
  const isIso = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

  /**
   * The date her age is measured from, honouring any correction you have made.
   *
   * Stored in the cloud, so "together for 1 yr 2 mo" is the same figure on the
   * phone as on the laptop. Falls back to the shipped registration date until the
   * store has loaded, which is also what a first run looks like.
   */
  function ageFrom() {
    const store = cloudStore();
    const stored = store ? store.setting('ageFrom', null) : null;
    if (isIso(stored)) return stored;
    return FACTS.registeredDate || FACTS.purchaseDate;
  }

  /**
   * Align her age with what your registration actually says.
   * @param {string} iso 'YYYY-MM-DD', or '' to go back to the shipped date.
   */
  function setAgeFrom(iso) {
    const store = cloudStore();
    if (!store) return false;
    if (!iso) { store.setSetting('ageFrom', null); return true; }
    if (!isIso(iso)) return false;
    store.setSetting('ageFrom', iso);
    return true;
  }

  function parseIso(iso) {
    const [y, m, d] = String(iso || '').split('-').map(Number);
    if (!y || !m || !d) return null;
    const date = new Date(y, m - 1, d);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  /**
   * "1 yr 2 mo 21 d" — the compact form the fact grid has room for.
   * Zero units are dropped rather than shown as "0 mo", so an exact anniversary
   * reads as "1 yr" instead of "1 yr 0 mo 0 d".
   */
  function shortLabel(years, months, days) {
    const parts = [];
    if (years) parts.push(`${years} yr`);
    if (months) parts.push(`${months} mo`);
    if (days) parts.push(`${days} d`);
    if (parts.length) return parts.join(' ');
    return 'Day one';
  }

  /** "1 year, 2 months and 21 days" — the form Sage can say out loud. */
  function longLabel(years, months, days) {
    const parts = [];
    if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`);
    if (months) parts.push(`${months} month${months === 1 ? '' : 's'}`);
    if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
    if (!parts.length) return 'brand new today';
    if (parts.length === 1) return parts[0];
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  }

  /**
   * Calendar age, counted the way a person counts it: a month is only complete
   * once the day-of-month comes round again, so 27 Jun to 26 Jul is still
   * 0 months rather than 1.
   *
   * @returns {{years:number, months:number, days:number, totalDays:number,
   *            label:string, long:string, since:string}|null}
   */
  function age(now) {
    const from = parseIso(ageFrom());
    if (!from) return null;
    const to = now ? new Date(now) : new Date();
    if (Number.isNaN(to.getTime()) || to < from) return null;

    let years = to.getFullYear() - from.getFullYear();
    let months = to.getMonth() - from.getMonth();
    let days = to.getDate() - from.getDate();

    if (days < 0) {
      months--;
      // Borrow from the month that has just ended, not from a flat 30.
      days += new Date(to.getFullYear(), to.getMonth(), 0).getDate();
    }
    if (months < 0) { years--; months += 12; }

    return {
      years, months, days,
      totalDays: Math.floor((to - from) / 86400000),
      label: shortLabel(years, months, days),
      long: longLabel(years, months, days),
      since: from.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    };
  }

  return { ...FACTS, parseIso, age, ageFrom, setAgeFrom };
})();

// ════════════════════════════════════════════════════════════
// THE CLOUD STORE, REACHED FROM HERE
//
// Park history, upload notes, upload dates and the purchase-date override are in
// the database now rather than on whichever machine you typed them into. See
// src/js/cloud-store.js for where each one lives.
//
// This accessor MUST STAY AT TOP LEVEL, and that is not a style preference.
//
// This file is one enormous DOMContentLoaded handler from roughly line 200 to
// roughly line 3850, and several sections — LAST PARKED LOCATION, COVER DATE
// EDITING — sit AFTER it at true top level. Indentation is inconsistent enough
// that column 0 says nothing about scope. Declared inside the handler, this is
// invisible to those sections, and the first one to call it throws a
// ReferenceError during script evaluation. Everything below that point then never
// gets defined, so initApp() reaches setupParkFeature() and dies — which looks
// like an app stuck on "CHECKING…" with one section rendered. That shipped once;
// `node tools/audit-boot.mjs` is what catches it.
// ════════════════════════════════════════════════════════════

/** The cloud store, or null. Every caller degrades quietly without it. */
function cloudStore() {
  return window.dkCloudStore || null;
}

document.addEventListener('DOMContentLoaded', function() {
  // Supabase configuration
  const SUPABASE_URL = 'https://ysjkedaekburdxgoccwd.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlzamtlZGFla2J1cmR4Z29jY3dkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5NzkzNDEsImV4cCI6MjA2OTU1NTM0MX0.OsIZS9tLApsWB07fAU5QUy30rDhnWm9-axn0bdnfjOw';
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.supabaseClient = supabase;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./service-worker.js')
  });
}

// ── ONE UPLOAD PROGRESS INDICATOR, IN ONE PLACE ───────────────────────
//
// The popup, and only the popup. There used to be a second surface:
// #uploadProgressBar, an 8px orange bar spanning the drop-zone grid, showing the same
// number. Two things drawing one fact, and the bar was the worse of the two — it sits
// behind a modal overlay with a blur over it, so what it actually contributed was a
// smear of orange under a dialog that already said "Uploading… 36%".
//
// Its markup and CSS are gone with it. It was kept once on the belief that the grid's
// last-tile arithmetic counted it as a child; that arithmetic now reads
// `:nth-last-child(1 of .drop-zone)` and counts only drop zones, so nothing depends on
// it being there.
//
// The percentage is a paced estimate, not a byte count — supabase-js resolves
// upload() in one shot with no progress events — so it climbs to 93 and waits
// for the real answer rather than claiming 100 before the server agrees.
//
// ── IT SAYS WHICH WAIT YOU ARE IN ───────────────────────────────────
//
// It used to say "Uploading..." for all of it, and "all of it" is three different
// waits that fail for three different reasons: reading the file's metadata off the
// disk, pushing the bytes to storage, and writing the row. A 200MB video coming out
// of a phone's content provider spends seconds in the first one with nothing on
// screen at all, because the read happens before the notes sheet opens — you picked
// a file and the app appeared to do nothing.
//
// So the label is a parameter, setUploadPhase() renames it at the real boundaries,
// and the creep is eased rather than random: fast while there is room, crawling near
// the ceiling, so it never stalls on a round number. Same shape as
// sage-autofill.js's startProgress, which was written from this and is the better
// version of it.
//
// Every flow must END through finishUploadPercent, errorUploadPercent or
// cancelUploadPercent. The two vehicle-document uploads used to call neither, which
// left the interval running forever, the success message overwritten by a 'Uploading
// 87%' tick 130ms later, and the orange bar stuck across the docs grid at 93%.
const UPLOAD_CEILING = 93;
const UPLOAD_TICK_MS = 140;
let uploadPercentTimer = null;
let uploadPercent = 0;
let uploadPhase = 'Uploading';

function paintUploadStep() {
  showPopup('loading', `${uploadPhase}… ${Math.round(uploadPercent)}%`);
}

function stopUploadTimer() {
  if (uploadPercentTimer) clearInterval(uploadPercentTimer);
  uploadPercentTimer = null;
}

/**
 * @param {string} [phase] What this wait is, in words. "Uploading" if not given,
 *   which is what the vehicle-document uploads pass.
 */
function startUploadPercent(phase) {
  uploadPhase = phase || 'Uploading';
  uploadPercent = 1;
  stopUploadTimer();
  paintUploadStep();
  uploadPercentTimer = setInterval(() => {
    const room = UPLOAD_CEILING - uploadPercent;
    if (room <= 0.4) return;
    uploadPercent += Math.max(0.4, room * 0.075);
    paintUploadStep();
  }, UPLOAD_TICK_MS);
}

/**
 * A real phase boundary: rename the wait, and jump the number so the jump lines up
 * with work that actually finished rather than with the clock.
 */
function setUploadPhase(phase, atLeast) {
  if (!uploadPercentTimer) return;              // nothing is in flight to rename
  if (phase) uploadPhase = phase;
  if (Number.isFinite(atLeast) && atLeast > uploadPercent) {
    uploadPercent = Math.min(UPLOAD_CEILING, atLeast);
  }
  paintUploadStep();
}

/**
 * Stop without claiming anything happened.
 *
 * Used when the metadata read finishes and the notes sheet is about to open: the
 * popup is a modal overlay at z-index 10000 and would sit on top of the sheet.
 */
function cancelUploadPercent() {
  stopUploadTimer();
  hidePopup();
}

/**
 * @param {string} [message] The outcome, shown straight away.
 *
 * Passing it replaces the old pairing of finishUploadPercent() with a following
 * updatePopup('success', …). That read as two steps and behaved as none: finish
 * scheduled hidePopup at +700ms, so the success line the caller set a tick later was
 * on screen for those 700ms and then gone, while its own 3s timer closed an already
 * closed popup.
 */
function finishUploadPercent(message) {
  stopUploadTimer();
  uploadPercent = 100;
  if (message) {
    showPopup('success', message);
    return;
  }
  showPopup('loading', `${uploadPhase}… 100%`);
  setTimeout(hidePopup, 700);
}

/** @param {string} [message] Why it failed. Said once, here, rather than twice. */
function errorUploadPercent(message) {
  stopUploadTimer();
  showPopup('error', message || 'Upload failed.');
}


// showPdfModal() and showImageModal() used to live here, driving
// #pdfPreviewModal and #imagePreviewModal. Both are gone, along with that
// markup: a vehicle document opens in a new tab through _openVehicleDoc(), and
// every historic upload opens in the Record History media player, which handles
// images, PDFs, audio and video in one swipeable viewer. Neither function had a
// caller left.
//
// Deleted rather than left unused, for the reason the note below gives about
// confirmDeleteWithHold: a top-level function in this file becomes a window
// property, and an unused one is a loaded gun pointed at the next person
// wiring up a button.

// confirmDeleteWithHold() used to live here as a press-and-hold button injected
// into #customPopup. It now comes from src/js/sage-confirm.js, which loads before
// this file, and every delete in the app goes through one slide-to-delete dialog
// instead.
//
// It was deleted rather than left unused on purpose. A top-level `function
// confirmDeleteWithHold` in this file becomes a window property, and this file
// loads *after* sage-confirm.js — so keeping the old one here would silently win
// and nothing would change on screen.
//
// Three things the old one got wrong, so they do not come back:
//   · It built its dialog inside #customPopup, the same element showPopup() uses
//     for "Deleting…". The confirmation and the progress it caused were one node.
//   · mouseleave cancelled the hold, so a finger that drifted a pixel reset the
//     countdown with no explanation.
//   · There was no cancel callback at all, which is why askToConfirm() below had
//     to watch the overlay's class list to notice a dismissal.

  // Popup functions
// Fixed showPopup function - replace your existing one with this
function showPopup(type, message) {
  const popup = document.getElementById('customPopup');
  const spinner = document.getElementById('popupSpinner');
  const success = document.getElementById('popupSuccess');
  const error = document.getElementById('popupError');
  const messageEl = document.getElementById('popupMessage');
  
  spinner.style.display = 'none';
  success.style.display = 'none';
  error.style.display = 'none';
  messageEl.innerHTML = message;
  
  if (type === 'loading') {
    spinner.style.display = 'block';
  } else if (type === 'success') {
    success.style.display = 'block';
  } else if (type === 'error') {
    error.style.display = 'block';
  }
  
  popup.classList.add('show');

  // Most result popups self-dismiss. Ones the user is meant to read or click
  // (the DB status card and its Check again button) opt out with
  // data-popup-persist; backdrop click and Escape still close them.
  const persistent = typeof message === 'string' &&
    (message.includes('Hold') || message.includes('data-popup-persist'));

  if ((type === 'success' || type === 'error') && !persistent) {
    setTimeout(hidePopup, 3000);
  }
}


  function hidePopup() {
    document.getElementById('customPopup').classList.remove('show');
  }
  function updatePopup(type, message) {
    const spinner = document.getElementById('popupSpinner');
    const success = document.getElementById('popupSuccess');
    const error = document.getElementById('popupError');
    const messageEl = document.getElementById('popupMessage');
    spinner.style.display = 'none';
    success.style.display = 'none';
    error.style.display = 'none';
    messageEl.textContent = message;
    if (type === 'success') {
      success.style.display = 'block';
    } else if (type === 'error') {
      error.style.display = 'block';
    }
    setTimeout(hidePopup, 3000);
  }

  // Exposed so code outside this closure can reuse the real popup instead of
  // re-implementing it. The park feature's showAppPopup() tested for a bare
  // `showPopup` identifier it could never see from its own IIFE, so it always
  // fell through to a duplicate implementation.
  window.showPopup = showPopup;
  window.hidePopup = hidePopup;
  window.updatePopup = updatePopup;

  // Dismiss the popup by clicking the dimmed backdrop, or with Escape. Only a
  // click on the overlay itself counts — clicks inside .popup-content must not
  // close it.
  (function enablePopupDismiss() {
    const overlay = document.getElementById('customPopup');
    if (!overlay) return;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) hidePopup(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('show')) hidePopup();
    });
  })();

  // Test Supabase connection
  async function testConnection() {
    try {
      const { error } = await supabase
        .from('maintenance_records')
        .select('id', { count: 'exact', head: true });
      return !error;
    } catch {
      return false;
    }
  }

  // Home page DB status + lightweight keep-alive when SpinLog opens.
  const DB_STATUS_STORAGE_KEY = 'spinlogDbStatus';

  function formatDbStatusTime(isoValue) {
    if (!isoValue) return 'Not checked yet';
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) return 'Not checked yet';
    return date.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function getStoredDbStatus() {
    try {
      return JSON.parse(localStorage.getItem(DB_STATUS_STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function setDbStatusUi(state, checkedAt) {
    const button = document.getElementById('dbStatusButton');
    const text = document.getElementById('dbStatusText');
    if (!button || !text) return;

    button.classList.remove('db-status-online', 'db-status-offline', 'db-status-checking');
    button.classList.add(`db-status-${state}`);

    const label = state === 'online' ? 'Online' : state === 'offline' ? 'Offline' : 'Checking...';
    text.textContent = label;
    button.setAttribute('aria-label', `Database status: ${label}. Last checked: ${formatDbStatusTime(checkedAt)}`);
  }

  async function getDbTableCount(tableName) {
    try {
      const { count, error } = await supabase
        .from(tableName)
        .select('id', { count: 'exact', head: true });
      if (error) return null;
      return Number.isFinite(count) ? count : 0;
    } catch {
      return null;
    }
  }

  async function fetchDbStatusData() {
    const [serviceRecords, vehicleDocs, historicUploads] = await Promise.all([
      getDbTableCount('maintenance_records'),
      getDbTableCount('vehicle_documents'),
      getDbTableCount('media_files')
    ]);

    return {
      serviceRecords,
      vehicleDocs,
      historicUploads
    };
  }

  function formatDbCount(value) {
    return value === null || value === undefined ? '-' : String(value);
  }

  async function refreshDbStatus(showDetails = false) {
    const checkedAt = new Date().toISOString();
    setDbStatusUi('checking', checkedAt);
    const online = await testConnection();
    const status = {
      state: online ? 'online' : 'offline',
      checkedAt,
      table: 'maintenance_records'
    };
    localStorage.setItem(DB_STATUS_STORAGE_KEY, JSON.stringify(status));
    setDbStatusUi(status.state, status.checkedAt);
    if (showDetails) {
      status.data = online ? await fetchDbStatusData() : null;
      showDbStatusDetails(status);
    }
    return status;
  }

  function showDbStatusDetails(status) {
    const isOnline = status.state === 'online';
    const data = status.data || {};
    const table = status.table || 'maintenance_records';

    // Built as a self-contained status card rather than a stack of
    // "label: value" lines, which read like console output. The shared popup's
    // own icon is hidden for this one (see .popup-content:has(.db-status-popup)
    // in styles.css) because the card carries its own state indicator.
    showPopup(isOnline ? 'success' : 'error', `
      <div class="db-status-popup" data-state="${isOnline ? 'online' : 'offline'}" data-popup-persist>
        <div class="dbs-head">
          <span class="dbs-dot" aria-hidden="true"></span>
          <span class="dbs-head-copy">
            <small>Supabase</small>
            <strong>${isOnline ? 'Online' : 'Not responding'}</strong>
          </span>
          <button type="button" class="dbs-recheck" onclick="window.dkRecheckDb && window.dkRecheckDb()"
                  aria-label="Check again">
            <i class="fas fa-rotate" aria-hidden="true"></i>
          </button>
        </div>

        ${isOnline ? `
          <dl class="dbs-grid" aria-label="Row counts">
            <div class="dbs-tile">
              <dt>Service</dt>
              <dd>${formatDbCount(data.serviceRecords)}</dd>
            </div>
            <div class="dbs-tile">
              <dt>Docs</dt>
              <dd>${formatDbCount(data.vehicleDocs)}</dd>
            </div>
            <div class="dbs-tile">
              <dt>Media</dt>
              <dd>${formatDbCount(data.historicUploads)}</dd>
            </div>
          </dl>
        ` : `
          <p class="dbs-note">
            The project is probably paused. Open the Supabase dashboard and resume it,
            then check again.
          </p>
        `}

        <div class="dbs-foot">
          <span><i class="fas fa-clock" aria-hidden="true"></i> ${formatDbStatusTime(status.checkedAt)}</span>
          <span class="dbs-table"><i class="fas fa-table" aria-hidden="true"></i> ${table}</span>
        </div>
      </div>
    `);
  }

  // Lets the Check again button inside the status card re-run the same check the
  // chip does. The button spins while the request is in flight; refreshDbStatus
  // re-renders the whole card on completion, which replaces the button.
  window.dkRecheckDb = () => {
    const btn = document.querySelector('.db-status-popup .dbs-recheck');
    if (btn) {
      btn.classList.add('is-busy');
      btn.disabled = true;
    }
    return refreshDbStatus(true);
  };

  function initDbStatusMonitor() {
    const button = document.getElementById('dbStatusButton');
    const stored = getStoredDbStatus();
    if (stored.state) setDbStatusUi(stored.state, stored.checkedAt);

    if (button) {
      button.addEventListener('click', () => refreshDbStatus(true));
    }

    // One lightweight heartbeat on app open. This helps when the site is visited;
    // use the GitHub Actions workflow for no-visitor days.
    refreshDbStatus(false);
  }

// ==== DOCS SECTION: VEHICLE DOCS LOGIC ====

// The four fixed slots. Anything else in vehicle_documents.document_type is a
// user-added document and gets its own card built at load time.
const VEHICLE_TYPES = [
  'Driving License',
  'Registration Certificate',
  'Pollution Certificate',
  'Insurance Policy'
];

/**
 * Today in the rider's own calendar.
 *
 * toISOString() is UTC, so east of Greenwich it returns yesterday for the whole
 * evening — which quietly dated late-night uploads and edits to the day before.
 */
function localIsoDate(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* Custom document types remembered from the last visit.
   Custom cards only exist in the DOM once the vault query has come back, so on
   every load the grid painted four fixed cards and then visibly grew as the
   user-added ones arrived. Keeping the list locally lets those cards go up in
   the first paint alongside the fixed four; loadVehicleDocsFast() then reconciles
   them against the real data, so the cache being stale is self-correcting. */
const CUSTOM_DOCS_KEY = 'spinlogCustomDocTypes';

function readCustomDocCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_DOCS_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(row => row && typeof row.type === 'string' && row.type) : [];
  } catch {
    return [];
  }
}

function writeCustomDocCache(rows) {
  try { localStorage.setItem(CUSTOM_DOCS_KEY, JSON.stringify(rows.slice(0, 40))); }
  catch { /* quota — the cards still arrive with the query, just a beat later */ }
}

/** Put last visit's custom cards up now, before the vault answers. */
function primeCustomDocCards() {
  const built = [];
  readCustomDocCache().forEach(({ type, notes }) => {
    if (VEHICLE_TYPES.includes(type)) return;
    const descriptor = createCustomDocCard(type, notes);
    if (descriptor) built.push(descriptor);
  });
  return built;
}

// Helper: get signed URL for private bucket
async function getSignedUrl(fileName) {
  const { data, error } = await supabase
    .storage
    .from('vehicle-documents')
    .createSignedUrl(fileName, 60 * 60); // 1 hour
  if (error || !data) return null;
  return data.signedUrl;
}

// Utility helpers for docs/media rendering
function docsEscapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function docsEscapeAttr(value) {
  return docsEscapeHtml(value).replace(/`/g, '&#96;');
}

function docsFormatBytes(bytes) {
  const size = Number(bytes || 0);
  if (!size) return 'File';
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function docsFormatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** True for a bare YYYY-MM-DD, which is how an EDITED upload date comes back. */
function docsIsDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

/**
 * The clock reading under the date, or nothing.
 *
 * A date the user corrected by hand is stored as YYYY-MM-DD, and rendering that as
 * "12:00 AM" would be inventing a fact — the row would claim a precision it does
 * not have. So an absent time is absent, and the cell is one line.
 */
function docsFormatTime(value) {
  if (!value || docsIsDateOnly(value)) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/**
 * Sortable epoch for an upload date, whatever shape it arrived in.
 *
 * Noon rather than midnight for a date-only value: parsing 'YYYY-MM-DD' as a bare
 * date makes it UTC midnight, which is the previous day anywhere west of Greenwich
 * — the same off-by-a-day the filter used to have before it stopped going through
 * toISOString().
 */
function docsWhenMs(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const date = new Date(docsIsDateOnly(raw) ? `${raw}T12:00:00` : raw);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

/**
 * The upload's LOCAL calendar day as YYYY-MM-DD.
 *
 * Put on the row so the From/To filter can compare strings instead of parsing the
 * rendered "19 Apr 2026" back into a date — which worked, but only for as long as
 * nobody changed how that cell is formatted. It now has two lines in it.
 */
function docsIsoDay(value) {
  const ms = docsWhenMs(value);
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function docsIconForType(type, fileName = '') {
  const ext = String(fileName).split('.').pop().toLowerCase();
  if (type === 'audio') return 'fa-wave-square';
  if (type === 'video') return 'fa-play';
  if (type === 'image') return 'fa-image';
  if (ext === 'pdf') return 'fa-file-pdf';
  return 'fa-file-lines';
}

/**
 * The TYPE column's badge.
 *
 * The column it replaced held an eye button that opened the file — the job the
 * thumbnail now does — so the width went to the one fact the row could not state
 * anywhere but inside the grey line under the filename, where you cannot scan it.
 */
function docsTypeBadge(type) {
  const kind = String(type || '').toLowerCase();
  const KINDS = {
    image: { icon: 'fa-image', label: 'Image' },
    audio: { icon: 'fa-wave-square', label: 'Audio' },
    video: { icon: 'fa-video', label: 'Video' },
  };
  const shape = KINDS[kind] || { icon: 'fa-file-lines', label: type ? String(type) : 'File' };
  // THE LABEL IS AN ELEMENT, not a bare text node.
  //
  // The badge is an inline-flex box with `gap`, and a bare text node inside one becomes an
  // anonymous flex item. Chromium does not put the gap before an anonymous item here, so
  // the glyph sat hard against the first letter — "◼VIDEO" — however wide the gap was set.
  // Measured: computed column-gap 9px, drawn distance 0. A real span is a real flex item
  // and the gap applies to it.
  return `<span class="docs-type-badge is-${docsEscapeAttr(kind || 'other')}">`
    + `<i class="fas ${shape.icon}" aria-hidden="true"></i>`
    + `<span class="docs-type-label">${docsEscapeHtml(shape.label)}</span></span>`;
}

// Notes and dates on historic uploads.
//
// Columns on the media_files row they describe, reached through the cloud store.
// They were a JSON map in localStorage keyed by the row id — a foreign key
// pretending not to be one — which is why a note typed on the laptop was not on
// the phone, and why deleting an upload left its note behind for ever.
//
// The names still say "Local" because a dozen call sites use them and the word is
// the only thing about them that is now wrong.

function setHistoricLocalNote(id, notes) {
  const store = cloudStore();
  if (store) store.setNote(id, notes);
}

function getHistoricLocalNote(id) {
  const store = cloudStore();
  return store ? store.note(id) : '';
}

function setHistoricLocalDate(id, isoDate) {
  const store = cloudStore();
  if (store) store.setUploadDate(id, isoDate);
}

function getHistoricLocalDate(id) {
  const store = cloudStore();
  return store ? store.uploadDate(id) : '';
}

/** The full instant an upload was recorded, ISO, or '' when only a day is known. */
function getHistoricTakenAt(id) {
  const store = cloudStore();
  return store && typeof store.takenAt === 'function' ? store.takenAt(id) : '';
}

/** Writes the instant AND the day it falls on. See cloud-store setTakenAt. */
function setHistoricTakenAt(id, stamp) {
  const store = cloudStore();
  if (store && typeof store.setTakenAt === 'function') return store.setTakenAt(id, stamp);
  return Promise.resolve(false);
}

/**
 * The one value the Uploaded column, the sort and the date filter all read.
 *
 * Three candidates, ranked by how much they know rather than by where they came
 * from:
 *
 *   taken_at       an instant, read out of the file itself       → day AND time
 *   historic_date  a day, set by the rider or by the backfill    → day only
 *   upload_date    an instant, but the wrong one: when the file
 *                  arrived, not when it was recorded             → last resort
 *
 * The instant only wins while it still AGREES with the day. They are written
 * together so normally they cannot disagree — but a row edited by an older build,
 * by Sage's set_media_date tool or by hand in the SQL editor can have a corrected
 * day and a stale instant, and in that case the correction is the better fact. The
 * clock reading is dropped rather than shown against a day nothing was recorded on.
 */
function historicWhenFor(row) {
  if (!row) return '';
  const stamp = getHistoricTakenAt(row.id);
  const day = getHistoricLocalDate(row.id);
  if (stamp && (!day || docsIsoDay(stamp) === day)) return stamp;
  return day || row.upload_date;
}

/**
 * @param {object} [options]
 * @param {object|null} [options.context] What the file actually is
 *   ({fileName, mediaType, uploadedOn}). Handed to Sage's autofill so her
 *   "draft it" button knows what it is writing about; without it that button
 *   stays hidden rather than inventing something.
 * @param {string|null} [options.date] Pass an ISO date to also edit the uploaded
 *   date in this same sheet. When given, the promise resolves
 *   `{ notes, date, time }` instead of a bare notes string. Passing null keeps the
 *   old shape and the old bare-string return, which two callers still rely on.
 * @param {string} [options.time] 'HH:MM', or '' for a file that only knew a day.
 *   Only read when `date` is given. An empty string is a real answer rather than a
 *   missing one: it is what the rider leaves behind to say "no time on this", and
 *   what the table reads as "print one line, not two".
 */
function showHistoricNotesModal({ title = 'Add upload notes', help = 'Write what this file is about. Notes are required.', initial = '', required = true, context = null, date = null, time = '', dateLabelText = 'Taken on' } = {}) {
  return new Promise(resolve => {
    const modal = document.getElementById('historicNotesModal');
    const titleEl = document.getElementById('historicNotesTitle');
    const helpEl = document.getElementById('historicNotesHelp');
    const input = document.getElementById('historicNotesInput');
    const saveBtn = document.getElementById('historicNotesSave');
    const cancelBtn = document.getElementById('historicNotesSkip');
    const closeBtn = document.getElementById('historicNotesCancel');
    const dateField = document.getElementById('historicNotesDateField');
    const dateInput = document.getElementById('historicNotesDate');
    // Optional in the DOM as well as in the data. A phone running a service worker
    // from before this field existed has a cached index.html without it, and the
    // sheet has to keep working there — the date is the part that always worked.
    const timeInput = document.getElementById('historicNotesTime');
    const wantsDate = date !== null && !!dateField && !!dateInput;

    if (!modal || !input || !saveBtn || !cancelBtn || !closeBtn) {
      const fallback = prompt(title, initial || '');
      const value = (fallback || '').trim();
      const bare = required && !value ? null : value;
      resolve(wantsDate && bare !== null ? { notes: bare, date, time } : bare);
      return;
    }

    titleEl.textContent = title;
    helpEl.textContent = help;
    helpEl.classList.remove('is-bad');
    input.value = initial || '';
    if (dateField && dateInput) {
      if (wantsDate) {
        dateInput.value = String(date).slice(0, 10);
        // Blank is a meaningful value here, not an empty state: it says the source
        // only knew a day, and it is how the rider removes a time that is wrong.
        if (timeInput) timeInput.value = /^\d{2}:\d{2}/.test(String(time || '')) ? String(time).slice(0, 5) : '';
        dateField.removeAttribute('hidden');
        // The same field answers two different questions and the label has to say
        // which. On an upload it is a guess read off the file that the rider is
        // being invited to correct; on an edit it is the value already stored.
        const dateLabel = document.getElementById('historicNotesDateLabel');
        if (dateLabel) dateLabel.textContent = dateLabelText || 'Taken on';
        // A date in the future is a wrong clock or a misread filename, and this is
        // an archive of things that have already happened.
        dateInput.max = localIsoDate();
      } else {
        dateInput.value = '';
        if (timeInput) timeInput.value = '';
        dateField.setAttribute('hidden', '');
      }
    }
    // Reveals (or hides) the "let Sage draft it" button for this upload.
    window.SageAutofill?.setMediaContext(context);
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => input.focus(), 50);

    const clean = () => {
      // Focus leaves BEFORE aria-hidden goes on.
      //
      // Chrome refuses to hide a subtree that still contains the focused element and
      // logs it: "Blocked aria-hidden on an element because its descendant retained
      // focus." Closing this sheet with its own Cancel button did exactly that — the
      // button kept focus while its ancestor was marked hidden, which leaves a
      // screen-reader user focused on something that has been declared not to exist.
      if (modal.contains(document.activeElement)) {
        try { document.activeElement.blur(); } catch { /* not focusable */ }
      }
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
      window.SageAutofill?.setMediaContext(null);
      saveBtn.onclick = null;
      cancelBtn.onclick = null;
      closeBtn.onclick = null;
      modal.onclick = null;
      document.removeEventListener('keydown', onKey);
    };
    const cancel = () => { clean(); resolve(null); };
    const save = () => {
      const notes = input.value.trim();
      if (required && !notes) {
        input.focus();
        input.style.borderColor = '#ff4d4d';
        helpEl.textContent = 'Notes are required before saving this upload.';
        return;
      }
      input.style.borderColor = '';
      if (wantsDate && !dateInput.value) {
        dateInput.focus();
        helpEl.textContent = 'That upload needs a date — when was the file taken?';
        helpEl.classList.add('is-bad');
        return;
      }
      clean();
      resolve(wantsDate ? { notes, date: dateInput.value, time: timeInput ? timeInput.value : '' } : notes);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') cancel();
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') save();
    };

    saveBtn.onclick = save;
    cancelBtn.onclick = cancel;
    closeBtn.onclick = cancel;
    modal.onclick = (e) => { if (e.target === modal) cancel(); };
    document.addEventListener('keydown', onKey);
  });
}

// Async: Render one vehicle doc card without bulky embedded previews.
// Fast path: do NOT create a signed URL during page load. Create it only when View is tapped.
window._vehicleDocRows = window._vehicleDocRows || new Map();
function renderVehicleDocPreview(previewEl, type, fileName, origName, uploadBtn) {
  const card = uploadBtn.closest('.doc-card');
  const headerDeleteBtn = card.querySelector('.doc-delete-btn');
  window._vehicleDocRows.set(type, { fileName, origName });

  previewEl.innerHTML = `<button class="doc-open-pill" type="button" onclick="window._openVehicleDoc && window._openVehicleDoc('${docsEscapeAttr(type)}')"><i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i> View</button>`;

  if (headerDeleteBtn) headerDeleteBtn.style.display = 'inline-flex';
  uploadBtn.style.display = 'none';
  uploadBtn.innerHTML = '<i class="fas fa-cloud-arrow-up" aria-hidden="true"></i> Upload document';
}

window._openVehicleDoc = async function(type) {
  const row = window._vehicleDocRows?.get(type);
  if (!row || !row.fileName) {
    updatePopup('error', 'Could not find this document. Refresh and try again.');
    return;
  }
  showPopup('loading', 'Opening document...');
  const signedUrl = await getSignedUrl(row.fileName);
  hidePopup();
  if (!signedUrl) {
    updatePopup('error', 'Could not create file link.');
    return;
  }
  window.open(signedUrl, '_blank', 'noopener');
};

// loadVehicleDoc(type, previewEl, uploadBtn) used to sit here: one card, one
// query, called once per card at boot. loadVehicleDocsFast() below replaced it
// with a single ordered query covering every type at once — five round trips
// became one, and user-added cards became discoverable in the same read — and
// nothing has called the per-card version since. Removed rather than kept as a
// convenience, because the two would drift and the slow one would get picked.

// Helper function to get current file info for deletion
async function getCurrentFileForDelete(type, deleteBtn, previewEl, uploadBtn) {
  const { data, error } = await supabase
    .from('vehicle_documents')
    .select('*')
    .eq('document_type', type)
    .order('upload_date', { ascending: false })
    .limit(1);

  if (error || !data || !data.length) {
    showPopup('error', 'No file found to delete');
    return;
  }

  const fileRow = data[0];
  confirmDeleteWithHold(
    'It comes off the vault and off this device.<br><b>This cannot be undone.</b>',
    async () => {
      showPopup('loading', 'Deleting...');
      await supabase.from('vehicle_documents').delete().eq('file_name', fileRow.file_name).eq('document_type', type);
      await supabase.storage.from('vehicle-documents').remove([fileRow.file_name]);
      previewEl.innerHTML = '<span class="doc-empty-state"><i class="fas fa-cloud-arrow-up" aria-hidden="true"></i><strong>No document uploaded</strong><small>Upload once to store this file in the vault.</small></span>';
      uploadBtn.style.display = 'inline-flex';
      uploadBtn.innerHTML = '<i class="fas fa-cloud-arrow-up" aria-hidden="true"></i> Upload document';
      deleteBtn.style.display = 'none';
      updatePopup('success', 'Deleted!');
    },
    // The document type names what is going, so the heading can say it rather
    // than asking "are you sure" about an unnamed thing.
    { title: `Delete your ${type}?`, icon: 'fa-file-circle-xmark' }
  );
}

// Helper function to show upload badge
function showUploadedBadge(previewEl) {
  const badge = document.createElement('div');
  badge.className = 'uploaded-badge';
  badge.textContent = 'Uploaded';
  const parent = previewEl.parentElement;
  parent.style.position = 'relative';
  parent.appendChild(badge);
  setTimeout(() => badge.remove(), 3000);
}

async function getLatestVehicleDoc(type) {
  const { data } = await supabase
    .from('vehicle_documents')
    .select('*')
    .eq('document_type', type)
    .order('upload_date', { ascending: false })
    .limit(1);
  return data && data.length ? data[0] : null;
}

// The main initializer for docs section. Fast path: one DB query for all vehicle docs, no signed URLs until View is tapped.
// Kept so a refresh can re-render the fixed cards without re-wiring them.
let docsFixedCards = [];

async function initDocsUpload() {
  if (spinlogLazyState.docsSetup) return;
  spinlogLazyState.docsSetup = true;

  const cards = VEHICLE_TYPES.map(type => {
    const card = document.querySelector(`.doc-card[data-type="${type}"]`);
    if (!card) return null;
    return {
      type,
      card,
      fileInput: card.querySelector('input[type="file"]'),
      uploadBtn: card.querySelector('.upload-btn'),
      previewEl: card.querySelector('.doc-preview'),
      headerDeleteBtn: card.querySelector('.doc-delete-btn')
    };
  }).filter(Boolean);

  cards.forEach(wireDocCard);
  docsFixedCards = cards;

  // Last visit's custom cards go up with the fixed four, so the grid does not
  // visibly grow a moment later when the vault query lands.
  primeCustomDocCards();

  await loadVehicleDocsFast(cards);
}

/** Wire one document card's upload / delete behaviour. */
function wireDocCard({ type, fileInput, uploadBtn, previewEl, headerDeleteBtn }) {
  {
    uploadBtn?.addEventListener('click', () => fileInput.click());

    if (headerDeleteBtn) {
      headerDeleteBtn.addEventListener('click', function() {
        getCurrentFileForDelete(type, headerDeleteBtn, previewEl, uploadBtn);
      });
    }

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;

      const clean = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const fileName = `${Date.now()}-${clean}`;
      const bucket = 'vehicle-documents';
      const contentType = file.type || 'application/octet-stream';
      const current = await getLatestVehicleDoc(type);
      if (current?.file_name) {
        showPopup('error', 'Delete the existing document before uploading a new one.');
        fileInput.value = '';
        return;
      }

      startUploadPercent('Uploading');

      const { error: uploadErr } = await supabase.storage.from(bucket).upload(fileName, file, {
        contentType,
        cacheControl: '3600',
        upsert: false
      });

      if (uploadErr) {
        // errorUploadPercent, not updatePopup: the latter leaves the paced timer
        // running, so a moment later the failure was overwritten by "Uploading 61%"
        // and the bar was left stretched across the grid claiming progress.
        errorUploadPercent('Upload failed: ' + uploadErr.message);
        return;
      }

      setUploadPhase('Saving the record', 78);

      const { error } = await supabase.from('vehicle_documents').insert([{
        file_name: fileName,
        original_name: file.name,
        document_type: type,
        file_size: file.size,
        content_type: contentType,
        upload_date: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }]);

      if (error) {
        errorUploadPercent('DB error: ' + error.message);
        await supabase.storage.from(bucket).remove([fileName]);
        return;
      }

      finishUploadPercent('Uploaded!');
      renderVehicleDocPreview(previewEl, type, fileName, file.name, uploadBtn);
      showUploadedBadge(previewEl);
      fileInput.value = '';
    });
  }
}

/**
 * Build a card for a user-added document type and wire it like the fixed ones.
 * Returns the same descriptor shape loadVehicleDocsFast() expects.
 */
function createCustomDocCard(type, notes) {
  const grid = document.querySelector('.vehicle-docs-grid');
  if (!grid) return null;

  const existing = grid.querySelector(`.doc-card[data-type="${CSS.escape(type)}"]`);
  if (existing) return null;

  const card = document.createElement('div');
  card.className = 'doc-card is-custom';
  card.dataset.type = type;
  card.innerHTML = `
    <div class="doc-card-top">
      <div class="doc-icon"><i class="fas fa-file-lines" aria-hidden="true"></i></div>
      <button class="doc-delete-btn" title="Delete ${docsEscapeAttr(type)}" aria-label="Delete ${docsEscapeAttr(type)}">
        <i class="fas fa-trash" aria-hidden="true"></i>
      </button>
    </div>
    <h4>${docsEscapeHtml(type)}</h4>
    ${notes ? `<span class="doc-note">${docsEscapeHtml(notes)}</span>` : '<p>Added by you.</p>'}
    <span class="doc-status-chip">Custom</span>
    <input type="file" accept="image/*,.pdf" hidden />
    <button class="upload-btn angled-btn" type="button"><i class="fas fa-cloud-arrow-up" aria-hidden="true"></i> Upload Document</button>
    <div class="doc-preview"></div>`;

  // keep the add tile last
  const tile = document.getElementById('docAddTile');
  if (tile) grid.insertBefore(card, tile); else grid.appendChild(card);

  const descriptor = {
    type,
    card,
    fileInput: card.querySelector('input[type="file"]'),
    uploadBtn: card.querySelector('.upload-btn'),
    previewEl: card.querySelector('.doc-preview'),
    headerDeleteBtn: card.querySelector('.doc-delete-btn'),
  };
  wireDocCard(descriptor);
  return descriptor;
}

/* ── Add-a-document flow ───────────────────────────────────────────────── */

function setupDocAddFlow() {
  const tile = document.getElementById('docAddTile');
  const modal = document.getElementById('docAddModal');
  const nameEl = document.getElementById('docAddName');
  const notesEl = document.getElementById('docAddNotes');
  const pickBtn = document.getElementById('docAddPick');
  const fileEl = document.getElementById('docAddFile');
  const fileName = document.getElementById('docAddFileName');
  const hint = document.getElementById('docAddHint');
  const saveBtn = document.getElementById('docAddSave');
  if (!tile || !modal || !nameEl || !fileEl) return;

  const RESERVED = new Set(VEHICLE_TYPES.map(t => t.toLowerCase()));

  function setHint(msg, bad) {
    if (!hint) return;
    hint.textContent = msg;
    hint.classList.toggle('is-bad', !!bad);
  }

  function close() {
    modal.classList.remove('sl-modal--open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function open() {
    nameEl.value = '';
    if (notesEl) notesEl.value = '';
    fileEl.value = '';
    if (fileName) fileName.textContent = 'Choose a file…';
    pickBtn?.classList.remove('has-file');
    setHint('Give it a short name so you can find it later.', false);
    modal.classList.add('sl-modal--open');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => nameEl.focus({ preventScroll: true }), 60);
  }

  tile.addEventListener('click', open);
  document.getElementById('docAddClose')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('sl-modal--open')) close();
  });

  pickBtn?.addEventListener('click', () => fileEl.click());
  fileEl.addEventListener('change', () => {
    const f = fileEl.files[0];
    if (fileName) fileName.textContent = f ? f.name : 'Choose a file…';
    pickBtn?.classList.toggle('has-file', !!f);
  });

  saveBtn?.addEventListener('click', async () => {
    const type = nameEl.value.trim().replace(/\s+/g, ' ');
    const file = fileEl.files[0];

    if (!type) { setHint('Name the document first.', true); nameEl.focus(); return; }
    if (RESERVED.has(type.toLowerCase())) {
      setHint(`"${type}" already has its own card above.`, true); return;
    }
    if (document.querySelector(`.doc-card[data-type="${CSS.escape(type)}"]`)) {
      setHint(`You already have a document called "${type}".`, true); return;
    }
    if (!file) { setHint('Pick a file to upload.', true); return; }
    if (typeof validateFileUpload === 'function' && !validateFileUpload(file)) return;

    const clean = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const storedName = `${Date.now()}-${clean}`;
    const contentType = file.type || 'application/octet-stream';

    close();
    startUploadPercent('Uploading');

    const { error: uploadErr } = await supabase.storage
      .from('vehicle-documents')
      .upload(storedName, file, { contentType, cacheControl: '3600', upsert: false });
    if (uploadErr) { errorUploadPercent('Upload failed: ' + uploadErr.message); return; }

    setUploadPhase('Saving the record', 78);

    const notes = (notesEl?.value || '').trim();
    const row = {
      file_name: storedName,
      original_name: file.name,
      document_type: type,
      file_size: file.size,
      content_type: contentType,
      upload_date: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Older deployments of this table have no notes column. Try with notes,
    // and fall back to the bare row rather than failing the whole upload.
    let { error } = await supabase.from('vehicle_documents').insert([{ ...row, notes }]);
    if (error && /notes/i.test(error.message || '')) {
      console.warn('[SpinLog] vehicle_documents has no notes column; saving without it.');
      ({ error } = await supabase.from('vehicle_documents').insert([row]));
    }
    if (error) {
      errorUploadPercent('DB error: ' + error.message);
      await supabase.storage.from('vehicle-documents').remove([storedName]);
      return;
    }

    const descriptor = createCustomDocCard(type, notes);
    if (descriptor) {
      renderVehicleDocPreview(descriptor.previewEl, type, storedName, file.name, descriptor.uploadBtn);
      showUploadedBadge(descriptor.previewEl);
    }
    finishUploadPercent('Document added!');
    if (window.triggerRecordSavedNotif) window.triggerRecordSavedNotif();
  });
}

/* Guards against two overlapping refreshes finishing out of order and leaving
   the grid showing the older result. Same pattern as serviceRenderRun. */
let docsRenderRun = 0;

async function loadVehicleDocsFast(cards) {
  if (!cards?.length) return;
  const renderId = ++docsRenderRun;
  // No document_type filter: user-added documents are exactly the rows whose
  // type is not one of the fixed four, and we need them to rebuild their cards.
  // notes is optional in older schemas, so ask for it and retry without.
  let { data, error } = await supabase
    .from('vehicle_documents')
    .select('file_name,original_name,document_type,upload_date,notes')
    .order('upload_date', { ascending: false });
  if (error && /notes/i.test(error.message || '')) {
    ({ data, error } = await supabase
      .from('vehicle_documents')
      .select('file_name,original_name,document_type,upload_date')
      .order('upload_date', { ascending: false }));
  }

  if (renderId !== docsRenderRun) return;

  const latestByType = new Map();
  if (!error && data) {
    for (const row of data) {
      if (!latestByType.has(row.document_type)) latestByType.set(row.document_type, row);
    }
  }

  const known = new Set(VEHICLE_TYPES);

  // Remember which custom documents exist, so the next load can paint them
  // immediately instead of waiting on this query. Only written on a clean read —
  // caching the result of a failed query would erase the list.
  if (!error) {
    writeCustomDocCache(
      Array.from(latestByType.entries())
        .filter(([type]) => !known.has(type))
        .map(([type, row]) => ({ type, notes: row?.notes || '' }))
    );
  }

  /* Drop custom cards the vault no longer has a row for. createCustomDocCard()
     only ever added, so a deleted custom document kept its card until a full
     reload — and since the section keeps its DOM while hidden, that stale card
     was still there on the next visit. Skipped when the query failed, so a
     network blip never wipes the grid. */
  if (!error) {
    document.querySelectorAll('.vehicle-docs-grid .doc-card.is-custom').forEach((card) => {
      const type = card.dataset.type;
      if (type && !latestByType.has(type)) card.remove();
    });
  }

  // rebuild a card for every custom type found in the data
  const all = cards.filter(({ card }) => card.isConnected);
  for (const type of latestByType.keys()) {
    if (known.has(type)) continue;
    const descriptor = createCustomDocCard(type, latestByType.get(type)?.notes);
    // already on the page from a previous load — reuse its nodes
    all.push(descriptor || describeExistingDocCard(type));
  }

  all.filter(Boolean).forEach(({ type, previewEl, uploadBtn, headerDeleteBtn }) => {
    const row = latestByType.get(type);
    if (row) {
      renderVehicleDocPreview(previewEl, type, row.file_name, row.original_name, uploadBtn);
    } else {
      previewEl.innerHTML = '';
      uploadBtn.style.display = 'inline-flex';
      uploadBtn.innerHTML = '<i class="fas fa-cloud-arrow-up" aria-hidden="true"></i> Upload document';
      if (headerDeleteBtn) headerDeleteBtn.style.display = 'none';
    }
  });

  // the static markup's Upload/Delete buttons were hidden until now
  document.querySelector('.vehicle-docs-grid')?.classList.remove('is-loading');
}

/**
 * Descriptor for a custom card that is already in the DOM (wired on a previous
 * load), so a refresh can re-render it without duplicating listeners.
 */
function describeExistingDocCard(type) {
  const card = document.querySelector(`.vehicle-docs-grid .doc-card[data-type="${CSS.escape(type)}"]`);
  if (!card) return null;
  return {
    type,
    card,
    fileInput: card.querySelector('input[type="file"]'),
    uploadBtn: card.querySelector('.upload-btn'),
    previewEl: card.querySelector('.doc-preview'),
    headerDeleteBtn: card.querySelector('.doc-delete-btn'),
  };
}

async function ensureDocsLoaded() {
  if (!spinlogLazyState.docsLoaded) {
    spinlogLazyState.docsLoaded = true;
    setupDocAddFlow();
    /* The grid's first paint comes from static HTML, before the vault query
       resolves, so every card would briefly show "Upload Document" and a delete
       button — including cards whose document is already stored. Hide those
       controls behind a skeleton until the data lands. */
    document.querySelector('.vehicle-docs-grid')?.classList.add('is-loading');
    await initDocsUpload();
    await loadHistoricUploads();
    return;
  }

  /* Every later visit. #docs keeps its DOM while hidden (section { display:none }
     with a fadeIn on .active), so without this you are looking at whatever was
     rendered last time and it never self-corrects — that is the "old entry
     appears for a split second" ghost. */
  await Promise.all([
    loadVehicleDocsFast(docsFixedCards),
    loadHistoricUploads(),
  ]);
}

// --- HISTORIC MEDIA LOGIC ---

/**
 * @returns {Promise<boolean>} false when the note is on this device only, which is
 *   what happens on a schema with no notes column or no UPDATE policy. Sage reports
 *   it back as `storedInDb`.
 */
async function updateHistoricNotes(id, notes) {
  const store = cloudStore();
  if (store) {
    // ONE WRITE, not two. This used to PATCH the row here and then call
    // setHistoricLocalNote, which goes to the same cloud-store setter and issues a
    // second, byte-identical PATCH — two round trips for every note saved, and the
    // second one arriving after the success popup had already been shown.
    return (await store.setNote(id, notes)) !== false;
  }
  // No cloud store means the page is mid-boot or offline. Straight at the table, and
  // the local copy is not worth keeping: there is nothing holding it.
  const { error } = await supabase.from('media_files').update({ notes }).eq('id', id);
  if (error) console.warn('Historic notes DB update skipped:', error);
  return !error;
}

/**
 * One sentence naming where the date and time in the sheet came from.
 *
 * @param {{source:string, at:string|null}|null} found A dkMediaDate.detail() result.
 *
 * The four readers do not deserve equal trust and the rider is the only one who knows
 * which files came off a camera and which came through a messaging app. EXIF is the
 * shutter opening; lastModified is whenever the file was last written, which for
 * anything copied between devices is the copy — so that one asks to be checked and
 * the others do not.
 */
function uploadDateProvenance(found) {
  const source = found?.source || 'none';
  const timed = !!found?.at;
  if (source === 'exif') return 'Date and time read from the photo\u2019s EXIF.';
  if (source === 'png') return 'Date and time read from the image\u2019s own metadata.';
  if (source === 'mvhd') return 'Date and time read from the video\u2019s metadata.';
  if (source === 'name + timestamp') {
    return 'Date read from the file name, time from the file itself \u2014 worth a check.';
  }
  if (source.startsWith('name')) {
    return timed
      ? 'Date and time read from the file name.'
      : 'Date read from the file name, which carried no time.';
  }
  if (source === 'lastModified') {
    return 'Date and time from the file\u2019s own timestamp \u2014 worth a check.';
  }
  return 'Nothing in this file said when it is from, so today is a placeholder.';
}

// Helper: get signed URL for historic-media bucket
async function handleHistoricUpload(file, type, dropZone) {
  // WHEN THE FILE IS FROM, offered before it is asked for.
  //
  // This sheet used to show no date at all during an upload, and the row was
  // stamped with `new Date()` — the moment of upload. For a section called
  // Historic Audio & Images that is the one date almost guaranteed to be wrong:
  // everything in here is older than the app, and a 2024 ride photo was being
  // filed under today.
  //
  // So the field is shown, pre-filled from the file's own metadata — EXIF capture
  // time where there is one, the date in the filename where there is not, and
  // lastModified as the floor. It is a suggestion, not a decision: it is an
  // editable input sitting in the sheet the upload already opens, so a wrong guess
  // costs one correction and no extra step.
  //
  // detail() rather than dkFileDate(), because the sheet asks for a DAY and the
  // table shows a TIME. Both come out of the same read; asking for only the day
  // is what used to throw the clock reading away.
  //
  // AND IT SAYS SO WHILE IT READS. This is the one wait in the whole flow that had
  // nothing on screen: it happens before the notes sheet opens, so picking a 200MB
  // video from a phone looked like a tap that did nothing. Announced on a 200ms
  // delay rather than immediately, because for a photo on a laptop the read finishes
  // first and a popup that appears and vanishes inside two frames is worse than
  // silence.
  let readingShown = false;
  const sayReading = setTimeout(() => {
    readingShown = true;
    startUploadPercent('Reading the file');
  }, 200);
  const found = await window.dkMediaDate.detail(file).catch(() => null);
  clearTimeout(sayReading);
  // The sheet is next, and the popup is a modal overlay that would cover it.
  if (readingShown) cancelUploadPercent();

  const guessedDate = found?.date || localIsoDate();
  // Null only when nothing knew a clock reading — a bare date in a filename, or a
  // file with no usable timestamp at all.
  const guessedStamp = found?.at || '';

  const answer = await showHistoricNotesModal({
    title: 'Add notes for this upload',
    // WHERE THE DATE CAME FROM, in the sheet that is asking you to confirm it.
    // "Taken on 20-03-2026" is a different proposition depending on whether it was
    // read out of the camera's EXIF or guessed from the file's modification time, and
    // only one of those is worth checking. Saying which turns a field you have to
    // audit into one you can glance at.
    help: `Notes are required. ${uploadDateProvenance(found)}`,
    initial: '',
    required: true,
    date: guessedDate,
    time: historicClockOf(guessedStamp),
    // The File itself goes over, so she describes what is actually in it rather
    // than guessing from the name.
    context: {
      file,
      fileName: file.name,
      mediaType: type,
      sizeBytes: file.size,
      uploadedOn: guessedDate,
    }
  });
  if (!answer) {
    const input = dropZone?.querySelector('input[type="file"]');
    if (input) input.value = '';
    return;
  }
  // Passing `date` changes the resolved shape from a bare string to {notes, date, time}.
  const notes = typeof answer === 'string' ? answer : answer.notes;
  const historicDate = typeof answer === 'string' ? guessedDate : (answer.date || guessedDate);
  // Rebuilt from the two fields the rider actually saw rather than from the guess, so
  // correcting either one lands — including emptying the time, which is how you say
  // "this file's clock was wrong" and get a day with no second line.
  const answerTime = typeof answer === 'string'
    ? historicClockOf(guessedStamp)
    : (answer.time || '');
  const takenAt = historicStampFrom(historicDate, answerTime);

  const bucket = 'historic-media';
  const clean = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const fileName = `${Date.now()}-${clean}`;
  const ext = file.name.split('.').pop().toLowerCase();
  let contentType = file.type || 'application/octet-stream';
  if (ext === 'mp4') contentType = 'video/mp4';
  if (ext === 'mov') contentType = 'video/quicktime';
  if (ext === 'avi') contentType = 'video/x-msvideo';
  if (ext === 'webm') contentType = 'video/webm';

  startUploadPercent('Uploading');

  const { error: uploadErr } = await supabase.storage.from(bucket).upload(fileName, file, {
    contentType,
    cacheControl: '3600',
    upsert: false
  });

  if (uploadErr) {
    errorUploadPercent('Upload failed: ' + uploadErr.message);
    return;
  }

  // The bytes are in the bucket. What is left is the row, which is a different
  // failure with a different fix — and on a slow connection it is a wait of its own
  // rather than the tail of the previous one.
  setUploadPhase('Saving the record', 78);

  const row = {
    media_type: type,
    file_name: fileName,
    original_name: file.name,
    file_size: file.size,
    content_type: contentType,
    // THREE DIFFERENT DATES, and they are not interchangeable.
    //   upload_date    when this row was written. Used for nothing the user sees.
    //   historic_date  what DAY the file is from. The filter matches on it and the
    //                  table sorts on it.
    //   taken_at       the full instant, when the metadata knew one. This is what
    //                  puts a clock reading under the date in the Uploaded column.
    upload_date: new Date().toISOString(),
    historic_date: historicDate || null,
    taken_at: takenAt || null,
    notes
  };

  let inserted = null;
  let { data, error } = await supabase.from('media_files').insert([row]).select();
  // These three columns arrived in three different migrations and this table
  // predates all of them, so an instance that has not run one is missing a column.
  // Retry without whichever one the database complains about rather than failing an
  // upload over a column that only carries metadata.
  //
  // The drops ACCUMULATE. Rebuilding the payload from `row` each time and deleting
  // one column would put the previously dropped one back, so a database missing two
  // of the three could never succeed.
  const dropped = [];
  for (const column of ['taken_at', 'historic_date', 'notes']) {
    if (!error) break;
    if (!String(error.message || '').toLowerCase().includes(column)) continue;
    dropped.push(column);
    const fallback = { ...row };
    dropped.forEach(name => { delete fallback[name]; });
    const retry = await supabase.from('media_files').insert([fallback]).select();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    errorUploadPercent('DB error: ' + error.message);
    await supabase.storage.from(bucket).remove([fileName]);
    return;
  }

  inserted = data && data[0];
  if (inserted?.id) {
    setHistoricLocalNote(inserted.id, notes);
    // Through the same helpers the edit path uses, so the table shows the file's
    // own date immediately rather than after the next full cloud read. The row
    // already carries both, so the write this makes is idempotent — worth it to keep
    // one path for "the date of an upload changed".
    //
    // setTakenAt fills the day as well, so the two are never called together.
    if (takenAt) setHistoricTakenAt(inserted.id, takenAt);
    else if (historicDate) setHistoricLocalDate(inserted.id, historicDate);
  }
  // The outcome names what was saved, because the time is the part that was in
  // question: an upload that shows a clock reading and one that shows only a day are
  // two different results and both are correct.
  finishUploadPercent(takenAt
    ? `Uploaded — ${docsFormatDate(takenAt)}, ${docsFormatTime(takenAt)}`
    : `Uploaded — ${docsFormatDate(historicDate)}`);
  const input = dropZone?.querySelector('input[type="file"]');
  if (input) input.value = '';
  loadHistoricUploads();
}

// Setup drag/drop and file pickers for all drop-zones
function setupHistoricDropzones() {
  document.querySelectorAll('.drop-zone').forEach(dropZone => {
    const input = dropZone.querySelector('input[type="file"]');
    const type = dropZone.dataset.type;

    dropZone.addEventListener('click', () => input.click());

    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      handleHistoricUpload(file, type, dropZone);
    });

    dropZone.addEventListener('dragover', e => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', e => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (!file) return;
      handleHistoricUpload(file, type, dropZone);
    });
  });
}

// Helper: get signed URL for historic-media bucket files
async function getHistoricMediaUrl(fileName) {
  const { data, error } = await supabase
    .storage
    .from('historic-media')
    .createSignedUrl(fileName, 60 * 60);
  if (error || !data) return null;
  return data.signedUrl;
}
// Exposed so Sage's autofill can fetch a stored upload and actually look at it
// when re-writing its notes from Record History. Read-only, and the signed URL
// it returns expires in an hour.
window.dkGetHistoricMediaUrl = getHistoricMediaUrl;

/**
 * Sign a whole page of files in ONE round trip.
 *
 * getHistoricMediaUrl() above signs one path per call, which is right for the player —
 * it opens one file. The thumbnail strip wants ten at once, and ten separate
 * createSignedUrl() calls is ten HTTPS round trips: on a phone that was most of the
 * wait before any picture appeared, and it happened again on every page turn.
 *
 * createSignedUrls (plural) is one request for the lot. It is also newer than the
 * pinned-to-latest client this app loads from a CDN, so the single-call path is kept as
 * a fallback rather than assumed away.
 *
 * @param {string[]} names Storage object names.
 * @returns {Promise<Map<string, string>>} name -> signed URL, missing for any that failed.
 */
async function signHistoricMediaBatch(names) {
  const out = new Map();
  const wanted = [...new Set((names || []).filter(Boolean))];
  if (!wanted.length) return out;

  const bucket = supabase.storage.from('historic-media');

  if (typeof bucket.createSignedUrls === 'function') {
    try {
      const { data, error } = await bucket.createSignedUrls(wanted, 60 * 60);
      if (!error && Array.isArray(data)) {
        for (const row of data) {
          // Each entry carries its own error — one unreadable object must not lose the
          // other nine.
          if (row?.signedUrl && !row.error) out.set(row.path, row.signedUrl);
        }
        if (out.size) return out;
      }
    } catch (err) {
      console.warn('Batch signing failed, falling back to one call per file:', err);
    }
  }

  const signed = await Promise.all(wanted.map(name => getHistoricMediaUrl(name)));
  wanted.forEach((name, i) => { if (signed[i]) out.set(name, signed[i]); });
  return out;
}
window.dkSignHistoricMediaBatch = signHistoricMediaBatch;

window._historicMediaRows = new Map();
const spinlogLazyState = { docsSetup: false, docsLoaded: false, serviceLoaded: false };


// _previewHistoricUpload lived here, plus _showAudioPreview / _showVideoPreview /
// _showImagePreview and two full-screen modals for them. All four opened on ONE file
// and closed back to the list. The media player further down replaces the set with a
// single carousel over the whole of Record History, so they are gone rather than left
// sitting unreachable.

// Load all media uploads and render table. Fast path: do NOT create signed URLs during list load.
async function fetchHistoricRowsForList() {
  // Some existing Supabase tables do not have a notes column yet. Try notes first, then fall back cleanly.
  const baseCols = 'id,media_type,file_name,original_name,file_size,content_type,upload_date';
  let result = await supabase
    .from('media_files')
    .select(baseCols + ',notes')
    .order('upload_date', { ascending: false });

  if (result.error && String(result.error.message || '').toLowerCase().includes('notes')) {
    result = await supabase
      .from('media_files')
      .select(baseCols)
      .order('upload_date', { ascending: false });
  }
  return result;
}

// Load all media uploads and render table. Fast path: do NOT create signed URLs during list load.
async function loadHistoricUploads() {
  const table = document.querySelector('#mediaRecordTable tbody');
  if (!table) return;
  // colspan 6, not 4: Type and Size joined the header. A short colspan leaves the
  // placeholder ending mid-table with two empty cells beside it.
  table.innerHTML = '<tr class="docs-history-note"><td colspan="6" style="text-align:center;color:#777;">Loading...</td></tr>';

  const { data, error } = await fetchHistoricRowsForList();

  if (error || !data) {
    console.warn('Historic uploads load failed:', error);
    table.innerHTML = `<tr class="docs-history-note"><td colspan="6" style="text-align:center;color:#b44;">Could not load uploads${error?.message ? ': ' + docsEscapeHtml(error.message) : ''}</td></tr>`;
    return;
  }
  if (!data.length) {
    window._historicMediaRows = new Map();
    table.innerHTML = '<tr class="docs-history-note"><td colspan="6" style="text-align:center;color:#777;">No uploads yet</td></tr>';
    return;
  }

  window._historicMediaRows = new Map(data.map(row => [Number(row.id), row]));
  table.innerHTML = '';
  const fragment = document.createDocumentFragment();
  for (const row of data) {
    const notes = row.notes || getHistoricLocalNote(row.id) || 'No notes saved';
    const kind = String(row.media_type || '').toLowerCase();
    // Prefers the instant the FILE reported over the day anyone set, so a row with
    // real metadata gets its clock reading back. A day-only row has no second line.
    const when = historicWhenFor(row);
    const time = docsFormatTime(when);
    // Only a picture or a video HAS a frame to show. Audio gets its waveform glyph and
    // costs nothing, which is most of why thumbnails are affordable at all.
    const thumbable = kind === 'image' || kind === 'video';
    const tr = document.createElement('tr');
    tr.className = 'docs-media-row';
    tr.dataset.mediaId = String(row.id);
    // Read by the filter and by the sort button, so neither has to parse the rendered
    // date back into one. `day` is the LOCAL calendar day; `when` is the epoch.
    tr.dataset.kind = kind;
    tr.dataset.when = String(docsWhenMs(when));
    tr.dataset.day = docsIsoDay(when);
    // The thumbnail IS the open control, at every width.
    //
    // Before this there were two: a type glyph that opened the file on a phone, and an
    // eye button in a column of its own that did the same thing for a mouse — because
    // nothing about a file-type glyph reads as pressable when there is no hold gesture
    // to discover. A frame of the actual video does. So the second control goes, the
    // column it lived in becomes TYPE, and this one button answers both widths.
    //
    // The <img>/<video> is NOT here: signing a URL per row is what "do not create
    // signed URLs during list load" exists to avoid. data-thumb names the object and an
    // observer fills it in for the rows you can actually see.
    tr.innerHTML = `
      <td data-label="File">
        <div class="docs-file-cell">
          <button class="docs-file-icon docs-file-open docs-thumb${thumbable ? ' is-' + kind : ''}"
                  type="button" data-media-open="${row.id}"
                  ${thumbable ? `data-thumb="${docsEscapeAttr(row.file_name)}" data-thumb-kind="${docsEscapeAttr(kind)}"` : ''}
                  aria-label="Open ${docsEscapeAttr(row.original_name)}"
                  title="Open ${docsEscapeAttr(row.original_name)}">
            <i class="fas ${docsIconForType(row.media_type, row.original_name)}" aria-hidden="true"></i>
          </button>
          <!-- THE BADGE IS IN HERE AS WELL AS IN THE TYPE COLUMN, and that is deliberate.
               A card has no columns to read down, so the type has to sit under the
               filename where the eye already is — and the plain grey "audio · 1.9 MB"
               line that used to do it said the same thing in a form you cannot scan.
               Same trick the size already uses: one fact, rendered twice, with exactly
               one of the two drawn at any width. -->
          <span class="docs-file-meta">
            <strong title="${docsEscapeAttr(row.original_name)}">${docsEscapeHtml(row.original_name)}</strong>
            <span class="docs-file-tags">
              ${docsTypeBadge(row.media_type)}
              <span class="docs-file-size">${docsFormatBytes(row.file_size)}</span>
            </span>
          </span>
        </div>
      </td>
      <!-- Desktop-only columns; both are display:none on a phone, where the grey line
           under the filename already says "VIDEO · 1.6 MB". -->
      <td data-label="Type" class="docs-col-type">${docsTypeBadge(row.media_type)}</td>
      <td data-label="Size" class="docs-col-size">${docsFormatBytes(row.file_size)}</td>
      <!-- title as well as the text: the cell clamps to two lines on a desktop, so a
           long note needs somewhere to be read in full without opening the sheet. -->
      <td data-label="Notes"><div class="docs-notes-cell" title="${docsEscapeAttr(notes)}">${docsEscapeHtml(notes)}</div></td>
      <td data-label="Uploaded">
        <div class="docs-date-cell">
          <span class="docs-date-day">${docsFormatDate(when)}</span>
          ${time ? `<span class="docs-date-time">${docsEscapeHtml(time)}</span>` : ''}
        </div>
      </td>
      <td data-label="Actions">
        <div class="docs-action-stack">
          <button class="docs-trash-btn" type="button" title="Delete ${docsEscapeAttr(row.original_name)}"
                  aria-label="Delete ${docsEscapeAttr(row.original_name)}"
                  onclick="window._delHistoricUpload && window._delHistoricUpload(${row.id}, '${docsEscapeAttr(row.file_name)}', this)"><i class="fas fa-trash" aria-hidden="true"></i></button>
        </div>
      </td>`;
    fragment.appendChild(tr);
  }
  table.appendChild(fragment);

  // Re-apply whatever sort, filter and page were in force before the reload, then let
  // the thumbnail observer pick up the new rows. Order matters: sorting moves rows, the
  // filter decides which of them count, and the pager slices what is left.
  window.dkDocsSortApply?.();
  window.dkDocsFilterApply?.();
  window.dkDocsPager?.refresh({ keepPage: true });
  window.dkDocsThumbs?.scan();
}

/**
 * Edit one historic upload — note and date together, in one sheet.
 *
 * Reached by HOLDING the row, which is the gesture the service records already use
 * for the same job. It replaces two pencil buttons that sat in two different cells:
 * one to change the note, one to change the date. Two icons for two halves of the
 * same correction, and on a phone they were 28px targets wedged beside the text
 * they belonged to.
 *
 * Both writes are reported separately, because they can fail separately: the note
 * goes through the cloud store, the date needs an UPDATE policy on media_files and
 * falls back to this device alone without one.
 */
window._editHistoricMedia = async function(id) {
  const rowEl = document.querySelector(`#mediaRecordTable tbody tr[data-media-id="${id}"]`);
  const current = rowEl?.querySelector('.docs-notes-cell')?.textContent?.trim()
    || getHistoricLocalNote(id) || '';
  // The stored row is what tells Sage which file this note belongs to.
  const row = window._historicMediaRows?.get(Number(id)) || null;
  const currentDate = String(getHistoricLocalDate(id) || row?.upload_date || '').slice(0, 10)
    || localIsoDate();
  // What the file reported, if anything did. Empty for a row that only ever knew a
  // day, and emptying it again is how the rider throws a wrong reading away.
  const currentTime = historicClockOf(getHistoricTakenAt(id));

  const result = await showHistoricNotesModal({
    title: 'Edit this upload',
    help: 'Change the note, or the date and time it is from.',
    initial: current === 'No notes saved' ? '' : current,
    required: true,
    date: currentDate,
    time: currentTime,
    // storageName lets her pull the file back out of the vault and look at it;
    // sizeBytes lets her skip that when it is too big to send.
    context: row ? {
      storageName: row.file_name,
      fileName: row.original_name,
      mediaType: row.media_type,
      sizeBytes: row.file_size,
      uploadedOn: currentDate,
    } : null
  });
  if (!result) return;

  const notes = typeof result === 'string' ? result : result.notes;
  const nextDate = typeof result === 'string' ? null : result.date;
  const nextTime = typeof result === 'string' ? currentTime : (result.time || '');

  showPopup('loading', 'Saving…');
  await updateHistoricNotes(id, notes);

  const dayMoved = !!nextDate && nextDate !== currentDate;
  const timeMoved = nextTime !== currentTime;
  let dateWarning = null;
  if (dayMoved || timeMoved) {
    const day = nextDate || currentDate;
    // upload_date only needs rewriting when the DAY moved. Changing just the time is
    // a fact about the recording, and upload_date is a fact about the upload.
    const saved = dayMoved
      ? await persistHistoricDateToDatabase(id, day)
      : { ok: true, id };
    // `day` and not `saved.value`: saved.value is the noon-UTC instant that went into
    // upload_date, and handing that to setUploadDate put an instant in the cache for a
    // column that stores a day. The row then showed a fabricated "5:30 pm" until the
    // next cloud read truncated it away again.
    const stamp = historicStampFrom(day, nextTime);
    if (stamp) {
      // One call: setTakenAt writes the instant and the day it falls on.
      await setHistoricTakenAt(saved.id || id, stamp);
    } else {
      // No time any more. Clear the instant — which deliberately leaves the day
      // alone — and then make sure the day itself is stored.
      await setHistoricTakenAt(saved.id || id, null);
      setHistoricLocalDate(saved.id || id, day);
    }
    if (!saved.ok) {
      dateWarning = 'Note saved. The date is on this device only — add an UPDATE '
        + 'policy for media_files to sync it.';
    }
  }

  if (dateWarning) updatePopup('error', dateWarning);
  else if (dayMoved && timeMoved) updatePopup('success', 'Note, date and time updated!');
  else if (dayMoved) updatePopup('success', 'Note and date updated!');
  else if (timeMoved) updatePopup('success', 'Note and time updated!');
  else updatePopup('success', 'Note updated!');
  loadHistoricUploads();
};

async function persistHistoricDateToDatabase(id, selectedDate) {
  const nextIso = `${selectedDate}T12:00:00.000Z`;
  const payload = { upload_date: nextIso };

  const { data, error } = await supabase
    .from('media_files')
    .update(payload)
    .eq('id', id)
    .select('id,upload_date')
    .single();

  if (error) {
    console.warn('Historic date DB update failed:', error);
    return { ok: false, id, value: nextIso, error };
  }

  if (!data || !data.upload_date) {
    return { ok: false, id, value: nextIso, error: { message: 'No updated row returned. Check UPDATE RLS policy.' } };
  }

  return { ok: true, id: data.id || id, value: data.upload_date, mode: 'update' };
}

// Delete handler: attach to window so inline HTML can call it
window._delHistoricUpload = async function(id, fileName, btn) {
  confirmDeleteWithHold(
    `“${docsEscapeHtml(fileName)}” goes from storage, and its note and date with it.`
    + '<br><b>This cannot be undone.</b>',
    async () => {
      showPopup('loading', 'Deleting...');
      const { error: dbError } = await supabase.from('media_files').delete().eq('id', id);
      if (dbError) {
        updatePopup('error', 'DB delete failed: ' + dbError.message);
        return;
      }
      const { error: storageError } = await supabase.storage.from('historic-media').remove([fileName]);
      if (storageError) {
        updatePopup('error', 'File delete failed: ' + storageError.message);
        return;
      }
      // Nothing to clean up in the database: the note and the date are columns on
      // the row that was just deleted, so they went with it. This only drops the
      // local copy so the table does not redraw them.
      cloudStore()?.forgetUpload(id);
      btn.closest('tr')?.remove();
      // The row is gone from the DOM, so the counts and the page buttons are now wrong
      // — and deleting the last row on the last page has to move you back a page rather
      // than leave you looking at an empty table.
      window._historicMediaRows?.delete(Number(id));
      // And its cached thumbnail, or a later upload that reuses the name would show the
      // deleted file's picture.
      window.dkDocsThumbs?.forget(fileName);
      window.dkDocsPager?.refresh({ keepPage: true });
      updatePopup('success', 'Deleted!');
      setTimeout(() => { hidePopup(); }, 1200);
    },
    { title: 'Delete this upload?', icon: 'fa-file-circle-xmark' }
  );
};



// The audio, video and image preview popups that used to be here are replaced by
// the Record History media player — see the carousel below the docs filters.

  // Navigation. `main section` is the whole router — see the note in index.html
  // about why no view is allowed to nest a <section> inside itself.
  const sections = document.querySelectorAll('main section');

  // ── Which page you were on, remembered across refreshes ──────────────
  const SECTION_KEY = 'spinlogActiveSection';

  /** Only accept a name that is actually a section in this document. */
  function isKnownSection(name) {
    return !!name && !!document.getElementById(name)
      && document.getElementById(name).matches('main section');
  }

  /**
   * @param {string} section
   * @param {'push'|'replace'} [mode] 'replace' when the section change came FROM
   *   history (a back gesture, or the restore on load). Anything the user actually
   *   navigated to pushes.
   *
   * PUSH, NOT REPLACE, AND THAT IS THE POINT.
   *
   * This only ever replaced, so the history stack held exactly one entry no matter
   * how far into the app you had gone — and a back gesture on a phone had nothing to
   * go back to, so it closed the app. In an installed PWA that reads as "swiping
   * left or right exits", because on Android the back gesture IS an edge swipe.
   *
   * The comment that used to sit here said browser back and forward move between
   * sections rather than leaving the page. That is now true.
   */
  function rememberSection(section, mode) {
    try { localStorage.setItem(SECTION_KEY, section); } catch { /* private mode */ }
    // Best effort only. On a file:// origin some browsers refuse both calls, and
    // localStorage above is the part that actually has to work.
    try {
      // Re-selecting the section you are already on must not stack up entries you
      // then have to press back through.
      const same = location.hash === `#${section}`;
      if (mode === 'replace' || same) history.replaceState(null, '', `#${section}`);
      else history.pushState(null, '', `#${section}`);
    } catch { /* ignore */ }
  }

  /**
   * WHERE FOCUS GOES WHEN THE PAGE CHANGES, AND WHY IT HAS TO GO ANYWHERE.
   *
   * Routing here is `display: none` on the outgoing section. The button you just
   * pressed lives INSIDE that section — the three hero actions are in #home, the
   * Home pill is in #service / #docs / #sage — so the moment the class moves, the
   * element holding focus stops being rendered and the browser drops focus to
   * <body>. The next Tab then restarts from the top of the document, above the
   * section you just asked for. Every keyboard navigation cost you one blind
   * traversal of the whole page.
   *
   * Sending focus to the incoming section's own heading fixes both halves of it:
   * Tab continues from where the eye already is, and a screen reader announces
   * the heading, which is the only signal that anything happened at all — there
   * is no page load and no route announcement in a single-document app.
   *
   * `preventScroll`, because scrollTo({top: 0}) above is the deliberate scroll
   * position and focus() would otherwise fight it. tabindex="-1" is set here
   * rather than in the markup so the heading never becomes a Tab stop of its own.
   */
  function focusSectionHeading(sectionEl) {
    const heading = sectionEl.querySelector('h2, h3, [role="heading"]');
    const target = heading || sectionEl;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    try { target.focus({ preventScroll: true }); } catch { target.focus(); }
  }

  /** Matches slSectionOut in styles.css. Change both or neither. */
  const SECTION_OUT_MS = 130;
  /** Guards against a second navigation landing mid-swap. */
  let sectionSwapToken = 0;
  let sectionSwapTimer = null;

  /**
   * TWO VIEWS, IN ORDER, RATHER THAN A CUT.
   *
   * This used to remove `.active` from every section and add it to the incoming one
   * in a single frame. `section` without `.active` is `display: none`, so the view
   * you were looking at did not leave — it stopped existing — and the `fadeIn` on
   * the arriving one was a fade up from a page that had already gone. There was
   * never a frame with both on screen, which is the only thing that can read as a
   * transition.
   *
   * So the outgoing view is held for the length of its exit animation and hidden
   * after it, and only then does the incoming one appear. Sequential, not
   * overlapping: overlapping would mean taking one out of flow, and an absolutely
   * positioned section mid-swap gives you a page height that jumps and a scrollbar
   * that flickers.
   *
   * Everything with a side effect — the scroll, the shader, focus, the data fetch,
   * the history entry — happens at the SWAP, not when the gesture starts. Firing
   * them early would scroll the page while the old view was still visible, which is
   * the exact judder this is meant to remove.
   *
   * Three things this has to survive:
   *   · A second tap mid-swap. `sectionSwapToken` makes the pending callback a
   *     no-op, and the timer is cleared, so the last navigation wins rather than
   *     both running.
   *   · Reduced motion. There is nothing to wait for, so it swaps in place.
   *   · Being called with the section already showing. The command-centre search
   *     does that when the record it found is on the current page; it must not
   *     animate, and it must not steal focus.
   */
  function setActiveSection(section, mode) {
    if (!isKnownSection(section)) return;
    const incoming = document.getElementById(section);
    const wasActive = incoming.classList.contains('active');
    const outgoing = document.querySelector('main section.active');
    const token = ++sectionSwapToken;

    const swap = () => {
      if (token !== sectionSwapToken) return;
      sections.forEach(sec => {
        sec.classList.remove('active');
        sec.classList.remove('is-leaving');
      });
      incoming.classList.add('active');
      // Instant, and now harmless: the outgoing view is already gone, so there is
      // no smooth scroll for this to interrupt and nothing on screen to judder.
      window.scrollTo({ top: 0, behavior: 'auto' });
      // The backdrop stays on screen everywhere, but it only needs to ANIMATE on
      // home. Off home it is a static image behind a long scrolling list, and a
      // full-viewport shader redrawing per frame is pure scroll cost.
      window.SpinLog3D?.setAnimating?.(section === 'home');
      if (!wasActive) focusSectionHeading(incoming);
      ensureSectionData(section);
      rememberSection(section, mode);
    };

    clearTimeout(sectionSwapTimer);
    sectionSwapTimer = null;

    // Nothing to animate away from: first paint, the same section again, or a user
    // who asked for no motion.
    if (!outgoing || outgoing === incoming || window.dkReduceMotion()) {
      if (outgoing) outgoing.classList.remove('is-leaving');
      swap();
      return;
    }

    outgoing.classList.add('is-leaving');
    sectionSwapTimer = setTimeout(swap, SECTION_OUT_MS);
  }
  // Exposed so the v1.7 command-center search can navigate between sections.
  window.dkNavigate = setActiveSection;

  // The only navigation mechanism. A hamburger menu, a desktop nav list and a
  // full-screen mobile overlay used to be wired up above this: three ids
  // (#mobileToggle, #mobileMenu, #mobileOverlay), two selectors (.desktop-nav li
  // button, .mobile-nav-list li button) and a document-level Escape listener, none
  // of which have existed in index.html for several versions. openMobileMenu() and
  // closeMobileMenu() returned on their first guard, the two NodeLists were always
  // empty, and setActiveSection() was painting aria-current onto [data-section]
  // elements that are not in the document either. All of it is gone; navigation is
  // [data-home-section] buttons and the hash.
  document.querySelectorAll('[data-home-section]').forEach(button => {
    button.addEventListener('click', () => {
      const target = button.getAttribute('data-home-section');
      if (target && document.getElementById(target)) setActiveSection(target);
    });
  });

  function formatDateUIValue(value) {
    if (!value) return '';
    const parsed = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }).replace(',', '');
  }

  function updateDateUI(input) {
    if (!input) return;
    const shell = input.closest('.date-shell');
    const display = shell?.querySelector('.date-display');
    const hasValue = Boolean(input.value);
    if (display) {
      display.textContent = hasValue ? formatDateUIValue(input.value) : (input.dataset.emptyLabel || 'Select date');
    }
    shell?.classList.toggle('has-date', hasValue);
  }

  function refreshDateUIs(scope = document) {
    scope.querySelectorAll?.('input[type="date"][data-date-ui]').forEach(updateDateUI);
  }

  function setupDateUI() {
    function openDatePicker(input) {
      if (!input) return;
      try {
        input.focus({ preventScroll: true });
      } catch (_) {
        input.focus();
      }
      if (typeof input.showPicker === 'function') {
        try {
          input.showPicker();
          return;
        } catch (_) {
          // Fall back to a programmatic click when showPicker is blocked or unavailable.
        }
      }
      try { input.click(); } catch (_) {}
    }

    // Our own calendar, when it is loaded. It takes the field over completely —
    // the input becomes a value holder and the shell becomes the button — so the
    // native-picker plumbing below must NOT also run, or two click handlers fight
    // over one field and the browser's grey panel appears on top of ours.
    //
    // updateDateUI is still what paints the visible text; the picker fires `input`
    // and `change` on the field, so the listeners attached here do the rest.
    const ourCalendar = window.dkDatePicker;

    document.querySelectorAll('input[type="date"][data-date-ui]').forEach(input => {
      if (input.dataset.dateUiReady === 'true') return;
      input.dataset.dateUiReady = 'true';
      updateDateUI(input);

      input.addEventListener('input', () => updateDateUI(input));
      input.addEventListener('change', () => updateDateUI(input));
      input.addEventListener('blur', () => updateDateUI(input));

      if (ourCalendar) {
        ourCalendar.attach(input);
        return;
      }

      input.addEventListener('click', event => {
        // Let the transparent native date input receive the real user click.
        // This keeps iOS/Android/desktop pickers reliable and avoids the custom shell cancelling the picker.
        event.stopPropagation();
      });
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openDatePicker(input);
        }
      });

      const shell = input.closest('.date-shell');
      shell?.setAttribute('tabindex', '0');
      shell?.setAttribute('role', 'button');
      shell?.addEventListener('click', event => {
        if (event.target === input) return;
        event.preventDefault();
        openDatePicker(input);
      });
      shell?.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openDatePicker(input);
        }
      });
    });

    document.querySelectorAll('form').forEach(form => {
      if (form.dataset.dateUiResetReady === 'true') return;
      form.dataset.dateUiResetReady = 'true';
      form.addEventListener('reset', () => {
        window.setTimeout(() => refreshDateUIs(form), 0);
      });
    });
  }

  function getServiceEntryTypeControls() {
    return {
      input: document.getElementById('serviceType'),
      wrapper: document.querySelector('[data-service-entry-type]'),
      button: document.getElementById('serviceTypeButton'),
      value: document.getElementById('serviceTypeValue'),
      menu: document.getElementById('serviceTypeMenu')
    };
  }

  function syncServiceEntryTypeDropdown(value = '') {
    const controls = getServiceEntryTypeControls();
    const label = value || 'Select service type';
    if (controls.value) controls.value.textContent = label;
    controls.wrapper?.classList.toggle('has-value', Boolean(value));
    controls.menu?.querySelectorAll('.entry-select-option').forEach(option => {
      const selected = (option.dataset.value || '') === value;
      option.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  function closeServiceEntryTypeDropdown() {
    const controls = getServiceEntryTypeControls();
    controls.wrapper?.classList.remove('is-open');
    controls.button?.setAttribute('aria-expanded', 'false');
  }

  function setupServiceEntryTypeDropdown() {
    const controls = getServiceEntryTypeControls();
    if (!controls.input || controls.input.dataset.entryTypeReady === 'true') return;
    controls.input.dataset.entryTypeReady = 'true';

    controls.button?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const isOpen = controls.wrapper?.classList.toggle('is-open');
      controls.button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    controls.menu?.querySelectorAll('.entry-select-option').forEach(option => {
      option.addEventListener('click', event => {
        event.preventDefault();
        const value = option.dataset.value || '';
        controls.input.value = value;
        syncServiceEntryTypeDropdown(value);
        closeServiceEntryTypeDropdown();
        controls.input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });

    document.addEventListener('click', event => {
      if (controls.wrapper && !controls.wrapper.contains(event.target)) closeServiceEntryTypeDropdown();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeServiceEntryTypeDropdown();
    });

    controls.input.closest('form')?.addEventListener('reset', () => {
      window.setTimeout(() => {
        controls.input.value = '';
        syncServiceEntryTypeDropdown('');
        closeServiceEntryTypeDropdown();
        controls.input.dispatchEvent(new Event('change', { bubbles: true }));
      }, 0);
    });

    syncServiceEntryTypeDropdown(controls.input.value || '');
  }

  // ── Cover badge helper (shared, reused by cover-date editor) ──────────
  function updateCoverBadge(el) {
    const due = el.getAttribute('data-due');
    if (!due) return;
    const [y, m, d] = due.split('-').map(Number);
    const dueDate = new Date(y, m - 1, d, 23, 59, 59);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.ceil((dueDate - today) / 86400000);
    const formatted = due.split('-').reverse().join('-');
    el.classList.remove('expired', 'expiring');

    // Two-part output matching the .dk-cover-status contract in home.css:
    // a coloured state pill plus the plain date underneath.
    let state, icon, note;
    if (diff < 0) {
      el.classList.add('expired');
      state = 'Expired';
      icon = 'fa-circle-exclamation';
      note = 'Lapsed on ' + formatted;
    } else if (diff <= 30) {
      el.classList.add('expiring');
      state = `${diff} day${diff === 1 ? '' : 's'} left`;
      icon = 'fa-triangle-exclamation';
      note = 'Renew by ' + formatted;
    } else {
      state = 'Active';
      icon = 'fa-circle-check';
      note = 'Valid till ' + formatted;
    }

    el.innerHTML =
      `<b class="dk-cover-state"><i class="fas ${icon}" aria-hidden="true"></i>${state}</b>` +
      `<small>${note}</small>`;
  }
  window.updateCoverBadge = updateCoverBadge;
  setupCoverDateEditing();
  document.querySelectorAll('.dk-cover-status[data-due]').forEach(updateCoverBadge);
  // Then pull the authoritative dates from vehicle_cover and repaint. Left
  // unawaited on purpose: the cards already show the local values, so this is
  // a correction pass rather than a blocking load.
  window.dkCoverStore.hydrate();

  // Everything that used to live only on this machine — park history, upload notes
  // and dates, the purchase-date override, the conversation — is read from the
  // database here. The screen repaints through the listener rather than by
  // reloading, so a spot saved on the laptop appears on the phone without a flash.
  if (window.dkCloudStore) {
    window.dkCloudStore.onChange(what => {
      const all = what === 'all';

      if ((all || what === 'park') && typeof window.dkRefreshParkUI === 'function') {
        window.dkRefreshParkUI();
      }
      // The same repaint the setAgeFrom control uses, rather than a second one
      // that could drift from it.
      if ((all || what === 'setting')
        && typeof window.dkHomeInsights === 'function'
        && typeof window.dkGetSnapshot === 'function') {
        window.dkHomeInsights(window.dkGetSnapshot());
      }
      // Notes and dates are read as the historic table renders, so the table is
      // what has to be rebuilt. Only when it is already on screen — rebuilding a
      // table nobody is looking at costs a query for nothing.
      //
      // Called directly, not through window. loadHistoricUploads is declared
      // inside this same DOMContentLoaded handler, so it is NOT a window property
      // however far left it sits — a `typeof window.loadHistoricUploads` guard
      // here was simply always false, and the table quietly never repainted.
      if ((all || what === 'notes' || what === 'dates') && spinlogLazyState.docsLoaded) {
        loadHistoricUploads();
      }
      if ((all || what === 'chat') && typeof window.SageUI?.renderChat === 'function') {
        window.SageUI.renderChat();
      }
    });
    // Unawaited: the rest of the boot does not wait on the network, and every
    // reader handles an empty cache by showing nothing rather than breaking.
    window.dkCloudStore.load();
  }

  // Hide Next Due for Mods/Updates
  document.getElementById('serviceType')?.addEventListener('change', function() {
    const lbl = document.getElementById('nextDueLabel');
    const form = document.getElementById('serviceEntryForm');
    if (!lbl) return;
    const isMods = this.value === 'Mods/Updates';
    form?.classList.toggle('is-mods-entry', isMods);
    if (isMods) {
      lbl.style.display = 'none';
      const dueInput = lbl.querySelector('input');
      if (dueInput) {
        dueInput.value = '';
        updateDateUI(dueInput);
      }
    } else {
      lbl.style.display = '';
    }
  });

  // Service entries store + modern history filters
  let serviceEntries = [];
  let serviceRenderRun = 0;
  let serviceFilterTimer = null;

  /**
   * The page controls under the service table.
   *
   * Built on first use rather than at module scope: this closure runs on
   * DOMContentLoaded, and dkPager() wires listeners to elements by id the moment it is
   * called, so constructing it before the section exists would bind nothing. Every
   * route into the table goes through renderServiceTable(), so that is where it is
   * asked for.
   *
   * Unlike the documents table this one PAGES BY SLICING. The rows for other pages are
   * never built: each one awaits buildBillPreview() to sign its bill, so rendering
   * twenty-four of them to show ten was twenty-four round trips for fourteen rows
   * nobody was looking at.
   */
  let servicePagerInstance = null;
  function servicePager() {
    if (!servicePagerInstance) {
      servicePagerInstance = window.dkPager({
        key: 'serviceHistory',
        noun: ['record', 'records'],
        ids: {
          root: 'serviceHistoryPager',
          per: 'serviceHistoryPerPage',
          count: 'serviceHistoryRange',
          nav: 'serviceHistoryNav',
          prev: 'serviceHistoryPrev',
          next: 'serviceHistoryNext',
          pages: 'serviceHistoryPages',
        },
        onChange: () => renderServiceTable(),
      });
    }
    return servicePagerInstance;
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function escapeAttr(value) {
    return escapeHTML(value).replace(/`/g, '&#96;');
  }

  function formatServiceDate(value) {
    if (!value) return '-';
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return escapeHTML(value);
    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }

  function formatServiceNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return value ? escapeHTML(value) : '-';
    return number.toLocaleString('en-IN');
  }

  function formatServiceCost(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return value ? escapeHTML(value) : '-';
    return `₹${number.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }

  function getServiceEntryCost(entry) {
    const cost = Number(entry?.cost);
    return Number.isFinite(cost) ? cost : 0;
  }

  function renderServiceSpendCard(label, value, extraClass = '') {
    return `
      <div class="history-spend-card ${extraClass}">
        <span>${escapeHTML(label)}</span>
        <strong>${escapeHTML(value)}</strong>
      </div>
    `;
  }

  function updateServiceSpendSummary(entries, filters) {
    const strip = document.getElementById('serviceHistorySpendStrip');
    if (!strip) return;

    const list = Array.isArray(entries) ? entries : [];
    const totalSpend = list.reduce((sum, entry) => sum + getServiceEntryCost(entry), 0);
    const serviceSpend = list
      .filter(entry => String(entry.type || '').toLowerCase() !== 'mods/updates')
      .reduce((sum, entry) => sum + getServiceEntryCost(entry), 0);
    const modsSpend = list
      .filter(entry => String(entry.type || '').toLowerCase() === 'mods/updates')
      .reduce((sum, entry) => sum + getServiceEntryCost(entry), 0);
    const hasFilters = Boolean(filters?.query || filters?.type || filters?.from || filters?.to);

    strip.innerHTML = [
      renderServiceSpendCard(hasFilters ? 'Filtered Spend' : 'Total Spend', formatServiceCost(totalSpend), 'history-spend-total'),
      renderServiceSpendCard('Service Spend', formatServiceCost(serviceSpend), 'history-spend-service'),
      renderServiceSpendCard('Mods Spend', formatServiceCost(modsSpend), 'history-spend-mods'),
      renderServiceSpendCard('Records', String(list.length), 'history-spend-count')
    ].join('');
  }

  function getServiceHistoryControls() {
    return {
      search: document.getElementById('serviceHistorySearch'),
      type: document.getElementById('serviceHistoryTypeFilter'),
      from: document.getElementById('serviceHistoryFromDate'),
      to: document.getElementById('serviceHistoryToDate'),
      clear: document.getElementById('serviceHistoryClearFilters'),
      toggle: document.getElementById('serviceHistoryFilterToggle'),
      filterPanel: document.getElementById('serviceHistoryFilters'),
      filterCount: document.getElementById('serviceHistoryFilterCount'),
      typeButton: document.getElementById('serviceHistoryTypeButton'),
      typeValue: document.getElementById('serviceHistoryTypeValue'),
      typeMenu: document.getElementById('serviceHistoryTypeMenu'),
      summary: document.getElementById('serviceHistorySummary'),
      active: document.getElementById('serviceHistoryActiveFilters')
    };
  }

  function getServiceHistoryFilters() {
    const controls = getServiceHistoryControls();
    const rawFrom = controls.from?.value || '';
    const rawTo = controls.to?.value || '';
    let from = rawFrom;
    let to = rawTo;

    if (from && to && from > to) {
      [from, to] = [to, from];
    }

    return {
      query: (controls.search?.value || '').trim().toLowerCase(),
      type: controls.type?.value || '',
      from,
      to,
      rawFrom,
      rawTo
    };
  }

  function getServiceEntrySearchText(entry) {
    return [
      entry.type,
      entry.date,
      formatServiceDate(entry.date),
      entry.next_due,
      formatServiceDate(entry.next_due),
      entry.odo,
      entry.cost,
      entry.notes,
      entry.bill
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function entryMatchesServiceFilters(entry, filters) {
    const entryDate = entry.date || '';

    if (filters.type && entry.type !== filters.type) return false;
    if (filters.from && (!entryDate || entryDate < filters.from)) return false;
    if (filters.to && (!entryDate || entryDate > filters.to)) return false;
    if (filters.query && !getServiceEntrySearchText(entry).includes(filters.query)) return false;

    return true;
  }

  function getFilteredServiceEntries() {
    const filters = getServiceHistoryFilters();
    return serviceEntries.filter(entry => entryMatchesServiceFilters(entry, filters));
  }

  function updateServiceHistoryMeta(visibleCount, totalCount, filters) {
    const controls = getServiceHistoryControls();
    const hasFilters = Boolean(filters.query || filters.type || filters.from || filters.to);

    if (controls.summary) {
      let summaryText = '';

      if (!totalCount) {
        summaryText = 'No service records yet. Add the first entry above.';
      } else if (hasFilters) {
        summaryText = `Showing ${visibleCount} of ${totalCount} ${totalCount === 1 ? 'record' : 'records'}.`;
      }

      controls.summary.textContent = summaryText;
      controls.summary.classList.toggle('is-hidden', !summaryText);
    }

    const chips = [];
    if (filters.query) chips.push(`<span class="history-chip"><i class="fas fa-magnifying-glass" aria-hidden="true"></i> ${escapeHTML(filters.query)}</span>`);
    if (filters.type) chips.push(`<span class="history-chip"><i class="fas fa-filter" aria-hidden="true"></i> ${escapeHTML(filters.type)}</span>`);
    if (filters.from) chips.push(`<span class="history-chip"><i class="far fa-calendar" aria-hidden="true"></i> From ${formatServiceDate(filters.from)}</span>`);
    if (filters.to) chips.push(`<span class="history-chip"><i class="far fa-calendar-check" aria-hidden="true"></i> To ${formatServiceDate(filters.to)}</span>`);

    if (controls.active) {
      controls.active.innerHTML = chips.join('');
      controls.active.classList.toggle('has-filters', chips.length > 0);
    }

    if (controls.clear) {
      controls.clear.disabled = chips.length === 0;
      controls.clear.classList.toggle('is-disabled', chips.length === 0);
    }

    if (controls.filterCount) {
      controls.filterCount.textContent = String(chips.length);
      controls.filterCount.hidden = chips.length === 0;
    }
  }

  function syncServiceTypeDropdown(value = '') {
    const controls = getServiceHistoryControls();
    if (!controls.typeButton || !controls.typeMenu) return;

    const label = value || 'All types';
    if (controls.typeValue) controls.typeValue.textContent = label;

    controls.typeMenu.querySelectorAll('.history-select-option').forEach(option => {
      const selected = (option.dataset.value || '') === value;
      option.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  function closeServiceTypeDropdown() {
    const controls = getServiceHistoryControls();
    const wrapper = document.querySelector('[data-service-type-filter]');
    wrapper?.classList.remove('is-open');
    controls.typeButton?.setAttribute('aria-expanded', 'false');
  }

  function setupServiceHistoryFilters() {
    const controls = getServiceHistoryControls();
    if (!controls.search || controls.search.dataset.ready === 'true') return;

    // Back to page one whenever the FILTER moves. Page three of a four-page list is
    // nowhere once the list is two pages long — the pager would clamp you to the last
    // page, which is a stranger place to land than the first.
    const delayedRender = () => {
      window.clearTimeout(serviceFilterTimer);
      serviceFilterTimer = window.setTimeout(() => {
        servicePager().reset();
        renderServiceTable();
      }, 140);
    };

    controls.search.addEventListener('input', delayedRender);
    [controls.type, controls.from, controls.to].forEach(control => {
      control?.addEventListener('change', () => {
        servicePager().reset();
        renderServiceTable();
      });
    });

    controls.toggle?.addEventListener('click', () => {
      const isOpen = controls.filterPanel?.classList.toggle('is-open');
      controls.toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    const typeWrapper = document.querySelector('[data-service-type-filter]');
    controls.typeButton?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const isOpen = typeWrapper?.classList.toggle('is-open');
      controls.typeButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    controls.typeMenu?.querySelectorAll('.history-select-option').forEach(option => {
      option.addEventListener('click', event => {
        event.preventDefault();
        const value = option.dataset.value || '';
        controls.type.value = value;
        syncServiceTypeDropdown(value);
        closeServiceTypeDropdown();
        controls.type.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });

    document.addEventListener('click', event => {
      if (typeWrapper && !typeWrapper.contains(event.target)) {
        closeServiceTypeDropdown();
      }
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeServiceTypeDropdown();
    });

    // Lifted out of the click handler so the command-centre search can call it.
    //
    // A filtered service table does not hide the rows it excludes, it never renders
    // them — so jumping to a record from search while a filter was set landed on a
    // table that did not contain it, and the highlight silently never happened. The
    // search clears the filters first. `focus` is the one thing the button does that
    // this must not: taking focus mid-navigation scrolls the page back to the field.
    function clearServiceFilters() {
      if (!controls.search) return false;
      const had = Boolean(controls.search.value || controls.type.value
        || controls.from.value || controls.to.value);
      controls.search.value = '';
      controls.type.value = '';
      controls.from.value = '';
      controls.to.value = '';
      updateDateUI(controls.from);
      updateDateUI(controls.to);
      syncServiceTypeDropdown('');
      servicePager().reset();
      renderServiceTable();
      return had;
    }
    window.dkClearServiceFilters = clearServiceFilters;

    /**
     * Put one record on screen, wherever it is in the list.
     *
     * The command-centre search jumps to a row by selector and lights it up, and it
     * already had to drop any filter first because a filtered table does not render the
     * rows it excludes. Paging is the second way a record can be missing while still
     * existing — record twenty of twenty-four is not in the DOM at all on page one — and
     * the symptom is identical: the poll times out and nothing happens.
     *
     * @returns {boolean} False when there is no such record, so the caller can tell
     *   "not on this page" from "not in the database".
     */
    window.dkShowServiceRecord = function showServiceRecord(id) {
      clearServiceFilters();
      // Filters are cleared, so the filtered list IS serviceEntries and an index into
      // one is an index into the other.
      const index = serviceEntries.findIndex(entry => String(entry.id) === String(id));
      if (index < 0) return false;
      servicePager().showIndex(index);
      renderServiceTable();
      return true;
    };

    controls.clear?.addEventListener('click', () => {
      clearServiceFilters();
      controls.search.focus();
    });

    syncServiceTypeDropdown(controls.type.value || '');
    controls.search.dataset.ready = 'true';
  }

  // Update home odometer & service info
  function updateHomeText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
  }

  function updateHomeServiceInfo() {
    const serviceOnly = serviceEntries
      .filter(e => e.type !== 'Mods/Updates')
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    if (!serviceOnly.length) {
      updateHomeText('home-odo', '0 km');
      updateHomeText('home-odo-mobile', '0 km');
      updateHomeText('home-last', 'N/A');
      updateHomeText('home-last-mobile', 'N/A');
      updateHomeText('home-next', 'N/A');
      updateHomeText('home-next-mobile', 'N/A');
      if (window.dkHomeInsights) {
        window.dkHomeInsights({ all: serviceEntries, services: [], maxOdo: 0, latest: null });
      }
      return;
    }

    const maxOdo = Math.max(...serviceOnly.map(e => Number(e.odo) || 0));
    const latest = serviceOnly[0];
    const lastDate = new Date(`${latest.date}T00:00:00`).toLocaleDateString('en-GB');
    const nextDate = latest.next_due
      ? new Date(`${latest.next_due}T00:00:00`).toLocaleDateString('en-GB')
      : 'Not scheduled';
    const odoText = `${maxOdo.toLocaleString('en-IN')} km`;

    updateHomeText('home-odo', odoText);
    updateHomeText('home-odo-mobile', odoText);
    updateHomeText('home-last', lastDate);
    updateHomeText('home-last-mobile', lastDate);
    updateHomeText('home-next', nextDate);
    updateHomeText('home-next-mobile', nextDate);

    // Hand the same data to the v1.7 command-center widgets (odometer delta,
    // relative dates, maintenance timeline, next-service projection).
    if (window.dkHomeInsights) {
      window.dkHomeInsights({ all: serviceEntries, services: serviceOnly, maxOdo, latest });
    }

    // ── Sage notification triggers ──
    // serviceOnly is handed over so the scheduler can estimate today's odometer
    // and warn on distance, not just on the calendar.
    if (window.checkServiceNotif) {
      window.checkServiceNotif(maxOdo, latest.next_due || null, serviceOnly);
    }

    // The health card needs real records, so it is built here rather than at
    // boot when the snapshot is still empty.
    if (window.sageRefreshHealthCard) window.sageRefreshHealthCard();

    // Sync service data to the worker for background notifications. Only the
    // service keys are sent — the worker merges, so the cover dates written by
    // syncNotifDataToSW() survive this write.
    //
    // kmPerDay and the last reading go along too, so the worker can re-project
    // the odometer at wake time instead of reusing a stale estimate.
    const kmPerDay = window.SageScheduler?.averageKmPerDay
      ? window.SageScheduler.averageKmPerDay(serviceOnly)
      : null;
    postToSW({
      type: 'SPINLOG_SYNC_NOTIF_DATA',
      payload: {
        nextServiceDate: latest.next_due || null,
        maxOdo,
        lastRecordOdo: maxOdo,
        lastRecordDate: latest.date || null,
        kmPerDay,
        lastAppOpen: Date.now(),
      }
    });
  }

  function getServiceTypeClass(type) {
    return `history-type-${String(type || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  }

  function getServiceTypeIcon(type) {
    const normalized = String(type || '').toLowerCase();
    if (normalized.includes('mods')) return 'fas fa-bolt';
    if (normalized.includes('showroom')) return 'fas fa-shop';
    if (normalized.includes('3rd')) return 'fas fa-toolbox';
    return 'fas fa-screwdriver-wrench';
  }

  window._serviceBillRows = window._serviceBillRows || new Map();

  function buildBillPreview(entry) {
    if (!entry.bill || !String(entry.bill).trim()) {
      return '<span class="history-empty-pill">No bill</span>';
    }

    window._serviceBillRows.set(String(entry.id), String(entry.bill));
    const fileName = String(entry.bill);
    const ext = fileName.split('.').pop().toLowerCase();
    let iconClass = 'fas fa-file-lines';
    let fileClass = 'bill-preview-file';

    if (['jpg','jpeg','png','gif','webp','bmp','tiff','svg','heic','heif'].includes(ext)) {
      iconClass = 'fas fa-image';
      fileClass = 'bill-preview-image';
    } else if (ext === 'pdf') {
      iconClass = 'fas fa-file-pdf';
      fileClass = 'bill-preview-pdf';
    }

    return `
      <button class="bill-preview-link ${fileClass}" type="button" onclick="window._openServiceBill && window._openServiceBill('${escapeAttr(entry.id)}')" title="Open bill preview">
        <i class="${iconClass}" aria-hidden="true"></i>
        <span>View</span>
      </button>
    `;
  }

  window._openServiceBill = async function(id) {
    const fileName = window._serviceBillRows?.get(String(id));
    if (!fileName) {
      updatePopup('error', 'Could not find this bill. Refresh and try again.');
      return;
    }
    showPopup('loading', 'Opening bill...');
    const url = await getBillFileUrl(fileName);
    hidePopup();
    if (!url) {
      updatePopup('error', 'Could not create bill link.');
      return;
    }
    window.open(url, '_blank', 'noopener');
  };

  function renderServiceEmptyState(message, icon = 'fa-folder-open') {
    return `
      <tr class="history-empty-row">
        <td colspan="8">
          <div class="history-empty-state">
            <i class="fas ${icon}" aria-hidden="true"></i>
            <span>${escapeHTML(message)}</span>
          </div>
        </td>
      </tr>
    `;
  }

  async function renderServiceTable() {
    const tbody = document.getElementById('serviceTableBody');
    if (!tbody) return;

    const renderId = ++serviceRenderRun;
    const filters = getServiceHistoryFilters();
    const filteredEntries = getFilteredServiceEntries();
    // The spend strip and the "showing 3 of 24" line still describe the WHOLE filtered
    // set, not the page. Totalling one page of costs would be a figure that means
    // nothing, and it would change as you paged.
    updateServiceHistoryMeta(filteredEntries.length, serviceEntries.length, filters);
    updateServiceSpendSummary(filteredEntries, filters);

    const pager = servicePager();
    pager.setTotal(filteredEntries.length);
    pager.paint();

    if (!serviceEntries.length) {
      tbody.innerHTML = renderServiceEmptyState('No service records found', 'fa-folder-open');
      updateHomeServiceInfo();
      return;
    }

    if (!filteredEntries.length) {
      tbody.innerHTML = renderServiceEmptyState('No records match your filters', 'fa-magnifying-glass');
      updateHomeServiceInfo();
      return;
    }

    const { from, to } = pager.slice();
    const rows = [];
    for (const entry of filteredEntries.slice(from, to)) {
      const billLink = buildBillPreview(entry);
      if (renderId !== serviceRenderRun) return;

      const deleteBtn = `
        <button type="button" class="delete-btn service-record-delete" data-id="${escapeAttr(entry.id)}" data-bill="${escapeAttr(entry.bill || '')}" title="Delete record" aria-label="Delete service record">
          ×
        </button>
      `;

      rows.push(`
        <tr class="service-record-row" data-record-id="${escapeAttr(entry.id)}" title="Hold to edit this record">
          <td data-label="Type" class="service-type-cell"><span class="history-type-badge ${getServiceTypeClass(entry.type)}"><i class="${getServiceTypeIcon(entry.type)}" aria-hidden="true"></i>${escapeHTML(entry.type || '-')}</span></td>
          <td data-label="Date" class="service-date-cell">${formatServiceDate(entry.date)}</td>
          <td data-label="Next Due" class="service-due-cell">${entry.next_due ? formatServiceDate(entry.next_due) : '<span class="history-empty-pill">Not set</span>'}</td>
          <td data-label="Odo (km)" class="service-odo-cell">${formatServiceNumber(entry.odo)} km</td>
          <td data-label="Cost (₹)" class="service-cost-cell">${formatServiceCost(entry.cost)}</td>
          <td data-label="Notes" class="record-notes service-notes-cell"><span class="history-notes-text">${escapeHTML(entry.notes || '-')}</span></td>
          <td data-label="Bill" class="bill-cell service-bill-cell">${billLink}</td>
          <td data-label="Action" class="action-cell service-action-cell">${deleteBtn}</td>
        </tr>
      `);
    }

    if (renderId !== serviceRenderRun) return;
    tbody.innerHTML = rows.join('');

    tbody.querySelectorAll('.service-record-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        window.deleteServiceRecord(Number(btn.dataset.id), btn.dataset.bill || '', btn);
      });
    });

    updateHomeServiceInfo();
  }

  // Load entries from Supabase
  async function loadServiceEntries() {
    try {
      const { data, error } = await supabase
        .from('maintenance_records')
        .select('*')
        .order('date', { ascending: false });
      if (error) {
        showPopup('error', 'Could not load existing service records.');
        return;
      }
      serviceEntries = data || [];
      await renderServiceTable();
    } catch {
      showPopup('error', 'Database connection failed.');
    }
  }

  // Form submission. Guarded like every other lookup in this file: an unguarded
  // .addEventListener() on a getElementById() result throws during evaluation, and
  // this handler sits inside the big DOMContentLoaded closure — so a throw here
  // takes out every section of the closure below it and presents as an app stuck
  // mid-boot. It was the only unguarded one left.
  document.getElementById('serviceEntryForm')?.addEventListener('submit', async function(e) {
  e.preventDefault();
  const form = e.target;
  const data = new FormData(form);
  
  // Validate required fields manually so the custom date/type UI does not trigger browser-native tooltip glitches.
  const file = data.get('bill');
  if (!data.get('type') || !data.get('date') || !data.get('odo') || !data.get('cost') || !String(data.get('notes') || '').trim() || !file || !file.size) {
    showPopup('error', 'Please fill in all required fields and upload the bill.');
    return;
  }
  
  if (!validateFileUpload(file)) return;

  const entry = {
    type: data.get('type'),
    date: data.get('date'),
    nextDue: data.get('type') === 'Mods/Updates' ? '' : data.get('nextDue'),
    odo: data.get('odo'),
    cost: data.get('cost'),
    notes: data.get('notes')
  };

  const btn = form.querySelector('button[type="submit"].drawer-submit');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Saving...';
  
  // Show loading popup
  showPopup('loading', 'Saving service entry...');

  let saved = false;
  let billName = null;
  
  try {
    // 1. Upload file first (if exists)
    if (file && file.size > 0) {
      try {
        billName = await uploadBillFile(file);
        console.log('✅ Bill uploaded:', billName);
      } catch (uploadError) {
        console.error('❌ Bill upload failed:', uploadError);
        updatePopup('error', 'Failed to upload bill: ' + uploadError.message);
        return;
      }
    }
    
    // 2. Save to database
    const insert = {
      type: entry.type,
      date: entry.date,
      next_due: entry.nextDue || null,
      odo: parseInt(entry.odo),
      cost: parseFloat(entry.cost),
      notes: entry.notes || null,
      bill: billName // This will be null if no file was uploaded
    };
    
    const { data: insertedData, error } = await supabase
      .from('maintenance_records')
      .insert([insert])
      .select();
    
    if (error) {
      console.error('❌ Database error:', error);
      // If database insert fails, clean up uploaded file
      if (billName) {
        console.log('🧹 Cleaning up uploaded file due to DB error...');
        await deleteBillFile(billName);
      }
      throw new Error('Database error: ' + error.message);
    }
    
    // 3. Success - update local data and UI
    console.log('✅ Service entry saved successfully');
    serviceEntries.unshift(insertedData[0]);
    saved = true;
    if (window.triggerRecordSavedNotif) window.triggerRecordSavedNotif();
    
  } catch (error) {
    console.error('❌ Save failed:', error);
    updatePopup('error', 'Failed to save: ' + error.message);
  }
  
  // 4. Clean up UI
  if (saved) {
    await renderServiceTable();
    form.reset();
    document.getElementById('nextDueLabel').style.display = '';
    // The whole bill area goes back to empty with the rest of the form: the pill,
    // the dropzone's filled border, the page count and the merge line. form.reset()
    // clears the input's value and nothing else, which is why a green "2 files
    // merged into 3 pages" outlived the entry it belonged to.
    if (typeof window.dkClearBillArea === 'function') window.dkClearBillArea();
    else document.getElementById('customFileButton')
      ?.closest('.service-upload-field')?.classList.remove('has-file');
    const info = document.getElementById('fileInfo');
    if (info) info.innerHTML = '';
    updatePopup('success', 'Service entry saved successfully!');
  }
  
  btn.disabled = false;
  btn.innerHTML = original;
});

  // File validation
 function validateFileUpload(file) {
  const maxSize = 5 * 1024 * 1024; // 5MB
  const allowedExts = ['.jpg','.jpeg','.png','.gif','.webp','.bmp','.tiff','.svg','.heic','.heif','.pdf'];
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  
  if (!file.size) { 
    showPopup('error','No file selected'); 
    return false; 
  }
  if (file.size > maxSize) { 
    showPopup('error',`File size exceeds 5MB limit (${(file.size/1024/1024).toFixed(1)}MB)`); 
    return false; 
  }
  if (!allowedExts.includes(ext)) {
    showPopup('error',`Invalid file type: ${ext}. Allowed: JPG, PNG, PDF, etc.`); 
    return false;
  }
  return true;
}

  // Upload to Supabase Storage
async function uploadBillFile(file) {
  const timestamp = Date.now();
  const clean = file.name.replace(/[^a-zA-Z0-9.\-_]/g,'_');
  const name = `${timestamp}-${clean}`;
  
  console.log('🔄 Starting bill upload:', name);
  
  try {
    // Upload file with proper content type and options
    const { data, error } = await supabase.storage
      .from('service-bills')
      .upload(name, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || 'application/octet-stream'
      });
    
    if (error) {
      console.error('❌ Storage upload error:', error);
      throw new Error(`Upload failed: ${error.message}`);
    }
    
    console.log('✅ File uploaded successfully:', name);
    return name;
    
  } catch (err) {
    console.error('❌ Upload failed:', err);
    throw err;
  }
}

// Get public URL
async function getBillFileUrl(fileName) {
  if (!fileName || fileName.trim() === '') {
    return null;
  }
  
  try {

    const { data, error } = await supabase
      .storage
      .from('service-bills')
      .createSignedUrl(fileName, 60 * 60); // valid for 1 hour
    
    if (error) {
      console.warn('⚠️ Failed to get signed URL:', error);
      return null;
    }
    
    if (!data || !data.signedUrl) {
      console.warn('⚠️ No signed URL returned for:', fileName);
      return null;
    }
    return data.signedUrl;
    
  } catch (err) {
    console.error('❌ Error getting signed URL:', err);
    return null;
  }
}


  // Delete file
  async function deleteBillFile(fileName) {
    await supabase.storage.from('service-bills').remove([fileName]);
  }

  // File input setup
 function setupFileInput() {
  const fileInput = document.getElementById('fileInput');
  const button = document.getElementById('customFileButton');
  const fileInfo = document.getElementById('fileInfo');

  if (!fileInput || !button || !fileInfo) return;

  button.addEventListener('click', () => fileInput.click());

  // The dropzone's filled state. The field kept its empty "put something here"
  // look with a file inside it, so the only evidence of an attached bill was a
  // pill of text below — the one state on the panel worth seeing at a glance.
  const zone = button.closest('.service-upload-field');
  const markFilled = on => zone?.classList.toggle('has-file', !!on);

  const mergeState = document.getElementById('billMergeState');

  /**
   * Say where the merge is up to, always.
   *
   * Merging four photos of an invoice takes a few seconds on a phone — decode,
   * downscale, re-encode, write — and half a megabyte of PDF tool may have to be
   * fetched first. A wait with nothing on screen is indistinguishable from a broken
   * form, so every phase is named and so is every outcome. Nothing here finishes
   * quietly.
   */
  function showMerge(text, tone, pct) {
    if (!mergeState) return;
    mergeState.hidden = !text;
    mergeState.className = `bill-merge-state${tone ? ` is-${tone}` : ''}`;
    if (!text) { mergeState.textContent = ''; return; }
    mergeState.innerHTML = Number.isFinite(pct)
      ? `<span class="bill-merge-bar"><span style="width:${Math.max(4, Math.min(100, pct))}%"></span></span>`
        + `<span class="bill-merge-text"></span>`
      : '<span class="bill-merge-text"></span>';
    mergeState.querySelector('.bill-merge-text').textContent = text;
  }

  /**
   * Put one file back into the input, so the rest of the app sees what it expects.
   *
   * DataTransfer is the only way to write to input.files. Without it the merged PDF
   * would have to be carried in a variable beside the input, and every existing
   * reader — the submit handler, Sage's autofill, the validator — would have to
   * learn about it. One file in the input keeps all of them unchanged.
   */
  function setInputFile(file) {
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      return fileInput.files.length === 1;
    } catch (_) {
      return false;
    }
  }

  let mergeToken = 0;
  // How many pages the attached PDF ended up with, when it came from a merge. Shown
  // on the file pill rather than in a banner of its own.
  let mergedPages = null;

  /**
   * Put the bill area back to empty.
   *
   * Called on reset AND after a successful save. `form.reset()` clears the input's
   * value but knows nothing about the pill, the dropzone's filled border or the
   * merge line — which is why "2 files merged into 3 pages" was still sitting there
   * under an empty form after the entry had been logged.
   */
  function clearBillArea() {
    mergedPages = null;
    fileInfo.innerHTML = '';
    markFilled(false);
    showMerge('');
  }
  // Exposed so the submit handler can call it without reaching into this closure.
  window.dkClearBillArea = clearBillArea;

  fileInput.addEventListener('change', async () => {
    const picked = [...fileInput.files];

    if (!picked.length) {
      fileInfo.innerHTML = '';
      markFilled(false);
      showMerge('');
      return;
    }

    // More than one: merge first, and nothing downstream runs until it is one file.
    if (picked.length > 1) {
      const token = ++mergeToken;
      const merger = window.dkBillMerge;
      if (!merger) {
        showMerge('Several files were picked but the merger is not loaded. '
          + 'Pick one file, or reload the page.', 'bad');
        fileInput.value = '';
        fileInfo.innerHTML = '';
        markFilled(false);
        return;
      }

      button.disabled = true;
      showMerge(`Merging ${picked.length} files…`, 'busy', 4);

      let result;
      try {
        result = await merger.merge(picked, state => {
          // A second pick while the first is still merging wins; the older run must
          // not keep writing over the newer one's status line.
          if (token !== mergeToken) return;
          showMerge(state.text, 'busy', state.pct);
        });
      } catch (err) {
        result = { ok: false, error: (err && err.message) || 'The merge failed.' };
      }
      button.disabled = false;
      if (token !== mergeToken) return;

      if (!result.ok) {
        showMerge(result.error || 'Those files could not be merged.', 'bad');
        fileInput.value = '';
        fileInfo.innerHTML = '';
        markFilled(false);
        // Told again through the normal channel, so a failure is not only visible
        // in one small line he may have scrolled past.
        updatePopup('error', result.error || 'Those files could not be merged.');
        return;
      }

      if (!setInputFile(result.file)) {
        showMerge('This browser will not let the merged file be attached. '
          + 'Pick a single file instead.', 'bad');
        fileInput.value = '';
        markFilled(false);
        return;
      }
      // Success is NOT a banner of its own. It used to be: a green bar above the
      // dropzone, the dropzone, then a green "SELECTED: …" pill below it — three
      // stacked elements and two separate greens saying one thing between them.
      // The page count belongs on the pill that names the file, so there is one
      // line of state and it sits with what it describes.
      mergedPages = result.pages;
      showMerge('');
    } else {
      mergedPages = null;
      showMerge('');
    }

    const file = fileInput.files[0];
    if (!file) {
      fileInfo.innerHTML = '';
      markFilled(false);
      return;
    }
    if (!validateFileUpload(file)) {
      fileInput.value = '';
      fileInfo.innerHTML = '';
      markFilled(false);
      showMerge('');
      return;
    }
    markFilled(true);
    // The autofill listens for `change` too, and its own handler ran before the
    // merge finished — on the multi-file list, which it cannot read. Fire once more
    // now that the input holds exactly the file she will be given.
    if (picked.length > 1) {
      fileInput.dispatchEvent(new CustomEvent('dk-bill-ready', { bubbles: true }));
    }
    const size = file.size < 1024 * 1024
      ? `${(file.size / 1024).toFixed(1)} KB`
      : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
    const ext = file.name.split('.').pop().toLowerCase();
    let icon = '📄';
    if (['jpg','jpeg','png','gif','webp','bmp','tiff','svg','heic','heif'].includes(ext)) icon = '🖼️';
    else if (ext === 'pdf') icon = '📋';
    // The filename, mid-truncated rather than shouted. "SELECTED:
    // WHATSAPP-IMAGE-2026-09-20-AT-6-36-41-PM-PLUS-1.PDF" in caps was most of the
    // width of a phone and unreadable at either end; the tail is the part that says
    // what kind of file it is, so both ends survive and the middle gives way. The
    // full name stays in the title.
    const pages = mergedPages ? `<span class="file-pill-pages">${mergedPages} pages</span>` : '';
    fileInfo.innerHTML = `<div class="selected-file-pill" title="${escapeAttr(file.name)}">
      <span class="file-pill-icon" aria-hidden="true">${icon}</span>
      <span class="file-pill-name">${escapeHTML(file.name)}</span>
      ${pages}<small>${size}</small>
      <button type="button" class="file-pill-drop" aria-label="Remove ${escapeAttr(file.name)}">&times;</button>
    </div>`;
    fileInfo.querySelector('.file-pill-drop')?.addEventListener('click', () => {
      fileInput.value = '';
      clearBillArea();
      // So her button goes dormant again and the autofill hint clears.
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}

// createFileInfoElement() built a #fileInfo div next to the bill input. That
  // element ships in index.html now and the live code reads it directly, so the
  // builder had no caller and would have produced a duplicate id if it ever got
  // one.

  window.deleteServiceRecord = async function(id, billFileName, btnElement) {
  console.log('🗑️ Deleting service record:', { id, billFileName });

  confirmDeleteWithHold(
    (billFileName && billFileName.trim()
      ? 'The record and its bill both go.'
      : 'The record goes from your history.')
    + '<br><b>This cannot be undone.</b>',
    async () => {
      showPopup('loading', 'Deleting...');

      try {
        // DELETE FROM DB
        const { error: dbError } = await supabase
          .from('maintenance_records')
          .delete()
          .eq('id', id);

        if (dbError) {
          throw new Error('Database delete failed: ' + dbError.message);
        }

        // DELETE FROM STORAGE
        if (billFileName && billFileName.trim()) {
          console.log('🔄 Attempting file delete:', billFileName);
          const { error: storageError } = await supabase
            .storage
            .from('service-bills')
            .remove([billFileName]);

          if (storageError) {
            console.error('❌ Storage delete error:', storageError);
            throw new Error('Failed to delete file: ' + storageError.message);
          } else {
            console.log('✅ File deleted from storage');
          }
        } else {
          console.warn('⚠️ No file name provided, skipping storage delete');
        }

        // CLEANUP
        serviceEntries = serviceEntries.filter(e => Number(e.id) !== Number(id));
        await renderServiceTable();
        updateHomeServiceInfo();
        updatePopup('success', 'Deleted!');
      } catch (err) {
        console.error('❌ Delete failed:', err);
        updatePopup('error', err.message || 'Delete failed');
      }
    },
    { title: 'Delete this service record?', icon: 'fa-screwdriver-wrench' }
  );
};


  // ════════════════════════════════════════════════════════════════════
  // HOLD A ROW TO EDIT IT
  //
  // The app could only ever insert and delete a service record, so correcting a
  // mistyped odometer meant deleting the row — and re-uploading its bill, because
  // the delete takes the file with it. dkApp.updateService has existed for a while
  // for exactly this, but only Sage could reach it.
  //
  // Everything below lives inside this handler on purpose: it needs
  // `serviceEntries` and `renderServiceTable`, both of which are closure-local.
  // ════════════════════════════════════════════════════════════════════

  // Long enough not to fire on a tap or the start of a scroll, short enough that
  // you are not holding a phone still wondering whether it worked.
  const SVC_HOLD_MS = 520;
  const SVC_HOLD_MOVE = 10;

  let svcEditing = null;

  function svcEditEls() {
    return {
      modal: document.getElementById('serviceEditModal'),
      form: document.getElementById('serviceEditForm'),
      what: document.getElementById('serviceEditWhat'),
      type: document.getElementById('serviceEditType'),
      date: document.getElementById('serviceEditDate'),
      due: document.getElementById('serviceEditDue'),
      dueField: document.getElementById('serviceEditDueField'),
      odo: document.getElementById('serviceEditOdo'),
      cost: document.getElementById('serviceEditCost'),
      notes: document.getElementById('serviceEditNotes'),
      status: document.getElementById('serviceEditStatus'),
      save: document.getElementById('serviceEditSave'),
      cancel: document.getElementById('serviceEditCancel'),
      close: document.getElementById('serviceEditClose'),
    };
  }

  /** Next Due means nothing for a mod, so it is hidden rather than ignored. */
  function svcSyncDueField() {
    const e = svcEditEls();
    if (!e.dueField) return;
    e.dueField.hidden = e.type.value === 'Mods/Updates';
  }

  function openServiceEditor(record) {
    const e = svcEditEls();
    if (!e.modal || !record) return;

    svcEditing = record;
    e.what.textContent = `${record.type || 'Record'} · ${formatServiceDate(record.date)}`;
    e.type.value = ['Showroom', '3rd Party', 'Mods/Updates'].includes(record.type)
      ? record.type : 'Showroom';
    e.date.value = record.date || '';
    e.due.value = record.next_due || '';
    e.odo.value = record.odo ?? '';
    e.cost.value = record.cost ?? '';
    e.notes.value = record.notes || '';
    e.status.textContent = '';
    e.status.className = 'svc-edit-status';
    svcSyncDueField();

    e.modal.setAttribute('aria-hidden', 'false');
    e.modal.classList.add('sl-modal--open');
    // Focused after the sheet has finished arriving, or a phone scrolls the page
    // to the field mid-animation.
    setTimeout(() => e.odo?.focus({ preventScroll: true }), 80);
  }

  function closeServiceEditor() {
    const e = svcEditEls();
    svcEditing = null;
    e.modal?.classList.remove('sl-modal--open');
    e.modal?.setAttribute('aria-hidden', 'true');
  }

  async function saveServiceEditor() {
    const e = svcEditEls();
    if (!svcEditing) return;

    const fail = msg => {
      e.status.textContent = msg;
      e.status.className = 'svc-edit-status is-bad';
    };

    // Checked here as well as in updateService, because an emptied number field
    // is the one case that would pass validation and do real damage: Number('')
    // is 0, which is finite and >= 0, so a cleared ODO would save as 0 km.
    if (!e.date.value) return fail('Pick the date this was done.');
    if (e.odo.value === '') return fail('ODO cannot be left empty.');
    if (e.cost.value === '') return fail('Cost cannot be left empty — use 0 if it was free.');

    e.save.disabled = true;
    const label = e.save.innerHTML;
    e.save.innerHTML = '<span class="sl-spinner" aria-hidden="true"></span> Saving';
    e.status.textContent = '';
    e.status.className = 'svc-edit-status';

    // updateService does not blank next_due for a mod the way logService does, so
    // an explicit empty string is sent rather than leaving a stale date behind a
    // hidden field.
    const result = await window.dkApp.updateService({
      id: svcEditing.id,
      type: e.type.value,
      date: e.date.value,
      nextDue: e.type.value === 'Mods/Updates' ? '' : (e.due.value || ''),
      odo: e.odo.value,
      cost: e.cost.value,
      notes: e.notes.value.trim(),
    });

    e.save.disabled = false;
    e.save.innerHTML = label;

    if (!result || !result.ok) {
      fail(result?.error || 'That did not save.');
      return;
    }

    closeServiceEditor();
    if (typeof showPopup === 'function') showPopup('success', 'Record updated!');
  }

  /**
   * Hold detection, delegated on the tbody.
   *
   * Delegated rather than per row because renderServiceTable() replaces the whole
   * tbody with one innerHTML assignment on every repaint — and it repaints after
   * every add, edit, delete and filter keystroke. A listener attached to a row in
   * that loop would be discarded seconds later.
   */
  function setupServiceRowHold() {
    const tbody = document.getElementById('serviceTableBody');
    if (!tbody) return;

    let timer = null;
    let row = null;
    let startX = 0;
    let startY = 0;

    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      row?.classList.remove('is-holding');
      row = null;
    };

    tbody.addEventListener('pointerdown', ev => {
      clear();
      // The two controls inside a row own their own taps. Without this, holding
      // the bill button or the × would open the editor behind the dialog they
      // just opened.
      if (ev.target.closest('button, a')) return;

      const hit = ev.target.closest('.service-record-row');
      if (!hit || !hit.dataset.recordId) return;

      row = hit;
      startX = ev.clientX;
      startY = ev.clientY;
      row.classList.add('is-holding');

      timer = setTimeout(() => {
        const id = row?.dataset.recordId;
        clear();
        const record = serviceEntries.find(r => String(r.id) === String(id));
        if (record) openServiceEditor(record);
      }, SVC_HOLD_MS);
    });

    // A scroll that starts on a row must not become an edit. pointercancel covers
    // the browser taking the gesture over for scrolling; the move threshold covers
    // a slow drag that never gets that far.
    tbody.addEventListener('pointermove', ev => {
      if (!timer) return;
      if (Math.abs(ev.clientX - startX) > SVC_HOLD_MOVE
        || Math.abs(ev.clientY - startY) > SVC_HOLD_MOVE) clear();
    });
    tbody.addEventListener('pointerup', clear);
    tbody.addEventListener('pointerleave', clear);
    tbody.addEventListener('pointercancel', clear);
    // Holding on a phone otherwise raises the native text-selection callout on top
    // of the sheet. The CSS kills the selection; this kills the menu.
    tbody.addEventListener('contextmenu', ev => {
      if (ev.target.closest('.service-record-row')) ev.preventDefault();
    });

    const e = svcEditEls();
    e.form?.addEventListener('submit', ev => { ev.preventDefault(); saveServiceEditor(); });
    e.type?.addEventListener('change', svcSyncDueField);
    e.cancel?.addEventListener('click', closeServiceEditor);
    e.close?.addEventListener('click', closeServiceEditor);
    e.modal?.addEventListener('click', ev => { if (ev.target === e.modal) closeServiceEditor(); });
    document.addEventListener('keydown', ev => {
      if (ev.key !== 'Escape') return;
      if (!e.modal?.classList.contains('sl-modal--open')) return;
      // The slide dialog handles its own Escape in the capture phase; if it is up,
      // it is on top of this and the key is its to consume.
      if (window.SageConfirm?.isOpen()) return;
      closeServiceEditor();
    });
  }

  setupServiceRowHold();


  // ════════════════════════════════════════════════════════════════════
  // APP API — window.dkApp
  //
  // Everything Sage can actually DO, in one place.
  //
  // Before this she had no hands at all, only a read-only snapshot. Asked to
  // update an insurance date she replied "got it, registered that for
  // 24/06/2027" and nothing whatsoever happened — she had no way to act and no
  // way to know that, so she invented the outcome. That is the worst failure
  // mode available to an assistant, and it is fixed by giving her real controls
  // that report real results rather than by asking her not to lie.
  //
  // Deliberate rules for everything below:
  //   · Every method resolves to {ok:true, ...} or {ok:false, error}. Never
  //     throws, never returns undefined — the tool layer forwards this verbatim
  //     to the model, so a failure has to be legible to her.
  //   · Nothing here is destructive without going through the app's own
  //     slide-to-delete dialog, so a delete always passes through the user's
  //     thumb rather than her judgement.
  //   · Every write refreshes the UI it affects, so the screen and her claim
  //     about the screen cannot disagree.
  // ════════════════════════════════════════════════════════════════════

  /**
   * Ask the user to confirm, using the same slide-to-delete dialog as the UI.
   *
   * The dialog resolves true or false on its own now, so this is a thin pass
   * through. It used to poll #customPopup's class list every 250ms to notice a
   * dismissal, because the hold-to-delete popup had no cancel callback — which
   * meant a cancel took up to a quarter of a second to register, and a delete
   * that reused the popup for its progress message looked like a confirmation.
   *
   * If the dialog did not load, this answers no. Sage asking to delete something
   * and getting silence is the safe failure; her deleting it unasked is not.
   */
  async function askToConfirm(message, title) {
    const C = window.SageConfirm;
    if (!C || typeof C.slide !== 'function') {
      console.warn('[SpinLog] Slide-to-delete is not loaded, so her delete was refused.');
      return false;
    }
    return C.slide({
      title: title || 'Sage wants to delete this',
      // Trusted markup: every caller below escapes the parts that come from the
      // database and supplies the <br> and <b> itself.
      html: message,
      label: 'Slide to delete',
      icon: 'fa-trash-can',
    });
  }

  const okISO = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

  /* ── The attachment desk ────────────────────────────────────────────
     A file the user has clipped to a chat message, waiting to be used. Sage
     sees it as an image or PDF in the conversation; these controls are how it
     gets stored somewhere permanent. One slot only: a chat message carries one
     file, and holding more would just create ambiguity about which one a tool
     meant. Cleared once used or once the message is done with. */
  // A QUEUE, not one slot. A message can carry several files, and each upload
  // control takes the one that suits its kind and releases only that — so "file
  // the bill and put the photo in the archive" is two calls over one message
  // instead of two messages.
  let heldFiles = [];

  const MAX_UPLOAD_BYTES = 9 * 1024 * 1024;

  const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg', 'heic', 'heif'];
  const KIND_EXT = {
    image: IMAGE_EXT,
    audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'],
    video: ['mp4', 'mov', 'avi', 'webm', 'mpeg', 'mpg'],
    document: [...IMAGE_EXT, 'pdf'],
  };

  function extOf(name) {
    return String(name || '').split('.').pop().toLowerCase();
  }

  /** Validation that returns a sentence rather than throwing a popup. */
  function checkHeldFile(kind) {
    if (!heldFiles.length) {
      return { ok: false, error: 'There is no file attached. Ask him to clip one to his message with the paperclip, then try again.' };
    }

    const allowed = KIND_EXT[kind];
    // Picked BY KIND rather than always taking the first. That is what makes a
    // mixed message work: with a PDF bill and a photo both clipped on, attach_bill
    // finds the PDF and upload_media finds the image, and neither has to ask him
    // which was which.
    const match = allowed
      ? heldFiles.find(f => allowed.includes(extOf(f.name)))
      : heldFiles[0];

    if (!match) {
      const names = heldFiles.map(f => f.name).join(', ');
      return {
        ok: false,
        error: `None of the attached files can be a ${kind}. He clipped ${names}. Allowed: ${allowed.join(', ')}.`,
      };
    }
    if (match.size > MAX_UPLOAD_BYTES) {
      return { ok: false, error: `${match.name} is ${(match.size / 1048576).toFixed(1)}MB, over the ${MAX_UPLOAD_BYTES / 1048576}MB limit.` };
    }
    return { ok: true, file: match };
  }

  /** Bytes for a stored file, so she can open and actually read it. */
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('could not read that file'));
      reader.onload = () => {
        const out = String(reader.result || '');
        const comma = out.indexOf(',');
        resolve(comma === -1 ? out : out.slice(comma + 1));
      };
      reader.readAsDataURL(blob);
    });
  }

  const READABLE_MIME = /^(image|audio|video)\/|^application\/pdf$/;
  const MIME_BY_EXT = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', gif: 'image/gif',
    mp3: 'audio/mp3', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
    flac: 'audio/flac', ogg: 'audio/ogg', mp4: 'video/mp4', mov: 'video/quicktime',
    webm: 'video/webm', avi: 'video/x-msvideo', mpeg: 'video/mpeg', mpg: 'video/mpeg',
  };

  /**
   * Pull a stored file out of Supabase and hand it back as something she can
   * look at. The tool layer forwards `_attachFile` into the conversation as an
   * inline attachment, which is what turns "open my RC" into her actually
   * reading it rather than reciting its file name.
   */
  async function fetchForReading(bucket, fileName, signer) {
    const url = await signer(fileName);
    if (!url) return { ok: false, error: 'Could not get a link to that file.' };
    const res = await fetch(url);
    if (!res.ok) return { ok: false, error: 'That file could not be downloaded.' };
    const blob = await res.blob();
    if (blob.size > MAX_UPLOAD_BYTES) {
      return { ok: false, error: `That file is ${(blob.size / 1048576).toFixed(1)}MB — too big to open. Its details are all you have.` };
    }
    const mimeType = READABLE_MIME.test(blob.type) ? blob.type : MIME_BY_EXT[extOf(fileName)];
    if (!mimeType) return { ok: false, error: `You cannot read a .${extOf(fileName)} file.` };
    return { ok: true, mimeType, data: await blobToBase64(blob) };
  }

  window.dkApp = {
    /* ── The attachment desk ──────────────────────────────────────── */

    holdFiles(list) {
      heldFiles = Array.from(list || []).filter(Boolean);
      return { ok: true, holding: heldFiles.map(f => f.name) };
    },
    /** The single-file shape, kept so any older caller still works. */
    holdFile(file) { return window.dkApp.holdFiles(file ? [file] : []); },
    heldFile() { return heldFiles[0] || null; },
    heldFiles() { return heldFiles.slice(); },
    /**
     * Drop one file once it has been stored somewhere, or all of them.
     *
     * The argument matters: called bare it empties the queue, which is right when
     * the message is done with but wrong after a single successful upload — that
     * would throw away the other files he clipped on before she got to them.
     */
    releaseFile(file) {
      if (!file) { heldFiles = []; return; }
      heldFiles = heldFiles.filter(f => f !== file);
    },
    describeHeldFile() {
      const f = heldFiles[0];
      if (!f) return null;
      return { fileName: f.name, sizeBytes: f.size, type: f.type || null };
    },
    describeHeldFiles() {
      return heldFiles.map(f => ({ fileName: f.name, sizeBytes: f.size, type: f.type || null }));
    },

    /* ── Reading ──────────────────────────────────────────────────── */

    /**
     * Service history, newest first.
     *
     * Returns cost totals over EVERY matching record, not just the page it
     * hands back. Without them the only way to answer "what have I spent" from
     * this tool was to add up `records` — and since the default limit is 20
     * against 21 records, that silently dropped the oldest row and produced
     * ₹26,604 against a real total of ₹27,103. `truncated` says so outright, so
     * a partial list can never be mistaken for the whole set.
     */
    async listServices({ limit = 20, type = null, from = null, to = null } = {}) {
      let rows = serviceEntries.slice();
      if (type) rows = rows.filter(r => String(r.type || '').toLowerCase() === String(type).toLowerCase());
      if (okISO(from)) rows = rows.filter(r => r.date && r.date >= from);
      if (okISO(to)) rows = rows.filter(r => r.date && r.date <= to);
      rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));

      const shown = rows.slice(0, Math.min(50, Math.max(1, limit)));
      const isMod = r => String(r.type || '').toLowerCase() === 'mods/updates';
      const sum = list => Math.round(list.reduce((t, r) => {
        const cost = Number(r.cost);
        return t + (Number.isFinite(cost) ? cost : 0);
      }, 0));
      const mods = rows.filter(isMod);

      return {
        ok: true,
        total: rows.length,
        showing: shown.length,
        truncated: shown.length < rows.length,
        // Over all `total` records, including any not listed below.
        totals: {
          everything: sum(rows),
          servicing: sum(rows.filter(r => !isMod(r))),
          modsAndUpdates: sum(mods),
          modsCounted: mods.length,
          servicesCounted: rows.length - mods.length,
          currency: 'INR',
        },
        records: shown.map(r => ({
          id: r.id, date: r.date, type: r.type,
          odo: r.odo, cost: r.cost, nextDue: r.next_due,
          notes: r.notes, hasBill: !!r.bill,
        })),
      };
    },

    async getCover() {
      const cards = Array.from(document.querySelectorAll('.dk-cover-card')).map(card => ({
        label: card.querySelector('.dk-cover-label')?.textContent?.trim() || '',
        expiry: card.querySelector('.dk-cover-status[data-due]')?.getAttribute('data-due') || null,
      })).filter(c => c.label && c.expiry);
      return { ok: true, cover: cards };
    },

    async listDocuments() {
      await ensureDocsLoaded();
      const docs = Array.from(document.querySelectorAll('.vehicle-docs-grid .doc-card[data-type]')).map(card => ({
        document: card.dataset.type,
        onFile: !!card.querySelector('.doc-open-pill'),
        custom: card.classList.contains('is-custom'),
      }));
      return { ok: true, documents: docs };
    },

    async listMedia({ limit = 20 } = {}) {
      await ensureDocsLoaded();
      const rows = Array.from(window._historicMediaRows?.values() || []);
      rows.sort((a, b) => String(b.upload_date).localeCompare(String(a.upload_date)));
      return {
        ok: true,
        total: rows.length,
        media: rows.slice(0, Math.min(50, Math.max(1, limit))).map(r => ({
          id: r.id, kind: r.media_type, fileName: r.original_name,
          uploadedOn: String(r.upload_date || '').slice(0, 10),
          notes: r.notes || getHistoricLocalNote(r.id) || null,
        })),
      };
    },

    async listParkHistory() {
      const history = cloudStore()?.parkHistory() || [];
      return {
        ok: true,
        total: history.length,
        // The place, the level and the note are given to her too. A rider asking
        // "where did I leave it at the mall?" is asking about the label he typed,
        // not the coordinates, and she could not see it before.
        parked: history.map(p => ({
          when: new Date(p.at).toISOString(), address: p.address || null,
          lat: p.lat, lng: p.lng, accuracyM: p.accuracy || null,
          place: p.label || null, level: p.level || null, note: p.notes || null,
          hasPhoto: !!p.photo,
          moveBy: p.until ? new Date(p.until).toISOString() : null,
        })),
      };
    },

    /* ── Writing ──────────────────────────────────────────────────── */

    async logService({ type, date, odo, cost, notes = null, nextDue = null }) {
      if (!type) return { ok: false, error: 'A service type is required: Showroom, 3rd Party or Mods/Updates.' };
      const allowed = ['Showroom', '3rd Party', 'Mods/Updates'];
      const matched = allowed.find(t => t.toLowerCase() === String(type).toLowerCase());
      if (!matched) return { ok: false, error: `type must be one of ${allowed.join(', ')}.` };
      if (!okISO(date)) return { ok: false, error: 'date must be YYYY-MM-DD.' };
      if (nextDue && !okISO(nextDue)) return { ok: false, error: 'nextDue must be YYYY-MM-DD.' };

      const odoNum = Number(odo);
      const costNum = Number(cost);
      if (!Number.isFinite(odoNum) || odoNum < 0) return { ok: false, error: 'odo must be a number of kilometres.' };
      if (!Number.isFinite(costNum) || costNum < 0) return { ok: false, error: 'cost must be a number of rupees.' };

      const insert = {
        type: matched, date,
        next_due: matched === 'Mods/Updates' ? null : (nextDue || null),
        odo: Math.round(odoNum),
        cost: costNum,
        notes: notes || null,
        // No bill: the chat has no file to attach. The record is still valid and
        // the History row will simply show "No bill".
        bill: null,
      };

      const { data, error } = await supabase.from('maintenance_records').insert([insert]).select();
      if (error) return { ok: false, error: `The database refused it: ${error.message}` };

      serviceEntries.unshift(data[0]);
      await renderServiceTable();
      if (window.sageRefreshHealthCard) window.sageRefreshHealthCard();

      return {
        ok: true,
        saved: { id: data[0].id, ...insert },
        note: 'Saved without a bill, because chat cannot attach a file. He can add one from the Service page.',
      };
    },

    async updateCover({ label, date }) {
      if (!okISO(date)) return { ok: false, error: 'date must be YYYY-MM-DD.' };

      const cards = Array.from(document.querySelectorAll('.dk-cover-card'));
      const wanted = String(label || '').toLowerCase().trim();
      const card = cards.find(c => {
        const name = c.querySelector('.dk-cover-label')?.textContent?.trim().toLowerCase() || '';
        return name === wanted || (wanted && name.includes(wanted));
      });
      if (!card) {
        return {
          ok: false,
          error: `No cover called "${label}". Available: ${cards.map(c => c.querySelector('.dk-cover-label')?.textContent?.trim()).filter(Boolean).join(', ')}.`,
        };
      }

      const statusEl = card.querySelector('.dk-cover-status[data-due]');
      const name = card.querySelector('.dk-cover-label')?.textContent?.trim();
      const was = statusEl.getAttribute('data-due');

      statusEl.setAttribute('data-due', date);
      window.dkCoverStore.writeLocal(name, date);
      if (typeof window.updateCoverBadge === 'function') window.updateCoverBadge(statusEl);
      if (window.checkInsuranceNotif) window.checkInsuranceNotif(date);
      if (window.checkDocNotif) window.checkDocNotif(date, name);
      if (window.dkSyncNotifData) window.dkSyncNotifData();

      const storedInDb = await window.dkCoverStore.saveToDb(name, date);
      if (window.sageRefreshHealthCard) window.sageRefreshHealthCard();

      return {
        ok: true,
        cover: name,
        was,
        now: date,
        storedInDb,
        note: storedInDb ? undefined : 'Saved on this device only — the database did not accept it.',
      };
    },

    async updateMediaNotes({ id, notes }) {
      const text = String(notes || '').trim();
      if (!text) return { ok: false, error: 'notes cannot be empty.' };
      await ensureDocsLoaded();
      const row = window._historicMediaRows?.get(Number(id));
      if (!row) return { ok: false, error: `No upload with id ${id}. Use listMedia first.` };
      const synced = await updateHistoricNotes(Number(id), text);
      await loadHistoricUploads();
      return { ok: true, id: Number(id), fileName: row.original_name, notes: text, storedInDb: synced };
    },

    async setAgeFrom({ date }) {
      if (!okISO(date)) return { ok: false, error: 'date must be YYYY-MM-DD.' };
      if (!window.dkVehicle.setAgeFrom(date)) return { ok: false, error: 'That date was refused.' };
      if (window.dkHomeInsights) window.dkHomeInsights(window.dkGetSnapshot());
      return { ok: true, ageCountedFrom: date, age: window.dkVehicle.age()?.long || null };
    },

    /**
     * Edit an existing service record. The app has no edit screen at all — the
     * form only inserts — so this is the only way to correct a typo in a logged
     * record without deleting and re-adding it.
     */
    async updateService({ id, type, date, odo, cost, notes, nextDue }) {
      const record = serviceEntries.find(r => Number(r.id) === Number(id));
      if (!record) return { ok: false, error: `No service record with id ${id}. Use list_services first.` };

      const patch = {};
      if (type !== undefined) {
        const allowed = ['Showroom', '3rd Party', 'Mods/Updates'];
        const matched = allowed.find(t => t.toLowerCase() === String(type).toLowerCase());
        if (!matched) return { ok: false, error: `type must be one of ${allowed.join(', ')}.` };
        patch.type = matched;
      }
      if (date !== undefined) {
        if (!okISO(date)) return { ok: false, error: 'date must be YYYY-MM-DD.' };
        patch.date = date;
      }
      if (nextDue !== undefined) {
        if (nextDue && !okISO(nextDue)) return { ok: false, error: 'nextDue must be YYYY-MM-DD.' };
        patch.next_due = nextDue || null;
      }
      if (odo !== undefined) {
        const n = Number(odo);
        if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'odo must be a number of kilometres.' };
        patch.odo = Math.round(n);
      }
      if (cost !== undefined) {
        const n = Number(cost);
        if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'cost must be a number of rupees.' };
        patch.cost = n;
      }
      if (notes !== undefined) patch.notes = notes || null;

      if (!Object.keys(patch).length) return { ok: false, error: 'Nothing to change — name at least one field.' };

      const { data, error } = await supabase
        .from('maintenance_records').update(patch).eq('id', record.id).select();
      if (error) return { ok: false, error: `The database refused it: ${error.message}` };
      if (!data || !data.length) {
        return { ok: false, error: 'The database accepted nothing back. It probably has no UPDATE policy for maintenance_records.' };
      }

      Object.assign(record, data[0]);
      await renderServiceTable();
      if (window.sageRefreshHealthCard) window.sageRefreshHealthCard();
      return { ok: true, id: record.id, changed: patch };
    },

    /* ── Files, in and out ────────────────────────────────────────── */

    /** Put the attached file on a service record as its bill. */
    async attachBill({ id }) {
      const record = serviceEntries.find(r => Number(r.id) === Number(id));
      if (!record) return { ok: false, error: `No service record with id ${id}. Use list_services first.` };

      const held = checkHeldFile('document');
      if (!held.ok) return held;

      const previous = record.bill || null;
      let stored;
      try {
        stored = await uploadBillFile(held.file);
      } catch (err) {
        return { ok: false, error: `The upload failed: ${err.message}` };
      }

      const { data, error } = await supabase
        .from('maintenance_records').update({ bill: stored }).eq('id', record.id).select();
      if (error || !data || !data.length) {
        // Do not leave an orphan in storage if the row would not take it.
        await supabase.storage.from('service-bills').remove([stored]);
        return {
          ok: false,
          error: error ? `The database refused it: ${error.message}`
            : 'The database accepted nothing back — maintenance_records probably has no UPDATE policy.',
        };
      }

      // Only now is the old bill safe to drop.
      if (previous) await supabase.storage.from('service-bills').remove([previous]);

      record.bill = stored;
      await renderServiceTable();
      // Only the file that was just stored. Bare, this cleared the whole queue and
      // the other files he clipped on were gone before she reached them.
      window.dkApp.releaseFile(held.file);
      return {
        ok: true,
        id: record.id,
        billFileName: held.file.name,
        replacedAnOlderBill: !!previous,
      };
    },

    /** Store the attached file as one of his documents. */
    async uploadDocument({ document: type, notes = null }) {
      const name = String(type || '').trim().replace(/\s+/g, ' ');
      if (!name) return { ok: false, error: 'Name the document, e.g. "Warranty Card".' };

      const held = checkHeldFile('document');
      if (!held.ok) return held;

      await ensureDocsLoaded();
      const existing = await getLatestVehicleDoc(name);
      if (existing) {
        return {
          ok: false,
          error: `There is already a ${name} on file. Delete that one first, or use a different name.`,
        };
      }

      const clean = held.file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const storedName = `${Date.now()}-${clean}`;
      const contentType = held.file.type || 'application/octet-stream';

      const { error: uploadErr } = await supabase.storage
        .from('vehicle-documents')
        .upload(storedName, held.file, { contentType, cacheControl: '3600', upsert: false });
      if (uploadErr) return { ok: false, error: `The upload failed: ${uploadErr.message}` };

      const row = {
        file_name: storedName,
        original_name: held.file.name,
        document_type: name,
        file_size: held.file.size,
        content_type: contentType,
        upload_date: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Older deployments of this table have no notes column.
      let { error } = await supabase.from('vehicle_documents').insert([{ ...row, notes }]);
      if (error && /notes/i.test(error.message || '')) {
        ({ error } = await supabase.from('vehicle_documents').insert([row]));
      }
      if (error) {
        await supabase.storage.from('vehicle-documents').remove([storedName]);
        return { ok: false, error: `The database refused it: ${error.message}` };
      }

      await loadVehicleDocsFast(docsFixedCards);
      // Only the file that was just stored. Bare, this cleared the whole queue and
      // the other files he clipped on were gone before she reached them.
      window.dkApp.releaseFile(held.file);
      if (window.triggerRecordSavedNotif) window.triggerRecordSavedNotif();
      return { ok: true, document: name, fileName: held.file.name };
    },

    /** Store the attached file in the historic archive. */
    async uploadMedia({ kind, notes }) {
      const allowed = ['image', 'audio', 'video'];
      if (!allowed.includes(kind)) return { ok: false, error: `kind must be one of ${allowed.join(', ')}.` };
      const text = String(notes || '').trim();
      if (!text) return { ok: false, error: 'The archive requires notes. Describe what the file is first.' };

      const held = checkHeldFile(kind);
      if (!held.ok) return held;

      const clean = held.file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const storedName = `${Date.now()}-${clean}`;
      const ext = extOf(held.file.name);
      const contentType = held.file.type || MIME_BY_EXT[ext] || 'application/octet-stream';

      const { error: uploadErr } = await supabase.storage
        .from('historic-media')
        .upload(storedName, held.file, { contentType, cacheControl: '3600', upsert: false });
      if (uploadErr) return { ok: false, error: `The upload failed: ${uploadErr.message}` };

      const row = {
        media_type: kind,
        file_name: storedName,
        original_name: held.file.name,
        file_size: held.file.size,
        content_type: contentType,
        upload_date: new Date().toISOString(),
        notes: text,
      };

      let { data, error } = await supabase.from('media_files').insert([row]).select();
      if (error && /notes/i.test(error.message || '')) {
        const bare = { ...row };
        delete bare.notes;
        ({ data, error } = await supabase.from('media_files').insert([bare]).select());
      }
      if (error) {
        await supabase.storage.from('historic-media').remove([storedName]);
        return { ok: false, error: `The database refused it: ${error.message}` };
      }

      if (data?.[0]?.id) setHistoricLocalNote(data[0].id, text);
      await loadHistoricUploads();
      // Only the file that was just stored. Bare, this cleared the whole queue and
      // the other files he clipped on were gone before she reached them.
      window.dkApp.releaseFile(held.file);
      return { ok: true, id: data?.[0]?.id ?? null, kind, fileName: held.file.name, notes: text };
    },

    /** Open a stored document so she can read what is inside it. */
    async readDocument({ document: type }) {
      await ensureDocsLoaded();
      const latest = await getLatestVehicleDoc(type);
      if (!latest) return { ok: false, error: `Nothing on file for "${type}". Use list_documents to see what is there.` };
      const file = await fetchForReading('vehicle-documents', latest.file_name, getSignedUrl);
      if (!file.ok) return file;
      return {
        ok: true,
        document: type,
        fileName: latest.original_name,
        opened: true,
        _attachFile: { mimeType: file.mimeType, data: file.data },
      };
    },

    /** Open a stored photo, recording or video so she can describe it. */
    async readMedia({ id }) {
      await ensureDocsLoaded();
      const row = window._historicMediaRows?.get(Number(id));
      if (!row) return { ok: false, error: `No upload with id ${id}. Use list_media first.` };
      const file = await fetchForReading('historic-media', row.file_name, getHistoricMediaUrl);
      if (!file.ok) return file;
      return {
        ok: true,
        id: row.id,
        fileName: row.original_name,
        kind: row.media_type,
        opened: true,
        _attachFile: { mimeType: file.mimeType, data: file.data },
      };
    },

    async setMediaDate({ id, date }) {
      if (!okISO(date)) return { ok: false, error: 'date must be YYYY-MM-DD.' };
      await ensureDocsLoaded();
      const row = window._historicMediaRows?.get(Number(id));
      if (!row) return { ok: false, error: `No upload with id ${id}. Use list_media first.` };
      const result = await persistHistoricDateToDatabase(Number(id), date);
      // Same two rules as the edit sheet: the day she was given is what gets cached
      // (not result.value, which is a noon-UTC instant for a column that holds a
      // day), and a row with a real clock reading keeps it on the new day.
      const moved = historicStampOnDay(getHistoricTakenAt(Number(id)), date);
      if (moved) await setHistoricTakenAt(result.id || Number(id), moved);
      else setHistoricLocalDate(result.id || Number(id), date);
      await loadHistoricUploads();
      return {
        ok: true, id: Number(id), date, storedInDb: result.ok,
        note: result.ok ? undefined : 'Saved on this device only — media_files has no UPDATE policy.',
      };
    },

    /* ── Looking things up ────────────────────────────────────────── */

    async search({ query, limit = 10 }) {
      const q = String(query || '').trim().toLowerCase();
      if (!q) return { ok: false, error: 'Give me something to search for.' };
      const cap = Math.min(25, Math.max(1, limit));
      const hits = [];

      serviceEntries.forEach(r => {
        const hay = [r.type, r.date, r.next_due, r.odo, r.cost, r.notes].filter(Boolean).join(' ').toLowerCase();
        if (hay.includes(q)) {
          hits.push({ where: 'service', id: r.id, date: r.date, type: r.type, odo: r.odo, cost: r.cost, notes: r.notes });
        }
      });

      Array.from(window._historicMediaRows?.values() || []).forEach(r => {
        const hay = [r.original_name, r.notes, r.media_type].filter(Boolean).join(' ').toLowerCase();
        if (hay.includes(q)) {
          hits.push({ where: 'archive', id: r.id, kind: r.media_type, fileName: r.original_name, notes: r.notes || null });
        }
      });

      document.querySelectorAll('.vehicle-docs-grid .doc-card[data-type]').forEach(card => {
        const type = card.dataset.type || '';
        if (type.toLowerCase().includes(q)) {
          hits.push({ where: 'document', document: type, onFile: !!card.querySelector('.doc-open-pill') });
        }
      });

      return { ok: true, query, total: hits.length, results: hits.slice(0, cap) };
    },

    /* ── Deleting — always through his thumb, never on her word ────── */

    async deleteService({ id }) {
      const record = serviceEntries.find(r => Number(r.id) === Number(id));
      if (!record) return { ok: false, error: `No service record with id ${id}. Use listServices first.` };

      // Escaped, unlike the version this replaces. The type is free text the
      // rider typed, and it is now going into a dialog as markup.
      const confirmed = await askToConfirm(
        `The ${docsEscapeHtml(record.type)} on ${docsEscapeHtml(record.date)} `
        + `at ${docsEscapeHtml(String(record.odo))} km.<br><b>This cannot be undone.</b>`,
        'Sage wants to delete a service record'
      );
      if (!confirmed) return { ok: false, error: 'He did not confirm it, so nothing was deleted.' };

      const { error } = await supabase.from('maintenance_records').delete().eq('id', record.id);
      if (error) return { ok: false, error: `The database refused it: ${error.message}` };
      if (record.bill) await supabase.storage.from('service-bills').remove([record.bill]);

      serviceEntries = serviceEntries.filter(r => Number(r.id) !== Number(record.id));
      await renderServiceTable();
      if (window.sageRefreshHealthCard) window.sageRefreshHealthCard();
      return { ok: true, deleted: { id: record.id, date: record.date, type: record.type } };
    },

    async deleteMedia({ id }) {
      await ensureDocsLoaded();
      const row = window._historicMediaRows?.get(Number(id));
      if (!row) return { ok: false, error: `No upload with id ${id}. Use listMedia first.` };

      const confirmed = await askToConfirm(
        `“${docsEscapeHtml(row.original_name)}”<br><b>This cannot be undone.</b>`,
        'Sage wants to delete an upload'
      );
      if (!confirmed) return { ok: false, error: 'He did not confirm it, so nothing was deleted.' };

      const { error } = await supabase.from('media_files').delete().eq('id', row.id);
      if (error) return { ok: false, error: `The database refused it: ${error.message}` };
      await supabase.storage.from('historic-media').remove([row.file_name]);
      await loadHistoricUploads();
      return { ok: true, deleted: { id: row.id, fileName: row.original_name } };
    },

    async deleteDocument({ document: type }) {
      await ensureDocsLoaded();
      const latest = await getLatestVehicleDoc(type);
      if (!latest) return { ok: false, error: `Nothing on file for "${type}".` };

      const confirmed = await askToConfirm(
        `Your ${docsEscapeHtml(type)} comes off the vault.<br><b>This cannot be undone.</b>`,
        'Sage wants to delete a document'
      );
      if (!confirmed) return { ok: false, error: 'He did not confirm it, so nothing was deleted.' };

      await supabase.from('vehicle_documents').delete()
        .eq('file_name', latest.file_name).eq('document_type', type);
      await supabase.storage.from('vehicle-documents').remove([latest.file_name]);
      await loadVehicleDocsFast(docsFixedCards);
      return { ok: true, deleted: { document: type, fileName: latest.original_name } };
    },

    /* ── Getting around, and settings ─────────────────────────────── */

    /**
     * OFFER a page rather than jumping to one.
     *
     * This used to call setActiveSection() and the screen changed underneath him
     * mid-conversation — he asks her something, and the chat he was reading is
     * replaced by the service form. Being moved somewhere you did not ask to go is
     * the most annoying thing a chat assistant can do, and she reached for it
     * readily: "add as a reminder" opened the service page.
     *
     * So the tool now returns an offer, the reply carries a button, and he decides.
     * She is told in the result that nothing has happened yet, because otherwise
     * she reports it as done.
     */
    async openSection({ section, highlight = null }) {
      const known = ['home', 'service', 'docs', 'sage'];
      if (!known.includes(section)) return { ok: false, error: `section must be one of ${known.join(', ')}.` };
      return {
        ok: true,
        offered: section,
        highlight: highlight || null,
        note: 'Nothing has opened. He has been given a button and may or may not press it.',
      };
    },

    /** Take the offer. Called by the button in the chat, not by her. */
    async goToSection({ section, highlight = null }) {
      const known = ['home', 'service', 'docs', 'sage'];
      if (!known.includes(section)) return { ok: false, error: 'unknown section' };
      setActiveSection(section);
      if (highlight) {
        const target = document.querySelector(highlight);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return { ok: true, opened: section };
    },

    async saveParkLocation() {
      if (typeof window.dkSaveParkLocation !== 'function') {
        return { ok: false, error: 'Parking is not available on this device.' };
      }
      return window.dkSaveParkLocation();
    },

    async getNotificationSettings() {
      const S = window.SageScheduler;
      if (!S) return { ok: false, error: 'The scheduler is not loaded.' };
      const limits = await S.getLimits();
      return {
        ok: true,
        quietFrom: limits.quietStart, quietUntil: limits.quietEnd,
        mostPerDay: limits.dailyCap,
        leastHoursBetween: Math.round(limits.minGapMs / 3600000),
        urgentThroughQuietHours: limits.criticalInQuietHours !== false,
        mutedCategories: Object.keys(limits.categories || {}).filter(k => limits.categories[k] === false),
      };
    },

    async updateNotificationSettings(changes = {}) {
      const S = window.SageScheduler;
      if (!S) return { ok: false, error: 'The scheduler is not loaded.' };
      const limits = await S.getLimits();
      const next = { ...limits };

      const hour = v => (Number.isInteger(v) && v >= 0 && v <= 23 ? v : null);
      if (changes.quietFrom !== undefined) {
        const h = hour(Number(changes.quietFrom));
        if (h === null) return { ok: false, error: 'quietFrom must be an hour from 0 to 23.' };
        next.quietStart = h;
      }
      if (changes.quietUntil !== undefined) {
        const h = hour(Number(changes.quietUntil));
        if (h === null) return { ok: false, error: 'quietUntil must be an hour from 0 to 23.' };
        next.quietEnd = h;
      }
      if (changes.mostPerDay !== undefined) {
        const n = Number(changes.mostPerDay);
        if (!Number.isInteger(n) || n < 1 || n > 8) return { ok: false, error: 'mostPerDay must be 1 to 8.' };
        next.dailyCap = n;
      }
      if (changes.leastHoursBetween !== undefined) {
        const n = Number(changes.leastHoursBetween);
        if (!Number.isInteger(n) || n < 1 || n > 12) return { ok: false, error: 'leastHoursBetween must be 1 to 12.' };
        next.minGapMs = n * 3600000;
      }
      if (changes.urgentThroughQuietHours !== undefined) {
        next.criticalInQuietHours = !!changes.urgentThroughQuietHours;
      }

      await S.setLimits(next);
      return { ok: true, ...(await window.dkApp.getNotificationSettings()) };
    },

    async muteCategory({ category, muted }) {
      const S = window.SageScheduler;
      if (!S) return { ok: false, error: 'The scheduler is not loaded.' };
      const known = Object.keys(S.CATEGORY_META || {});
      if (!known.includes(category)) {
        return { ok: false, error: `category must be one of: ${known.join(', ')}.` };
      }
      const limits = await S.getLimits();
      const categories = { ...(limits.categories || {}) };
      if (muted) categories[category] = false; else delete categories[category];
      await S.setLimits({ ...limits, categories });
      return { ok: true, category, muted: !!muted };
    },

    async sendTestNotification() {
      if (typeof window.sendSageTestNotif !== 'function') {
        return { ok: false, error: 'Notifications are not available here.' };
      }
      const granted = window.requestNotifPermission ? await window.requestNotifPermission() : false;
      if (!granted) return { ok: false, error: 'He has not allowed notifications for this site.' };
      const S = window.SageScheduler;
      const mood = S ? S.moodAt(Date.now(), await S.getLimits()) : null;
      const sent = await window.sendSageTestNotif(mood);
      return sent ? { ok: true, sent: true, mood } : { ok: false, error: 'The notification would not send.' };
    },

    async deleteParkEntry({ index = 0 } = {}) {
      const store = cloudStore();
      if (!store) return { ok: false, error: 'The park history is not loaded yet.' };
      const before = store.parkHistory();
      const i = Number(index);
      if (!before.length) return { ok: false, error: 'There are no saved parking spots.' };
      if (!Number.isInteger(i) || i < 0 || i >= before.length) {
        return { ok: false, error: `index must be between 0 and ${before.length - 1}.` };
      }
      // Deletes the row, rather than rewriting a list with one item missing.
      const removed = await store.removePark(i);
      if (!removed) return { ok: false, error: 'That spot could not be removed.' };

      const left = store.parkHistory();
      if (window.sageSyncParkSession) {
        window.sageSyncParkSession(left[0] ? new Date(left[0].at).toISOString() : null);
      }
      if (typeof window.dkRefreshParkUI === 'function') window.dkRefreshParkUI();
      return {
        ok: true,
        removed: { when: new Date(removed.at).toISOString(), address: removed.address || null },
        left: left.length,
      };
    },

    async refreshEverything() {
      await loadServiceEntries();
      if (spinlogLazyState.docsLoaded) await ensureDocsLoaded();
      await window.dkCoverStore.hydrate();
      // Park history, the conversation, upload notes and the purchase-date
      // override all come from the cloud store, so "refresh everything" has to
      // include it or it is refreshing most things.
      await cloudStore()?.load();
      if (window.sageRefreshHealthCard) window.sageRefreshHealthCard();
      return {
        ok: true,
        reloaded: 'service records, documents, cover dates, park history and your conversation',
      };
    },
  };

  function ensureSectionData(section) {
    if (section === 'docs') {
      ensureDocsLoaded();
      return;
    }
    if (section === 'sage') {
      // Repaint the conversation and re-read her mood on every visit.
      if (window.sageOnSectionOpen) window.sageOnSectionOpen();
      return;
    }
    if (section === 'service' && !spinlogLazyState.serviceLoaded) {
      spinlogLazyState.serviceLoaded = true;
      loadServiceEntries();
    }
  }

  // Initialize app. Heavy section data is lazy-loaded when that section is opened.
  function initApp() {
    setupDateUI();
    setupServiceEntryTypeDropdown();
    setupFileInput();
    setupServiceHistoryFilters();
    setupHistoricDropzones();
    initDbStatusMonitor();
    setupParkFeature();

    // ── Sage notification system boot ──
    if (window.checkReEngagementNotif) window.checkReEngagementNotif();
    if (window.checkAnniversaryNotif) window.checkAnniversaryNotif(window.dkVehicle.purchaseDate);
    document.querySelectorAll('.dk-cover-card .dk-cover-status[data-due]').forEach(el => {
      const label = el.closest('.dk-cover-card')?.querySelector('.dk-cover-label')?.textContent?.trim() || 'Cover';
      if (window.checkInsuranceNotif) window.checkInsuranceNotif(el.getAttribute('data-due'));
      if (window.checkDocNotif) window.checkDocNotif(el.getAttribute('data-due'), label);
    });

    // Sunday morning: queue the weekly read on herself.
    if (window.SageScheduler?.checkWeeklyInsight) {
      window.SageScheduler.checkWeeklyInsight().catch(() => {});
    }

    // Anything the scheduler deferred earlier (quiet hours, daily cap, min gap)
    // gets another chance now that the app is open.
    if (window.sagePump) window.sagePump();

    // Top up Sage's written-ahead lines while we have a network. This is what
    // lets background notifications sound like her without the service worker
    // ever calling Gemini. Unawaited — nothing waits on her prose.
    //
    // Held back a few seconds so it does not share the opening moments with the
    // health insight. Requests are serialized anyway, but keeping them out of the
    // same minute is what actually keeps us under the free-tier ceiling.
    if (window.SageAI?.refreshPools) {
      setTimeout(() => window.SageAI.refreshPools().catch(() => {}), 8000);
    }

    // ── Sync notification data to service worker for background checks ──
    syncNotifDataToSW();

    // ── Register periodic background sync for Sage notifications ──
    registerPeriodicSync();

    // Load only service records on startup because Home needs ODO / last service / next service.
    spinlogLazyState.serviceLoaded = true;
    loadServiceEntries();

    // Go back to whatever page you were last on. Deliberately last in initApp:
    // the service lazy-load above has already run and set its flag, so
    // restoring "service" here re-uses it instead of fetching twice.
    restoreSection();
  }

  /**
   * Reopen the last-used section after a refresh.
   * The URL hash wins when present, so a shared or bookmarked link still works;
   * otherwise fall back to what was stored on the previous visit.
   */
  function restoreSection() {
    const fromHash = (location.hash || '').replace(/^#/, '');
    let stored = null;
    try { stored = localStorage.getItem(SECTION_KEY); } catch { stored = null; }

    const target = isKnownSection(fromHash) ? fromHash
      : (isKnownSection(stored) ? stored : null);
    // Home is already the markup default, so there is nothing to switch to.
    if (!target || target === 'home') return;
    // 'replace': landing where you left off is not a navigation you can go back from.
    setActiveSection(target, 'replace');
  }

  // Browser back and forward move between sections rather than leaving the page.
  window.addEventListener('hashchange', () => {
    const name = (location.hash || '').replace(/^#/, '');
    // 'replace', or answering a back press would push a fresh entry and the stack
    // would never empty — back would appear to do nothing at all.
    if (isKnownSection(name)) setActiveSection(name, 'replace');
  });

  // ── Service worker messaging ────────────────────────────────────────
  // navigator.serviceWorker.controller is null on the very first page load
  // (nothing controls the page until the worker activates and claims it), so
  // the old guard meant a fresh install never handed its notification data
  // over. Going through the registration works on first load too.
  async function postToSW(message) {
    try {
      if (!navigator.serviceWorker) return false;
      const reg = await navigator.serviceWorker.ready;
      const target = reg.active || navigator.serviceWorker.controller;
      if (!target) return false;
      target.postMessage(message);
      return true;
    } catch {
      return false;
    }
  }
  // Not exported. window.dkPostToSW was here and had no caller — the worker takes
  // exactly one message shape and syncNotifDataToSW() below is the thing that
  // builds it. A public raw-postMessage hook is an invitation to send the worker a
  // payload it does not merge.

  // ── Sync notification-relevant data to service worker for background checks ──
  function syncNotifDataToSW() {
    // Gather insurance expiry dates from the cover cards
    const coverCards = document.querySelectorAll('.dk-cover-card .dk-cover-status[data-due]');
    let earliestInsurance = null;
    coverCards.forEach(el => {
      const due = el.getAttribute('data-due');
      if (due && (!earliestInsurance || due < earliestInsurance)) earliestInsurance = due;
    });

    // nextServiceDate is deliberately omitted rather than sent as null: the
    // worker merges and skips null values, so omitting it leaves whatever
    // updateHomeServiceInfo() already stored intact.
    const payload = {
      insuranceExpiry: earliestInsurance || null,
      lastAppOpen: Date.now(),
    };

    return postToSW({ type: 'SPINLOG_SYNC_NOTIF_DATA', payload });
  }
  window.dkSyncNotifData = syncNotifDataToSW;

  // ── Register periodic background sync ──
  /**
   * Periodic background sync — the ONLY way a notification can arrive while the
   * app is closed. There is no push backend, so if this does not register,
   * nothing is delivered until you next open the app.
   *
   * Two things were wrong here. It only called register() when
   * permissions.query already reported 'granted' — but `periodic-background-sync`
   * is not a promptable permission: Chrome grants it silently to installed PWAs
   * once site engagement is high enough, so early in a install's life the query
   * says 'prompt' and registration was skipped. And it ran once at startup with
   * no listener, so becoming eligible later changed nothing until a cold start.
   *
   * Now it just tries. register() is the real authority and throws when it is
   * not allowed, which is cheaper and more accurate than asking first.
   */
  async function registerPeriodicSync() {
    let reg = null;
    try {
      reg = await navigator.serviceWorker.ready;
    } catch {
      return false;
    }
    if (!reg || !('periodicSync' in reg)) {
      console.log('[SpinLog] No periodic background sync here — notifications arrive when the app is open.');
      return false;
    }

    const attempt = async () => {
      try {
        // minInterval is a floor, not a schedule — the browser decides the real
        // cadence from engagement. Asking for 2 hours instead of 12 gives park
        // reminders a chance to land while the app is closed; the scheduler's
        // own cooldowns and daily cap stop that turning into spam.
        await reg.periodicSync.register('spinlog-sage-notifs', {
          minInterval: 2 * 60 * 60 * 1000,
        });
        const tags = await reg.periodicSync.getTags?.().catch(() => []) || [];
        window.dkBackgroundSync = tags.includes('spinlog-sage-notifs');
        console.log('[SpinLog] ✅ Background notification checks registered.');
        return true;
      } catch (err) {
        window.dkBackgroundSync = false;
        console.log('[SpinLog] Background sync refused — install the app and use it a few times, '
          + 'or notifications will only arrive while it is open.', err?.name || err);
        return false;
      }
    };

    if (await attempt()) return true;

    // Eligibility can arrive later in the same session, so watch for it instead
    // of waiting for the next cold start.
    try {
      const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
      status.onchange = () => { if (status.state === 'granted') attempt(); };
    } catch {
      // Firefox and Safari throw on an unknown permission name. Nothing to watch.
    }
    return false;
  }

  initApp();
});

// ════════════════════════════════════════════════════════════
// LAST PARKED LOCATION
// ════════════════════════════════════════════════════════════
(function() {
  // ── How hard to try for a sharp fix ──
  //
  // This was a single getCurrentPosition, and on a phone that is a coin flip: the
  // first thing the OS hands back is often a cell-tower or wifi estimate good to
  // ±1500m, which points at the wrong end of the street. enableHighAccuracy asks
  // for GPS, it does not wait for it.
  //
  // So watch instead of ask, keep the best reading, and stop as soon as it is good
  // enough or the budget runs out. A basement never reaches the target, which is
  // exactly why the budget exists and why the best-so-far is still saved.
  const FIX_TARGET_M = 20;      // close enough to walk straight to
  const FIX_BUDGET_MS = 14000;  // then take the best we have seen
  const FIX_VAGUE_M = 250;      // above this, say so rather than pretend

  // A time limit is worth warning about before it runs out, not after.
  const LIMIT_LEAD_MS = 15 * 60000;

  const esc = v => (typeof docsEscapeHtml === 'function'
    ? docsEscapeHtml(v)
    : String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

  // Which spot the detail pane is showing, as a parked-at epoch. Null means the
  // list is showing.
  let openAt = null;
  let pickedPhoto = null;   // a File chosen but not uploaded yet
  let walkTimer = null;

  // In the cloud: where you left the bike is exactly the thing you want to look up
  // on the phone after saving it on the laptop.
  //
  // The shape below keeps `timestamp` as an ISO string, because a dozen lines in
  // this section compare and render it. The store works in epoch milliseconds, so
  // this is the only place the two meet.
  function getParkHistory() {
    const store = cloudStore();
    if (!store) return [];
    return store.parkHistory().map(p => ({
      timestamp: new Date(p.at).toISOString(),
      at: p.at,
      lat: p.lat,
      lng: p.lng,
      accuracy: p.accuracy,
      address: p.address || undefined,
      label: p.label || null,
      level: p.level || null,
      notes: p.notes || null,
      photo: p.photo || null,
      until: p.until || null,
      remindedAt: p.remindedAt || null,
    }));
  }

  /** Save one spot. Adds a row rather than rewriting the list. */
  function savePark(entry) {
    cloudStore()?.addPark(entry);
  }

  /** Fill in the address once reverse geocoding answers. */
  function saveParkAddress(timestamp, address) {
    cloudStore()?.setParkAddress(timestamp, address);
  }

  // dropPark(index) was a one-line pass-through to cloudStore().removePark().
  // Nothing called it — forgetting a spot goes through the slide dialog in
  // showSpot() and calls removePark() directly — and a second name for a
  // destructive operation is exactly the kind of thing that gets wired to the
  // wrong button.

  function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (m < 1) return 'Just now';
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    return `${d}d ago`;
  }

  /** "in 25m" / "in 3h 10m" / "12m ago". Signed, because both directions matter. */
  function untilText(ms) {
    const diff = Number(ms) - Date.now();
    const mins = Math.round(Math.abs(diff) / 60000);
    const h = Math.floor(mins / 60);
    const body = h ? `${h}h${mins % 60 ? ` ${mins % 60}m` : ''}` : `${mins}m`;
    if (diff <= 0) return `${body} over`;
    return `in ${body}`;
  }

  function niceDistance(m) {
    if (!Number.isFinite(m)) return null;
    if (m < 1000) return `${Math.round(m / 5) * 5} m`;
    return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
  }

  /** Straight-line metres. Walking distance is longer; this is the honest floor. */
  function metresBetween(a, b) {
    const R = 6371000;
    const rad = d => d * Math.PI / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function compassFrom(a, b) {
    const rad = d => d * Math.PI / 180;
    const dLng = rad(b.lng - a.lng);
    const y = Math.sin(dLng) * Math.cos(rad(b.lat));
    const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat))
      - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLng);
    const deg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    return ['north', 'north-east', 'east', 'south-east',
      'south', 'south-west', 'west', 'north-west'][Math.round(deg / 45) % 8];
  }

  const mapsLink = s => `https://www.google.com/maps?q=${s.lat},${s.lng}`;
  const walkLink = s => 'https://www.google.com/maps/dir/?api=1&destination='
    + `${s.lat},${s.lng}&travelmode=walking`;

  /**
   * Watch for a position and keep the sharpest one.
   *
   * Resolves with the best fix seen, plus whether it ever got under the target, so
   * the caller can say "±8m" or "±600m, best it could manage" instead of implying
   * both are the same thing.
   */
  function bestFix({ targetM = FIX_TARGET_M, budgetMs = FIX_BUDGET_MS, onProgress } = {}) {
    return new Promise(resolve => {
      if (!navigator.geolocation) {
        resolve({ ok: false, error: 'This device has no location access.' });
        return;
      }
      let best = null;
      let watch = null;
      let done = false;

      const finish = (extra = {}) => {
        if (done) return;
        done = true;
        if (watch !== null) navigator.geolocation.clearWatch(watch);
        clearTimeout(timer);
        if (best) resolve({ ok: true, coords: best, sharp: best.accuracy <= targetM, ...extra });
        else resolve({ ok: false, error: extra.error || 'Could not get a location.' });
      };

      const timer = setTimeout(() => finish(), budgetMs);

      watch = navigator.geolocation.watchPosition(
        pos => {
          const { latitude: lat, longitude: lng, accuracy } = pos.coords;
          const acc = Number.isFinite(accuracy) ? Math.round(accuracy) : 9999;
          // Only ever replace with something better, so a good first fix is not
          // thrown away by a worse second one.
          if (!best || acc < best.accuracy) best = { lat, lng, accuracy: acc };
          if (onProgress) onProgress(best);
          if (best.accuracy <= targetM) finish();
        },
        err => {
          const msgs = {
            1: 'Location permission is denied.',
            2: 'Location is unavailable right now.',
            3: 'The location request timed out.',
          };
          // A late error after a usable fix is not a failure — keep what we have.
          if (best) finish();
          else finish({ error: msgs[err.code] || 'Could not get a location.' });
        },
        { enableHighAccuracy: true, timeout: budgetMs, maximumAge: 0 }
      );
    });
  }

  /** One quick fix, for "how far away am I", where ±50m is fine. */
  function quickFix() {
    return new Promise(resolve => {
      if (!navigator.geolocation) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 30000 }
      );
    });
  }

  // Nominatim asks for one request per second and no hammering. The same spot gets
  // looked up again every time a pane opens, so the answer is kept.
  const geoCache = new Map();
  let lastGeocodeAt = 0;

  async function reverseGeocode(lat, lng) {
    const key = `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
    if (geoCache.has(key)) return geoCache.get(key);

    // Their usage policy is one call a second. Nothing here needs to be faster.
    const wait = 1100 - (Date.now() - lastGeocodeAt);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastGeocodeAt = Date.now();

    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18`,
        { headers: { 'Accept-Language': 'en' } }
      );
      if (!r.ok) return null;
      const data = await r.json();
      const a = data.address || {};
      const parts = [
        a.road || a.pedestrian || a.footway || a.path,
        a.suburb || a.neighbourhood || a.quarter,
        a.city || a.town || a.village
      ].filter(Boolean);
      const out = parts.slice(0, 2).join(', ')
        || data.display_name?.split(',').slice(0, 2).join(',').trim()
        || null;
      geoCache.set(key, out);
      return out;
    } catch { return null; }
  }

  function updateParkUI() {
    const history = getParkHistory();
    const latest  = history[0];
    const mobileEl= document.getElementById('parkValueMobile');
    const footEl  = document.getElementById('parkFootMobile');

    if (latest) {
      if (mobileEl) mobileEl.textContent = timeAgo(latest.timestamp);
      if (footEl) {
        // The foot line carries whichever of these is the most useful, in that
        // order: a running time limit beats a place name beats the old static hint.
        if (latest.until) footEl.textContent = `Move it ${untilText(latest.until)}`;
        else if (latest.label) footEl.textContent = latest.level
          ? `${latest.label} · ${latest.level}` : latest.label;
        else footEl.textContent = 'Hold for history';
      }
    } else {
      if (mobileEl) mobileEl.textContent = 'Tap to save';
      if (footEl) footEl.textContent = 'Hold for history';
    }
  }

  function showAppPopup(type, msg) {
    // Use the main popup system (customPopup element)
    if (typeof showPopup === 'function') {
      showPopup(type, msg);
      return;
    }
    const popup = document.getElementById('customPopup');
    const msgEl   = document.getElementById('popupMessage');
    const spinner = document.getElementById('popupSpinner');
    const success = document.getElementById('popupSuccess');
    const error   = document.getElementById('popupError');
    if (!popup) return;
    if (spinner) spinner.style.display = type === 'loading' ? 'block' : 'none';
    if (success) success.style.display = type === 'success' ? 'block' : 'none';
    if (error)   error.style.display   = type === 'error'   ? 'block' : 'none';
    if (msgEl) msgEl.textContent = msg;
    popup.classList.add('show');
    if (type !== 'loading') setTimeout(() => { popup.classList.remove('show'); }, 2200);
  }

  /**
   * Mirror the newest spot into the reminder scheduler.
   *
   * Two things now: the parked-at time, which drives the "still parked" nudge, and
   * the time limit, which drives the one that actually matters. Both have to live in
   * the scheduler's own store rather than here, because the service worker sends
   * them while the app is shut.
   */
  function syncParkSession() {
    if (!window.sageSyncParkSession) return;
    const latest = getParkHistory()[0];
    window.sageSyncParkSession(
      latest ? latest.timestamp : null,
      latest && latest.until ? latest.until : null
    );
  }

  /**
   * Save where the bike is, reporting every step.
   *
   * The old version popped "Getting accurate location…" and then either a tick or
   * an error, which meant a 14-second wait looked identical to a hang. The accuracy
   * it is currently holding is shown while it narrows down, because that is the one
   * number that tells you whether to keep waiting.
   */
  async function captureSpot() {
    const hint = document.getElementById('parkSaveNowHint');
    const btn = document.getElementById('parkSaveNow');
    const say = text => { if (hint) hint.textContent = text; };

    if (!navigator.geolocation) {
      showAppPopup('error', 'This device has no location access.');
      say('This device has no location access.');
      return { ok: false, error: 'This device has no location access.' };
    }

    if (btn) btn.disabled = true;
    showAppPopup('loading', 'Finding you…');
    say('Finding you…');

    const fix = await bestFix({
      onProgress: b => say(`Narrowing down — ±${b.accuracy}m so far`),
    });

    if (btn) btn.disabled = false;
    if (!fix.ok) {
      showAppPopup('error', fix.error);
      say(fix.error);
      return { ok: false, error: fix.error };
    }

    const { lat, lng, accuracy } = fix.coords;
    const entry = {
      lat, lng, accuracy,
      timestamp: new Date().toISOString(),
      address: null,
    };
    // One row. The store keeps the list trimmed, in the cloud as well as here.
    savePark(entry);
    updateParkUI();

    // Naming a vague fix beats a tick that implies precision it does not have.
    const vague = accuracy > FIX_VAGUE_M;
    showAppPopup(vague ? 'error' : 'success',
      vague ? `Saved, but only ±${accuracy}m — add a note or a photo`
        : `Saved · ±${accuracy}m`);
    say(vague
      ? `Saved at ±${accuracy}m. Indoors? Add a level or a photo.`
      : `Saved · ±${accuracy}m${fix.sharp ? '' : ' (best it could manage)'}`);

    // The timestamp is what starts the reminder clock, so hand it over.
    if (window.triggerParkingNotif) window.triggerParkingNotif(entry.timestamp);

    renderParkList();

    const addr = await reverseGeocode(lat, lng);
    // Only if it is still the newest — he may have parked again while the geocoder
    // was thinking.
    if (addr && getParkHistory()[0]?.timestamp === entry.timestamp) {
      saveParkAddress(entry.timestamp, addr);
      updateParkUI();
      renderParkList();
    }
    return { ok: true, saved: { ...entry, address: addr || null }, sharp: fix.sharp };
  }

  // ══ The sheet ══════════════════════════════════════════════════════════

  const $ = id => document.getElementById(id);

  function openSheet() {
    const modal = $('parkHistoryModal');
    if (!modal) return;
    showList();
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('sl-modal--open');
  }

  function closeParkModal() {
    const m = $('parkHistoryModal');
    m?.classList.remove('sl-modal--open');
    m?.setAttribute('aria-hidden', 'true');
    clearInterval(walkTimer);
    walkTimer = null;
    openAt = null;
  }

  function showList() {
    openAt = null;
    pickedPhoto = null;
    clearInterval(walkTimer);
    walkTimer = null;
    // The two panes slide past each other rather than being swapped between
    // frames: the detail leaves to the right, the list comes back from the left.
    // That is what makes the back arrow in the header mean something.
    window.dkSlideShut($('parkEditPane'), 140, { x: '14%' });
    window.dkSlideOpen($('parkListPane'), 200, { x: '-14%' });
    $('parkBack')?.setAttribute('hidden', '');
    const label = $('parkSheetLabel');
    if (label) label.textContent = 'Parking';
    const note = $('parkMigrateNote');
    // Only worth saying while it is true, and only once the store has looked.
    const store = cloudStore();
    if (note) {
      if (store && store.isReady() && store.parkLegacy && store.parkLegacy()) {
        note.removeAttribute('hidden');
      } else {
        note.setAttribute('hidden', '');
      }
    }
    renderParkList();
  }

  function renderParkList() {
    const list = $('parkHistoryList');
    if (!list) return;
    const history = getParkHistory();

    list.innerHTML = history.length ? history.map((e, i) => {
      // Place and level are what a person actually reads first; the street address
      // is the fallback and the raw coordinates are the fallback's fallback.
      const head = e.label
        || e.address
        || `${Number(e.lat).toFixed(5)}, ${Number(e.lng).toFixed(5)}`;
      const sub = [
        new Date(e.timestamp).toLocaleString('en-IN',
          { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
        e.accuracy ? `±${e.accuracy}m` : null,
        timeAgo(e.timestamp),
      ].filter(Boolean).join(' · ');
      const chips = [
        e.level ? `<span class="park-tag">${esc(e.level)}</span>` : '',
        e.photo ? '<span class="park-tag park-tag--ico"><i class="fas fa-camera" aria-hidden="true"></i></span>' : '',
        e.notes ? '<span class="park-tag park-tag--ico"><i class="fas fa-note-sticky" aria-hidden="true"></i></span>' : '',
        e.until ? `<span class="park-tag ${Number(e.until) - Date.now() <= LIMIT_LEAD_MS
          ? 'park-tag--hot' : 'park-tag--warn'}">${esc(untilText(e.until))}</span>` : '',
      ].join('');

      return `<button type="button" class="park-history-item" data-at="${e.at}">
        <span class="park-history-dot${i === 0 ? ' park-history-dot--live' : ''}"></span>
        <span class="park-history-info">
          <span class="park-history-addr">${esc(head)}</span>
          <span class="park-history-time">${esc(sub)}</span>
          ${chips ? `<span class="park-tags">${chips}</span>` : ''}
        </span>
        <span class="park-history-go"><i class="fas fa-chevron-right" aria-hidden="true"></i></span>
      </button>`;
    }).join('') : '<div class="park-history-empty"><i class="fas fa-location-dot" aria-hidden="true"></i>'
      + '<p>Nothing saved yet.<br>Save this spot and it shows up here on every device.</p></div>';

    list.querySelectorAll('.park-history-item').forEach(row =>
      row.addEventListener('click', () => showSpot(Number(row.dataset.at))));
  }

  function makeLongPress(el, onTap, onLong, ms = 650) {
    let timer = null, fired = false, startX = 0, startY = 0;
    const MOVE_THRESHOLD = 10;
    const cancel = () => { clearTimeout(timer); timer = null; };
    el.addEventListener('pointerdown', (e) => { fired = false; startX = e.clientX; startY = e.clientY; timer = setTimeout(() => { fired = true; onLong(); }, ms); });
    el.addEventListener('pointerup',   () => { cancel(); if (!fired) onTap(); });
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('pointermove',  (e) => { if (timer && (Math.abs(e.clientX - startX) > MOVE_THRESHOLD || Math.abs(e.clientY - startY) > MOVE_THRESHOLD)) cancel(); });
  }

  // ══ One spot ═══════════════════════════════════════════════════════════

  /** datetime-local wants local wall-clock, not an ISO string in UTC. */
  function toLocalInput(ms) {
    const d = new Date(Number(ms));
    if (Number.isNaN(d.getTime())) return '';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
      + `T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function spotBy(at) {
    return getParkHistory().find(s => s.at === Number(at)) || null;
  }

  function setStatus(text, kind) {
    const el = $('parkEditStatus');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'park-edit-status'
      + (kind ? ` park-edit-status--${kind}` : '');
  }

  function showSpot(at) {
    const spot = spotBy(at);
    if (!spot) { showList(); return; }
    openAt = spot.at;
    pickedPhoto = null;

    window.dkSlideShut($('parkListPane'), 140, { x: '-14%' });
    window.dkSlideOpen($('parkEditPane'), 200, { x: '14%' });
    $('parkBack')?.removeAttribute('hidden');
    const label = $('parkSheetLabel');
    if (label) label.textContent = spot.label || 'This spot';

    const meta = $('parkEditMeta');
    if (meta) {
      const bits = [
        new Date(spot.timestamp).toLocaleString('en-IN',
          { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
        spot.accuracy ? `±${spot.accuracy}m` : null,
        spot.address || null,
      ].filter(Boolean);
      meta.textContent = bits.join(' · ');
    }

    const go = $('parkWalkGo');
    const map = $('parkWalkMap');
    if (go) go.href = walkLink(spot);
    if (map) map.href = mapsLink(spot);

    const fLabel = $('parkFieldLabel');
    const fLevel = $('parkFieldLevel');
    const fNotes = $('parkFieldNotes');
    const fUntil = $('parkFieldUntil');
    if (fLabel) fLabel.value = spot.label || '';
    if (fLevel) fLevel.value = spot.level || '';
    if (fNotes) fNotes.value = spot.notes || '';
    if (fUntil) fUntil.value = spot.until ? toLocalInput(spot.until) : '';
    readLimit();
    setStatus('');
    showPhoto(spot.photo);

    // Distance is only meaningful while the pane is open, so it is polled here and
    // the interval is cleared on both exits.
    refreshWalk();
    clearInterval(walkTimer);
    walkTimer = setInterval(refreshWalk, 20000);
  }

  /**
   * How far away the bike is, in words.
   *
   * Written as a stat rather than a sentence, and with no full stop, because this
   * line renders in Blender Pro Heavy — a CAPS-ONLY cut. "You are right about here."
   * comes out as a shout with a stray dot on the end; "20 M AWAY" does not.
   */
  async function refreshWalk() {
    const spot = openAt ? spotBy(openAt) : null;
    const el = $('parkWalkDist');
    if (!spot || !el) return;
    const here = await quickFix();
    if (!here) { el.textContent = 'Distance unavailable'; return; }
    const m = metresBetween(here, spot);
    const pretty = niceDistance(m);
    // Under 30m the bearing is noise — you are standing next to it.
    el.textContent = m < 30
      ? `${pretty} away — you are on top of it`
      : `${pretty} ${compassFrom(here, spot)} of you`;
  }

  function readLimit() {
    const input = $('parkFieldUntil');
    const out = $('parkLimitRead');
    if (!out) return;
    const ms = input && input.value ? new Date(input.value).getTime() : NaN;
    if (!Number.isFinite(ms)) { out.textContent = 'No limit set.'; return; }
    out.textContent = ms <= Date.now()
      ? `That is already ${untilText(ms)}.`
      : `She will warn you about 15 minutes before — ${untilText(ms)}.`;
  }

  let photoObjectUrl = null;

  /**
   * Show the photo, or show nothing.
   *
   * The thumbnail stays hidden until the image has actually LOADED, rather than
   * being revealed the moment a path exists. It was the other way round and the
   * failure was ugly and reachable: a signed URL that does not come back — offline,
   * expired, file deleted from the bucket by hand — left a broken-image glyph sitting
   * on top of its own alt text. There is no useful half-state here, so there is no
   * visible half-state.
   */
  function showPhoto(path) {
    const view = $('parkPhotoView');
    const img = $('parkPhotoImg');
    const drop = $('parkPhotoDrop');
    const text = $('parkPhotoBtnText');
    const has = !!(path || pickedPhoto);
    if (text) text.textContent = has ? 'Replace photo' : 'Add a photo';
    if (drop) {
      if (has) drop.removeAttribute('hidden');
      else drop.setAttribute('hidden', '');
    }
    if (!view || !img) return;

    // Hidden first, always. Whatever is about to happen, the old picture is not it.
    view.setAttribute('hidden', '');
    view.removeAttribute('href');
    img.removeAttribute('src');
    if (photoObjectUrl) { URL.revokeObjectURL(photoObjectUrl); photoObjectUrl = null; }

    img.onload = () => view.removeAttribute('hidden');
    img.onerror = () => view.setAttribute('hidden', '');

    if (pickedPhoto) {
      // From the file itself, before any upload, so choosing one is acknowledged
      // rather than silent.
      photoObjectUrl = URL.createObjectURL(pickedPhoto);
      img.src = photoObjectUrl;
      return;
    }
    if (!path) return;
    // A private bucket, so the src is a signed URL that has to be fetched first.
    if (typeof getSignedUrl !== 'function') return;
    getSignedUrl(path).then(url => {
      if (!url) return;
      img.src = url;
      view.href = url;
    }).catch(() => {});
  }

  /**
   * Put the photo in the documents bucket.
   *
   * Which is not where you would guess, and the reason is that the anon key cannot
   * create a bucket — a new one means another manual dashboard step on top of the
   * SQL file. vehicle-documents is already private, already has upload, remove and
   * createSignedUrl working, and the documents page lists the vehicle_documents
   * TABLE rather than the bucket, so a file with no row is invisible to it. The
   * `park-` prefix keeps it obvious what these are.
   */
  async function uploadPhoto(file, at) {
    if (typeof supabase === 'undefined' || !supabase) return { ok: false, error: 'No connection.' };
    const clean = (file.name || 'photo.jpg').replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const name = `park-${at}-${clean}`;
    const { error } = await supabase.storage.from('vehicle-documents')
      .upload(name, file, { contentType: file.type || 'image/jpeg', cacheControl: '3600', upsert: true });
    if (error) return { ok: false, error: error.message };
    return { ok: true, path: name };
  }

  async function saveSpot(event) {
    if (event) event.preventDefault();
    const store = cloudStore();
    const spot = openAt ? spotBy(openAt) : null;
    if (!store || !spot) { setStatus('That spot is no longer here.', 'bad'); return; }

    const btn = $('parkEditSave');
    if (btn) btn.disabled = true;

    const patch = {
      label: $('parkFieldLabel')?.value || null,
      level: $('parkFieldLevel')?.value || null,
      notes: $('parkFieldNotes')?.value || null,
    };
    const rawUntil = $('parkFieldUntil')?.value || '';
    const untilMs = rawUntil ? new Date(rawUntil).getTime() : null;
    patch.until = Number.isFinite(untilMs) ? untilMs : null;

    // The photo is the only part that can fail on its own, so it is reported on its
    // own rather than folded into one "saved" or "failed".
    if (pickedPhoto) {
      setStatus('Uploading the photo…');
      const up = await uploadPhoto(pickedPhoto, spot.at);
      if (!up.ok) {
        setStatus(`The photo did not upload (${up.error}). Nothing else was saved.`, 'bad');
        if (btn) btn.disabled = false;
        return;
      }
      patch.photo = up.path;
      // A replaced photo leaves the old file behind otherwise.
      if (spot.photo && spot.photo !== up.path) {
        supabase.storage.from('vehicle-documents').remove([spot.photo]).catch(() => {});
      }
      pickedPhoto = null;
    }

    setStatus('Saving…');
    const ok = store.updatePark(spot.at, patch);
    if (btn) btn.disabled = false;
    if (!ok) { setStatus('That spot is no longer here.', 'bad'); return; }

    // The scheduler carries ONE park session, pointed at the newest spot, because
    // that is where the bike actually is. A limit set on an older spot is stored but
    // will never fire, and saying nothing about that is exactly the silent no-op
    // this pane is meant to avoid.
    const isNewest = getParkHistory()[0]?.at === spot.at;
    if (!patch.until) setStatus('Saved.', 'good');
    else if (isNewest) {
      setStatus(`Saved. She will warn you ${untilText(patch.until - LIMIT_LEAD_MS)}.`, 'good');
    } else {
      setStatus('Saved, but the reminder only follows the spot you parked at last — '
        + 'this one will not alert you.', 'bad');
    }
    updateParkUI();
    renderParkList();
    syncParkSession();
    const label = $('parkSheetLabel');
    if (label) label.textContent = patch.label || 'This spot';
    showPhoto(patch.photo || spot.photo);
  }

  async function forgetSpot() {
    const store = cloudStore();
    const spot = openAt ? spotBy(openAt) : null;
    if (!store || !spot) { showList(); return; }
    setStatus('Forgetting it…');
    const removed = await store.removeParkAt(spot.at);
    if (!removed) { setStatus('That could not be removed.', 'bad'); return; }
    if (spot.photo) {
      supabase?.storage.from('vehicle-documents').remove([spot.photo]).catch(() => {});
    }
    updateParkUI();
    syncParkSession();
    showList();
  }

  /**
   * Save the current spot and resolve with what happened, so Sage can report a
   * real outcome instead of assuming it worked.
   */
  window.dkSaveParkLocation = function() {
    return captureSpot();
  };

  // So a park entry removed through the chat repaints the home card too.
  window.dkRefreshParkUI = updateParkUI;

  window.setupParkFeature = function() {
    updateParkUI();
    // Re-point the reminder session at the newest entry on every open, so a
    // cleared IndexedDB or a fresh install picks the session back up. Idempotent:
    // the same timestamp does not restart the 2-hour clock.
    syncParkSession();

    const mobileCard = $('parkCardMobile');
    if (mobileCard) makeLongPress(mobileCard, captureSpot, openSheet);

    $('parkHistoryClose')?.addEventListener('click', closeParkModal);
    $('parkHistoryModal')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) closeParkModal();
    });
    $('parkBack')?.addEventListener('click', showList);
    $('parkSaveNow')?.addEventListener('click', async () => {
      await captureSpot();
      // Straight into the details of what was just saved: a spot is most worth
      // labelling in the ten seconds after you park.
      const latest = getParkHistory()[0];
      if (latest) showSpot(latest.at);
    });

    $('parkEditPane')?.addEventListener('submit', saveSpot);
    $('parkEditDelete')?.addEventListener('click', forgetSpot);
    $('parkFieldUntil')?.addEventListener('change', readLimit);

    $('parkLimitChips')?.addEventListener('click', e => {
      const chip = e.target.closest('.park-chip');
      if (!chip) return;
      const mins = Number(chip.dataset.mins);
      const input = $('parkFieldUntil');
      if (!input) return;
      // Measured from now rather than from when it was parked: you set a limit when
      // you read the sign, which is after you parked.
      input.value = mins > 0 ? toLocalInput(Date.now() + mins * 60000) : '';
      readLimit();
    });

    $('parkPhotoPick')?.addEventListener('click', () => $('parkPhotoInput')?.click());
    $('parkPhotoInput')?.addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!/^image\//.test(file.type)) { setStatus('That is not an image.', 'bad'); return; }
      pickedPhoto = file;
      showPhoto(null);
      setStatus('Photo ready — it uploads when you save.');
      e.target.value = '';
    });
    $('parkPhotoDrop')?.addEventListener('click', () => {
      const spot = openAt ? spotBy(openAt) : null;
      pickedPhoto = null;
      if (spot && spot.photo) {
        // Cleared here and removed from storage on save, so a cancelled edit does
        // not destroy the file.
        cloudStore()?.updatePark(spot.at, { photo: null });
        supabase?.storage.from('vehicle-documents').remove([spot.photo]).catch(() => {});
      }
      showPhoto(null);
      setStatus('Photo removed.');
      renderParkList();
    });

    // The sheet is a dialog; Escape should shut it, and the back arrow is the only
    // other way out of the detail pane.
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (!$('parkHistoryModal')?.classList.contains('sl-modal--open')) return;
      if (openAt) showList(); else closeParkModal();
    });
  };
})();

// ════════════════════════════════════════════════════════════
// COVER STORE — expiry dates backed by Supabase
//
// Cover expiry used to live only in the data-due attributes in index.html,
// with edits saved to localStorage. That made the dates invisible to anything
// server-side and lost them on a browser data wipe. They now live in the
// vehicle_cover table (see supabase/vehicle_cover.sql).
//
// Read precedence, highest first:
//   1. vehicle_cover row      — source of truth when the DB is reachable
//   2. localStorage           — offline fallback, written on every edit
//   3. data-due in index.html — the original seed values
//
// Everything degrades quietly: if the table hasn't been created yet the app
// behaves exactly as it did before.
// ════════════════════════════════════════════════════════════
window.dkCoverStore = (function() {
  const COVER_KEY = 'spinlogCoverDates';
  const TABLE = 'vehicle_cover';

  /** Stable machine key for a cover, so relabelling a card keeps its row. */
  function slug(label) {
    return String(label || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(COVER_KEY) || '{}'); } catch { return {}; }
  }

  function writeLocal(label, date) {
    const dates = readLocal();
    dates[label] = date;
    try { localStorage.setItem(COVER_KEY, JSON.stringify(dates)); } catch { /* quota — DB still has it */ }
  }

  /** Every cover card on the page, paired with its label and status element. */
  function cards() {
    return Array.from(document.querySelectorAll('.dk-cover-card')).map(card => ({
      label: card.querySelector('.dk-cover-label')?.textContent?.trim() || '',
      statusEl: card.querySelector('.dk-cover-status[data-due]'),
    })).filter(c => c.label && c.statusEl);
  }

  /** True when the failure is "table not created yet" rather than a real fault. */
  function isMissingTable(error) {
    if (!error) return false;
    return error.code === '42P01' || /does not exist|schema cache|not find the table/i.test(error.message || '');
  }

  async function loadFromDb() {
    const supabase = window.supabaseClient;
    if (!supabase) return null;
    try {
      const { data, error } = await supabase.from(TABLE).select('cover_type, label, expiry_date');
      if (error) {
        if (isMissingTable(error)) {
          console.warn(`[SpinLog] ${TABLE} table not found — run supabase/vehicle_cover.sql. Using local dates.`);
        } else {
          console.warn('[SpinLog] Could not load cover dates:', error.message);
        }
        return null;
      }
      return data || [];
    } catch {
      return null;
    }
  }

  /**
   * Write one cover date. Selects then updates or inserts rather than using
   * upsert, so it works whether or not cover_type carries a unique constraint.
   */
  async function saveToDb(label, date) {
    const supabase = window.supabaseClient;
    if (!supabase) return false;
    const coverType = slug(label);
    try {
      const { data: existing, error: readErr } = await supabase
        .from(TABLE).select('id').eq('cover_type', coverType).limit(1);
      if (readErr) {
        if (!isMissingTable(readErr)) console.warn('[SpinLog] Cover lookup failed:', readErr.message);
        return false;
      }

      const row = { cover_type: coverType, label, expiry_date: date };
      const { error } = existing && existing.length
        ? await supabase.from(TABLE).update(row).eq('id', existing[0].id)
        : await supabase.from(TABLE).insert([row]);

      if (error) {
        console.warn('[SpinLog] ❌ Cover date not saved to DB:', error.message);
        return false;
      }
      console.log(`[SpinLog] ✅ Cover date saved: ${label} → ${date}`);
      return true;
    } catch {
      return false;
    }
  }

  /** Give any cover with no DB row one, using whatever the card currently shows. */
  async function seedMissing(rows) {
    const known = new Set((rows || []).map(r => r.cover_type));
    for (const { label, statusEl } of cards()) {
      if (known.has(slug(label))) continue;
      const due = statusEl.getAttribute('data-due');
      if (due) await saveToDb(label, due);
    }
  }

  /**
   * Pull the authoritative dates in and repaint. Safe to call before or after
   * setupCoverDateEditing() — it only ever moves dates forward in precedence.
   */
  async function hydrate() {
    const rows = await loadFromDb();
    if (!rows) return false;

    const byType = new Map(rows.map(r => [r.cover_type, r.expiry_date]));
    let changed = false;

    cards().forEach(({ label, statusEl }) => {
      const dbDate = byType.get(slug(label));
      if (!dbDate) return;
      // Supabase date columns can come back as a full timestamp; keep YYYY-MM-DD.
      const date = String(dbDate).slice(0, 10);
      if (statusEl.getAttribute('data-due') !== date) {
        statusEl.setAttribute('data-due', date);
        changed = true;
      }
      writeLocal(label, date);
      if (typeof window.updateCoverBadge === 'function') window.updateCoverBadge(statusEl);
      if (window.checkInsuranceNotif) window.checkInsuranceNotif(date);
      if (window.checkDocNotif) window.checkDocNotif(date, label);
    });

    await seedMissing(rows);

    // The worker's stored insuranceExpiry was based on the pre-hydrate dates.
    if (changed && window.dkSyncNotifData) window.dkSyncNotifData();
    // A date that arrived from the database rather than from an edit still moves
    // what her summary should say.
    if (changed && window.sageRefreshHealthCard) window.sageRefreshHealthCard();
    return changed;
  }

  return { slug, readLocal, writeLocal, loadFromDb, saveToDb, hydrate };
})();

// ════════════════════════════════════════════════════════════
// COVER DATE EDITING — long-press cover cards
// ════════════════════════════════════════════════════════════
window.setupCoverDateEditing = function() {
  // Local dates are applied synchronously for a correct first paint; the
  // authoritative DB values arrive shortly after via dkCoverStore.hydrate().
  const saved = window.dkCoverStore.readLocal();

  document.querySelectorAll('.dk-cover-card').forEach(card => {
    const label    = card.querySelector('.dk-cover-label')?.textContent?.trim();
    const statusEl = card.querySelector('.dk-cover-status[data-due]');
    if (label && saved[label] && statusEl) statusEl.setAttribute('data-due', saved[label]);
  });

  const modal    = document.getElementById('coverEditModal');
  const input    = document.getElementById('coverEditInput');
  const saveBtn  = document.getElementById('coverEditSave');
  const closeBtn = document.getElementById('coverEditClose');
  const titleEl  = document.getElementById('coverEditTitle');
  let editTarget = null;

  const openModal  = () => { modal?.setAttribute('aria-hidden', 'false'); modal?.classList.add('sl-modal--open'); };
  const closeModal = () => { modal?.classList.remove('sl-modal--open'); modal?.setAttribute('aria-hidden', 'true'); };

  /** Open the editor for a given cover card. */
  function openCoverEditor(card) {
    const statusEl = card.querySelector('.dk-cover-status[data-due]');
    const label    = card.querySelector('.dk-cover-label')?.textContent?.trim();
    if (!statusEl || !label) return;
    editTarget = { statusEl, label };
    // calendar-days, not calendar-pen: the pen variant is Font Awesome Pro, so
    // it was rendering as an empty box every time this modal opened.
    if (titleEl) titleEl.innerHTML = `<i class="fas fa-calendar-days" aria-hidden="true"></i> ${label}`;
    if (input) input.value = statusEl.getAttribute('data-due') || '';
    openModal();
    setTimeout(() => input?.focus({ preventScroll: true }), 60);
  }

  document.querySelectorAll('.dk-cover-card').forEach(card => {
    // The whole card is the target now that the pencil is gone, so a plain
    // click or keyboard activation opens the editor.
    card.addEventListener('click', () => openCoverEditor(card));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCoverEditor(card); }
    });
  });

  saveBtn?.addEventListener('click', async () => {
    if (!editTarget || !input?.value) return;
    const { statusEl, label } = editTarget;
    const date = input.value;

    // Paint and store locally first so the edit feels instant and survives a
    // failed write, then persist to the DB.
    statusEl.setAttribute('data-due', date);
    window.dkCoverStore.writeLocal(label, date);
    if (typeof window.updateCoverBadge === 'function') window.updateCoverBadge(statusEl);
    closeModal();

    // These checks used to run only once, during initApp(), so a date edited
    // into the warning window stayed silent until the next full reload. Re-run
    // them here and push the new date to the worker for background checks.
    if (window.checkInsuranceNotif) window.checkInsuranceNotif(date);
    if (window.checkDocNotif) window.checkDocNotif(date, label);
    if (window.dkSyncNotifData) window.dkSyncNotifData();
    // "How Sage is doing" reads cover dates, so a lapsed policy fixed here has
    // to reach her summary too — otherwise she keeps saying it lapsed.
    if (window.sageRefreshHealthCard) window.sageRefreshHealthCard();

    const stored = await window.dkCoverStore.saveToDb(label, date);
    if (typeof showPopup === 'function') {
      showPopup('success', stored ? 'Cover date updated!' : 'Cover date saved on this device.');
    }
  });

  closeBtn?.addEventListener('click', closeModal);
  modal?.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  // ESCAPE, WHICH THIS ONE WAS MISSING.
  //
  // The other four dialogs on this shell have had it since they were written; this
  // one had a close button and a backdrop click and nothing for the keyboard. Found
  // by the back-gesture work rather than by looking: the guard at the top of this
  // file shuts an overlay by pressing its own close control and falls back to
  // Escape, and this was the one surface where neither route existed from outside.
  // Guarded on the open class like its siblings, so it cannot swallow a key meant
  // for something layered over it.
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal?.classList.contains('sl-modal--open')) closeModal();
  });
};

// ════════════════════════════════════════════════════════════
// DOCS MEDIA HISTORY FILTERS
// ════════════════════════════════════════════════════════════
(function() {
  function setupDocsFilters() {
    const search = document.getElementById('docsHistorySearch');
    const typeFilter = document.getElementById('docsHistoryTypeFilter');
    const fromDate = document.getElementById('docsHistoryFromDate');
    const toDate = document.getElementById('docsHistoryToDate');
    const toggle = document.getElementById('docsHistoryFilterToggle');
    const filterPanel = document.getElementById('docsHistoryFilters');
    const clearBtn = document.getElementById('docsHistoryClearFilters');
    const typeButton = document.getElementById('docsHistoryTypeButton');
    const typeMenu = document.getElementById('docsHistoryTypeMenu');
    const typeValueEl = document.getElementById('docsHistoryTypeValue');
    const typeWrapper = document.querySelector('[data-docs-type-filter]');
    const table = document.querySelector('#mediaRecordTable tbody');
    if (!search || !table) return;

    // Toggle filter panel on mobile
    toggle?.addEventListener('click', () => {
      const isOpen = filterPanel?.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    // Custom type dropdown
    typeButton?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isOpen = typeWrapper?.classList.toggle('is-open');
      typeButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    typeMenu?.querySelectorAll('.history-select-option').forEach(option => {
      option.addEventListener('click', (e) => {
        e.preventDefault();
        const value = option.dataset.value || '';
        typeFilter.value = value;
        if (typeValueEl) typeValueEl.textContent = option.textContent;
        typeWrapper?.classList.remove('is-open');
        typeButton?.setAttribute('aria-expanded', 'false');
        typeMenu.querySelectorAll('.history-select-option').forEach(o => o.setAttribute('aria-selected', 'false'));
        option.setAttribute('aria-selected', 'true');
        filterDocsTable();
      });
    });

    document.addEventListener('click', (e) => {
      if (typeWrapper && !typeWrapper.contains(e.target)) {
        typeWrapper.classList.remove('is-open');
        typeButton?.setAttribute('aria-expanded', 'false');
      }
    });

    // Clear button
    clearBtn?.addEventListener('click', () => {
      search.value = '';
      typeFilter.value = '';
      if (typeValueEl) typeValueEl.textContent = 'All types';
      fromDate.value = '';
      toDate.value = '';
      // The visible date text is a separate .date-display span, because the native
      // date input is hidden on a phone. Clearing .value does not repaint it, so
      // Clear left "01 Jan 2026" sitting in the FROM field with no filter behind it.
      // The service page's clear calls updateDateUI() directly; that function lives in
      // another closure, so dispatch the event it already listens for instead of
      // exporting it. `change` also re-runs the filter, which is what we want anyway.
      for (const d of [fromDate, toDate]) {
        d?.dispatchEvent(new Event('change', { bubbles: true }));
      }
      typeMenu?.querySelectorAll('.history-select-option').forEach((o, i) => o.setAttribute('aria-selected', i === 0 ? 'true' : 'false'));
      filterDocsTable();
    });

    /**
     * @param {boolean} [resetPage] True when the FILTER changed, which has to send you
     *   back to page one — page three of a four-page list is nowhere once the list is
     *   two pages long. False when the table was merely re-rendered underneath an
     *   unchanged filter, where the page you were on is still the page you want.
     */
    function filterDocsTable(resetPage = true) {
      const query = search.value.toLowerCase().trim();
      const type = typeFilter?.value || '';
      const from = fromDate?.value || '';
      const to = toDate?.value || '';
      const rows = table.querySelectorAll('tr');

      rows.forEach(row => {
        // The "Loading…" / "No uploads yet" placeholder is one cell with a colspan
        // and no data to match, so it is not a candidate for filtering.
        if (row.classList.contains('docs-history-note')) return;
        // BY data-label, NOT BY INDEX.
        //
        // This read cells[0] for the filename and cells[1] for the note. Then Preview
        // and Size became columns two and three, so cells[1] was an eye button with no
        // text in it and searching for anything written in a note matched nothing —
        // searching filenames still worked, which is what made it look like the box was
        // only half broken. Verified headless: "milestone" and "cornering" both
        // returned zero rows while "whatsapp" returned one.
        //
        // Every cell carries a data-label because the phone layout prints it as a
        // caption. Querying that instead of counting positions means the next column
        // added here cannot break the search again.
        const fileCell = row.querySelector('td[data-label="File"]');
        const notesCell = row.querySelector('td[data-label="Notes"]');
        if (!fileCell) return;
        const fileName = fileCell.textContent?.trim()?.toLowerCase() || '';
        const notes = notesCell?.textContent?.trim()?.toLowerCase() || '';
        const text = fileName + ' ' + notes;

        let show = true;
        if (query && !text.includes(query)) show = false;

        if (type) {
          // data-kind on the row, written by loadHistoricUploads() from the column the
          // database actually stores.
          //
          // This used to sniff the word out of the grey "video · 1.6 MB" line, which
          // worked only because that line happened to contain the media type — the fall-
          // back below is that same read, kept for a tbody seeded by hand. The string in
          // the dataset cannot be out of step with the badge in the TYPE column, because
          // both are rendered from the one field.
          let mediaType = row.dataset.kind || '';
          if (!mediaType) {
            const metaText = fileCell.querySelector('.docs-file-meta span:last-child')?.textContent?.toLowerCase() || '';
            if (metaText.includes('image')) mediaType = 'image';
            else if (metaText.includes('audio')) mediaType = 'audio';
            else if (metaText.includes('video')) mediaType = 'video';
          }
          if (mediaType !== type) show = false;
        }

        if (from || to) {
          // data-day is the upload's LOCAL calendar day, already in the same
          // YYYY-MM-DD shape the two date inputs hand over, so this is a string
          // compare and nothing has to be parsed.
          //
          // It was read out of the rendered date text, which is a contract between the
          // filter and a cell's formatting — and that cell now holds two lines, a day
          // and a time. The text read is still the fallback for a tbody seeded by hand.
          let rowDate = row.dataset.day || '';
          if (!rowDate) {
            const dateText = row.querySelector('td[data-label="Uploaded"] .docs-date-cell span')?.textContent?.trim() || '';
            const parsed = new Date(dateText);
            if (!isNaN(parsed.getTime())) {
              // Local, not toISOString(): the text was parsed as a local date, and
              // converting it to UTC here shifted rows a day out of the filter.
              rowDate = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
            }
          }
          if (rowDate) {
            if (from && rowDate < from) show = false;
            if (to && rowDate > to) show = false;
          }
        }

        // A CLASS, not an inline display.
        //
        // This was `row.style.display = 'none'`, and on a phone the row is styled
        // `display: grid !important` — an author !important declaration BEATS an
        // inline one, so the filter would have quietly stopped hiding anything as
        // soon as the mobile card layout landed. A class the stylesheet can also
        // mark !important is the only version that works at both widths, and it
        // gives the media player a way to ask which rows are actually showing.
        row.classList.toggle('is-filtered-out', !show);
      });
      // The pager decides which of the surviving rows are on screen, so it has to run
      // AFTER the filter and BEFORE the player re-collects its slides — otherwise the
      // carousel holds rows that are not currently drawn.
      window.dkDocsPager?.refresh({ keepPage: !resetPage });
      window.dkDocsFilterChanged?.();
    }

    // Reachable from loadHistoricUploads(), which rebuilds the tbody and so drops every
    // is-filtered-out the user's filter had put there.
    window.dkDocsFilterApply = () => filterDocsTable(false);

    let docsFilterTimer;
    search.addEventListener('input', () => { clearTimeout(docsFilterTimer); docsFilterTimer = setTimeout(() => filterDocsTable(true), 150); });
    fromDate?.addEventListener('change', () => filterDocsTable(true));
    toDate?.addEventListener('change', () => filterDocsTable(true));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupDocsFilters);
  } else {
    setupDocsFilters();
  }
})();

// ════════════════════════════════════════════════════════════════════════
// RECORD HISTORY (DOCUMENTS) — PAGING, SORTING AND THUMBNAILS
//
// Three jobs that all turn on the same question — which rows are on screen right now
// — so they live together and run in a fixed order: sort moves rows, the filter marks
// the ones that do not count, the pager hides everything outside the current page, and
// only then is there a set of rows small enough to be worth fetching pictures for.
//
// PAGING BY CLASS, NOT BY REMOVING ROWS. The tbody is the state here: the filter reads
// it, the player pages through it, hold-to-edit reads the note out of it. Rebuilding it
// per page would mean re-signing URLs and re-running the filter on every click, so a
// row that is not on this page gets `.is-paged-out` and the same !important display
// rule that answers `.is-filtered-out` answers this too.
// ════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const TBODY = '#mediaRecordTable tbody';

  function allRows() {
    return [...document.querySelectorAll(`${TBODY} tr.docs-media-row`)];
  }

  /** Rows the filter has kept — the list the pager is paging through. */
  function keptRows() {
    return allRows().filter(r => !r.classList.contains('is-filtered-out'));
  }

  // ══ Paging ═════════════════════════════════════════════════════════════

  const pager = window.dkPager({
    key: 'docsHistory',
    noun: ['file', 'files'],
    ids: {
      root: 'docsHistoryPager',
      per: 'docsHistoryPerPage',
      count: 'docsHistoryRange',
      nav: 'docsHistoryNav',
      prev: 'docsHistoryPrev',
      next: 'docsHistoryNext',
      pages: 'docsHistoryPages',
    },
    onChange: () => apply(),
  });

  function apply() {
    const kept = keptRows();
    pager.setTotal(kept.length);
    const { from, to } = pager.slice();
    const onPage = new Set(kept.slice(from, to));
    // Every row, not just the kept ones: a row the filter hid also has to carry
    // is-paged-out, or it comes back the moment the filter lets it through again.
    for (const row of allRows()) row.classList.toggle('is-paged-out', !onPage.has(row));
    pager.paint();
    // New rows on screen, so new pictures worth fetching.
    thumbs.scan();
  }

  window.dkDocsPager = {
    /**
     * @param {object} [opts]
     * @param {boolean} [opts.keepPage] Stay where you are (a reload, or a delete).
     *   Otherwise go back to page one, which is what a changed filter wants.
     */
    refresh(opts = {}) {
      if (!opts.keepPage) pager.reset();
      apply();
    },
    /** Put the page holding `row` on screen. Returns false if it is not in the table. */
    reveal(row) {
      const i = keptRows().indexOf(row);
      if (i < 0) return false;
      pager.showIndex(i);
      apply();
      return true;
    },
  };

  // ══ Sorting ════════════════════════════════════════════════════════════
  //
  // UPLOADED is the only sortable column because it is the only one with an order that
  // means anything — a list of filenames alphabetically is a list nobody asked for.
  // Supabase hands the rows over newest-first, so 'desc' is where this starts and the
  // arrow in the header says so from the first paint rather than after the first click.

  let dir = 'desc';

  function applySort() {
    const tbody = document.querySelector(TBODY);
    if (!tbody) return;
    const rows = allRows();
    if (rows.length < 2) return;
    // Stable within a single timestamp: two files uploaded in the same second keep the
    // order the database gave them, so the list does not reshuffle on every sort.
    const keyed = rows.map((row, i) => ({ row, i, when: Number(row.dataset.when) || 0 }));
    keyed.sort((a, b) => (dir === 'asc' ? a.when - b.when : b.when - a.when) || (a.i - b.i));
    // appendChild MOVES a node, so this reorders in place without touching innerHTML —
    // which matters because the delegated hold handler and the note text live on these
    // very elements.
    for (const entry of keyed) tbody.appendChild(entry.row);
  }

  function paintSortButton() {
    const btn = document.getElementById('docsHistorySort');
    if (!btn) return;
    btn.dataset.dir = dir;
    const icon = btn.querySelector('i');
    if (icon) icon.className = `fas fa-arrow-${dir === 'asc' ? 'up' : 'down'}`;
    btn.title = dir === 'asc' ? 'Sort by upload date, newest first' : 'Sort by upload date, oldest first';
    btn.closest('th')?.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
  }

  window.dkDocsSortApply = () => { applySort(); paintSortButton(); };

  function setupSort() {
    const btn = document.getElementById('docsHistorySort');
    if (!btn || btn.dataset.ready === 'true') return;
    btn.dataset.ready = 'true';
    btn.addEventListener('click', () => {
      dir = dir === 'desc' ? 'asc' : 'desc';
      applySort();
      paintSortButton();
      // Reordering the whole list makes the page you were on meaningless — page 1 of
      // oldest-first is the other end of the table.
      window.dkDocsPager.refresh();
      window.dkDocsFilterChanged?.();
    });
    paintSortButton();
  }

  // ══ Thumbnails ═════════════════════════════════════════════════════════
  //
  // A frame of the file, in the button that opens it. This is the reason the eye button
  // and its whole column could go: a thumbnail reads as pressable, which a file-type
  // glyph never did.
  //
  // ── WHY THE FIRST VERSION WAS SLOW, AND WHAT EACH FIX ADDRESSES ──
  //
  // It signed one URL per row and then handed the browser the ORIGINAL object. A 4.6 MB
  // photograph was downloaded in full to paint a 52-pixel box, ten of those per page,
  // behind ten separate signing round trips, and none of it was kept — turning a page,
  // changing a filter or reloading started the whole bill again.
  //
  //   ten round trips  ->  ONE. createSignedUrls signs the page in a single request.
  //   4.6 MB per box    ->  a few KB. Supabase can resize at the edge; the URL for that
  //                         is the signed URL with /object/sign/ swapped for
  //                         /render/image/sign/ and the size appended. That is a shape,
  //                         not a promise, and image transforms are not on every plan —
  //                         so a failure falls back to the original object, and a
  //                         failure of THAT falls back to the glyph.
  //   nothing kept      ->  the painted frame is stored as a ~3 KB data URL under the
  //                         object's name, so every later view of that file is
  //                         instant and offline. This is the fix you actually feel.
  //   waited to scroll  ->  the page's own rows start immediately. There are at most
  //                         PREFETCH of them and they are the ones being looked at; the
  //                         observer is still there for a 50-per-page list.
  //
  // Audio never had a frame to fetch and still does not.

  const thumbs = (function () {
    // What the cache stores and what the capture canvas is sized to. 2x the 52x40 box
    // the desktop draws and a touch over the 72px phone square, so one cached frame
    // serves both without looking soft on a retina screen.
    const CAP_W = 144;
    const CAP_H = 112;
    const STORE_KEY = 'spinlogThumbs.v1';
    // ~3 KB each at q0.62, so this is roughly half a megabyte against a 5 MB budget
    // shared with everything else in localStorage.
    const STORE_MAX = 160;
    // How many of the current page start without waiting to be scrolled into view. Ten
    // is the default page size; fifty is a size you have to ask for, and the rest of
    // those wait for the observer.
    const PREFETCH = 12;

    const done = new WeakSet();
    /**
     * name -> { url, at }, so turning a page back does not re-sign what it already has.
     *
     * Timestamped because a signed URL is only good for an hour. Without the check, a
     * tab left open all afternoon would hand a 403 to the first page it had not already
     * cached a frame for, and the only symptom would be thumbnails that stopped
     * appearing. 50 minutes leaves room for the fetch itself.
     */
    const signedUrls = new Map();
    const SIGN_GOOD_FOR = 50 * 60 * 1000;

    function freshUrl(name) {
      const hit = signedUrls.get(name);
      if (!hit) return null;
      if (Date.now() - hit.at > SIGN_GOOD_FOR) { signedUrls.delete(name); return null; }
      return hit.url;
    }
    /** name -> data URL. Read through from localStorage once, written back debounced. */
    let frames = null;
    let writeTimer = null;
    let observer = null;

    // ── The frame cache ────────────────────────────────────────────────

    function store() {
      if (frames) return frames;
      frames = new Map();
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) for (const [k, v] of Object.entries(JSON.parse(raw))) frames.set(k, v);
      } catch { /* private mode, or someone else's data under this key */ }
      return frames;
    }

    function persist() {
      clearTimeout(writeTimer);
      // Debounced: ten thumbnails landing within a second of each other would otherwise
      // serialise and write the whole cache ten times.
      writeTimer = setTimeout(() => {
        const map = store();
        // Map preserves insertion order, so the oldest entries are the ones at the
        // front — dropping from there is a plain LRU without a timestamp per row.
        while (map.size > STORE_MAX) map.delete(map.keys().next().value);
        try {
          localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(map)));
        } catch {
          // Over quota. Halve it and try once more rather than losing the lot.
          const keys = [...map.keys()].slice(0, Math.floor(map.size / 2));
          for (const k of keys) map.delete(k);
          try { localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(map))); } catch { /* give up */ }
        }
      }, 900);
    }

    /**
     * Draw what loaded into a small canvas and keep the result.
     *
     * Silent on failure, and the likeliest failure is a tainted canvas: an <img> or
     * <video> loaded without CORS cannot be read back. The elements below ask for CORS
     * and fall back to a plain load, so the worst case is a thumbnail that shows every
     * time instead of one that shows instantly — never a thumbnail that does not show.
     */
    function keepFrame(name, media, kind) {
      try {
        const w = kind === 'video' ? media.videoWidth : media.naturalWidth;
        const h = kind === 'video' ? media.videoHeight : media.naturalHeight;
        if (!w || !h) return;
        const canvas = document.createElement('canvas');
        canvas.width = CAP_W;
        canvas.height = CAP_H;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        // cover, matching what object-fit does to the element, so the cached frame and
        // a live one are not two different crops of the same picture.
        const scale = Math.max(CAP_W / w, CAP_H / h);
        const dw = w * scale;
        const dh = h * scale;
        ctx.drawImage(media, (CAP_W - dw) / 2, (CAP_H - dh) / 2, dw, dh);
        const data = canvas.toDataURL('image/jpeg', 0.62);
        if (!data || data.length < 64) return;
        const map = store();
        map.delete(name);            // re-insert, so a file just looked at is newest
        map.set(name, data);
        persist();
      } catch { /* tainted canvas, or no 2d context */ }
    }

    // ── Painting ───────────────────────────────────────────────────────

    function paint(btn, src, { cached = false } = {}) {
      const img = document.createElement('img');
      img.className = 'docs-thumb-media';
      img.alt = '';
      img.decoding = 'async';
      img.src = src;
      if (cached) {
        // A data URL is already decoded by the time the next frame paints, so there is
        // no gap to cover and the fade would be a flicker.
        btn.classList.add('has-thumb', 'is-cached');
        btn.insertBefore(img, btn.firstChild);
        return;
      }
      img.addEventListener('load', () => btn.classList.add('has-thumb'), { once: true });
      img.addEventListener('error', () => img.remove(), { once: true });
      btn.insertBefore(img, btn.firstChild);
    }

    /**
     * Whether the edge resizer answered the last time it was asked.
     *
     * Session-scoped on purpose rather than remembered in localStorage: a project that
     * gains the feature should pick it up on the next load, and the frame cache means the
     * cost of finding out is one request per session, not per file.
     */
    let transformsWork = true;

    /**
     * The transformed URL for a signed one, or null if it does not look signed.
     *
     * Derived by rewriting the path rather than by asking createSignedUrl for a
     * transform, because that would cost one request per image and the whole point of
     * the batch above is that it does not. If Supabase will not serve it — transforms
     * are a plan feature — the <img> errors and the caller moves to the next attempt.
     */
    function renderUrl(signed) {
      if (typeof signed !== 'string' || !signed.includes('/object/sign/')) return null;
      const join = signed.includes('?') ? '&' : '?';
      return `${signed.replace('/object/sign/', '/render/image/sign/')}`
        + `${join}width=${CAP_W}&height=${CAP_H}&resize=cover&quality=70`;
    }

    /** Load `src` into an <img> we can read back, resolving to it or to null. */
    function probe(src, withCors) {
      return new Promise(resolve => {
        const img = new Image();
        if (withCors) img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        img.addEventListener('load', () => resolve(img), { once: true });
        img.addEventListener('error', () => resolve(null), { once: true });
        img.src = src;
      });
    }

    /** The first frame of a video, as an element we can read back, or null. */
    function probeVideo(src, withCors) {
      return new Promise(resolve => {
        const video = document.createElement('video');
        if (withCors) video.crossOrigin = 'anonymous';
        // metadata, and #t=0.1 rather than 0: seeking to exactly zero lands before the
        // first keyframe on plenty of real files and paints a black rectangle.
        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;
        let settled = false;
        const finish = value => { if (!settled) { settled = true; resolve(value); } };
        video.addEventListener('loadeddata', () => finish(video), { once: true });
        video.addEventListener('error', () => finish(null), { once: true });
        // A video that neither loads nor errors holds a slot for ever. Six seconds is
        // long enough for a metadata range request on a slow link and short enough that
        // the glyph comes back while you are still looking at the row.
        setTimeout(() => finish(null), 6000);
        video.src = `${src}#t=0.1`;
      });
    }

    /**
     * Should a video frame be fetched at all right now?
     *
     * A picture can be resized at the edge; a video cannot, so its thumbnail means
     * pulling enough of the file to decode one frame. On a metered or slow connection
     * that is not a trade worth making silently, and the play glyph is a perfectly good
     * answer. Once a frame is cached this question stops being asked.
     */
    function videoFramesWelcome() {
      const c = navigator.connection;
      if (!c) return true;
      if (c.saveData) return false;
      return !/^(slow-2g|2g)$/.test(String(c.effectiveType || ''));
    }

    // ── One slot ───────────────────────────────────────────────────────

    async function fill(btn, signed) {
      const name = btn.dataset.thumb;
      const kind = btn.dataset.thumbKind;
      if (!btn.isConnected) return;

      if (kind === 'video') {
        if (!videoFramesWelcome()) return;
        const video = (await probeVideo(signed, true)) || (await probeVideo(signed, false));
        if (!video || !btn.isConnected) return;
        // Painted from the cache the capture writes, so there is one code path for
        // showing a frame and the <video> element is thrown away immediately rather
        // than sitting in the row holding a decoder open.
        keepFrame(name, video, 'video');
        const data = store().get(name);
        if (data) paint(btn, data, { cached: true });
        return;
      }

      // Smallest first. Each rung is a whole URL, not a retry of the same one: the
      // transform may be off for this project, and CORS may be off for this bucket.
      //
      // And the transform is only tried until it is known not to work. Image resizing is
      // a plan feature, so on a project without it the first rung is a guaranteed miss —
      // once, which is a cheap 4xx, rather than once per file for ever.
      const small = transformsWork ? renderUrl(signed) : null;
      let img = small ? (await probe(small, true)) || (await probe(small, false)) : null;
      if (small && !img) transformsWork = false;
      if (!img) img = (await probe(signed, true)) || (await probe(signed, false));
      if (!img || !btn.isConnected) return;
      keepFrame(name, img, 'image');
      paint(btn, img.currentSrc || img.src);
    }

    // ── Scheduling ─────────────────────────────────────────────────────

    function watcher() {
      if (observer || typeof IntersectionObserver !== 'function') return observer;
      observer = new IntersectionObserver(entries => {
        const wake = [];
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          wake.push(entry.target);
        }
        if (wake.length) run(wake);
      }, { rootMargin: '300px 0px' });
      return observer;
    }

    /** Sign whatever is left after the cache, then fill each slot. */
    async function run(slots) {
      const live = slots.filter(btn => !done.has(btn) && btn.isConnected && btn.dataset.thumb);
      if (!live.length) return;
      for (const btn of live) done.add(btn);

      const cache = store();
      const pending = [];
      for (const btn of live) {
        const hit = cache.get(btn.dataset.thumb);
        // No await, no request, nothing to wait for. This is the whole point of the
        // cache: the second time you look at a file its picture is simply there.
        if (hit) paint(btn, hit, { cached: true });
        else pending.push(btn);
      }
      if (!pending.length) return;

      // Reuse anything already signed this session before asking for more.
      const needed = pending.map(b => b.dataset.thumb).filter(n => !freshUrl(n));
      if (needed.length) {
        const signer = window.dkSignHistoricMediaBatch;
        let batch = null;
        if (typeof signer === 'function') {
          try { batch = await signer(needed); } catch { batch = null; }
        } else if (typeof window.dkGetHistoricMediaUrl === 'function') {
          // The audit and the harness replace the single-file signer, so this path has
          // to work on its own.
          batch = new Map();
          const urls = await Promise.all(needed.map(n => window.dkGetHistoricMediaUrl(n).catch(() => null)));
          needed.forEach((n, i) => { if (urls[i]) batch.set(n, urls[i]); });
        }
        const at = Date.now();
        if (batch) for (const [name, url] of batch) signedUrls.set(name, { url, at });
      }

      await Promise.all(pending.map(btn => {
        const url = freshUrl(btn.dataset.thumb);
        return url ? fill(btn, url) : null;
      }));
    }

    return {
      /**
       * Fill the thumbnails on the current page.
       *
       * Called after every render, filter, sort and page turn, so it has to be cheap
       * when there is nothing to do — hence the WeakSet, which also means a row rebuilt
       * by loadHistoricUploads() is treated as the new element it is.
       */
      scan() {
        const slots = [...document.querySelectorAll('#mediaRecordTable tbody tr.docs-media-row:not(.is-paged-out):not(.is-filtered-out) .docs-thumb[data-thumb]')]
          .filter(btn => !done.has(btn));
        if (!slots.length) return;
        // The rows on this page are the rows being looked at, so the first screenful
        // does not wait to be scrolled into view — that wait was itself part of "the
        // thumbnails take a while".
        run(slots.slice(0, PREFETCH));
        const io = watcher();
        for (const btn of slots.slice(PREFETCH)) {
          // No IntersectionObserver is not a reason to have no thumbnails.
          if (io) io.observe(btn);
          else run([btn]);
        }
      },
      /** Drop a deleted file's frame, so its name cannot resolve to a stale picture. */
      forget(name) {
        if (!name) return;
        store().delete(name);
        signedUrls.delete(name);
        persist();
      },
    };
  })();

  window.dkDocsThumbs = thumbs;

  function boot() {
    setupSort();
    pager.wire();
    // Nothing in the table yet — loadHistoricUploads() calls back when there is.
    apply();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

// ════════════════════════════════════════════════════════════════════════
// RECORD HISTORY — MEDIA PLAYER AND HOLD-TO-EDIT
//
// Two things the rows used to do with buttons, now done with the row itself.
//
//   the type icon  opens the file
//   holding a row  edits its note and its date
//
// The player is one carousel over every record CURRENTLY SHOWING, replacing four
// single-file modals that each opened on one file and closed back to the list. It
// sits on a scroll-snap track so the swipe is the browser's own horizontal
// scrolling rather than hand-rolled touch maths — which matters because the slides
// contain <video> and <audio> elements with their own drag handling.
//
// Signed URLs are fetched lazily and only for the slide you are on and its two
// neighbours. A list of twenty videos would otherwise mean twenty signing round
// trips and twenty preloading players the moment you tapped the first one.
// ════════════════════════════════════════════════════════════════════════
(function () {
  const HOLD_MS = 520;
  // 16px, not 10. A thumb resting on a phone screen wanders further than 10px over
  // half a second, and every one of those was a hold that silently did nothing.
  const HOLD_MOVE = 16;
  const NEIGHBOURS = 1;

  let items = [];
  let index = 0;
  const hydrated = new Set();
  // Signed URL per slot, so Save does not have to sign the same file twice.
  const urls = new Map();
  let scrollSettle = null;

  const $ = id => document.getElementById(id);

  /**
   * is-paged-out as well as is-filtered-out.
   *
   * The player pages through what is ON SCREEN, and once the table has page controls
   * those are two different classes for the same answer: a row on page three is no more
   * drawn than a row the search excluded. Without this the carousel would hold all
   * twenty-four files while the table showed ten, and the counter in its bar would
   * disagree with the list you opened it from.
   */
  function rowsShowing() {
    return [...document.querySelectorAll('#mediaRecordTable tbody tr.docs-media-row')]
      .filter(r => !r.classList.contains('is-filtered-out') && !r.classList.contains('is-paged-out'));
  }

  /** What the player will page through: the visible rows, in the order shown. */
  function collect() {
    return rowsShowing().map(tr => {
      const id = Number(tr.dataset.mediaId);
      const row = window._historicMediaRows?.get(id);
      if (!row) return null;
      const note = tr.querySelector('.docs-notes-cell')?.textContent?.trim() || '';
      return {
        id,
        name: row.original_name || 'Untitled',
        kind: String(row.media_type || '').toLowerCase(),
        storage: row.file_name,
        size: row.file_size,
        note: note === 'No notes saved' ? '' : note,
        when: tr.querySelector('td[data-label="Uploaded"] .docs-date-cell span')?.textContent?.trim() || '',
      };
    }).filter(Boolean);
  }

  /**
   * This module is OUTSIDE the DOMContentLoaded closure that holds docsEscapeHtml
   * and docsFormatBytes, so neither is in scope. `typeof` on an undeclared name is
   * the one safe way to ask, and the fallbacks below are what actually run — they
   * are the implementation here, not a defensive shrug.
   */
  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function bytes(n) {
    const size = Number(n);
    if (!Number.isFinite(size) || size <= 0) return null;
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let v = size;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
    return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
  }

  // ══ Building ═══════════════════════════════════════════════════════════

  function build() {
    const stage = $('docsPlayerStage');
    const dots = $('docsPlayerDots');
    if (!stage) return;
    hydrated.clear();
    urls.clear();
    stage.innerHTML = items.map((it, i) => `
      <figure class="docs-player-slide" data-slot="${i}" aria-label="${esc(it.name)}">
        <div class="docs-player-frame" data-frame="${i}">
          <span class="docs-player-wait"><i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i></span>
        </div>
      </figure>`).join('');
    if (dots) {
      // Dots stop being readable long before a real library stops being usable, so
      // past a dozen the counter in the bar is the only position indicator.
      dots.innerHTML = items.length > 1 && items.length <= 12
        ? items.map((_, i) => `<span class="docs-player-dot" data-dot="${i}"></span>`).join('')
        : '';
    }
  }

  /** The signed URL, then the right element for the kind of file it is. */
  async function hydrate(i) {
    const it = items[i];
    const frame = document.querySelector(`.docs-player-frame[data-frame="${i}"]`);
    if (!it || !frame || hydrated.has(i)) return;
    hydrated.add(i);

    // window.dkGetHistoricMediaUrl, not the bare getHistoricMediaUrl.
    //
    // This IIFE is at the top level of the file; getHistoricMediaUrl is declared
    // inside the big DOMContentLoaded closure and is not in scope here, so calling it
    // directly is a ReferenceError the first time anyone opens a file. That closure
    // already exposes it under this name for exactly this reason.
    const signer = window.dkGetHistoricMediaUrl;
    const url = typeof signer === 'function' ? await signer(it.storage) : null;
    if (!url) {
      frame.innerHTML = '<p class="docs-player-fail">That file could not be opened.<br>'
        + 'Its link may have expired — close this and try again.</p>';
      return;
    }

    urls.set(i, url);

    if (it.kind === 'image') {
      frame.innerHTML = `<img src="${esc(url)}" alt="${esc(it.name)}" decoding="async" />`;
      return;
    }
    if (it.kind !== 'video' && it.kind !== 'audio') {
      frame.innerHTML = `<a class="docs-player-open" href="${esc(url)}" target="_blank" rel="noopener">
          <i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i> Open this file
        </a>`;
      return;
    }

    // ── A CODED PLAYER, not the browser's ──
    //
    // The native controls were there and unreachable. A portrait clip laid out at
    // width:100%/height:auto came to 1412x1886 inside a 732px frame, so the control
    // bar the browser draws at the bottom of the video box sat a thousand pixels
    // below the visible area. It looked like a video that would not play.
    //
    // Owning the bar fixes more than that. It can sit INSIDE the frame whatever the
    // media's shape; it can be the only thing that claims the horizontal drag, so the
    // carousel keeps working everywhere except the seek slider; and audio gets the
    // same control row as video instead of a stranded 40px widget.
    const media = it.kind === 'video'
      ? `<video class="dkp-media" src="${esc(url)}" playsinline preload="metadata"></video>`
      : `<audio class="dkp-media" src="${esc(url)}" preload="metadata"></audio>`;

    frame.innerHTML = `<div class="dkp dkp--${esc(it.kind)}">
        ${it.kind === 'audio' ? `<span class="dkp-art" aria-hidden="true"><i class="fas fa-wave-square" aria-hidden="true"></i></span>` : ''}
        ${media}
        <div class="dkp-bar">
          <button type="button" class="dkp-btn dkp-play" aria-label="Play">
            <i class="fas fa-play" aria-hidden="true"></i>
          </button>
          <span class="dkp-time dkp-now">0:00</span>
          <input class="dkp-seek" type="range" min="0" max="1000" value="0" step="1"
                 aria-label="Seek" />
          <span class="dkp-time dkp-dur">0:00</span>
          <button type="button" class="dkp-btn dkp-mute" aria-label="Mute">
            <i class="fas fa-volume-high" aria-hidden="true"></i>
          </button>
          ${it.kind === 'video' ? `<button type="button" class="dkp-btn dkp-full" aria-label="Fullscreen">
            <i class="fas fa-expand" aria-hidden="true"></i>
          </button>` : ''}
        </div>
      </div>`;

    wirePlayer(frame.querySelector('.dkp'));
  }

  /** Clock format. 0:07, 1:42, 12:03 — no hours, nothing here runs that long. */
  function clock(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /**
   * Wire one coded player.
   *
   * Everything reads FROM the media element, so the bar cannot drift out of step with
   * what is actually playing — including when playback is started or stopped from
   * somewhere else, like swiping to another slide.
   */
  function wirePlayer(root) {
    if (!root) return;
    const media = root.querySelector('.dkp-media');
    const play = root.querySelector('.dkp-play');
    const seek = root.querySelector('.dkp-seek');
    const now = root.querySelector('.dkp-now');
    const dur = root.querySelector('.dkp-dur');
    const mute = root.querySelector('.dkp-mute');
    const full = root.querySelector('.dkp-full');
    if (!media) return;

    let scrubbing = false;
    const icon = (btn, name) => {
      const i = btn && btn.querySelector('i');
      if (i) i.className = `fas ${name}`;
    };

    const showPlaying = () => {
      icon(play, media.paused ? 'fa-play' : 'fa-pause');
      if (play) play.setAttribute('aria-label', media.paused ? 'Play' : 'Pause');
      root.classList.toggle('is-playing', !media.paused);
    };
    const showTime = () => {
      if (scrubbing) return;
      const d = Number.isFinite(media.duration) ? media.duration : 0;
      if (now) now.textContent = clock(media.currentTime);
      if (dur) dur.textContent = clock(d);
      if (seek) seek.value = d > 0 ? String(Math.round((media.currentTime / d) * 1000)) : '0';
    };

    media.addEventListener('loadedmetadata', showTime);
    media.addEventListener('durationchange', showTime);
    media.addEventListener('timeupdate', showTime);
    media.addEventListener('play', showPlaying);
    media.addEventListener('pause', showPlaying);
    media.addEventListener('ended', () => { showPlaying(); showTime(); });
    media.addEventListener('volumechange', () => {
      icon(mute, media.muted || media.volume === 0 ? 'fa-volume-xmark' : 'fa-volume-high');
      if (mute) mute.setAttribute('aria-label', media.muted ? 'Unmute' : 'Mute');
    });

    const toggle = () => { if (media.paused) media.play().catch(() => {}); else media.pause(); };
    play?.addEventListener('click', toggle);
    // Tapping the picture is how everyone expects to pause a video. Audio has no
    // picture to tap, so it keeps the button only.
    if (media.tagName === 'VIDEO') media.addEventListener('click', toggle);

    // The slider is the ONLY thing in here that takes the horizontal gesture. That is
    // the whole reason for a coded bar: touch-action on the <video> itself killed the
    // swipe across the entire picture, and the carousel needs that everywhere else.
    if (seek) {
      const apply = () => {
        const d = Number.isFinite(media.duration) ? media.duration : 0;
        if (d > 0) media.currentTime = (Number(seek.value) / 1000) * d;
      };
      seek.addEventListener('pointerdown', () => { scrubbing = true; });
      seek.addEventListener('input', () => {
        const d = Number.isFinite(media.duration) ? media.duration : 0;
        if (now && d > 0) now.textContent = clock((Number(seek.value) / 1000) * d);
      });
      seek.addEventListener('change', () => { apply(); scrubbing = false; });
      ['pointerup', 'pointercancel'].forEach(t =>
        seek.addEventListener(t, () => { apply(); scrubbing = false; }));
    }

    mute?.addEventListener('click', () => { media.muted = !media.muted; });

    full?.addEventListener('click', () => {
      const target = media.tagName === 'VIDEO' ? media : root;
      if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
      // webkitEnterFullscreen is the only one iOS Safari offers on a <video>.
      if (target.requestFullscreen) target.requestFullscreen().catch(() => {});
      else if (media.webkitEnterFullscreen) media.webkitEnterFullscreen();
    });

    showPlaying();
    showTime();
  }

  /**
   * Save the file to the device.
   *
   * Through a blob, not a bare <a download>. The signed URL is a different origin, and
   * the download attribute is ignored cross-origin — the browser navigates to the file
   * instead, which on a video means it starts playing in a new tab. Fetching it first
   * makes the blob same-origin, so the attribute is honoured and the file keeps its
   * real name rather than the storage key.
   */
  async function save(i) {
    const it = items[i];
    if (!it) return;
    const btn = $('docsPlayerSave');
    const set = name => { const g = btn?.querySelector('i'); if (g) g.className = `fas ${name}`; };
    let url = urls.get(i);
    if (!url) {
      const signer = window.dkGetHistoricMediaUrl;
      url = typeof signer === 'function' ? await signer(it.storage) : null;
    }
    if (!url) { set('fa-triangle-exclamation'); return; }

    if (btn) btn.disabled = true;
    set('fa-circle-notch fa-spin');
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = it.name || 'spinlog-media';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Long enough for the download to have started; revoking immediately can
      // cancel it in some browsers.
      setTimeout(() => URL.revokeObjectURL(href), 20000);
      set('fa-check');
      setTimeout(() => set('fa-download'), 2200);
    } catch {
      set('fa-triangle-exclamation');
      setTimeout(() => set('fa-download'), 2600);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ══ Moving ═════════════════════════════════════════════════════════════

  function paint() {
    const it = items[index];
    if (!it) return;
    const count = $('docsPlayerCount');
    const name = $('docsPlayerName');
    const meta = $('docsPlayerMeta');
    const note = $('docsPlayerNote');
    if (count) count.textContent = `${index + 1} / ${items.length}`;
    if (name) name.textContent = it.name;
    if (meta) meta.textContent = [it.kind, bytes(it.size), it.when].filter(Boolean).join(' · ');
    if (note) {
      note.textContent = it.note;
      note.hidden = !it.note;
    }
    document.querySelectorAll('.docs-player-dot').forEach(d => {
      d.classList.toggle('is-on', Number(d.dataset.dot) === index);
    });
    const prev = $('docsPlayerPrev');
    const next = $('docsPlayerNext');
    if (prev) prev.disabled = index <= 0;
    if (next) next.disabled = index >= items.length - 1;

    // Only ever one thing playing. Swiping off a video used to leave it running
    // behind the next slide.
    document.querySelectorAll('#docsPlayerStage video, #docsPlayerStage audio')
      .forEach(el => {
        const slot = Number(el.closest('.docs-player-slide')?.dataset.slot);
        if (slot !== index && !el.paused) el.pause();
      });

    for (let i = index - NEIGHBOURS; i <= index + NEIGHBOURS; i += 1) {
      if (i >= 0 && i < items.length) hydrate(i);
    }
  }

  function goTo(i, smooth) {
    const stage = $('docsPlayerStage');
    const next = Math.max(0, Math.min(items.length - 1, i));
    index = next;
    if (stage) {
      const slide = stage.querySelector(`.docs-player-slide[data-slot="${next}"]`);
      if (slide) {
        // scrollTo on the container rather than scrollIntoView, which would also
        // scroll the PAGE behind the fixed overlay.
        stage.scrollTo({ left: slide.offsetLeft - stage.offsetLeft, behavior: smooth ? 'smooth' : 'auto' });
      }
    }
    paint();
  }

  /** Which slide the track has settled on, after a swipe. */
  function onScroll() {
    const stage = $('docsPlayerStage');
    if (!stage) return;
    clearTimeout(scrollSettle);
    scrollSettle = setTimeout(() => {
      const at = Math.round(stage.scrollLeft / Math.max(1, stage.clientWidth));
      if (at !== index && at >= 0 && at < items.length) {
        index = at;
        paint();
      }
    }, 90);
  }

  // ══ Opening and shutting ═══════════════════════════════════════════════

  function open(id) {
    const player = $('docsPlayer');
    if (!player) return;
    items = collect();
    const at = items.findIndex(it => it.id === Number(id));
    if (!items.length || at < 0) return;

    build();
    player.setAttribute('aria-hidden', 'false');
    player.classList.add('is-open');
    // The page behind must not scroll while a full-screen viewer is up.
    document.body.classList.add('docs-player-lock');
    // After the class, or the track has no width yet and every slide is at 0.
    requestAnimationFrame(() => {
      goTo(at, false);
      $('docsPlayerStage')?.focus({ preventScroll: true });
    });
  }

  function close() {
    const player = $('docsPlayer');
    if (!player) return;
    document.querySelectorAll('#docsPlayerStage video, #docsPlayerStage audio')
      .forEach(el => { el.pause(); el.removeAttribute('src'); el.load?.(); });
    player.classList.remove('is-open');
    player.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('docs-player-lock');
    const stage = $('docsPlayerStage');
    if (stage) stage.innerHTML = '';
    hydrated.clear();
    urls.clear();
    items = [];
  }

  // ══ Wiring ═════════════════════════════════════════════════════════════

  function setup() {
    const tbody = document.querySelector('#mediaRecordTable tbody');
    const player = $('docsPlayer');
    if (!tbody || !player) return;

    // ── Anything carrying data-media-open opens the file ──
    // The thumbnail at the start of the row, at every width.
    tbody.addEventListener('click', e => {
      const btn = e.target.closest('[data-media-open]');
      if (!btn) return;
      e.preventDefault();
      open(btn.dataset.mediaOpen);
    });

    // ── ONE OPEN CONTROL, NOT TWO ──
    //
    // There used to be a matchMedia watcher here that set `disabled` on every
    // .docs-file-open from 769px up, plus a MutationObserver to re-apply it every time
    // the tbody was rewritten. It existed because a desktop row had a SECOND way to open
    // the file — an eye button in a Preview column of its own — and two controls for one
    // action on one row is one too many, so the type glyph was switched off.
    //
    // The reason that second control existed was that a file-type glyph does not read as
    // pressable to a mouse. It is a thumbnail now: a frame of the picture or the video,
    // which does. So the eye button is gone, its column is the TYPE column, and this
    // button is live at every width with no state to keep in step.

    // ── Holding a row edits it ──
    // Delegated on the tbody, so rows redrawn by loadHistoricUploads() keep working
    // without rebinding. Same shape as the service records' hold-to-edit.
    let timer = null;
    let row = null;
    let startX = 0;
    let startY = 0;
    const clear = () => {
      clearTimeout(timer);
      timer = null;
      row?.classList.remove('is-holding');
      row = null;
    };

    tbody.addEventListener('pointerdown', ev => {
      clear();
      // Live controls own their own taps: the thumbnail opens the file and the bin
      // deletes it, so neither starts a hold. The filename, the note and the date are
      // plain text and all of them do — which is most of the row's width.
      if (ev.target.closest('button:not(:disabled), a')) return;
      const hit = ev.target.closest('tr.docs-media-row');
      if (!hit || !hit.dataset.mediaId) return;
      row = hit;
      startX = ev.clientX;
      startY = ev.clientY;
      row.classList.add('is-holding');
      timer = setTimeout(() => {
        const id = row?.dataset.mediaId;
        clear();
        if (id) window._editHistoricMedia?.(id);
      }, HOLD_MS);
    });
    // A scroll that starts on a row must not become an edit — but a thumb that simply
    // rests is not a scroll. The threshold was 10px, which a finger drifts past
    // without meaning to, so the hold failed often enough to look broken. The browser
    // tells us when it has genuinely taken the gesture over, via pointercancel, and
    // that is the signal that actually matters; the distance check is only a backstop
    // for a slow drag that never triggers one.
    tbody.addEventListener('pointermove', ev => {
      if (!timer) return;
      if (Math.abs(ev.clientX - startX) > HOLD_MOVE
        || Math.abs(ev.clientY - startY) > HOLD_MOVE) clear();
    });
    tbody.addEventListener('pointerup', clear);
    // pointerleave is NOT cancelled on.
    //
    // Touch gets implicit pointer capture, so the events keep targeting the element
    // the press began on — and the browser then fires pointerleave at the END of the
    // gesture, on a press that never moved at all. Cancelling there raced the 520ms
    // timer and killed valid holds. pointercancel and pointerup already cover every
    // real way out.
    tbody.addEventListener('pointercancel', clear);
    // Holding on a phone otherwise raises the native selection callout over the sheet.
    tbody.addEventListener('contextmenu', ev => {
      if (ev.target.closest('tr.docs-media-row')) ev.preventDefault();
    });

    // ── The player's own controls ──
    $('docsPlayerClose')?.addEventListener('click', close);
    $('docsPlayerSave')?.addEventListener('click', () => save(index));
    $('docsPlayerPrev')?.addEventListener('click', () => goTo(index - 1, true));
    $('docsPlayerNext')?.addEventListener('click', () => goTo(index + 1, true));
    $('docsPlayerStage')?.addEventListener('scroll', onScroll, { passive: true });
    $('docsPlayerDots')?.addEventListener('click', e => {
      const dot = e.target.closest('.docs-player-dot');
      if (dot) goTo(Number(dot.dataset.dot), true);
    });
    // Only the backdrop, not the slide: tapping a photo to close it while trying to
    // look at it is the most annoying thing a viewer can do.
    player.addEventListener('click', e => { if (e.target === player) close(); });

    document.addEventListener('keydown', e => {
      if (!player.classList.contains('is-open')) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(index - 1, true); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goTo(index + 1, true); }
    });

    // Filtering while the viewer is open would leave it paging through rows that are
    // no longer on the list behind it.
    window.dkDocsFilterChanged = () => {
      if (player.classList.contains('is-open')) close();
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();

// ════════════════════════════════════════════════════════════════════════
// SpinLog v1.7 | COMMAND CENTER UI
//   Auto-hiding top bar, global search, and the derived home widgets
//   (odometer context, maintenance timeline, next-service projection).
//
//   Service data arrives through the window.dkHomeInsights(payload) hook,
//   which updateHomeServiceInfo() calls after every service-table render.
//   Everything degrades quietly if an element is missing.
//
//   Dark theme only. The odometer is read-only: it reflects the highest
//   odometer logged against a service record, never a manual entry.
// ════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const nf = (n) => Number(n || 0).toLocaleString('en-IN');
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  /** Duke 250 service interval. Deliberately a stated constant rather than
      something inferred from history: this owner services far more often than
      required, so the median observed gap came out near 1,000 km and badly
      under-reported when the next service is actually due. */
  const SERVICE_INTERVAL = { min: 3500, max: 5000 };

  /** "3.5k–5k km" */
  const intervalLabel = () =>
    `${String(SERVICE_INTERVAL.min / 1000).replace(/\.0$/, '')}k–${SERVICE_INTERVAL.max / 1000}k km`;

  /** Past services shown on the rail before the projected node. */
  const RAIL_LENGTH = 3;

  let snapshot = { all: [], services: [], maxOdo: 0, latest: null };

  /* ── date + format helpers ───────────────────────────────────────────── */

  const midnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const dayDiff = (from, to) => Math.round((midnight(to) - midnight(from)) / 86400000);

  function parseDate(value) {
    if (!value) return null;
    const d = new Date(`${value}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const fmtDate = (d) =>
    d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

  /** Days offset relative to today, phrased for a human. */
  function relDays(n) {
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    return n > 0 ? `in ${n} days` : `${Math.abs(n)} days ago`;
  }

  /** Compact duration: 9 d / 3 wk / 7 mo / 1 yr 2 mo. */
  function fmtSpan(days) {
    const d = Math.abs(Math.round(days));
    if (d < 14) return `${d} d`;
    if (d < 60) return `${Math.round(d / 7)} wk`;
    if (d < 365) return `${Math.round(d / 30)} mo`;
    const yr = Math.floor(d / 365);
    const mo = Math.round((d % 365) / 30);
    return mo ? `${yr} yr ${mo} mo` : `${yr} yr`;
  }

  function ordinal(n) {
    const teens = n % 100;
    if (teens >= 11 && teens <= 13) return `${n}th`;
    switch (n % 10) {
      case 1: return `${n}st`;
      case 2: return `${n}nd`;
      case 3: return `${n}rd`;
      default: return `${n}th`;
    }
  }

  function typeIcon(type) {
    const t = String(type || '').toLowerCase();
    if (t.includes('mods')) return 'fa-bolt';
    if (t.includes('showroom')) return 'fa-shop';
    if (t.includes('3rd')) return 'fa-toolbox';
    return 'fa-screwdriver-wrench';
  }

  /* ── 1. Chrome ───────────────────────────────────────────────────────── */

  /* The status chip and search sit inside the hero card now, so they scroll
     away with it and are home-only by construction. That removed the whole
     sticky bar, scroll-direction and per-section visibility layer this file
     used to carry. */
  function revealChrome() {
    const input = $('dkSearchInput');
    if (!input) return;
    // keep the field on screen when "/" focuses it from further down the page
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ── 2. Renderers ────────────────────────────────────────────────────── */

  function renderStatFeet(asc, latest) {
    const odoFoot = $('dkOdoFoot');
    if (odoFoot) {
      odoFoot.classList.remove('is-good', 'is-warn', 'is-bad');
      if (asc.length >= 2) {
        const prev = asc[asc.length - 2];
        const gapKm = (Number(latest.odo) || 0) - (Number(prev.odo) || 0);
        const gapDays = dayDiff(parseDate(prev.date), parseDate(latest.date));
        odoFoot.innerHTML = `<i class="fas fa-arrow-trend-up" aria-hidden="true"></i> `
          + `+${nf(gapKm)} km in ${esc(fmtSpan(gapDays))} since previous service`;
      } else if (latest) {
        odoFoot.textContent = 'Recorded at last service';
      } else {
        odoFoot.textContent = 'Awaiting service data';
      }
    }

    const lastFoot = $('dkLastFoot');
    if (lastFoot) {
      const d = latest ? parseDate(latest.date) : null;
      lastFoot.textContent = d
        ? `${latest.type || 'Service'} · ${relDays(dayDiff(new Date(), d))}`
        : 'No records yet';
    }

    // A #dkNextFoot block sat here, painting a countdown into a third stat card.
    // That card was removed as a duplicate of the Next Service In panel, which
    // owns the same story with a progress bar and a projected timeline node, so
    // the branch was guarded by an `if` that could never be true. The panel is
    // filled by renderNextPanel() and the note by #dkNextNote.
  }

  function renderTimeline(asc) {
    const host = $('dkTimeline');
    if (!host) return;

    if (!asc.length) {
      host.innerHTML = '<p class="dk-timeline-empty">'
        + '<i class="fas fa-circle-info" aria-hidden="true"></i>'
        + ' No service records yet — log your first one to build the timeline.</p>';
      return;
    }

    const latest = asc[asc.length - 1];
    const shown = asc.slice(-RAIL_LENGTH);
    const firstShown = asc.length - shown.length;
    const hidden = firstShown;

    const targetOdo = (Number(latest.odo) || 0) + SERVICE_INTERVAL.max;
    const due = parseDate(latest.next_due);
    const daysLeft = due ? dayDiff(new Date(), due) : null;
    const overdue = daysLeft !== null && daysLeft < 0;

    // An empty slot keeps every column the same height. It must be
    // visibility:hidden rather than absent, otherwise the chip's background
    // shows up as a stray dot under nodes with nothing to report.
    const blankGap = '<span class="dk-tl-gap dk-tl-gap--blank" aria-hidden="true">&nbsp;</span>';

    const nodes = shown.map((s, i) => {
      const date = parseDate(s.date);
      // What actually helps when scanning history is what the visit cost —
      // the old "+720 km in 7 wk" tag restated odometer deltas the reader can
      // already see from the row above.
      const cost = Number(s.cost) || 0;
      const gap = cost > 0
        ? `<span class="dk-tl-gap" title="Spent on this service">`
          + `<i class="fas fa-indian-rupee-sign" aria-hidden="true"></i>`
          + `${nf(cost)}</span>`
        : blankGap;
      return `
        <li class="dk-tl-node is-done" style="--i:${i}">
          <span class="dk-tl-dot"><i class="fas fa-check" aria-hidden="true"></i></span>
          <span class="dk-tl-body">
            <span class="dk-tl-kicker">${esc(ordinal(firstShown + i + 1))} Service</span>
            <span class="dk-tl-odo">${nf(s.odo)} km</span>
            <span class="dk-tl-meta">${esc(fmtDate(date))} · ${esc(s.type || 'Service')}</span>
            ${gap}
          </span>
        </li>`;
    });

    nodes.push(`
      <li class="dk-tl-node ${overdue ? 'is-overdue' : 'is-next'}" style="--i:${shown.length}">
        <span class="dk-tl-dot"><i class="fas ${overdue ? 'fa-triangle-exclamation' : 'fa-screwdriver-wrench'}" aria-hidden="true"></i></span>
        <span class="dk-tl-body">
          <span class="dk-tl-kicker">Next Service</span>
          <span class="dk-tl-odo">~${nf(targetOdo)} km</span>
          <span class="dk-tl-meta">${due ? esc(fmtDate(due)) : 'Not scheduled'} · every ${intervalLabel()}</span>
          ${blankGap}
        </span>
        <span class="dk-tl-flag">${
          daysLeft === null ? 'No date set'
            : overdue ? `${Math.abs(daysLeft)} days overdue`
            : `${daysLeft} days to go`
        }</span>
      </li>`);

    // Segment-aware fill. Every segment joining two completed services is
    // full; only the final segment fills partially, by elapsed time toward the
    // due date. A single percentage across the whole rail (the previous
    // approach) made the fill stop at an arbitrary-looking point.
    const segments = Math.max(1, nodes.length - 1);
    const doneSegments = Math.max(0, nodes.length - 2);
    let currentFrac = 0;
    const lastDate = parseDate(latest.date);
    if (due && lastDate) {
      const total = Math.max(1, dayDiff(lastDate, due));
      currentFrac = Math.max(0, Math.min(1, dayDiff(lastDate, new Date()) / total));
    }
    const pct = Math.max(0, Math.min(100, ((doneSegments + currentFrac) / segments) * 100));

    const more = hidden > 0
      ? `<button type="button" class="dk-tl-more">
           <i class="fas fa-clock-rotate-left" aria-hidden="true"></i>
           ${hidden} earlier service${hidden === 1 ? '' : 's'} in history
         </button>`
      : '';

    host.innerHTML = `
      <div class="dk-tl-inner dk-tl-inview" style="--tl-n:${nodes.length}">
        <span class="dk-tl-track" aria-hidden="true"><span style="--tl-p:${pct.toFixed(1)}%"></span></span>
        <ol class="dk-tl-nodes">${nodes.join('')}</ol>
      </div>${more}`;

    armTimelineReveal(host.querySelector('.dk-tl-inview'));

    host.querySelector('.dk-tl-more')?.addEventListener('click',
      () => go('service', '#service .service-history-panel'));
  }

  /* Timeline reveal.
     The panel is well below the fold, so its rail draw-in and node stagger fire
     on scroll rather than at load. rootMargin extends the root 14% past the
     bottom edge so the class lands just BEFORE the panel is on screen — without
     that lead-in the first animated frame can appear after the panel is already
     visible, which reads as a flicker.
     renderTimeline() replaces the whole subtree, so this re-observes the fresh
     node on every data refresh. */
  const tlRevealObserver = ('IntersectionObserver' in window)
    ? new IntersectionObserver((entries, obs) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-inview');
          obs.unobserve(entry.target);   // one-shot
        }
      }, { threshold: 0, rootMargin: '0px 0px 14% 0px' })
    : null;

  function armTimelineReveal(inner) {
    if (!inner) return;
    // No observer support: the CSS base state is already the finished state, so
    // adding the class immediately just means no entrance animation.
    if (!tlRevealObserver) { inner.classList.add('is-inview'); return; }
    tlRevealObserver.observe(inner);
  }

  function renderNextService(latest) {
    const daysEl = $('dkNextDays');
    const kmEl = $('dkNextKm');
    const daysCell = daysEl?.parentElement;
    const bar = $('dkNextBar');
    const fill = $('dkNextBarFill');
    const note = $('dkNextNote');
    if (!daysEl || !kmEl) return;

    daysCell?.classList.remove('is-overdue');
    bar?.classList.remove('is-overdue');

    if (!latest) {
      daysEl.textContent = '--';
      kmEl.textContent = '--';
      fill?.style.setProperty('--p', '0%');
      bar?.setAttribute('aria-valuenow', '0');
      if (note) note.textContent = 'Log a service to start tracking the interval.';
      return;
    }

    const lastDate = parseDate(latest.date);
    const due = parseDate(latest.next_due);
    const days = due ? dayDiff(new Date(), due) : null;
    const overdue = days !== null && days < 0;

    daysEl.textContent = days === null ? '--' : String(Math.abs(days));
    kmEl.textContent = nf(SERVICE_INTERVAL.max);

    // Progress is time-based: without a live odometer reading, distance
    // covered since the last service is simply not knowable.
    let pct = 0;
    if (due && lastDate) {
      const total = Math.max(1, dayDiff(lastDate, due));
      pct = Math.max(0, Math.min(100, (dayDiff(lastDate, new Date()) / total) * 100));
    }
    fill?.style.setProperty('--p', `${pct.toFixed(1)}%`);
    bar?.setAttribute('aria-valuenow', String(Math.round(pct)));

    if (overdue) {
      daysCell?.classList.add('is-overdue');
      bar?.classList.add('is-overdue');
    }

    if (note) {
      const basis = `service every ${intervalLabel()}`;
      if (days === null) note.textContent = `No date scheduled · ${basis}`;
      else if (overdue) note.textContent = `Was due ${fmtDate(due)} · ${basis}`;
      else note.textContent = `Due ${fmtDate(due)} · ${Math.round(pct)}% elapsed · ${basis}`;
    }
  }

  /**
   * How old she is, in the Vehicle Overview grid. Owned by window.dkVehicle
   * rather than by service data, so this renders correctly on the very first
   * paint — before any Supabase query has come back.
   */
  function renderVehicleAge() {
    const cell = $('dkFactAge');
    if (!cell) return;
    const age = window.dkVehicle?.age?.();
    if (!age) { cell.textContent = '—'; return; }
    cell.textContent = age.label;
    cell.setAttribute('title', `Registered ${age.since} · ${nf(age.totalDays)} days old`);
  }

  /**
   * Age is the one figure on this page that changes without any data changing,
   * so it is refreshed when the app returns to the foreground and again at
   * midnight. Without this an installed PWA left open for a week keeps showing
   * the age it had on the day it was opened.
   */
  function watchVehicleAge() {
    let timer = null;
    const schedule = () => {
      clearTimeout(timer);
      const next = new Date();
      // A few seconds past midnight, so it never fires a moment early and
      // recomputes the same day it just showed.
      next.setHours(24, 0, 30, 0);
      timer = setTimeout(() => { renderVehicleAge(); schedule(); }, Math.max(1000, next - Date.now()));
    };
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) renderVehicleAge();
    });
    schedule();
  }

  /** Re-render every derived home widget from the current snapshot. */
  function render() {
    const services = snapshot.services || [];
    const asc = services.slice().sort((a, b) => parseDate(a.date) - parseDate(b.date));
    const latest = asc.length ? asc[asc.length - 1] : null;

    renderVehicleAge();
    renderStatFeet(asc, latest);
    renderTimeline(asc);
    renderNextService(latest);
    searchIndex = null; // service data changed, rebuild lazily
  }

  /** Hook called by updateHomeServiceInfo() after each service-table render. */
  window.dkHomeInsights = function (payload) {
    snapshot = payload || { all: [], services: [], maxOdo: 0, latest: null };
    render();
  };

  /**
   * Read-only view of the same snapshot, so Sage's AI context builder can see
   * the service data without another Supabase round trip. serviceEntries itself
   * is closure-private and stays that way.
   */
  window.dkGetSnapshot = function () {
    return snapshot || { all: [], services: [], maxOdo: 0, latest: null };
  };

  /* ── 4. Global search ────────────────────────────────────────────────── */

  const SECTIONS = [
    { id: 'home', title: 'Command Center', sub: 'Bike status, timeline and specs', icon: 'fa-house' },
    { id: 'service', title: 'Service Records', sub: 'Log and review maintenance', icon: 'fa-screwdriver-wrench' },
    { id: 'docs', title: 'Documents', sub: 'RC, insurance, PUC and media', icon: 'fa-folder-open' },
    { id: 'sage', title: 'Sage', sub: 'Chat with your bike', icon: 'fa-comment-dots' },
  ];

  let searchIndex = null;
  let activeResult = -1;

  /**
   * Scroll to a target and mark it, so arriving from search says which row it was.
   *
   * The mark was removed once before, and correctly: the only thing using it then was
   * a [data-flash] button sitting on the same page as its own target, so it lit up
   * something already in view and read as an error state. Coming out of search is the
   * opposite case — a different section, a table of twenty rows, and no way to tell
   * which one was meant. So the mark is back, and only for a target the user has
   * actually been carried to.
   *
   * The class is removed on animationend rather than a timer: if the animation is
   * disabled for reduced motion it never fires, so the rule for that case does not
   * animate at all and the class is dropped on a fallback timeout instead.
   */
  const FOUND_CLASS = 'dk-found';
  /** Three pulses at 0.7s each. Keep in step with .dk-found in styles.css. */
  const FOUND_MS = 2100;

  const reduceMotion = window.dkReduceMotion;

  function markFound(el) {
    if (!el) return;
    el.classList.remove(FOUND_CLASS);
    // Reading offsetWidth forces the style change to land, or adding the class back
    // in the same frame is a no-op and a second search for the same row does nothing.
    void el.offsetWidth;
    el.classList.add(FOUND_CLASS);
    const done = () => el.classList.remove(FOUND_CLASS);
    // animationend fires once, after the LAST of the three iterations.
    el.addEventListener('animationend', done, { once: true });
    // Fallback for reduced motion, where there is no animation to end.
    setTimeout(done, FOUND_MS + 400);
  }

  /**
   * Carry the page to an element, smoothly, and then light it up.
   *
   * WHY THIS IS NOT JUST scrollIntoView({ behavior: 'smooth' }).
   *
   * It was, and it juddered. Two reasons, both about timing rather than easing:
   *
   *   · A jump out of search navigates first, and setActiveSection() ends with
   *     `window.scrollTo({ top: 0, behavior: 'auto' })`. flashWhenReady() then calls
   *     this SYNCHRONOUSLY on its first poll when the target already exists, so an
   *     instant scroll to the top and a smooth scroll to the middle of the page were
   *     being issued in the same frame. The browser is entitled to run the second
   *     from wherever the first had got to, and the result was a lurch.
   *
   *   · The incoming section had just gone from display:none to rendered, so its
   *     layout was not final. scrollIntoView resolves its target position once, up
   *     front — and the rows of a service table landing mid-flight moved that
   *     position out from under the animation, so it finished somewhere else and
   *     snapped.
   *
   * Two frames of delay fixes both. The first lets the instant scroll commit; the
   * second lets the new section finish its first layout. Only then is the target
   * measured, which is also why scrollIntoView is still the call — it honours the
   * scroll-margin-top on .dk-found, which is what keeps a marked row from landing
   * underneath the sticky header.
   *
   * THE MARK STARTS WITH THE SCROLL, NOT AFTER IT.
   *
   * It waited for `scrollend` for a while, on the reasoning that three pulses over
   * 2.1s should not be spent travelling. That was right about the old single 2.2s
   * fade, which had nothing left by the time it arrived, and wrong about this one:
   * a 400ms scroll costs the first half of the first pulse and the other two land
   * with the row already still.
   *
   * What it did cost was the thing the whole feature is for. Waiting for scrollend,
   * with a timer behind it for engines that do not fire one, put roughly 800ms
   * between clicking a search result and seeing which row it found — and a jump out
   * of search also waits on the section swap before any of this starts. Two
   * animations queued behind each other read as the app thinking about it.
   *
   * So the highlight is lit as soon as the scroll is under way. Click to feedback is
   * now about 165ms.
   */
  function flash(el, mark) {
    if (!el) return;
    const instant = reduceMotion();

    const arrive = () => {
      if (!el.isConnected) return;
      el.scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'center' });
      if (mark) markFound(el);
    };

    if (instant) { arrive(); return; }
    requestAnimationFrame(() => requestAnimationFrame(arrive));
  }

  /**
   * Find a target that may not exist yet, then scroll to it and mark it.
   *
   * Sections lazy-load their data, so a service row can appear well after the
   * navigation — a fixed delay missed it and nothing happened at all.
   *
   * `reveal` runs once, the first time the target is still missing after a couple of
   * polls: a service table with a filter set does not render the rows it excludes, so
   * the row being searched for may never appear until the filter is dropped. Running
   * it immediately instead would wipe the filters on every jump, including the ones
   * that did not need it.
   */
  function flashWhenReady(selector, { mark = true, reveal = null } = {}, tries = 24) {
    let n = 0;
    let revealed = false;
    const tick = () => {
      const el = document.querySelector(selector);
      // RENDERED, not merely present. `offsetParent` is null for anything inside a
      // `display: none` subtree, which is exactly what a section that has not become
      // active yet is.
      //
      // This used to test `if (el)` alone, and it was correct until the section swap
      // grew a 130ms exit animation. A jump out of search navigates first, so for
      // those 130ms the incoming view is still hidden while its rows are already in
      // the DOM from an earlier visit — so the first poll found the row, called
      // scrollIntoView on an element with no layout box, which does nothing, and then
      // the swap scrolled the page to the top. The row was marked and pulsing
      // somewhere below the fold, which is the one outcome this whole path exists to
      // prevent.
      if (el && el.offsetParent) { flash(el, mark); return; }
      if (!revealed && n === 2 && typeof reveal === 'function') {
        revealed = true;
        reveal();
      }
      if (++n < tries) setTimeout(tick, 120);
    };
    tick();
  }

  function go(sectionId, flashSelector, opts) {
    if (typeof window.dkNavigate === 'function') window.dkNavigate(sectionId);
    if (flashSelector) flashWhenReady(flashSelector, opts);
  }

  /**
   * Any [data-home-section] control may name a target to scroll to on arrival.
   *
   * No mark here. These point at a whole form or a section heading, not at one row
   * among many — "Log Service" scrolls to the entry form, and lighting up a form that
   * already lights its own focused field was the reason the mark was dropped the first
   * time round. Search results are the case that needs it.
   */
  function initNavHighlights() {
    document.querySelectorAll('[data-home-section][data-flash]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sel = btn.getAttribute('data-flash');
        if (sel) flashWhenReady(sel, { mark: false });
      });
    });
  }

  function buildIndex() {
    const items = [];

    SECTIONS.forEach((s) => items.push({
      group: 'Sections', icon: s.icon, title: s.title, sub: s.sub, meta: '',
      hay: `${s.title} ${s.sub} ${s.id}`,
      run: () => go(s.id),
    }));

    (snapshot.all || []).forEach((r) => {
      const d = parseDate(r.date);
      items.push({
        group: 'Service Records',
        icon: typeIcon(r.type),
        // The note is what identifies a record to a human, so it leads; the
        // type and odometer become the supporting line.
        title: r.notes || `${r.type || 'Service'} · ${nf(r.odo)} km`,
        sub: `${r.type || 'Service'} · ${nf(r.odo)} km`,
        meta: d ? fmtDate(d) : '',
        hay: `${r.type || ''} ${r.notes || ''} ${r.odo || ''} ${r.cost || ''} ${r.date || ''} ${r.next_due || ''}`,
        run: () => go(
          'service',
          `.service-record-row[data-record-id="${CSS.escape(String(r.id))}"]`,
          // Clearing the filters is no longer enough on its own: the table pages, so a
          // record can be absent from the DOM because it is on page three. This turns
          // to whichever page holds it. Falls back to the plain filter clear, which is
          // what a build without the pager would have.
          {
            reveal: () => (window.dkShowServiceRecord
              ? window.dkShowServiceRecord(r.id)
              : window.dkClearServiceFilters?.()),
          },
        ),
      });
    });

    // Fact and spec rows are static markup — index them live so the two can
    // never drift apart.
    document.querySelectorAll('#home .dk-fact, #home .dk-spec-list > div').forEach((row) => {
      const label = row.querySelector('dt')?.textContent?.trim();
      const value = row.querySelector('dd')?.textContent?.trim();
      if (!label || !value) return;
      const group = row.classList.contains('dk-fact') ? 'Bike Details' : 'Specifications';
      items.push({
        group,
        icon: group === 'Bike Details' ? 'fa-id-card' : 'fa-gear',
        title: label, sub: value, meta: '',
        hay: `${label} ${value}`,
        // A spec row is one line in a list of six, so it gets the mark for the same
        // reason a service record does.
        run: () => { go('home'); setTimeout(() => flash(row, true), 240); },
      });
    });

    items.forEach((it) => { it.hay = it.hay.toLowerCase(); });
    return items;
  }

  function highlight(text, query) {
    const safe = esc(text);
    if (!query) return safe;
    const i = safe.toLowerCase().indexOf(query.toLowerCase());
    if (i === -1) return safe;
    return safe.slice(0, i) + '<mark>' + safe.slice(i, i + query.length) + '</mark>' + safe.slice(i + query.length);
  }

  function initSearch() {
    const input = $('dkSearchInput');
    const panel = $('dkSearchPanel');
    const clear = $('dkSearchClear');
    if (!input || !panel) return;

    // The full prompt is cut off mid-word once the field shares a row with the
    // status pill on a phone, so trade it for something that fits.
    const FULL_PROMPT = input.getAttribute('placeholder');
    const fitPlaceholder = () => {
      input.setAttribute('placeholder', window.innerWidth < 560 ? 'Search…' : FULL_PROMPT);
    };
    fitPlaceholder();
    window.addEventListener('resize', fitPlaceholder, { passive: true });

    const results = () => Array.from(panel.querySelectorAll('.dk-search-item'));

    function closePanel() {
      // Lifts back toward the field it dropped out of. The aria state flips
      // immediately — a screen reader should be told the listbox is closed now,
      // not in 120ms.
      window.dkSlideShut(panel, 120, { y: '-8px' });
      input.setAttribute('aria-expanded', 'false');
      activeResult = -1;
    }

    function setActive(i) {
      const list = results();
      if (!list.length) return;
      activeResult = (i + list.length) % list.length;
      list.forEach((el, n) => el.classList.toggle('is-active', n === activeResult));
      list[activeResult].scrollIntoView({ block: 'nearest' });
    }

    function run(query) {
      const q = query.trim().toLowerCase();
      if (clear) clear.hidden = !query;
      if (!q) { closePanel(); return; }
      if (!searchIndex) searchIndex = buildIndex();

      const hits = searchIndex.filter((it) => it.hay.includes(q)).slice(0, 24);

      if (!hits.length) {
        panel.innerHTML = `<p class="dk-search-empty">Nothing matches “${esc(query)}”.</p>`;
      } else {
        const groups = new Map();
        hits.forEach((h) => {
          if (!groups.has(h.group)) groups.set(h.group, []);
          groups.get(h.group).push(h);
        });

        let html = '';
        groups.forEach((list, name) => {
          html += `<div class="dk-search-group"><p class="dk-search-group-title">${esc(name)}</p>`;
          list.forEach((h) => {
            html += `<button type="button" class="dk-search-item" role="option" aria-selected="false">
              <i class="fas ${h.icon}" aria-hidden="true"></i>
              <span class="dk-search-main">
                <strong>${highlight(h.title, query.trim())}</strong>
                <small>${highlight(h.sub, query.trim())}</small>
              </span>
              ${h.meta ? `<span class="dk-search-meta">${esc(h.meta)}</span>` : ''}
            </button>`;
          });
          html += '</div>';
        });
        panel.innerHTML = html;

        // render order is flat group order, so indexes map straight through
        const ordered = [];
        groups.forEach((list) => list.forEach((h) => ordered.push(h)));
        results().forEach((btn, i) => {
          btn.addEventListener('click', () => {
            closePanel();
            input.value = '';
            if (clear) clear.hidden = true;
            ordered[i].run();
          });
        });
      }

      window.dkSlideOpen(panel, 170, { y: '-8px' });
      input.setAttribute('aria-expanded', 'true');
      activeResult = -1;
    }

    let debounce = 0;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => run(input.value), 110);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeResult + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeResult - 1); }
      else if (e.key === 'Enter') {
        const list = results();
        if (activeResult >= 0 && list[activeResult]) { e.preventDefault(); list[activeResult].click(); }
      } else if (e.key === 'Escape') {
        if (!panel.hidden) { e.preventDefault(); closePanel(); }
        else { input.value = ''; if (clear) clear.hidden = true; input.blur(); }
      }
    });

    input.addEventListener('focus', () => { if (input.value.trim()) run(input.value); });

    clear?.addEventListener('click', () => {
      input.value = '';
      clear.hidden = true;
      closePanel();
      input.focus();
    });

    document.addEventListener('click', (e) => {
      if (!panel.hidden && !panel.contains(e.target) && e.target !== input) closePanel();
    });

    // "/" focuses search, the way most dashboards behave
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      e.preventDefault();
      revealChrome();
      input.focus();
      input.select();
    });
  }

  /* ── 5. Boot ─────────────────────────────────────────────────────────── */

  function boot() {
    initSearch();
    initNavHighlights();
    render(); // paint empty states now; real data arrives via dkHomeInsights
    watchVehicleAge();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
