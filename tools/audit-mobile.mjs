// ════════════════════════════════════════════════════════════════════════
// SPINLOG — MOBILE AUDIT
//
// Renders the app in real Chromium at phone size, measures it, and fails on the
// faults that cannot be seen any other way.
//
// ── Why this exists ─────────────────────────────────────────────────
// Three rounds of mobile CSS shipped that looked right in the source and wrong on
// the screen, and every one of them failed the same way: a property the new rule
// did not MENTION was still being set by one of the thirty-five older @media
// blocks. `node --check` cannot see that. audit-refs cannot see it. Reading the
// file cannot see it, because the file is correct — it is the cascade that is not.
//
// What actually caught them was asking the browser. Every fault below was found by
// running this, not by reading CSS:
//
//   · every record-card grid row resolving to 66px, from a `min-height: 66px` on
//     the cells that the new reset never mentioned — a 110px card rendering at 386
//   · hairlines between the card rows that were not borders but an inset box-shadow
//   · the "Next due" label never appearing, because a blanket `td::before
//     { display: none }` outranked the rule adding it
//   · that same label rendering as "NEXT DUE" once it did appear, because the cell
//     inherits Blender Pro and the Heavy cut shipped here is a CAPS-ONLY face
//   · the filter select's chevron turning into an orange L, because it is drawn
//     from two borders and needs its rotate(45deg) — which a blanket
//     `transform: none`, added for a Font Awesome chevron elsewhere, removed
//
// ── Running it ──────────────────────────────────────────────────────
//   npm i --no-save playwright@1.49.1
//   npx playwright install chromium
//   node tools/audit-mobile.mjs            # assert
//   node tools/audit-mobile.mjs --shots    # and write tools/_shot-*.png to look at
//
// Playwright is NOT a dependency of the app and is deliberately not in
// package.json — there is no package.json. It is a tool you install when you are
// working on layout. Without it this exits 0 with instructions rather than failing,
// so it can sit in a hook without breaking anyone who has not installed it.
// ════════════════════════════════════════════════════════════════════════

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.argv.includes('--shots');
const TAG = String(Date.now()).slice(-6);

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('· playwright is not installed, so the mobile audit was skipped.');
  console.log('  npm i --no-save playwright@1.49.1 && npx playwright install chromium');
  process.exit(0);
}

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
};

/**
 * A real, decodable 2-second mono WAV of silence, built by hand.
 *
 * The player's play button cannot be tested against a file the browser refuses to
 * decode — play() rejects and the media stays paused, which looks exactly like a
 * broken button. There is no audio file in the repo to borrow, so here is one.
 */
function silentWav(seconds = 2, rate = 8000) {
  const samples = seconds * rate;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);       // PCM
  buf.writeUInt16LE(1, 22);       // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples * 2, 40);
  return buf;
}
const TEST_WAV = silentWav();

const server = http.createServer(async (req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  if (rel === '_audit-test.wav') {
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': TEST_WAV.length });
    res.end(TEST_WAV);
    return;
  }
  try {
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

// One record per service type, exactly as renderServiceTable() emits them. Injected
// rather than fetched: the layout is what is under test and Supabase is not here.
const RECORDS = [
  { cls: 'type-showroom', icon: 'fas fa-store', type: 'Showroom', date: '29 Aug 2026', due: '29 Dec 2026', odo: '8,000', cost: '₹400', notes: 'Handle bar change' },
  { cls: 'type-mods', icon: 'fas fa-bolt', type: 'Mods/Updates', date: '06 Aug 2026', due: '', odo: '7,640', cost: '₹19,324', notes: 'Full exhaust system, LED aux lights and a taller windscreen fitted at the same visit' },
];
// Distinct ids. They were both "1", which was harmless while only the layout was under
// test but makes a jump-to-this-record check meaningless.
const rowHtml = (r, i = 0) => `
  <tr class="service-record-row" data-record-id="${101 + i}" title="Hold to edit this record">
    <td data-label="Type" class="service-type-cell"><span class="history-type-badge ${r.cls}"><i class="${r.icon}" aria-hidden="true"></i>${r.type}</span></td>
    <td data-label="Date" class="service-date-cell">${r.date}</td>
    <td data-label="Next Due" class="service-due-cell">${r.due || '<span class="history-empty-pill">Not set</span>'}</td>
    <td data-label="Odo (km)" class="service-odo-cell">${r.odo} km</td>
    <td data-label="Cost (₹)" class="service-cost-cell">${r.cost}</td>
    <td data-label="Notes" class="record-notes service-notes-cell"><span class="history-notes-text">${r.notes}</span></td>
    <td data-label="Bill" class="bill-cell service-bill-cell"><a class="bill-preview-link" href="#"><i class="fas fa-file-pdf" aria-hidden="true"></i>View</a></td>
    <td data-label="Action" class="action-cell service-action-cell"><button type="button" class="delete-btn service-record-delete">×</button></td>
  </tr>`;

// One media upload per kind, exactly as loadHistoricUploads() emits them — six cells,
// a TYPE badge where the Preview column used to be, a thumbnail slot as the one open
// control, and an Uploaded cell of two lines.
//
// `when` and `day` matter: the filter reads data-day rather than parsing the rendered
// date, and the sort button reads data-when. They have to agree with `date` or the date
// range assertions below are testing nothing.
const MEDIA = [
  { id: 1, icon: 'fa-image', kind: 'image', size: '3.1 MB',
    date: '12 Jul 2024', time: '4:35 pm', day: '2024-07-12', when: Date.UTC(2024, 6, 12, 11, 5),
    name: 'IMG_20240712_ridgeline_sunset.jpg',
    notes: 'Golden hour on the ghat road, first ride after the exhaust swap. Pillion shot.' },
  { id: 2, icon: 'fa-wave-square', kind: 'audio', size: '842 KB',
    date: '10 Jul 2024', time: '7:12 am', day: '2024-07-10', when: Date.UTC(2024, 6, 10, 1, 42),
    name: 'cold-start-6000km.m4a',
    notes: 'Cold start at 6,000 km with the stock can still on.' },
  // Still three rows — nine assertions below count on that — but this one's note is
  // now the note that broke the layout: one 57-character token with no spaces in it.
  // It wrapped mid-word twice and made its row twice the height of the other two.
  // Row count unchanged, regression covered.
  { id: 3, icon: 'fa-play', kind: 'video', size: '28.4 MB',
    date: '02 Jun 2024', time: '9:04 pm', day: '2024-06-02', when: Date.UTC(2024, 5, 2, 15, 34),
    name: 'tunnel-run.mp4',
    notes: 'bike-sdfasdgaSRGHASDFGHASDFGSADGASDFGADGSADSFASDFGSdfSDFsf plus ordinary words' },
];
// What the TYPE badge holds per kind. Audio is the kind with no frame to show, which is
// why it is also the row with no data-thumb on its button.
const BADGE = {
  image: ['fa-image', 'Image'],
  audio: ['fa-wave-square', 'Audio'],
  video: ['fa-video', 'Video'],
};
// The label inside a badge is an ELEMENT, mirroring docsTypeBadge(). A bare text node
// there is an anonymous flex item and Chromium will not put the badge's gap in front of
// one, so the glyph rendered against the first letter.
const badgeHtml = kind =>
  `<span class="docs-type-badge is-${kind}"><i class="fas ${BADGE[kind][0]}" aria-hidden="true"></i>`
  + `<span class="docs-type-label">${BADGE[kind][1]}</span></span>`;

const docsRowHtml = m => `
  <tr class="docs-media-row" data-media-id="${m.id}" data-kind="${m.kind}"
      data-when="${m.when}" data-day="${m.day}">
    <td data-label="File">
      <div class="docs-file-cell">
        <button class="docs-file-icon docs-file-open docs-thumb${m.kind === 'audio' ? '' : ` is-${m.kind}`}"
                type="button" data-media-open="${m.id}"
                ${m.kind === 'audio' ? '' : `data-thumb="f${m.id}" data-thumb-kind="${m.kind}"`}
                aria-label="Open ${m.name}" title="Open ${m.name}">
          <i class="fas ${m.icon}" aria-hidden="true"></i>
        </button>
        <span class="docs-file-meta">
          <strong>${m.name}</strong>
          <span class="docs-file-tags">
            ${badgeHtml(m.kind)}
            <span class="docs-file-size">${m.size}</span>
          </span>
        </span>
      </div>
    </td>
    <td data-label="Type" class="docs-col-type">${badgeHtml(m.kind)}</td>
    <td data-label="Size" class="docs-col-size">${m.size}</td>
    <td data-label="Notes"><div class="docs-notes-cell" title="${m.notes}">${m.notes}</div></td>
    <td data-label="Uploaded">
      <div class="docs-date-cell">
        <span class="docs-date-day">${m.date}</span>
        <span class="docs-date-time">${m.time}</span>
      </div>
    </td>
    <td data-label="Actions">
      <div class="docs-action-stack">
        <button class="docs-trash-btn" type="button" title="Delete ${m.name}"
                aria-label="Delete ${m.name}"><i class="fas fa-trash" aria-hidden="true"></i></button>
      </div>
    </td>
  </tr>`;
const DOCS_ROWS = MEDIA.map(docsRowHtml).join('');
// The player reads this map, not the DOM, for everything but the note.
const DOCS_MAP = MEDIA.map(m => [m.id, {
  id: m.id, media_type: m.kind, file_name: `f${m.id}`, original_name: m.name, file_size: 1024,
}]);

// Twenty-four rows for the page-controls block. Three rows is one page, which would
// prove nothing about paging: the numbered strip would hold a single button, both
// arrows would be dead and the footer would look identical whether the arithmetic
// worked or not. Descending by date, which is the order Supabase hands them over in
// and therefore the state the sort button starts from.
const MANY = Array.from({ length: 24 }, (_, i) => {
  const base = MEDIA[i % MEDIA.length];
  const when = Date.UTC(2026, 3, 19, 9, 41) - i * 26 * 3600 * 1000;
  const d = new Date(when);
  const iso = d.toISOString().slice(0, 10);
  return {
    ...base,
    id: 200 + i,
    when,
    day: iso,
    date: `${iso.slice(8)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`,
  };
});
const MANY_ROWS = MANY.map(docsRowHtml).join('');
const MANY_MAP = MANY.map(m => [m.id, {
  id: m.id, media_type: m.kind, file_name: `f${m.id}`, original_name: m.name, file_size: 1024,
}]);

// The same rows again under DIFFERENT storage names, for the thumbnail block.
//
// That module memoises signed URLs by name for the life of the page, which is a feature
// — turning a page back must not re-sign — and it means the names above are already
// signed by the time those checks run. Reusing them would measure zero requests and read
// as "the batch never happened". Ids +100 gives f300..f323, which nothing has touched.
const FRESH = MANY.map(m => ({ ...m, id: m.id + 100 }));
const FRESH_ROWS = FRESH.map(docsRowHtml).join('');
const FRESH_MAP = FRESH.map(m => [m.id, {
  id: m.id, media_type: m.kind, file_name: `f${m.id}`, original_name: m.name, file_size: 1024,
}]);

// Galaxy A55 is what he tests on; 320 is the narrowest phone still in use.
const SIZES = [{ name: 'A55', w: 360, h: 800 }, { name: 'narrow', w: 320, h: 720 }];

let pass = 0;
let fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass += 1; }
  else { fail += 1; console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`); }
};

const browser = await chromium.launch();

for (const size of SIZES) {
  const page = await browser.newPage({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.slice(0, 120)));

  // Cut the app off from the real database. Without this the live loader can return
  // the actual uploads a second or two after the fixture rows are written, and every
  // count assertion silently measures someone's real data instead — it produced a
  // clean pass one run and six failures the next with no code change between them.
  await page.route('**://*.supabase.co/**', r => r.abort());

  await page.addInitScript(() => {
    // The service worker is off here, or it caches the CSS being edited and the
    // next run measures the previous one. A promise that never settles rather than
    // a rejection: a rejection reaches window.onerror and would show up as a page
    // error, which is a thing this audit checks for.
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(1100);
  await page.evaluate(rows => {
    if (typeof window.dkNavigate === 'function') window.dkNavigate('service');
    const body = document.getElementById('serviceTableBody');
    if (body) body.innerHTML = rows;
    document.querySelectorAll('canvas').forEach(c => { c.style.visibility = 'hidden'; });
    const t = document.getElementById('serviceHistoryFilterToggle');
    if (t && t.getAttribute('aria-expanded') !== 'true') t.click();
  }, RECORDS.map(rowHtml).join(''));
  await page.waitForTimeout(500);

  const r = await page.evaluate(() => {
    const cs = sel => { const el = document.querySelector(sel); return el ? getComputedStyle(el) : null; };
    const box = sel => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.left), y: Math.round(b.top) };
    };
    const tr = document.querySelector('#serviceTableBody tr.service-record-row');
    const cells = tr ? [...tr.children].map(td => {
      const s = getComputedStyle(td);
      const b = td.getBoundingClientRect();
      return {
        cls: td.className, row: s.gridRow, col: s.gridColumn,
        h: Math.round(b.height), minH: s.minHeight, shadow: s.boxShadow,
      };
    }) : [];
    const icons = [...document.querySelectorAll('#serviceEntryForm .field-leading')].map(i => {
      const b = i.getBoundingClientRect();
      const shell = i.closest('.field-shell');
      const sb = shell ? shell.getBoundingClientRect() : b;
      const notes = !!i.closest('.textarea-shell');
      return {
        w: Math.round(b.width), edge: Math.round(b.left - sb.left),
        centred: Math.abs((b.top + b.height / 2) - (sb.top + sb.height / 2)) < 2,
        notes,
      };
    });
    const shells = ['.service-field-type', '.service-field-date', '#nextDueLabel',
      '.service-field-odo', '.service-field-cost']
      .map(s => box(`${s} .field-shell`)).filter(Boolean);
    const controls = [...document.querySelectorAll('#serviceHistoryFilters .history-control')]
      .map(c => Math.round(c.getBoundingClientRect().top));
    const dueBefore = (() => {
      const el = document.querySelector('#serviceTableBody .service-due-cell');
      if (!el) return null;
      const s = getComputedStyle(el, '::before');
      return { content: s.content, display: s.display, family: s.fontFamily };
    })();
    const chevron = (() => {
      const el = document.querySelector('#serviceHistoryFilters .custom-history-select');
      if (!el) return null;
      const s = getComputedStyle(el, '::after');
      return { border: s.borderWidth, transform: s.transform };
    })();
    // Distance from the leading glyph's box to the start of the text beside it.
    const iconToText = (() => {
      const icon = document.querySelector('.service-field-odo .field-leading');
      const text = document.querySelector('.service-field-odo input');
      if (!icon || !text) return null;
      return Math.round(text.getBoundingClientRect().left - icon.getBoundingClientRect().right);
    })();
    return {
      iconToText,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      card: tr ? Math.round(tr.getBoundingClientRect().height) : null,
      cells, icons, shells, controls, dueBefore, chevron,
      badge: box('#serviceTableBody .history-type-badge'),
      bill: cs('#serviceTableBody .bill-preview-link'),
      toggle: box('#serviceHistoryFilterToggle'),
      clear: box('#serviceHistoryClearFilters'),
      submit: box('.drawer-submit'),
    };
  });

  const at = s => `[${size.name}] ${s}`;

  // ── Nothing may push the page sideways ──
  ok(at('no horizontal overflow'), r.overflowX <= 0, `${r.overflowX}px wider than the viewport`);

  // ── The record card ──
  ok(at('card is not a stack of boxes'), r.card !== null && r.card < 230, `${r.card}px tall`);
  r.cells.forEach(c => {
    const name = c.cls.replace(/service-|-cell|record-notes |bill |action /g, '').trim();
    // The 66px min-height that made every row equal and the card 386px tall.
    ok(at(`${name} cell has no min-height`), c.minH === '0px' || c.minH === 'auto', c.minH);
    // The inset hairline that turned a card back into a table.
    ok(at(`${name} cell has no divider shadow`), c.shadow === 'none', c.shadow);
  });
  // Two grid items in one cell stack on top of each other rather than flowing.
  {
    const span = v => { const [a, b] = String(v).split('/').map(s => s.trim()); return [Number(a), b ? Number(b) : Number(a) + 1]; };
    let clash = null;
    for (let i = 0; i < r.cells.length; i += 1) {
      for (let j = i + 1; j < r.cells.length; j += 1) {
        const A = r.cells[i]; const B = r.cells[j];
        if (A.row !== B.row) continue;
        const [a1, a2] = span(A.col); const [b1, b2] = span(B.col);
        if (a1 < b2 && b1 < a2) clash = `${A.cls} over ${B.cls} in row ${A.row}`;
      }
    }
    ok(at('no two cells share a grid cell'), !clash, clash);
  }
  ok(at('the type badge is a label, not a button'),
    r.badge && r.badge.h < 32 && r.badge.w < 160, JSON.stringify(r.badge));
  ok(at('the bill link is a row, not a stack'),
    r.bill && r.bill.display === 'inline-flex', r.bill && r.bill.display);
  ok(at('next due keeps its label'),
    r.dueBefore && r.dueBefore.content.includes('Next due') && r.dueBefore.display !== 'none',
    JSON.stringify(r.dueBefore));
  // Blender Pro Heavy is caps-only, so anything meant to read in sentence case has
  // to say which font it wants.
  ok(at('and that label is not in the caps-only face'),
    r.dueBefore && !/Blender/i.test(r.dueBefore.family), r.dueBefore && r.dueBefore.family);

  // ── The entry form ──
  ok(at('every field is the same height'),
    new Set(r.shells.map(s => s.h)).size === 1, r.shells.map(s => s.h).join(','));
  ok(at('and tall enough to hit'), r.shells.every(s => s.h >= 44), r.shells.map(s => s.h).join(','));
  ok(at('every leading icon is one size'),
    new Set(r.icons.map(i => i.w)).size === 1, r.icons.map(i => i.w).join(','));
  ok(at('every icon clears the field edge'),
    r.icons.every(i => i.edge >= 10), r.icons.map(i => i.edge).join(','));
  // The one that matters and the one nothing was measuring: how far the TEXT starts
  // from the icon. A `column-gap: 0` written after a `gap` shorthand held this at
  // zero for three rounds while the token it was supposed to read kept changing.
  ok(at('the text clears the icon'),
    r.iconToText !== null && r.iconToText >= 8,
    `${r.iconToText}px between the glyph box and the text`);
  // The notes glyph sits at the top on purpose; every other one is centred.
  ok(at('single-line icons are centred'),
    r.icons.filter(i => !i.notes).every(i => i.centred),
    r.icons.map(i => `${i.centred}${i.notes ? '(notes)' : ''}`).join(','));
  ok(at('the submit is full width'), r.submit && r.submit.w > size.w * 0.7, JSON.stringify(r.submit));

  // ── The filter bar ──
  ok(at('Filters and Clear are side by side'),
    r.toggle && r.clear && Math.abs(r.toggle.y - r.clear.y) < 4,
    `${r.toggle && r.toggle.y} vs ${r.clear && r.clear.y}`);
  ok(at('and neither is oversized'),
    r.toggle && r.clear && r.toggle.h <= 46 && r.clear.h <= 46,
    `${r.toggle && r.toggle.h} / ${r.clear && r.clear.h}`);
  {
    const rows = {};
    r.controls.forEach(y => { rows[y] = (rows[y] || 0) + 1; });
    ok(at('From and To share a row'), Object.values(rows).some(n => n > 1),
      `${r.controls.length} controls on ${Object.keys(rows).length} rows`);
  }
  // A border-drawn chevron needs its rotation; a blanket transform:none kills it.
  ok(at('the filter chevron is still rotated'),
    r.chevron && (r.chevron.border === '0px' || r.chevron.transform !== 'none'),
    JSON.stringify(r.chevron));

  // ── The panel has to actually OPEN AND SHUT ──
  //
  // This was missed for a whole round. script.js toggles `.is-open` and nothing
  // else, so a `display: grid !important` written without that class pinned the
  // panel open and made Filters a button that did nothing. Geometry alone could not
  // see it — the panel measured fine, it was simply always there.
  {
    const cycle = await page.evaluate(async () => {
      const t = document.getElementById('serviceHistoryFilterToggle');
      const p = document.getElementById('serviceHistoryFilters');
      if (!t || !p) return null;
      // A BEAT AFTER EACH CLICK, because the panel animates now.
      //
      // The three clicks used to be read back synchronously, which was correct while
      // the panel switched `display` — that lands in the same frame. It collapses its
      // height over 260ms instead, so reading immediately after the click measures the
      // state it is leaving and every sample came back "open".
      const settle = () => new Promise(r => setTimeout(r, 340));
      // MEASURED, NOT INFERRED FROM `display`.
      //
      // This used to be `getComputedStyle(p).display !== 'none'`, which was the
      // right test for exactly as long as `display` was the mechanism. The panel
      // collapses its height now, so that it can animate open and shut instead of
      // snapping — it is `display: grid` at all times and hidden with max-height 0,
      // visibility and opacity. The old check read that as permanently open.
      //
      // offsetHeight cannot go stale the same way: it is 0 for `display: none`, 0
      // for a max-height:0 collapse, and non-zero only when the panel is genuinely
      // taking up space. The visibility test catches a panel that has height but is
      // not painted.
      const show = () => p.offsetHeight > 2 && getComputedStyle(p).visibility !== 'hidden';
      const seen = [];
      // It was opened during setup, so this first click should shut it.
      t.click(); await settle(); seen.push(show());
      t.click(); await settle(); seen.push(show());
      t.click(); await settle(); seen.push(show());
      return { seen, expanded: t.getAttribute('aria-expanded') };
    });
    ok(at('the Filters button opens and shuts the panel'),
      cycle && cycle.seen[0] === false && cycle.seen[1] === true && cycle.seen[2] === false,
      cycle ? `visible after each click: ${cycle.seen.join(', ')}` : 'controls missing');
    ok(at('and keeps aria-expanded honest'),
      cycle && cycle.expanded === 'false', cycle && cycle.expanded);
    // Leave it open for the screenshots below.
    await page.evaluate(() => document.getElementById('serviceHistoryFilterToggle')?.click());
    await page.waitForTimeout(250);
  }

  // ── An absent value must not look like a control ──
  {
    const empty = await page.evaluate(() => {
      const el = document.querySelector('#serviceTableBody .service-due-cell .history-empty-pill');
      if (!el) return null;
      const s = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      return {
        bg: s.backgroundColor, border: s.borderWidth,
        w: Math.round(b.width), h: Math.round(b.height),
      };
    });
    ok(at('"Not set" is text, not a button'),
      empty && empty.border === '0px'
        && /rgba\(0, 0, 0, 0\)|transparent/.test(empty.bg) && empty.h < 24,
      JSON.stringify(empty));
  }

  // ── Her button must not compete with the submit ──
  {
    const pair = await page.evaluate(() => {
      const s = document.getElementById('serviceAutofill');
      const a = document.querySelector('.drawer-submit');
      const r = el => (el ? Math.round(el.getBoundingClientRect().width) : null);
      return { sage: r(s), submit: r(a) };
    });
    ok(at('her draft button is smaller than Add Entry'),
      pair.sage && pair.submit && pair.sage < pair.submit * 0.75,
      `sage ${pair.sage} vs submit ${pair.submit}`);
  }

  // ── The four spend tiles must share a baseline ──
  {
    const tiles = await page.evaluate(() => [...document.querySelectorAll('#service .history-spend-card')]
      .map(c => {
        const label = c.querySelector('span');
        const value = c.querySelector('strong');
        const cb = c.getBoundingClientRect();
        return {
          h: Math.round(cb.height),
          labelY: label ? Math.round(label.getBoundingClientRect().top - cb.top) : null,
          align: label ? getComputedStyle(label).textAlign : null,
        };
      }));
    ok(at('all spend tiles are the same height'),
      tiles.length > 1 && new Set(tiles.map(t => t.h)).size === 1, tiles.map(t => t.h).join(','));
    ok(at('and their labels sit on one line'),
      tiles.length > 1 && new Set(tiles.map(t => t.labelY)).size === 1,
      tiles.map(t => t.labelY).join(','));
  }

  // ══ RECORD HISTORY, ON THE DOCUMENTS PAGE ══════════════════════════════
  //
  // Only this area. The document vault and the drop zones are the original layout
  // on purpose — an earlier pass rebuilt them and it was reverted.
  //
  // The rules that style this sit in a block appended to the END of styles.css, and
  // that placement is the whole trick: the #docs rules earlier in the file are
  // spread across six competing blocks, several of them unconditional and written
  // AFTER their own media queries. At equal specificity source order decides and a
  // media query carries no extra weight, so a phone rule in the middle of the file
  // is simply dead. Everything below is a number that was wrong at some point.
  {
    // Let anything already in flight land BEFORE seeding.
    //
    // loadHistoricUploads() has no server here, so it finishes by writing "Could not
    // load uploads" into the tbody — and it was landing AFTER the seed, wiping the
    // rows under test. Whether it won that race depended on network timing, which is
    // how this passed twice and then failed.
    //
    // THE LOADER CANNOT BE STUBBED FROM HERE, and a line that used to sit in this
    // evaluate claimed otherwise: `window.loadHistoricUploads = () => Promise.resolve()`.
    // It is a function declaration inside the DOMContentLoaded closure in script.js, so
    // it is not a property of window at all — that assignment created an unrelated
    // global and stopped nothing. The defences that do work are the route abort above,
    // the wait below, and re-seeding before each block that depends on the rows.
    await page.evaluate(() => {
      if (typeof window.dkNavigate === 'function') window.dkNavigate('docs');
    });
    await page.waitForTimeout(700);

    await page.evaluate(({ rows, map }) => {
      const body = document.querySelector('#mediaRecordTable tbody');
      if (body) body.innerHTML = rows;
      document.querySelectorAll('canvas').forEach(c => { c.style.visibility = 'hidden'; });
      // The player reads this, so it has to agree with the rows above.
      window._historicMediaRows = new Map(map);
      // There is no storage here, so signing would fail and every slide would render
      // the "could not be opened" message instead of a media element. A local asset
      // stands in — what is under test is the controls and the gesture handling, not
      // whether Chromium can decode a webp as video.
      //
      // BOTH signers, and counted. The thumbnail strip signs a whole page in one batch
      // call and only falls back to the single-file signer when the batch is missing;
      // stubbing only the single one would leave it talking to the aborted network. The
      // counters are what the "one request per page" assertion reads.
      window.__signCalls = { batch: 0, single: 0, names: [] };
      window.dkGetHistoricMediaUrl = async () => {
        window.__signCalls.single += 1;
        return './assets/img/sage.webp';
      };
      window.dkSignHistoricMediaBatch = async names => {
        window.__signCalls.batch += 1;
        window.__signCalls.names.push(...names);
        return new Map(names.map(n => [n, './assets/img/sage.webp']));
      };
      // A cache left over from an earlier run would paint instantly and the "it took a
      // network round trip the first time" half of the check would pass by accident.
      try { localStorage.removeItem('spinlogThumbs.v1'); } catch { /* private mode */ }
    }, { rows: DOCS_ROWS, map: DOCS_MAP });
    await page.waitForTimeout(400);

    const d = await page.evaluate(() => {
      const el = s => document.querySelector(s);
      const box = s => {
        const n = el(s); if (!n) return null;
        const r = n.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.top) };
      };
      const panel = el('#docs .service-history-panel');
      const ps = panel ? getComputedStyle(panel) : null;
      const wrap = el('#docs .docs-history-wrap');
      const row = el('#mediaRecordTable tbody tr.docs-media-row');
      const label = sel => {
        const n = el(sel); if (!n) return null;
        const s = getComputedStyle(n, '::before');
        return { content: s.content, display: s.display };
      };
      return {
        pageOver: document.documentElement.scrollWidth - window.innerWidth,
        sectionOver: (() => { const s = el('#docs'); return s ? s.scrollWidth - s.clientWidth : null; })(),
        // "remove the record history bg cuz it already have one" — it sits inside
        // .docs-historic-panel, which has a border, a gradient and a shadow already.
        panelFrameless: !!ps && ps.backgroundImage === 'none'
          && /rgba\(0, 0, 0, 0\)|transparent/.test(ps.backgroundColor)
          && ps.borderTopWidth === '0px' && ps.boxShadow === 'none',
        // The rows were display:grid while the table was still display:table, so the
        // table sized to its content and ignored width:100% — 246px inside a 204px
        // wrapper at 320px, clipped by overflow-x:hidden rather than scrolled.
        tableDisplay: el('#mediaRecordTable') ? getComputedStyle(el('#mediaRecordTable')).display : null,
        tbodyDisplay: el('#mediaRecordTable tbody')
          ? getComputedStyle(el('#mediaRecordTable tbody')).display : null,
        tableOver: wrap ? wrap.scrollWidth - wrap.clientWidth : null,
        // The class the filter sets has to actually take a row off the screen. The rule
        // that does it was scoped to this width only, which is why the search did
        // nothing on a desktop.
        hideRule: (() => {
          const r = el('#mediaRecordTable tbody tr.docs-media-row');
          if (!r) return null;
          r.classList.add('is-filtered-out');
          const d = getComputedStyle(r).display;
          r.classList.remove('is-filtered-out');
          return d;
        })(),
        rowDisplay: row ? getComputedStyle(row).display : null,
        row: box('#mediaRecordTable tbody tr.docs-media-row'),
        cells: row ? row.querySelectorAll('td').length : null,
        // Six cells in the markup, four drawn here: Type and Size are desktop columns.
        cellsShown: row
          ? [...row.querySelectorAll('td')].filter(t => getComputedStyle(t).display !== 'none').length
          : null,
        // The grey "VIDEO · 1.6 MB" line under the filename. It is the phone's version
        // of those two columns and has to stay.
        metaLine: (() => {
          const s = el('#docs .docs-file-meta span');
          return s ? getComputedStyle(s).display : null;
        })(),
        // The Preview column, the eye button and both pencils are all gone: the
        // thumbnail opens the file and holding the row edits it.
        previewPills: document.querySelectorAll('#mediaRecordTable .docs-preview-pill').length,
        // The round eye button too, and its whole column with it. A thumbnail reads as
        // pressable, which is the only reason a second control ever existed.
        eyeButtons: document.querySelectorAll('#docs .docs-preview-btn, #docs td.docs-col-preview').length,
        pencils: document.querySelectorAll('#docs .docs-date-edit-btn, #docs .docs-mini-btn').length,
        openBtns: document.querySelectorAll('#docs .docs-file-open').length,
        openIsButton: el('#docs .docs-file-open') ? el('#docs .docs-file-open').tagName.toLowerCase() : null,
        // ONE control per row, at every width. Two of them on one row for one action was
        // the fault being fixed, so counting them is the check that it stays fixed.
        openPerRow: (() => {
          const r = el('#mediaRecordTable tbody tr.docs-media-row');
          return r ? r.querySelectorAll('[data-media-open]').length : null;
        })(),
        // Square on a card, and big enough to be a picture rather than an icon of one.
        // It was 40 — the size of the file-type GLYPH it replaced, which is the wrong
        // measure for a photograph.
        thumb: (() => {
          const t = el('#docs .docs-thumb');
          if (!t) return null;
          const r = t.getBoundingClientRect();
          const s = getComputedStyle(t);
          return { w: Math.round(r.width), h: Math.round(r.height), clips: s.overflow };
        })(),
        // TWO badges per card's worth of markup: one in the TYPE column, which is
        // desktop-only, and one on the line under the filename, which is where a card
        // reads it. Three rows, so six.
        badges: document.querySelectorAll('#docs .docs-type-badge').length,
        // The badge and the size, on the line the grey "audio · 1.9 MB" sentence used to
        // occupy. Drawn here; the desktop pass asserts the mirror of this.
        tags: (() => {
          const t = el('#docs .docs-file-tags');
          if (!t) return null;
          const badge = t.querySelector('.docs-type-badge');
          const size = t.querySelector('.docs-file-size');
          if (!badge || !size) return null;
          const br = badge.getBoundingClientRect();
          const sr = size.getBoundingClientRect();
          return {
            display: getComputedStyle(t).display,
            // One line, side by side, not stacked.
            sameRow: Math.abs(br.top - sr.top) < 6,
            badgeFirst: br.left < sr.left,
            // The separator is a DRAWN dot on the size, not a bullet character: a
            // bullet's position inside its line box is a property of the font and it
            // read a pixel or two high against a 25px badge. It is on the size rather
            // than the badge so it can never land against a rounded corner.
            dot: (() => {
              const s = getComputedStyle(size, '::before');
              return {
                empty: s.content === '""' || s.content === 'none',
                w: s.width,
                round: s.borderTopLeftRadius,
                painted: !/rgba\(0, 0, 0, 0\)/.test(s.backgroundColor),
              };
            })(),
            // The badge keeps its own colour here. `#docs .docs-file-meta span` used to
            // beat `#docs .docs-type-badge` on element count and turned it grey.
            badgeColour: getComputedStyle(badge).color,
            sizeColour: getComputedStyle(size).color,
            // THE GAP INSIDE THE BADGE, MEASURED RATHER THAN READ BACK.
            //
            // This is the check that would have caught the fault twice over. The badge is
            // an inline-flex box with `gap: 9px`, and on a card it sits inside
            // .docs-file-meta — where an older `#docs .docs-file-meta span` rule (1 id, 1
            // class, 1 element) outranked `#docs .docs-type-badge` (1 id, 1 class) and set
            // it to `display: block`. A block is not a flex container, so the gap had
            // nothing to apply to and the glyph rendered hard against the V of VIDEO,
            // while getComputedStyle reported a contented 9px the whole time.
            //
            // The label is also an element now: a bare text node is an anonymous flex item
            // and the gap does not land in front of one either.
            glyphGap: (() => {
              const i = badge.querySelector('i');
              const label = badge.querySelector('.docs-type-label');
              if (!i || !label) return null;
              const ir = i.getBoundingClientRect();
              const lr = label.getBoundingClientRect();
              const s = getComputedStyle(badge);
              return {
                drawn: Math.round(lr.left - ir.right),
                css: Math.round(parseFloat(s.columnGap) || 0),
                display: s.display,
                labelIsElement: true,
                onOneLine: Math.abs((ir.top + ir.bottom) - (lr.top + lr.bottom)) < 3,
              };
            })(),
          };
        })(),
        // A glyph and a caption per fact row, and NOTHING drawn around either of them.
        factRows: ['Notes', 'Uploaded'].map(name => {
          const td = el(`#mediaRecordTable tbody tr.docs-media-row td[data-label="${name}"]`);
          if (!td) return null;
          const s = getComputedStyle(td);
          const after = getComputedStyle(td, '::after');
          const before = getComputedStyle(td, '::before');
          return {
            name,
            display: s.display,
            // No rule, no box, no wash. There WAS a border-top here, and it did not
            // render as a line: an older max-width:768 block puts `border-radius: 18px`
            // on every cell in this table, so a 1px top border came out with both ends
            // curving down and read as the outline of a rounded box.
            rule: s.borderTopWidth,
            radius: s.borderTopLeftRadius,
            bg: s.backgroundColor,
            glyph: after.content,
            glyphFamily: after.fontFamily,
            // Weight 900 or the code point is not in the face and renders as a box.
            glyphWeight: after.fontWeight,
            caption: before.content,
            // Small, and centred in the track rather than pinned to its start. These mark
            // two quiet facts; at the 42px they were briefly given they carried more
            // weight than the type badge and as much as the dust bin.
            chip: after.width,
            chipPlaced: after.justifySelf,
          };
        }),
        // ONE TEXT COLUMN. The first grid track of a fact row is the THUMBNAIL's width,
        // not the glyph chip's, so the caption and the value start exactly where the
        // filename starts. It was the chip's width, which put every line below the title
        // 26px to its left and gave the card two ragged left edges.
        columns: (() => {
          const row = el('#mediaRecordTable tbody tr.docs-media-row');
          if (!row) return null;
          const left = n => (n ? Math.round(n.getBoundingClientRect().left) : null);
          return {
            card: left(row),
            thumb: left(row.querySelector('.docs-thumb')),
            name: left(row.querySelector('.docs-file-meta strong')),
            note: left(row.querySelector('td[data-label="Notes"] .docs-notes-cell')),
            date: left(row.querySelector('td[data-label="Uploaded"] .docs-date-day')),
          };
        })(),
        // The corner play badge is gone. It was decoration that three overflow:hidden
        // ancestors kept cropping, and the icon plus a pressable row already say the
        // file opens.
        playBadges: document.querySelectorAll('#docs .docs-file-play').length,
        // The vault's dust bin, not a 101px "× DELETE" pill.
        trash: (() => {
          const t = el('#docs .docs-trash-btn');
          if (!t) return null;
          const r = t.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height), label: t.getAttribute('aria-label') || '' };
        })(),
        oldDeletePill: document.querySelectorAll('#docs .docs-action-stack .docs-action-btn').length,
        // TYPE and SIZE are in the markup at every width and only drawn from 769px up.
        // Both are already in the grey "VIDEO · 3.1 MB" line under the filename here,
        // and the card grid has named areas — an unplaced cell would be auto-placed
        // into it and shove the layout around.
        typeCell: (() => {
          const c = el('#docs td.docs-col-type');
          return c ? getComputedStyle(c).display : 'missing';
        })(),
        sizeCell: (() => {
          const c = el('#docs td.docs-col-size');
          return c ? getComputedStyle(c).display : 'missing';
        })(),
        // The thumbnail is live. There used to be a matchMedia watcher that set
        // `disabled` on this from 769px up, because the desktop had the eye button
        // instead; with one control left there is no width at which it is inert.
        openDisabled: (() => {
          const b = el('#docs .docs-file-open');
          return b ? b.disabled : null;
        })(),
        // The date sat indented under a label flush to the card edge, because the
        // 760px block sets .docs-date-cell { justify-content: center; width: 100% }
        // and the newer rule never mentioned either property.
        //
        // NOT measured against the card edge any more: the fact rows put a glyph in a
        // column of their own, so both the caption and the value are indented past it.
        // What has to be true is that the value lines up with its caption — which is the
        // same grid column — and the only thing on screen at that column's left edge is
        // the other fact row's value, so the two are measured against each other.
        dateFlush: (() => {
          const td = el('#mediaRecordTable tbody tr.docs-media-row td[data-label="Uploaded"]');
          const val = el('#mediaRecordTable tbody tr.docs-media-row td[data-label="Uploaded"] .docs-date-cell span');
          const note = el('#mediaRecordTable tbody tr.docs-media-row td[data-label="Notes"] .docs-notes-cell');
          if (!td || !val || !note) return null;
          const left = val.getBoundingClientRect().left;
          return {
            alignedWithNotes: Math.abs(left - note.getBoundingClientRect().left) < 2,
            // And clear of the glyph in the first column rather than on top of it.
            clearsGlyph: Math.round(left - td.getBoundingClientRect().left) >= 30,
          };
        })(),
        // Both docs grids are two columns here and both hold an odd number of tiles,
        // so the last one used to sit in the left column with the right half empty.
        // It now spans the row, and it does that from :last-child:nth-child(odd)
        // rather than a hardcoded child index, so it undoes itself when the count
        // turns even. The upload grid also has #uploadProgressBar as a fourth child,
        // which is display:none but still counts for :nth-child.
        grids: (() => {
          const read = sel => {
            const g = document.querySelector(sel);
            if (!g) return null;
            const kids = [...g.children].filter(k => getComputedStyle(k).display !== 'none');
            const last = kids[kids.length - 1];
            if (!last) return null;
            const gw = g.getBoundingClientRect().width;
            const lw = last.getBoundingClientRect().width;
            return {
              cols: getComputedStyle(g).gridTemplateColumns.split(' ').length,
              shown: kids.length,
              full: Math.abs(lw - gw) < 2,
              share: Math.round((lw / gw) * 100),
            };
          };
          return { vault: read('.vehicle-docs-grid'), uploads: read('.historic-upload-grid') };
        })(),
        // "Upload document" needs 111px at .84rem and the card gives it 107, with
        // white-space: nowrap. It was clipped mid-word on every empty card.
        upload: (() => {
          const u = el('#docs .doc-card .upload-btn');
          if (!u) return null;
          return { over: u.scrollWidth - u.clientWidth, wrap: getComputedStyle(u).whiteSpace };
        })(),
        // A caption over a filename and one over a Delete button are both redundant.
        // These lost to the generic label rule on ELEMENT COUNT until the override
        // selectors grew a tr.docs-media-row of their own.
        fileLabel: label('#mediaRecordTable tbody tr.docs-media-row td[data-label="File"]'),
        actionLabel: label('#mediaRecordTable tbody tr.docs-media-row td[data-label="Actions"]'),
        whenLabel: label('#mediaRecordTable tbody tr.docs-media-row td[data-label="Uploaded"]'),
        // The head: a glyph in a chip, a two-tone title, the hint underneath.
        head: (() => {
          const mark = el('#docs .docs-history-mark');
          const title = el('#docs .record-history-title');
          const accent = el('#docs .record-history-title span');
          if (!mark || !title) return null;
          return {
            markW: Math.round(mark.getBoundingClientRect().width),
            titleColour: getComputedStyle(title).color,
            accentColour: accent ? getComputedStyle(accent).color : null,
            // Blender Pro is the display face and this is a heading, so it wants it.
            family: /Blender/i.test(getComputedStyle(title).fontFamily),
          };
        })(),
      };
    });

    ok(at('docs: nothing pushes the page sideways'),
      d.pageOver <= 0 && d.sectionOver === 0, `page ${d.pageOver}, section ${d.sectionOver}`);
    ok(at('docs: record history has no frame of its own'), d.panelFrameless === true,
      String(d.panelFrameless));
    ok(at('docs: the media table is a block'),
      d.tableDisplay === 'block' && d.tbodyDisplay === 'block',
      `${d.tableDisplay} / ${d.tbodyDisplay}`);
    ok(at('docs: and fits its wrapper'), d.tableOver === 0, `${d.tableOver}px over`);
    ok(at('docs: a filtered-out row is really hidden here too'),
      d.hideRule === 'none', String(d.hideRule));
    ok(at('docs: a media row is a card'), d.rowDisplay === 'grid', d.rowDisplay);
    ok(at('docs: with four cells drawn, not six'),
      d.cells === 6 && d.cellsShown === 4, `${d.cellsShown} of ${d.cells}`);
    // 'flex', not 'block'. That line used to be one grey sentence reading
    // "audio · 1.9 MB"; it is a row holding the type BADGE and the size now, because a
    // card has no columns to read down and the type is the fastest thing to recognise
    // about a file. What matters is that it is drawn at all — the desktop pass asserts
    // it is not.
    ok(at('docs: type and size stay on the filename line'),
      d.metaLine !== 'none' && !!d.metaLine, String(d.metaLine));
    ok(at('docs: as a badge beside the size, not a grey sentence'),
      d.tags && d.tags.display === 'flex' && d.tags.sameRow === true
        && d.tags.badgeFirst === true && d.tags.badgeColour !== d.tags.sizeColour,
      JSON.stringify(d.tags));
    ok(at('docs: separated by a drawn dot, which cannot sit off centre'),
      d.tags && d.tags.dot && d.tags.dot.empty === true
        && d.tags.dot.w === '3px' && d.tags.dot.round !== '0px'
        && d.tags.dot.painted === true,
      JSON.stringify(d.tags && d.tags.dot));
    // Drawn, not merely computed. The whole point of measuring it: the gap read back as
    // 9px for two rounds while the glyph was touching the V of VIDEO.
    ok(at('docs: and the badge glyph is spaced off its own label'),
      d.tags && d.tags.glyphGap && d.tags.glyphGap.drawn >= 6
        && d.tags.glyphGap.drawn === d.tags.glyphGap.css
        && /flex/.test(d.tags.glyphGap.display)
        && d.tags.glyphGap.onOneLine === true,
      JSON.stringify(d.tags && d.tags.glyphGap));
    ok(at('docs: notes and uploaded each get a glyph and a caption'),
      d.factRows && d.factRows.length === 2 && d.factRows.every(r => r
        && r.display === 'grid'
        && /Font Awesome 6 Free/.test(r.glyphFamily) && r.glyphWeight === '900'
        && r.glyph !== 'none' && r.glyph !== 'normal'
        && r.caption !== 'none')
        // Two different glyphs: a page for the note, a calendar for the date.
        && d.factRows[0].glyph !== d.factRows[1].glyph,
      JSON.stringify(d.factRows));
    // Asked for, and the reason the rule that was here had to go at all: it never drew as
    // a rule. Checked as three separate properties because zeroing the border without
    // zeroing the radius is what produced the rounded box in the first place.
    ok(at('docs: and nothing drawn around either of them'),
      d.factRows && d.factRows.every(r => r && r.rule === '0px' && r.radius === '0px'
        && /rgba\(0, 0, 0, 0\)|transparent/.test(r.bg)),
      JSON.stringify(d.factRows && d.factRows.map(r => `${r.name} ${r.rule}/${r.radius}/${r.bg}`)));
    ok(at('docs: their glyph chips stay small, and centred in their track'),
      d.factRows && d.factRows.every(r => r
        && parseFloat(r.chip) >= 26 && parseFloat(r.chip) <= 34
        && r.chipPlaced === 'center'),
      JSON.stringify(d.factRows && d.factRows.map(r => `${r.name} ${r.chip} ${r.chipPlaced}`)));
    ok(at('docs: every line of text on the card shares one left edge'),
      d.columns && d.columns.name === d.columns.note
        && d.columns.note === d.columns.date
        // And the filename is indented past the picture, which is the edge it follows.
        && d.columns.name > d.columns.thumb,
      JSON.stringify(d.columns));
    // 230, not 210. The card holds a 60px picture and two captioned fact rows with a
    // rule between them now, which measures ~212 at 360 — the old ceiling was set when
    // it held a 40px glyph and no rules. The fault this guards against is unchanged: a
    // card whose cells have each become a box of their own measured 386.
    ok(at('docs: and is not a stack of boxes'), d.row && d.row.h < 230, d.row && `${d.row.h}px`);
    ok(at('docs: the old Preview pill is gone'), d.previewPills === 0, String(d.previewPills));
    ok(at('docs: and so is the eye button and its column'),
      d.eyeButtons === 0, String(d.eyeButtons));
    ok(at('docs: both pencil buttons are gone'), d.pencils === 0, String(d.pencils));
    ok(at('docs: every row opens from its thumbnail'),
      d.openBtns === 3 && d.openIsButton === 'button', `${d.openBtns} / ${d.openIsButton}`);
    ok(at('docs: and there is exactly one way to open a row'),
      d.openPerRow === 1 && d.openDisabled === false,
      `${d.openPerRow} control(s), disabled ${d.openDisabled}`);
    // 56 at 360px, 50 below 360. Square either way, and clipping whatever is dropped
    // into it. The floor is what matters: at the 40px this used to be — the size of the
    // file-type GLYPH it replaced — a landscape photograph is unrecognisable, and being
    // recognisable is the only reason it is there.
    ok(at('docs: the thumbnail is a square big enough to read'),
      d.thumb && d.thumb.w === d.thumb.h && d.thumb.w >= 48
        && d.thumb.clips === 'hidden',
      JSON.stringify(d.thumb));
    ok(at('docs: and carries no play badge'), d.playBadges === 0, String(d.playBadges));
    ok(at('docs: the type and size columns stay off a phone'),
      d.typeCell === 'none' && d.sizeCell === 'none' && d.badges === 6,
      `type ${d.typeCell}, size ${d.sizeCell}, badges in markup ${d.badges}`);
    ok(at('docs: the head is a chip, a two-tone title and a hint'),
      d.head && d.head.markW >= 32 && d.head.family === true
        && d.head.titleColour !== d.head.accentColour,
      JSON.stringify(d.head));
    ok(at('docs: the filename carries no FILE caption'),
      d.fileLabel && (d.fileLabel.content === 'none' || d.fileLabel.display === 'none'),
      JSON.stringify(d.fileLabel));
    ok(at('docs: Delete carries no ACTION caption'),
      d.actionLabel && (d.actionLabel.content === 'none' || d.actionLabel.display === 'none'),
      JSON.stringify(d.actionLabel));
    ok(at('docs: but the date keeps its label'),
      d.whenLabel && d.whenLabel.content.includes('Uploaded') && d.whenLabel.display !== 'none',
      JSON.stringify(d.whenLabel));
    // 40 on a card and 38 below 360, not the desktop's 34: it is the only destructive
    // control on the card and 34 is under every target-size guideline there is. Round,
    // and the only thing in its cell — the "× DELETE" pill it replaced was 101px.
    ok(at('docs: delete is the vault dust bin, at a size a thumb can hit'),
      d.trash && d.trash.w === d.trash.h && d.trash.w >= 38 && d.oldDeletePill === 0,
      `${JSON.stringify(d.trash)} / old pills: ${d.oldDeletePill}`);
    ok(at('docs: and it still says what it deletes'),
      d.trash && /Delete .+/.test(d.trash.label), d.trash && d.trash.label);
    ok(at('docs: the two fact rows line up under their glyphs'),
      d.dateFlush && d.dateFlush.alignedWithNotes === true && d.dateFlush.clearsGlyph === true,
      JSON.stringify(d.dateFlush));
    ok(at('docs: the odd tile out fills the row in the vault grid'),
      d.grids && d.grids.vault && d.grids.vault.cols === 2
        && (d.grids.vault.shown % 2 === 0 || d.grids.vault.full === true),
      JSON.stringify(d.grids && d.grids.vault));
    ok(at('docs: and in the upload grid, so Historic Videos is not half a tile'),
      d.grids && d.grids.uploads && d.grids.uploads.cols === 2
        && (d.grids.uploads.shown % 2 === 0 || d.grids.uploads.full === true),
      JSON.stringify(d.grids && d.grids.uploads));
    ok(at('docs: the vault Upload label is not clipped'),
      d.upload && d.upload.over <= 0 && d.upload.wrap !== 'nowrap',
      d.upload && `${d.upload.over}px over, white-space ${d.upload.wrap}`);

    // ── Holding a row has to LOOK like it is doing something ──
    // A real press, not a class poked in by hand, so the delegated pointer wiring is
    // covered too. scrollIntoViewIfNeeded first: the row sits ~2000px down the docs
    // page and a click at that y lands outside the viewport, which is indistinguish-
    // able from a dead listener.
    {
      const cell = await page.$('#mediaRecordTable tbody tr.docs-media-row .docs-notes-cell');
      let hold = null;
      if (cell) {
        await cell.scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        const bx = await cell.boundingBox();
        await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2);
        await page.mouse.down();
        // Sampled mid-flight, while the fill is partway across.
        await page.waitForTimeout(220);
        hold = await page.evaluate(() => {
          const r = document.querySelector('#mediaRecordTable tbody tr.docs-media-row');
          const s = getComputedStyle(r, '::after');
          return {
            marked: r.classList.contains('is-holding'),
            animation: s.animationName,
            // A static scaleX(1) would mean no animation is running at all.
            partial: /matrix\(0\.\d/.test(s.transform),
          };
        });
        // Held past HOLD_MS (520) before releasing, or pointerup clears the timer and
        // the sheet never opens — releasing at 220ms is a CANCELLED hold, which is
        // correct behaviour and not what this is testing.
        await page.waitForTimeout(420);
        await page.mouse.up();
        await page.waitForTimeout(350);
      }
      ok(at('docs: holding a row shows the service fill bar'),
        hold && hold.marked && hold.animation === 'svcHoldFill' && hold.partial,
        JSON.stringify(hold));
      const sheet = await page.evaluate(() => {
        const m = document.getElementById('historicNotesModal');
        const open = m.classList.contains('show');
        const dated = !document.getElementById('historicNotesDateField').hasAttribute('hidden');
        if (open) document.getElementById('historicNotesCancel')?.click();
        return { open, dated };
      });
      ok(at('docs: and then opens one sheet for the note and the date'),
        sheet.open === true && sheet.dated === true, JSON.stringify(sheet));
      await page.waitForTimeout(250);
    }

    // ── The filter panel is the SAME component as the service one ──
    // Same class names throughout, so the service block names both panels rather
    // than being copied and left to drift.
    await page.evaluate(() => {
      const b = document.getElementById('docsHistoryFilterToggle');
      if (b) b.click();
    });
    await page.waitForTimeout(320);
    const f = await page.evaluate(() => {
      const p = document.getElementById('docsHistoryFilters');
      if (!p) return null;
      const s = getComputedStyle(p);
      const seen = {};
      p.querySelectorAll('.history-control').forEach(c => {
        const y = Math.round(c.getBoundingClientRect().top);
        seen[y] = (seen[y] || 0) + 1;
      });
      const t = document.getElementById('docsHistoryFilterToggle').getBoundingClientRect();
      const c = document.getElementById('docsHistoryClearFilters').getBoundingClientRect();
      const chev = getComputedStyle(p.querySelector('.custom-history-select'), '::after');
      return {
        display: s.display,
        cols: s.gridTemplateColumns.split(' ').length,
        paired: Object.values(seen).some(n => n === 2),
        sameRow: Math.abs(t.top - c.top) < 4,
        btnH: [Math.round(t.height), Math.round(c.height)],
        // A 48px line-height on the docs .date-display made those two fields 72px
        // beside 45px ones. The shared rule outranked it but never MENTIONED
        // line-height, so the 48px still won.
        shellH: [...new Set([...p.querySelectorAll('.history-input-shell')]
          .map(e => Math.round(e.getBoundingClientRect().height)))],
        chevronRotated: chev.transform !== 'none',
      };
    });
    ok(at('docs filters: open as two columns'), f && f.display === 'grid' && f.cols === 2,
      f && `${f.display} / ${f.cols}`);
    ok(at('docs filters: From and To share a row'), f && f.paired === true, f && String(f.paired));
    ok(at('docs filters: Filters and Clear are side by side'), f && f.sameRow === true,
      f && String(f.sameRow));
    ok(at('docs filters: and neither is oversized'),
      f && f.btnH.every(h => h > 0 && h <= 46), f && f.btnH.join(','));
    ok(at('docs filters: every field is the same height'),
      f && f.shellH.length === 1 && f.shellH[0] >= 44, f && f.shellH.join(','));
    ok(at('docs filters: the chevron is still rotated'), f && f.chevronRotated === true,
      f && String(f.chevronRotated));

    await page.evaluate(() => {
      const b = document.getElementById('docsHistoryFilterToggle');
      if (b) b.click();
    });
    // Longer than the 260ms collapse, so the height being measured below is the one
    // the panel has settled at rather than the one it is leaving.
    await page.waitForTimeout(400);
    // Same measured test as the service panel above, and for the same reason: the
    // panel collapses its height rather than switching `display` off, so that it can
    // animate. See the note beside the service-side check.
    ok(at('docs filters: the button shuts the panel again'),
      await page.evaluate(() => {
        const p = document.getElementById('docsHistoryFilters');
        return !p || p.offsetHeight <= 2 || getComputedStyle(p).visibility === 'hidden';
      }),
      'panel stayed open');

    // ── THE PAGE STRIP HAS TO FIT A PHONE ──
    //
    // Twelve pages is the worst case the windowing can produce: the first, the last, the
    // current one and an ellipsis on each side. Measured at 320 with the wide shape — five
    // numbers, two ellipses, two arrows — that came to 316px inside 296 of usable width,
    // and the answer for a while was to hide the numbers below 340px. Hiding them gives up
    // the part that says where you are, so the strip drops to five slots below 400 instead
    // and keeps 34px targets. This asserts the sums.
    {
      // SWEPT, not spot-checked. The strip's width depends on the page COUNT in two ways
      // at once — below stripShape()'s threshold every page gets a button, above it the
      // count collapses to first / current / last plus ellipses — so the widest case is
      // not the largest list. Hand-picking twelve pages passed while five overflowed.
      const sweep = await page.evaluate(() => {
        const body = document.querySelector('#mediaRecordTable tbody');
        const one = body.querySelector('tr.docs-media-row');
        if (!one) return null;
        const pager = document.getElementById('docsHistoryPager');
        const nav = document.getElementById('docsHistoryNav');
        const room = () => Math.round(pager.clientWidth
          - parseFloat(getComputedStyle(pager).paddingLeft)
          - parseFloat(getComputedStyle(pager).paddingRight));
        const worst = [];
        // 1 to 12 pages, at ten rows a page.
        for (let pages = 1; pages <= 12; pages += 1) {
          body.innerHTML = '';
          for (let i = 0; i < pages * 10; i += 1) {
            const copy = one.cloneNode(true);
            copy.dataset.mediaId = String(5000 + i);
            body.appendChild(copy);
          }
          window.dkDocsPager.refresh();
          // Walk every page, because the strip is at its widest somewhere in the middle.
          for (let p = 1; p <= pages; p += 1) {
            if (p > 1) document.getElementById('docsHistoryNext').click();
            const items = [...document.querySelectorAll('#docsHistoryPages > *')]
              .filter(n => getComputedStyle(n).display !== 'none');
            worst.push({
              pages,
              page: p,
              navW: Math.round(nav.getBoundingClientRect().width),
              room: room(),
              items: items.length,
              label: items.map(n => n.textContent.trim() || '~').join(' '),
            });
          }
        }
        const btns = [...nav.querySelectorAll('.dk-pager-step, .dk-pager-num')];
        return {
          over: worst.filter(w => w.navW > w.room),
          widest: worst.reduce((a, b) => (b.navW > a.navW ? b : a)),
          target: Math.min(...btns.map(b => Math.round(b.getBoundingClientRect().height))),
          // Its own line, so the count and the select cannot squeeze it.
          ownLine: nav.getBoundingClientRect().top
            > document.getElementById('docsHistoryRange').getBoundingClientRect().bottom - 2,
        };
      });
      ok(at('docs pages: no page count overflows the strip'),
        sweep && sweep.over.length === 0,
        sweep && `${sweep.over.length} of 78 cases over, worst ${JSON.stringify(sweep.over[0] || sweep.widest)}`);
      ok(at('docs pages: and its buttons are still reachable'),
        sweep && sweep.target >= 34 && sweep.ownLine === true,
        sweep && `${sweep.target}px tall, own line ${sweep.ownLine}`);
      // Put the fixture back for the blocks below.
      await page.evaluate(({ rows, map }) => {
        document.querySelector('#mediaRecordTable tbody').innerHTML = rows;
        window._historicMediaRows = new Map(map);
        window.dkDocsPager.refresh();
      }, { rows: DOCS_ROWS, map: DOCS_MAP });
      await page.waitForTimeout(250);
    }

    // ── The player ──
    // Opened on the SECOND row, so the counter proves it starts where it was asked
    // to rather than at the beginning.
    await page.evaluate(() => {
      const b = document.querySelector('#mediaRecordTable tbody tr[data-media-id="2"] .docs-file-open');
      if (b) b.click();
    });
    await page.waitForTimeout(500);
    const pl = await page.evaluate(() => {
      const el = document.getElementById('docsPlayer');
      const stage = document.getElementById('docsPlayerStage');
      const first = stage.querySelector('.docs-player-slide');
      return {
        open: el.classList.contains('is-open'),
        slides: stage.querySelectorAll('.docs-player-slide').length,
        count: document.getElementById('docsPlayerCount').textContent,
        name: document.getElementById('docsPlayerName').textContent,
        snap: getComputedStyle(stage).scrollSnapType,
        slideFull: first ? Math.abs(first.getBoundingClientRect().width - stage.clientWidth) <= 1 : null,
        locked: document.body.classList.contains('docs-player-lock'),
      };
    });
    ok(at('docs player: opens from the type icon'), pl.open === true, String(pl.open));
    ok(at('docs player: holds every record, not just the one tapped'),
      pl.slides === 3, String(pl.slides));
    ok(at('docs player: and opens on the one that was tapped'),
      pl.count === '2 / 3' && pl.name === 'cold-start-6000km.m4a', `${pl.count} ${pl.name}`);
    ok(at('docs player: swiping is real scroll snapping'),
      /mandatory/.test(pl.snap) && pl.slideFull === true, `${pl.snap} / full:${pl.slideFull}`);
    ok(at('docs player: the page behind it cannot scroll'), pl.locked === true, String(pl.locked));

    // ── The media must FIT, and the controls must be reachable ──
    //
    // Measured at 1440x900 before this was rebuilt: a 1500x2004 photo rendered
    // 1412x1886 inside a 732px frame. A percentage max-height needs a definite height
    // on the containing block and this chain is percentages most of the way up, so the
    // browser dropped it. The picture overflowed and read as zoomed; a video's native
    // control bar ended up a thousand pixels below the visible area, which read as a
    // video that would not play. The media is positioned and object-fit: contain now.
    //
    // The bar is ours, which also means the seek slider is the ONLY thing claiming a
    // horizontal drag — touch-action: none on the whole <video> had killed the swipe
    // across the entire picture.
    const fit = await page.evaluate(() => {
      const inside = sel => {
        const m = document.querySelector(sel);
        if (!m) return null;
        const frame = m.closest('.docs-player-frame');
        if (!frame) return null;
        const a = m.getBoundingClientRect();
        const b = frame.getBoundingClientRect();
        return { fits: a.height <= b.height + 1 && a.width <= b.width + 1, fit: getComputedStyle(m).objectFit };
      };
      const stage = document.getElementById('docsPlayerStage');
      const dkp = document.querySelector('#docsPlayerStage .dkp');
      const bar = dkp?.querySelector('.dkp-bar');
      const media = dkp?.querySelector('.dkp-media');
      const frame = dkp?.closest('.docs-player-frame');
      return {
        image: inside('#docsPlayerStage img'),
        barInsideFrame: bar && frame
          ? bar.getBoundingClientRect().bottom <= frame.getBoundingClientRect().bottom + 1
            && bar.getBoundingClientRect().height > 0
          : null,
        coded: dkp ? {
          play: !!dkp.querySelector('.dkp-play'),
          seek: !!dkp.querySelector('.dkp-seek'),
          mute: !!dkp.querySelector('.dkp-mute'),
          nativeControls: media ? media.hasAttribute('controls') : null,
        } : null,
        seekTouch: dkp ? getComputedStyle(dkp.querySelector('.dkp-seek')).touchAction : null,
        mediaTouch: media ? getComputedStyle(media).touchAction : null,
        stageTouch: getComputedStyle(stage).touchAction,
        saveBtn: !!document.getElementById('docsPlayerSave'),
        navShown: ['docsPlayerPrev', 'docsPlayerNext']
          .every(id => getComputedStyle(document.getElementById(id)).display !== 'none'),
      };
    });
    ok(at('docs player: the image letterboxes instead of overflowing'),
      fit.image && fit.image.fits && fit.image.fit === 'contain', JSON.stringify(fit.image));
    ok(at('docs player: the control bar is inside the frame'),
      fit.barInsideFrame === true, String(fit.barInsideFrame));
    ok(at('docs player: and it is ours, not the browser\'s'),
      fit.coded && fit.coded.play && fit.coded.seek && fit.coded.mute
        && fit.coded.nativeControls === false, JSON.stringify(fit.coded));
    ok(at('docs player: only the seek slider takes the sideways drag'),
      fit.seekTouch === 'none' && fit.mediaTouch !== 'none' && /pan-x/.test(fit.stageTouch),
      `seek ${fit.seekTouch}, media ${fit.mediaTouch}, stage ${fit.stageTouch}`);
    ok(at('docs player: every record can be downloaded'), fit.saveBtn === true, String(fit.saveBtn));
    ok(at('docs player: the arrows stay on a phone'), fit.navShown === true, String(fit.navShown));

    // Play and pause through our own button, on a file the browser can decode.
    const toggled = await page.evaluate(async () => {
      const dkp = document.querySelector('#docsPlayerStage .dkp');
      if (!dkp) return null;
      const media = dkp.querySelector('.dkp-media');
      const btn = dkp.querySelector('.dkp-play');
      // A real WAV the harness serves, so play() resolves instead of rejecting on a
      // codec it cannot handle.
      media.src = '/_audit-test.wav';
      await new Promise(r => setTimeout(r, 400));
      const before = media.paused;
      btn.click();
      await new Promise(r => setTimeout(r, 350));
      const playing = !media.paused;
      const icon = dkp.querySelector('.dkp-play i').className;
      btn.click();
      await new Promise(r => setTimeout(r, 250));
      return { before, playing, icon, pausedAgain: media.paused };
    });
    ok(at('docs player: the play button plays and pauses'),
      toggled && toggled.before && toggled.playing && /fa-pause/.test(toggled.icon)
        && toggled.pausedAgain, JSON.stringify(toggled));

    // Arrows must move it, since on a video they are the only way through.
    await page.evaluate(() => document.getElementById('docsPlayerNext')?.click());
    await page.waitForTimeout(550);
    ok(at('docs player: an arrow moves to the next record'),
      await page.evaluate(() => document.getElementById('docsPlayerCount').textContent === '3 / 3'),
      await page.evaluate(() => document.getElementById('docsPlayerCount').textContent));

    await page.keyboard.press('Escape');
    await page.waitForTimeout(280);
    const shut = await page.evaluate(() => ({
      closed: !document.getElementById('docsPlayer').classList.contains('is-open'),
      unlocked: !document.body.classList.contains('docs-player-lock'),
      emptied: document.getElementById('docsPlayerStage').children.length === 0,
    }));
    ok(at('docs player: Escape closes it and lets go of the page'),
      shut.closed && shut.unlocked && shut.emptied, JSON.stringify(shut));

    if (SHOTS) {
      for (const [sel, name] of [
        ['#docs .service-history-panel', 'docs-history'],
        ['#mediaRecordTable tbody tr.docs-media-row', 'docs-row'],
      ]) {
        const node = await page.$(sel);
        if (node) await node.screenshot({ path: `tools/_shot-${name}-${size.name}-${TAG}.png` });
      }
      await page.screenshot({ path: `tools/_shot-docs-${size.name}-${TAG}.png` });
    }

    // Back to service, so the screenshots below are of what they say they are.
    await page.evaluate(() => {
      if (typeof window.dkNavigate === 'function') window.dkNavigate('service');
    });
    await page.waitForTimeout(300);
  }

  ok(at('no page errors'), errors.length === 0, errors.join(' | '));

  if (SHOTS) {
    for (const [sel, name] of [
      ['#serviceEntryForm', 'form'],
      ['#serviceTableBody tr.service-record-row', 'card'],
      ['#serviceHistoryFilters', 'filters'],
      ['.history-header-actions', 'actions'],
    ]) {
      const el = await page.$(sel);
      if (el) await el.screenshot({ path: `tools/_shot-${name}-${size.name}-${TAG}.png` });
    }
    await page.screenshot({ path: `tools/_shot-full-${size.name}-${TAG}.png` });
  }
  await page.close();
}

// ══ AND THE SAME PAGE ON A DESKTOP ═══════════════════════════════════════
//
// A separate pass rather than a third entry in SIZES, because almost everything
// above asserts the phone CARD layout and would be wrong here by design — at this
// width the record history is a real table with a visible thead.
//
// It gets its own pass at all because the table's columns were sharing width by
// content: at 1440 that gave File 466px, Notes 171px, Uploaded 154px and Action
// 324px, so the one column holding prose got half of what the column holding a
// single button took.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.slice(0, 120)));
  // Same reason as the phone pass: the live loader must not race the fixture.
  await page.route('**://*.supabase.co/**', r => r.abort());
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  // Same reason as the phone pass: the live loader must not race the fixture, and it
  // cannot be stubbed from out here — see the note in that pass.
  await page.evaluate(() => {
    if (typeof window.dkNavigate === 'function') window.dkNavigate('docs');
  });
  await page.waitForTimeout(600);
  await page.evaluate(({ rows, map }) => {
    document.querySelector('#mediaRecordTable tbody').innerHTML = rows;
    window._historicMediaRows = new Map(map);
    document.querySelectorAll('canvas').forEach(c => { c.style.visibility = 'hidden'; });
    // Both signers, counted, and the frame cache emptied — same reasons as the phone
    // pass; see the note there.
    window.__signCalls = { batch: 0, single: 0, names: [] };
    window.dkGetHistoricMediaUrl = async () => {
      window.__signCalls.single += 1;
      return './assets/img/sage.webp';
    };
    window.dkSignHistoricMediaBatch = async names => {
      window.__signCalls.batch += 1;
      window.__signCalls.names.push(...names);
      return new Map(names.map(n => [n, './assets/img/sage.webp']));
    };
    try { localStorage.removeItem('spinlogThumbs.v1'); } catch { /* private mode */ }
  }, { rows: DOCS_ROWS, map: DOCS_MAP });
  await page.waitForTimeout(400);

  const at = s => `[desktop] ${s}`;
  const w = await page.evaluate(() => {
    const q = s => document.querySelector(s);
    const table = q('#mediaRecordTable');
    const cols = [...(q('#mediaRecordTable thead tr') || { children: [] }).children]
      .map(th => ({ t: th.textContent.trim(), w: Math.round(th.getBoundingClientRect().width) }));
    const total = cols.reduce((a, c) => a + c.w, 0) || 1;
    const trash = q('#docs .docs-trash-btn');
    const firstCol = (cols.find(c => c.t === 'File') || {}).w || 0;
    return {
      pageOver: document.documentElement.scrollWidth - window.innerWidth,
      sectionOver: (() => { const s = q('#docs'); return s ? s.scrollWidth - s.clientWidth : null; })(),
      // The wrapper is overflow-x: hidden, so an over-wide table never reaches the
      // page or the section — it is quietly shaved off the right instead, which is
      // how the ACTION column came to look cut in half. Measure the wrapper itself.
      wrapOver: (() => {
        const p = q('#docs .docs-history-wrap');
        return p ? p.scrollWidth - p.clientWidth : null;
      })(),
      theadShown: q('#mediaRecordTable thead')
        ? getComputedStyle(q('#mediaRecordTable thead')).display !== 'none' : null,
      tableDisplay: table ? getComputedStyle(table).display : null,
      layout: table ? getComputedStyle(table).tableLayout : null,
      cols,
      notesShare: Math.round(((cols.find(c => c.t === 'Notes') || {}).w / total) * 100),
      actionShare: Math.round(((cols.find(c => c.t === 'Actions') || {}).w / total) * 100),
      // Type and Size become real columns here, which is what closed the gap: four
      // columns of short facts left ~470px of nothing spread across the row.
      typeSize: (() => {
        const t = q('#docs td.docs-col-type');
        const s = q('#docs td.docs-col-size');
        if (!t || !s) return null;
        // The badge in the TYPE CELL, named explicitly. There are two per row now — the
        // other is on the line under the filename, which is the phone card's copy and is
        // display:none here, so a bare `.docs-type-badge` would measure a 0x0 box and
        // every size assertion below would pass by being meaningless.
        const badge = q('#docs td.docs-col-type .docs-type-badge');
        const br = badge && badge.getBoundingClientRect();
        return {
          type: getComputedStyle(t).display,
          size: getComputedStyle(s).display,
          // And the phone card's copy is off, or the row says the type twice.
          tagsLine: (() => {
            const line = q('#docs .docs-file-tags');
            return line ? getComputedStyle(line).display : 'missing';
          })(),
          // A label, not a control. NOT checked by cursor: the whole row is pressable
          // for hold-to-edit and sets `cursor: pointer`, which every child inherits —
          // asserting on it here would be asserting the row is not a row. What matters
          // is that it is not focusable and is small enough to read as a tag.
          badgeTag: badge ? badge.tagName.toLowerCase() : null,
          badgeFocusable: badge ? (badge.tabIndex >= 0 || badge.hasAttribute('role')) : null,
          badgeH: br ? Math.round(br.height) : null,
          badgeW: br ? Math.round(br.width) : null,
          badges: document.querySelectorAll('#docs .docs-type-badge').length,
          // The glyph's gap from its label, measured here too — see the long note on the
          // phone pass. This is the width at which it always worked, which is what makes
          // it worth asserting: it proves the fault was the cascade on a card and not the
          // badge itself.
          glyphGap: (() => {
            const i = badge && badge.querySelector('i');
            const label = badge && badge.querySelector('.docs-type-label');
            if (!i || !label) return null;
            return {
              drawn: Math.round(label.getBoundingClientRect().left - i.getBoundingClientRect().right),
              css: Math.round(parseFloat(getComputedStyle(badge).columnGap) || 0),
              display: getComputedStyle(badge).display,
            };
          })(),
          // and the inline "VIDEO · 1.6 MB" duplicate is gone
          metaLine: (() => {
            const m = q('#docs .docs-file-meta span');
            return m ? getComputedStyle(m).display : null;
          })(),
        };
      })(),
      // The thumbnail is the open control at THIS width too. It was the other way
      // round: a matchMedia watcher disabled this button from 769px up and aria-hid it,
      // because the Preview column owned opening the file. Both are gone.
      openIcons: (() => {
        const all = [...document.querySelectorAll('#docs .docs-file-open')];
        const one = all[0];
        const r = one && one.getBoundingClientRect();
        return {
          n: all.length,
          anyDisabled: all.some(b => b.disabled === true),
          hidden: one ? one.getAttribute('aria-hidden') : null,
          focusable: one ? one.matches(':enabled') : null,
          w: r ? Math.round(r.width) : null,
          h: r ? Math.round(r.height) : null,
          // Landscape, and it clips whatever picture is dropped into it.
          clips: one ? getComputedStyle(one).overflow : null,
          opens: one ? one.getAttribute('data-media-open') : null,
          // The audio row is the one with no frame to fetch, so it must not ask for one.
          thumbSlots: document.querySelectorAll('#docs .docs-thumb[data-thumb]').length,
        };
      })(),
      // The measure of "empty space": how far the longest filename's right edge sits
      // from the right edge of the column holding it.
      fileSlack: (() => {
        const td = q('#mediaRecordTable tbody tr td[data-label="File"]');
        if (!td) return null;
        const longest = [...document.querySelectorAll('#docs .docs-file-meta strong')]
          .reduce((a, s) => Math.max(a, s.getBoundingClientRect().right), 0);
        return Math.round(td.getBoundingClientRect().right - longest);
      })(),
      playBadges: document.querySelectorAll('#docs .docs-file-play').length,
      // The filename is the longest thing in the row and it was the thing being
      // truncated, while the notes column sat 400px wide holding "No notes saved".
      fileShare: Math.round((firstCol / total) * 100),
      nameTruncated: (() => {
        const s = q('#docs .docs-file-meta strong');
        return s ? s.scrollWidth > s.clientWidth + 1 : null;
      })(),
      trash: trash ? Math.round(trash.getBoundingClientRect().width) : null,
      // The bin has to sit under the middle of the word ACTION. It did not: an older
      // `#docs .docs-action-stack { display: grid; grid-template-columns: repeat(2,
      // minmax(0,1fr)) }` with !important survived from when this cell held two pills,
      // so the lone bin sat in the first of two tracks — 25px left of centre.
      binOffset: (() => {
        const th = [...(q('#mediaRecordTable thead tr') || { children: [] }).children].pop();
        const b = q('#docs .docs-trash-btn');
        if (!th || !b) return null;
        const tr = th.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return Math.round((br.left + br.right) / 2 - (tr.left + tr.right) / 2);
      })(),
      stackDisplay: (() => {
        const s = q('#docs .docs-action-stack');
        return s ? getComputedStyle(s).display : null;
      })(),
      // How many filenames break onto a second line. FILE is 44% because at 34% it
      // was three of ten and at 44% it is one.
      nameLines: (() => {
        const all = [...document.querySelectorAll('#docs .docs-file-meta strong')];
        if (!all.length) return null;
        const lh = parseFloat(getComputedStyle(all[0]).lineHeight);
        const lines = all.map(s => Math.round(s.getBoundingClientRect().height / lh));
        return { wrapped: lines.filter(l => l > 1).length, max: Math.max(...lines) };
      })(),
      // UPLOADED is two lines here, day over time, and the day is the line that leads.
      when: (() => {
        const day = q('#docs .docs-date-day');
        const time = q('#docs .docs-date-time');
        if (!day || !time) return null;
        const dr = day.getBoundingClientRect();
        const tr = time.getBoundingClientRect();
        return {
          stacked: tr.top >= dr.bottom - 1,
          sameLeft: Math.abs(tr.left - dr.left) < 2,
          dayQuieter: parseFloat(getComputedStyle(time).fontSize) < parseFloat(getComputedStyle(day).fontSize),
          // "4:35 pm" beside "12 Jul 2024" reads as a typo.
          caps: getComputedStyle(time).textTransform,
          wraps: getComputedStyle(day).whiteSpace,
        };
      })(),
      // The header cell for it is a button, because the arrow IS the control.
      sort: (() => {
        const b = q('#docsHistorySort');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return {
          tag: b.tagName.toLowerCase(),
          dir: b.dataset.dir,
          ariaSort: b.closest('th')?.getAttribute('aria-sort'),
          glyph: b.querySelector('i')?.className || null,
          // It fills its cell, so the whole header is the target rather than the arrow.
          fills: r.height >= b.closest('th').getBoundingClientRect().height - 1,
        };
      })(),
      // NOTES is the widest column and usually holds "No notes saved", so the note is
      // centred in it — otherwise the text hugs SIZE with 200px of nothing before
      // UPLOADED. The BLOCK centres (fit-content plus auto margins); the text inside
      // it stays left-aligned so a note that wraps does not get a ragged left edge.
      notesCentred: (() => {
        const td = q('#mediaRecordTable tbody tr td[data-label="Notes"]');
        const div = td && td.querySelector('.docs-notes-cell');
        const th = [...(q('#mediaRecordTable thead tr') || { children: [] }).children][3];
        if (!td || !div || !th) return null;
        const mid = r => (r.left + r.right) / 2;
        return {
          blockOffset: Math.round(mid(div.getBoundingClientRect()) - mid(td.getBoundingClientRect())),
          headOffset: Math.round(mid(th.getBoundingClientRect()) - mid(td.getBoundingClientRect())),
          textAlign: getComputedStyle(div).textAlign,
          shrinks: div.getBoundingClientRect().width < td.getBoundingClientRect().width - 20,
        };
      })(),
      notesWraps: (() => {
        const n = q('#docs .docs-notes-cell');
        return n ? getComputedStyle(n).whiteSpace : null;
      })(),
      rowH: (() => {
        const r = q('#mediaRecordTable tbody tr.docs-media-row');
        return r ? Math.round(r.getBoundingClientRect().height) : null;
      })(),
    };
  });

  ok(at('nothing pushes the page sideways'),
    w.pageOver <= 0 && w.sectionOver === 0, `page ${w.pageOver}, section ${w.sectionOver}`);
  ok(at('and the table is not silently shaved by its wrapper'),
    w.wrapOver === 0, `${w.wrapOver}px over`);
  ok(at('record history is still a table with a header'),
    w.tableDisplay === 'table' && w.theadShown === true, `${w.tableDisplay} / thead ${w.theadShown}`);
  // Content-sized, NOT proportioned. Fixed proportions are what left the empty space:
  // a 46% FILE column is 512px whether the filename needs 512 or 180.
  ok(at('its columns are sized to their content'), w.layout === 'auto', w.layout);
  ok(at('type and size are columns of their own'),
    w.typeSize && w.typeSize.type === 'table-cell'
      && w.typeSize.size === 'table-cell' && w.typeSize.metaLine === 'none'
      && w.typeSize.tagsLine === 'none',
    JSON.stringify(w.typeSize));
  ok(at('and the type badge is a label, not a button'),
    w.typeSize && w.typeSize.badges === 6 && w.typeSize.badgeTag === 'span'
      && w.typeSize.badgeFocusable === false
      && w.typeSize.badgeH > 0 && w.typeSize.badgeH <= 30 && w.typeSize.badgeW <= 110,
    JSON.stringify(w.typeSize));
  ok(at('with its glyph spaced off its label'),
    w.typeSize && w.typeSize.glyphGap && w.typeSize.glyphGap.drawn >= 6
      && w.typeSize.glyphGap.drawn === w.typeSize.glyphGap.css
      && /flex/.test(w.typeSize.glyphGap.display),
    JSON.stringify(w.typeSize && w.typeSize.glyphGap));
  ok(at('the thumbnail is the one open control at this width too'),
    w.openIcons && w.openIcons.n === 3 && w.openIcons.anyDisabled === false
      && w.openIcons.focusable === true && w.openIcons.hidden === null
      && w.openIcons.opens === '1',
    JSON.stringify(w.openIcons));
  ok(at('it is a landscape frame that clips its picture'),
    w.openIcons && w.openIcons.w === 52 && w.openIcons.h === 40
      && w.openIcons.clips === 'hidden',
    JSON.stringify(w.openIcons));
  // Signing a URL per row is what "do NOT create signed URLs during list load" exists
  // to avoid, so audio — which has no frame — must not ask for one.
  ok(at('and only a picture or a video asks for a thumbnail'),
    w.openIcons && w.openIcons.thumbSlots === 2, String(w.openIcons && w.openIcons.thumbSlots));
  ok(at('uploaded is the day over the time, not a run-on'),
    w.when && w.when.stacked === true && w.when.sameLeft === true
      && w.when.dayQuieter === true && w.when.caps === 'uppercase'
      && w.when.wraps === 'nowrap',
    JSON.stringify(w.when));
  ok(at('and its header is the sort control itself'),
    w.sort && w.sort.tag === 'button' && w.sort.dir === 'desc'
      && w.sort.ariaSort === 'descending' && /fa-arrow-down/.test(w.sort.glyph)
      && w.sort.fills === true,
    JSON.stringify(w.sort));
  ok(at('and the filename column has no slack left in it'),
    w.fileSlack !== null && w.fileSlack >= 0 && w.fileSlack < 60, `${w.fileSlack}px`);
  ok(at('notes get more room than the delete button'),
    w.notesShare >= 12 && w.actionShare <= 12,
    `notes ${w.notesShare}%, actions ${w.actionShare}% of ${JSON.stringify(w.cols)}`);
  ok(at('and notes are allowed to wrap'), w.notesWraps === 'normal', w.notesWraps);
  ok(at('a short note sits in the middle of its column, under its header'),
    w.notesCentred && Math.abs(w.notesCentred.blockOffset) <= 1
      && Math.abs(w.notesCentred.headOffset) <= 1 && w.notesCentred.shrinks === true,
    JSON.stringify(w.notesCentred));
  ok(at('but the note text itself is left-aligned'),
    w.notesCentred && w.notesCentred.textAlign === 'left',
    w.notesCentred && w.notesCentred.textAlign);
  ok(at('no play badge here either'), w.playBadges === 0, String(w.playBadges));
  // No share floor any more. A floor is what created the problem: 46% of 1114 is
  // 512px whether the name needs it or not. What matters is that the name fits
  // without being cut — see the slack check above for the other half of it.
  ok(at('the filename is never cut short'),
    w.nameTruncated === false, `file ${w.fileShare}% of width, truncated: ${w.nameTruncated}`);
  ok(at('delete is the same dust bin as on a phone'), w.trash === 34, String(w.trash));
  ok(at('and it is centred under the word ACTION'),
    w.stackDisplay === 'flex' && w.binOffset !== null && Math.abs(w.binOffset) <= 1,
    `${w.binOffset}px off centre, stack is ${w.stackDisplay}`);
  ok(at('a filename only breaks onto a second line if it has to'),
    w.nameLines && w.nameLines.wrapped <= 1 && w.nameLines.max <= 2,
    JSON.stringify(w.nameLines));
  // 80, not 110. The Uploaded cell is two lines now and the thumbnail is 40px, so a row
  // that is doing everything it should comes out at 63 — measured. The old ceiling was
  // set when the row held one line of text and would no longer catch anything.
  ok(at('a row stays compact'), w.rowH !== null && w.rowH < 80, `${w.rowH}px`);

  // ── Holding a row must not move the table ──
  // It did. The hold fill was an absolutely positioned ::after on the <tr>, which
  // needed `position: relative` on the row — and a table row is not a block
  // container, so Chromium re-measured it outside the table algorithm and the NOTES
  // column dropped 127px mid-press while the table kept its width. Press for 240ms,
  // well inside the 520ms timer, so the edit sheet does not open here.
  const COLS = () => [...(document.querySelector('#mediaRecordTable thead tr') || { children: [] }).children]
    .map(t => Math.round(t.getBoundingClientRect().width)).join(',');
  const holdBefore = await page.evaluate(COLS);
  await page.$eval('#mediaRecordTable tbody tr .docs-notes-cell',
    el => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  const hp = await page.$eval('#mediaRecordTable tbody tr .docs-notes-cell', el => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(hp.x, hp.y);
  await page.mouse.down();
  await page.waitForTimeout(240);
  const holdDuring = await page.evaluate(() => ({
    cols: [...(document.querySelector('#mediaRecordTable thead tr') || { children: [] }).children]
      .map(t => Math.round(t.getBoundingClientRect().width)).join(','),
    marked: document.querySelectorAll('#docs .docs-media-row.is-holding').length,
    // The sweep is the row's own background growing, not a pseudo-element.
    anim: (() => {
      const r = document.querySelector('#docs .docs-media-row.is-holding');
      return r ? getComputedStyle(r).animationName : null;
    })(),
    // AND THERE IS ACTUALLY A GRADIENT TO GROW.
    //
    // Asserting on animationName alone is not enough, and this is the second time that
    // has been proved: a `:hover` rule added later set the `background` SHORTHAND, which
    // reset background-image to none. The row is hovered throughout a press with a mouse,
    // so the animation ran its full 520ms over nothing and every check here still passed.
    fill: (() => {
      const r = document.querySelector('#docs .docs-media-row.is-holding');
      if (!r) return null;
      const s = getComputedStyle(r);
      return {
        image: s.backgroundImage === 'none' ? 'none' : 'gradient',
        // Partway across, not finished and not absent.
        size: s.backgroundSize,
        repeat: s.backgroundRepeat,
      };
    })(),
    ghost: (() => {
      const r = document.querySelector('#docs .docs-media-row.is-holding');
      return r ? getComputedStyle(r, '::after').content : null;
    })(),
  }));
  await page.mouse.up();
  await page.waitForTimeout(120);
  const holdAfter = await page.evaluate(COLS);
  ok(at('a press is registered on a row'),
    holdDuring.marked === 1, String(holdDuring.marked));
  ok(at('and it does not move a single column'),
    holdBefore === holdDuring.cols && holdDuring.cols === holdAfter,
    `${holdBefore} -> ${holdDuring.cols} -> ${holdAfter}`);
  ok(at('because the fill is the row background, not a floating box'),
    holdDuring.anim === 'docsHoldSweep' && /none/.test(String(holdDuring.ghost)),
    `${holdDuring.anim}, ::after content ${holdDuring.ghost}`);
  // The half of it that animationName cannot see.
  ok(at('and there is a gradient for it to grow'),
    holdDuring.fill && holdDuring.fill.image === 'gradient'
      && holdDuring.fill.repeat === 'no-repeat'
      && /%/.test(holdDuring.fill.size),
    JSON.stringify(holdDuring.fill));

  // The player is the same component at this width, and the arrows matter more here.
  // Opened from the thumbnail, which is the only way in now: the PREVIEW button this
  // used to click is gone with its column. The button carries no handler of its own —
  // it relies on the delegated [data-media-open] listener answering it.
  await page.evaluate(() => {
    const b = document.querySelector('#mediaRecordTable tbody tr[data-media-id="1"] .docs-file-open');
    if (b) b.click();
  });
  await page.waitForTimeout(600);
  const pd = await page.evaluate(() => {
    const el = document.getElementById('docsPlayer');
    const next = document.getElementById('docsPlayerNext');
    const prev = document.getElementById('docsPlayerPrev');
    return {
      open: el.classList.contains('is-open'),
      count: document.getElementById('docsPlayerCount').textContent,
      // First slide, so back should be unreachable and forward should not.
      prevOff: prev.disabled === true,
      nextOn: next.disabled === false,
      navW: Math.round(next.getBoundingClientRect().width),
    };
  });
  ok(at('the player opens and its arrows are usable'),
    pd.open && pd.count === '1 / 3' && pd.prevOff && pd.nextOn && pd.navW >= 38,
    JSON.stringify(pd));
  await page.evaluate(() => document.getElementById('docsPlayerNext')?.click());
  // POLLED, not a fixed wait. goTo() paints the counter immediately, but the smooth
  // scroll it starts fires scroll events, and onScroll's 90ms settle reads scrollLeft
  // and corrects `index` from it — so mid-flight the counter legitimately snaps back to
  // the slide the track is still leaving. A single 550ms wait caught that about one run
  // in four and reported "1 / 3" for a feature that works.
  const forward = await page
    .waitForFunction(() => document.getElementById('docsPlayerCount').textContent === '2 / 3',
      null, { timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  ok(at('and paging forward works'), forward,
    await page.evaluate(() => document.getElementById('docsPlayerCount').textContent));

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Re-seed before the behavioural blocks below.
  //
  // loadHistoricUploads() cannot be stopped from here, and it does not only run at boot
  // — the cloud store re-runs it whenever its notes land. With Supabase aborted it lands
  // on the error branch, which writes a single "Could not load uploads" placeholder row
  // and takes the fixture with it. It is a race: the long-note block passed one run and
  // threw on rows[2] the next after nothing changed but the number of waits before it.
  // Writing the rows again makes each check independent of that timing.
  const seed = async () => {
    await page.evaluate(({ rows, map }) => {
      document.querySelector('#mediaRecordTable tbody').innerHTML = rows;
      window._historicMediaRows = new Map(map);
    }, { rows: DOCS_ROWS, map: DOCS_MAP });
    await page.waitForTimeout(250);
    return page.evaluate(() =>
      document.querySelectorAll('#mediaRecordTable tbody tr.docs-media-row').length);
  };

  // ══ THE FILTERS ACTUALLY FILTER ════════════════════════════════════════
  //
  // There was no functional check here at all, which is how this broke and shipped.
  // filterDocsTable() read cells[0] for the filename and cells[1] for the note; then
  // Preview and Size became columns two and three, so cells[1] was an eye button with
  // no text and searching anything written in a NOTE matched nothing. Searching
  // filenames still worked, so the box looked half alive. Every lookup is by
  // data-label now, and these four checks are what would have caught it.
  {
    ok(at('three records are on the table to filter'), (await seed()) === 3, 'seeded');

    // MEASURED AS ACTUALLY DRAWN, not by reading the class back.
    //
    // The first version of this filtered on `!r.classList.contains('is-filtered-out')`
    // and passed while the feature was completely dead on a desktop: the rule that
    // hides that class lived inside `@media (max-width: 768px)`, so filterDocsTable()
    // marked the rows and nothing took them off the screen. Asserting on the class
    // only proved the JS ran. offsetParent is null for a display:none row, so this
    // asks the question the user is actually asking.
    const rowsShowing = () => page.evaluate(() =>
      [...document.querySelectorAll('#mediaRecordTable tbody tr.docs-media-row')]
        .filter(r => r.offsetParent !== null && getComputedStyle(r).display !== 'none')
        .map(r => r.querySelector('.docs-file-meta strong').textContent));

    const search = async term => {
      await page.fill('#docsHistorySearch', term);
      await page.waitForTimeout(320);          // the input is debounced 150ms
      return rowsShowing();
    };

    // The rule that does the hiding must not be width-scoped. Checked directly as
    // well as through the behaviour above, because this is the exact thing that broke.
    const hideRule = await page.evaluate(() => {
      const r = document.querySelector('#mediaRecordTable tbody tr.docs-media-row');
      if (!r) return null;
      r.classList.add('is-filtered-out');
      const d = getComputedStyle(r).display;
      r.classList.remove('is-filtered-out');
      return d;
    });
    ok(at('is-filtered-out hides a row at this width'), hideRule === 'none', String(hideRule));

    ok(at('search finds a record by its filename'),
      (await search('tunnel')).join() === 'tunnel-run.mp4', (await rowsShowing()).join());

    // The regression, stated plainly: "ghat" appears only in row 1's note.
    const byNote = await search('ghat');
    ok(at('and by words that are only in its note'),
      byNote.length === 1 && byNote[0].startsWith('IMG_20240712'), byNote.join());

    const noMatch = await search('zzzzznothinghere');
    ok(at('and hides everything when nothing matches'), noMatch.length === 0, noMatch.join());

    await page.click('#docsHistoryClearFilters');
    await page.waitForTimeout(300);
    ok(at('Clear brings every record back'), (await rowsShowing()).length === 3,
      String((await rowsShowing()).length));

    // Type dropdown.
    await page.evaluate(() => {
      const o = [...document.querySelectorAll('#docsHistoryTypeMenu .history-select-option')]
        .find(x => x.dataset.value === 'audio');
      o?.click();
    });
    await page.waitForTimeout(320);
    const audioOnly = await rowsShowing();
    ok(at('the type dropdown narrows to one kind'),
      audioOnly.length === 1 && audioOnly[0] === 'cold-start-6000km.m4a', audioOnly.join());

    // Date range, and then the thing Clear used to leave behind.
    await page.click('#docsHistoryClearFilters');
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const f = document.getElementById('docsHistoryFromDate');
      f.value = '2024-07-01';
      f.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(320);
    ok(at('a From date drops anything older'), (await rowsShowing()).length === 2,
      String((await rowsShowing()).length));

    // The visible date text is a .date-display span, not the input. Clearing .value
    // alone left "01 Jul 2024" sitting in the field with no filter behind it.
    await page.click('#docsHistoryClearFilters');
    await page.waitForTimeout(350);
    const cleared = await page.evaluate(() => {
      const input = document.getElementById('docsHistoryFromDate');
      const span = input.closest('.date-shell')?.querySelector('.date-display');
      return {
        value: input.value,
        shown: span?.textContent?.trim() || null,
        empty: input.dataset.emptyLabel || input.getAttribute('data-empty-label'),
      };
    });
    ok(at('and Clear wipes the date you can see, not just the one you cannot'),
      cleared.value === '' && cleared.shown === cleared.empty, JSON.stringify(cleared));
  }

  // ══ A LONG NOTE STAYS ONE ROW ══════════════════════════════════════════
  {
    await seed();
    const note = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#mediaRecordTable tbody tr.docs-media-row')];
      if (rows.length < 3) return { missing: rows.length };
      const td = rows[2].querySelector('td[data-label="Notes"]');
      const div = td.querySelector('.docs-notes-cell');
      const lh = parseFloat(getComputedStyle(div).lineHeight);
      const wrap = document.querySelector('#docs .docs-history-wrap');
      return {
        lines: Math.round(div.getBoundingClientRect().height / lh),
        clamp: getComputedStyle(div).webkitLineClamp,
        // An unbroken token must break rather than run out of its column.
        overflowsSideways: Math.round(div.scrollWidth - div.clientWidth),
        hasTitle: !!div.getAttribute('title'),
        rowH: Math.round(rows[2].getBoundingClientRect().height),
        otherRowH: Math.round(rows[1].getBoundingClientRect().height),
        wrapOver: wrap.scrollWidth - wrap.clientWidth,
      };
    });
    ok(at('a long note is held to two lines'),
      note.lines <= 2 && note.clamp === '2', `${note.lines} lines, clamp ${note.clamp}`);
    ok(at('and it breaks instead of overflowing its column'),
      note.overflowsSideways <= 0 && note.wrapOver === 0,
      `${note.overflowsSideways}px sideways, wrapper ${note.wrapOver}`);
    ok(at('so its row is not twice the height of the others'),
      note.rowH - note.otherRowH <= 24, `${note.rowH}px vs ${note.otherRowH}px`);
    ok(at('and the full note is still readable on hover'), note.hasTitle === true,
      String(note.hasTitle));
  }

  // ══ PAGE CONTROLS ══════════════════════════════════════════════════════
  //
  // Twenty-four rows, because three is one page and one page proves nothing: the strip
  // would hold a single button, both arrows would be dead, and the footer would look
  // identical whether the arithmetic worked or not.
  //
  // MEASURED AS DRAWN, like the filter checks above and for the same reason. Paging
  // hides rows with a class, and a class only means something if a rule answers it —
  // that exact assumption is what left the search dead on a desktop for a release.
  {
    // Re-seeded before EVERY sub-block below, not once at the top.
    //
    // loadHistoricUploads() is not reachable from here — it is a function declaration
    // inside the DOMContentLoaded closure, so the `window.loadHistoricUploads = () =>
    // Promise.resolve()` further up this file quietly creates an unrelated global and
    // stops nothing. And it is not only called at boot: the cloud store re-runs it
    // whenever its notes land, which with Supabase aborted writes a single "Could not
    // load uploads" placeholder and takes the fixture with it. That is a real race, it
    // arrives at a different moment every run, and re-seeding is the only defence
    // available from outside the closure.
    const seedMany = async () => {
      await page.evaluate(({ rows, map }) => {
        document.querySelector('#mediaRecordTable tbody').innerHTML = rows;
        window._historicMediaRows = new Map(map);
        // A fresh list starts at page one, whatever page was left behind.
        window.dkDocsPager.refresh();
      }, { rows: MANY_ROWS, map: MANY_MAP });
      await page.waitForTimeout(250);
      return page.evaluate(() =>
        document.querySelectorAll('#mediaRecordTable tbody tr.docs-media-row').length);
    };

    ok(at('twenty-four records are on the table to page through'),
      (await seedMany()) === 24, 'seeded');

    const pg = await page.evaluate(() => {
      const drawn = () => [...document.querySelectorAll('#mediaRecordTable tbody tr.docs-media-row')]
        .filter(r => getComputedStyle(r).display !== 'none');
      const first = () => drawn()[0]?.querySelector('.docs-file-meta strong')?.textContent || null;
      const out = {
        total: document.querySelectorAll('#mediaRecordTable tbody tr.docs-media-row').length,
        page1: drawn().length,
        footerShown: document.getElementById('docsHistoryPager').hidden === false,
        range: document.getElementById('docsHistoryRange').textContent,
        numbers: [...document.querySelectorAll('#docsHistoryPages .dk-pager-num')].map(b => b.textContent),
        current: document.querySelector('#docsHistoryPages .dk-pager-num.is-current')?.textContent || null,
        prevOff: document.getElementById('docsHistoryPrev').disabled,
        nextOn: document.getElementById('docsHistoryNext').disabled === false,
        firstOnPage1: first(),
      };
      // Jump to the last page. 24 over 10 leaves four rows on it, and forward has to die
      // there — the arrow that never disables is how you end up on page 4 of 3 looking
      // at nothing.
      document.querySelector('#docsHistoryPages .dk-pager-num[data-page="3"]')?.click();
      out.page3 = drawn().length;
      out.range3 = document.getElementById('docsHistoryRange').textContent;
      out.nextOffOnLast = document.getElementById('docsHistoryNext').disabled;
      out.prevOnOnLast = document.getElementById('docsHistoryPrev').disabled === false;
      out.firstOnPage3 = first();
      // 'All' is 0, and 0 is a legitimate value here — the first version read a missing
      // localStorage entry as Number(null) === 0 and started every fresh install on
      // "All", which is to say with the page controls switched off.
      const sel = document.getElementById('docsHistoryPerPage');
      sel.value = '0';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      out.all = drawn().length;
      // The strip STAYS on one page, with both arrows dead and the "1" still saying where
      // you are. It used to be hidden here, and an empty right-hand side read as a control
      // that had broken rather than as a list that fits on one page.
      out.navOnOnePage = {
        shown: document.getElementById('docsHistoryNav').hidden === false,
        numbers: [...document.querySelectorAll('#docsHistoryPages .dk-pager-num')].map(b => b.textContent),
        prevDead: document.getElementById('docsHistoryPrev').disabled,
        nextDead: document.getElementById('docsHistoryNext').disabled,
      };
      out.rangeAll = document.getElementById('docsHistoryRange').textContent;
      sel.value = '10';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      out.backTo10 = drawn().length;
      // Changing the page size sends you back to the top: page 3 of ten-at-a-time and
      // page 3 of fifty-at-a-time are different places.
      out.currentAfterResize = document.querySelector('#docsHistoryPages .dk-pager-num.is-current')?.textContent || null;
      // One component, two ids. The service footer is the same markup and the same
      // stylesheet block, so its skeleton has to match or one of them has drifted.
      const shape = s => [...document.querySelector(s).children].map(c => c.className).join('|');
      out.sameComponent = shape('#docsHistoryPager') === shape('#serviceHistoryPager');
      out.serviceShape = shape('#serviceHistoryPager');
      // Nothing to page through on the service table here (Supabase is aborted, so
      // serviceEntries is empty), and an empty table has nothing to say about how much
      // of it you are looking at.
      out.serviceFooterHidden = document.getElementById('serviceHistoryPager').hidden;
      return out;
    });

    ok(at('paging draws ten of twenty-four rows'),
      pg.total === 24 && pg.page1 === 10, `${pg.page1} drawn of ${pg.total}`);
    ok(at('and says so in words'),
      pg.footerShown === true && pg.range === 'Showing 1\u201310 of 24 files', `"${pg.range}"`);
    ok(at('the strip holds a button per page, with the first one current'),
      pg.numbers.join() === '1,2,3' && pg.current === '1'
        && pg.prevOff === true && pg.nextOn === true,
      `${pg.numbers.join()} / current ${pg.current}`);
    ok(at('the last page holds the remainder and stops there'),
      pg.page3 === 4 && pg.range3 === 'Showing 21\u201324 of 24 files'
        && pg.nextOffOnLast === true && pg.prevOnOnLast === true,
      `${pg.page3} rows, "${pg.range3}", next disabled ${pg.nextOffOnLast}`);
    ok(at('and it is a different ten rows than page one'),
      pg.firstOnPage1 !== pg.firstOnPage3 && !!pg.firstOnPage3,
      `${pg.firstOnPage1} -> ${pg.firstOnPage3}`);
    ok(at('"All" shows every row'),
      pg.all === 24 && pg.rangeAll === 'Showing 1\u201324 of 24 files',
      `${pg.all} rows, "${pg.rangeAll}"`);
    ok(at('and one page still shows its strip, with both arrows dead'),
      pg.navOnOnePage && pg.navOnOnePage.shown === true
        && pg.navOnOnePage.numbers.join() === '1'
        && pg.navOnOnePage.prevDead === true && pg.navOnOnePage.nextDead === true,
      JSON.stringify(pg.navOnOnePage));
    ok(at('and changing the size returns you to the first page'),
      pg.backTo10 === 10 && pg.currentAfterResize === '1',
      `${pg.backTo10} rows on page ${pg.currentAfterResize}`);
    ok(at('the service table has the same footer, not a copy of it'),
      pg.sameComponent === true,
      `docs vs service skeleton: ${pg.serviceShape}`);
    ok(at('and an empty table shows no footer at all'),
      pg.serviceFooterHidden === true, String(pg.serviceFooterHidden));

    // ── The filter and the pager have to agree ──
    //
    // The filter hides a row with .is-filtered-out; the pager hides it with
    // .is-paged-out. The pager has to count what the filter LEFT, not everything — count
    // the lot and the footer promises ten rows over a page that holds three.
    //
    // Eight of the twenty-four are the tunnel-run video, so this also proves the filter
    // is still reading the right cells after the column change.
    await seedMany();
    await page.fill('#docsHistorySearch', 'tunnel');
    await page.waitForTimeout(340);          // the input is debounced 150ms
    const both = await page.evaluate(() => ({
      drawn: [...document.querySelectorAll('#mediaRecordTable tbody tr.docs-media-row')]
        .filter(r => getComputedStyle(r).display !== 'none').length,
      range: document.getElementById('docsHistoryRange').textContent,
      // Eight of twenty-four is one page, so the strip is back to a single "1" — and it
      // is still drawn, because that is where you look to find out where you are.
      pages: [...document.querySelectorAll('#docsHistoryPages .dk-pager-num')].map(b => b.textContent),
      navShown: document.getElementById('docsHistoryNav').hidden === false,
    }));
    ok(at('a filtered list pages on what the filter left'),
      both.drawn === 8 && both.range === 'Showing 1\u20138 of 8 files'
        && both.pages.join() === '1' && both.navShown === true,
      `${both.drawn} drawn, "${both.range}", pages ${both.pages.join()}`);

    // ── And the player pages through the PAGE, not the table ──
    // rowsShowing() answers one question — what is on the screen — and paging is the
    // second way a row can fail to be. Without it the carousel would hold twenty-four
    // files while the table showed ten and its counter would disagree with the list it
    // was opened from.
    await page.click('#docsHistoryClearFilters');
    await page.waitForTimeout(320);
    const seeded = await seedMany();
    await page.evaluate(() => {
      document.querySelector('#mediaRecordTable tbody tr.docs-media-row:not(.is-paged-out) .docs-file-open')?.click();
    });
    await page.waitForTimeout(700);
    const slides = await page.evaluate(() => {
      const n = document.querySelectorAll('#docsPlayerStage .docs-player-slide').length;
      const count = document.getElementById('docsPlayerCount').textContent;
      return { n, count };
    });
    ok(at('the player holds the current page, not the whole table'),
      slides.n === 10 && slides.count === '1 / 10',
      `${JSON.stringify(slides)} from ${seeded} rows`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // ── Sorting turns the list over ──
    await seedMany();
    await page.evaluate(() => document.getElementById('docsHistorySort').click());
    await page.waitForTimeout(400);
    const sorted = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#mediaRecordTable tbody tr.docs-media-row')];
      return {
        dir: document.getElementById('docsHistorySort').dataset.dir,
        ariaSort: document.getElementById('docsHistorySort').closest('th').getAttribute('aria-sort'),
        glyph: document.getElementById('docsHistorySort').querySelector('i').className,
        ascending: Number(rows[0].dataset.when) < Number(rows[rows.length - 1].dataset.when),
        // Reordering the whole list makes the page you were on meaningless.
        current: document.querySelector('#docsHistoryPages .dk-pager-num.is-current')?.textContent || null,
      };
    });
    ok(at('the Uploaded header flips the order, arrow and all'),
      sorted.dir === 'asc' && sorted.ariaSort === 'ascending'
        && /fa-arrow-up/.test(sorted.glyph) && sorted.ascending === true
        && sorted.current === '1',
      JSON.stringify(sorted));
    // Put it back, so the blocks after this see the order they expect.
    await page.evaluate(() => document.getElementById('docsHistorySort').click());
    await page.waitForTimeout(350);
  }

  // ══ THUMBNAILS ARRIVE, AND THEN THEY ARE INSTANT ═══════════════════════
  //
  // The first version signed one URL per row and handed the browser the ORIGINAL object:
  // a 4.6 MB photograph downloaded in full to paint a 52-pixel box, ten per page, behind
  // ten separate signing round trips, none of it kept. Three things had to change and
  // each one is checked here — the batch, the cache, and the fact that a row which is
  // not on this page costs nothing at all.
  {
    // A clean slate: 24 rows, an empty frame cache, and the counters zeroed. Without the
    // reset the blocks above have already filled the cache and every paint below would
    // be instant for the wrong reason.
    await page.evaluate(() => {
      try { localStorage.removeItem('spinlogThumbs.v1'); } catch { /* private mode */ }
      window.__signCalls = { batch: 0, single: 0, names: [] };
    });
    await page.evaluate(({ rows, map }) => {
      document.querySelector('#mediaRecordTable tbody').innerHTML = rows;
      window._historicMediaRows = new Map(map);
      window.dkDocsPager.refresh();
      window.dkDocsThumbs.scan();
    }, { rows: FRESH_ROWS, map: FRESH_MAP });
    // Long enough for one batch call and the image decodes behind it.
    await page.waitForTimeout(1400);

    const first = await page.evaluate(() => {
      let cached = 0;
      try { cached = Object.keys(JSON.parse(localStorage.getItem('spinlogThumbs.v1') || '{}')).length; } catch { cached = -1; }
      const page1 = [...document.querySelectorAll('#mediaRecordTable tbody tr.docs-media-row')]
        .filter(r => getComputedStyle(r).display !== 'none');
      return {
        calls: window.__signCalls,
        // Ten rows a page, and the kinds cycle image/audio/video — so seven of them ask
        // for a picture and three are audio, which never had a frame to fetch.
        slotsOnPage: page1.reduce((n, r) => n + r.querySelectorAll('.docs-thumb[data-thumb]').length, 0),
        painted: document.querySelectorAll('#mediaRecordTable tbody tr.docs-media-row:not(.is-paged-out) .docs-thumb.has-thumb').length,
        cached,
        // A slot still waiting says so rather than looking like one that gave up.
        shimmer: (() => {
          const idle = document.querySelector('#mediaRecordTable .docs-thumb[data-thumb]:not(.has-thumb)');
          if (!idle) return 'none waiting';
          const s = getComputedStyle(idle, '::before');
          return s.content !== 'none' ? s.animationName : 'no placeholder';
        })(),
      };
    });

    // ONE request for the page, not one per row. This is the check that would have
    // caught the original: seven images meant seven createSignedUrl calls.
    ok(at('thumbnails: a page of files is signed in one request'),
      first.calls.batch === 1 && first.calls.single === 0,
      `${first.calls.batch} batch call(s), ${first.calls.single} single`);
    // And only for the rows on THIS page. Signing all 24 is the bill paging exists to
    // avoid, and audio must not be in there at all.
    ok(at('and only for the rows on this page, never for audio'),
      first.calls.names.length === first.slotsOnPage && first.slotsOnPage > 0
        && first.slotsOnPage < 24,
      `signed ${first.calls.names.length} of ${first.slotsOnPage} slots on the page`);
    ok(at('the pictures arrive'), first.painted > 0, `${first.painted} painted`);
    ok(at('and each one is kept as a small frame'),
      first.cached >= first.painted && first.cached > 0, `${first.cached} in the cache`);
    ok(at('a slot still waiting shows it is waiting'),
      first.shimmer === 'docsThumbWait' || first.shimmer === 'none waiting',
      String(first.shimmer));

    // ── The second look costs nothing ──
    // Re-render the same rows with the counters zeroed. Every thumbnail must come back
    // from the cache: no signing, no image request, and painted in the frame the rows
    // were written in rather than after a round trip.
    const second = await page.evaluate(({ rows, map }) => {
      window.__signCalls = { batch: 0, single: 0, names: [] };
      document.querySelector('#mediaRecordTable tbody').innerHTML = rows;
      window._historicMediaRows = new Map(map);
      window.dkDocsPager.refresh();
      window.dkDocsThumbs.scan();
      // Read back SYNCHRONOUSLY, before any await could let a network response in. If
      // these are painted now, they were painted from the cache.
      return {
        painted: document.querySelectorAll('#mediaRecordTable tbody tr.docs-media-row:not(.is-paged-out) .docs-thumb.has-thumb').length,
        fromCache: document.querySelectorAll('#mediaRecordTable tbody tr.docs-media-row:not(.is-paged-out) .docs-thumb.is-cached').length,
        calls: window.__signCalls,
      };
    }, { rows: FRESH_ROWS, map: FRESH_MAP });

    ok(at('a file looked at twice is painted with no request at all'),
      second.painted > 0 && second.painted === second.fromCache
        && second.calls.batch === 0 && second.calls.single === 0,
      `${second.painted} painted (${second.fromCache} from cache), ${second.calls.batch} batch call(s)`);
    // Painted in the same turn of the event loop as the render. That is the difference
    // between "the thumbnails take a moment" and "the thumbnails are there".
    ok(at('and painted in the same frame as the row'),
      second.fromCache >= first.painted,
      `${second.fromCache} instant vs ${first.painted} fetched first time`);

    // ── Deleting a file forgets its picture ──
    // Storage names are reused, and a cache keyed by name would otherwise show the
    // deleted file's frame under a new upload.
    const forgot = await page.evaluate(() => {
      const before = Object.keys(JSON.parse(localStorage.getItem('spinlogThumbs.v1') || '{}'));
      const name = before[0];
      window.dkDocsThumbs.forget(name);
      return { name, before: before.length };
    });
    await page.waitForTimeout(1100);       // the cache write is debounced 900ms
    ok(at('and deleting a file forgets its picture'),
      await page.evaluate(n => !Object.prototype.hasOwnProperty.call(
        JSON.parse(localStorage.getItem('spinlogThumbs.v1') || '{}'), n), forgot.name),
      `${forgot.name} still cached out of ${forgot.before}`);
  }

  // ══ THE BUILD NUMBER IS ON SCREEN ══════════════════════════════════════
  {
    const ver = await page.evaluate(() => {
      const slots = [...document.querySelectorAll('[data-app-version]')];
      const build = document.querySelector('.dk-build');
      return {
        meta: document.querySelector('meta[name="version"]')?.getAttribute('content') || null,
        global: window.dkAppVersion || null,
        slots: slots.length,
        texts: slots.map(s => s.textContent.trim()),
        buildShown: build ? getComputedStyle(build).display !== 'none' : false,
        // It belongs at the foot of Home, not in the hero beside the database chip.
        buildInHero: !!document.querySelector('.dk-hero [data-app-version]'),
        // THE FACE. This was var(--dk-font) — Oswald, the token named for the app's
        // READING face — on a string that is pure display type. The two are hard to
        // separate at 0.68rem, which is why it sat wrong for so long.
        family: build ? getComputedStyle(build).fontFamily : null,
        caps: build ? getComputedStyle(build).textTransform : null,
        // The glyph is a branch, because that is what a version is a point on. It has to
        // be the SOLID cut: \f126 does not exist in the regular face and would silently
        // fall back to a blank box.
        glyph: (() => {
          const i = build?.querySelector('i');
          if (!i) return null;
          const s = getComputedStyle(i, '::before');
          return {
            content: s.content,
            family: getComputedStyle(i).fontFamily,
            weight: s.fontWeight,
            // Decorative. A screen reader should say "SpinLog v1.9.0" and not be told
            // there is a small drawing next to it.
            hidden: i.getAttribute('aria-hidden'),
            // Beside the text, not a word in it.
            inline: (() => {
              const ir = i.getBoundingClientRect();
              const tr = build.querySelector('.dk-build-text')?.getBoundingClientRect();
              return tr ? ir.right <= tr.left + 1 && Math.abs((ir.top + ir.bottom) / 2 - (tr.top + tr.bottom) / 2) < 8 : null;
            })(),
          };
        })(),
        // There must be no SECOND copy. One lived under the save button in Sage's
        // settings, on the theory that the dialog was the app's nearest thing to an
        // About screen. It is not — that panel is her memory, her keys and quiet
        // hours, and a build number was the only line in it that could not be acted
        // on. The foot of Home is where you go to look something up.
        sageVersion: !!document.querySelector('.sage-set-version'),
      };
    });
    ok(at('the app version is shown, from one source'),
      ver.meta && ver.global === ver.meta && ver.slots === 1
        && ver.texts.every(t => t === `v${ver.meta}`),
      JSON.stringify(ver));
    ok(at('and it sits at the foot of Home, not in the hero'),
      ver.buildShown === true && ver.buildInHero === false,
      `shown ${ver.buildShown}, in hero ${ver.buildInHero}`);
    // Blender Pro Heavy is a CAPS-ONLY cut, so the uppercase is not a stylistic extra
    // here — it is what makes the face safe to use at all.
    ok(at('set in the display face, not the reading one'),
      /Blender/i.test(String(ver.family)) && !/^Oswald/i.test(String(ver.family))
        && ver.caps === 'uppercase',
      `${ver.family} / ${ver.caps}`);
    ok(at('with a branch glyph from the solid cut beside it'),
      ver.glyph && ver.glyph.content === '"\uf126"'
        && /Font Awesome 6 Free/.test(ver.glyph.family) && ver.glyph.weight === '900'
        && ver.glyph.hidden === 'true' && ver.glyph.inline === true,
      JSON.stringify(ver.glyph));
    ok(at('and it is not repeated in her settings dialog'),
      ver.sageVersion === false, 'a second copy is back');
  }

  // ══ SEARCH JUMPS TO A RECORD AND MARKS IT ══════════════════════════════
  //
  // Clicking a service record in the command-centre search has to land on the Service
  // section, scroll that record into view, and say which one it was. The navigation and
  // the scroll already worked; the mark did not exist, so arriving in a table of
  // near-identical rows told you nothing.
  //
  // The second result is the one clicked on purpose. Landing on the first row of the
  // table would pass a weaker test by accident.
  {
    await page.evaluate(({ rows, entries }) => {
      window.dkNavigate('service');
      document.getElementById('serviceTableBody').innerHTML = rows;
      // The search index is built from this snapshot, not from the DOM.
      window.dkHomeInsights({
        all: entries, services: entries, maxOdo: 8000, latest: entries[0],
      });
    }, {
      rows: RECORDS.map(rowHtml).join(''),
      entries: RECORDS.map((r, i) => ({
        id: 101 + i, type: r.type, date: i === 0 ? '2026-08-29' : '2026-08-06',
        odo: i === 0 ? 8000 : 7640, cost: 400, notes: r.notes,
      })),
    });
    await page.waitForTimeout(400);

    // The search box lives in the Sage section, which is where the user reaches it.
    await page.evaluate(() => window.dkNavigate('sage'));
    await page.waitForTimeout(400);
    await page.fill('#dkSearchInput', 'handle bar');
    await page.waitForTimeout(400);

    const hits = await page.$$eval('#dkSearchPanel .dk-search-item', els => els.map(e => ({
      title: e.querySelector('strong')?.textContent?.trim(),
      group: e.closest('.dk-search-group')?.querySelector('.dk-search-group-title')?.textContent,
    })));
    ok(at('search finds a service record by its note'),
      hits.length >= 1 && hits.some(h => /handle bar/i.test(h.title || ''))
        && hits.every(h => h.group === 'Service Records'),
      JSON.stringify(hits));

    // Click the LAST hit, whichever it is, so the target is not row one.
    const wanted = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#dkSearchPanel .dk-search-item')];
      const el = items[items.length - 1];
      const title = el.querySelector('strong')?.textContent?.trim();
      el.click();
      return title;
    });
    // Long enough for all three stages of the jump: the 130ms section swap, then two
    // frames while the incoming view lays out, then the smooth scroll to the row. It
    // was 600ms, from before the section change had a transition of its own, and
    // `inView` was being read while the page was still travelling. The mark itself
    // lands at ~165ms and lasts 2.1s, so it is still up when this reads it.
    await page.waitForTimeout(1100);

    const landed = await page.evaluate(() => {
      const row = document.querySelector('.service-record-row.dk-found');
      const r = row && row.getBoundingClientRect();
      const st = row && getComputedStyle(row);
      const cell = row && row.querySelector('td');
      return {
        section: document.querySelector('main section.active')?.id,
        marked: document.querySelectorAll('.dk-found').length,
        id: row?.dataset.recordId || null,
        note: row?.querySelector('.history-notes-text')?.textContent?.trim() || null,
        outline: st ? `${st.outlineWidth} ${st.outlineStyle}` : null,
        anim: st ? st.animationName : null,
        cellAnim: cell ? getComputedStyle(cell).animationName : null,
        inView: r ? r.top > 0 && r.bottom <= window.innerHeight : null,
        // The mark must not move the row. A border on a table-row or a grid card
        // shifts every cell in it, at the exact moment you are looking at it.
        shifts: st ? st.borderTopWidth !== '0px' && !row.closest('[data-card]') : null,
        panelClosed: document.getElementById('dkSearchPanel')?.hidden,
        boxCleared: document.getElementById('dkSearchInput')?.value === '',
      };
    });

    ok(at('clicking it lands on the Service section'), landed.section === 'service',
      String(landed.section));
    ok(at('and marks exactly the record that was clicked'),
      landed.marked === 1 && landed.note === wanted,
      `marked ${landed.marked}, id ${landed.id}, note "${landed.note}" vs "${wanted}"`);
    ok(at('with a ring and a wash on the row and its cells'),
      landed.outline === '2px solid' && landed.anim === 'dkFoundPulse'
        && landed.cellAnim === 'dkFoundPulse',
      JSON.stringify({ o: landed.outline, a: landed.anim, c: landed.cellAnim }));
    ok(at('scrolled into view, clear of the sticky header'), landed.inView === true,
      String(landed.inView));
    ok(at('and the search closes itself behind you'),
      landed.panelClosed === true && landed.boxCleared === true,
      `panel hidden ${landed.panelClosed}, box empty ${landed.boxCleared}`);

    // It has to clear itself, and it has to fire again for the same row — re-adding a
    // class in the same frame is a no-op, so a second search for one record would do
    // nothing visible without a reflow between remove and add.
    await page.waitForTimeout(2700);
    ok(at('the mark clears itself'),
      (await page.evaluate(() => document.querySelectorAll('.dk-found').length)) === 0,
      'still marked');

    await page.evaluate(() => window.dkNavigate('sage'));
    await page.waitForTimeout(300);
    await page.fill('#dkSearchInput', 'handle bar');
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const items = [...document.querySelectorAll('#dkSearchPanel .dk-search-item')];
      items[items.length - 1].click();
    });
    await page.waitForTimeout(500);
    ok(at('and fires again on a second jump to the same record'),
      (await page.evaluate(() => {
        const row = document.querySelector('.service-record-row.dk-found');
        return !!row && getComputedStyle(row).animationName === 'dkFoundPulse';
      })),
      'no second pulse');

    // A filtered service table never renders the rows it excludes, so the jump clears
    // the filters first. The end-to-end path needs the private serviceEntries store;
    // what is checkable is the hook the search calls and that it empties the fields.
    const hook = await page.evaluate(() => {
      if (typeof window.dkClearServiceFilters !== 'function') return { exists: false };
      const s = document.getElementById('serviceHistorySearch');
      const t = document.getElementById('serviceHistoryTypeFilter');
      if (s) s.value = 'tyre';
      if (t) t.value = 'Tyres';
      const had = window.dkClearServiceFilters();
      return { exists: true, had, search: s?.value, type: t?.value };
    });
    ok(at('and the jump can clear a filter that would hide the record'),
      hook.exists === true && hook.had === true && hook.search === '' && hook.type === '',
      JSON.stringify(hook));

    await page.waitForTimeout(2700);
  }

  // ══ APP-WIDE, checked once ═════════════════════════════════════════════
  //
  // Not layout, but each one is a thing that was wrong and is cheap to keep honest.
  {
    const app = await page.evaluate(() => {
      const S = self.SageScheduler;
      const EMOJI = /\p{Extended_Pictographic}/u;
      const noEmoji = [];
      const ungatedTime = [];
      let bodies = 0;
      Object.entries(S.MOOD_POOLS || {}).forEach(([cat, moods]) => {
        Object.entries(moods).forEach(([mood, lines]) => {
          lines.forEach(l => {
            bodies += 1;
            if (!EMOJI.test(l.body)) noEmoji.push(`${cat}.${mood}`);
            // A line naming the light has to say which hours it is true in.
            if (/golden|gold light/i.test(l.body) && !Array.isArray(l.hours)) {
              ungatedTime.push(`${cat}.${mood}`);
            }
          });
        });
      });
      return {
        bodies,
        noEmoji,
        ungatedTime,
        // "golden hour, no rider" shipped at 19:19. The band ran to 21:59 and every
        // line in it was equally eligible the whole time.
        gate: {
          at16: S.lineInHour({ hours: [17, 18] }, 16),
          at17: S.lineInHour({ hours: [17, 18] }, 17),
          at19: S.lineInHour({ hours: [17, 18] }, 19),
          untagged: S.lineInHour({ body: 'x' }, 3),
          wraps: S.lineInHour({ hours: [22, 2] }, 1) && !S.lineInHour({ hours: [22, 2] }, 12),
        },
        // Sunset here is ~18:15, so the band has to contain 17:30 at all.
        band17: S.baseMoodForHour(17),
        // The review panel and its helpers.
        autofill: {
          propose: typeof window.SageAutofill?.propose,
          panels: document.querySelectorAll('.sage-propose, #docAddProposal, #serviceAutofillProposal').length,
          fillButtons: document.querySelectorAll('.sage-fill-btn').length,
        },
        overscroll: [
          getComputedStyle(document.documentElement).overscrollBehaviorX,
          getComputedStyle(document.body).overscrollBehaviorX,
        ],
      };
    });

    ok(at('every notification line has an emoji'),
      app.bodies > 100 && app.noEmoji.length === 0,
      `${app.bodies} bodies, missing in: ${app.noEmoji.join(', ')}`);
    ok(at('and no line claims a time of day without an hour gate'),
      app.ungatedTime.length === 0, app.ungatedTime.join(', '));
    ok(at('the hour gate holds at its edges'),
      app.gate.at17 && !app.gate.at16 && !app.gate.at19 && app.gate.untagged && app.gate.wraps,
      JSON.stringify(app.gate));
    ok(at('and the evening band actually contains golden hour'),
      app.band17 === 'flirty', app.band17);
    ok(at('the autofill review panel is gone'),
      app.autofill.propose === 'undefined' && app.autofill.panels === 0,
      JSON.stringify(app.autofill));
    ok(at('but her fill buttons are still there'),
      app.autofill.fillButtons >= 3, String(app.autofill.fillButtons));
    // A sideways drag that reaches the document is read as pull-to-navigate.
    ok(at('a sideways overscroll cannot navigate'),
      app.overscroll.every(v => v === 'none'), app.overscroll.join(' / '));

    // Section changes have to PUSH, or the stack holds one entry and a back gesture
    // closes the app instead of stepping back a page.
    // Park on a known section BEFORE counting. Navigating to the section you are
    // already on is a no-op that pushes nothing — correctly — so starting this from
    // wherever the previous block happened to leave the app measured +1 instead of +2
    // and failed on a working feature.
    const hist = await page.evaluate(async () => {
      window.dkNavigate?.('home');
      await new Promise(r => setTimeout(r, 250));
      const start = history.length;
      window.dkNavigate?.('service');
      await new Promise(r => setTimeout(r, 200));
      window.dkNavigate?.('docs');
      await new Promise(r => setTimeout(r, 200));
      return { start, end: history.length, hash: location.hash };
    });
    ok(at('navigating between sections builds history'),
      hist.end >= hist.start + 2 && hist.hash === '#docs',
      JSON.stringify(hist));
    await page.goBack();
    await page.waitForTimeout(400);
    const back = await page.evaluate(() => ({
      hash: location.hash,
      shown: [...document.querySelectorAll('main section')]
        .filter(s => getComputedStyle(s).display !== 'none').map(s => s.id),
    }));
    ok(at('so back steps to the previous section, not out of the app'),
      back.hash === '#service' && back.shown.includes('service'), JSON.stringify(back));

    // The notification marks: a square logo, and a badge Android can silhouette.
    const marks = await page.evaluate(async () => {
      const load = src => new Promise(ok2 => {
        const i = new Image();
        i.onload = () => ok2({ w: i.width, h: i.height });
        i.onerror = () => ok2(null);
        i.src = src;
      });
      return { badge: await load('./assets/icons/badge-96.png'), logo: await load('./assets/icons/icon-192.png') };
    });
    ok(at('the notification badge and icon both exist and are square'),
      marks.badge && marks.logo && marks.badge.w === marks.badge.h && marks.logo.w === marks.logo.h,
      JSON.stringify(marks));

    await page.evaluate(() => window.dkNavigate?.('docs'));
    await page.waitForTimeout(250);
  }

  ok(at('no page errors'), errors.length === 0, errors.join(' | '));

  if (SHOTS) {
    const panel = await page.$('#docs .service-history-panel');
    if (panel) await panel.screenshot({ path: `tools/_shot-docs-history-desktop-${TAG}.png` });
    await page.screenshot({ path: `tools/_shot-docs-desktop-${TAG}.png` });
  }
  await page.close();
}

await browser.close();
server.close();

if (SHOTS) console.log(`\nwrote tools/_shot-*-${TAG}.png`);
console.log(fail
  ? `\n✗ ${pass} passed, ${fail} failed`
  : `\n✓ the service and documents sections hold together on a phone and a desktop (${pass} checks)`);
process.exit(fail ? 1 : 0);
