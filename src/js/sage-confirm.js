// ════════════════════════════════════════════════════════════════════════
// SPINLOG — SLIDE TO CONFIRM
//
// One destructive-action confirmation for the whole app.
//
// It replaces a press-and-hold button that had three problems: holding gives no
// sense of progress until a countdown appears, a stray mouseleave silently
// cancelled it, and the old dialog was built by injecting markup into the
// generic loading popup — so the confirm and the "saving…" spinner shared one
// element and could fight over it.
//
// A slide is better suited to the job. It is deliberate, it cannot happen from a
// single stray tap, the thumb's position IS the progress indicator, and it works
// the same with a mouse, a finger and a keyboard.
//
// Usage is a promise, so callers read as prose:
//
//   if (await SageConfirm.slide({ title: 'Delete this record?' })) { … }
//
// The legacy confirmDeleteWithHold(message, onConfirm) signature is kept as a
// shim, because script.js calls it from several places and the callback style is
// not worth churning.
// ════════════════════════════════════════════════════════════════════════

(function (root) {
  'use strict';

  // How far along the track counts as committed. Not 100%: the thumb has width,
  // and demanding the last pixel makes the control feel broken on a short track.
  const COMMIT_AT = 0.92;
  // Below this, release springs back rather than committing.
  const SPRING_BACK_MS = 260;
  const CLOSE_DELAY_MS = 260;

  let open = null;      // { overlay, resolve } while a dialog is up

  function reduceMotion() {
    try {
      return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
      return false;
    }
  }

  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * Ask the user to slide before doing something irreversible.
   *
   * @param {object} [options]
   * @param {string} [options.title]     One line. What is about to happen.
   * @param {string} [options.message]   Optional detail. HTML is NOT allowed —
   *   every caller passes user or database text, so it is escaped.
   * @param {string} [options.html]      Escape hatch for the legacy callers that
   *   already pass markup. Used verbatim; never hand it untrusted text.
   * @param {string} [options.label]     Track label. Default 'Slide to delete'.
   * @param {string} [options.confirmed] Shown once committed. Default 'Deleting…'
   * @param {string} [options.icon]      Font Awesome name for the thumb.
   * @returns {Promise<boolean>} true when slid, false when cancelled or dismissed
   */
  function slide(options) {
    const opts = options || {};
    // Only one at a time. A second request cancels the first rather than
    // stacking two overlays nobody can tell apart.
    if (open) dismiss(false);

    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'sl-slide-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'slSlideTitle');

      const label = opts.label || 'Slide to delete';
      const detail = opts.html || (opts.message ? esc(opts.message) : '');

      overlay.innerHTML = `
        <div class="sl-slide-card" role="document">
          <span class="sl-slide-mark" aria-hidden="true">
            <i class="fas ${esc(opts.icon || 'fa-trash-can')}"></i>
          </span>
          <h3 class="sl-slide-title" id="slSlideTitle">${esc(opts.title || 'Delete this?')}</h3>
          ${detail ? `<p class="sl-slide-copy">${detail}</p>` : ''}

          <div class="sl-slide-track" id="slSlideTrack">
            <span class="sl-slide-fill" aria-hidden="true"></span>
            <span class="sl-slide-label" aria-hidden="true">${esc(label)}</span>
            <button type="button" class="sl-slide-thumb" id="slSlideThumb"
                    role="slider" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"
                    aria-label="${esc(label)}. Slide right, or use the arrow keys.">
              <i class="fas fa-angles-right" aria-hidden="true"></i>
            </button>
          </div>

          <button type="button" class="sl-slide-cancel" id="slSlideCancel">Cancel</button>
        </div>`;

      document.body.appendChild(overlay);
      open = { overlay, resolve, done: false };

      const track = overlay.querySelector('#slSlideTrack');
      const thumb = overlay.querySelector('#slSlideThumb');
      const fill = overlay.querySelector('.sl-slide-fill');
      const labelEl = overlay.querySelector('.sl-slide-label');

      let dragging = false;
      let progress = 0;

      const span = () => Math.max(1, track.clientWidth - thumb.offsetWidth - 8);

      function paint(p) {
        progress = Math.min(1, Math.max(0, p));
        const x = progress * span();
        thumb.style.transform = `translateX(${x}px)`;
        fill.style.width = `${(progress * 100).toFixed(1)}%`;
        thumb.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
        // The label fades as the thumb covers it, rather than being slid over.
        labelEl.style.opacity = String(Math.max(0, 1 - progress * 1.6));
        overlay.classList.toggle('is-armed', progress >= COMMIT_AT);
      }

      function springBack() {
        thumb.style.transition = `transform ${SPRING_BACK_MS}ms cubic-bezier(.22,1.4,.36,1)`;
        fill.style.transition = `width ${SPRING_BACK_MS}ms ease-out`;
        paint(0);
        setTimeout(() => { thumb.style.transition = ''; fill.style.transition = ''; }, SPRING_BACK_MS);
      }

      function commit() {
        if (open && open.done) return;
        open.done = true;
        overlay.classList.add('is-confirmed');
        paint(1);
        thumb.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i>';
        labelEl.textContent = opts.confirmed || 'Deleting…';
        labelEl.style.opacity = '1';
        thumb.disabled = true;
        // A beat so the confirmation is legible rather than a flash.
        setTimeout(() => finish(true), reduceMotion() ? 0 : CLOSE_DELAY_MS);
      }

      function move(clientX) {
        const rect = track.getBoundingClientRect();
        paint((clientX - rect.left - thumb.offsetWidth / 2) / span());
      }

      function onDown(ev) {
        if (open && open.done) return;
        dragging = true;
        thumb.setPointerCapture?.(ev.pointerId);
        thumb.style.transition = '';
        fill.style.transition = '';
        overlay.classList.add('is-dragging');
        ev.preventDefault();
      }

      function onMove(ev) {
        if (!dragging) return;
        move(ev.clientX);
      }

      function onUp() {
        if (!dragging) return;
        dragging = false;
        overlay.classList.remove('is-dragging');
        if (progress >= COMMIT_AT) commit();
        else springBack();
      }

      thumb.addEventListener('pointerdown', onDown);
      thumb.addEventListener('pointermove', onMove);
      thumb.addEventListener('pointerup', onUp);
      thumb.addEventListener('pointercancel', onUp);

      // Keyboard: the thumb is a real slider, so arrows move it and reaching the
      // end commits. Holding a key down is not required.
      thumb.addEventListener('keydown', ev => {
        if (open && open.done) return;
        const step = ev.shiftKey ? 0.5 : 0.2;
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') {
          ev.preventDefault();
          paint(progress + step);
          if (progress >= COMMIT_AT) commit();
        } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') {
          ev.preventDefault();
          paint(progress - step);
        } else if (ev.key === 'End') {
          ev.preventDefault();
          paint(1);
          commit();
        } else if (ev.key === 'Home') {
          ev.preventDefault();
          paint(0);
        } else if (ev.key === 'Enter' || ev.key === ' ') {
          // Enter only commits once the slider is already at the end, so it can
          // never be the single keypress that deletes something.
          ev.preventDefault();
          if (progress >= COMMIT_AT) commit();
        }
      });

      overlay.querySelector('#slSlideCancel').addEventListener('click', () => finish(false));
      overlay.addEventListener('click', ev => { if (ev.target === overlay) finish(false); });

      // Capture phase, and Escape and Tab are swallowed.
      //
      // This dialog opens on top of whatever asked for it, and the app has a
      // document-level Escape handler for nearly every layer it can open over:
      // the settings dialog, the loading popup, the media modals, the mobile
      // menu. Listening in the bubble phase meant one Escape cancelled the
      // slide AND closed the thing behind it. Tab was worse — the settings
      // dialog's own focus trap pulled focus straight back out of the dialog
      // asking the question.
      //
      // Only those two keys are stopped. Everything else, the arrow keys in
      // particular, still reaches the thumb's own handler below.
      document.addEventListener('keydown', onKeys, true);

      function onKeys(ev) {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopPropagation();
          finish(false);
          return;
        }
        if (ev.key !== 'Tab') return;
        ev.stopPropagation();

        // Keep focus in the dialog.
        const stops = overlay.querySelectorAll('button:not([disabled])');
        if (!stops.length) return;
        const first = stops[0];
        const last = stops[stops.length - 1];
        // Focus may be outside the dialog entirely — the element that had it
        // when this opened is still in the page behind the overlay.
        if (!overlay.contains(document.activeElement)) {
          ev.preventDefault();
          (ev.shiftKey ? last : first).focus();
          return;
        }
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
      }

      function finish(result) {
        document.removeEventListener('keydown', onKeys, true);
        overlay.classList.add('is-leaving');
        const remove = () => {
          overlay.remove();
          if (open && open.overlay === overlay) open = null;
          resolve(!!result);
        };
        if (reduceMotion()) remove();
        else setTimeout(remove, 160);
      }

      open.finish = finish;

      // Paint after layout so the track width is real.
      requestAnimationFrame(() => {
        overlay.classList.add('is-open');
        paint(0);
        thumb.focus({ preventScroll: true });
      });
    });
  }

  /** Close whatever is open, resolving it with `result`. */
  function dismiss(result) {
    if (open && open.finish) open.finish(!!result);
  }

  function isOpen() {
    return !!open;
  }

  root.SageConfirm = { slide, dismiss, isOpen, COMMIT_AT };

  /**
   * The old callback signature, kept so script.js's delete paths do not have to
   * change shape. `message` is existing trusted markup from those call sites.
   *
   * The third argument is new and optional: it lets a caller name what is being
   * deleted in the heading instead of every dialog in the app asking the same
   * anonymous "Delete this?".
   *
   * @param {string} message           Trusted markup shown as the detail line.
   * @param {Function} [onConfirm]     Called only when the slide completes.
   * @param {object} [options]         {title, label, confirmed, icon}
   * @returns {Promise<boolean>}
   */
  root.confirmDeleteWithHold = function (message, onConfirm, options) {
    const opts = options || {};
    return slide({
      title: opts.title || 'Delete this?',
      html: message,
      label: opts.label || 'Slide to delete',
      confirmed: opts.confirmed,
      icon: opts.icon,
    }).then(ok => {
      if (ok && typeof onConfirm === 'function') onConfirm();
      return ok;
    });
  };
  // Named for what it now does; the old name stays as the alias.
  root.confirmDeleteWithSlide = root.confirmDeleteWithHold;
})(typeof self !== 'undefined' ? self : this);
