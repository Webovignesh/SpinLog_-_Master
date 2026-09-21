// ════════════════════════════════════════════════════════════════════════
// SPINLOG — WHOLE-APP AUDIT
//
// Runs the real app in real Chromium and asserts the things that are true of the
// app as a whole rather than of one section's layout. audit-mobile.mjs measures
// the service and documents lists at phone size; this one drives every view and
// every control, then checks the invariants that hold everywhere.
//
// ── Why this exists, and what it caught ─────────────────────────────
// audit-refs proves every path resolves. audit-boot proves the scripts evaluate
// in one global without colliding. audit-mobile proves the two long lists lay
// out. None of them opens a dialog, presses a button or reads a colour, and every
// fault below got through all three:
//
//   · `onKeydown()` in sage-ui.js read `e.memPick` without ever calling
//     `cache()`, so every Escape and every Tab in the settings dialog threw
//     ReferenceError inside a listener, where nothing was watching. Escape did
//     not close the dialog and the focus trap did not exist. Caught by opening
//     the dialog and pressing Escape.
//   · Routing is `display: none` on the outgoing section, and the button you
//     pressed is inside it — so focus landed on <body> and the next Tab restarted
//     from the top of the document. Caught by reading document.activeElement
//     after a navigation.
//   · `--dk-text-mute` measured 4.46:1 against the panel it is always used on.
//     AA wants 4.5. Eighty more text colours sat below the floor. Caught by
//     computing the ratios rather than trusting the palette.
//   · An unguarded `getElementById('serviceEntryForm').addEventListener`, which
//     throws during evaluation and takes out every section of the closure below
//     it. audit-boot reported it as an expected missing-DOM TypeError.
//
// ── Running it ──────────────────────────────────────────────────────
//   npm i --no-save playwright@1.49.1
//   npx playwright install chromium
//   node tools/audit-app.mjs
//
// NOTHING IS WRITTEN TO THE DATABASE. Every non-GET request to Supabase is
// answered locally, so this is safe to run against the live project. GETs go
// through, because rendering against real rows is the point — an audit against an
// empty table checks the empty states and nothing else.
//
// Playwright is not a dependency of the app. Without it this exits 0 with
// instructions, like audit-mobile does, so it can sit in a hook.
// ════════════════════════════════════════════════════════════════════════

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('· playwright is not installed, so the app audit was skipped.');
  console.log('  npm i --no-save playwright@1.49.1 && npx playwright install chromium');
  process.exit(0);
}

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  try {
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const SECTIONS = ['home', 'service', 'docs', 'sage'];

/**
 * "Is this element actually on the screen right now", as a string of JS to inject.
 *
 * `offsetParent !== null` was the whole test, and it was enough for exactly as long
 * as everything closed in this app closed with `display: none`. The overlays hide
 * with `visibility: hidden` now — that is what lets them animate out — and
 * visibility does not affect layout, so `offsetParent` is still a live element and
 * every control inside a shut dialog started looking measurable.
 *
 * It produced two very convincing false failures: the notes sheet's Save button
 * reported 1.04:1 because the sheet was not painted, so the pixel sampler read the
 * page behind it and compared that against the button's own dark label; and five
 * controls inside the closed sheet and the closed media viewer reported no focus
 * state, which says nothing about them either way while they cannot be reached.
 *
 * Checking `visibility` on the element covers the ancestors for free — it inherits,
 * and a child of a hidden parent computes to hidden unless it explicitly opts back
 * in. `opacity` is walked separately because it does NOT inherit, and a
 * fully-transparent ancestor is just as unmeasurable.
 */
const IS_SHOWN = `(el => {
  if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return false;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
  if (cs.display === 'none') return false;
  if (cs.contentVisibility === 'hidden') return false;
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
    const p = getComputedStyle(n);
    if (p.display === 'none' || p.visibility === 'hidden') return false;
    if (parseFloat(p.opacity) === 0) return false;
    if (n.hasAttribute('hidden')) return false;
    if (n.getAttribute('aria-hidden') === 'true' && n !== el) return false;
  }
  return true;
})`;

let pass = 0;
let fail = 0;
function ok(label, good, extra) {
  if (good) { pass += 1; return; }
  fail += 1;
  console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`);
}

/**
 * Read-only against the database.
 *
 * A signed-URL request is a POST to /storage/v1/object/sign but it creates
 * nothing and is needed for a thumbnail to render, so it goes through. Everything
 * else that is not a GET is answered here.
 */
async function readOnlySupabase(ctx) {
  await ctx.route('**://*.supabase.co/**', async route => {
    const req = route.request();
    const m = req.method();
    if (m === 'GET' || m === 'HEAD') return route.continue();
    if (/\/storage\/v1\/object\/sign/.test(req.url())) return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

/** Wait for the app to have finished its opening round of reads. */
async function settle(page, ms = 5200) {
  await page.waitForTimeout(ms);
}

async function goToSection(page, section) {
  await page.evaluate(s => {
    if (typeof window.dkNavigate === 'function') window.dkNavigate(s);
    else { location.hash = '#' + s; window.dispatchEvent(new HashChangeEvent('hashchange')); }
  }, section);
  await page.waitForTimeout(650);
}

const browser = await chromium.launch();

// ════════════════════════════════════════════════════════════════════════
// 1  BOOT, GLOBALS, STRUCTURE, ACCESSIBLE WIRING
// ════════════════════════════════════════════════════════════════════════
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await readOnlySupabase(ctx);

  const pageErrors = [];
  const consoleErrors = [];
  const badRequests = [];
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e).split('\n')[0]));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('requestfailed', r => {
    // An aborted request is usually the app's own timeout, not a broken URL.
    const err = r.failure()?.errorText || '';
    if (/ABORTED/i.test(err)) return;
    badRequests.push(`${err} ${r.url().slice(0, 120)}`);
  });
  page.on('response', r => {
    if (r.status() >= 400 && r.url().startsWith(BASE)) badRequests.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`);
  });

  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  await settle(page);

  ok('the app boots with no uncaught error', pageErrors.length === 0, pageErrors.join(' | '));
  ok('and nothing logs to console.error', consoleErrors.length === 0, consoleErrors.join(' | '));
  ok('and every local asset it asks for exists', badRequests.length === 0, [...new Set(badRequests)].join(' | '));

  // ── every module published what the others look up ──────────────────
  // These are classic scripts sharing one global. A missing name here is a file
  // that threw halfway through, which presents as a feature that silently is not
  // there rather than as an error.
  const EXPECTED = {
    dkAppVersion: 'string', dkPager: 'function', dkNavigate: 'function',
    dkCloudStore: 'object', dkCoverStore: 'object', dkDatePicker: 'object',
    dkBillMerge: 'object', supabaseClient: 'object',
    SageConfirm: 'object', SageScheduler: 'object', SageMemory: 'object',
    SageTools: 'object', SageAI: 'object', SageKeyVault: 'object',
    SageAutofill: 'object', SageUI: 'object',
    confirmDeleteWithHold: 'function',
  };
  const globals = await page.evaluate(names => {
    const out = {};
    for (const n of names) out[n] = typeof window[n];
    return out;
  }, Object.keys(EXPECTED));
  for (const [name, want] of Object.entries(EXPECTED)) {
    ok(`window.${name} is published`, globals[name] === want, `got ${globals[name]}`);
  }

  // ── structure ───────────────────────────────────────────────────────
  const struct = await page.evaluate(() => {
    const dup = new Map();
    for (const el of document.querySelectorAll('[id]')) dup.set(el.id, (dup.get(el.id) || 0) + 1);

    const dangling = [];
    for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns']) {
      for (const el of document.querySelectorAll(`[${attr}]`)) {
        for (const id of (el.getAttribute(attr) || '').split(/\s+/).filter(Boolean)) {
          if (!document.getElementById(id)) dangling.push(`${el.tagName.toLowerCase()}#${el.id || '?'} ${attr}=${id}`);
        }
      }
    }

    const iconsWithoutAria = [...document.querySelectorAll('i[class*="fa-"]')]
      .filter(i => i.getAttribute('aria-hidden') !== 'true' && !i.closest('[aria-hidden="true"]')).length;

    return {
      dupIds: [...dup].filter(([, n]) => n > 1).map(([id, n]) => `${id}×${n}`),
      dangling,
      sections: [...document.querySelectorAll('main section')].map(s => s.id),
      h1: document.querySelectorAll('h1').length,
      h1Text: document.querySelector('h1')?.textContent.trim() || '',
      description: (document.querySelector('meta[name="description"]')?.content || '').trim().length,
      version: (document.querySelector('meta[name="version"]')?.content || '').trim(),
      lang: document.documentElement.lang,
      imgNoAlt: [...document.querySelectorAll('img')].filter(i => i.getAttribute('alt') === null).length,
      iconsWithoutAria,
      // A section heading must be reachable by focus for the routing fix below.
      headings: [...document.querySelectorAll('main section')].map(s => !!s.querySelector('h2, h3')),
    };
  });

  ok('no id is used twice', struct.dupIds.length === 0, struct.dupIds.join(' '));
  ok('every aria reference points at an element that exists', struct.dangling.length === 0, struct.dangling.join(' | '));
  ok('the four routed sections are all present',
    SECTIONS.every(s => struct.sections.includes(s)) && struct.sections.length === SECTIONS.length,
    struct.sections.join(','));
  ok('the document has exactly one h1', struct.h1 === 1, `found ${struct.h1}`);
  ok('and it names the app', /spinlog/i.test(struct.h1Text), struct.h1Text);
  ok('there is a meta description', struct.description > 30, `${struct.description} chars`);
  ok('the version meta is set', /^\d+\.\d+\.\d+$/.test(struct.version), struct.version);
  ok('<html> declares a language', struct.lang === 'en', struct.lang);
  ok('every img has an alt attribute', struct.imgNoAlt === 0, `${struct.imgNoAlt} without`);
  ok('every decorative icon is hidden from assistive tech', struct.iconsWithoutAria === 0,
    `${struct.iconsWithoutAria} exposed`);
  ok('every section opens with a heading', struct.headings.every(Boolean));

  // ── the service worker registers ────────────────────────────────────
  const sw = await page.evaluate(async () => {
    if (!navigator.serviceWorker) return 'unsupported';
    const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
    return reg ? (reg.scope.endsWith('/') ? 'root-scope' : reg.scope) : 'none';
  });
  ok('the service worker registers at the root scope', sw === 'root-scope', sw);

  // ── the version on screen is the version in the meta tag ────────────
  const shown = await page.evaluate(() => [...document.querySelectorAll('[data-app-version]')].map(e => e.textContent.trim()));
  ok('the build number on screen matches the meta tag',
    shown.length > 0 && shown.every(t => t === `v${struct.version}`), shown.join(','));

  // ════════════════════════════════════════════════════════════════════
  // 2  ROUTING
  // ════════════════════════════════════════════════════════════════════
  for (const s of SECTIONS) {
    // Leave first, so this is a real change of section. Navigating to the section
    // you are already on deliberately does NOT move focus — see the next check —
    // and home is the section the app boots on.
    await goToSection(page, s === 'home' ? 'service' : 'home');
    await goToSection(page, s);
    const state = await page.evaluate(sec => {
      const root = document.getElementById(sec);
      // Whatever the router actually focused — the heading, unless the section
      // moves focus somewhere better of its own accord, as #sage does.
      const focused = root?.contains(document.activeElement) ? document.activeElement : null;
      const cs = focused ? getComputedStyle(focused) : null;
      const ringed = !!cs && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
      return {
        active: root?.classList.contains('active'),
        onlyOne: [...document.querySelectorAll('main section.active')].length,
        hash: location.hash,
        // Focus must not be left on the element that just stopped being rendered.
        focusInSection: root?.contains(document.activeElement),
        // A ring is correct on a real control, and wrong on the heading the
        // router focused only so that Tab carries on from the right place.
        headingOutline: !(ringed && /^H[1-6]$/.test(focused.tagName)),
        outline: cs ? `${cs.outlineStyle} ${cs.outlineWidth}` : 'n/a',
      };
    }, s);
    ok(`routing to ${s} activates it`, state.active === true);
    ok(`and only ${s} is active`, state.onlyOne === 1, `${state.onlyOne} active`);
    ok(`and the hash says ${s}`, state.hash === `#${s}`, state.hash);
    ok(`and focus moves into ${s} rather than being dropped on <body>`,
      state.focusInSection === true, `activeElement left outside ${s}`);
    // ...and does so INVISIBLY. Chromium matches :focus-visible on a
    // programmatically focused [tabindex="-1"], so without an author rule the UA
    // draws a 1px box round the section heading on every navigation.
    ok(`and draws no focus ring on the ${s} heading`, state.headingOutline === true,
      `outline: ${state.outline}`);
  }

  // Re-selecting the section you are on must not steal focus from a control.
  await page.evaluate(() => {
    document.getElementById('sageChatInput')?.focus();
    window.dkNavigate?.('sage');
  });
  await page.waitForTimeout(300);
  ok('re-selecting the current section leaves focus where it was',
    await page.evaluate(() => document.activeElement?.id === 'sageChatInput'
      // No chat input in this build is not a failure of this rule.
      || !document.getElementById('sageChatInput')));

  // A reload on a deep link restores that section.
  await page.goto(BASE + '#docs', { waitUntil: 'load' });
  await settle(page, 4200);
  ok('a reload on #docs comes back on #docs',
    await page.evaluate(() => document.getElementById('docs')?.classList.contains('active')) === true);

  // ════════════════════════════════════════════════════════════════════
  // 3  EVERY CONTROL, PRESSED
  // ════════════════════════════════════════════════════════════════════
  //
  // Each step is followed by a check that nothing threw. A control that throws
  // inside its own listener leaves no trace on screen — the second bug in the
  // header was exactly this shape.
  async function press(label, fn) {
    const before = pageErrors.length;
    try { await fn(); } catch (e) { ok(label, false, String(e).split('\n')[0].slice(0, 120)); return; }
    await page.waitForTimeout(380);
    ok(label, pageErrors.length === before, pageErrors.slice(before).join(' | '));
  }

  await goToSection(page, 'service');
  await press('the service type menu opens', () => page.evaluate(() => document.getElementById('serviceTypeButton')?.click()));
  await press('and a type can be chosen', () => page.evaluate(() =>
    document.querySelector('#serviceTypeMenu [data-value="Showroom"]')?.click()));
  await press('the service history filters open', () => page.evaluate(() =>
    document.getElementById('serviceHistoryFilterToggle')?.click()));
  await press('the service search accepts a keystroke', () => page.evaluate(() => {
    const i = document.getElementById('serviceHistorySearch');
    if (!i) throw new Error('#serviceHistorySearch is missing');
    i.value = 'zzzz-no-match'; i.dispatchEvent(new Event('input', { bubbles: true }));
  }));
  await press('and the filters can be cleared', () => page.evaluate(() =>
    document.getElementById('serviceHistoryClearFilters')?.click()));
  await press('submitting the empty form reports what is missing', () => page.evaluate(() =>
    document.getElementById('serviceEntryForm')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))));
  ok('and that report is a popup, not a browser dialog',
    await page.evaluate(() => document.getElementById('customPopup')?.classList.contains('show')) === true);
  // The popup must be a centred overlay. It lost position:fixed once and became a
  // flex sibling of .container, which squeezed the whole page narrow.
  const popupBox = await page.evaluate(() => {
    const p = document.getElementById('customPopup');
    if (!p) return null;
    const cs = getComputedStyle(p);
    const b = p.getBoundingClientRect();
    return { pos: cs.position, w: Math.round(b.width), h: Math.round(b.height), vw: innerWidth };
  });
  ok('the popup overlay is fixed and covers the viewport',
    !!popupBox && popupBox.pos === 'fixed' && popupBox.w >= popupBox.vw - 1, JSON.stringify(popupBox));
  await press('and it closes', () => page.evaluate(() => window.hidePopup?.()));

  await goToSection(page, 'docs');
  await press('the document filters open', () => page.evaluate(() =>
    document.getElementById('docsHistoryFilterToggle')?.click()));
  await press('the document search accepts a keystroke', () => page.evaluate(() => {
    const i = document.getElementById('docsHistorySearch');
    if (!i) throw new Error('#docsHistorySearch is missing');
    i.value = 'zzzz-no-match'; i.dispatchEvent(new Event('input', { bubbles: true }));
  }));
  await press('and those filters can be cleared', () => page.evaluate(() =>
    document.getElementById('docsHistoryClearFilters')?.click()));
  await press('the uploaded column sorts', () => page.evaluate(() =>
    document.getElementById('docsHistorySort')?.click()));
  await press('the page size can be changed', () => page.evaluate(() => {
    const s = document.getElementById('docsHistoryPerPage');
    if (!s) return;
    s.value = '25'; s.dispatchEvent(new Event('change', { bubbles: true }));
  }));

  await goToSection(page, 'home');
  await press('the park card responds to a press', () => page.evaluate(() => {
    const c = document.getElementById('parkCardMobile');
    if (!c) throw new Error('#parkCardMobile is missing');
    c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 8, clientY: 8 }));
    c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 8, clientY: 8 }));
  }));
  await press('and the park sheet closes again', () => page.evaluate(() => {
    document.getElementById('parkClose')?.click();
    document.getElementById('parkSheetClose')?.click();
  }));
  await press('the health card refreshes', () => page.evaluate(() =>
    document.getElementById('sageHealthRefresh')?.click()));

  // ── the one destructive dialog ──────────────────────────────────────
  await press('the slide-to-delete dialog opens', () => page.evaluate(() => {
    window.__slide = window.SageConfirm.slide({ title: 'Audit probe' });
  }));
  ok('and it is on screen', await page.evaluate(() => !!document.querySelector('.sl-slide-overlay')) === true);
  ok('and it reports itself open', await page.evaluate(() => window.SageConfirm.isOpen() === true));
  await press('and Escape cancels it', async () => {
    await page.keyboard.press('Escape');
  });
  ok('and it is gone', await page.evaluate(() => !document.querySelector('.sl-slide-overlay')) === true);
  ok('and it resolved false rather than hanging',
    await page.evaluate(() => window.__slide.then(v => v === false)) === true);

  // ── the settings dialog, by keyboard ────────────────────────────────
  // This is the check that found the missing cache() call. Opening the dialog was
  // never the problem; pressing a key in it was.
  await goToSection(page, 'sage');
  await press('the settings dialog opens', () => page.evaluate(() => window.SageUI?.open?.()));
  ok('and it reports itself open', await page.evaluate(() => window.SageUI?.isOpen?.() === true));
  await press('Tab is trapped inside it', async () => {
    for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
  });
  ok('and focus never leaves the dialog',
    await page.evaluate(() => {
      const modal = document.querySelector('.sl-modal--open');
      return !!modal && modal.contains(document.activeElement);
    }) === true);
  await press('its tabs all switch', () => page.evaluate(() =>
    document.querySelectorAll('.sage-set-tab').forEach(t => t.click())));
  await press('and Escape closes it', () => page.keyboard.press('Escape'));
  ok('and it is closed', await page.evaluate(() => window.SageUI?.isOpen?.() === false));

  ok('no control threw across the whole crawl', pageErrors.length === 0, pageErrors.join(' | '));

  // ════════════════════════════════════════════════════════════════════
  // 3b  BACK CLOSES WHAT IS ON TOP
  // ════════════════════════════════════════════════════════════════════
  //
  // On a phone the back gesture is the primary way out of anything, and with a
  // dialog open it used to go back a PAGE and leave the dialog sitting over the
  // section it had just arrived at. On the last entry in the stack it closed the
  // installed app outright with a modal still up.
  //
  // Three things have to hold, and the third is the one that broke first: an
  // overlay must absorb the press, a press with nothing open must still navigate,
  // and closing a surface that ALSO navigates must not undo the navigation.
  {
    const guard = () => page.evaluate(() => ({
      ...(window.dkBackGuardState || {}),
      section: document.querySelector('main section.active')?.id,
      overlay: !!(document.querySelector('.sl-modal-overlay.sl-modal--open')
        || document.querySelector('#docs .docs-modal.show')
        || document.querySelector('.docs-player.is-open')
        || document.querySelector('.sl-slide-overlay:not(.is-leaving)')),
    }));

    ok('the back guard is running', await page.evaluate(() => typeof window.dkBackGuardState) === 'object');

    // ── a dialog absorbs the press ──
    await goToSection(page, 'home');
    await press('a cover card opens its editor', () => page.evaluate(() =>
      document.querySelector('.dk-cover-card')?.click()));
    let g = await guard();
    ok('and the guard takes a history entry for it', g.overlay === true && g.held === true,
      JSON.stringify(g));
    await page.goBack();
    await page.waitForTimeout(650);
    g = await guard();
    ok('back shuts the dialog', g.overlay === false, JSON.stringify(g));
    ok('and does not leave the page it was over', g.section === 'home', String(g.section));

    // ── with nothing open, back still navigates ──
    await goToSection(page, 'service');
    await page.goBack();
    await page.waitForTimeout(700);
    ok('with nothing open, back still moves between sections',
      await page.evaluate(() => document.querySelector('main section.active')?.id) !== 'service');

    // ── the slide dialog resolves rather than hanging ──
    await goToSection(page, 'home');
    await page.evaluate(() => { window.__backProbe = window.SageConfirm.slide({ title: 'Back probe' }); });
    await page.waitForTimeout(450);
    ok('the slide dialog takes an entry too',
      (await guard()).held === true);
    await page.goBack();
    await page.waitForTimeout(650);
    ok('back cancels it', (await guard()).overlay === false);
    // A dialog closed without resolving its promise leaves every caller awaiting
    // it for ever, which is worse than the dialog staying up.
    ok('and resolves it false rather than leaving the promise pending',
      await page.evaluate(() => window.__backProbe.then(v => v === false)) === true);

    // ── a surface that closes BY navigating must not lose the navigation ──
    //
    // Picking a search result shuts the panel and then jumps to a section, in that
    // order. The guard's entry is spent by a MutationObserver microtask, which runs
    // AFTER the click handler — so spending it unconditionally popped the section
    // that had just been pushed and the jump appeared to pick the wrong page.
    await goToSection(page, 'home');
    const jumped = await page.evaluate(async () => {
      const i = document.getElementById('dkSearchInput');
      if (!i) return { skip: true };
      i.value = 'service';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 450));
      const items = [...document.querySelectorAll('#dkSearchPanel .dk-search-item')];
      if (!items.length) return { skip: true };
      items[0].click();
      await new Promise(r => setTimeout(r, 900));
      return { section: document.querySelector('main section.active')?.id };
    });
    ok('choosing a search result keeps the section it navigated to',
      jumped.skip === true || jumped.section !== 'home', JSON.stringify(jumped));
  }

  // ════════════════════════════════════════════════════════════════════
  // 3c  AN UPLOAD IS DATED FROM THE FILE, NOT FROM THE CLOCK
  // ════════════════════════════════════════════════════════════════════
  //
  // "Historic Audio & Images" is, by name, older than the app. The row used to be
  // stamped with `new Date()` and the sheet showed no date at all, so a 2024 ride
  // photo was filed under today with nowhere to say otherwise.
  {
    const dates = await page.evaluate(async () => {
      if (typeof window.dkFileDate !== 'function') return { missing: true };
      const mk = (name, ms, type) =>
        new File([new Uint8Array([1, 2, 3])], name, { type, lastModified: ms });
      return {
        // The filename is the only correct source for a WhatsApp file: it rewrites
        // lastModified to the moment you downloaded it.
        whatsapp: await window.dkFileDate(mk('WhatsApp Video 2026-04-19 at 3.11.15 PM.mp4', Date.now(), 'video/mp4')),
        camera: await window.dkFileDate(mk('20260320_125133.jpg', Date.now(), 'image/jpeg')),
        prefixed: await window.dkFileDate(mk('IMG_20240712_143500.jpg', Date.now(), 'image/jpeg')),
        // No date in the name, so it falls through to lastModified.
        plain: await window.dkFileDate(mk('1000013060.mp4', Date.UTC(2025, 10, 6, 8, 11), 'video/mp4')),
        // A clock set to 2099 is a broken clock, not a date.
        future: await window.dkFileDate(mk('whatever.png', Date.UTC(2099, 0, 1), 'image/png')),
      };
    });
    ok('dkFileDate reads the date out of a filename', dates.whatsapp === '2026-04-19', JSON.stringify(dates));
    ok('and out of a camera timestamp', dates.camera === '2026-03-20', String(dates.camera));
    ok('and out of a prefixed one', dates.prefixed === '2024-07-12', String(dates.prefixed));
    ok('and falls back to lastModified', dates.plain === '2025-11-06', String(dates.plain));
    ok('and refuses a date in the future', dates.future === null, String(dates.future));

    // ── THE TIME, which is the half that used to be thrown away ──
    //
    // historic_date is a `date`, so every clock reading the metadata carried was
    // truncated to fit it — and because the Uploaded column prints the day over the
    // time, dating a row is what made its time line disappear. taken_at holds the
    // instant, and the rule that matters is that it stays NULL unless a real reading
    // was found. A day plus a default noon is not a time.
    const clocks = await page.evaluate(async () => {
      const mk = (name, ms, type) =>
        new File([new Uint8Array([1, 2, 3])], name, { type, lastModified: ms });
      const d = window.dkMediaDate;
      if (!d || typeof d.detail !== 'function') return { missing: true };
      const local = (iso) => {
        if (!iso) return null;
        const x = new Date(iso);
        return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
      };
      const timed = await d.detail(mk('WhatsApp Video 2026-04-19 at 3.11.15 PM.mp4', Date.now(), 'video/mp4'));
      const camera = await d.detail(mk('20260320_125133.jpg', Date.now(), 'image/jpeg'));
      const bare = await d.detail(mk('Screenshot 2026-04-19.png', Date.now(), 'image/png'));
      const modOnly = await d.detail(mk('1000013060.mp4', Date.UTC(2025, 10, 6, 8, 11), 'video/mp4'));
      return {
        timed: { date: timed.date, clock: local(timed.at), source: timed.source },
        camera: { date: camera.date, clock: local(camera.at) },
        bare: { date: bare.date, at: bare.at, source: bare.source },
        modOnly: { date: modOnly.date, at: modOnly.at, source: modOnly.source },
        // The two halves of the edit sheet's time field, round-tripped.
        roundTrip: typeof historicStampFrom === 'function' && typeof historicClockOf === 'function'
          ? historicClockOf(historicStampFrom('2025-06-27', '07:05'))
          : null,
        // A blank time is not midnight. It is "nobody knows", and it has to stay
        // distinguishable from a file that really was recorded at 00:00.
        blankIsNotMidnight: typeof historicStampFrom === 'function'
          ? historicStampFrom('2025-06-27', '') === '' && historicStampFrom('2025-06-27', '00:00') !== ''
          : null,
        // Moving a corrected day must not move the clock reading.
        moved: typeof historicStampOnDay === 'function'
          ? local(historicStampOnDay(new Date(2025, 5, 26, 23, 14, 0).toISOString(), '2025-06-27'))
          : null,
      };
    });
    ok('dkMediaDate.detail reads a clock reading out of a filename that has one',
      clocks.timed?.clock === '15:11', JSON.stringify(clocks.timed));
    ok('and out of a camera timestamp', clocks.camera?.clock === '12:51', JSON.stringify(clocks.camera));
    ok('and leaves the time null for a bare date',
      clocks.bare?.date === '2026-04-19' && clocks.bare?.at === null, JSON.stringify(clocks.bare));
    ok('and null for a lastModified, which is a copy time',
      clocks.modOnly?.date === '2025-11-06' && clocks.modOnly?.at === null, JSON.stringify(clocks.modOnly));
    ok('the edit sheet round-trips a time without drifting', clocks.roundTrip === '07:05',
      String(clocks.roundTrip));
    ok('an empty time field is not midnight', clocks.blankIsNotMidnight === true,
      String(clocks.blankIsNotMidnight));
    ok('correcting the day keeps the clock reading', clocks.moved === '23:14', String(clocks.moved));
    ok('the cloud store can read and write taken_at', await page.evaluate(() =>
      typeof window.dkCloudStore?.takenAt === 'function'
      && typeof window.dkCloudStore?.setTakenAt === 'function'));

    // End to end: the sheet the upload opens has to arrive with it filled in.
    await goToSection(page, 'docs');
    const sheet = await page.evaluate(async () => {
      const zone = document.querySelector('.drop-zone[data-type="image"]');
      const input = zone?.querySelector('input[type=file]');
      if (!input) return { skip: true };
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([1, 2, 3])], '20260320_125133.jpg',
        { type: 'image/jpeg', lastModified: Date.now() }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 1100));
      const field = document.getElementById('historicNotesDateField');
      const dateEl = document.getElementById('historicNotesDate');
      const timeEl = document.getElementById('historicNotesTime');
      return {
        open: document.getElementById('historicNotesModal')?.classList.contains('show'),
        shown: field ? !field.hasAttribute('hidden') : false,
        value: dateEl?.value || null,
        max: dateEl?.max || null,
        time: timeEl?.value || null,
        // Two inputs, two labels. A single <label> around both would name the time
        // field "Taken on" as well, which is the date's name.
        labelled: !!timeEl?.closest('label') && timeEl?.closest('label')
          !== dateEl?.closest('label'),
        timeRequired: timeEl?.required ?? null,
      };
    });
    ok('the upload sheet shows the date field', sheet.skip === true || (sheet.open && sheet.shown),
      JSON.stringify(sheet));
    ok('pre-filled from the file itself', sheet.skip === true || sheet.value === '2026-03-20',
      String(sheet.value));
    ok('and it will not accept a future date', sheet.skip === true || !!sheet.max, String(sheet.max));
    ok('the time comes through too', sheet.skip === true || sheet.time === '12:51', String(sheet.time));
    ok('and it has a label of its own', sheet.skip === true || sheet.labelled === true,
      String(sheet.labelled));
    ok('and is optional, because not every file knows one',
      sheet.skip === true || sheet.timeRequired === false, String(sheet.timeRequired));
    // Leave nothing open for the checks that follow.
    await press('and the sheet cancels cleanly', () => page.evaluate(() =>
      document.getElementById('historicNotesSkip')?.click()));
  }

  // ════════════════════════════════════════════════════════════════════
  // 4  TEXT CONTRAST
  // ════════════════════════════════════════════════════════════════════
  //
  // MEASURED OFF THE RENDERED PIXELS, not modelled from the cascade.
  //
  // The first version of this walked up the tree compositing every translucent
  // background it found, which is what you would do by hand — and it was wrong in
  // both directions. The docs panels carry
  // `radial-gradient(circle at 12% 0%, rgba(251,105,0,0.16), transparent)`: an
  // orange glow in the top-LEFT corner. Two of those nest. Taking a gradient's
  // lightest stop as "the background" put that glow underneath the Private vault
  // pill in the top-RIGHT, reported orange text on an orange field at 3.73:1, and
  // sent me looking for a fault that is not on the screen. Getting it right means
  // solving the gradient geometry, then backdrop-filter, then the photograph
  // behind all of it.
  //
  // So: screenshot each section, and read the actual colour behind each run of
  // text. The most common colour inside an element's own box IS its background —
  // glyph strokes are thin and never win a histogram. deviceScaleFactor is 1, so
  // a CSS pixel is an image pixel and no coordinate maths is needed beyond the
  // scroll offset.
  const contrast = { bad: [], checked: 0 };
  for (const sec of SECTIONS) {
    await goToSection(page, sec);

    // Every run of its own text, in document coordinates.
    const targets = await page.evaluate(([section, isShownSrc]) => {
      const isShown = eval(isShownSrc);
      const out = [];
      const root = document.getElementById(section);
      if (!root) return out;
      for (const el of root.querySelectorAll('p,span,strong,small,b,em,dd,dt,td,th,li,label,button,a,time,h1,h2,h3,h4,h5,h6')) {
        if (!isShown(el)) continue;
        // Own text only, so a wrapper is not judged on its children's colour.
        const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
        if (own.length < 2) continue;
        const cs = getComputedStyle(el);
        // Gradient-filled text has no single colour to measure.
        if (/transparent|rgba\(0, 0, 0, 0\)/.test(cs.webkitTextFillColor || '')) continue;
        // WCAG 1.4.3 exempts inactive controls, and dimness is their message.
        if (el.matches(':disabled, [disabled], [aria-disabled="true"]')) continue;
        if (el.closest('.is-dormant, :disabled, [disabled]')) continue;
        const m = String(cs.color).match(/rgba?\(([^)]+)\)/);
        if (!m) continue;
        const p = m[1].split(',').map(Number);
        const b = el.getBoundingClientRect();
        if (b.width < 4 || b.height < 4) continue;
        out.push({
          name: `${el.tagName.toLowerCase()}.${el.className.toString().trim().split(/\s+/)[0] || '·'}`,
          text: own.slice(0, 22),
          fg: p.slice(0, 3), alpha: p.length > 3 ? p[3] : 1,
          px: parseFloat(cs.fontSize),
          bold: parseInt(cs.fontWeight, 10) >= 700,
          x: Math.round(b.left + scrollX), y: Math.round(b.top + scrollY),
          w: Math.round(b.width), h: Math.round(b.height),
        });
      }
      return out;
    }, [sec, IS_SHOWN]);

    if (!targets.length) continue;

    // SCREENSHOT WITH THE TEXT TURNED OFF.
    //
    // Sampling the most common colour inside an element's box works right up to a
    // 26px bold heading, where the glyphs cover more of the box than the
    // background does and the histogram returns the text colour — reporting
    // orange-on-orange at 1.00:1. Antialiased edges make it worse: the second most
    // common colour is a fg/bg blend, not the background either.
    //
    // Painting every glyph transparent removes the ambiguity completely. `color`
    // does not affect layout, so the geometry measured above still holds, and what
    // is left in each box is exactly what sits behind the text — gradient,
    // photograph, backdrop-filter and all.
    await page.addStyleTag({
      content: `* , *::before, *::after {
        color: transparent !important;
        -webkit-text-fill-color: transparent !important;
        text-shadow: none !important;
        caret-color: transparent !important;
      }`,
    });
    await page.waitForTimeout(160);
    const png = (await page.screenshot({ fullPage: true })).toString('base64');
    await page.evaluate(() => {
      // addStyleTag appends to <head>; the last one is ours.
      const tags = document.head.querySelectorAll('style');
      tags[tags.length - 1]?.remove();
    });

    const result = await page.evaluate(async ([b64, items]) => {
      const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + b64; });
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);

      const chan = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      const lum = ([r, g, b]) => 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);

      const bad = [];
      let checked = 0;
      for (const it of items) {
        if (it.x < 0 || it.y < 0 || it.x + it.w > img.width || it.y + it.h > img.height) continue;
        const d = cx.getImageData(it.x, it.y, it.w, it.h).data;
        // The text is gone from this image, so the box holds background only.
        // Still take the mode rather than an average: a label that overlaps a
        // panel edge or a chip border should be judged against the surface its
        // glyphs actually sit on, and that is the surface with the most pixels.
        // The LIGHTEST of the tied candidates would be the pessimistic choice, but
        // the mode is the honest one and this app is light text on dark.
        const counts = new Map();
        for (let i = 0; i < d.length; i += 4) {
          // Quantise to 4 levels per channel so a gradient does not split the
          // background across a hundred near-identical keys.
          const k = ((d[i] >> 2) << 16) | ((d[i + 1] >> 2) << 8) | (d[i + 2] >> 2);
          const e = counts.get(k);
          if (e) { e[0] += d[i]; e[1] += d[i + 1]; e[2] += d[i + 2]; e[3] += 1; }
          else counts.set(k, [d[i], d[i + 1], d[i + 2], 1]);
        }
        let win = null;
        for (const e of counts.values()) if (!win || e[3] > win[3]) win = e;
        if (!win) continue;
        const bg = [win[0] / win[3], win[1] / win[3], win[2] / win[3]];
        const eff = it.alpha >= 1 ? it.fg : it.fg.map((v, i) => v * it.alpha + bg[i] * (1 - it.alpha));
        const L1 = lum(eff), L2 = lum(bg);
        const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const large = it.px >= 24 || (it.px >= 18.66 && it.bold);
        const need = large ? 3 : 4.5;
        checked += 1;
        if (ratio < need) {
          bad.push(`${it.name} ${ratio.toFixed(2)}:1 need ${need} @${it.px}px `
            + `on rgb(${bg.map(Math.round).join(',')}) "${it.text}"`);
        }
      }
      return { bad, checked };
    }, [png, targets]);

    contrast.checked += result.checked;
    for (const b of result.bad) contrast.bad.push(`${sec} ${b}`);
  }

  contrast.bad = [...new Set(contrast.bad)];
  ok(`every one of the ${contrast.checked} text nodes on screen meets WCAG AA`,
    contrast.bad.length === 0,
    contrast.bad.slice(0, 12).join(' | ') + (contrast.bad.length > 12 ? ` … +${contrast.bad.length - 12} more` : ''));

  // ════════════════════════════════════════════════════════════════════
  // 5  FOCUS IS ALWAYS VISIBLE
  // ════════════════════════════════════════════════════════════════════
  const focus = await page.evaluate(async ([sections, isShownSrc]) => {
    const isShown = eval(isShownSrc);
    /**
     * Split a selector list on its TOP-LEVEL commas only.
     *
     * A plain `.split(',')` tears `:where(.dk-btn, .dk-link, .dk-stat,
     * .dk-tl-more, .doc-add-tile):focus-visible` — home.css's one grouped focus
     * rule — into six fragments, of which only the last still carries `:focus`.
     * That fragment is `.doc-add-tile)`, which is not a selector, so matches()
     * threw and eight covered controls were reported bare.
     */
    const splitSelectorList = text => {
      const out = [];
      let depth = 0, start = 0;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth--;
        else if (c === ',' && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
      }
      out.push(text.slice(start));
      return out;
    };

    // Read the rules rather than focusing things: :focus-visible only matches
    // after a real keyboard interaction, which cannot be faked per element.
    const selectors = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }   // cross-origin (Font Awesome)
      const walk = list => {
        for (const r of list) {
          // selectorText FIRST. Since CSS nesting shipped, a plain CSSStyleRule
          // also implements CSSGroupingRule, so `r.cssRules` is a truthy empty
          // list on every ordinary rule — testing it first recursed into nothing
          // and never read a selector, which is how this check reported zero
          // focus rules in a file that has ninety.
          if (!r.selectorText) { if (r.cssRules) walk(r.cssRules); continue; }
          if (r.cssRules && r.cssRules.length) walk(r.cssRules);
          for (const part of splitSelectorList(r.selectorText)) {
            const s = part.trim();
            if (!/:focus(-visible|-within)?(\b|$)/.test(s)) continue;
            // Strip only the state that cannot be simulated, and the pseudo-
            // elements. :where(), :is() and :not() are kept and handed to
            // el.matches(), which understands them — home.css groups eight
            // controls into one `:where(...):focus-visible` rule, and stripping
            // functional selectors along with the rest left an empty string and
            // reported all eight uncovered.
            const bare = s
              .replace(/:focus-visible|:focus-within|:focus|:hover|:active/g, '')
              .replace(/::[a-z-]+(\([^)]*\))?/g, '')
              .trim();
            if (bare) selectors.push(bare);
          }
        }
      };
      walk(rules);
    }

    const uncovered = [];
    const seen = new Set();
    let checked = 0;
    for (const sec of sections) {
      if (typeof window.dkNavigate === 'function') window.dkNavigate(sec);
      await new Promise(r => setTimeout(r, 380));
      const root = document.getElementById(sec);
      if (!root) continue;
      for (const el of root.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [tabindex="0"]')) {
        if (!isShown(el)) continue;
        const key = el.tagName.toLowerCase() + '.' + (el.className.toString().trim().split(/\s+/)[0] || '·');
        if (seen.has(key)) continue;
        seen.add(key);
        checked += 1;
        const covered = selectors.some(sel => {
          try { return el.matches(sel) || !!el.closest(sel); } catch { return false; }
        });
        if (!covered) uncovered.push(key);
      }
    }
    return { uncovered, checked, rules: selectors.length };
  }, [SECTIONS, IS_SHOWN]);

  ok(`the stylesheet has focus rules at all`, focus.rules > 40, `${focus.rules} found`);
  ok(`all ${focus.checked} focusable controls have a visible focus state`,
    focus.uncovered.length === 0, focus.uncovered.join(' '));

  await ctx.close();
}

// ════════════════════════════════════════════════════════════════════════
// 6  REDUCED MOTION
// ════════════════════════════════════════════════════════════════════════
//
// The universal reset is a single rule, and it used to live in home.css — a
// home-page sheet. If it ever goes missing, coverage silently drops from
// everything to the couple of dozen selectors named in the per-component blocks,
// and nothing fails. So: assert the outcome, on real elements, with the media
// feature actually emulated.
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  await readOnlySupabase(ctx);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await settle(page, 4200);

  const motion = await page.evaluate(async ([sections, isShownSrc]) => {
    const isShown = eval(isShownSrc);
    const moving = [];
    let checked = 0;
    for (const sec of sections) {
      if (typeof window.dkNavigate === 'function') window.dkNavigate(sec);
      await new Promise(r => setTimeout(r, 420));
      const root = document.getElementById(sec);
      if (!root) continue;
      for (const el of root.querySelectorAll('*')) {
        if (!isShown(el)) continue;
        const cs = getComputedStyle(el);
        checked += 1;
        const dur = parseFloat(cs.animationDuration) || 0;
        let tdur = parseFloat(cs.transitionDuration) || 0;
        const delay = parseFloat(cs.animationDelay) || 0;
        const iter = cs.animationIterationCount;

        // THE ONE EXEMPTION, and it is not a loophole.
        // `transition: background-color 9999s` on the service form's inputs is how
        // Chrome's pale-yellow autofill fill is suppressed — the transition is
        // never allowed to complete, so the colour never changes. It exists to
        // PREVENT a visual change, and cutting it to 0.001ms would put a white bar
        // back on a black field. A single-property background-colour transition
        // measured in hours is that hack and nothing else.
        if (cs.transitionProperty === 'background-color' && tdur >= 1000) tdur = 0;

        // Anything the reset reached resolves to 0.001ms, one iteration, no delay.
        if (dur > 0.01 || tdur > 0.01 || delay > 0.001 || (cs.animationName !== 'none' && iter !== '1')) {
          moving.push(`${sec} ${el.tagName.toLowerCase()}.${(el.className.toString().split(' ')[0] || '?')}`
            + ` anim=${cs.animationName} ${cs.animationDuration}/${iter}/${cs.animationDelay} trans=${cs.transitionDuration}`);
        }
      }
    }
    return {
      moving: [...new Set(moving)],
      checked,
      scroll: getComputedStyle(document.documentElement).scrollBehavior,
      honoured: matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  }, [SECTIONS, IS_SHOWN]);

  ok('the browser is actually reporting reduced motion', motion.honoured === true);
  ok(`all ${motion.checked} rendered elements stop animating under reduced motion`,
    motion.moving.length === 0, motion.moving.slice(0, 8).join(' | '));

  // The three.js backdrop honours it in JS rather than CSS.
  const scene = await page.evaluate(() => ({
    canvas: !!document.getElementById('dkScene'),
    api: typeof window.SpinLog3D?.setAnimating,
  }));
  ok('the animated backdrop exposes the switch its reduced-motion path uses',
    scene.canvas === true && scene.api === 'function', JSON.stringify(scene));

  await ctx.close();
}

// ════════════════════════════════════════════════════════════════════════
// 7  NOTHING OVERFLOWS THE VIEWPORT, AT ANY WIDTH
// ════════════════════════════════════════════════════════════════════════
//
// A horizontal scrollbar on a phone is the single most common way a change to
// this CSS goes wrong, and it is invisible on a desktop. 320 is the narrowest
// screen still in use; 1440 is where the max-width finally bites.
{
  for (const width of [320, 360, 390, 430, 600, 768, 820, 1024, 1440]) {
    const ctx = await browser.newContext({ viewport: { width, height: 880 } });
    await readOnlySupabase(ctx);
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'load' });
    await settle(page, 3800);

    for (const sec of SECTIONS) {
      await goToSection(page, sec);
      const over = await page.evaluate(({ w, sec }) => {
        const out = [];
        const root = document.getElementById(sec);
        if (!root) return { out, docW: 0 };
        for (const el of root.querySelectorAll('*')) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || !el.offsetParent) continue;
          if (cs.position === 'fixed') continue;              // overlays are meant to span
          const b = el.getBoundingClientRect();
          if (b.width === 0) continue;
          if (b.right > w + 2 || b.left < -2) {
            out.push(`${el.tagName.toLowerCase()}.${(el.className.toString().split(' ')[0] || '?')}`
              + ` [${Math.round(b.left)},${Math.round(b.right)}]`);
          }
        }
        return { out: [...new Set(out)], docW: document.documentElement.scrollWidth };
      }, { w: width, sec });

      ok(`nothing sticks out of ${sec} at ${width}px`, over.out.length === 0, over.out.slice(0, 6).join(' '));
      ok(`and ${sec} does not scroll sideways at ${width}px`, over.docW <= width + 2, `scrollWidth ${over.docW}`);
    }
    await ctx.close();
  }
}

await browser.close();
server.close();

console.log(fail
  ? `\n✗ ${pass} passed, ${fail} failed`
  : `\n✓ the whole app boots, routes, responds and reads correctly (${pass} checks)`);
process.exit(fail ? 1 : 0);
