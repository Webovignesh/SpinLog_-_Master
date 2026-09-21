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
│       ├── cloud-store.js      Shared app state, so two devices agree.
│       ├── sage-confirm.js     Slide-to-delete. The only delete confirmation.
│       ├── date-picker.js      The app's own calendar; replaces the native picker.
│       ├── bill-merge.js       Several files for one bill, merged into one PDF.
│       ├── notifications.js    Notification triggers and permission flow.
│       ├── sage-scheduler.js   Queue, daily cap, cooldowns, quiet hours.
│       ├── sage-memory.js      What she knows about the rider. Cloud-backed.
│       ├── sage-tools.js       The app controls she can actually operate.
│       ├── sage-ai.js          Gemini prompt/model config and voice lines.
│       ├── sage-keyvault.js    Encrypted cloud backup of the API key ring.
│       ├── sage-autofill.js    Drafts the service and document forms.
│       ├── sage-ui.js          Sage chat, settings dialog and health card.
│       ├── home3d.js           three.js backdrop (ES module).
│       └── docs3d.js           three.js document drop-zone scenes (ES module).
├── assets/
│   ├── fonts/              Blender Pro (woff, woff2).
│   ├── icons/              PWA + notification badge icons.
│   ├── img/                Shipped images (sage.webp, bike-bg.webp).
│   └── source/             Unoptimised originals. NOT shipped, NOT precached.
├── vendor/                 Vendored three.js, plus pdf-lib for bill-merge.
├── supabase/               SQL schema for the Supabase backend.
└── tools/                  The four audits — see Verifying.
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

## Verifying

Four checks. The first two are fast and neither is optional after touching
`src/js/`. The last two need Chromium and are what you run before calling
something finished.

```bash
node tools/audit-refs.mjs     # every path still resolves
node tools/audit-boot.mjs     # the app still boots

npm i --no-save playwright@1.49.1 && npx playwright install chromium
node tools/audit-mobile.mjs   # the two long lists lay out on a phone
node tools/audit-app.mjs      # the app works, reads and responds
```

The two Chromium audits **never write to the database**. Every non-GET request to
Supabase is answered locally, so they are safe against the live project; GETs go
through, because an audit against an empty table only ever checks empty states.
Without Playwright installed both exit 0 with instructions rather than failing, so
they can sit in a hook without breaking anyone who has not installed it.

`audit-refs.mjs` re-resolves every reference in its correct base context and asserts
the target exists on disk. Exit 0 means every reference resolves; non-zero lists
each dangling one.

`audit-boot.mjs` loads every classic script into one shared global in `index.html`
order and fires `DOMContentLoaded`. **It reads the script list out of `index.html`
rather than holding its own copy** — it used to hold one, under a comment claiming
the two were in step, and by the time anyone noticed `date-picker.js` and
`bill-merge.js` had been on the page for several versions without ever being
checked. It exists because `node --check` reads one file at a time and checks only
syntax, so it cannot see either of the two mistakes that take the whole app down:

- **A scope error.** `script.js` is one enormous `DOMContentLoaded` handler with
  several sections after it at true top level, and indentation does not reliably
  tell you which side of that line you are on. An identifier declared inside the
  handler and used outside it throws during evaluation, so everything below that
  point never gets defined — which presents as an app stuck mid-boot with one
  section rendered.
- **A duplicate top-level `const`.** Two scripts declaring the same name at top
  level is `Identifier 'X' has already been declared`, and the second one dies.

The first of those shipped once. `node --check`, `audit-refs` and editor
diagnostics all reported the change clean.

Reading the output: there is no real DOM in the harness, so a `TypeError` on a null
element means the boot simply got that far and is expected. A `ReferenceError` is a
real bug and fails the run.

`audit-mobile.mjs` renders the service and documents sections in real Chromium at
phone size and measures them. It exists because three rounds of mobile CSS shipped
looking right in the source and wrong on the screen, every time because a property
the new rule did not *mention* was still being set by one of the older `@media`
blocks. Reading the file cannot see that; the file is correct and the cascade is
not. `--shots` writes PNGs next to it.

`audit-app.mjs` drives the whole app — every section, every control, both dialogs —
and then asserts the invariants that hold everywhere: no uncaught error, no console
error, every `window.*` the modules look each other up by, no duplicate id, no
dangling `aria-*` reference, one `h1`, every decorative icon hidden from assistive
tech, the version on screen matching the meta tag, routing that moves focus into the
section it opened, WCAG AA contrast, a visible focus state on every focusable
control, motion actually stopping under `prefers-reduced-motion`, and nothing
overflowing the viewport at nine widths.

Two things about it are worth knowing before changing it.

**Contrast is measured off the rendered pixels, not modelled from the cascade.** The
first version composited every translucent background up the tree, which is what you
would do by hand, and it was wrong: the docs panels carry
`radial-gradient(circle at 12% 0%, rgba(251,105,0,.16), transparent)` — a glow in the
top-*left* corner — and taking a gradient's lightest stop put that glow underneath a
pill in the top-*right* and reported a failure against a background that is not on
the screen. Doing it properly means solving the gradient geometry, then
`backdrop-filter`, then the photograph behind all of it. So it screenshots each
section with `color: transparent` forced on everything and reads the actual colour
behind each run of text. Exact, and it handles all three.

**The reduced-motion check is the one that found a real hole**, and the reason is
worth keeping in mind whenever you add a reduced-motion rule: the universal reset is
`*, *::before, *::after`, specificity (0,0,0). Between two `!important` author
declarations importance ties and **specificity decides**, so the reset beats an
ordinary declaration and loses to every `!important` one. The service form has six of
those, and `.service-type-shell.custom-entry-select` at (2 ids, 2 classes) was
quietly outranking the reduced-motion block at (2 ids, 1 class). A reduced-motion
rule has to be at least as specific as the rule it is switching off.

## Architecture note

The thirteen non-module scripts are **classic scripts sharing one global scope**; they
communicate through `window.*` rather than imports. The `<script>` order in
`index.html` is therefore the only dependency mechanism, and
`sage-scheduler.js` must load before `notifications.js`, while `sage-confirm.js`
must load before `script.js` — it owns `confirmDeleteWithHold()`, which the
delete paths in `script.js` call. `sage-scheduler.js` is
loaded twice at runtime by design — once by the page, once by the service worker
via `importScripts` — so the page and background checks share one queue and one
daily cap. Its path appears in both `index.html` and `service-worker.js` and the
two must be changed together.

## Backend

Supabase (Postgres + storage) for records, documents, media and Sage's memory;
Google Gemini for Sage's replies. A GitHub Action
(`.github/workflows/supabase-keepalive.yml`) pings the database daily so the free
tier does not pause after 7 days idle.

### Migrations

`supabase/` holds one file per table that was added after the original schema.
Each is idempotent — paste it into the Supabase SQL editor and run it once:

| File | What it adds |
| --- | --- |
| `vehicle_cover.sql` | Insurance and cover expiry dates. |
| `sage_memory.sql` | Sage's memory bank: facts about the rider, her rolling recap, relationship counters and conversation episodes. |
| `gemini_keys.sql` | Encrypted backup of the Gemini API key ring. Optional — read the header before running it. |
| `cloud_routing.sql` | Routes the last of the device-only data through the cloud: two columns on `media_files`, three more `record_type` values in `sage_memory`, and the DELETE policies those need. **No new tables.** Run this to make a laptop and a phone agree. |

All three degrade quietly until run. Cover dates fall back to localStorage and
then to the `data-due` values in `index.html`; Sage's memory falls back to
localStorage alone, which is where it lived before the table existed; the key
ring simply stays on the device. Nothing breaks, but her memory does not survive
clearing site data or moving to another device until `sage_memory.sql` has been
run.

### What lives where, and why

Your data is in the database and is read back from there, so a laptop and a phone
show the same thing. `src/js/cloud-store.js` (`window.dkCloudStore`) owns the last
four things that were not.

| Data | Where | Why |
| --- | --- | --- |
| Service records, documents, media | Own tables | Relational, queried, reported on |
| Cover expiry dates | `vehicle_cover` | Same, via `dkCoverStore` |
| Sage's memory | `sage_memory`, `record_type = fact / recap / relationship / episode` | Queried by kind, topic and archived state |
| Park history | `sage_memory`, `record_type = 'park'` | One row per spot |
| Conversation | `sage_memory`, `record_type = 'message'` | One row per message |
| Purchase-date override | `sage_memory`, `record_type = 'setting'` | One row per setting |
| Upload notes and dates | `media_files.notes`, `media_files.historic_date` | Columns on the row they describe |
| Custom document cards | Device cache only | Derived from `vehicle_documents`; already crosses devices through it |
| Notification queue, cooldowns, limits | IndexedDB | The service worker reads these with the app closed and cannot see localStorage |
| Vault passphrase | Device only, never sent | It is the only thing making the encrypted key backup private |
| Device id, connection status, active tab, model cache, rate-limit counters | Device only | Per-device by definition |

**No new tables**, and that shaped the design rather than being worked around.
Notes and dates were a JSON map in localStorage keyed by the `media_files` row id,
which is a foreign key pretending not to be one; they are columns on that row now,
so they travel with the upload and are deleted with it. The other three are extra
`record_type` values in `sage_memory`, which was built to hold several kinds of row
told apart by that column and already has the unique `mem_key` index, a `jsonb`
column, `updated_at`, and a full RLS set.

An earlier version of this used one key/value table of JSON blobs. It worked and it
was the wrong shape: nothing could be queried, ordered or counted, and a single
parked spot could not be deleted without rewriting the whole list. Every read is a
real query now and every delete removes a real row.

Reads are **synchronous** against a cache that `load()` fills once at boot. The call
sites are render paths that expect a value in hand; making a dozen of them async to
await a round trip would have traded one bug for a screen of spinners. The cache is
memory only — nothing is mirrored to localStorage, which is the point.

`SageMemory.pull()` ignores record types it does not know and `clear()` only
tombstones her own four, so none of this is touched by her memory syncing or by
"forget everything". Where you parked is not something she remembers about you.

The Gemini keys and the vault passphrase are deliberately **not** in any of this.
The anon key ships in the page, so every table here is effectively public; the key
ring already crosses devices through its own encrypted backup, and the passphrase
is the only thing making that backup private.

#### DELETE policies are not optional

Without a DELETE policy a delete affects zero rows **and returns no error**. The app
removes the thing from the screen, reports success, and the row is still there on
the next load. Three paths depended on policies that were never written — clearing
the conversation, forgetting a parked spot, and trimming either list to its cap —
which is why `cloud_routing.sql` asserts them on both tables it touches. A delete
without a policy is a lie, and it is a silent one.

### A note on the key vault

This app reaches Supabase with the anon key, and that key ships inside the
JavaScript the browser downloads. Every RLS policy here is `using (true)`,
because there is no login. Any table is therefore effectively world-readable,
which is fine for service records and bad for credentials.

So `gemini_keys` never holds a key in plaintext. Each one is encrypted in the
browser with AES-256-GCM under a key derived by PBKDF2-SHA256 from a passphrase
you choose, and that passphrase is never transmitted or stored server-side. What
the table exposes is the number of keys, their already-visible masked labels, and
ciphertext.

WebCrypto requires a **secure context**, so backup is unavailable over plain
`http` from anything other than `localhost`. Testing on a phone over
`http://192.168.x.x` will report "Not available here" — that is the browser
withholding `crypto.subtle`, not a bug. `SageKeyVault.diagnose()` in the console
names this and every other failure state, and the Check backup button in
settings shows the same thing on screen.

The rule the backup panel follows, learned the hard way: **one button, one
effect.** Nothing changes the key ring or the vault as a side effect of something
else.

| Action | Device | Cloud |
| --- | --- | --- |
| Add a key | adds | adds (if unlocked) |
| Remove a key (×) | removes | **untouched** |
| Remove all | clears | **untouched** |
| Unlock | **untouched** | adds anything missing |
| Restore | adds what is missing | untouched |
| Back up now | untouched | adds what is missing |
| Match device | untouched | adds *and removes* to match |
| Delete backup | untouched | empties |

Only **Match device** and **Delete backup** ever remove a row, and both go through
the slide dialog first — Match device only when it would actually drop something,
because asking about a no-op teaches people to slide without reading. Adding to
the cloud is allowed to happen automatically because it is purely additive and
cannot destroy anything.

Earlier builds broke this three separate ways: `push()` pruned the vault whenever
the ring shrank, the per-key × called a `dropKey()` that no longer exists, and
Unlock called a `sync()` that pulled. All three are gone, and the functions
themselves were deleted rather than merely unwired — leaving them in place is what
let them get attached to the wrong buttons. If you are editing
`sage-keyvault.js`, keep `push()` additive and do not reintroduce a combined
operation.

The consequence is deliberate: lose the passphrase and the backup is
unrecoverable. A recoverable backup would be one the server could decrypt, which
is the thing being avoided. If you would rather not store keys off-device at all,
do not run the migration — the Backup panel will simply report that it is not set
up.

### Deleting anything

Every destructive action in the app goes through one dialog: `SageConfirm.slide()`
in `src/js/sage-confirm.js`. There is no second confirmation pattern, and
`window.confirm` is not used anywhere.

```js
if (await SageConfirm.slide({ title: 'Delete this record?' })) { … }
```

It replaced a press-and-hold button that had three problems worth not repeating: it
built its dialog inside `#customPopup`, the same element `showPopup()` uses for
"Deleting…", so the confirmation and the progress it caused were one node;
`mouseleave` cancelled the hold, so a finger that drifted reset the countdown with
no explanation; and it had no cancel callback, so callers had to poll the overlay's
class list to notice a dismissal.

Two rules it keeps:

- **Commit at 92% of the track, not 100%.** The thumb has width, and demanding the
  last pixel makes the control feel broken on a narrow phone.
- **Enter only commits when the slider is already at the end.** A single keypress
  must never be able to delete data.

`confirmDeleteWithHold(message, onConfirm, options)` is kept as a callback-shaped
alias for the three delete paths in `script.js`. The name is now wrong and the
behaviour is a slide; renaming it would churn call sites for nothing.

### Memory: forgetting, restoring and destroying

Three verbs, and the difference between them is the whole design.

| Call | Device | Cloud | Reversible |
| --- | --- | --- | --- |
| `forget(id)` | archives | sets `archived_at` | yes, via `recoverForgotten` |
| `recoverForgotten({keys})` | un-archives | clears `archived_at` | yes, via `forget` |
| `purge({keys})` | removes | **DELETEs the row** | **no** |
| `clear()` | wipes | **DELETEs every row of hers** | **no** |
| `restore({keys})` | adds what is missing | untouched | n/a |

`clear()` deletes **by `record_type`**, not from a list built out of local state.
That mattered: building the list locally deleted only the rows this device happened
to know about, so anything archived more than `TOMBSTONE_KEEP_MS` ago (pruned off
the device) or only ever written on another phone was never in the list. "Forget
everything" emptied the screen and left the table populated. It is one statement
now, scoped to `RECORD_TYPES`.

**But "Forget everything" is not just `clear()`.** It also calls
`dkCloudStore.clearChat()`. `RECORD_TYPES` covers her four types and not `message`,
so a wipe used to leave the conversation sitting in the table — four rows in, two
rows out. The original reasoning was that a transcript is not a memory and the chat
header has its own clear button, and it does not survive contact with her own
controls: `search_conversation` reads those rows, so she could still recite what he
had just asked her to forget, and `consolidate()` writes a recap from them, so the
next conversation would rebuild her memory out of the transcript that survived the
wipe. Forgetting everything while keeping the record of everything is tidying the
index, not forgetting. `forget_everything` does both halves too, and reports
`conversationCleared` so she does not claim more than happened — she cannot delete
the exchange she is in the middle of.

Park spots and settings stay. Where he left the bike is not something she knows
about him, and his purchase-date override is configuration.

`clearChat()` and `clearPark()` now delete **by `record_type`** as well, for the
reason `clear()` already did: this device only ever holds the newest `CHAT_KEEP`
turns and `PARK_KEEP` spots, so a list built from the cache left behind everything
older than the window and everything only ever written on the other phone. Both
also `cancel()` any queued write first — `setChat()` defers its INSERTs by
`PUSH_DEBOUNCE_MS`, so sending a message and immediately clearing the log raced, and
the message won.

Forgetting is a **soft delete on purpose**. The row stays with `archived_at` set so
the forget reaches his other devices, instead of the fact being pushed straight
back up by the next one to sync. A hard delete would resurrect it.

#### One thing, one memory

`remember()` decides between four outcomes, and getting this wrong in either
direction is visible: too strict and she holds two notes for one fact, too loose and
a note disappears silently.

| Outcome | When | Effect |
| --- | --- | --- |
| `refreshed` | same `fingerprint()` | bumps `hits`, keeps the longer wording |
| `refined` | `refines()` — same kind, same topic, same horizon, and the new text is a **strict superset** of the old one's content words | rewrites the note **in place**, keeping its id and history |
| `added` + `replaced` | `contradicts()` — heavy word overlap plus a changed figure or a flipped negation | supersedes and archives the old one |
| `added` | none of the above | a new note |

`refines()` is what stopped "Viky is planning a ride next week" and "He is planning
a ride to Valparai next week" being two memories. They are not duplicates — the
fingerprints differ because one names the destination — and they do not contradict,
since no figure changed. Strict superset is the safety property: the new note has to
contain every content word of the old one and add at least one, so nothing is lost
by merging. That is why "rides to work every day" and "rides to college every day"
are left as two, and why a pinned note is never rewritten.

`contradicts()` compares overlap with `overlapWords()`, which **ignores figures**. A
changed number is the signal that two notes disagree, so letting it also count as
evidence they are about different subjects is backwards — and it meant "due at
12000 km" and "due at 14000 km" scored 0.5, fell under the threshold, and were kept
as two different answers to one question.

His name is stripped before any of these comparisons (`OWNER_TOKENS`), because she
writes "Viky is planning…" one minute and "he is planning…" the next; the pronouns
are already stopwords, the name is not.

The cost of that is what `purge()` exists for: "forgotten" was a state that only
ever grew, and a memory he had deliberately dropped stayed listed as recoverable
for good. It is surfaced as **Delete for good** in the Pick chooser.

Two things about `purge()` that are easy to get wrong:

- With **no** argument it reads the archived `mem_key`s back from the table before
  building the tombstone list. Local state cannot answer "what is in the archive" —
  `prune()` drops archived facts older than `TOMBSTONE_KEEP_MS` (30 days), so the
  rows most in need of purging are exactly the ones no longer on the device.
- A named key with no local fact is still destroyed, for the same reason. The
  delete is by `mem_key` and needs no local row.

`listRemote()` returns the two lists the chooser draws, because they come back by
two different routes and sending one down the other's path silently does nothing:
`restorable` (live facts this device lacks) and `forgotten` (archived rows). Both
exclude anything she already knows, matched on wording as well as on key — the same
fact learned on two devices has two ids, and offering it back would add a duplicate
rather than restore anything.

A filtered `pull({ keys })` deliberately does **not** stamp `sync.lastPullAt`.
Recording a four-row read as a full sync would tell the rest of the app this device
is up to date when it has not seen the other thirty-six.

**Anything holding a queued tombstone is invisible to `pull()`,
`recoverForgotten()`, `listRemote()` and `remoteSummary()`.** This is not tidiness.
`purge()` removes the fact locally and queues its `mem_key`; `push()` then issues
the DELETE. Anything that pulled in between found the row still in the table and
adopted it back as a live fact — and opening settings runs a full sync, which pulls
before it pushes. The delete then removed the row and left the local copy behind, so
a deleted memory reappeared. With a refused DELETE it was permanent: the tombstone
stays queued, the row stays, and every pull re-adopted it. A key queued for deletion
is treated as already gone by every read.

Anything that changes `archived_at` **awaits its push** rather than leaving it to
`commit()`'s 1.5-second debounce. The settings panel re-reads the cloud the instant
these resolve, so a scheduled push meant it read rows that still had the old flag —
which is how a successful recovery left "Forgotten: 1" on screen. The count was
right about the server and wrong about what had just happened.

### A plan is not left to her discretion

Both of her saving channels — the `remember` control and the `[[remember: …]]` line
in `CHAT_RULES` — are the *model's* choice. Under `thinkingBudget: 0` and a length
rule that says one sentence then stop, that choice is frequently no. "we are going
out tommo babe" got a warm reply and nothing else: no control call, no sentinel, so
nothing ever reached `remember()` for any gate to accept or refuse.

`SageMemory.glean(message)` is the net under that, and `askSage` calls it **only when
the turn kept nothing at all** — no sentinel, no successful `remember` call. It is
deliberately narrow: the message must name a day (or be an outright "remind me"),
state an intention, be about him, not be a question, not be an instruction to the
app, and not already be over. Everything else stays her judgement, because a net wide
enough to catch every passing remark would fill her memory with the conversation.
A dated plan is the one thing that is worthless the day after it is missed.

Three details in there are load-bearing:

- **Shorthand is expanded before classifying.** `classify()` and `horizonFor()` both
  look for the literal word `tomorrow`, so without `SHORTHAND` "tommo" is filed as an
  undated `fact` and never reaches `checkPlans()` at all.
- **It stores his words, not a rewrite.** `He said: <his words>`. A regex cannot turn
  "we are going out tommo babe" into decent English about him, and half-rewritten
  grammar would sit in the memory list where he can see it. No quotation marks
  around them either: `remember()` strips quote characters off both ends of a note,
  so `He said: "…"` came back out with the closing mark gone.
- **The duplicate check compares the words inside, with shorthand expanded**
  (`saidPart()` + `plainWords()`). Otherwise her own "he is going out with her
  tomorrow" and his `He said: we are going out tommo` share almost no tokens and she
  ends up holding one plan twice.

### `hidden` did not hide anything

`[hidden] { display: none }` is in the **browser's** stylesheet, so any author rule
setting `display` outranks it. Nine elements were toggled with `el.hidden = …` while
also carrying a class that set `display`, which meant the toggle did nothing at all:

`#sageVaultPassRow`, `#sageVaultActions`, `#sageVaultLock`, `#sageVaultDelete`,
`#sageAttachChip`, `#sagePermAllow`, `#sageMemSearchClear`, `#sageKeyDanger`,
`#serviceHistoryFilterCount`.

The visible one was the backup card: the passphrase field and its Unlock button
stayed on screen after the vault unlocked, so it read "Backed up — 6 keys encrypted
in the cloud" with a box asking for the passphrase underneath. Also an empty
attachment chip in the chat composer, an Allow button after notifications were
already granted, and a clear-search cross over an empty box.

Fixed with one `[hidden] { display: none !important; }` near the top of styles.css.
The `!important` is load-bearing: the competing rules are classes, so they tie or beat
`[hidden]` on specificity and source order cannot settle it. **The constraint that
creates: never write `display: <not none> !important` on an element whose `hidden` is
toggled** — that would tie on importance and win on order or specificity. There are
~110 `!important` display rules in this file and none currently land on one.

A second bug was hiding behind the first. `renderVault()` treated
`vaultRemote === null` — "countRemote() has not answered yet" — as zero, so for the
second or two before two network reads landed the card claimed "Not backed up" and
offered to create one, then corrected itself. Once `hidden` started working, that
correction changed the card's height and shifted every button below it while you were
reading. `null` now renders a "Checking your backup…" state with a spinner instead.

### What is actually in the table, and what bounds it

One saved memory is **one row**. `sage_memory` carries seven record types, so a
single exchange writes more than one row and only one of them is a memory:

| `record_type` | Rows | Bounded by |
| --- | --- | --- |
| `fact` | one per thing she knows | `MAX_FACTS` 240 live, archived rows cleared by `sage_memory_prune()` after 30 days |
| `episode` | one per conversation | `MAX_EPISODES` 40, overflow tombstoned and deleted |
| `recap` | exactly one, ever | fixed `mem_key` |
| `relationship` | exactly one, ever | fixed `mem_key`, upserted — `rev` climbs, the row does not multiply |
| `message` | one per chat turn | `CHAT_KEEP` 80, oldest deleted |
| `park` | one per saved spot | `PARK_KEEP` 5, oldest deleted |
| `setting` | one per setting name | fixed `mem_key` |

Three views exist so the raw table never has to be read by eye:
`sage_memory_summary` (counts per `record_type`), `sage_memory_facts` (just the
memories) and `sage_conversation` (just the chat, newest first). Read those — the
table looking busy next to one saved memory is the counters and the conversation,
not duplication.

The table's own comment says this too, because the name works against it. **One
chat exchange writes two `message` rows and updates the single `relationship` row
without creating a memory at all, and that is the normal outcome.** Most exchanges
produce no `fact`: a question is not a statement, so `glean()` refuses it, and an
answer built from a figure she already had is something `CHAT_RULES` explicitly
tells her not to write down. Three new rows and nothing new in the memory list is
correct, not a leak.

Four things used to grow without limit, and none of them do now:

- **`pull()` read the whole table**, `select('*')` with no `record_type` filter,
  then ignored everything that was not hers. PostgREST caps a response at
  `max-rows` (1000 by default) and an 80-turn conversation was spending that
  budget on rows it discarded — past the cap you get an arbitrary subset in
  physical row order, so chat traffic could crowd her facts out of the pull and
  the symptom would be her having forgotten things. Now `.in('record_type',
  RECORD_TYPES)`. `listRemote()`, `remoteSummary()` and `recoverForgotten()`
  already scoped themselves; `pull()` was the one that did not.
- **`cloud-store.load()` read every row unordered and sliced the surplus off in
  memory.** Two bugs in one line: without an `ORDER BY`, `.slice(-80)` past the
  cap could be the wrong eighty; and rows dropped from the cache were never
  deleted, which made them unreachable for good — `setChat()` diffs against the
  cache, so a key it can no longer see can never appear in its delete list again.
  Now three ordered, limited reads (settings separately, or a busy chat could push
  `ageFrom` out of the window and silently lose it), and anything over the cap is
  deleted rather than forgotten. It converges: each load clears the surplus it can
  see.
- **Episode overflow was a bare local `slice(-MAX_EPISODES)`.** Slicing an array
  is invisible to the server, so the row was neither deleted nor archived — and
  `sage_memory_prune()` could not see it either, since it only matches
  `archived_at is not null`. One row per conversation, for ever, re-adopted and
  re-sliced on every pull. `trimEpisodes()` now queues them as tombstones, which
  `push()` turns into a DELETE and `pull()`'s `doomed` guard stops being adopted
  back in the meantime.
- **`sage_memory_prune()` was never called by anything** — not the app, not
  pg_cron, not the keepalive workflow. Its own comment said "call it whenever you
  feel like it", which meant never, so every forgotten memory stayed for good.
  `housekeep()` now calls it over rpc once a day, unawaited, off the back of a
  sync. It stamps `sync.lastPruneAt` *before* the call, so a database where the
  function was never created is not retried on every sync for the rest of the day.

The `remember` control also takes `kind` and `when` now. `TOOL_RULES` had been asking
her for "kind plan" against a schema with nowhere to put it, so every kind and every
horizon was re-derived by regex from the wording — and a plan for the 14th, or for
"after Diwali", fell through to the flat 21-day `PLAN_TTL_DAYS`. A `when` with no
`kind` is forced to `plan`, because the kind is what decides whether it reaches her
reminders.

## Known limits

There is no `docs/` folder. This file used to link to `docs/AUDIT.md` and list
`docs/TODO.md` in the layout above; neither has existed for a while, so both are
gone rather than left as links that go nowhere. What was in them that still matters:

- **The anon key ships in the page and every RLS policy is `using (true)`,** because
  there is no login. Every table is effectively world-readable. That is fine for
  service records and is the whole reason `gemini_keys` never holds a key in
  plaintext — see [A note on the key vault](#a-note-on-the-key-vault).
- **The vault passphrase is unrecoverable by design.** A backup the server could
  decrypt is the thing being avoided.
- **Encrypted backup needs a secure context.** Over plain `http` from anything other
  than `localhost` the browser withholds `crypto.subtle` and the panel reports "Not
  available here". That is not a bug. `SageKeyVault.diagnose()` names it.
- **Notifications with the app closed depend on periodic background sync,** which
  Chrome grants silently to installed PWAs once site engagement is high enough.
  There is no push backend, so until it registers nothing is delivered unless the
  app is open.
- **Three migrations in `supabase/` degrade quietly until run.** Cover dates fall
  back to localStorage then to the `data-due` values in `index.html`; Sage's memory
  falls back to localStorage; the key ring stays on the device.
