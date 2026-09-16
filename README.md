# SpinLog

A motorcycle service, document and insurance tracker for a KTM Duke 250 Gen 3
("Sage"), built as an offline-capable PWA with an AI companion persona.

No build step, no bundler, no package manager. Every file is served as-is, so
**paths in source are the paths on disk**. That makes the layout below load-bearing:
see [Path rules](#path-rules) before moving anything.

## Running it

Any static file server from the repo root works. The service worker needs a real
HTTP origin, so opening `index.html` from the filesystem will not exercise the
offline behaviour.

```bash
python -m http.server 8000
# or: npx --yes serve . -l 8000
```

Then open <http://localhost:8000/>.

## Layout

```
.
├── index.html              Single entry point. All markup and the routed sections.
├── manifest.json           PWA manifest (icons, start_url).
├── service-worker.js       Precache + background notification checks.
├── src/
│   ├── css/
│   │   ├── styles.css      App shell, components, all @font-face.
│   │   └── home.css        Home/command-centre view only.
│   └── js/
│       ├── script.js           App shell: routing, Supabase CRUD, popups.
│       ├── notifications.js    Notification triggers and permission flow.
│       ├── sage-scheduler.js   Queue, daily cap, cooldowns, quiet hours.
│       ├── sage-ai.js          Gemini prompt/model config and voice lines.
│       ├── sage-ui.js          Sage settings modal and health card.
│       ├── home3d.js           three.js backdrop (ES module).
│       └── docs3d.js           three.js document drop-zone scenes (ES module).
├── assets/
│   ├── fonts/              Blender Pro (woff, woff2).
│   ├── icons/              PWA + notification badge icons.
│   ├── img/                Shipped images (sage.webp, bike-bg.webp).
│   └── source/             Unoptimised originals. NOT shipped, NOT precached.
├── vendor/                 Vendored three.js. See the note below.
├── supabase/               SQL schema for the Supabase backend.
├── docs/                   TODO.md and AUDIT.md.
└── tools/                  audit-refs.mjs — reference integrity checker.
```

## Path rules

Four different things resolve relative paths against four different bases. Getting
these confused is the main way to break this repo, and most of the failures are
**silent** — the service worker catches per-asset precache errors and only warns to
console, so a wrong path degrades offline support without breaking the page.

| Where the path lives | Resolved against | Correct form from this layout |
|---|---|---|
| `index.html` attributes | the document (repo root) | `src/js/script.js`, `assets/img/sage.webp` |
| `service-worker.js` strings | the worker script (repo root) | `./src/js/script.js`, `./assets/img/sage.webp` |
| `url()` in `src/css/*.css` | the **stylesheet** | `../../assets/fonts/...` |
| ES `import` in `src/js/*.js` | the **importing module** | `../../vendor/three.module.min.js` |
| URL strings *inside* JS passed to the DOM, `TextureLoader`, or the Notification API | the **document**, not the JS file | `./assets/img/sage.webp` |

That last row is why `src/js/home3d.js` has an `import` using `../../vendor/` and a
`BG_URL` using `./assets/` on adjacent lines. It looks inconsistent and is not.

### Two hard constraints

- **`service-worker.js` must stay at the repo root.** `src/js/script.js` registers
  it without a `scope` option, so its scope is implicitly its own directory. Moving
  it into `src/js/` would silently narrow control to `/src/js/` and the app would
  stop being installable/offline-capable.
- **`vendor/three.core.js` must stay a sibling of `vendor/three.module.min.js`.**
  Since r167 the three.js module build is split and the minified file imports its
  core by bare relative name. Move the folder as a unit or not at all.

## Verifying paths

After touching any path, run the reference checker. It re-resolves every reference
in its correct base context and asserts the target exists on disk:

```bash
node tools/audit-refs.mjs
```

Exit code 0 means every reference resolves. Non-zero lists each dangling one.

## Architecture note

The six non-module scripts are **classic scripts sharing one global scope**; they
communicate through `window.*` rather than imports. The `<script>` order in
`index.html` is therefore the only dependency mechanism, and
`sage-scheduler.js` must load before `notifications.js`. `sage-scheduler.js` is
loaded twice at runtime by design — once by the page, once by the service worker
via `importScripts` — so the page and background checks share one queue and one
daily cap. Its path appears in both `index.html` and `service-worker.js` and the
two must be changed together.

## Backend

Supabase (Postgres + storage) for records, documents and media; Google Gemini for
Sage's replies. A GitHub Action (`.github/workflows/supabase-keepalive.yml`) pings
the database daily so the free tier does not pause after 7 days idle.

See [docs/AUDIT.md](docs/AUDIT.md) for known issues, including credential handling.
