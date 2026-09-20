#!/usr/bin/env node
/**
 * SpinLog reference-integrity checker.
 *
 * This repo has no build step, so every path in source is a path on disk — and
 * relative paths resolve against four different bases depending on where they
 * appear. This script re-implements each of those resolution rules and asserts
 * the target exists, which is the only mechanical guard against a rename or a
 * folder move silently breaking the app.
 *
 * "Silently" is the operative word: service-worker.js precaches per-asset with a
 * .catch(), so a dangling precache path only warns to console and quietly
 * degrades offline support. Nothing else in the app would tell you.
 *
 * Resolution rules implemented:
 *   index.html attrs .......... against the document (repo root)
 *   service-worker.js strings .. against the worker script (repo root)
 *   CSS url() .................. against the stylesheet's own directory
 *   JS import specifiers ....... against the importing module's directory
 *   other JS path strings ...... against the document (repo root), because they
 *                                are handed to the DOM / TextureLoader /
 *                                Notification API, which use the page's base URL
 *
 * Usage:  node tools/audit-refs.mjs [--json]
 * Exit:   0 = every reference resolves, 1 = at least one dangling reference
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');

/* ── helpers ───────────────────────────────────────────────────────────── */

const isExternal = (v) =>
  !v ||
  /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(v) || // http://, https://, //cdn
  /^(?:data|blob|mailto|tel|javascript):/i.test(v) ||
  v.startsWith('#') ||
  v.startsWith('%23') || // '#' URL-encoded inside a data: URI (SVG frag refs)
  v.startsWith('{') || // template-literal placeholder
  v.includes('${');

/** Strip query/hash, decode %20 etc., normalise to an on-disk path. */
function toDiskPath(baseDir, ref) {
  const clean = ref.split('#')[0].split('?')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    decoded = clean;
  }
  return decoded.startsWith('/')
    ? path.join(ROOT, decoded)
    : path.resolve(baseDir, decoded);
}

const refs = [];
function record({ file, line, ref, base, kind }) {
  if (isExternal(ref)) return;
  const abs = toDiskPath(base, ref);
  const ok = existsSync(abs) && statSync(abs).isFile();
  refs.push({
    file,
    line,
    ref,
    kind,
    resolved: path.relative(ROOT, abs).replace(/\\/g, '/'),
    ok,
  });
}

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Line number of a character offset. */
const lineAt = (text, idx) => text.slice(0, idx).split('\n').length;

function eachMatch(text, re, fn) {
  for (const m of text.matchAll(re)) fn(m, lineAt(text, m.index));
}

/** All files on disk, excluding non-runtime dirs. */
function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (/^(\.git|\.kiro|\.vscode|\.github|node_modules)$/.test(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else acc.push(path.relative(ROOT, full).replace(/\\/g, '/'));
  }
  return acc;
}

/* ── 1. index.html — document-relative ─────────────────────────────────── */

const html = read('index.html');
eachMatch(html, /(?:src|href)\s*=\s*"([^"]*)"/g, (m, line) =>
  record({ file: 'index.html', line, ref: m[1], base: ROOT, kind: 'html-attr' })
);

/* ── 2. manifest.json — document-relative ──────────────────────────────── */

const manifest = JSON.parse(read('manifest.json'));
const manifestText = read('manifest.json');
for (const icon of manifest.icons ?? []) {
  record({
    file: 'manifest.json',
    line: lineAt(manifestText, manifestText.indexOf(icon.src)),
    ref: icon.src,
    base: ROOT,
    kind: 'manifest-icon',
  });
}
if (manifest.start_url) {
  record({
    file: 'manifest.json',
    line: lineAt(manifestText, manifestText.indexOf(manifest.start_url)),
    ref: manifest.start_url,
    base: ROOT,
    kind: 'manifest-start_url',
  });
}

/* ── 3. CSS url() — stylesheet-relative ────────────────────────────────── */

for (const css of ['src/css/styles.css', 'src/css/home.css']) {
  // Blank out comments rather than deleting them, so line numbers survive.
  // styles.css documents a --dz-scene override as `url(...)` in prose, which
  // would otherwise be reported as a dangling reference to a file named "...".
  const text = read(css).replace(/\/\*[\s\S]*?\*\//g, (c) =>
    c.replace(/[^\n]/g, ' ')
  );
  const baseDir = path.dirname(path.join(ROOT, css));
  eachMatch(text, /url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, line) =>
    record({ file: css, line, ref: m[2].trim(), base: baseDir, kind: 'css-url' })
  );
}

/* ── 4. JS — imports are module-relative, other paths are document-relative ── */

const JS_FILES = [
  'service-worker.js',
  'src/js/script.js',
  'src/js/notifications.js',
  'src/js/sage-scheduler.js',
  'src/js/sage-memory.js',
  'src/js/sage-tools.js',
  'src/js/sage-ai.js',
  'src/js/sage-autofill.js',
  'src/js/sage-ui.js',
  'src/js/home3d.js',
  'src/js/docs3d.js',
  // Vendored three.js is scanned too: since r167 the module build is split and
  // three.module.min.js imports ./three.core.js by bare relative name. That
  // sibling requirement is invisible in app code, so it needs a guard here.
  'vendor/three.module.min.js',
];

// Path-ish string literals: must carry a known asset/script extension so we do
// not flag arbitrary text, storage keys or Supabase table names.
const ASSET_EXT = /\.(?:js|mjs|css|html|json|webp|png|jpe?g|svg|gif|woff2?|ttf|eot|sql|ico)$/i;

for (const rel of JS_FILES) {
  const text = read(rel);
  const fileDir = path.dirname(path.join(ROOT, rel));
  // A worker's own base URL is its script location, which for service-worker.js
  // at the root is the root — same as the document base. Handled uniformly.
  const docBase = ROOT;

  // 4a. ES import / export ... from '...'  → module-relative
  // Match the `from` clause directly rather than anchoring on the `import`
  // keyword with a bounded gap: minified bundles put thousands of characters
  // between the two, which would push the specifier out of any fixed window.
  //
  // Every module specifier in this repo is a relative path — there is no bundler
  // and no node_modules — so anything not starting with . or / is not one. That
  // guard matters: the bare `from\s*['"]` pattern also matches ordinary prose
  // that happens to end a string with the word "from", e.g.
  //   'Get the id from ' + 'list_media first.'
  // which was reported as a dangling import of " + ".
  const isModuleSpecifier = (v) => /^[./]/.test(v);

  eachMatch(text, /\bfrom\s*['"]([^'"]+)['"]/g, (m, line) => {
    if (!isModuleSpecifier(m[1])) return;
    record({ file: rel, line, ref: m[1], base: fileDir, kind: 'js-import' });
  });
  eachMatch(text, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, (m, line) => {
    if (!isModuleSpecifier(m[1])) return;
    record({ file: rel, line, ref: m[1], base: fileDir, kind: 'js-dynamic-import' });
  });

  // 4b. importScripts('...') → worker-relative (worker lives at repo root)
  eachMatch(text, /importScripts\(\s*['"]([^'"]+)['"]/g, (m, line) =>
    record({ file: rel, line, ref: m[1], base: fileDir, kind: 'js-importScripts' })
  );

  // 4c. every other path-shaped literal → document-relative
  const consumed = new Set(
    refs.filter((r) => r.file === rel).map((r) => r.ref)
  );
  eachMatch(text, /['"]((?:\.{0,2}\/)?[\w\-./ ]+)['"]/g, (m, line) => {
    const v = m[1];
    if (consumed.has(v) || !ASSET_EXT.test(v)) return;
    if (!v.includes('/') && !/^(?:index\.html|manifest\.json)$/.test(v)) return;
    record({ file: rel, line, ref: v, base: docBase, kind: 'js-runtime-url' });
  });
}

/* ── report ────────────────────────────────────────────────────────────── */

const broken = refs.filter((r) => !r.ok);
const referenced = new Set(refs.filter((r) => r.ok).map((r) => r.resolved));

// Entry points and non-runtime files are reachable without being referenced.
const EXEMPT =
  /^(?:index\.html|service-worker\.js|manifest\.json|README\.md|\.gitignore|docs\/|tools\/|supabase\/|assets\/source\/|vendor\/three\.core\.js)/;
const orphans = walk(ROOT).filter((f) => !referenced.has(f) && !EXEMPT.test(f));

// vendor/three.core.js is imported from inside the minified bundle, and
// assets/source/** is deliberately not shipped — both are exempt above but
// worth surfacing separately so the exemption stays honest.
const notes = [];
if (existsSync(path.join(ROOT, 'assets/source'))) {
  const srcFiles = walk(path.join(ROOT, 'assets/source'));
  if (srcFiles.length) {
    notes.push(
      `assets/source/ holds ${srcFiles.length} unshipped original(s); intentionally unreferenced.`
    );
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ refs, broken, orphans, notes }, null, 2));
} else {
  const byKind = refs.reduce((a, r) => ((a[r.kind] = (a[r.kind] ?? 0) + 1), a), {});
  console.log('SpinLog reference audit');
  console.log('═'.repeat(60));
  console.log(`Checked ${refs.length} local references across ${new Set(refs.map(r => r.file)).size} files\n`);
  for (const [k, n] of Object.entries(byKind).sort()) {
    console.log(`  ${k.padEnd(22)} ${String(n).padStart(3)}`);
  }

  if (broken.length) {
    console.log(`\n✗ ${broken.length} DANGLING REFERENCE(S)`);
    console.log('─'.repeat(60));
    for (const b of broken) {
      console.log(`  ${b.file}:${b.line}  [${b.kind}]`);
      console.log(`      ref      ${b.ref}`);
      console.log(`      resolves ${b.resolved}  <-- missing`);
    }
  } else {
    console.log('\n✓ every local reference resolves to a file on disk');
  }

  if (orphans.length) {
    console.log(`\n! ${orphans.length} file(s) on disk never referenced:`);
    for (const o of orphans) {
      const kb = (statSync(path.join(ROOT, o)).size / 1024).toFixed(1);
      console.log(`    ${o}  (${kb} KB)`);
    }
  }
  for (const n of notes) console.log(`\nnote: ${n}`);
}

process.exit(broken.length ? 1 : 0);
