// SpinLog — boot audit
//
// Loads every classic script into ONE shared global, in the order index.html
// loads them, then fires DOMContentLoaded. Reports anything that throws.
//
// WHY THIS EXISTS
//
// `node --check` reads one file at a time and only checks syntax. Neither it nor
// the reference audit can see the two mistakes this catches, and both of them
// take the whole app down rather than degrading:
//
//   1. A scope error. script.js is one enormous DOMContentLoaded handler with
//      several sections sitting after it at true top level, and the indentation
//      does not reliably tell you which side of that line you are on. An
//      identifier declared inside the handler and used outside it throws a
//      ReferenceError during evaluation, so everything below that point never
//      gets defined — which presents as an app stuck mid-boot with one section
//      rendered and no obvious cause.
//
//   2. A duplicate top-level declaration. These files share one global scope, so
//      two of them declaring `const X` at top level is "Identifier 'X' has
//      already been declared", and the second script dies entirely.
//
// Both happened. The first one shipped, and three passes of node --check,
// audit-refs and editor diagnostics all said the change was clean.
//
// HOW TO READ THE OUTPUT
//
// There is no real DOM here, so a TypeError on a null element is this harness's
// limitation and is expected — it just means the boot got that far. A
// ReferenceError is a real bug and fails the run.
//
// Usage: node tools/audit-boot.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import vm from 'node:vm';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Exactly the order in index.html.
const FILES = [
  'src/js/cloud-store.js',
  'src/js/sage-confirm.js',
  'src/js/sage-scheduler.js',
  'src/js/sage-memory.js',
  'src/js/sage-tools.js',
  'src/js/sage-ai.js',
  'src/js/sage-keyvault.js',
  'src/js/notifications.js',
  'src/js/script.js',
  'src/js/sage-autofill.js',
  'src/js/sage-ui.js',
];

// ── The least DOM that lets top-level code run ──────────────────────────
function makeElement(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    style: {}, dataset: {}, attrs: {}, children: [], value: '', textContent: '',
    innerHTML: '', hidden: false, disabled: false, checked: false,
    classList: {
      add() {}, remove() {}, toggle() {}, contains: () => false, replace() {},
    },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, insertBefore(c) { return c; },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] ?? null; },
    removeAttribute(k) { delete this.attrs[k]; },
    hasAttribute(k) { return k in this.attrs; },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    focus() {}, blur() {}, click() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    scrollIntoView() {},
    contains: () => false,
    getContext: () => null,
  };
  return el;
}

const bag = new Map();
const sandbox = {
  console: {
    log() {}, warn() {}, error() {}, info() {}, debug() {},
  },
  setTimeout, clearTimeout, setInterval, clearInterval,
  queueMicrotask, Promise, JSON, Math, Date, RegExp, Error, Object, Array, Map, Set,
  fetch: () => Promise.reject(new Error('no network in this harness')),
  crypto: globalThis.crypto,
  performance: { now: () => Date.now() },
  requestAnimationFrame: cb => setTimeout(cb, 0),
  cancelAnimationFrame: clearTimeout,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  navigator: {
    onLine: true, userAgent: 'harness', serviceWorker: undefined,
    geolocation: undefined, permissions: undefined,
  },
  location: { href: 'http://localhost/', origin: 'http://localhost', pathname: '/', search: '', hash: '' },
  localStorage: {
    getItem: k => (bag.has(k) ? bag.get(k) : null),
    setItem: (k, v) => bag.set(k, String(v)),
    removeItem: k => bag.delete(k),
    clear: () => bag.clear(),
    key: () => null,
    length: 0,
  },
  sessionStorage: {
    getItem: () => null, setItem() {}, removeItem() {}, clear() {},
  },
  indexedDB: undefined,
  Notification: undefined,
  // Enough of the Supabase client for the boot path to run. Every query resolves
  // empty; the point is to reach the end of the handler, not to test the database.
  supabase: {
    createClient() {
      const query = () => {
        const api = {
          select: () => api, insert: () => api, update: () => api, upsert: () => api,
          delete: () => api, eq: () => api, neq: () => api, gt: () => api,
          gte: () => api, lt: () => api, lte: () => api, like: () => api,
          ilike: () => api, is: () => api, in: () => api, not: () => api,
          or: () => api, order: () => api, limit: () => api, range: () => api,
          single: () => api, maybeSingle: () => api,
          then: resolve => resolve({ data: [], error: null, count: 0 }),
          catch: () => api,
        };
        return api;
      };
      return {
        from: query,
        rpc: query,
        storage: {
          from: () => ({
            upload: () => Promise.resolve({ data: null, error: null }),
            remove: () => Promise.resolve({ data: null, error: null }),
            createSignedUrl: () => Promise.resolve({ data: { signedUrl: '' }, error: null }),
            list: () => Promise.resolve({ data: [], error: null }),
            getPublicUrl: () => ({ data: { publicUrl: '' } }),
          }),
        },
        channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
        auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
      };
    },
  },
  URL, Blob: class {}, File: class {}, FileReader: class {}, FormData: class {},
  TextEncoder, TextDecoder, AbortController,
  Intl,
};

sandbox.document = {
  readyState: 'loading',
  visibilityState: 'visible',
  body: makeElement('body'),
  documentElement: makeElement('html'),
  head: makeElement('head'),
  createElement: makeElement,
  createTextNode: () => makeElement('text'),
  createDocumentFragment: () => makeElement('fragment'),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementsByClassName: () => [],
  getElementsByTagName: () => [],
  addEventListener() {}, removeEventListener() {},
  cookie: '',
};
// Keep the DOMContentLoaded handlers so they can be fired afterwards. Evaluating
// the scripts only proves they parse and their top level runs; almost all of
// script.js is inside one such handler.
const domReady = [];
sandbox.document.addEventListener = (type, fn) => {
  if (type === 'DOMContentLoaded' && typeof fn === 'function') domReady.push(fn);
};

sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.addEventListener = () => {};
sandbox.removeEventListener = () => {};

vm.createContext(sandbox);

console.log('BOOTING THE CLASSIC SCRIPTS IN ONE SHARED GLOBAL');
console.log('═'.repeat(64));

let failed = 0;
for (const rel of FILES) {
  const code = await readFile(join(ROOT, rel), 'utf8');
  try {
    vm.runInContext(code, sandbox, { filename: rel });
    console.log(`   ✓ ${rel}`);
  } catch (err) {
    failed += 1;
    console.log(`   ✗ ${rel}`);
    console.log(`       ${err.name}: ${err.message}`);
    if (err.stack) {
      const where = err.stack.split('\n').find(l => l.includes(rel));
      if (where) console.log(`       ${where.trim()}`);
    }
  }
}

console.log('═'.repeat(64));
if (failed) {
  console.log(`✗ ${failed} script(s) failed to evaluate — in a browser everything after`);
  console.log('  the failure in that file does not run, which is what a half-booted app is.');
} else {
  console.log('✓ every script evaluates in a shared global with no collisions');
}

// ── Now fire DOMContentLoaded ───────────────────────────────────────────
//
// Almost all of script.js is inside one such handler, so evaluation passing says
// very little on its own.
//
// This stub has no real DOM, so a TypeError on a null element is the harness's
// fault and is expected. A ReferenceError is not: it means an identifier is being
// used from a scope that cannot see it, which is precisely the bug that left the
// app stuck on "CHECKING…" with one section rendered.
console.log(`\nFiring DOMContentLoaded (${domReady.length} handler(s))`);
console.log('═'.repeat(64));

let scopeBugs = 0;
domReady.forEach((fn, i) => {
  try {
    fn({ type: 'DOMContentLoaded' });
    console.log(`   ✓ handler ${i + 1} ran to completion`);
  } catch (err) {
    const real = err instanceof ReferenceError;
    if (real) scopeBugs += 1;
    console.log(`   ${real ? '✗' : '·'} handler ${i + 1}: ${err.name}: ${err.message}`);
    const where = (err.stack || '').split('\n').find(l => l.includes('src/js/'));
    if (where) console.log(`       ${where.trim()}`);
    if (!real) console.log('       (a missing DOM node — this harness has no real document)');
  }
});

console.log('═'.repeat(64));
if (scopeBugs) {
  console.log(`✗ ${scopeBugs} scope error(s) — an identifier used where it is not visible`);
  failed += scopeBugs;
} else {
  console.log('✓ no scope errors while the app boots');
}

// These files start their own timers and polling loops on load, so the process
// will not end on its own.
process.exit(failed ? 1 : 0);
