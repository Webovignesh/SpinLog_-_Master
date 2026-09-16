# SpinLog — Sage: dynamic notifications + Gemini AI

Progress tracker for the Sage rebuild. Tick items as they land.

**Goal:** make Sage feel alive — aware of the hour, aware of the bike's state, and able to talk back.

**Voice:** seductive, clingy. It's the bike talking to its rider.

---

## Architecture

Three layers:

1. **Scheduler** — decides *what* to say and *when*. `notifications.js`, rewritten.
2. **Voice** — Gemini writes the words. New file `sage-ai.js`.
3. **Face** — chat panel + settings modal. New file `sage-ui.js`.

Key trick: Gemini can't be called reliably from the service worker. So while the app
is open and online, Sage pre-writes a batch of lines for every mood x category and
caches them. Background notifications pull from that cache. AI-quality text with zero
network at notify time, still works offline.

## Mood bands by hour

| Hours | Mood | Feel |
|---|---|---|
| 05–08 | Sleepy | drowsy, half-awake, soft |
| 09–12 | Eager | bright, wants to go out |
| 13–17 | Bored | restless, teasing, sulky |
| 18–21 | Flirty | golden hour, seductive peak |
| 22–23 | Clingy | needy, don't leave me |
| 00–04 | Quiet | silent. Only real emergencies, whispered |

## Notification schedule

| What | Trigger | Best hour | How often |
|---|---|---|---|
| Service due | 500km / 250km / due / overdue | 18–21 | once a day, urgency rises each tier |
| Insurance / docs | 30, 15, 7, 3, 1 days out | 09–12 | once a day per document |
| Miss you | 2+ days since app opened | 18–21 | every 2 days |
| Anniversary | purchase date | 09–12 | once a year |
| Health insight | AI summary of the bike | Sunday 09–12 | weekly |
| Record saved | user saves a record | now | instant |
| Parking | user parks | now + reminders | instant |

Guardrails: max 3/day, min 3 hours apart, priority order on collision. Anything
landing in quiet hours is queued and delivered in the next allowed window.

---

## Tasks

**Status: all 11 tasks complete.** 578 automated checks across the eleven tasks, all
passing. Details under each task below.

### Task 0 — Create this file ✅
- [x] Write `TODO.md` at repo root with Tasks 0–10 as a checklist
- [x] Keep it updated as each task completes

**Demo:** the file exists and tracks progress for the rest of the work.

---

### Task 1 — Fix the broken plumbing ✅
Make the notifications that already exist actually work.

- [x] Merge into `spinlog_notif_data` instead of replacing it — new `mergeNotifData()` in `service-worker.js`, merges key-by-key and treats `null` as "no news"
- [x] Message via the service worker registration, not `navigator.serviceWorker.controller` — new `postToSW()` helper in `script.js`, used by both sync call sites
- [x] Re-run `checkInsuranceNotif` / `checkDocNotif` after `setupCoverDateEditing` saves a date
- [x] Give each notification a unique tag plus `data`, `actions`, `timestamp` — fixed in both `sendSageNotif()` and the worker's `fireBgNotif()`
- [x] `notificationclick` honours the new "Later" action instead of opening the app

**Verified:** a harness loaded the real `service-worker.js` against stubbed worker
globals and replayed the two-pass sync. 12/12 checks passed — `insuranceExpiry`
survives the second sync, `null` no longer clears stored values, and two
same-category notifications produce two distinct tags.

**Test:** edit a cover date, confirm the worker holds both `insuranceExpiry` and
`nextServiceDate` at once. Confirm two same-category notifications no longer collapse.

**Demo:** background insurance reminders actually fire.

---

### Task 2 — Move cover dates into Supabase ✅
Stop relying on hardcoded HTML for expiry dates.

- [x] New `vehicle_cover` table: `id, cover_type, label, expiry_date, notes` — SQL in `supabase/vehicle_cover.sql`
- [x] Seed from the current values in `index.html` — both in the SQL and self-seeding via `seedMissing()`
- [x] Read on load (`dkCoverStore.hydrate()`), write on edit (`dkCoverStore.saveToDb()`)
- [x] Keep `spinlogCoverDates` in localStorage as the offline fallback
- [x] Degrades quietly if the table doesn't exist yet — app behaves exactly as before

**⚠️ One manual step:** run `supabase/vehicle_cover.sql` in the Supabase SQL editor
(Dashboard → SQL Editor → New query → paste → Run). Until then the app falls back
to localStorage, so nothing breaks.

Read precedence, highest first: `vehicle_cover` row → localStorage → `data-due` in HTML.

**Verified:** a harness extracted the real `dkCoverStore` from `script.js` and ran it
against a stubbed DOM and Supabase client. 17/17 checks passed — DB dates override
the card, a missing table is survived without throwing, an existing row is updated
rather than duplicated, covers with no row get seeded, and timestamp-shaped dates
are trimmed to `YYYY-MM-DD`.

---

### Task 3 — Build the scheduler core ✅
Replace random message picking with a time-aware priority queue.

- [x] Priority queue in the service worker's IndexedDB `kv` store — new `sage-scheduler.js`
- [x] Queue entry shape: `{ id, key, category, urgency 1-4, earliestSend, expiresAt, vars }`
- [x] Six mood bands from the table above
- [x] Quiet hours (00–04), daily cap (3), minimum gap (3h)
- [x] Priority-ordered collision handling
- [x] Hardcoded fallback message pools, organised by category x mood
- [x] Added to `PRECACHE`, `CACHE_NAME` bumped, `<script>` tag added before `notifications.js`

One file, loaded twice: the page uses a `<script>` tag, the worker uses
`importScripts`. That means foreground and background share **one** queue, cap and
cooldown set — otherwise the page could fire three while the worker fired three more.

Two refinements the plan didn't call for but the design needed:

- **Receipts aren't nags.** `recordSaved` and `parkingSaved` confirm something you
  just did, so they skip quiet hours, the cap and the gap, jump the queue, and never
  count toward the daily 3. Rationing a confirmation would feel broken.
- **Cooldowns are per-key, not per-category.** Two documents expiring are two
  reminders. Without this, your PUC reminder would silence your RC reminder.

**Verified:** 55 checks on the scheduler + 11 on the worker integration, all passing.
Covers every mood boundary hour, a 2am event deferring to 09:00, urgency 4 whispering
through quiet hours (and being blocked when switched off), the 4th nag of the day
refused while the 3rd is allowed, yesterday's sends not counting toward today, the
3-hour gap to the minute, receipts bypassing a full cap at 3am, per-document
cooldowns, mute, expiry, collision ordering, one-send-per-pass, `{doc}`/`{days}`
interpolation with no leftover placeholders, pool coverage for all five active moods,
and line variety.

---

### Task 4 — Odometer and date triggers ✅
Add distance-based service warnings.

- [x] Wired `SERVICE_INTERVAL_KM = 3000` — now lives in `sage-scheduler.js` and is actually used
- [x] Compute distance-to-service from `maxOdo` (highest `odo`, excluding `Mods/Updates`)
- [x] Service tiers: 500km out (urgency 1), 250km out (2), due (3), overdue (4)
- [x] Document tiers: 30 / 15 / 7 / 3 / 1 days out
- [x] Same tiers applied to insurance, and to the worker's background checks

**⚠️ The odometer is an estimate.** The app has no live odometer reading — service
records only capture the number at each service. So today's odometer is projected:
average km/day across your recorded history, carried forward from the last record.
Accurate enough for a "service in ~500km" nudge, and `serviceStatus()` returns
`estimated: true` so nothing pretends otherwise. Wildly high rates are clamped and a
backwards reading is rejected rather than producing nonsense.

Two design decisions worth knowing:

- **Thresholds fire once each, not daily.** The tier (`30`, `15`, `7`, `3`, `1`, `over`)
  goes into the entry key, so a 30-day insurance window produces five reminders
  across the month rather than fifteen. Crossing into a new tier is a new reminder.
- **Distance and date both count; the more urgent wins.** Overdue by date with
  400km to go still reads as overdue. Overdue by distance with the date months out
  also reads as overdue.

Sage now also quotes the number. A `{km}` line is only offered when km is actually
known — `pickLine` filters out any line whose placeholders can't be filled, so a
literal `{km}` can never reach a notification.

**Verified:** 62 checks plus 7 worker checks, all passing. Every km boundary
(501/500/251/250/1/0/-1), every day boundary (31/30/16/15/8/7/4/3/1/0/-1), the
projection maths (20km/day over 50 days projecting 10 days forward to the exact km),
single-record and empty-record cases, rate clamping, backwards-odometer rejection,
km-vs-date urgency contests, one-key-per-tier, and 100 line picks with no placeholder
leaks. End to end: a bike 15,000km past due gets *"15000km past due. i've been very
patient with you."* at 8pm, while a 429km-out warning stays silent at 10am and lands
at 7pm in the flirty voice.

---

### Task 5 — Fix parking reminders ✅
Make them survive a closed tab.

- [x] Replaced the live `setInterval` with a park session in the shared store, checked by the worker
- [x] Removed `sage_park_timer_id`, `sage_park_time`, `scheduleParkReminders()` and the resume block
- [x] `clearParkReminders()` kept as the public way to end a session
- [x] Worker checks the park session on every wake
- [x] `periodicSync` floor lowered from 12h to 2h so reminders have a chance to land

The session is derived from the newest park history entry rather than tracked
separately, so deleting that entry ends the session with nothing to drift out of
sync. Re-syncing the same spot doesn't restart the 2-hour clock. A session older
than 48 hours is treated as finished — the bike has clearly been collected.

There's still a light 5-minute foreground poll, but it is no longer the mechanism,
just a nicety so reminders feel prompt while the app is open. It pauses when the tab
is hidden and also lets entries the scheduler deferred earlier go out as soon as
their window opens, instead of waiting for the next launch.

**A real bug this surfaced.** The reminder carried a 2-hour expiry so it could never
arrive stale. But an entry queued at 2am gets held until the morning band — and a
2-hour expiry meant it was thrown away at 4am, before it could ever be delivered. The
expiry window now starts from when the entry becomes *sendable*, not when it was
queued. Park overnight and you now get *"morning from the parking lot."* at 6am.

**Honest limitation:** `minInterval` is a floor, not a promise. The browser decides the
real background cadence from how much you use the app, so a closed-app reminder may
arrive later than 2 hours. That is a platform constraint, not something the code can
fix. While the app is open, reminders are prompt.

**Verified:** 34 checks passing. The headline one tears the page context down
completely — deletes the module cache and `SageScheduler` — then boots the worker
fresh against the same store and confirms it picks up the session the page left
behind, queues the reminder, and sends it. Plus the 2-hour gate to the minute
(1h59 no, 2h00 yes), clock advancement without resetting the park time, 48-hour
auto-expiry, distinct entries per repeat, and the overnight quiet-hours deferral.

---

### Task 6 — Settings modal ✅
A place to paste the Gemini key and control notifications.

- [x] New modal following the `.sl-modal-overlay` / `.sl-modal-card` pattern
- [x] Gemini API key field (masked, with a show/hide toggle)
- [x] Per-category toggles, generated from the scheduler's own category list
- [x] Quiet-hours range (start and end, handles wrapping past midnight)
- [x] Daily cap, plus a minimum-gap slider
- [x] "Test notification" button
- [x] Validate the key with one cheap call before saving
- [x] Accessible labels and keyboard focus handling
- [x] Two new files precached, `CACHE_NAME` bumped, script tags added
- [x] Entry point: a sliders button in the hero, beside the database chip

Open it from the ⚙ button on the home screen.

**Quiet hours became configurable**, which they weren't before — the 00:00–04:59
window was hardcoded inside `moodForHour`. It now takes the user's limits and
overlays them, and calling it with no limits still behaves exactly as before, so
nothing else had to change. Setting start equal to end switches quiet hours off.

**Key validation lists models rather than generating text.** Listing costs no tokens
and consumes no generation quota, so a typo can't eat into a free tier whose limits
we already decided not to hardcode. It also tells us which models your key can
actually see, so the model dropdown fills itself in from the real answer. A rejected
key is never stored. A 429 is treated as *valid but busy*, not as a bad key — those
are genuinely different problems and deserve different messages.

**The Test button deliberately skips the queue.** A test held back three hours by the
daily cap would tell you nothing. It sends immediately, in the current hour's real
voice, so you can hear the difference between 7am and 8pm.

**Note on ordering:** `sage-ai.js` is created here rather than in Task 7 because key
storage genuinely belongs to it, and the settings screen needs it now. Task 7 extends
the same file with the context builder, request wrapper and personality prompt —
nothing gets thrown away.

**Verified:** 76 checks passing. Quiet-hour maths including the midnight wrap and the
off switch, quiet hours actually gating and deferring a send, every limit surviving a
storage round-trip, muted categories being refused by both `evaluate` and `enqueue`,
a raised cap being honoured, the critical override being obeyed when switched off, key
trimming and masking, and the full validation matrix — empty, offline (without
touching the network), 400, 403, 429, 500, success, missing model, network failure and
timeout, each with its own message. Plus wiring checks: script tags, precache entries,
cache bump, the live-region status line, reduced-motion handling, a settings label for
every scheduler category and none for categories that don't exist, and a test line for
all six moods.

---

### Task 7 — `sage-ai.js`, the voice ✅
Central Gemini client and personality definition.

- [x] Key storage and read (done in Task 6)
- [x] Context builder: last 10 service records, current odo, next due, cover dates, days since last app open
- [x] Request wrapper with timeout, 429 backoff, offline detection
- [x] System prompt defining Sage's personality and the mood modifiers
- [x] Model id as a configurable constant (default `gemini-2.5-flash`)
- [x] Added to `PRECACHE`, `CACHE_NAME` bumped
- [x] `<script>` tag in place before `script.js`

**Try it in the console:** `await SageAI.say('say hello', { mood: 'flirty' })`

**She only ever gets real numbers.** The context builder reads what the app already
has in memory — no extra database round trip — and every figure is labelled. The
estimated odometer travels with `odoIsEstimate: true` so she can't state a guess as
fact, and the persona forbids inventing numbers outright. Nulls are stripped from the
prompt rather than sent as empty fields.

**Failure is always `null`, never an exception.** Every caller has a hardcoded
fallback, so a silent null is the correct outcome — a thrown error would break the
notification path for the sake of a missing line. No key, offline, rate limited, timed
out, bad JSON, empty response: all null.

**The backoff ladder escalates 1 → 5 → 15 → 60 minutes** and is shared across the
whole app, so a limit hit while writing notification lines also spares the chat from
hammering a capped key. A clean call resets it. Rate limits are still not hardcoded
anywhere — a 429 is reacted to, never predicted. A 5xx gets the same restraint, but a
400 does not, since retrying a malformed request will never help.

**Safety thresholds are relaxed to `BLOCK_ONLY_HIGH`.** Her voice is flirty by design
and the default filters would reject it.

**Verified:** 78 checks passing. The persona contract (is the bike, never an AI, no
invented numbers, no markdown), a tone direction for all six moods, the full context
builder including the 10-record cap while still reporting the true count, an empty app
state not throwing, no-key and offline both short-circuiting before any network call,
correct request shape (model in URL, persona as system instruction, mood folded in,
history mapped to user/model in order), the complete backoff ladder, 400-vs-503
handling, network faults, timeouts, empty candidates and unparseable JSON all
returning null, ten output-tidying cases, and `say()` provably grounding the prompt in
the real odometer figures.

---

### Task 8 — AI-written notifications ✅
Feed AI text into the scheduler with a safe fallback.

- [x] Pre-write and cache lines per category x mood (`sage_ai_pool_<category>_<mood>`)
- [x] 7-day expiry on each pool
- [x] Scheduler prefers the cache, falls back to the Task 3 pools
- [x] Refresh stale pools on app open when online
- [x] Keep the recent-index dedupe so lines don't repeat
- [x] Pools also warm immediately after you save a key, and are dropped if you forget it

**One deliberate change from the plan: the pools live in IndexedDB, not
localStorage.** A service worker has no localStorage, and the worker is precisely
what needs these cached lines — putting them in localStorage would have defeated the
entire point. Same key names, shared store.

The split is: **writing lives in `sage-ai.js`** because only the page can call Gemini.
**Reading lives in `sage-scheduler.js`** because the worker needs it and must not
depend on the AI client at all.

**Refreshing is deliberately narrow.** Generating every category for every mood would
be forty-odd calls per app open and would burn a free-tier key on lines that may never
be shown. Instead it does at most 3 per open, prioritising whatever is already queued,
then the current mood, then one band ahead. Fresh pools are skipped. A rate limit
part-way through stops the run rather than hammering on.

**Validation is strict at write time**, because a bad line cached for 7 days is a bad
line shown for 7 days. Rejected: too long, multi-line, markdown, duplicates, and any
placeholder the category can't fill. Titles are assigned from the mood rather than
generated — fewer failure modes and consistent emoji.

**Verified:** 71 checks passing. The headline test writes a pool as the page, then
tears the page down completely — deletes `SageAI`, `fetch` and `localStorage` — boots
the worker fresh, and confirms it sends one of the AI-written lines with the `{km}`
placeholder correctly interpolated:

> Sage 😌 — you have been ignoring me for 1200km now.

That is an AI-quality notification delivered with no Gemini client, no network and no
localStorage in scope. Also covered: every validation rejection case, malformed and
prose-wrapped replies, a pool of one being refused, stale pools falling back to the
built-ins, five different malformed pool shapes each still yielding a usable line, 30
picks with no vars never leaking a placeholder, muted categories never being generated
for, and offline/backoff both short-circuiting before any network call.

---

### Task 9 — Chat panel + Call Sage button ✅
Let the rider talk to the bike.

- [x] New `<section id="sage">` registered with `setActiveSection` and `ensureSectionData`
- [x] Converted the hero search into a "Call Sage" button
- [x] Chat UI in `sage-ui.js`, history in localStorage
- [x] Grounded in the Task 7 context builder
- [x] Kept the old search reachable — it now lives inside the panel
- [x] Already precached; `CACHE_NAME` bumped

**Nothing was lost.** Rather than rebuild search, the entire search block was moved
into the Sage section verbatim — same IDs, same ARIA, same markup. `initSearch()`,
`buildIndex()` and `go()` in `script.js` were not touched at all and bind to it
exactly as before. The hero now has a "Call Sage" button in its place, which says
*"Ask her anything, or search"* so the old habit still leads somewhere right.

The button shows her current mood as its subtitle, so the hero quietly tells you
whether she's *ready to ride* or *feeling needy* before you even tap.

**She answers from the same data the home screen shows** — the context builder, not a
separate query — so the two can't disagree. Chat gets a longer leash than a
notification (three sentences, 260 tokens) and is told to say it doesn't know rather
than guess.

**Failures say what's actually wrong.** No key points you at settings; offline says
you're offline; a rate limit tells you roughly how long to wait. A generic "something
went wrong" would have been useless here.

Details worth noting: message text is escaped before rendering, since her replies are
external content. Enter sends and Shift+Enter makes a newline. The composer grows to
five rows then scrolls. Focus isn't stolen on touch devices — that would throw the
keyboard up on arrival. Overlapping sends are refused rather than queued.

**Verified:** 84 checks passing. The search-survival group confirms all three search
IDs exist exactly once, sit inside the Sage section, are gone from the hero, keep their
combobox/listbox roles, and that `initSearch` still binds by ID. Plus: the prompt
provably contains the real next-due date and km-remaining with the estimate flag,
history mapped and capped to the most recent turns, all five failure reasons reported
distinctly and each with a human message, XSS escaping, and a full accessibility pass
(live regions, labelled controls, `sr-only` textarea label, typing indicator hidden
from assistive tech).

---

### Task 10 — Health insights + full wire-up ✅
Weekly AI summary and final integration.

- [x] Weekly summary: service patterns, overdue items, upcoming costs, anything unusual
- [x] Surfaced on the home screen — "How Sage is doing" card
- [x] Delivered as the Sunday 09–12 notification
- [x] Every JS file is in `PRECACHE`, `CACHE_NAME` bumped to `v1.7.19-sage-complete`
- [x] All script tags present and in the right load order
- [x] All new CSS namespaced under `sage-*` (plus one `sr-only` helper)
- [x] No orphaned code — every exposed global has a verified caller
- [x] Every item in this file ticked

**The numbers are computed locally; only the prose is AI.** `healthFacts()` derives
spend totals and averages, last-90-day spend, the typical km gap between services,
whether the interval is being respected, days since the last log, overdue items,
what's coming up inside 60 days, and anything unusual — an unusually expensive visit,
a longer-than-normal gap, a long silence. All of that renders with no key and no
network. Sage's two or three sentences go on top when she can speak.

When she can't, the card writes a plain-language line itself rather than looking
broken, and quietly notes that a key would get you her own take.

**The Sunday notification can only land once a week** because the entry key carries
that Sunday's date, and it expires at end of day — a weekly summary delivered on
Tuesday isn't a weekly summary. Her prose is written by the page during the week; the
worker only delivers the nudge.

**Verified:** 141 checks passing, including a full system audit. The facts engine was
checked against hand-calculated figures (spend, averages, 90-day window, km gaps,
adherence), overdue detection from both distance and date, an expired cover being
classified as overdue rather than upcoming, single-record and zero-cost data producing
no `NaN` and no invented values, cache reuse and 7-day expiry, and facts still landing
with no key, offline, and rate-limited. The audit confirms every JS file precached,
every script tag present and correctly ordered, every one of the 11 notification
categories both queueable and togglable in settings, every exposed global having a real
caller, no leftover park-timer code, and all new CSS namespaced.

---

## ⚠️ One manual step remains

Run `supabase/vehicle_cover.sql` in the Supabase SQL editor
(Dashboard → SQL Editor → New query → paste → Run).

Until then cover dates fall back to localStorage, so nothing is broken — they just
won't survive a browser data wipe.

## Getting Sage talking

1. Get a free Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).
2. Open the app, tap the ⚙ button in the hero.
3. Paste the key, press **Check & save**. She writes her first batch of lines immediately.
4. Press **Send a test** to hear her current mood.
5. Tap **Talk to Sage** on the home screen to start a conversation.

Without a key everything still works — she just uses her written-in lines instead of
her own words.

---

## Known bugs being fixed

| # | Problem | Where | Task |
|---|---|---|---|
| 1 | Worker replaces `spinlog_notif_data` wholesale, wiping `insuranceExpiry` | `service-worker.js:290-300` | 1 |
| 2 | Data never reaches the worker on first load | `script.js:2050`, `2544` | 1 |
| 3 | Cover checks never re-run after a date edit | `script.js:2729-2780` | 1 |
| 4 | `SERVICE_INTERVAL_KM` declared but unused — no odometer triggers | `notifications.js:428` | 4 |
| 5 | Zero time-of-day awareness | `notifications.js:369-379` | 3 |
| 6 | Same-category notifications collapse into one | `notifications.js:394-412` | 1 |
| 7 | Parking reminders die with the page | `notifications.js:520-541` | 5 |
| 8 | Cover dates aren't in the database | `index.html:132-145` | 2 |
| 9 | `push` handler exists but nothing subscribes. Out of scope — don't break it | `service-worker.js:64-74` | — |

All eight in-scope bugs are fixed. Bug 9 was left alone as planned and still works.

Two extra bugs surfaced during the work and were fixed:

| Problem | Found in |
|---|---|
| A short `expiresAt` combined with band deferral silently dropped entries — an overnight park reminder expired at 4am before its 5am window opened. Expiry now counts from when an entry becomes *sendable*. | Task 5 |
| Quiet hours were hardcoded inside `moodForHour`, so the settings control would have had no effect. | Task 6 |

---

## Notes

**Gemini key.** Stored on the device in localStorage, so anything with access to
browser storage can read it. It's a free key, so the downside is small. If it ever
needs hiding, a Supabase Edge Function is a drop-in upgrade that won't require
rewriting Task 7. Never commit the key.

**Rate limits.** Not hardcoded anywhere. Quota is handled reactively: catch a 429,
back off, fall through to the cached or hardcoded pools.

**Service worker cache.** Every new JS file must be added to `PRECACHE` and
`CACHE_NAME` must be bumped, or the file won't ship offline.

---

## Fix log

**Settings modal showed only its header and buttons** — the key field, timing controls
and category toggles were all invisible.

Cause: `styles.css` has a global `section { display: none }` with `section.active`
showing, which is what drives page routing. The modal grouped its three panels in
`<section>` elements, so all three were hidden. The header and footer survived because
they aren't sections.

Fix: the groups are now `<div role="group">`. The codebase already warned about this
trap at `index.html:277` — *"Spec sheet (div, not `<section>`: routing scans
`main section`)"*. I should have read that comment first.

Also adjusted the group divider, since `:last-of-type` had been keyed to `section` and
would otherwise have drawn a double line above the footer.

Guarded against a repeat: a check now asserts that every `<section>` in the document is
one of the four page views inside `main`, and that all 19 settings controls exist in the
markup and are bound in `sage-ui.js`.

---

**Notification permission was requested on every refresh.**

Cause: `sendSageNotif()` called `requestNotifPermission()`, which prompts whenever
permission is still undecided. Since sends fire automatically on load, the prompt came
back every time — which is not just irritating, it's the fastest way to get
permanently blocked by the browser.

Fix: split in two. `notifGranted()` is a read-only check that never prompts, and
everything automatic uses it — if permission was never granted she simply stays quiet.
`requestNotifPermission()` still prompts, but is now only reachable from two real user
actions: the one-time banner's **Allow** button, and **Send a test** in settings.

---

**Rate limiting for no reason.**

Two causes, both mine:

1. **The backoff was global.** One 429 from one model locked out every model for a
   minute, escalating to an hour. But the free tier meters each model *separately* — a
   capped model is not a capped key.
2. **It burst on open.** Three pool writes plus the health insight fired back-to-back
   within a second or two, which is exactly what trips a per-minute quota.

Fix: **she now walks a model chain**, fastest first.

`gemini-2.5-flash` → `flash-lite` → `2.0-flash` → `2.0-flash-lite` → `2.5-pro`

Flash leads because it's quickest with the most generous free quota; Pro is last
because it's slow and its free allowance is tiny. Your chosen model goes to the front,
the rest follow as automatic fallbacks.

- A 429, a 503 or a timeout rests **that one model** and immediately retries on the
  next. The call still succeeds.
- A resting model is skipped on later calls, so no request is wasted on it.
- She only counts as rate limited when the *entire* chain is resting.
- First rest is 30 seconds, not a minute — per-minute quotas refill in a minute.
- A 400 or 403 stops immediately rather than burning the chain, since every model
  would reject the same malformed request or bad key.
- Consecutive calls are spaced 1.5s apart so the burst stops self-inflicting limits.
- A stale global lock written by the previous build is discarded on read.

---

**Removed the settings button from the hero.**

`.dk-hero-chrome` is a two-column grid, so a third child pushed Call Sage onto its own
row. With the button gone the database chip and Call Sage sit side by side as intended.
Settings are still one tap away, from the sliders button inside the Sage panel.

---

**Call Sage stretched the full width of the hero.**

The search field it replaced was capped at `max-width: 360px`, with a comment in
`home.css` explaining exactly why: *"a full-width search bar dominated the chrome and
looked like a page-wide input"*. My button had no cap, so it did precisely that. Now
capped to the same 360px, with a matching 42px height.

---

**Call Sage is the third nav pill on phones and tablets.**

There is no `<nav>` in this app — the `.dk-hero-actions` buttons are the navigation. So
Call Sage joined them as a third pill next to Log Service and Open Docs.

Only one Call Sage control is ever on screen. Above 1023px the wide button sits in the
hero chrome beside the status chip; at 1023px and below that one hides, the chip takes
the chrome row to itself, and the nav pill appears instead.

The actions row went from two columns to three. On phones three pills leave about
105px each, which isn't enough for an icon and a label side by side, so below 640px the
icon moves above the label and the label is allowed to wrap. That also makes the row
read like a proper nav bar. Checked to fit at 320px (~92px per pill).

The swap rules live in `home.css` rather than `styles.css`, because `home.css` loads
second and would otherwise override them.

---

**Hero cleanup: one Sage entry point, tighter spacing.**

Renamed to **Talk to Sage** — "Call" implied a phone call, and it opens a chat.

Removed the wide button from the hero chrome entirely. There are no longer two
controls doing the same job at different breakpoints; the action-row pill is the only
way into the Sage section, at every width. Its `sage-call-btn` styles, avatar, pulse
and hint markup are all gone.

The pill now carries **her photo** instead of a speech bubble, with a small green dot
so it reads as a person rather than a menu item. The dot is anchored to the avatar, not
the button, so it follows the icon when the pill stacks icon-over-label on a phone. The
image is rounded with `border-radius` rather than clipped by `overflow: hidden`,
specifically so the dot can overhang the circle.

**The SPINLOG COMMAND CENTER pill moves up beside the status chip — on phones and
tablets only.** On a phone it used to sit above the heading, which meant two short rows
separated by a gap. Desktop keeps it exactly where it always was, above the heading.

CSS cannot move an element between parents, so there are two instances of the pill —
one in `.dk-hero-chrome`, one in `.dk-hero-copy` — and exactly one is rendered at any
width. `display: none` keeps the other out of the accessibility tree as well, so there
is no duplicate announcement. In the chrome row the pill's own `margin-bottom` is
cancelled so it aligns with the status chip.

*(First attempt moved it in the DOM, which changed desktop too. That was wrong — the
request was mobile only.)*

**Desktop hero left alone.** An earlier attempt dropped the leading `1fr` spacer row to
close the gap under the chrome, but that also stopped the copy centring against the
photo — a change to desktop that was never asked for. Both spacers and the 18px row gap
are restored, so desktop is exactly as it was. Only the phone gets the tightening it
asked for: hero padding `12px 13px 16px` and an 11px stack gap.

**A cascade trap worth recording.** `.dk-pill--chrome { display: none }` sat at line 229
but `.dk-pill { display: inline-flex }` is at line 594 of the same file. Equal
specificity, so the later rule won and *both* pills rendered on desktop. Both swap rules
are now two classes deep (`.dk-hero-chrome .dk-pill--chrome`,
`.dk-hero-copy > .dk-pill`) so they win on specificity rather than relying on source
order.

**One thing this surfaced:** `home.css` caps `.dk-search` at 360px for the hero it used
to live in, and that cap was quietly applying to the search now sitting in the much
wider Sage panel. Overridden with `.dk-search.sage-chat-search` — doubled class because
`home.css` loads second and would win a specificity tie.

---

**Hero copy sat too low.** Two equal `1fr` spacers split the leftover space evenly, which
puts the copy at the true centre — but the chrome row above already pulls the eye down,
so dead-centre reads as sinking, with an obvious void above the pill.

The spacers are now uneven: `0.4fr` above against `1fr` below, so the top takes 29% of
the leftover space instead of 50%. On a typical desktop hero that is roughly 61px above
the copy and 153px below, rather than 107px each way. The block lands on its optical
centre while still keeping clear of both edges, and it stays proportional at any hero
height rather than being a fixed offset.

---

**Chat box is longer.** The log went from `min-height: 240px` / `max-height: min(52vh,
460px)` to `380px` / `min(66vh, 640px)` on desktop, and `56vh`–`62vh` on phones where
nothing else competes for the screen.

Both sizes have a `dvh` variant behind `@supports`. On mobile `vh` is measured against
the largest possible viewport, so the log gets clipped behind the browser bars; `dvh`
tracks the actually visible area. The `vh` rule stays first as the fallback.

---

**The page you were on survives a refresh.**

`setActiveSection()` now records the section in `localStorage` under
`spinlogActiveSection` and mirrors it to the URL hash, and `restoreSection()` reopens it
on load. The hash takes priority when present, so a bookmarked or shared `#docs` still
works; otherwise the stored value is used. Back and forward now move between sections via
a `hashchange` listener instead of leaving the page.

Details that mattered:

- **Only real page views are accepted.** `isKnownSection()` requires the id to exist
  *and* match `main section`, so `#mobileMenu` or a junk hash can't put the app into a
  broken state. `setActiveSection` rejects unknown names up front too, which also fixes a
  latent crash — it previously called `.classList` on the result of `getElementById`
  without checking.
- **Restore is the last thing `initApp()` does.** The lazy service load runs just above
  it and sets its own flag, so restoring `service` reuses that instead of fetching twice.
- **`file://` was a real constraint.** Some browsers refuse `history.replaceState` on a
  file origin, so it's wrapped in `try/catch` and `localStorage` is the mechanism that
  actually has to work. A blocked `localStorage` is caught too, so private mode still
  navigates fine — it just won't remember.
- **`sage-ui.js` loads after `script.js`**, so a refresh restoring the Sage section
  switched to it before the chat code existed and `ensureSectionData` found no
  `sageOnSectionOpen` to call. Its `boot()` now checks whether `#sage` is already active
  and renders the conversation itself.

---

**404 on every model — the chain was out of date.**

The console showed `Gemini replied 404 for gemini-2.5-flash`. Two separate faults:

1. **The names were stale.** `gemini-2.0-flash` and `gemini-2.0-flash-lite` no longer
   exist, and `gemini-2.5-flash` is at the very end of its life.
2. **A 404 was treated as a hard stop.** `generate()` only walked to the next model on a
   429 or a 5xx; anything else returned `null` immediately. So the first missing model
   killed the whole call even though eight working ones sat behind it.

The chain is now the live flash catalog, newest first:

`3.8-flash` → `3.7-flash` → `flash-latest` → `3.6-flash` → `3.5-flash` →
`3.5-flash-lite` → `3.1-flash-lite` → `flash-lite-latest` → `2.5-flash` → previews

Default model is `gemini-3.8-flash`. No pro — its free allowance is too small to be
useful for one-liners.

**The two `*-latest` aliases are in the middle on purpose.** Google repoints them as
models rotate, so when a pinned version is retired and starts 404ing, the alias keeps her
talking with no code change. That is the exact failure this round, and it should not
recur.

**404 and 403 now fall through** to the next model instead of stopping. They also rest
that model for 24 hours rather than 30 seconds — a retired or inaccessible name is not
"busy" and will not come back shortly. 400 and 401 still stop after one attempt, since a
malformed request or a bad key would fail identically on all eleven.

**The real catalog is learned and reused.** A successful key check caches the model list
this key can actually see, and the fallback walk filters against it — so after the first
check, not a single request is spent on a name that would 404. Any flash model in the
catalog that predates this list is appended automatically, so a newly released one gets
used without an edit. Previews are never auto-added. Re-checking the key refreshes the
catalog and lifts any stale 404 shelvings; forgetting the key discards it.

**Verified:** 44 checks. Every chain entry confirmed against the reported catalog, the
404 fall-through reproduced end to end, the day-long shelving, 403 vs 400 vs 401
behaviour, catalog learning and filtering, brand-new-model pickup, and the settings
dropdown populating from the cache rather than the built-in guess.

---

**"Rate limiting for no reason" — it was self-inflicted.**

The network panel showed **25 requests on one page load**. The quota refusals were real;
the cause was mine. Four separate faults:

1. **Every call walked all eleven models.** Pool refresh, the health insight and the chat
   each start unawaited on app open, and each one could burn eleven requests. Now capped
   at **3 models per call**, and two refusals in a row is taken as the key being out of
   budget rather than one busy model — so an exhausted quota costs 2 requests, not 11.

2. **The inter-request gap was racy.** It compared against a bare `lastCallAt`, so
   parallel callers all read the same stale value, all waited the same amount, then fired
   simultaneously. The 1.5s gap was doing nothing on load. Every request now goes through
   one serialized queue, with the gap applied inside it where it cannot race. Verified:
   three parallel callers now produce three requests 1.5s apart with never more than one
   in flight.

3. **Timeouts were counted as rate limits.** The `AbortError` branch called
   `noteModelLimited`, so a slow response climbed the quota ladder and logged "rate
   limited". That is why the log showed `gemini-3.7-flash timed out` immediately followed
   by `gemini-3.7-flash is rate limited — resting it 900s`: one event, two contradictory
   lines, and a model shelved for fifteen minutes having never actually been refused.
   Timeouts now get a flat 45s rest that does not touch the ladder. The request timeout
   also went 20s → 30s, since 20s was clipping legitimate responses.

4. **A 5xx logged as "rate limited" too.** Server overload now says "is overloaded (503)".

**One bug this surfaced:** clearing every rest on a successful call also wiped the
timeout and 404 shelvings, sending the next call straight back into the slow or missing
model. Rests now carry a `kind`, and a success lifts only the `quota` ones — it proves the
key has budget, but nothing about a model that is slow or gone.

Also reduced the pool refresh from 3 pools to 2, and held it back 8 seconds after load so
it does not share the opening minute with the health insight.

**Result:** a whole app open is now 3 requests (1 health insight + 2 pools), down from 25.

**Verified:** 33 checks — the cap, the two-refusal stop, serialization with no overlap and
correct gaps, four consecutive timeouts still resting only 45s, the quota ladder still
climbing 30s → 120s → 300s → 900s, log wording matching each cause, and the app-open
budget measured end to end.

---

**Still resting models for 900s, now on 503s.**

The chat itself was working by this point. Two remaining faults, both mine:

1. **A 503 was sharing the quota ladder.** Gemini's 503 means *the service is briefly
   busy* — it clears in seconds and says nothing about your quota. It was going through
   `noteModelLimited`, so it climbed the same escalating ladder as a real 429. It now has
   its own flat **20s** rest that never advances the ladder, and logs "is busy (503)"
   rather than "rate limited".

2. **The poisoned ladder was inherited from the previous build.** `step` values live in
   `localStorage`, and the earlier build let every timeout and 503 advance them. So a
   returning user started with `step: 3` on several models, and the very first 503 rested
   for 900s immediately — the fix from the previous round could not take effect for anyone
   who had already used the app.

   The stored record now carries a version. Anything on an older version, or the original
   global `{until, step}` shape, is discarded on read rather than migrated. A ladder
   position earned under buggy rules is worth less than starting clean, and the cost of
   being wrong is one extra request.

Also raised the per-call model cap from 3 to 4. 503s are common and cheap to walk past,
and the two-strike rule still caps genuine quota refusals at 2 requests — so the extra
attempt is only ever spent stepping over a busy model, never on quota.

**Verified:** 26 checks. Six consecutive 503s stay at 20s and never touch the ladder, a
real 429 still climbs 30 → 120 → 300 → 900, an unversioned record left by the old build is
thrown away so the first 503 rests 20s instead of 900s, a current record survives a
re-read, and the cap allows four attempts on 503 while still stopping at two on 429.

---

**Lineup trimmed to full flash models only.**

`gemini-3.8-flash` → `3.7-flash` → `flash-latest` → `3.6-flash` → `3.5-flash` → `2.5-flash`

Dropped the `-lite` variants and the previews. `isFlashModel()` is now the single place
that decides what counts, and it is applied to the catalog-learned extras and to the
settings dropdown too — otherwise a lite model would quietly reappear from the live
catalog after a key check.

`gemini-3.8-flash` and `gemini-3.7-flash` are flash models, which is why they still show
in the console: they lead the chain as the newest, so they are tried first and are
therefore the ones logged when a request is refused.

**Worth noting for later:** across the logs so far, `3.8-flash`, `3.7-flash`,
`flash-latest` *and* `3.6-flash` have each been refused at different moments. Refusals
spread across unrelated models point at a project-wide quota rather than a per-model one,
which means the fallback chain cannot route around it — it only spends requests
discovering that. Leading with a model the key reliably accepts would cost less than
walking the chain each time.

---

**Lineup: 3.5 and newer, flash only.**

`gemini-3.6-flash` → `gemini-3.5-flash` → `gemini-flash-latest`

3.8 and 3.7 removed — they were refused on every attempt, so leading with them only
spent requests. Default model is now `gemini-3.6-flash`.

Two things that needed naming explicitly:

- **A version floor** (`MIN_FLASH_GENERATION = 3.5`) keeps 2.5-flash out of the automatic
  walk. It stays **selectable in settings** if your key has it — the floor governs what she
  reaches for on her own, not what you are allowed to choose.
- **An exclusion list** for 3.8 and 3.7. They clear the 3.5 floor, so the
  catalog-learning would have added them straight back from the live model list. Also
  guards `getModel()`, so a stored override from the old default cannot resurrect one.

---

**Multi-key support.**

The logs made the case: unrelated models all refusing at once is a **project-wide** quota,
so a second key is the only thing that buys real headroom. Keys are now a ring.

- **Keys are the outer loop, models the inner one.** A 429 rests the whole *key* and hands
  over to the next one, because every model shares that project's budget. A 503 or timeout
  is one model misbehaving, so it moves to the next model on the *same* key.
- **Per-key rests** on the same escalating ladder as models. A rested key is skipped
  entirely on later calls, so nothing is wasted rediscovering it.
- **A 401 shelves that key** for 24h and moves on, rather than aborting the call — one bad
  key no longer silences a good one.
- **A hard ceiling of 5 requests per call** across the whole key × model walk, so adding
  keys cannot multiply the request count.
- **Success clears that key's rest** and every quota rest, but leaves timeout and 404
  shelvings in place.

Settings now shows the ring: each key masked, with `in use` / `standby` / `resting`, and a
remove button. **Check & add** validates before adding and refuses a duplicate before
spending a request. **Remove all** clears the ring. A single key stored by an earlier build
is migrated onto the ring automatically on first read.

**Verified:** 65 checks. Chain contents and the floor, 2.5 excluded from the walk but
offered in the dropdown, the exclusion surviving catalog-learning, ring add/remove/dedupe,
legacy migration, a capped key costing exactly one request before handover, all-keys-capped
short-circuiting with no network call, a 401 shelved while a good key answers, a busy model
moving within the same key, and the 5-request ceiling holding with five keys.

**Two bugs the tests caught before shipping:** `DEFAULT_MODEL` was still 3.8, and the
catalog-learning re-added 3.8 and 3.7 because they pass the 3.5 floor.

---

**"Why is it happening, I didn't even use it."**

Two answers.

**1. The app was making requests on its own.** On every page load it fired the health
summary and pre-wrote notification lines. That is deliberate — it is what lets background
notifications sound like her — but it had a bug: **a failed pool write was not remembered,
so it retried on every single refresh.** Five refreshes, five wasted requests, without the
app being touched.

**2. The real limit is per DAY, not per minute.** Full flash models are metered at roughly
**20 requests per day** on the free tier
([scriptbyai](https://www.scriptbyai.com/gemini-api-free-tier-limits/), Sept 2026;
[pricepertoken](https://pricepertoken.com/endpoints/google-ai-studio/free)). Every
assumption in the backoff code was built around per-minute recovery, which is why "resting
it 30s" never helped — the budget does not come back for hours. *Content was rephrased for
compliance with licensing restrictions.*

Fixes:

- **A daily allowance for background work** (5 requests). Pre-writing lines and the weekly
  summary draw on it; once it is gone they stop without touching the network.
- **Chat is exempt.** If you asked her something she answers, even with the background
  allowance spent. That is the whole point of rationing the background work.
- **A failed pool write now backs off 6 hours** instead of retrying on every load.
- **Settings shows where the day went** — chat vs background requests, and how much
  background allowance is left. That number is what explains a silent Sage.

The health summary was already cached for 7 days, including when the prose comes back
empty, so that one was costing a single request per week rather than one per load.

**Verified:** 35 checks — the allowance draining and then refusing without a request, chat
still getting through on an empty allowance, a failed pool write silent across five
subsequent loads then retrying after the cooldown, the insight cache holding across loads,
and the allowance resetting on a new day.

**Still open, and worth deciding:** the `-lite` models are metered far more generously than
full flash — hundreds of requests a day rather than about twenty. They were removed from
the lineup on request, and putting them back as a last-resort tier is the single change
that would most reduce these refusals.

---

## Fix log | v1.7.34 | Database status popup redesign

**What was wrong:** the popup read like console output. A giant green thumbs-up on top,
then three left-aligned `label: value` lines, then row counts in a two-column grid so the
third tile (MEDIA) sat alone on its own row.

**Now:** one card.
- A header strip tinted by state: a status dot, a `SUPABASE` kicker, and **Online** or
  **Not responding** in colour. Green `#1ad1a5` when up, red `#ff4d4d` when down, driven
  off a single `data-state` attribute and one `--dbs-accent` variable.
- The three row counts sit in a **three-column** grid, so nothing is orphaned. Drops to two
  columns below 360px.
- When offline, the counts are replaced by a short line saying the project is probably
  paused and where to resume it.
- A footer with the check time and the table that was probed, in small dim text.
- The shared popup's big icon is hidden for this message only, via
  `.popup-content:has(.db-status-popup) .popup-icon`, because the card carries its own dot.
  The shell's 40px padding and bold 18px message are reset the same way.

**A Check again button** sits in the header and re-runs the same check the chip does
(`window.dkRecheckDb`). It spins while the request is in flight.

**One catch this uncovered:** `showPopup` auto-closes success and error popups after three
seconds, which would have made the new button unusable. Popups can now opt out with a
`data-popup-persist` attribute in their markup; the status card uses it. Backdrop click and
Escape still close it, so nothing gets stuck on screen.

**Removed:** the dead `.db-status-data-grid` and `.db-status-data-card` rules and the
`.db-status-popup strong|span` rules, plus the mobile override that forced the old grid to
one column. The chip's own `.db-status-dot` and the `dbPulse` keyframes are still in use and
were left alone.

**Verified:** 33 checks — every class the markup emits has a rule, exactly three tiles
render, the grid is three-across and two-across under 360px, the icon-hiding and
padding-reset rules are present, the button is exposed and labelled and applies its busy
state, the card is marked persistent and `showPopup` honours it, offline recolours the card,
the pulse is guarded behind `prefers-reduced-motion`, the old rules are gone, and CSS braces
balance. `node --check` clean on `script.js` and `service-worker.js`.

**Cache:** `spinlog-cache-v1.7.34-db-popup`.
