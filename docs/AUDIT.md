# SpinLog — full audit

Date: 2026-09-16 · Scope: whole repository at the v1.7.x working state
Companion to the restructure described in [../README.md](../README.md).

Every claim below is labelled **Verified** (I ran something that proves it),
**Read** (traced in source but not executed), or **Unverified** (needs access I
do not have, e.g. the Supabase dashboard). Nothing is asserted from assumption.

---

## 1. What changed in the restructure

The repo was a flat root of 13 source files with no `.gitignore`, no `README`,
and no way to tell a broken path from a working one. It is now:

```
index.html · manifest.json · service-worker.js      (root — see constraints)
src/css/{styles,home}.css
src/js/{script,notifications,sage-scheduler,sage-ai,sage-ui,home3d,docs3d}.js
assets/{fonts,icons,img}/ · assets/source/          (unshipped originals)
vendor/ · supabase/ · docs/ · tools/
```

All 8 tracked files moved with `git mv`, so history is preserved (`git status`
reports them as `R`, not add/delete).

Three things deliberately did **not** move, and the reasons are load-bearing:

| Kept at root | Why |
|---|---|
| `service-worker.js` | Registered without a `scope` option, so its scope is its own directory. In `src/js/` it would control only `/src/js/` and silently stop being a site-wide SW. **Verified:** live scope is `http://127.0.0.1:8891/`. |
| `index.html` | It is `start_url`, and the SW's `notificationclick` matches on `url.includes('index.html')`. |
| `vendor/three.core.js` | `three.module.min.js` imports it as `./three.core.js` from inside minified code. The pair must stay siblings. |

### Why the move was risky, and how it was made safe

Relative paths here resolve against **four different bases**, and the wrong
choice fails *silently* — the SW precaches per-asset inside a `.catch()` that
only `console.warn`s, so a bad path degrades offline support with no visible
error. The rules are tabulated in the README. The trap case: `src/js/home3d.js`
now has an `import` using `../../vendor/` and a `BG_URL` using `./assets/` on
adjacent lines. Both are correct — module specifiers resolve against the module,
but `TextureLoader` URLs resolve against the document.

To stop this being unverifiable by eye, the restructure ships
`tools/audit-refs.mjs`, which re-implements each resolution rule and asserts
every target exists. **It immediately caught a real mistake I had made:**
`manifest.json`'s two icon paths were left pointing at the deleted `icons/`
directory. Without the tool that would have shipped as a broken install icon.

### Verification performed

| Check | Result |
|---|---|
| `node tools/audit-refs.mjs` | **Verified** — 57 local references across 11 files, 0 dangling, exit 0 |
| Transitive HTTP graph from the 3 entry points, resolved with WHATWG URL semantics | **Verified** — 20 URLs, all 200, includes `vendor/three.core.js` |
| Real headless Chrome load (CDP) | **Verified** — 18 subresources, 0 network failures, 0 HTTP ≥400, 0 uncaught exceptions, 0 console errors/warnings |
| Live `caches.keys()` after SW activation | **Verified** — all 16 `PRECACHE` entries stored at their new paths; SW state `activated` |

One functional change was made beyond the mechanical move: `index.html` had no
`<link rel="icon">`, so every load produced a `404 /favicon.ico`. Added, pointing
at the existing 192px icon. That was the only local error in the browser report,
and it is now clean.

`CACHE_NAME` was bumped to `spinlog-cache-v1.7.35-restructure`. This is mandatory,
not cosmetic: the `activate` handler only drops caches whose key differs from the
current one, so without a bump existing installs would keep serving the old
cache full of now-nonexistent paths.

---

## 2. Security

### SEC-1 · Database is effectively a public read/write endpoint — **High**

`src/js/script.js:4` hardcodes the Supabase anon key. That alone is not the
flaw; anon keys are designed to ship to clients. The flaw is what guards the
data behind it. **Read** — `supabase/vehicle_cover.sql:28-42` enables RLS and
then opens it completely:

```sql
create policy "vehicle_cover anon read"   ... for select using (true);
create policy "vehicle_cover anon insert" ... for insert with check (true);
create policy "vehicle_cover anon update" ... for update using (true) with check (true);
```

`using (true)` with no authentication means anyone who loads the page — the key
is in the JS bundle — can read and rewrite these rows. The file's own comment
says "This project uses the anon key with no auth, matching the other tables",
so the same pattern very likely applies to `maintenance_records`, `media_files`
and `vehicle_documents`, all of which the app writes and deletes.

**Unverified:** I cannot see the live policies for those three tables, because
their SQL is not in the repo (see MNT-6). Check them in the dashboard.

For a single-user personal tracker this may be an accepted tradeoff, but it
should be a *decision*, not an accident. The realistic exposure is data loss or
vandalism by anyone who finds the URL, not just disclosure.

Options, cheapest first:
1. Accept it, and keep backups. Add a scheduled `pg_dump` so vandalism is
   recoverable.
2. Add Supabase Auth with a single user and scope every policy to
   `auth.uid() = owner_id`. This is the real fix and is a few hours of work.
3. Interim hardening: drop the `delete` policies and make `update` require a
   shared secret via a Postgres function, so a drive-by cannot wipe history.

### SEC-2 · Unpinned, unverified CDN dependency — **Medium**

`index.html:1032` loads `https://cdn.jsdelivr.net/npm/@supabase/supabase-js`
with **no version pin and no `integrity` attribute**. The app's entire data
layer is whatever that URL returns today. A major-version bump breaks the app
with no code change on your side; a registry or CDN compromise executes
arbitrary script with full access to the database key.

Pin and add SRI, e.g. `@supabase/supabase-js@2.45.4` plus `integrity="sha384-…"`
and `crossorigin="anonymous"`. Better still, vendor it into `vendor/` the way
three.js already is — the SW precaches `vendor/`, so that also makes the data
layer work offline, which it currently does not.

The Font Awesome and Google Fonts stylesheets (`index.html:9-10`) have the same
issue at lower severity, and neither is precached, so both silently disappear
offline.

### SEC-3 · Anonymous storage uploads — **Medium, Unverified**

Three buckets are written from client code: `historic-media`, `service-bills`,
`vehicle-documents`. If their policies mirror the tables, anyone can upload
arbitrary files to your project — a storage-quota and content-hosting abuse
vector. Verify bucket policies and add a size/MIME restriction. The file input
at `index.html:631` filters extensions client-side only, which is not a control.

### SEC-4 · Anon key is in git history — **Low**

The key is committed, with `exp` in 2035. Rotating it means rotating in Supabase,
not just editing the file; removing it from history needs a rewrite. Not urgent
on its own (anon keys are public by design) but it means SEC-1 cannot be
mitigated by "hiding" the key. Fix the policies instead.

### SEC-5 · Gemini key handling — **Good, with one note**

**Read** — this is done well. The Gemini key is never in the repo: it is
user-supplied, entered through a masked field (`src/js/sage-ui.js:436`) and kept
in `localStorage` as a key ring (`sage_gemini_keys`), with migration from the
older single-key form. Note only that `localStorage` is readable by any script
on the origin, so an XSS becomes key theft — which raises the value of SEC-6.

### SEC-6 · HTML injection surface — **Adequate, spot-checked**

48 `innerHTML` assignments across `script.js` and `sage-ui.js`. The user-supplied
fields that reach them are escaped: `script.js:1246`, `2261` and `785` route
notes through `docsEscapeHtml`/`escapeHTML`. Four separate escape helpers exist
(`script.js:1805`, `1815`, `3258`, `sage-ui.js:515`).

**Caveat:** I sampled these paths, I did not prove all 48 are safe. With four
near-duplicate helpers, one call site being missed is a live possibility. Worth
consolidating to a single helper and auditing each site once.

---

## 3. PWA correctness

### PWA-1 · Offline visit to the bare origin fails — **Medium, Verified**

`PRECACHE` stores `index.html`, and the fetch handler is a plain
`fetch().catch(() => caches.match(event.request))` with no navigation fallback.
A navigation to `/` therefore has nothing to match. Measured in the live
browser cache:

```
caches.match('/')            -> false
caches.match('/index.html')  -> true
```

So offline, `https://host/index.html` works and `https://host/` shows a network
error. This is **pre-existing, not introduced by the restructure** — the
precache never contained `/`.

**This matters more than it first appears.** The site is deployed to GitHub
Pages at `https://webovignesh.github.io/SpinLog_-_Master/` (**Verified** via the
Pages API: source `main`, path `/`). That canonical URL — the one you would
bookmark or share — ends in `/`, which is exactly the form that has no cache
entry. The precached entry resolves to `/SpinLog_-_Master/index.html`, so:

- offline visit to `…/SpinLog_-_Master/` → network error
- offline visit to `…/SpinLog_-_Master/index.html` → works

An *installed* PWA dodges it because `start_url` is `./index.html`. So the bug
is invisible from the install flow and hits precisely the shareable link. Worth
promoting up the priority list for that reason.

Fix — handle navigations explicitly:

```js
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
```

### PWA-2 · Network-first with no timeout — **Medium, Read**

`service-worker.js:49-54` always tries the network first and only falls back on
rejection. On a connection that is present but not working ("lie-fi") the
fallback waits for the TCP/HTTP timeout, so a cached-and-ready app can take tens
of seconds. Race the network against a short timer, or serve cache-first for the
static precache and reserve network-first for Supabase calls.

### PWA-3 · Notification badge is not precached — **Low, Read**

`assets/icons/icon-192.png` is used as the notification `badge` in four places
(`service-worker.js:78`, `233`; `notifications.js:443`) but is absent from
`PRECACHE`. Background notifications fire exactly when connectivity is likely
poor, so add it — 8 KB:

```js
  './assets/icons/icon-192.png',
```

I left this out of the restructure deliberately, to keep the move a verifiable
no-op rather than bundling behaviour changes with it.

### PWA-4 · Manifest gaps — **Low, Read**

No `scope`, no `id`, no `screenshots`. `scope` and `id` improve install identity
and stop the PWA from navigating outside itself; `screenshots` unlock the richer
install UI. Also `orientation: portrait-primary` locks out landscape on tablets.

---

## 4. Performance

### PERF-1 · 1.9 MB unreferenced image — **Medium, Verified**

`Bike bg.png` (2,020,085 bytes) is referenced **nowhere** — a case-insensitive
search across every file, including markdown and workflows, returns zero hits.
Its optimised derivative `bike-bg.webp` (138,564 bytes) is what actually ships.
The PNG was 93% of the repo's asset weight.

I moved it to `assets/source/` rather than deleting it, since it is untracked
and deletion would be unrecoverable. It is excluded from the SW precache and
from the audit tool's orphan check. **Recommend deleting it** (a copy is in the
backup zip noted below) or keeping it there permanently as the design source.

### PERF-2 · 364 KB of unminified CSS on the critical path — **Medium, Verified**

`src/css/styles.css` is 13,612 lines / 372,874 bytes, plus 55,263 bytes of
`home.css`, both render-blocking. With no build step this ships as-is. Gzip will
take most of it on the wire, so the practical costs are parse time on low-end
mobile and the sheer difficulty of editing the file. Splitting per-view CSS and
loading non-home sheets lazily would help both.

### PERF-3 · One image size for four very different slots — **Low, Verified**

`sage.webp` is 256,934 bytes and serves the hero *and* three ~32px avatars
(`index.html:86`, `789`, `sage-ui.js:539`). The avatars download a
hero-resolution file. A 64px variant plus `srcset` would cut most of it.

### PERF-4 · No asset fingerprinting — **Low**

Assets have stable names, so `CACHE_NAME` is the only cache-busting mechanism
and any forgotten bump serves stale files. Fine for this scale; worth knowing.

---

## 5. Maintainability

### MNT-1 · 2,640 `!important` declarations — **High for maintenance, Verified**

In 13,612 lines of `styles.css` that is roughly one every five lines
(`home.css` adds 20 more). At this density the cascade no longer functions as a
cascade: every new rule needs `!important` to land, which is self-reinforcing.
This is the single biggest obstacle to changing this app's UI safely.

There is no quick fix. The tractable path is to stop the bleeding — treat new
`!important` as a bug — and unwind opportunistically, starting with the highest-
specificity selectors, since most of these exist to beat a selector that could
simply be made less specific.

### MNT-2 · `script.js` is 3,397 lines exporting 30+ globals — **Medium, Read**

The six classic scripts share one global scope and communicate through `window.*`
with no imports, so `<script>` order in `index.html` is the only dependency
declaration. `notifications.js` hard-requires `sage-scheduler.js` to have loaded
(`self.SageScheduler` at 9 sites). Most other consumers are optional-chained, so
a wrong order degrades silently rather than erroring — hard to debug.

I documented the ordering contract in the README, which is the cheap mitigation.
The real fix is converting to ES modules with explicit imports; the two `type="module"`
files show the pattern already works here.

### MNT-3 · Four duplicate HTML-escape helpers — **Low, Verified**

`escapeHTML`, `escapeAttr`, `esc`, `escapeHtml`. Consolidate to one; see SEC-6.

### MNT-4 · `@font-face` declares two weights from one Heavy file — **Low, Verified**

Both blocks in `styles.css:1-16` point at `BlenderPro-Heavy`, one as
`font-weight: 400`, one as `700`. So body copy asking for normal weight gets
Heavy, and bold is indistinguishable from normal. Either ship a real regular
weight, or drop the 400 block and stop implying a weight range that does not
exist.

### MNT-5 · Version number disagrees in five places — **Low, Verified**

`index.html:6` meta says `1.7.2`; the SW cache said `v1.7.34`; the folder name
says `v1.6.52`; the last commits say `v1.6.56`; a stale comment at
`index.html:324` says `v1.6.37`. Pick one source of truth and derive the rest.

### MNT-6 · Backend schema is only partly version-controlled — **Medium, Verified**

The app uses three tables (`maintenance_records`, `media_files`,
`vehicle_documents`) and three storage buckets, but `supabase/` contains SQL for
only `vehicle_cover`. The backend cannot be rebuilt from this repo, and — as
SEC-1 shows — the security posture of the other tables is not reviewable. Export
the full schema and policies into `supabase/`.

### MNT-7 · No linter, formatter, or tests — **Low**

Nothing mechanical guards this codebase except the reference checker added here.
A `.editorconfig` and ESLint with `no-undef` would catch the global-coupling
class of bug directly, and needs no build step.

---

## 6. Accessibility

The baseline is genuinely good. **Verified** counts in `index.html`: 4 `<img>`,
**0 missing `alt`**; 62 `<button>`, **0 without a text label or `aria-label`**;
47 `aria-label`, 89 `aria-hidden` on decorative icons, 39 `role`, 9 `aria-live`
regions, and 6 `prefers-reduced-motion` blocks across the CSS with the WebGL
backdrop honouring it. That is more care than most projects this size show.

Two things to look at:

- **A11Y-1 (Low)** — 9 visible `<input>` elements have no `id`, `aria-label` or
  `aria-labelledby` on the element itself. Some are likely wrapped in a `<label>`,
  which is valid; my check could not distinguish that. Worth a manual pass.
- **A11Y-2 (Low)** — only one `sr-only` usage. Several icon-only controls convey
  state through colour and glyph alone (the DB status chip, cover due states).
  Confirm a screen-reader user gets the state, not just the label.

Full WCAG conformance cannot be established by static inspection. These findings
come from markup analysis; real validation needs testing with a screen reader
and keyboard-only navigation, plus expert review.

---

## 7. Priority order

| # | Finding | Severity | Effort |
|---|---|---|---|
| 1 | SEC-1 Open RLS policies / no auth | High | Medium |
| 2 | PWA-1 Navigation fallback in SW — breaks the canonical Pages URL offline | Medium | Low |
| 3 | SEC-2 Pin + SRI (or vendor) `supabase-js` | Medium | Low |
| 4 | SEC-3 Verify storage bucket policies | Medium | Low |
| 5 | MNT-6 Commit the full schema | Medium | Low |
| 6 | PERF-1 Delete the 1.9 MB dead PNG | Medium | Trivial |
| 7 | PWA-2 Timeout on network-first | Medium | Low |
| 8 | MNT-1 Stop new `!important`; unwind slowly | High (maint.) | Ongoing |
| 9 | PWA-3, MNT-3/4/5, PERF-3, A11Y-1/2 | Low | Low |

Items 2 through 7 are all small, independent, and together remove most of the
concrete risk. Item 2 is now the best value for effort: a handful of lines, and
it fixes offline loading of the link you would actually give someone.

## Deployment

**Verified** post-merge against the live site
`https://webovignesh.github.io/SpinLog_-_Master/`: all 21 shipped paths return
200, and the five pre-restructure locations (`styles.css`, `script.js`,
`Imgs/sage.webp`, `icons/icon-192.png`, and the uncommitted source PNG) all
return 404 as intended. The served `index.html` contains 12 references into
`src/` or `assets/` and zero pre-move references.

Because Pages serves this from a project subpath rather than a domain root,
every path in the app must stay **relative** (`src/js/script.js`, `./assets/...`,
`../../vendor/...`). Introducing a root-absolute path such as `/src/js/script.js`
would resolve to `webovignesh.github.io/src/js/script.js` and 404 in production
while still working on a local server at the root. `tools/audit-refs.mjs` treats
a leading `/` as repo-root-relative and so would *not* catch that — it is the
one class of path mistake the checker cannot see.

---

## Notes

- A full pre-restructure snapshot is at
  `../Spinlog-BACKUP-20260916-232353.zip` (2.7 MB), taken before any file moved.
  It contains the uncommitted work that was in the tree at the time, including
  the dead PNG.
- Re-run the reference check after any path change: `node tools/audit-refs.mjs`
  (exit 0 = clean). The three `tools/_verify-*.mjs` scripts used for the browser,
  transitive-HTTP and cache verification were temporary and have been removed;
  the findings they produced are recorded above.
