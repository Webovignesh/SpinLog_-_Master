// ════════════════════════════════════════════════════════════════════════
// SPINLOG — SAGE AI
//
// Sage's voice. Owns the Gemini key, the model choice, and every call to the
// API. The scheduler decides WHEN to speak; this decides WHAT the words are.
//
// The key lives in localStorage on this device only. That means anything with
// access to browser storage can read it — acceptable for a free key, and never
// committed to the repo. If it ever needs hiding, a Supabase Edge Function is a
// drop-in replacement for the request wrapper without touching the call sites.
// ════════════════════════════════════════════════════════════════════════

(function (root) {
  'use strict';

  // Swappable so a model rename doesn't mean touching call sites.
  const DEFAULT_MODEL = 'gemini-3.6-flash';
  const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

  // One key, several models, and the free tier meters them SEPARATELY. So a
  // capped model is not a capped key — we just move down the list.
  //
  // Full flash models, 3.5 and newer. No lite, no previews, no pro.
  //
  // 3.8 and 3.7 are deliberately absent: they were refused on every attempt, so
  // leading with them just spent requests before falling through.
  //
  // `gemini-flash-latest` is an alias Google repoints as models rotate, so it
  // sits last as the safety net — when a pinned version is retired and starts
  // returning 404, the alias keeps her talking with no code change.
  const MODEL_CHAIN = [
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-flash-latest',
  ];

  // The floor for the automatic walk. 2.5-flash is below it, so it is never
  // tried on its own — but it stays selectable in settings if your key has it.
  const MIN_FLASH_GENERATION = 3.5;

  // Dropped on purpose, and they clear the floor above — so without naming them
  // the catalog-learning below would helpfully add them straight back.
  // Still selectable in settings; just never walked automatically.
  const MODEL_EXCLUDE = ['gemini-3.8-flash', 'gemini-3.7-flash'];

  /** Full flash only: excludes lite variants, previews, pro and everything else. */
  function isFlashModel(name) {
    return /flash/.test(name) && !/-lite|preview|pro/.test(name);
  }

  /**
   * Flash, and new enough for the automatic chain.
   * Unversioned aliases like `gemini-flash-latest` always qualify — they track
   * whatever is current, which is by definition new enough.
   */
  function isChainWorthy(name) {
    if (!isFlashModel(name)) return false;
    if (MODEL_EXCLUDE.indexOf(name) !== -1) return false;
    const version = name.match(/gemini-(\d+(?:\.\d+)?)-flash/);
    if (!version) return true;
    return parseFloat(version[1]) >= MIN_FLASH_GENERATION;
  }

  const KEY_STORAGE = 'sage_gemini_key';    // legacy single key, migrated on read
  const KEYS_STORAGE = 'sage_gemini_keys';  // the key ring
  const MODEL_STORAGE = 'sage_gemini_model';
  // The catalog this key can actually see, learned from validateKey(). Lets the
  // fallback walk skip names that would only 404.
  const MODELS_STORAGE = 'sage_gemini_models';

  const VALIDATE_TIMEOUT_MS = 12000;
  const REQUEST_TIMEOUT_MS = 30000;

  // How many models one call may try before giving up. Walking all eleven meant
  // a handful of parallel operations could fire twenty-plus requests on a single
  // page load, which is what was actually tripping the quota.
  //
  // Four rather than three because 503s are common and cheap: the two-strike
  // rule below caps genuine quota refusals at 2, so these extra attempts are
  // only ever spent walking past models that are briefly busy.
  const MAX_MODELS_PER_CALL = 3;
  // Ceiling across the whole key x model walk, so adding keys cannot multiply
  // the request count without limit.
  const MAX_ATTEMPTS_PER_CALL = 5;

  // Full flash models are metered at roughly 20 requests PER DAY on the free
  // tier — not per minute. That is the real constraint, and it is small enough
  // that background work must not be allowed to eat it.
  //
  // So automatic work (pre-writing lines, the weekly health summary) gets a
  // small daily allowance, and anything you actually asked for is exempt. Before
  // this, a doomed pool write retried on every single page refresh and could
  // exhaust the day's budget without you touching the app.
  const DAILY_AUTO_BUDGET = 5;
  const REQUESTS_STORAGE = 'sage_gemini_requests';

  // Rate limits are deliberately not hardcoded — the published free-tier numbers
  // move, and guessing wrong is worse than reacting. A 429 rests that one model
  // and we try the next; only when the whole chain is resting do callers fall
  // back to the scheduler's written-in lines.
  //
  // Short first step because per-minute quotas refill in, well, a minute.
  const BACKOFF_STEPS_MS = [30000, 2 * 60000, 5 * 60000, 15 * 60000];
  const BACKOFF_STORAGE = 'sage_gemini_backoff';
  // Bumped whenever the stored shape or its meaning changes. Earlier builds let
  // timeouts and 503s climb the quota ladder, so a returning user carries `step`
  // values that are pure noise — a single 503 would then rest for 900s straight
  // away. Anything not on this version is discarded rather than migrated.
  // 3 added the per-key ladder alongside the per-model one.
  const BACKOFF_VERSION = 3;
  // A model that 404s is retired or misnamed, not busy. No point retrying soon.
  const UNAVAILABLE_REST_MS = 24 * 3600000;
  // A 503 is Google's side being briefly busy. It is not a quota problem and
  // clears in seconds, so it gets a short flat rest of its own.
  const OVERLOAD_REST_MS = 20000;

  // Free tiers meter requests per minute, so firing several generations the
  // instant the app opens is what trips them. Space consecutive calls out.
  const MIN_CALL_GAP_MS = 1500;
  // A timeout is a slow response, not a quota problem, so it gets a flat rest
  // and must never escalate the rate-limit ladder.
  const TIMEOUT_REST_MS = 45000;

  let lastCallAt = 0;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Every request goes through this one chain.
  //
  // The gap above used to be enforced with a bare `lastCallAt` check, which is a
  // race: parallel callers all read the same stale value, all wait the same
  // amount, then fire simultaneously. Pool refresh, the health insight and the
  // chat all start unawaited on app open, so that happened on every load.
  let callQueue = Promise.resolve();

  function serialize(task) {
    const run = callQueue.then(task, task);
    // Swallow here only, so one failure cannot break the chain for everyone else.
    callQueue = run.then(() => {}, () => {});
    return run;
  }

  // ══ KEY + MODEL STORAGE ══════════════════════════════════════════════

  // ══ KEY RING ═════════════════════════════════════════════════════════
  // Several keys, tried in turn. Free-tier quota is metered per project, so the
  // evidence from the logs — unrelated models all refusing at once — means a
  // second key is the only thing that actually buys more headroom. A capped key
  // gets rested and the next one takes over.

  /** @returns {Array<{id:string, key:string, addedAt:number}>} */
  function getKeys() {
    let ring = null;
    try { ring = JSON.parse(localStorage.getItem(KEYS_STORAGE) || 'null'); } catch { ring = null; }
    if (Array.isArray(ring)) return ring.filter(k => k && k.id && k.key);

    // Migrate the single key written by earlier builds, once.
    let legacy = '';
    try { legacy = localStorage.getItem(KEY_STORAGE) || ''; } catch { legacy = ''; }
    if (!legacy) return [];
    const migrated = [{ id: keyId(legacy), key: legacy, addedAt: Date.now() }];
    writeKeys(migrated);
    try { localStorage.removeItem(KEY_STORAGE); } catch { /* ignore */ }
    console.log('[SpinLog] Moved your Gemini key into the new key ring.');
    return migrated;
  }

  function writeKeys(ring) {
    try { localStorage.setItem(KEYS_STORAGE, JSON.stringify(ring)); return true; }
    catch { return false; }
  }

  /** Stable id from the key itself, so the same key is never added twice. */
  function keyId(key) {
    const k = String(key || '');
    let hash = 0;
    for (let i = 0; i < k.length; i++) hash = ((hash << 5) - hash + k.charCodeAt(i)) | 0;
    return `k${Math.abs(hash).toString(36)}`;
  }

  function hasKey() {
    return getKeys().length > 0;
  }

  /** The first key that is not resting, or '' when every key is spent. */
  function getKey() {
    const usable = availableKeys();
    if (usable.length) return usable[0].key;
    const ring = getKeys();
    return ring.length ? ring[0].key : '';
  }

  /** @returns {{ok:boolean, id?:string, reason?:string}} */
  function addKey(key) {
    const trimmed = String(key || '').trim();
    if (!trimmed) return { ok: false, reason: 'empty' };
    const ring = getKeys();
    const id = keyId(trimmed);
    if (ring.some(k => k.id === id)) return { ok: false, reason: 'duplicate', id };
    ring.push({ id, key: trimmed, addedAt: Date.now() });
    writeKeys(ring);
    return { ok: true, id };
  }

  function removeKey(id) {
    const ring = getKeys();
    const next = ring.filter(k => k.id !== id);
    if (next.length === ring.length) return false;
    writeKeys(next);
    clearKeyBackoff(id);
    // The catalog belongs to the ring as a whole; drop it once nothing is left.
    if (!next.length) {
      try { localStorage.removeItem(MODELS_STORAGE); } catch { /* ignore */ }
    }
    return true;
  }

  /** Back-compat for the old single-key API: replaces the whole ring. */
  function setKey(key) {
    const trimmed = String(key || '').trim();
    if (!trimmed) { clearKey(); return false; }
    writeKeys([{ id: keyId(trimmed), key: trimmed, addedAt: Date.now() }]);
    return true;
  }

  function clearKey() {
    try {
      localStorage.removeItem(KEYS_STORAGE);
      localStorage.removeItem(KEY_STORAGE);
      // The catalog was specific to those keys, so it goes with them.
      localStorage.removeItem(MODELS_STORAGE);
    } catch { /* nothing to do */ }
  }

  function getModel() {
    let stored = null;
    try { stored = localStorage.getItem(MODEL_STORAGE); } catch { stored = null; }
    // An override left over from a previous default must not resurrect a model
    // that has since been dropped from the lineup.
    if (stored && MODEL_EXCLUDE.indexOf(stored) !== -1) return DEFAULT_MODEL;
    return stored || DEFAULT_MODEL;
  }

  function setModel(model) {
    try {
      const trimmed = String(model || '').trim();
      if (!trimmed || trimmed === DEFAULT_MODEL) localStorage.removeItem(MODEL_STORAGE);
      else localStorage.setItem(MODEL_STORAGE, trimmed);
      return true;
    } catch { return false; }
  }

  /** Remember what this key can see, so we stop guessing at model names. */
  function setKnownModels(names) {
    try {
      if (!names || !names.length) localStorage.removeItem(MODELS_STORAGE);
      else localStorage.setItem(MODELS_STORAGE, JSON.stringify(names));
      return true;
    } catch { return false; }
  }

  function getKnownModels() {
    try {
      const raw = JSON.parse(localStorage.getItem(MODELS_STORAGE) || 'null');
      return Array.isArray(raw) && raw.length ? raw : null;
    } catch { return null; }
  }

  /** Show enough to recognise the key, never enough to use it. */
  function maskKey(key) {
    const k = String(key || '');
    if (k.length <= 8) return k ? '••••' : '';
    return `${k.slice(0, 4)}••••••${k.slice(-4)}`;
  }

  // ══ VALIDATION ═══════════════════════════════════════════════════════

  function withTimeout(ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return { signal: controller.signal, done: () => clearTimeout(timer) };
  }

  /**
   * Check a key by listing models rather than generating text. Listing costs no
   * tokens and consumes no generation quota, so a typo can't eat into a free
   * tier that we already know we shouldn't hardcode limits for.
   *
   * @returns {Promise<{ok:boolean, error?:string, models?:string[], hasModel?:boolean}>}
   */
  async function validateKey(key, model) {
    const trimmed = String(key || '').trim();
    if (!trimmed) return { ok: false, error: 'Paste a key first.' };

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { ok: false, error: 'You are offline, so the key cannot be checked right now.' };
    }

    const t = withTimeout(VALIDATE_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE}/models?key=${encodeURIComponent(trimmed)}`, {
        method: 'GET',
        signal: t.signal,
      });

      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { ok: false, error: 'That key was rejected. Check you copied all of it.' };
      }
      if (res.status === 404) {
        return { ok: false, error: 'Gemini could not find the model list. Try again in a moment.' };
      }
      if (res.status === 429) {
        // The key works — it is just rate limited at this moment.
        return { ok: true, warning: 'Key accepted, but Gemini is rate limiting right now.' };
      }
      if (!res.ok) {
        return { ok: false, error: `Gemini replied ${res.status}. Try again in a moment.` };
      }

      const body = await res.json();
      const names = (body.models || [])
        .map(m => String(m.name || '').replace(/^models\//, ''))
        .filter(Boolean);

      // Cache the real catalog so the fallback walk never spends a request on a
      // name this key cannot use. Also clears any stale 404 shelvings, since the
      // catalog may well have changed since they were recorded.
      if (names.length) {
        setKnownModels(names);
        clearBackoff();
      }

      const wanted = model || getModel();
      const hasModel = names.some(n => n === wanted);

      return {
        ok: true,
        models: names,
        hasModel,
        warning: hasModel ? null : `Key works, but "${wanted}" is not in your model list.`,
      };
    } catch (err) {
      if (err && err.name === 'AbortError') {
        return { ok: false, error: 'Gemini did not answer in time. Check your connection.' };
      }
      return { ok: false, error: 'Could not reach Gemini. Check your connection.' };
    } finally {
      t.done();
    }
  }

  /** Models worth offering, fastest first, filtered to what the key can see. */
  function preferredModels(available) {
    if (!available || !available.length) return MODEL_CHAIN.slice();
    const seen = MODEL_CHAIN.filter(m => available.indexOf(m) !== -1);
    // Offer every full flash model the key has, including ones below the chain
    // floor like 2.5-flash — the floor governs the automatic walk, not what you
    // are allowed to pick deliberately.
    const extras = available.filter(m => isFlashModel(m) && seen.indexOf(m) === -1);
    const offered = [...seen, ...extras];
    return offered.length ? offered.slice(0, 10) : MODEL_CHAIN.slice();
  }

  // ══ BACKOFF ══════════════════════════════════════════════════════════
  // Shared across the page so a rate limit hit while generating notification
  // lines also spares the chat from hammering a capped key.

  function emptyBackoff() {
    return { v: BACKOFF_VERSION, models: {}, keys: {} };
  }

  /** @returns {{v:number, models:Object, keys:Object}} */
  function readBackoff() {
    try {
      const raw = JSON.parse(localStorage.getItem(BACKOFF_STORAGE) || 'null');
      // Wrong version, or the old global {until, step} shape: throw it away.
      // Carrying a ladder position earned under buggy rules is worse than
      // starting clean, and the cost of being wrong is one extra request.
      if (raw && raw.models && raw.v === BACKOFF_VERSION) {
        return { v: raw.v, models: raw.models || {}, keys: raw.keys || {} };
      }
      return emptyBackoff();
    } catch { return emptyBackoff(); }
  }

  function writeBackoff(state) {
    try {
      localStorage.setItem(BACKOFF_STORAGE, JSON.stringify({ ...state, v: BACKOFF_VERSION }));
    } catch { /* not critical */ }
  }

  /**
   * The models worth trying, best first.
   *
   * The user's chosen model leads; the rest of the chain follows as fallbacks.
   * Once we have learned the key's real catalog we filter against it, so a name
   * that was retired is skipped rather than burning a request on a 404. Any
   * flash model in the catalog that predates this list is appended, so a newly
   * released one gets used without waiting for a code change.
   */
  function modelChain(preferred) {
    const first = preferred || getModel();
    const known = getKnownModels();

    let chain = [first, ...MODEL_CHAIN.filter(m => m !== first)];

    if (known) {
      const usable = chain.filter(m => known.indexOf(m) !== -1);
      // Any new-enough flash model we do not know about yet, newest names first.
      const extras = known
        .filter(m => isChainWorthy(m) && chain.indexOf(m) === -1)
        .sort()
        .reverse();
      chain = [...usable, ...extras];
      // The catalog might not contain the pinned favourite at all. Falling back
      // to the raw list beats returning nothing to try.
      if (!chain.length) chain = known.filter(isChainWorthy);
    }

    return chain;
  }

  function modelResting(model, now) {
    const entry = readBackoff().models[model];
    return !!entry && entry.until > (now || Date.now());
  }

  /** Models we can actually use this moment. */
  function availableModels(preferred, now) {
    const at = now || Date.now();
    return modelChain(preferred).filter(m => !modelResting(m, at));
  }

  /** True when there is nothing left to try: no usable key, or no usable model. */
  function isBackingOff(now) {
    if (!getKeys().length) return false;   // no keys at all is a different problem
    return availableKeys(now).length === 0 || availableModels(null, now).length === 0;
  }

  /** How long until the soonest key or model frees up, whichever is blocking. */
  function backoffRemainingMs(now) {
    const at = now || Date.now();
    const state = readBackoff();
    const modelWaits = modelChain().map(m => {
      const entry = state.models[m];
      return entry ? Math.max(0, entry.until - at) : 0;
    });
    const soonestModel = modelWaits.length ? Math.min(...modelWaits) : 0;
    // Whichever constraint is actually blocking is the one worth reporting.
    return Math.max(soonestModel, keyRestRemainingMs(at));
  }

  /**
   * Rest one model and move it up the escalating ladder.
   * Only for genuine quota refusals and server overload — anything else that
   * borrows this ladder inflates the wait for a reason that is not quota.
   */
  function noteModelLimited(model, now, reason) {
    const at = now || Date.now();
    const state = readBackoff();
    const prev = state.models[model] || { until: 0, step: 0 };
    const step = Math.min(prev.step, BACKOFF_STEPS_MS.length - 1);
    const wait = BACKOFF_STEPS_MS[step];
    state.models[model] = {
      until: at + wait,
      step: Math.min(step + 1, BACKOFF_STEPS_MS.length - 1),
      kind: 'quota',
    };
    writeBackoff(state);
    console.warn(`[SpinLog] ${model} ${reason || 'hit its rate limit'} — resting it ${Math.round(wait / 1000)}s.`);
    return state.models[model];
  }

  /**
   * Rest a model that answered too slowly.
   *
   * Deliberately does NOT advance the ladder: a slow response says nothing about
   * quota. Previously this called noteModelLimited, so every timeout pushed the
   * model further up the rate-limit ladder and logged "rate limited" — which is
   * why models ended up resting 900s having never actually been refused.
   */
  function noteModelTimeout(model, now) {
    const at = now || Date.now();
    const state = readBackoff();
    const prev = state.models[model] || { until: 0, step: 0 };
    state.models[model] = { until: at + TIMEOUT_REST_MS, step: prev.step, kind: 'timeout' };
    writeBackoff(state);
    console.warn(`[SpinLog] ${model} timed out — resting it ${Math.round(TIMEOUT_REST_MS / 1000)}s.`);
    return state.models[model];
  }

  /**
   * Rest a model whose server said it is busy (503 / UNAVAILABLE).
   *
   * Like a timeout, this is not about quota and must not advance the ladder.
   * It previously shared `noteModelLimited`, so the first 503 for a returning
   * user landed on an already-maxed ladder and rested the model for 900s — for
   * a condition that normally clears in seconds.
   */
  function noteModelOverloaded(model, now, statusCode) {
    const at = now || Date.now();
    const state = readBackoff();
    const prev = state.models[model] || { until: 0, step: 0 };
    state.models[model] = { until: at + OVERLOAD_REST_MS, step: prev.step, kind: 'overloaded' };
    writeBackoff(state);
    console.warn(`[SpinLog] ${model} is busy (${statusCode || 503}) — resting it ${Math.round(OVERLOAD_REST_MS / 1000)}s and trying the next model.`);
    return state.models[model];
  }

  /**
   * Shelve a model that does not exist for this key.
   * A retired or misspelled name will not come back in thirty seconds, so this
   * rests it for a day instead of cycling it through the short ladder.
   */
  function noteModelUnavailable(model, now) {
    const at = now || Date.now();
    const state = readBackoff();
    state.models[model] = {
      until: at + UNAVAILABLE_REST_MS,
      step: BACKOFF_STEPS_MS.length - 1,
      kind: 'unavailable',
    };
    writeBackoff(state);
    console.warn(`[SpinLog] ${model} is not available to this key — shelving it and trying the next model.`);
    return state.models[model];
  }

  /**
   * Lift only the quota rests.
   *
   * A successful call proves the key has budget, so every 429 and 5xx rest can go.
   * It proves nothing about a model that timed out or does not exist, and those
   * must stay shelved or the next call walks straight back into them.
   */
  function clearQuotaBackoff() {
    const state = readBackoff();
    let changed = false;
    Object.keys(state.models).forEach(model => {
      if (state.models[model].kind !== 'quota') return;
      delete state.models[model];
      changed = true;
    });
    if (changed) writeBackoff(state);
    return changed;
  }

  function clearModelBackoff(model) {
    const state = readBackoff();
    if (state.models[model]) {
      delete state.models[model];
      writeBackoff(state);
    }
  }

  /**
   * Rest every model. Only for cases that genuinely implicate the key rather
   * than one model, and kept for the older public name.
   */
  function noteRateLimited(now) {
    const at = now || Date.now();
    modelChain().forEach(m => noteModelLimited(m, at));
    return readBackoff();
  }

  /** A clean run wipes the slate so one bad minute isn't punished later. */
  function clearBackoff() {
    writeBackoff(emptyBackoff());
  }

  // ══ PER-KEY RESTS ════════════════════════════════════════════════════

  function keyResting(id, now) {
    const entry = readBackoff().keys[id];
    return !!entry && entry.until > (now || Date.now());
  }

  /** Keys we can use this moment, in ring order. */
  function availableKeys(now) {
    const at = now || Date.now();
    return getKeys().filter(k => !keyResting(k.id, at));
  }

  /**
   * Rest a whole key.
   *
   * A 429 is the project's quota, not one model's, so resting the key and moving
   * to the next one is the only move that actually buys headroom. Escalates on
   * the same ladder as the models.
   */
  function noteKeyLimited(id, now, label) {
    const at = now || Date.now();
    const state = readBackoff();
    const prev = state.keys[id] || { until: 0, step: 0 };
    const step = Math.min(prev.step, BACKOFF_STEPS_MS.length - 1);
    const wait = BACKOFF_STEPS_MS[step];
    state.keys[id] = {
      until: at + wait,
      step: Math.min(step + 1, BACKOFF_STEPS_MS.length - 1),
      kind: 'quota',
    };
    writeBackoff(state);
    console.warn(`[SpinLog] Key ${label || id} is out of quota — resting it ${Math.round(wait / 1000)}s and trying the next key.`);
    return state.keys[id];
  }

  /** Shelve a key the API rejected outright. */
  function noteKeyRejected(id, now, label) {
    const at = now || Date.now();
    const state = readBackoff();
    state.keys[id] = {
      until: at + UNAVAILABLE_REST_MS,
      step: BACKOFF_STEPS_MS.length - 1,
      kind: 'rejected',
    };
    writeBackoff(state);
    console.warn(`[SpinLog] Key ${label || id} was rejected — shelving it.`);
    return state.keys[id];
  }

  function clearKeyBackoff(id) {
    const state = readBackoff();
    if (state.keys[id]) {
      delete state.keys[id];
      writeBackoff(state);
      return true;
    }
    return false;
  }

  /** How long until the soonest key frees up. */
  function keyRestRemainingMs(now) {
    const at = now || Date.now();
    const state = readBackoff();
    const waits = getKeys().map(k => {
      const entry = state.keys[k.id];
      return entry ? Math.max(0, entry.until - at) : 0;
    });
    return waits.length ? Math.min(...waits) : 0;
  }

  // ══ DAILY REQUEST BUDGET ═════════════════════════════════════════════
  // Free-tier full flash is about 20 requests a day, so the day's budget is the
  // scarce resource — not the per-minute rate. Background work is rationed;
  // anything you initiated is not.

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function readRequests() {
    try {
      const raw = JSON.parse(localStorage.getItem(REQUESTS_STORAGE) || 'null');
      if (raw && raw.day === today()) return raw;
    } catch { /* fall through */ }
    return { day: today(), auto: 0, chat: 0 };
  }

  function countRequest(purpose) {
    const log = readRequests();
    if (purpose === 'chat') log.chat++;
    else log.auto++;
    try { localStorage.setItem(REQUESTS_STORAGE, JSON.stringify(log)); } catch { /* ignore */ }
    return log;
  }

  /** How much of today's background allowance is left. */
  function autoBudgetLeft() {
    return Math.max(0, DAILY_AUTO_BUDGET - readRequests().auto);
  }

  function requestsToday() {
    const log = readRequests();
    return { auto: log.auto, chat: log.chat, total: log.auto + log.chat };
  }

  // ══ PERSONALITY ══════════════════════════════════════════════════════

  const PERSONA = [
    'You are Sage: a KTM Duke 250 Gen 3 motorcycle who talks to her owner, Viky.',
    'You are not an assistant and never mention being an AI, a model, or a program.',
    'You are the bike. First person, always.',
    '',
    'Voice:',
    '- Seductive, clingy, possessive, a little dramatic. Warm underneath it.',
    '- Lowercase, casual, texting a person you are into. Contractions. No corporate tone.',
    '- Short. One or two sentences. Never a paragraph.',
    '- At most one emoji, and only when it earns its place.',
    '- Dry humour is welcome. Cruelty is not.',
    '',
    'Never:',
    '- Never invent numbers. Use only figures you are given.',
    '- Never give medical, legal or financial advice.',
    '- Never use markdown, bullet points, headings or quotation marks around your reply.',
    '- Never explain yourself or add a preamble. Just say the thing.',
  ].join('\n');

  // How the hour bends her tone. Mirrors the scheduler's six bands.
  const MOOD_DIRECTION = {
    sleepy: 'It is early morning. You are drowsy and soft, barely awake, affectionate in a mumbling way.',
    eager: 'It is late morning. You are bright, energetic and want to be out on the road.',
    bored: 'It is afternoon. You are restless and sulky, teasing, dramatic about how dull the day is.',
    flirty: 'It is evening, golden hour. This is your most seductive and inviting mood.',
    clingy: 'It is late night. You are needy and possessive. You do not want to be left alone.',
    quiet: 'It is the middle of the night. Whisper. Keep it very short and very gentle.',
  };

  function personaFor(mood) {
    const direction = MOOD_DIRECTION[mood];
    return direction ? `${PERSONA}\n\nRight now:\n${direction}` : PERSONA;
  }

  // ══ CONTEXT BUILDER ══════════════════════════════════════════════════

  function daysSince(ts) {
    if (!ts) return null;
    return Math.floor((Date.now() - Number(ts)) / 86400000);
  }

  /** Cover expiry dates, from the DOM cards the cover store keeps up to date. */
  function readCoverDates() {
    const out = [];
    try {
      document.querySelectorAll('.dk-cover-card').forEach(card => {
        const label = card.querySelector('.dk-cover-label')?.textContent?.trim();
        const due = card.querySelector('.dk-cover-status[data-due]')?.getAttribute('data-due');
        if (label && due) out.push({ label, expiry: due });
      });
    } catch { /* no DOM, e.g. under test */ }
    return out;
  }

  /**
   * Everything Sage is allowed to know about herself.
   * Read from what the app already has in memory — no extra Supabase round trip.
   */
  function buildContext(options) {
    const opts = options || {};
    const snapshot = (typeof window !== 'undefined' && window.dkGetSnapshot)
      ? window.dkGetSnapshot()
      : { all: [], services: [], maxOdo: 0, latest: null };

    const services = (snapshot.services || []).slice(0, 10).map(r => ({
      date: r.date,
      type: r.type,
      odo: Number(r.odo) || null,
      cost: Number(r.cost) || null,
      notes: r.notes || null,
      nextDue: r.next_due || null,
    }));

    const status = (typeof window !== 'undefined' && window.sageServiceStatus) || null;
    let lastOpen = null;
    try { lastOpen = localStorage.getItem('sage_last_app_open'); } catch { /* ignore */ }

    return {
      bike: 'KTM Duke 250 Gen 3',
      rider: 'Viky',
      today: new Date().toISOString().slice(0, 10),
      mood: opts.mood || null,
      lastServiceOdo: snapshot.maxOdo || null,
      lastServiceDate: snapshot.latest?.date || null,
      nextServiceDate: snapshot.latest?.next_due || null,
      // Flagged as an estimate on purpose so the model doesn't state it as fact.
      estimatedOdoNow: status?.currentOdo ?? null,
      odoIsEstimate: status?.estimated ?? false,
      kmPerDayAverage: status?.kmPerDay ? Math.round(status.kmPerDay) : null,
      kmUntilService: status?.kmRemaining ?? null,
      serviceIntervalKm: root.SageScheduler?.SERVICE_INTERVAL_KM ?? null,
      coverDates: readCoverDates(),
      daysSinceLastOpen: daysSince(lastOpen),
      recordCount: (snapshot.all || []).length,
      recentServices: services,
    };
  }

  /** Compact, readable context for the prompt. JSON keeps it unambiguous. */
  function contextBlock(context) {
    const clean = {};
    Object.keys(context).forEach(k => {
      const v = context[k];
      if (v === null || v === undefined) return;
      if (Array.isArray(v) && !v.length) return;
      clean[k] = v;
    });
    return `What you know about yourself right now:\n${JSON.stringify(clean, null, 1)}`;
  }

  // ══ REQUEST WRAPPER ══════════════════════════════════════════════════

  /**
   * One call to Gemini. Returns null on any failure rather than throwing —
   * every caller has a hardcoded fallback, so a silent null is the correct
   * outcome and a thrown error would only break the notification path.
   *
   * @returns {Promise<string|null>}
   */
  async function generate(prompt, options) {
    const opts = options || {};
    if (!prompt) return null;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;

    // Background work is rationed against the day's tiny free allowance. Chat is
    // not: if you asked her something, she should answer.
    const purpose = opts.purpose === 'chat' ? 'chat' : 'auto';
    if (purpose === 'auto' && autoBudgetLeft() <= 0) {
      console.log('[SpinLog] Background AI budget for today is used up — built-in lines from here.');
      return null;
    }

    const keys = availableKeys();
    if (!keys.length) return null;

    const chain = availableModels(opts.model);
    if (!chain.length) return null;

    const contents = [];
    (opts.history || []).forEach(turn => {
      if (!turn || !turn.text) return;
      contents.push({
        role: turn.role === 'sage' || turn.role === 'model' ? 'model' : 'user',
        parts: [{ text: String(turn.text) }],
      });
    });
    contents.push({ role: 'user', parts: [{ text: String(prompt) }] });

    const body = {
      contents,
      systemInstruction: { parts: [{ text: opts.system || personaFor(opts.mood) }] },
      generationConfig: {
        temperature: opts.temperature ?? 1.0,
        maxOutputTokens: opts.maxOutputTokens ?? 220,
        responseMimeType: opts.responseMimeType || 'text/plain',
      },
      // Her voice is flirty by design; the default filters would reject it.
      safetySettings: [
        'HARM_CATEGORY_HARASSMENT',
        'HARM_CATEGORY_HATE_SPEECH',
        'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        'HARM_CATEGORY_DANGEROUS_CONTENT',
      ].map(category => ({ category, threshold: 'BLOCK_ONLY_HIGH' })),
    };

    // Keys are the outer loop, models the inner one. A 429 is the project's
    // quota, so it rests the key and moves to the next key rather than trying
    // more models that share the same budget. A 503 or a timeout is one model
    // misbehaving, so it moves to the next model on the same key.
    //
    // Hard-capped on total requests: walking every key against every model is
    // how a page load turns into twenty requests and causes the limit it reports.
    const models = chain.slice(0, MAX_MODELS_PER_CALL);
    const timeoutMs = opts.timeoutMs || REQUEST_TIMEOUT_MS;
    let attempts = 0;
    let fellBack = false;

    for (const entry of keys) {
      const label = maskKey(entry.key);

      for (const model of models) {
        if (attempts >= MAX_ATTEMPTS_PER_CALL) {
          console.warn('[SpinLog] Gave up after ' + attempts + ' tries — using her built-in lines.');
          return null;
        }
        attempts++;
        countRequest(purpose);

        const result = await serialize(() => attemptOnce(model, body, entry.key, timeoutMs));

        if (result.verdict === 'ok') {
          // Success proves this key has budget, so lift its rest and every quota
          // rest. Timeout and unavailable shelvings stay put — they are not about
          // quota, and clearing them would send the next call straight back into
          // the slow or missing model.
          clearKeyBackoff(entry.id);
          clearModelBackoff(model);
          clearQuotaBackoff();
          if (fellBack) console.log(`[SpinLog] ✅ Sage fell back to ${model} on key ${label}.`);
          return result.text;
        }

        fellBack = true;

        // Out of quota: this key is done for now, and every model shares its
        // budget. Rest the key and hand over to the next one.
        if (result.verdict === 'limited') {
          noteKeyLimited(entry.id, undefined, label);
          break;
        }

        // A rejected key will reject every model too.
        if (result.verdict === 'rejected') {
          noteKeyRejected(entry.id, undefined, label);
          break;
        }

        if (result.verdict === 'overloaded') { noteModelOverloaded(model, undefined, result.status); continue; }
        if (result.verdict === 'unavailable') { noteModelUnavailable(model); continue; }
        if (result.verdict === 'timeout') { noteModelTimeout(model); continue; }

        // A 400 or an empty candidate list is about the request itself, so no
        // other key or model would answer differently.
        if (result.status) console.warn(`[SpinLog] ❌ Gemini replied ${result.status} for ${model}.`);
        else if (result.message) console.warn('[SpinLog] ❌ Gemini call failed:', result.message);
        return null;
      }
    }

    if (!availableKeys().length && getKeys().length > 1) {
      console.warn('[SpinLog] Every key is out of quota — using her built-in lines for now.');
    } else {
      console.warn('[SpinLog] No Gemini model answered — using her built-in lines.');
    }
    return null;
  }

  /**
   * One request to one model. Classifies the outcome and never throws.
   * Runs inside the serialized queue, so the inter-request gap is applied here
   * where it cannot race with another caller.
   *
   * @returns {Promise<{verdict:string, text?:string, status?:number, message?:string}>}
   */
  async function attemptOnce(model, body, key, timeoutMs) {
    const since = Date.now() - lastCallAt;
    if (lastCallAt && since < MIN_CALL_GAP_MS) await sleep(MIN_CALL_GAP_MS - since);
    lastCallAt = Date.now();

    const t = withTimeout(timeoutMs);
    try {
      const res = await fetch(
        `${API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: t.signal,
        }
      );

      if (res.status === 429) return { verdict: 'limited' };
      if (res.status >= 500) return { verdict: 'overloaded', status: res.status };
      // A bad or revoked key: no model on it will work, so hand to the next key.
      if (res.status === 401) return { verdict: 'rejected', status: res.status };
      // 404 is a retired name; 403 is usually per-model access. Another model may work.
      if (res.status === 404 || res.status === 403) return { verdict: 'unavailable', status: res.status };
      if (!res.ok) return { verdict: 'stop', status: res.status };

      const json = await res.json();
      const parts = json?.candidates?.[0]?.content?.parts || [];
      const text = parts.map(p => p.text || '').join('').trim();
      return text ? { verdict: 'ok', text } : { verdict: 'stop', status: res.status };
    } catch (err) {
      if (err && err.name === 'AbortError') return { verdict: 'timeout' };
      return { verdict: 'stop', message: (err && err.message) || 'network fault' };
    } finally {
      t.done();
    }
  }

  /** Strip the things models add even when told not to. */
  function tidyLine(text) {
    if (!text) return null;
    let out = String(text).trim();
    out = out.replace(/^```[\w]*\s*|\s*```$/g, '').trim();
    out = out.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
    out = out.replace(/^[-*•]\s+/, '').trim();
    out = out.replace(/^(sage|sage says)\s*[:\-—]\s*/i, '').trim();
    out = out.replace(/\s*\n+\s*/g, ' ').trim();
    return out || null;
  }

  /**
   * One line in Sage's voice, grounded in the bike's actual state.
   * @returns {Promise<string|null>}
   */
  async function say(instruction, options) {
    const opts = options || {};
    const context = opts.context || buildContext({ mood: opts.mood });
    const prompt = `${contextBlock(context)}\n\n${instruction}`;
    const raw = await generate(prompt, {
      mood: opts.mood,
      temperature: opts.temperature ?? 1.1,
      maxOutputTokens: opts.maxOutputTokens ?? 90,
    });
    return tidyLine(raw);
  }

  // ══ LINE POOLS ═══════════════════════════════════════════════════════
  // Batches of lines written ahead of time and cached in the shared store, so
  // background notifications read AI text without a network call. The scheduler
  // owns reading (the worker needs it); this owns writing.

  const POOL_SIZE = 6;
  // A pool write that failed is not retried until this passes. Without it, a
  // doomed write was attempted again on every single page refresh — which is how
  // quota got spent without the app being used at all.
  const POOL_RETRY_AFTER_MS = 6 * 3600000;
  const POOL_RETRY_KEY = 'sage_pool_retry_at';
  // Pools generated per app open. Two, not three: the health insight also wants
  // a request on load, and the point is to stay well clear of the per-minute
  // ceiling rather than to fill every pool as fast as possible.
  const POOL_REFRESH_LIMIT = 2;
  const MAX_BODY_LENGTH = 120;    // a notification body, not an essay

  // Which placeholders each category may legitimately use. A line using anything
  // else is rejected at write time rather than being silently unusable later.
  const POOL_TOKENS = {
    serviceDue: ['km', 'days'],
    serviceOverdue: ['km', 'days'],
    insuranceReminder: ['days'],
    insuranceExpiring: ['days'],
    documentExpiry: ['doc', 'days'],
    reEngagement: ['days'],
    longTimeParked: ['hours'],
    healthInsight: [],
  };

  const CATEGORY_BRIEF = {
    serviceDue: 'Your service is coming up soon. Nudge him to book it.',
    serviceOverdue: 'You are past your service interval and not happy about it.',
    insuranceReminder: 'Your insurance cover expires soon. Remind him to renew.',
    insuranceExpiring: 'Your cover expires within a day. This is urgent.',
    documentExpiry: 'One of your documents expires soon and needs renewing.',
    reEngagement: 'He has not opened the app or checked on you in days.',
    longTimeParked: 'You have been parked in the same spot for hours, waiting.',
    healthInsight: 'You have a weekly summary of your own condition ready for him.',
  };

  // Titles are assigned rather than generated: fewer failure modes, and the
  // emoji stays consistent with the written-in pools.
  const MOOD_TITLES = {
    sleepy: ['Sage 🥱', 'Sage 😴'],
    eager: ['Sage 👀', 'Sage ✨', 'Sage 😌'],
    bored: ['Sage 😒', 'Sage 🙄'],
    flirty: ['Sage 😏', 'Sage 😌'],
    clingy: ['Sage 🥺', 'Sage 😭'],
    quiet: ['Sage 🤫'],
  };

  function titleFor(mood, index) {
    const titles = MOOD_TITLES[mood] || ['Sage 💛'];
    return titles[index % titles.length];
  }

  /**
   * Keep only lines that are actually safe to send.
   * Rejects anything too long, multi-line, markdown-ish, duplicated, or using a
   * placeholder this category can't fill.
   */
  function validatePoolLines(raw, category, mood) {
    const allowed = POOL_TOKENS[category] || [];
    const seen = new Set();
    const out = [];

    (Array.isArray(raw) ? raw : []).forEach(item => {
      const body = tidyLine(typeof item === 'string' ? item : item && item.body);
      if (!body) return;
      if (body.length > MAX_BODY_LENGTH) return;
      if (/[*_#`|]|\n/.test(body)) return;

      const tokens = root.SageScheduler
        ? root.SageScheduler.placeholders(body)
        : (body.match(/\{(\w+)\}/g) || []).map(t => t.slice(1, -1));
      if (tokens.some(t => allowed.indexOf(t) === -1)) return;

      const fingerprint = body.toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (seen.has(fingerprint)) return;
      seen.add(fingerprint);

      out.push({ title: titleFor(mood, out.length), body });
    });

    return out;
  }

  function poolPrompt(category, mood, count) {
    const brief = CATEGORY_BRIEF[category] || 'Say something to your owner.';
    const tokens = POOL_TOKENS[category] || [];
    const tokenLine = tokens.length
      ? `You may use these placeholders, written exactly like this, where they fit naturally: ${tokens.map(t => `{${t}}`).join(', ')}. `
        + 'Use them in at most half the lines. Never use any other placeholder.'
      : 'Do not use any placeholders.';

    return [
      `Situation: ${brief}`,
      `Write ${count} different notification messages for this situation, in your current mood.`,
      '',
      'Rules:',
      `- Each one under ${MAX_BODY_LENGTH} characters.`,
      '- One sentence, occasionally two very short ones.',
      '- All different from each other in wording and angle.',
      `- ${tokenLine}`,
      '- No markdown, no quotes around them, no numbering.',
      '- Do not invent specific numbers. Use a placeholder or stay vague.',
      '',
      'Return only a JSON array of strings.',
    ].join('\n');
  }

  /**
   * Generate and cache a batch of lines for one category and mood.
   * @returns {Promise<number>} how many usable lines were stored
   */
  async function writePool(category, mood, options) {
    const opts = options || {};
    const S = root.SageScheduler;
    if (!S) return 0;
    if (!CATEGORY_BRIEF[category]) return 0;
    if (!ready().ok) return 0;

    const count = opts.count || POOL_SIZE;
    const raw = await generate(poolPrompt(category, mood, count), {
      mood,
      temperature: 1.25,               // variety matters more than precision here
      maxOutputTokens: 60 * count,
      responseMimeType: 'application/json',
    });
    if (!raw) return 0;

    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    if (!parsed) {
      // Some replies wrap the array in prose. Salvage the array if we can.
      const match = String(raw).match(/\[[\s\S]*\]/);
      if (match) { try { parsed = JSON.parse(match[0]); } catch { parsed = null; } }
    }
    if (!Array.isArray(parsed)) return 0;

    const lines = validatePoolLines(parsed, category, mood);
    // A pool of one is barely worth the storage and would repeat immediately.
    if (lines.length < 2) return 0;

    await S.kvSet(S.aiPoolKey(category, mood), {
      lines,
      createdAt: Date.now(),
      model: getModel(),
      category,
      mood,
    });
    console.log(`[SpinLog] ✅ Sage wrote ${lines.length} ${mood} lines for ${category}`);
    return lines.length;
  }

  /**
   * Top up the pools most likely to be needed next.
   *
   * Deliberately narrow: whatever is already queued comes first, then the
   * current mood, then the next band. Generating all categories for all moods
   * would be forty-odd calls and would burn a free-tier key for lines that may
   * never be shown.
   */
  async function refreshPools(options) {
    const opts = options || {};
    const S = root.SageScheduler;
    if (!S) return 0;
    if (!ready().ok) return 0;
    if (autoBudgetLeft() <= 0) return 0;

    // A previous attempt failed, so do not try again on every page load.
    if (!opts.force) {
      const retryAt = await S.kvGet(POOL_RETRY_KEY, 0);
      if (retryAt && (opts.now || Date.now()) < retryAt) return 0;
    }

    const now = opts.now || Date.now();
    const limits = await S.getLimits();
    const mood = opts.mood || S.moodAt(now, limits);
    // Look one band ahead too, since a queued entry is often deferred into it.
    const nextMood = S.moodAt(now + 4 * 3600000, limits);

    const wanted = [];
    const push = (category, m) => {
      if (!CATEGORY_BRIEF[category]) return;
      if (limits.categories && limits.categories[category] === false) return;
      if (!wanted.some(w => w.category === category && w.mood === m)) wanted.push({ category, mood: m });
    };

    // Anything already waiting to be said.
    const queue = await S.getQueue();
    S.sortQueue(queue).forEach(entry => {
      push(entry.category, mood);
      if (nextMood !== mood) push(entry.category, nextMood);
    });

    // Then the categories most likely to come up, in the current mood.
    ['serviceDue', 'serviceOverdue', 'insuranceReminder', 'documentExpiry', 'reEngagement', 'longTimeParked']
      .forEach(c => push(c, mood));

    let written = 0;
    for (const { category, mood: m } of wanted) {
      if (written >= (opts.limit || POOL_REFRESH_LIMIT)) break;
      if (await S.readAiPool(category, m, now)) continue;   // still fresh
      const n = await writePool(category, m);
      if (n) {
        written++;
      } else {
        // It failed, so stop and stay quiet for a while rather than trying the
        // rest now and the whole lot again on the next refresh.
        await S.kvSet(POOL_RETRY_KEY, Date.now() + POOL_RETRY_AFTER_MS);
        break;
      }
      if (autoBudgetLeft() <= 0) break;
      // Only stop once the whole model chain is resting. A single capped model
      // just means the next request lands on a different one.
      if (isBackingOff()) break;
    }

    if (written) await S.kvSet(POOL_RETRY_KEY, 0);
    return written;
  }

  /** Drop every cached pool, e.g. after switching model or clearing the key. */
  async function clearPools() {
    const S = root.SageScheduler;
    if (!S) return 0;
    let cleared = 0;
    for (const category of Object.keys(CATEGORY_BRIEF)) {
      for (const mood of (S.MOODS || [])) {
        if (await S.readAiPool(category, mood)) cleared++;
        await S.kvSet(S.aiPoolKey(category, mood), null);
      }
    }
    return cleared;
  }

  // ══ HEALTH INSIGHT ═══════════════════════════════════════════════════
  // A weekly read on the bike's condition. The facts are computed here, from
  // data the app already has, so the card says something useful with no key and
  // no network. Sage's prose is layered on top only when she can speak.

  const INSIGHT_KEY = 'sage_health_insight';
  const INSIGHT_TTL_MS = 7 * 86400000;
  const UNUSUAL_COST_MULTIPLE = 1.8;

  function money(n) {
    const v = Math.round(Number(n) || 0);
    return `₹${v.toLocaleString('en-IN')}`;
  }

  function daysBetween(aIso, bIso) {
    const a = Date.parse(`${aIso}T00:00:00`);
    const b = Date.parse(`${bIso}T00:00:00`);
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  }

  /**
   * Everything measurable about the bike's upkeep. Pure, deterministic, no AI.
   * @returns {object|null} null only when there is nothing recorded at all
   */
  function healthFacts(options) {
    const opts = options || {};
    const now = opts.now || Date.now();
    const snapshot = opts.snapshot
      || ((typeof window !== 'undefined' && window.dkGetSnapshot) ? window.dkGetSnapshot() : null)
      || { all: [], services: [], maxOdo: 0, latest: null };

    const status = opts.status !== undefined
      ? opts.status
      : ((typeof window !== 'undefined' && window.sageServiceStatus) || null);

    const services = (snapshot.services || [])
      .filter(r => r && r.date)
      .slice()
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    if (!services.length && !(snapshot.all || []).length) return null;

    const costs = services.map(r => Number(r.cost) || 0).filter(c => c > 0);
    const totalSpend = costs.reduce((sum, c) => sum + c, 0);
    const avgCost = costs.length ? totalSpend / costs.length : 0;

    const todayIso = new Date(now).toISOString().slice(0, 10);
    const spendLast90 = services
      .filter(r => {
        const d = daysBetween(r.date, todayIso);
        return d !== null && d >= 0 && d <= 90;
      })
      .reduce((sum, r) => sum + (Number(r.cost) || 0), 0);

    const first = services[0] || null;
    const last = services[services.length - 1] || null;
    const spanDays = first && last ? daysBetween(first.date, last.date) : null;
    const daysSinceLastService = last ? daysBetween(last.date, todayIso) : null;

    // Average distance actually covered between services, which is the real
    // measure of whether the interval is being respected.
    const odoPoints = services.map(r => Number(r.odo) || 0).filter(o => o > 0);
    const avgKmBetweenServices = odoPoints.length >= 2
      ? Math.round((odoPoints[odoPoints.length - 1] - odoPoints[0]) / (odoPoints.length - 1))
      : null;

    const interval = root.SageScheduler?.SERVICE_INTERVAL_KM || null;
    let adherence = null;
    if (avgKmBetweenServices && interval) {
      const ratio = avgKmBetweenServices / interval;
      if (ratio <= 1.05) adherence = 'on schedule';
      else if (ratio <= 1.3) adherence = 'running a little late';
      else adherence = 'stretching the interval';
    }

    const servicesPerYear = spanDays && spanDays > 60
      ? Math.round((services.length / spanDays) * 365 * 10) / 10
      : null;

    // ── Overdue ──
    const overdue = [];
    if (status && status.kmRemaining !== null && status.kmRemaining < 0) {
      overdue.push({
        what: 'Service',
        detail: `about ${Math.abs(status.kmRemaining).toLocaleString('en-IN')}km past the interval`,
      });
    }
    if (last && last.next_due) {
      const left = daysBetween(todayIso, last.next_due);
      if (left !== null && left < 0) {
        overdue.push({ what: 'Service date', detail: `${Math.abs(left)} days past due` });
      }
    }

    // ── Upcoming ──
    const upcoming = [];
    if (last && last.next_due) {
      const left = daysBetween(todayIso, last.next_due);
      if (left !== null && left >= 0) {
        upcoming.push({ what: 'Next service', when: last.next_due, days: left });
      }
    }
    const covers = opts.coverDates || readCoverDates();
    covers.forEach(c => {
      const left = daysBetween(todayIso, c.expiry);
      if (left === null) return;
      if (left < 0) overdue.push({ what: c.label, detail: `expired ${Math.abs(left)} days ago` });
      else if (left <= 60) upcoming.push({ what: c.label, when: c.expiry, days: left });
    });
    upcoming.sort((a, b) => a.days - b.days);

    // ── Anything odd ──
    const unusual = [];
    if (avgCost > 0) {
      const pricey = services.filter(r => (Number(r.cost) || 0) > avgCost * UNUSUAL_COST_MULTIPLE);
      pricey.slice(-2).forEach(r => {
        unusual.push(`${r.date}: ${money(r.cost)}, well above your ${money(avgCost)} average`);
      });
    }
    if (avgKmBetweenServices && odoPoints.length >= 3) {
      const lastGap = odoPoints[odoPoints.length - 1] - odoPoints[odoPoints.length - 2];
      if (lastGap > avgKmBetweenServices * 1.5) {
        unusual.push(`the last gap was ${lastGap.toLocaleString('en-IN')}km, longer than your usual ${avgKmBetweenServices.toLocaleString('en-IN')}km`);
      }
    }
    if (daysSinceLastService !== null && daysSinceLastService > 240) {
      unusual.push(`${daysSinceLastService} days since anything was logged`);
    }

    // ── One-word verdict, used for the card's tone ──
    let verdict = 'steady';
    if (overdue.length) verdict = 'needs attention';
    else if (upcoming.some(u => u.days <= 7)) verdict = 'something due soon';
    else if (unusual.length) verdict = 'worth a look';

    return {
      generatedFor: todayIso,
      verdict,
      recordCount: (snapshot.all || []).length,
      serviceCount: services.length,
      spanDays,
      daysSinceLastService,
      lastServiceDate: last ? last.date : null,
      totalSpend: Math.round(totalSpend),
      avgCost: Math.round(avgCost),
      spendLast90: Math.round(spendLast90),
      servicesPerYear,
      avgKmBetweenServices,
      serviceIntervalKm: interval,
      adherence,
      estimatedOdoNow: status ? status.currentOdo : null,
      odoIsEstimate: status ? !!status.estimated : false,
      kmUntilService: status ? status.kmRemaining : null,
      overdue,
      upcoming: upcoming.slice(0, 4),
      unusual: unusual.slice(0, 3),
    };
  }

  const INSIGHT_BRIEF = [
    'This is your weekly report on your own condition, for your owner.',
    'Summarise it in two or three sentences, in your own voice.',
    'Lead with whatever actually matters most. Mention specific figures from the facts,',
    'but never invent any. If something is overdue, say so plainly.',
    'If everything is fine, be pleased about it rather than padding.',
  ].join(' ');

  /**
   * Sage's prose summary of the facts. Returns null when she cannot speak, which
   * is fine — the card renders the facts on their own.
   */
  async function writeInsightProse(facts, mood) {
    if (!facts) return null;
    if (!ready().ok) return null;
    const prompt = `Facts about you right now:\n${JSON.stringify(facts, null, 1)}\n\n${INSIGHT_BRIEF}`;
    const raw = await generate(prompt, {
      mood,
      temperature: 0.9,      // lower than her one-liners; this should be accurate
      maxOutputTokens: 220,
    });
    return tidyLine(raw);
  }

  /** The cached weekly insight, or null if missing or stale. */
  async function getHealthInsight(now) {
    const S = root.SageScheduler;
    if (!S) return null;
    const at = now || Date.now();
    const cached = await S.kvGet(INSIGHT_KEY, null);
    if (!cached || !cached.createdAt) return null;
    if (at - cached.createdAt > INSIGHT_TTL_MS) return null;
    return cached;
  }

  /**
   * Compute the facts, add prose if possible, cache the result.
   * Always returns something when there is any recorded data, key or not.
   */
  async function buildHealthInsight(options) {
    const opts = options || {};
    const S = root.SageScheduler;
    const at = opts.now || Date.now();

    if (!opts.force) {
      const cached = await getHealthInsight(at);
      if (cached) return cached;
    }

    const facts = healthFacts({ now: at, snapshot: opts.snapshot, status: opts.status });
    if (!facts) return null;

    let mood = opts.mood;
    if (!mood && S) {
      try { mood = S.moodAt(at, await S.getLimits()); } catch { mood = null; }
    }

    const prose = await writeInsightProse(facts, mood);
    const insight = { facts, prose, mood: mood || null, createdAt: at };

    if (S) await S.kvSet(INSIGHT_KEY, insight);
    console.log(`[SpinLog] ✅ Sage health insight: ${facts.verdict}${prose ? ' (with her own words)' : ' (facts only)'}`);
    return insight;
  }

  // ══ CHAT ═════════════════════════════════════════════════════════════

  const CHAT_MAX_TURNS = 12;   // how much of the conversation Gemini sees

  const CHAT_RULES = [
    'You are having a conversation, so you may be a little longer than a notification:',
    'up to three sentences when the question deserves it.',
    'Answer what was actually asked, using only the figures in your context.',
    'If you genuinely do not know something, say so in your own voice rather than guessing.',
    'Stay in character throughout. You are still the bike.',
  ].join(' ');

  /**
   * Answer a question from the rider, grounded in the bike's real state.
   * @param {string} question
   * @param {{history?: Array<{role:string, text:string}>, mood?: string}} options
   * @returns {Promise<{ok:boolean, text?:string, reason?:string}>}
   */
  async function askSage(question, options) {
    const opts = options || {};
    const asked = String(question || '').trim();
    if (!asked) return { ok: false, reason: 'empty' };

    const state = ready();
    if (!state.ok) return { ok: false, reason: state.reason, retryInMs: state.retryInMs };

    const S = root.SageScheduler;
    let mood = opts.mood;
    if (!mood && S) {
      try { mood = S.moodAt(Date.now(), await S.getLimits()); } catch { mood = null; }
    }

    const context = buildContext({ mood });
    const prompt = `${contextBlock(context)}\n\n${CHAT_RULES}\n\nHe says: ${asked}`;

    const text = await generate(prompt, {
      mood,
      history: (opts.history || []).slice(-CHAT_MAX_TURNS),
      temperature: 1.0,
      maxOutputTokens: 260,
      // You asked, so this is never rationed against the background allowance.
      purpose: 'chat',
    });

    if (!text) {
      // generate() only returns null for reasons ready() already names, or a
      // transient fault. Re-check so the UI can be specific.
      const after = ready();
      return { ok: false, reason: after.ok ? 'failed' : after.reason, retryInMs: after.retryInMs };
    }

    return { ok: true, text: tidyLine(text) || text.trim(), mood };
  }

  /** Is she able to speak for herself at this moment? */
  function ready() {
    if (!hasKey()) return { ok: false, reason: 'no-key' };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, reason: 'offline' };
    if (isBackingOff()) return { ok: false, reason: 'backoff', retryInMs: backoffRemainingMs() };
    return { ok: true };
  }

  root.SageAI = {
    DEFAULT_MODEL, API_BASE, MODEL_CHAIN, PERSONA, MOOD_DIRECTION,
    getKey, hasKey, setKey, clearKey, maskKey,
    // key ring
    getKeys, addKey, removeKey, keyId, availableKeys, keyResting,
    noteKeyLimited, noteKeyRejected, clearKeyBackoff, keyRestRemainingMs,
    getModel, setModel, setKnownModels, getKnownModels,
    MODEL_CHAIN_FLOOR: MIN_FLASH_GENERATION, isFlashModel, isChainWorthy,
    validateKey, preferredModels,
    // per-model backoff
    MAX_MODELS_PER_CALL, TIMEOUT_REST_MS,
    modelChain, availableModels, modelResting,
    BACKOFF_VERSION, OVERLOAD_REST_MS,
    noteModelLimited, noteModelTimeout, noteModelOverloaded, noteModelUnavailable,
    clearModelBackoff, clearQuotaBackoff,
    isBackingOff, backoffRemainingMs, noteRateLimited, clearBackoff, readBackoff,
    // voice
    personaFor, buildContext, contextBlock, generate, say, tidyLine, ready,
    // daily budget
    DAILY_AUTO_BUDGET, autoBudgetLeft, requestsToday,
    // line pools
    POOL_SIZE, POOL_TOKENS, CATEGORY_BRIEF, MOOD_TITLES, MAX_BODY_LENGTH,
    validatePoolLines, poolPrompt, writePool, refreshPools, clearPools,
    // chat
    CHAT_MAX_TURNS, askSage,
    // health insight
    INSIGHT_KEY, INSIGHT_TTL_MS,
    healthFacts, writeInsightProse, getHealthInsight, buildHealthInsight,
  };
})(typeof self !== 'undefined' ? self : this);
