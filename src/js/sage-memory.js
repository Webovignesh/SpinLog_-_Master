// ════════════════════════════════════════════════════════════════════════
// SPINLOG — SAGE MEMORY
//
// What Sage knows about Viky, and where it lives.
//
// ── Why this is not simply a Supabase call ───────────────────────────
// Her memory is read while a system instruction is being assembled, inside a
// synchronous function, on a path that also runs under the service worker.
// personaFor() in sage-ai.js, renderMemory() in sage-ui.js and the memory
// handlers in sage-tools.js all read it without awaiting anything. Turning
// those async would mean touching every call site and putting a network round
// trip in front of every reply she writes.
//
// So the shape is a local mirror in front of a cloud bank:
//
//   localStorage  the synchronous read path, and the whole thing offline
//   Supabase      the durable copy, so her memory follows the account
//                 rather than the browser
//
// Every read is local and instant. Every write lands locally first, marks the
// record dirty, and is pushed in the background. A pull merges by revision.
// If the table has not been created yet, or the device is offline, or there is
// no Supabase client at all, she behaves exactly as she did when this was
// localStorage only — which is the same bargain dkCoverStore strikes for cover
// dates. See supabase/sage_memory.sql.
//
// ── What "advanced" means here ───────────────────────────────────────
//   · per-kind decay        who his brother is should not fade like a mood
//   · retrieval, not top-N  the prompt gets facts relevant to what he asked
//   · topics                so related things are recalled together
//   · pinning               some things must never be outranked
//   · expiry                a plan for "next weekend" stops being current
//   · supersede             a corrected fact replaces the wrong one instead
//                          of sitting next to it contradicting it
//   · episodes             a free timeline of conversations, no quota spent
//   · soft delete          forgetting propagates to his other devices
// ════════════════════════════════════════════════════════════════════════

(function (root) {
  'use strict';

  const STORAGE = 'sage_memory';
  const VERSION = 2;
  const DEVICE_STORAGE = 'sage_device_id';

  // The table this migration creates. The fallback is the name the Supabase
  // Table Editor gives a table typed in as "Sage Memory" — quoted, spaced and
  // capitalised. sage_memory.sql renames it, but she should still find her
  // memory if that has not been run yet.
  const TABLE = 'sage_memory';
  const TABLE_FALLBACK = 'Sage Memory';

  // ── Sizing ───────────────────────────────────────────────────────────
  // Sixty was a localStorage budget. The bank is not on the device any more,
  // so the only real limit is what is worth keeping, and pruning at 60 was
  // throwing away things he had told her once and meant.
  const MAX_FACTS = 240;
  // How many reach any one prompt. Retrieval decides which.
  const FACTS_IN_PROMPT = 18;

  // A fact is never deleted for being old, only outranked when the bank is
  // full. How fast it slides depends on what sort of thing it is: a mood
  // passes in a week, who someone's brother is does not.
  const HALF_LIFE_DAYS = {
    feeling: 10,
    plan: 30,
    ride: 30,
    fact: 45,
    preference: 120,
    person: 180,
    promise: 240,
  };
  const DEFAULT_HALF_LIFE_DAYS = 45;

  // How much a kind matters, independent of age.
  const KIND_WEIGHT = {
    promise: 1.5, plan: 1.35, person: 1.2, preference: 1.15,
    fact: 1, feeling: 0.95, ride: 0.9,
  };

  // Recap: only worth writing once a real amount has scrolled past.
  const RECAP_AFTER_TURNS = 16;
  const RECAP_MIN_GAP_MS = 60 * 60000;
  const RECAP_MAX_CHARS = 900;

  // Episodes. A conversation is considered over after this much silence, which
  // is the same threshold the relationship counters already used.
  const EPISODE_GAP_MS = 30 * 60000;
  const MAX_EPISODES = 40;
  const EPISODES_IN_PROMPT = 3;

  // A plan with no date in it goes stale on its own. Better than her asking
  // in March how last October's trip went.
  const PLAN_TTL_DAYS = 21;

  // ── Sync pacing ──────────────────────────────────────────────────────
  // Writes are batched: several facts learned in one reply become one request.
  const PUSH_DEBOUNCE_MS = 1500;
  const PULL_STALE_MS = 5 * 60000;
  const SYNC_MIN_GAP_MS = 8000;
  // The client is created inside script.js's DOMContentLoaded, and this file
  // runs before it. Rather than guess, wait for it.
  const CLIENT_WAIT_TRIES = 40;
  const CLIENT_WAIT_GAP_MS = 250;

  const STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'is', 'was', 'are', 'were', 'be',
    'been', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'his', 'her', 'him',
    'he', 'she', 'it', 'its', 'that', 'this', 'these', 'those', 'i', 'you',
    'my', 'me', 'we', 'they', 'them', 'as', 'by', 'from', 'has', 'have', 'had',
    'do', 'does', 'did', 'so', 'if', 'then', 'than', 'about', 'very', 'just',
  ]);

  const KINDS = ['plan', 'feeling', 'person', 'preference', 'promise', 'ride', 'fact'];
  // The kinds of row that are HERS, and now also the filter that separates them
  // from the rest of the table. sage_memory holds park spots, chat messages and
  // app settings too (see cloud-store.js), and none of those are hers to count or
  // to forget — where he parked is not something she knows about him.
  const RECORD_TYPES = ['fact', 'recap', 'relationship', 'episode'];
  // The three of those that are a record OF the talking rather than something she
  // learned from it. `relationship` counts his messages and their conversations,
  // `episode` is when they talked and for how long, `recap` summarises messages
  // that have scrolled out of her window. Delete the conversation and all three
  // describe something that no longer exists — a `fact` does not.
  const CONVERSATION_TYPES = ['recap', 'relationship', 'episode'];

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, Number(n)));
  }

  function nowMs() {
    return Date.now();
  }

  function iso(ms) {
    if (!ms) return null;
    const d = new Date(Number(ms));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  function ms(isoString) {
    if (!isoString) return null;
    const t = new Date(isoString).getTime();
    return Number.isNaN(t) ? null : t;
  }

  /** Stable per-device id, so a row records which device last wrote it. */
  function deviceId() {
    try {
      let id = localStorage.getItem(DEVICE_STORAGE);
      if (!id) {
        id = `d${nowMs().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        localStorage.setItem(DEVICE_STORAGE, id);
      }
      return id;
    } catch {
      return 'unknown';
    }
  }

  // ══ STORE ════════════════════════════════════════════════════════════

  function blank() {
    return {
      v: VERSION,
      facts: [],
      recap: null,          // { text, throughTurns, at, rev, dirty }
      episodes: [],         // newest last
      rel: {
        firstSeenAt: null,  // first time she was ever spoken to
        lastTalkedAt: null,
        conversations: 0,   // sessions, not messages
        messages: 0,        // his messages only
        longestGapDays: 0,
        rev: 1,
        dirty: false,
      },
      // Hard deletes waiting to reach the server. A soft delete rides along on
      // the record itself; this is only for "forget everything".
      tombstones: [],
      sync: {
        lastPullAt: null,
        lastPushAt: null,
        lastError: null,
        table: null,        // which name was found to work
        pulled: 0,
        pushed: 0,
        lastPruneAt: null,  // when the server last cleared long-archived rows
      },
    };
  }

  function blankFact() {
    return {
      id: '', text: '', kind: 'fact', topic: 'general',
      at: 0, lastSeenAt: 0, hits: 0,
      weight: 1, confidence: 1, pinned: false, source: 'chat',
      expiresAt: null, supersededBy: null, archivedAt: null,
      rev: 1, dirty: false,
    };
  }

  // Parsing the whole bank on every read was affordable at 60 facts and is not
  // at 240, and promptBlock/facts/count are called several times per reply.
  // Invalidated by our own writes and by another tab writing.
  let cached = null;

  function normaliseFact(raw) {
    const base = blankFact();
    if (!raw || !raw.text) return null;
    const at = Number(raw.at) || Number(raw.lastSeenAt) || nowMs();
    return {
      ...base,
      ...raw,
      id: String(raw.id || `m${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`),
      text: String(raw.text),
      kind: KINDS.indexOf(raw.kind) !== -1 ? raw.kind : classify(raw.text),
      topic: raw.topic || topicOf(raw.text),
      at,
      lastSeenAt: Number(raw.lastSeenAt) || at,
      hits: Number(raw.hits) || 0,
      weight: Number.isFinite(Number(raw.weight)) ? Number(raw.weight) : 1,
      confidence: Number.isFinite(Number(raw.confidence)) ? clamp(raw.confidence, 0, 1) : 1,
      pinned: !!raw.pinned,
      rev: Number(raw.rev) || 1,
      dirty: !!raw.dirty,
    };
  }

  /**
   * Bring a v1 bank forward. v1 had facts, a recap and counters, all of which
   * still mean the same thing — so unlike the v0→v1 step this migrates rather
   * than discards. Everything arrives dirty, which is what uploads a memory
   * built up on the device before the table existed.
   */
  function migrate(raw) {
    const state = blank();
    if (!raw || typeof raw !== 'object') return state;

    state.facts = (Array.isArray(raw.facts) ? raw.facts : [])
      .map(f => {
        const fact = normaliseFact(f);
        if (fact) fact.dirty = true;
        return fact;
      })
      .filter(Boolean);

    if (raw.recap && raw.recap.text) {
      state.recap = { ...raw.recap, rev: 1, dirty: true };
    }
    if (raw.rel && typeof raw.rel === 'object') {
      state.rel = { ...state.rel, ...raw.rel, rev: 1, dirty: true };
    }
    console.log(`[SpinLog] 🧠 Sage's memory upgraded to v${VERSION} — ${state.facts.length} facts ready to sync.`);
    return state;
  }

  function read() {
    if (cached) return cached;
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(STORAGE) || 'null');
    } catch {
      raw = null;
    }

    if (!raw) {
      cached = blank();
      return cached;
    }
    if (raw.v !== VERSION) {
      cached = migrate(raw);
      write(cached);
      return cached;
    }

    const base = blank();
    cached = {
      v: VERSION,
      facts: (Array.isArray(raw.facts) ? raw.facts : []).map(normaliseFact).filter(Boolean),
      recap: raw.recap && raw.recap.text ? { rev: 1, dirty: false, ...raw.recap } : null,
      episodes: Array.isArray(raw.episodes) ? raw.episodes.filter(e => e && e.id) : [],
      rel: { ...base.rel, ...(raw.rel || {}) },
      tombstones: Array.isArray(raw.tombstones) ? raw.tombstones.slice(0, 500) : [],
      sync: { ...base.sync, ...(raw.sync || {}) },
    };
    return cached;
  }

  function write(state) {
    cached = state;
    try {
      localStorage.setItem(STORAGE, JSON.stringify({ ...state, v: VERSION }));
      return true;
    } catch {
      // Quota. Her memory is not worth failing a conversation over — and the
      // cloud copy is the durable one now, so this is a cache miss rather than
      // a loss.
      return false;
    }
  }

  /** Persist, tell anyone listening, and get the change moving to the server. */
  function commit(state, options) {
    const opts = options || {};
    write(state);
    notify(opts.reason || 'change');
    if (opts.push !== false) schedulePush();
    return state;
  }

  // ── Listeners, so the settings panel can repaint after a sync ────────
  const listeners = new Set();

  function onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function notify(reason) {
    listeners.forEach(fn => {
      try { fn(reason); } catch { /* a bad listener must not break a write */ }
    });
  }

  // Another tab editing her memory should not leave this one showing a stale
  // list, and the settings panel is exactly where that would be noticed.
  if (root.addEventListener) {
    root.addEventListener('storage', ev => {
      if (ev && ev.key === STORAGE) {
        cached = null;
        notify('external');
      }
    });
  }

  // ══ TEXT ═════════════════════════════════════════════════════════════

  /** Loose fingerprint, so "he rides to work" and "He rides to work." collide. */
  function fingerprint(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, '')
      .replace(/\b(the|a|an|his|her|to|is|was|of|and|that|he|she|it)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokens(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2 && !STOPWORDS.has(t));
  }

  /**
   * Crude suffix stripping, so "serviced", "servicing" and "services" all meet
   * somewhere near "servic".
   *
   * A proper stemmer is not worth the weight here, but *some* stemming is: a
   * plain prefix comparison cannot bridge "serviced" and "servicing" — they part
   * company at the eighth character — so asking "where should I get her
   * serviced" scored a cost figure above the note naming the workshop he likes.
   */
  function stem(word) {
    const w = String(word || '');
    if (w.length <= 4) return w;
    if (/ies$/.test(w)) return `${w.slice(0, -3)}y`;
    if (/(ing|ed)$/.test(w)) {
      const base = w.replace(/(ing|ed)$/, '');
      return base.length >= 3 ? base : w;
    }
    if (/(es|ly)$/.test(w)) return w.slice(0, -2);
    if (/s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
    return w;
  }

  /** Guess what sort of note this is, purely to order the prompt sensibly. */
  function classify(text) {
    const t = String(text || '').toLowerCase();
    if (/\b(promis\w*|said he would|swore|agreed to)\b/.test(t)) return 'promise';
    // Anything pointing at the future. "next weekend" is why this needs
    // `next \w+` rather than a list of periods — \bweek\b does not match
    // "weekend", so the obvious spelling silently missed.
    if (/\b(will|going to|gonna|plans?|planning|next \w+|tomorrow|tonight|weekend|booked|booking|schedul\w*|trip|heading)\b/.test(t)) return 'plan';
    if (/\b(loves?|loved|hates?|hated|likes?|liked|prefers?|favourite|favorite|can'?t stand|enjoys?)\b/.test(t)) return 'preference';
    // "riding" is the common form and is not caught by \bride\b.
    if (/\b(rode|ride|rides|riding|ridden|km|kms|highway|route|took me|ran me)\b/.test(t)) return 'ride';
    if (/\b(friend|brother|sister|dad|mum|mom|father|mother|wife|girlfriend|colleague|cousin|son|daughter)\b/.test(t)) return 'person';
    if (/\b(sad|happy|tired|stressed|angry|excited|worried|lonely|proud|upset|nervous)\b/.test(t)) return 'feeling';
    return 'fact';
  }

  /**
   * What the note is *about*, which is a different question from what sort of
   * note it is. "he is taking her to the workshop saturday" is a plan, and its
   * topic is service — and when he later asks about servicing, that is the one
   * worth recalling.
   */
  const TOPIC_RULES = [
    ['service', /\b(service|serviced|servicing|oil|chain|brake|tyre|tire|coolant|spark|filter|clutch|workshop|mechanic|garage|showroom|odo|odometer)\b/],
    ['papers', /\b(insurance|policy|rc\b|registration|puc|pollution|licence|license|document|papers?|noc|warranty|fine|challan)\b/],
    ['money', /\b(cost|costs|spent|spend|spending|price|paid|rupees?|\brs\b|₹|budget|cheap|expensive|emi|loan|savings?)\b/],
    ['riding', /\b(rode|ride|rides|riding|ridden|km|kms|highway|route|trip|road|traffic|commute|pillion|touring|fuel|petrol|mileage)\b/],
    ['people', /\b(friend|brother|sister|dad|mum|mom|father|mother|wife|girlfriend|colleague|cousin|son|daughter|family|neighbour|neighbor)\b/],
    ['work', /\b(work|office|job|shift|college|exam|class|study|studies|boss|project|deadline|interview|salary)\b/],
    ['bike', /\b(duke|ktm|engine|sound|exhaust|mod|mods|modification|accessor\w*|helmet|gear|paint|sticker|seat|tank|suspension)\b/],
    ['feelings', /\b(sad|happy|tired|stressed|angry|excited|worried|lonely|proud|upset|nervous|love|loves|miss|missing)\b/],
    ['health', /\b(ill|sick|fever|injur\w*|hospital|doctor|accident|crash|fell|hurt)\b/],
  ];

  function topicOf(text) {
    const t = String(text || '').toLowerCase();
    for (const [topic, pattern] of TOPIC_RULES) {
      if (pattern.test(t)) return topic;
    }
    return 'general';
  }

  /**
   * When a forward-looking note stops being current.
   * Returns null for anything that is not time-bound, which is most things.
   */
  function horizonFor(text, kind, now) {
    if (kind !== 'plan' && kind !== 'promise') return null;
    const t = String(text || '').toLowerCase();
    const at = now || nowMs();
    const day = 86400000;

    // An explicit date beats every guess below.
    const explicit = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (explicit) {
      const when = new Date(`${explicit[1]}-${explicit[2]}-${explicit[3]}T00:00:00`).getTime();
      if (!Number.isNaN(when)) return when + 2 * day;
    }

    const dayIn = phrase => {
      if (/\b(today|tonight|tomorrow)\b/.test(phrase)) return at + 2 * day;
      if (/\bweekend\b/.test(phrase)) return at + 9 * day;
      if (/\bnext week\b/.test(phrase)) return at + 16 * day;
      if (/\bnext month\b/.test(phrase)) return at + 45 * day;
      if (/\bnext year\b/.test(phrase)) return at + 400 * day;
      return null;
    };

    let found = dayIn(t);

    // Then the same patterns against the Thanglish, expanded.
    //
    // This has to happen because a note can be stored in HIS words — glean() keeps
    // his message verbatim when she did not write anything down herself. "naalaiku
    // munnar polam" has a day in it that none of the patterns above can see, so the
    // plan took the default six-week horizon: it would not have expired when the
    // ride did, it would not have matched another note about the same day, and
    // sameOccasion() compared it against a plan for tomorrow and saw two different
    // days. That is how one ride became two rows again.
    //
    // Second rather than first, and only when the English pass found nothing:
    // plainWords() is a long chain of replaces and this runs once per candidate
    // fact inside sameOccasion().
    if (found === null) found = dayIn(plainWords(t));
    if (found !== null) return found;

    // A promise with no horizon is open-ended and should not expire.
    if (kind === 'promise') return null;
    return at + PLAN_TTL_DAYS * day;
  }

  // ══ SCORING ══════════════════════════════════════════════════════════

  /**
   * How much a fact deserves its place. Newer, more-referenced, more important
   * and more confident facts outrank older untouched ones; pinned facts outrank
   * everything, which is the whole point of pinning.
   */
  function score(fact, now) {
    const at = now || nowMs();
    const ageDays = Math.max(0, (at - (fact.lastSeenAt || fact.at || at)) / 86400000);
    const halfLife = HALF_LIFE_DAYS[fact.kind] || DEFAULT_HALF_LIFE_DAYS;
    const freshness = Math.pow(0.5, ageDays / halfLife);
    const kindWeight = KIND_WEIGHT[fact.kind] || 1;
    const referenced = 1 + Math.min(6, fact.hits || 0) * 0.14;
    // A fact she is unsure of still counts, just less.
    const confidence = 0.4 + 0.6 * clamp(fact.confidence ?? 1, 0, 1);
    const base = freshness * kindWeight * referenced * confidence * (fact.weight || 1);
    // Additive rather than multiplicative so pinned facts still sort sensibly
    // against each other.
    return fact.pinned ? base + 1000 : base;
  }

  /**
   * How well a fact answers the thing he just asked. Roughly 0..1.25.
   *
   * Three tiers, deliberately: the exact word he used is worth most, the same
   * word in another form nearly as much, and a shared prefix a little. Anything
   * looser than that starts matching everything.
   */
  function relevance(fact, queryTokens, queryTopic) {
    if (!queryTokens || !queryTokens.length) return 0;
    const factTokens = tokens(fact.text);
    if (!factTokens.length) return 0;
    const have = new Set(factTokens);
    const haveStems = new Set(factTokens.map(stem));

    let hit = 0;
    for (const q of queryTokens) {
      if (have.has(q)) { hit += 1; continue; }
      const qs = stem(q);
      if (haveStems.has(qs)) { hit += 0.85; continue; }
      for (const f of haveStems) {
        if (f.length > 3 && qs.length > 3 && (f.startsWith(qs) || qs.startsWith(f))) { hit += 0.6; break; }
      }
    }

    let out = hit / queryTokens.length;
    // Being about the same subject counts for something even when no word matches.
    if (queryTopic && queryTopic !== 'general' && fact.topic === queryTopic) out += 0.25;
    return out;
  }

  /** Jaccard overlap, used to spot a restatement or a contradiction. */
  function overlap(a, b) {
    const A = new Set(tokens(a));
    const B = new Set(tokens(b));
    if (!A.size || !B.size) return 0;
    let shared = 0;
    A.forEach(t => { if (B.has(t)) shared += 1; });
    return shared / (A.size + B.size - shared);
  }

  const NEGATION = /\b(not|never|no longer|stopped|doesn'?t|does not|isn'?t|is not|won'?t|cancelled|canceled)\b/;

  function figures(text) {
    return (String(text || '').match(/\d+(?:[.,]\d+)?/g) || []).join('|');
  }

  /**
   * Jaccard overlap over the WORDS, ignoring any figures.
   *
   * Used only by contradicts(), and the distinction is the whole point. A changed
   * number is the *signal* that two notes disagree, so letting it also count as
   * evidence that they are about different subjects is backwards.
   *
   * It had a real cost: "the service is due at 12000 km" against "…at 14000 km"
   * shares only `service` and `due` out of four tokens once 12000 and 14000 are
   * counted as content, which scores 0.5 and falls under the 0.55 threshold. So
   * the correction was filed as a second, separate memory and she held two
   * different answers to one question — which is the same complaint as two notes
   * for one plan, wearing a different hat.
   */
  function overlapWords(a, b) {
    const isWord = t => !/^\d/.test(t);
    const A = new Set(tokens(a).filter(isWord).map(stem));
    const B = new Set(tokens(b).filter(isWord).map(stem));
    if (!A.size || !B.size) return 0;
    let shared = 0;
    A.forEach(t => { if (B.has(t)) shared += 1; });
    return shared / (A.size + B.size - shared);
  }

  /**
   * Is `fresh` a correction of `old` rather than a separate thing?
   *
   * Deliberately strict. Wrongly deciding two facts contradict each other
   * silently loses one of them, which is worse than keeping a near-duplicate
   * that only costs a line of prompt. So it wants the same subject, heavy word
   * overlap, and a concrete signal that they disagree: a different number or
   * date, or one of them being a negation of the other.
   */
  function contradicts(old, freshText) {
    if (overlapWords(old.text, freshText) < 0.55) return false;
    if (old.topic !== topicOf(freshText)) return false;

    const numbersDiffer = figures(old.text) !== figures(freshText)
      && (figures(old.text) || figures(freshText));
    const negationFlipped = NEGATION.test(old.text) !== NEGATION.test(freshText);
    return !!(numbersDiffer || negationFlipped);
  }

  // She writes the same note as "Viky is planning…" one minute and "he is
  // planning…" the next. The pronouns are already stopwords; his name is not, and
  // without this a rewording that only swaps the two looks like a different
  // subject. Hardcoded in the same spirit as the registration and purchase date.
  const OWNER_TOKENS = new Set(['viky', 'vicky', 'viki']);

  /** Content words, with his name and grammar removed and the rest stemmed. */
  function subjectTokens(text) {
    return new Set(tokens(text).filter(t => !OWNER_TOKENS.has(t)).map(stem));
  }

  /**
   * Is `fresh` the same note as `old` with more detail in it?
   *
   * This is a third relationship, and missing it is why she ended up holding two
   * memories for one plan:
   *
   *   "Viky is planning a ride next week"
   *   "He is planning a ride to Valparai next week."
   *
   * They are not duplicates — the fingerprints differ, because one names the
   * destination. They do not contradict either: no figure changed and neither is
   * a negation, so contradicts() correctly says no. They are the same plan, told
   * twice, the second time properly. Keeping both means she answers "what am I
   * doing next week" with two lines that are one thing.
   *
   * The test is deliberately a STRICT SUPERSET, because the cost of getting this
   * wrong is silently losing a note. Every content word of the old one must still
   * be in the new one, and the new one must add at least one of its own. So
   * "a ride to Valparai next week" absorbs "a ride next week", while "rides to
   * work every day" and "rides to college every day" are left alone — neither
   * contains the other, and merging them would throw away a real difference.
   *
   * The horizon has to agree too, recomputed against one clock so the comparison
   * is of the words rather than of when each note happened to be written.
   * Otherwise "a ride next week" would swallow "a ride next month".
   */
  function refines(old, freshText, kind, now) {
    if (!old || old.pinned) return false;
    // Same sort of note, about the same thing. A plan is not a refinement of a
    // preference however much vocabulary they share.
    if (old.kind !== kind) return false;
    if (old.topic !== topicOf(freshText)) return false;

    const before = subjectTokens(old.text);
    const after = subjectTokens(freshText);
    // Two content words is not enough to be sure of anything.
    if (before.size < 2 || after.size <= before.size) return false;

    for (const word of before) {
      if (!after.has(word)) return false;
    }

    // Same time phrase, or neither has one.
    const at = now || nowMs();
    return horizonFor(old.text, old.kind, at) === horizonFor(freshText, kind, at);
  }

  // The words a plan is made of that do not say WHICH plan it is. Every one of
  // these can be swapped for another without changing the arrangement: going,
  // riding, heading and taking a trip are the same act, and the day is already
  // compared separately and exactly.
  //
  // Stemmed at load rather than written pre-stemmed, because stem() is not
  // obvious about it — "going" stays "going" (dropping -ing would leave two
  // letters) while "riding" becomes "rid", and a hand-written list would rot the
  // first time that rule changed.
  const OCCASION_FILLER = new Set([
    'today', 'tonight', 'tomorrow', 'morning', 'afternoon', 'evening', 'night',
    'day', 'days', 'weekend', 'week', 'weeks', 'month', 'months', 'year', 'years',
    'next', 'later', 'soon', 'early', 'late',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'want', 'wants', 'wanted', 'plan', 'plans', 'planning', 'planned',
    'go', 'goes', 'going', 'went', 'ride', 'rides', 'riding', 'rode',
    'take', 'takes', 'taking', 'visit', 'visits', 'visiting', 'head', 'heading',
    'leave', 'leaving', 'travel', 'travels', 'travelling', 'traveling',
    'trip', 'trips', 'come', 'comes', 'coming', 'get', 'gets', 'getting',
    'meet', 'meets', 'meeting', 'start', 'starts', 'starting', 'out', 'off',
    'will', 'gonna', 'thinking', 'hoping', 'needs', 'need', 'said', 'told',
    // Agreeing is not a subject. "super do naalaiku polam" is him saying yes to a
    // ride she already has written down, and counting "super" as the thing the
    // note is about made it look like a different plan.
    'super', 'ok', 'okay', 'sure', 'fine', 'nice', 'cool', 'good', 'great',
    'done', 'yes', 'yeah', 'yep', 'seri', 'sari', 'correct', 'perfect', 'thanks',
  ].map(stem));

  /** What a note is ABOUT: its content words, minus the interchangeable ones. */
  function occasionTokens(text) {
    const out = new Set();
    subjectTokens(text).forEach(t => { if (!OCCASION_FILLER.has(t)) out.add(t); });
    return out;
  }

  /**
   * Are these two notes the same occasion, described differently?
   *
   * refines() only catches the new wording being a SUPERSET of the old, which is
   * the "filled in a detail" case. This is the other one, and it is the one that
   * actually happened:
   *
   *   "He wants to go to Munnar tomorrow."        written by the remember control
   *   "he is planning a ride to munnar tomorrow"  written by the sentinel
   *
   * One ride. Two rows. They share no phrasing beyond the destination and the day,
   * so the fingerprint differs, refines() bails on the word count (equal sizes,
   * and "wants"/"go" are missing from the second), and nothing else was looking.
   *
   * She has three ways to write a note down and will keep finding new words for
   * the same thing, so this compares what the note is ABOUT rather than how it is
   * worded: the same day, exactly, and the same subject once the interchangeable
   * verbs are taken out.
   *
   * Only for the dated kinds. Two preferences that share a noun are not one
   * preference, and there is no day to anchor them against.
   */
  function sameOccasion(old, freshText, kind, now) {
    if (!old || old.pinned) return false;
    if (old.kind !== kind) return false;
    if (kind !== 'plan' && kind !== 'promise') return false;

    const at = now || nowMs();
    // The time PHRASE, recomputed for both, not the stored expiry — a note made
    // yesterday about "tomorrow" has an expiry a day behind one made just now.
    // A plan for tomorrow and a plan for next month are two plans however alike
    // they read.
    if (horizonFor(old.text, old.kind, at) !== horizonFor(freshText, kind, at)) return false;

    const before = occasionTokens(old.text);
    const after = occasionTokens(freshText);
    // Neither names anything in particular: one vague plan for one day, twice.
    if (!before.size && !after.size) return true;
    // One names a thing and the other does not, so they are not the same thing.
    // "he is going out tomorrow" is not "he is working tomorrow".
    if (!before.size || !after.size) return false;

    // The smaller set has to sit entirely inside the larger. Equal sets are the
    // duplicate; a subset is the same plan with more detail on it. Anything else
    // is a different subject on the same day — munnar is not ooty.
    const [small, large] = before.size <= after.size ? [before, after] : [after, before];
    for (const word of small) {
      if (!large.has(word)) return false;
    }
    return true;
  }

  // ══ FACTS ════════════════════════════════════════════════════════════

  function liveFacts(state, now) {
    const at = now || nowMs();
    return state.facts.filter(f =>
      !f.archivedAt && !f.supersededBy && !(f.expiresAt && f.expiresAt < at));
  }

  /**
   * Archive anything that has quietly stopped being true — an expired plan.
   * Cheap, but not free, so it runs at most once a minute.
   */
  // A note she wrote moments ago is not something he has brought up twice.
  //
  // `hits` is meant to count him raising a thing again, and the memory panel shows
  // it as "mentioned N×". But she has three ways to write a note down and uses two
  // of them on one plan inside a single turn — the control while she is answering,
  // the sentinel underneath it — so the merge bumped the count and every brand new
  // plan appeared as "mentioned 2×" the instant it was created. A real second
  // mention comes later than this.
  const SAME_BREATH_MS = 5 * 60000;

  /** Is this him raising it again, rather than her writing it down twice? */
  function isFreshMention(fact, now) {
    return (now - (fact.at || 0)) > SAME_BREATH_MS;
  }

  let lastSweepAt = 0;

  function sweep(options) {
    const opts = options || {};
    const at = opts.now || nowMs();
    if (!opts.force && at - lastSweepAt < 60000) return 0;
    lastSweepAt = at;

    const state = read();
    let changed = 0;
    state.facts.forEach(f => {
      if (f.archivedAt || f.pinned) return;
      if (f.expiresAt && f.expiresAt < at) {
        f.archivedAt = at;
        f.rev = (f.rev || 1) + 1;
        f.dirty = true;
        changed += 1;
      }
    });

    if (changed) {
      console.log(`[SpinLog] 🧠 ${changed} of Sage's notes have gone out of date.`);
      commit(state, { reason: 'sweep' });
    }
    return changed;
  }

  /**
   * Keep one thing she has learned.
   *
   * Re-stating something she already knows refreshes it rather than duplicating
   * it, which is also how a fact earns its place in the prompt. Correcting
   * something supersedes the old version rather than sitting beside it.
   *
   * @param {string} text
   * @param {{kind?:string, topic?:string, source?:string, pinned?:boolean,
   *          confidence?:number, weight?:number, expiresAt?:number, now?:number}} [options]
   * @returns {{ok:boolean, id?:string, reason?:string, replaced?:string}}
   */
  function remember(text, options) {
    const opts = options || {};
    const clean = String(text || '')
      .replace(/\s+/g, ' ')
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
      .trim();

    if (clean.length < 4) return { ok: false, reason: 'empty' };
    // A whole paragraph is not a memory, it is a transcript.
    if (clean.length > 260) return { ok: false, reason: 'too-long' };

    const now = opts.now || nowMs();
    const state = read();
    const print = fingerprint(clean);
    if (!print) return { ok: false, reason: 'empty' };

    // Already known, word for word or close enough.
    const existing = state.facts.find(f =>
      !f.archivedAt && fingerprint(f.text) === print);
    if (existing) {
      existing.lastSeenAt = now;
      if (isFreshMention(existing, now)) existing.hits = (existing.hits || 0) + 1;
      // Prefer the longer phrasing; it usually carries more detail.
      if (clean.length > existing.text.length) existing.text = clean;
      if (opts.pinned) existing.pinned = true;
      existing.confidence = clamp(Math.max(existing.confidence ?? 1, opts.confidence ?? 1), 0, 1);
      existing.rev = (existing.rev || 1) + 1;
      existing.dirty = true;
      commit(state, { reason: 'refresh' });
      return { ok: true, id: existing.id, reason: 'refreshed' };
    }

    const kind = KINDS.indexOf(opts.kind) !== -1 ? opts.kind : classify(clean);

    // The same note, told again with more in it. Revised IN PLACE rather than
    // added and the old one archived: it keeps the note's id, its age and how
    // often it has come up, and it means one row changes instead of one row being
    // created and another retired — which is what "two memories for one thing"
    // looked like from the outside.
    const fuller = liveFacts(state, now).find(f => refines(f, clean, kind, now));
    if (fuller) {
      const was = fuller.text;
      fuller.text = clean;
      fuller.kind = kind;
      fuller.topic = opts.topic || topicOf(clean);
      fuller.lastSeenAt = now;
      if (isFreshMention(fuller, now)) fuller.hits = (fuller.hits || 0) + 1;
      fuller.expiresAt = opts.expiresAt !== undefined
        ? opts.expiresAt
        : horizonFor(clean, kind, now);
      if (opts.pinned) fuller.pinned = true;
      fuller.confidence = clamp(Math.max(fuller.confidence ?? 1, opts.confidence ?? 1), 0, 1);
      fuller.rev = (fuller.rev || 1) + 1;
      fuller.dirty = true;
      commit(state, { reason: 'refine' });
      console.log(`[SpinLog] 🧠 Sage filled in a note: "${was}" → "${clean}"`);
      return { ok: true, id: fuller.id, reason: 'refined', was };
    }

    // The same occasion under different words. Refreshed rather than added, so one
    // ride stays one row — see sameOccasion() for why refines() above cannot catch
    // this and what it looked like when nothing did.
    const already = liveFacts(state, now).find(f => sameOccasion(f, clean, kind, now));
    if (already) {
      already.lastSeenAt = now;
      if (isFreshMention(already, now)) already.hits = (already.hits || 0) + 1;
      // The longer phrasing usually carries more detail, same as the exact-match
      // path above.
      if (clean.length > already.text.length) already.text = clean;
      // The control writes a note without a topic; the sentinel's version had one.
      // Whichever arrives second should not throw the other's away.
      if (!already.topic) already.topic = opts.topic || topicOf(clean);
      if (opts.pinned) already.pinned = true;
      already.expiresAt = opts.expiresAt !== undefined
        ? opts.expiresAt
        : horizonFor(already.text, already.kind, now);
      already.rev = (already.rev || 1) + 1;
      already.dirty = true;
      commit(state, { reason: 'same-occasion' });
      console.log(`[SpinLog] 🧠 Already noted — not a second row: "${already.text}"`);
      return { ok: true, id: already.id, reason: 'refreshed' };
    }

    const fact = {
      ...blankFact(),
      id: `m${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      text: clean,
      kind,
      topic: opts.topic || topicOf(clean),
      at: now,
      lastSeenAt: now,
      hits: 0,
      weight: Number.isFinite(Number(opts.weight)) ? Number(opts.weight) : 1,
      confidence: Number.isFinite(Number(opts.confidence)) ? clamp(opts.confidence, 0, 1) : 1,
      pinned: !!opts.pinned,
      source: opts.source || 'chat',
      expiresAt: opts.expiresAt !== undefined ? opts.expiresAt : horizonFor(clean, kind, now),
      rev: 1,
      dirty: true,
    };

    // A correction retires the version it corrects, so she is never holding two
    // answers to the same question.
    let replaced = null;
    const stale = liveFacts(state, now).find(f => contradicts(f, clean));
    if (stale) {
      stale.supersededBy = fact.id;
      stale.archivedAt = now;
      stale.rev = (stale.rev || 1) + 1;
      stale.dirty = true;
      replaced = stale.text;
    }

    state.facts.push(fact);
    prune(state, now);
    commit(state, { reason: 'remember' });

    console.log(`[SpinLog] 🧠 Sage remembered (${kind}/${fact.topic}): ${clean}`);
    if (replaced) console.log(`[SpinLog] 🧠 …which replaces: ${replaced}`);
    return { ok: true, id: fact.id, reason: 'added', replaced };
  }

  // How long a forgotten fact is kept locally. Long enough that a device which
  // has been shut in a drawer for a fortnight still learns it was forgotten,
  // rather than helpfully pushing it back up. The server keeps its own copy for
  // the same reason — see sage_memory_prune() in the migration.
  const TOMBSTONE_KEEP_MS = 30 * 86400000;

  /**
   * Keep the bank under MAX_FACTS.
   *
   * Overflow is *archived*, not dropped. Deleting the local row would be a
   * mistake now that the bank is in the cloud: the next pull would find the row
   * still there, adopt it, and she would remember something she had already let
   * go of. Archiving records the decision and propagates it.
   *
   * By score, not by age: a promise from months ago still matters more than a
   * passing remark from yesterday. Pinned facts are never touched, which is the
   * whole point of pinning.
   */
  function prune(state, now) {
    const at = now || nowMs();

    // Tombstones old enough that every device has seen them are just weight.
    state.facts = state.facts.filter(f =>
      !f.archivedAt || f.dirty || at - f.archivedAt < TOMBSTONE_KEEP_MS);

    const live = state.facts.filter(f => !f.archivedAt);
    if (live.length <= MAX_FACTS) return 0;

    live.sort((a, b) => score(b, at) - score(a, at));
    let forgotten = 0;
    live.slice(MAX_FACTS).forEach(f => {
      if (f.pinned) return;   // a pinned fact past the line simply stays
      f.archivedAt = at;
      f.rev = (f.rev || 1) + 1;
      f.dirty = true;
      forgotten += 1;
    });

    if (forgotten) {
      console.log(`[SpinLog] 🧠 Her memory is full — ${forgotten} of the weakest notes let go.`);
    }
    return forgotten;
  }

  /** Stop remembering one thing. Archived rather than deleted, so it sticks. */
  function forget(id) {
    const state = read();
    const fact = state.facts.find(f => f.id === id && !f.archivedAt);
    if (!fact) return false;
    fact.archivedAt = nowMs();
    fact.rev = (fact.rev || 1) + 1;
    fact.dirty = true;
    commit(state, { reason: 'forget' });
    return true;
  }

  /** Correct the wording of something she already knows. */
  function revise(id, text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean.length < 4) return { ok: false, reason: 'empty' };
    if (clean.length > 260) return { ok: false, reason: 'too-long' };

    const state = read();
    const fact = state.facts.find(f => f.id === id && !f.archivedAt);
    if (!fact) return { ok: false, reason: 'unknown' };

    const now = nowMs();
    fact.text = clean;
    fact.kind = classify(clean);
    fact.topic = topicOf(clean);
    fact.expiresAt = horizonFor(clean, fact.kind, now);
    fact.lastSeenAt = now;
    fact.rev = (fact.rev || 1) + 1;
    fact.dirty = true;
    commit(state, { reason: 'revise' });
    return { ok: true, id, text: clean };
  }

  /** Pinned facts are never pruned and always reach the prompt. */
  function pin(id, on) {
    const state = read();
    const fact = state.facts.find(f => f.id === id && !f.archivedAt);
    if (!fact) return false;
    fact.pinned = on !== false;
    fact.rev = (fact.rev || 1) + 1;
    fact.dirty = true;
    commit(state, { reason: 'pin' });
    return true;
  }

  /**
   * Everything she knows, best first.
   * @param {number|{limit?:number, kind?:string, topic?:string, pinned?:boolean,
   *                 includeArchived?:boolean, now?:number}} [options]
   */
  function facts(options) {
    const opts = typeof options === 'number' ? { limit: options } : (options || {});
    const at = opts.now || nowMs();
    sweep({ now: at });

    const state = read();
    let list = opts.includeArchived
      ? state.facts.slice()
      : liveFacts(state, at);

    if (opts.kind) list = list.filter(f => f.kind === opts.kind);
    if (opts.topic) list = list.filter(f => f.topic === opts.topic);
    if (opts.pinned === true) list = list.filter(f => f.pinned);

    list.sort((a, b) => score(b, at) - score(a, at));
    return opts.limit ? list.slice(0, opts.limit) : list;
  }

  /**
   * The facts that actually bear on what he just said.
   *
   * This is the difference between a prompt carrying her eighteen most recent
   * notes and one carrying the eighteen that matter: ask about servicing and
   * the workshop he likes comes back, not who his brother is.
   */
  function recall(query, options) {
    const opts = typeof options === 'number' ? { limit: options } : (options || {});
    const at = opts.now || nowMs();
    const q = tokens(query);
    const topic = topicOf(query);
    const pool = facts({ now: at });

    if (!q.length) return opts.limit ? pool.slice(0, opts.limit) : pool;

    const ranked = pool
      .map(fact => {
        const rel = relevance(fact, q, topic);
        return {
          fact,
          rel,
          // Relevance leads, standing breaks the ties. A pinned fact still wins
          // on standing alone, which is intended.
          rank: rel * 2.2 + Math.min(2, score(fact, at)) * 0.5,
        };
      })
      .filter(r => r.rel > 0 || r.fact.pinned)
      .sort((a, b) => b.rank - a.rank);

    const out = ranked.map(r => r.fact);
    return opts.limit ? out.slice(0, opts.limit) : out;
  }

  function count(options) {
    return facts(options).length;
  }

  /** What is in the bank, for the settings panel and for her own tools. */
  function stats() {
    const at = nowMs();
    const state = read();
    const live = liveFacts(state, at);
    const byKind = {};
    const byTopic = {};
    live.forEach(f => {
      byKind[f.kind] = (byKind[f.kind] || 0) + 1;
      byTopic[f.topic] = (byTopic[f.topic] || 0) + 1;
    });

    return {
      total: live.length,
      capacity: MAX_FACTS,
      pinned: live.filter(f => f.pinned).length,
      archived: state.facts.filter(f => f.archivedAt).length,
      episodes: state.episodes.length,
      hasRecap: !!state.recap?.text,
      oldest: live.reduce((min, f) => (min === null || f.at < min ? f.at : min), null),
      newest: live.reduce((max, f) => (max === null || f.at > max ? f.at : max), null),
      byKind,
      byTopic,
      pending: pendingCount(),
      sync: { ...state.sync },
    };
  }

  // ══ RELATIONSHIP + EPISODES ══════════════════════════════════════════

  /**
   * Called once per message he sends. Counts the conversation as new when there
   * has been a real break since the last one — and closes the previous one into
   * an episode on the way past.
   */
  function noteMessage(now) {
    const at = now || nowMs();
    const state = read();
    const rel = state.rel;

    if (!rel.firstSeenAt) rel.firstSeenAt = at;

    const since = rel.lastTalkedAt ? at - rel.lastTalkedAt : null;
    // Half an hour of silence makes the next message a new conversation.
    const fresh = since === null || since > EPISODE_GAP_MS;
    if (fresh) {
      if (rel.lastTalkedAt) closeEpisode(state, rel.lastTalkedAt);
      rel.conversations = (rel.conversations || 0) + 1;
      rel.episodeStartedAt = at;
      rel.episodeMessages = 0;
    }
    if (since !== null) {
      const gapDays = Math.floor(since / 86400000);
      if (gapDays > (rel.longestGapDays || 0)) rel.longestGapDays = gapDays;
    }

    rel.messages = (rel.messages || 0) + 1;
    rel.episodeMessages = (rel.episodeMessages || 0) + 1;
    rel.lastTalkedAt = at;
    rel.rev = (rel.rev || 1) + 1;
    rel.dirty = true;

    commit(state, { reason: 'note' });
    return rel;
  }

  /**
   * Write the conversation that just ended into the timeline.
   *
   * Costs nothing: it is counted and dated locally from what she already has,
   * with the topics taken from the facts learned during it. An AI-written
   * summary would be nicer and would also spend one of five daily background
   * requests per conversation, which is not a trade worth making — consolidate()
   * already buys the prose recap with that budget.
   */
  function closeEpisode(state, endedAt) {
    const rel = state.rel;
    const startedAt = rel.episodeStartedAt || endedAt;
    const messages = rel.episodeMessages || 0;
    // One message is not a conversation worth a timeline entry.
    if (messages < 2) return null;

    const learned = state.facts.filter(f =>
      f.at >= startedAt - 1000 && f.at <= endedAt + 60000);
    const topics = [...new Set(learned.map(f => f.topic))].slice(0, 4);

    const episode = {
      id: `e${startedAt.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      startedAt,
      endedAt,
      at: endedAt,
      messages,
      topics,
      learned: learned.map(f => f.text).slice(0, 6),
      summary: null,
      rev: 1,
      dirty: true,
    };

    state.episodes.push(episode);
    trimEpisodes(state);
    return episode;
  }

  /**
   * Keep the timeline at MAX_EPISODES, in the cloud as well as on the device.
   *
   * This used to be a bare `state.episodes.slice(-MAX_EPISODES)` in two places,
   * and that is the one thing in her memory that grew without limit. Slicing a
   * local array is invisible to the server: the row was neither deleted nor
   * archived, so `sage_memory_prune()` could not see it either (it only matches
   * `archived_at is not null`). One row per conversation, for ever — and every
   * full pull re-adopted them and sliced them off again, so the same rows churned
   * back and forth rather than being cleaned up.
   *
   * Queued as tombstones, which is the mechanism that already exists: push()
   * turns them into a real DELETE and pull()'s `doomed` guard stops them being
   * adopted back in the meantime.
   */
  function trimEpisodes(state) {
    if (state.episodes.length <= MAX_EPISODES) return 0;
    const dropped = state.episodes.slice(0, state.episodes.length - MAX_EPISODES);
    state.episodes = state.episodes.slice(-MAX_EPISODES);

    const list = state.tombstones || [];
    dropped.forEach(ep => {
      if (ep && ep.id && list.indexOf(ep.id) === -1) list.push(ep.id);
    });
    state.tombstones = [...new Set(list)].slice(0, 500);

    console.log(`[SpinLog] 🧠 ${dropped.length} old conversation(s) dropped off the end of her timeline.`);
    return dropped.length;
  }

  /** The conversation timeline, newest first. */
  function episodes(limit) {
    const list = read().episodes.slice().reverse();
    return limit ? list.slice(0, limit) : list;
  }

  /** Human-readable relationship summary, or null when they have never spoken. */
  function relationship(now) {
    const at = now || nowMs();
    const rel = read().rel;
    if (!rel.firstSeenAt) return null;

    const knownDays = Math.floor((at - rel.firstSeenAt) / 86400000);
    const sinceMs = rel.lastTalkedAt ? at - rel.lastTalkedAt : null;
    return {
      knownDays,
      conversations: rel.conversations || 0,
      messages: rel.messages || 0,
      longestGapDays: rel.longestGapDays || 0,
      hoursSinceLastTalk: sinceMs === null ? null : Math.floor(sinceMs / 3600000),
      firstSeenAt: rel.firstSeenAt,
      lastTalkedAt: rel.lastTalkedAt || null,
    };
  }

  // ══ RECAP ════════════════════════════════════════════════════════════

  const RECAP_BRIEF = [
    'Below is an older stretch of your conversation with Viky that is about to',
    'fall out of your memory.',
    '',
    'Write a compact note to yourself so you do not lose it. Cover what he told',
    'you about himself and his life, anything either of you promised, how things',
    'stood between you, and any running joke or thread worth keeping. Skip small',
    'talk and skip anything about your service figures — you already have those.',
    '',
    `Plain prose, third person about him, under ${RECAP_MAX_CHARS} characters.`,
    'This is a private note, not a message to him, so do not address him and do',
    'not stay in character.',
  ].join('\n');

  /**
   * Fold everything past the model's window into the rolling recap.
   *
   * Costs one request, so it is charged to the background budget and never runs
   * more than once an hour. Silently does nothing when she cannot speak, which
   * is the correct outcome: the facts, episodes and counters still carry
   * continuity.
   *
   * @param {Array<{role:string, text:string}>} turns full stored history
   * @returns {Promise<boolean>} whether a new recap was written
   */
  async function consolidate(turns, options) {
    const opts = options || {};
    const AI = root.SageAI;
    if (!AI || !Array.isArray(turns)) return false;

    // Read the live value rather than a stale default. The old fallback of 12
    // was left behind when the window doubled, so this quietly consolidated
    // turns the model could still see.
    const windowSize = opts.window ?? (AI.CHAT_MAX_TURNS || 26);
    const state = read();
    const now = opts.now || nowMs();

    const already = state.recap?.throughTurns || 0;
    // Turns the model can still see are not lost yet, so they are not our job.
    const dropped = turns.slice(0, Math.max(0, turns.length - windowSize));
    if (dropped.length - already < RECAP_AFTER_TURNS && !opts.force) return false;
    if (state.recap && now - (state.recap.at || 0) < RECAP_MIN_GAP_MS && !opts.force) return false;
    if (!AI.ready().ok) return false;
    if (AI.autoBudgetLeft() <= 0 && !opts.force) return false;

    const transcript = dropped
      .map(t => `${t.role === 'user' ? 'Viky' : 'You'}: ${String(t.text).replace(/\s+/g, ' ').trim()}`)
      .join('\n')
      .slice(-6000);   // a hard cap on prompt size, oldest sacrificed first

    const prior = state.recap?.text
      ? `Your existing note, which you are updating rather than replacing:\n${state.recap.text}\n\n`
      : '';

    const text = await AI.generate(`${prior}${RECAP_BRIEF}\n\nThe conversation:\n${transcript}`, {
      // A private note to herself, so the persona would only get in the way.
      system: 'You are keeping a private, factual note for yourself. Be concise and specific.',
      temperature: 0.4,
      maxOutputTokens: 900,
    });
    if (!text) return false;

    const fresh = read();   // re-read: a reply may have added a fact meanwhile
    fresh.recap = {
      text: String(text).replace(/\s+/g, ' ').trim().slice(0, RECAP_MAX_CHARS),
      throughTurns: dropped.length,
      at: now,
      rev: (fresh.recap?.rev || 0) + 1,
      dirty: true,
    };
    commit(fresh, { reason: 'recap' });
    console.log(`[SpinLog] 🧠 Sage folded ${dropped.length} older turns into what she remembers.`);
    return true;
  }

  function recap() {
    return read().recap;
  }

  // ══ ABSORB ═══════════════════════════════════════════════════════════

  // At most this many notes out of one reply. A model that starts listing gets
  // to keep the first few and no more.
  const MAX_ABSORB_PER_REPLY = 3;

  /**
   * Pull any `[[remember: …]]` or `[[forget: …]]` lines out of a reply, act on
   * them, and hand back the reply with the sentinels gone.
   *
   * Anything inside double brackets is stripped whether or not we understood
   * it — a stray sentinel reaching the screen would break the illusion far more
   * than a missed memory does.
   *
   * @returns {{text:string, learned:string[], forgot:string[]}}
   */
  function absorb(raw, options) {
    const source = String(raw || '');
    if (!source) return { text: '', learned: [], forgot: [], revised: [] };

    const learned = [];
    const forgot = [];
    // A note she filled in rather than a new one. Reported separately so the chat
    // says "Updated" instead of a second "Noted" for the same thing, which is the
    // whole complaint this answers.
    const revised = [];

    const text = source.replace(/\[\[([^\]]*)\]\]/g, (_match, inner) => {
      const body = String(inner || '').trim();

      // `[[remember: …]]`, optionally `[[remember(plan): …]]`
      const memo = body.match(/^remember\s*(?:\(([a-z]+)\))?\s*[:\-–—]?\s*([\s\S]+)$/i);
      if (memo && memo[2]) {
        if (learned.length < MAX_ABSORB_PER_REPLY) {
          const stored = remember(memo[2].trim(), { ...options, kind: memo[1], source: 'sentinel' });
          if (stored.ok && stored.reason === 'added') learned.push(memo[2].trim());
          else if (stored.ok && stored.reason === 'refined') revised.push(memo[2].trim());
        }
        return '';
      }

      // `[[forget: …]]` — how a correction actually takes effect rather than
      // her agreeing she was wrong and remembering it anyway.
      const drop = body.match(/^forget\s*[:\-–—]?\s*([\s\S]+)$/i);
      if (drop && drop[1]) {
        const target = drop[1].trim();
        const match = findByText(target);
        if (match) { forget(match.id); forgot.push(match.text); }
        return '';
      }

      // Some other bracketed aside; it simply gets removed.
      return '';
    }).trim();

    return { text, learned, forgot, revised };
  }

  /** Find a fact by its exact words, then by fingerprint, then by overlap. */
  function findByText(text) {
    const target = String(text || '').trim();
    if (!target) return null;
    const live = facts();
    const print = fingerprint(target);
    return live.find(f => f.text === target)
      || live.find(f => fingerprint(f.text) === print)
      || live.find(f => overlap(f.text, target) >= 0.7)
      || null;
  }

  // ══ WHAT HE SAID HIMSELF ═════════════════════════════════════════════
  //
  // Everything above this point depends on the MODEL choosing to save. Both
  // channels do — the `remember` control and the `[[remember: …]]` line — and at
  // two in the morning, under an instruction that says one sentence and stop,
  // that choice is often no. "we are going out tommo babe" got a reply and
  // nothing else: no control, no sentinel, no note. Nothing rejected it, because
  // nothing ever reached remember().
  //
  // A dated plan is the one thing that cannot survive being missed. A preference
  // she skips today she will hear again; a plan for tomorrow is worthless the day
  // after. So this is a net under the model for exactly that case, and only that
  // case: he named a day, or he asked to be reminded. Everything else stays her
  // judgement, because a net wide enough to catch every passing remark would fill
  // her memory with the conversation.

  /**
   * Shorthand, expanded only so the classifier can see the date.
   *
   * "tommo" is a day. classify() and horizonFor() both look for `tomorrow`, so
   * without this the note is filed as an undated fact with no horizon and never
   * reaches her plan reminders at all.
   */
  const SHORTHAND = [
    [/\b(?:tomorrow|tomorow|tommorow|tommorrow|tomm?o|tmrw?|tmw|2moro|2mrw)\b/g, 'tomorrow'],
    [/\b(?:tonight|tonite|tnite|2nite)\b/g, 'tonight'],
    [/\b(?:weekend|wknd|wkend)\b/g, 'weekend'],
    [/\bnxt\b/g, 'next'],
    [/\bmrng\b/g, 'morning'],
  ];

  /**
   * Thanglish, mapped onto the English words the classifier already knows.
   *
   * This is the whole of the Thanglish wiring for HIS side of the conversation,
   * and it is one table rather than six rewritten regexes on purpose. classify(),
   * topicOf(), horizonFor() and every gate in glean() run on the output of
   * plainWords(), so translating here means none of them has to learn a second
   * language — and the note still stores exactly what he typed, because the
   * translation is only ever used for reading, never for writing.
   *
   * Order matters: the two-word phrases have to run before anything that would
   * consume half of one, which is why "adutha vaaram" sits above the day words
   * and why there is no bare `vaaram` rule at all.
   *
   * Deliberately not exhaustive. These are the forms that actually turn up in a
   * message about a plan; a dictionary would add false positives faster than it
   * added catches.
   */
  const THANGLISH = [
    // ── When ──
    [/\b(?:adutha|aduttha|aduthu)\s+(?:vaaram|varam|week)\b/g, 'next week'],
    [/\b(?:adutha|aduttha|aduthu)\s+(?:maasam|masam|month)\b/g, 'next month'],
    [/\b(?:adutha|aduttha|aduthu)\s+(?:varusham|varsham|year)\b/g, 'next year'],
    [/\b(?:indha|intha|inda|itha)\s+(?:vaaram|varam|week)\b/g, 'this week'],
    [/\b(?:indha|intha|inda|itha)\s+(?:maasam|masam|month)\b/g, 'this month'],
    [/\b(?:naalaikku|naalaiku|nalaikku|nalaiku|naalikku|naaliku|nalikku|naaleku)\b/g, 'tomorrow'],
    [/\b(?:innaikku|innaiku|innikku|inniki|inaiku|innaeku|indraiku)\b/g, 'today'],
    [/\b(?:raathiri|raatri|ratri|iravu)\b/g, 'tonight'],
    [/\b(?:nethu|nethru|nettru|neththu|nenju)\b/g, 'yesterday'],

    // ── Already over ──
    // "aachu" is also how SHE says "that is done", but this table only ever runs
    // over his messages and his own gleaned notes, never over her replies.
    // "poitu" is deliberately absent from both lists: alone it is past ("naan
    // poitu"), but "poitu varen" is future, and getting that wrong either drops a
    // real plan or invents one.
    [/\b(?:aachu|achu|aayiduchu|mudinchu|mudinjhu|mudinjudu|poyiduchu)\b/g, 'already'],

    // ── Intent, WITH THE SUBJECT KEPT ──
    //
    // Tamil is pro-drop — "naalaiku insurance renew pannanum" has no word for "I"
    // anywhere in it — so translating the verb alone would leave ABOUT_HIM with
    // nothing to match and every plan he phrased naturally would be thrown away.
    //
    // The ending already carries it: -en is first person singular, -om and -lam
    // are first person plural. So the translation keeps it. This is why the rules
    // below emit "i going" and "we will" rather than bare verbs.
    [/\b(?:poren|porein|poroan)\b/g, 'i going'],
    [/\b(?:porom|povom|polam|pogalam|poga)\b/g, 'we going'],
    [/\b(?:varen|varein)\b/g, 'i coming'],
    [/\b(?:varom|varalam|varalaam|vandhu|vanthu)\b/g, 'we coming'],
    [/\b(?:venum|vendum|vanum|pannanum|panananum|mudikkanum|seyyanum|katanum)\b/g, 'i need'],
    [/\b(?:panren|panniduven|irupen|iruppen|paaren|kilamburen|kilambuven)\b/g, 'i will'],
    [/\b(?:pannalam|seivom|seyalam|irukalam|paakalam|paapom|paathukkalam)\b/g, 'we will'],
    [/\b(?:kilambalam|kilambu)\b/g, 'we leaving'],
    [/\b(?:odaikalam|odaipom|ottalam|ottikalam)\b/g, 'we riding'],

    // ── Him, and the two of them ──
    [/\b(?:naan|nan)\b/g, 'i'],
    [/\b(?:naanga|naangalum|naama|nama|namma|nammalum)\b/g, 'we'],
    [/\b(?:enakku|ennoda|enathu|enkitta)\b/g, 'my'],

    // ── Asking, not telling ──
    // These land at the START of a message far more often than not, which is
    // where A_QUESTION looks. "enna" is left off: mid-sentence it is filler
    // ("enna pannalam"), and as a question it almost always carries a ? anyway.
    [/\b(?:eppo|eppothu)\b/g, 'when'],
    [/\b(?:enga|engae|enge)\b/g, 'where'],
    [/\b(?:yaaru|yaar)\b/g, 'who'],
    [/\b(?:epdi|eppadi)\b/g, 'how'],
    [/\b(?:evlo|evvalavu|evalo)\b/g, 'how much'],
  ];

  function plainWords(text) {
    let out = String(text || '').toLowerCase();
    for (const [pattern, word] of SHORTHAND) out = out.replace(pattern, word);
    for (const [pattern, word] of THANGLISH) out = out.replace(pattern, word);
    return out;
  }

  // Asking is not telling. "what are we doing tomorrow" is a question about a
  // plan, not a plan.
  const A_QUESTION = /^(?:what|whats|when|where|who|whose|why|how|which|is|are|was|were|do|does|did|can|could|should|shall|will|would|have|has|had|am|any)\b/;

  // Telling the app to do something is not telling her something about himself.
  const AN_ORDER = /^(?:open|show|go|take|delete|remove|clear|wipe|log|attach|upload|sync|refresh|forget|fix|change|update|set|find|search|list|read|say|stop|mute)\b/;

  // Except this, which is him asking for exactly what this function does — and
  // which starts with "add" often enough that AN_ORDER would throw it away.
  // Thanglish reminder phrases are matched here rather than translated, because
  // "remind me" is two words and the table above maps single words.
  const A_REMINDER = /\b(?:remind me|remind pannu|reminder|don'?t let me forget|do not let me forget|make sure i|note (?:it|this|that) down|write (?:it|this|that) down|n?[gj]?nabagam|nyabagam|njabagam|marakkama|marakka|ninaivu)\b/;

  // It has to be about him. "you will forget this anyway" is about her.
  const ABOUT_HIM = /\b(?:i|im|me|my|mine|myself|we|us|our|let'?s|lets)\b/;

  // A day, in any of the ways he writes one.
  const A_TIME = /\b(?:today|tonight|tomorrow|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next (?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|this (?:week|month|weekend|evening|afternoon|morning)|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}|\d{1,2}(?:st|nd|rd|th)|\d{1,2} ?(?:am|pm)|january|february|march|april|june|july|august|september|october|november|december)\b/;

  // And it has to be something he intends, not something that merely has a day
  // in it.
  // `plan(?:s|ned|ning)?` rather than `plans?`, because "i have a trip planned
  // for the weekend" is as plain a statement of intent as there is and the
  // narrower spelling missed it.
  const AN_INTENT = /\b(?:will|'ll|going|gonna|plan(?:s|ned|ning)?|book(?:ed|ing)?|want|wanna|need|have to|gotta|must|should|meet(?:ing)?|tak(?:e|ing)|rid(?:e|es|ing)|leav(?:e|ing)|head(?:s|ing)|get|getting|out|off)\b/;

  // Already over. "we went out last weekend" has a day in it and is not a plan.
  const ALREADY_HAPPENED = /\b(?:yesterday|last (?:night|week|month|year|weekend|time)|ago|already|was|were|went|rode)\b/;

  // Long enough to be a statement, short enough to be a note rather than a
  // transcript. Anything past this is a paragraph and she can have it.
  const HEARD_MIN = 8;
  const HEARD_MAX = 180;

  // How the note reads: `He said: <his words>`.
  //
  // His own words rather than a rewrite into the third person. A regex cannot
  // turn "we are going out tommo babe" into decent English about him, and
  // half-rewritten grammar would be sitting in the memory list where he can see
  // it. Repeating him is always accurate and never clumsy.
  //
  // And no quotation marks around them, which was the first attempt: remember()
  // strips quote characters off both ends of a note, so `He said: "…"` came back
  // out as `He said: "…` with the closing mark gone and the reported text no
  // longer matching the stored text.
  const HEARD_LEAD = 'He said: ';
  const HEARD_PREFIX = /^he said:\s*([\s\S]*)$/i;

  /** The words he actually said, or the note itself if it is one of hers. */
  function saidPart(text) {
    const m = String(text || '').match(HEARD_PREFIX);
    return m ? m[1] : String(text || '');
  }

  /**
   * Keep a plan he stated himself, when she did not.
   *
   * Call it only after her reply has been absorbed and only when that reply kept
   * nothing — see askSage. Returns null when the message is not a plan at all,
   * which is most messages.
   *
   * @param {string} message What he typed, untouched.
   * @param {{now?:number}} [options]
   * @returns {{ok:boolean, id?:string, reason:string, text?:string}|null}
   */
  function glean(message, options) {
    const opts = options || {};
    const said = String(message || '').replace(/\s+/g, ' ').trim();
    if (said.length < HEARD_MIN || said.length > HEARD_MAX) return null;

    const plain = plainWords(said);

    // A question mark settles it whatever the wording.
    if (/\?\s*$/.test(said)) return null;

    if (!A_REMINDER.test(plain)) {
      if (A_QUESTION.test(plain)) return null;
      if (AN_ORDER.test(plain)) return null;
      if (ALREADY_HAPPENED.test(plain)) return null;
      if (!ABOUT_HIM.test(plain)) return null;
      if (!A_TIME.test(plain)) return null;
      if (!AN_INTENT.test(plain)) return null;
    }

    const now = opts.now || nowMs();
    // Read off the expanded text so "tommo" dates it, but stored as he wrote it.
    const kind = classify(plain) === 'promise' ? 'promise' : 'plan';
    const expiresAt = horizonFor(plain, kind, now);
    const topic = topicOf(said);

    // Does she already hold this plan, in her own wording or his?
    //
    // Compared on the words INSIDE the quotes and with the shorthand expanded,
    // or "he is going out with her tomorrow" and `He said: "we are going out
    // tommo"` share almost nothing and she ends up holding one plan twice —
    // which is the complaint this whole area already answered once.
    // Topics have to AGREE, not be equal: a bare "super do naalaiku polam" has no
    // topic at all, and demanding it equal the 'riding' on the note it duplicates
    // is a gate that only ever opens for the easy cases.
    const known = liveFacts(read(), now).find(f =>
      (!f.topic || !topic || f.topic === topic)
      && overlapWords(plainWords(saidPart(f.text)), plain) >= 0.5);
    if (known) return { ok: false, reason: 'known', id: known.id };

    // Nothing in the message but a day and a yes.
    //
    // He is agreeing with a plan she already holds, not making a second one. There
    // is no destination in "super do naalaiku polam" to tell it apart from "he
    // plans to ride to Munnar tomorrow" — the word overlap between them is 0.125,
    // so no threshold that keeps real plans could ever catch it.
    //
    // glean() is the net for a plan she MISSED. If she already has one for that
    // day, nothing was missed, and this is the third time one ride has turned into
    // two rows. The cost is a genuine second plan for the same day going unkept on
    // the one turn she also writes nothing herself, which is the better trade.
    if (expiresAt && !occasionTokens(plain).size) {
      const sameDay = liveFacts(read(), now).find(f =>
        (f.kind === 'plan' || f.kind === 'promise')
        && f.expiresAt && Math.abs(f.expiresAt - expiresAt) < 12 * 3600000);
      if (sameDay) return { ok: false, reason: 'known', id: sameDay.id };
    }

    // Quotes off the ends first, so remember()'s own trimming has nothing left to
    // take and the text it stores is the text reported back here.
    const text = HEARD_LEAD + said.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
    const stored = remember(text, { kind, expiresAt, topic, source: 'heard', now });
    if (!stored.ok) return stored;

    console.log(`[SpinLog] 🧠 She let that go, so it was kept for her: ${said}`);
    return { ...stored, text };
  }

  // ══ PROMPT BLOCK ═════════════════════════════════════════════════════

  const KIND_ORDER = ['promise', 'plan', 'person', 'preference', 'feeling', 'ride', 'fact'];

  function ago(fromMs, now) {
    const days = Math.floor(((now || nowMs()) - fromMs) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 14) return `${days} days ago`;
    if (days < 60) return `${Math.round(days / 7)} weeks ago`;
    return `${Math.round(days / 30)} months ago`;
  }

  /**
   * Everything she remembers, formatted for the system instruction.
   *
   * Pass the message she is answering as `options.query` and the fact list
   * becomes a retrieval rather than a recency dump — which is what stops the
   * eighteen lines being spent on whatever happened to be newest.
   *
   * Returns null when there is nothing yet, so a first conversation is not
   * padded with empty headings.
   *
   * @param {number|{now?:number, query?:string, limit?:number}} [options]
   */
  function promptBlock(options) {
    // Was promptBlock(now). Kept working, because sage-ai.js called it that way.
    const opts = typeof options === 'number' ? { now: options } : (options || {});
    const at = opts.now || nowMs();
    const limit = opts.limit || FACTS_IN_PROMPT;

    const state = read();
    const rel = relationship(at);
    const top = opts.query
      ? recall(opts.query, { limit, now: at })
      : facts({ limit, now: at });
    const timeline = episodes(EPISODES_IN_PROMPT);

    if (!top.length && !state.recap && !rel) return null;

    const out = ['What you remember:'];

    if (rel && rel.knownDays >= 1) {
      const bits = [`- He has been talking to you for ${rel.knownDays} day${rel.knownDays === 1 ? '' : 's'}`];
      if (rel.messages > 1) bits.push(`, ${rel.messages} messages across ${rel.conversations} conversations`);
      if (rel.hoursSinceLastTalk !== null && rel.hoursSinceLastTalk >= 24) {
        const days = Math.floor(rel.hoursSinceLastTalk / 24);
        bits.push(`. You last spoke ${days} day${days === 1 ? '' : 's'} ago`);
      }
      out.push(`${bits.join('')}.`);
    }

    if (state.recap?.text) {
      out.push('', 'Earlier conversations, from your own notes:', state.recap.text);
    }

    if (top.length) {
      out.push('', 'Things you know about him:');
      top
        .slice()
        .sort((a, b) => {
          // Pinned first — he has said outright that these matter.
          if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
          return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
        })
        .forEach(f => {
          const marks = [];
          if (f.pinned) marks.push('he has told you this matters');
          if (f.kind === 'plan' && f.expiresAt && f.expiresAt > at) marks.push('still ahead of him');
          if (f.confidence < 0.6) marks.push('you are not certain of this');
          const note = marks.length ? ` (${marks.join('; ')})` : '';
          out.push(`- ${f.text}${note}`);
        });
    }

    // A light sense of when things happened, so "the other day" means something.
    if (timeline.length > 1) {
      out.push('', 'When you last talked:');
      timeline.forEach(ep => {
        const subject = ep.topics.length ? ep.topics.join(', ') : 'nothing in particular';
        out.push(`- ${ago(ep.endedAt, at)}, ${ep.messages} messages about ${subject}.`);
      });
    }

    out.push('', 'Use these the way a person would — glancingly, when they fit. Do not list',
      'them back at him, and do not bring one up just to prove you remembered.');

    return out.join('\n');
  }

  // ══ CLOUD ════════════════════════════════════════════════════════════

  let clientWait = null;

  /** The shared Supabase client, once script.js has made it. */
  function client() {
    return root.supabaseClient || null;
  }

  /**
   * Wait for the client rather than assume it.
   * This file loads at index.html:1119; the client is created inside script.js's
   * DOMContentLoaded handler. Polling briefly is simpler and more robust than
   * depending on that ordering never changing.
   */
  function whenClient() {
    if (client()) return Promise.resolve(client());
    if (clientWait) return clientWait;
    clientWait = new Promise(resolve => {
      let tries = 0;
      const tick = () => {
        if (client()) return resolve(client());
        if (++tries >= CLIENT_WAIT_TRIES) return resolve(null);
        setTimeout(tick, CLIENT_WAIT_GAP_MS);
      };
      tick();
    });
    return clientWait;
  }

  /**
   * True when the failure is "table not created yet" rather than a real fault.
   *
   * The column check comes first deliberately. Postgres says "column
   * sage_memory.mem_key does not exist" for a missing column and "relation
   * public.sage_memory does not exist" for a missing table — and a bare
   * /does not exist/ match treats the first as the second, which reported a
   * table that needed its columns adding as a table that was not there at all.
   */
  function isMissingTable(error) {
    if (!error) return false;
    if (error.code === '42P01') return true;
    if (isMissingColumn(error)) return false;
    return /relation .* does not exist|schema cache|not find the table/i.test(error.message || '');
  }

  /** True when the failure is "that column is not there", not a real fault. */
  function isMissingColumn(error) {
    if (!error) return false;
    return error.code === '42703' || /column .* does not exist/i.test(error.message || '');
  }

  /**
   * True when row level security refused the write.
   *
   * Told apart from a generic error because it is the most likely thing to go
   * wrong and the only one with a specific fix: the table exists, the columns
   * exist, the request arrived — there is simply no policy letting the anon key
   * write. 42501 is the Postgres code; PostgREST also returns its own.
   */
  function isDenied(error) {
    if (!error) return false;
    return error.code === '42501'
      || error.code === 'PGRST301'
      || /row-level security|row level security|permission denied|not authorized/i.test(error.message || '');
  }

  // Which table name works, remembered so every call does not probe twice.
  let resolvedTable = null;

  async function tableName(supabase) {
    if (resolvedTable) return resolvedTable;
    const remembered = read().sync.table;
    const candidates = remembered
      ? [remembered, TABLE, TABLE_FALLBACK]
      : [TABLE, TABLE_FALLBACK];

    for (const name of [...new Set(candidates)]) {
      const { error } = await supabase.from(name).select('id').limit(1);
      if (!error) {
        resolvedTable = name;
        if (remembered !== name) {
          const state = read();
          state.sync.table = name;
          write(state);
        }
        return name;
      }
      if (!isMissingTable(error)) {
        // A real fault — a policy problem, say. The name is fine.
        resolvedTable = name;
        return name;
      }
    }
    return null;
  }

  // ── Row mapping ──────────────────────────────────────────────────────

  /**
   * Every column, with a value for each. Every builder below starts here.
   *
   * This is not tidiness, it is required. One push sends facts, the recap, the
   * counters and episodes in a single call, and when Supabase inserts several
   * rows at once it unifies the column list across all of them and writes NULL
   * for any key a given row is missing — it does NOT fall back to the column
   * default. So a recap row that simply had no `weight` key made Postgres
   * reject the whole batch with
   *   null value in column "weight" violates not-null constraint
   * and no memory reached the cloud at all.
   *
   * Keeping the key set identical for every record type is the fix, and it is
   * also the only version of this that does not silently break again the next
   * time a column is added.
   */
  function baseRow(memKey, recordType) {
    return {
      mem_key: memKey,
      record_type: recordType,
      device_id: deviceId(),
      content: '',
      kind: null,
      topic: null,
      source: null,
      weight: 1,
      confidence: 1,
      pinned: false,
      hits: 0,
      learned_at: null,
      last_seen_at: null,
      expires_at: null,
      superseded_by: null,
      archived_at: null,
      data: null,
      rev: 1,
      updated_at: new Date().toISOString(),
    };
  }

  function rowFromFact(fact) {
    return {
      ...baseRow(fact.id, 'fact'),
      content: fact.text,
      kind: fact.kind,
      topic: fact.topic,
      source: fact.source || 'chat',
      weight: fact.weight ?? 1,
      confidence: fact.confidence ?? 1,
      pinned: !!fact.pinned,
      hits: fact.hits || 0,
      learned_at: iso(fact.at),
      last_seen_at: iso(fact.lastSeenAt),
      expires_at: iso(fact.expiresAt),
      superseded_by: fact.supersededBy || null,
      archived_at: iso(fact.archivedAt),
      rev: fact.rev || 1,
    };
  }

  function factFromRow(row) {
    return normaliseFact({
      id: row.mem_key,
      text: row.content,
      kind: row.kind,
      topic: row.topic,
      source: row.source,
      weight: row.weight,
      confidence: row.confidence,
      pinned: row.pinned,
      hits: row.hits,
      at: ms(row.learned_at) || ms(row.created_at) || nowMs(),
      lastSeenAt: ms(row.last_seen_at) || ms(row.learned_at) || nowMs(),
      expiresAt: ms(row.expires_at),
      supersededBy: row.superseded_by,
      archivedAt: ms(row.archived_at),
      rev: row.rev,
      dirty: false,
    });
  }

  function rowFromRecap(recapRow) {
    return {
      ...baseRow('recap', 'recap'),
      content: recapRow.text,
      rev: recapRow.rev || 1,
      learned_at: iso(recapRow.at),
      last_seen_at: iso(recapRow.at),
      data: { throughTurns: recapRow.throughTurns || 0 },
    };
  }

  function rowFromRel(rel) {
    return {
      ...baseRow('relationship', 'relationship'),
      content: 'relationship counters',
      rev: rel.rev || 1,
      data: {
        firstSeenAt: rel.firstSeenAt,
        lastTalkedAt: rel.lastTalkedAt,
        conversations: rel.conversations || 0,
        messages: rel.messages || 0,
        longestGapDays: rel.longestGapDays || 0,
      },
    };
  }

  function rowFromEpisode(ep) {
    return {
      ...baseRow(ep.id, 'episode'),
      content: ep.summary || `${ep.messages} messages`,
      topic: (ep.topics && ep.topics[0]) || null,
      rev: ep.rev || 1,
      learned_at: iso(ep.startedAt),
      last_seen_at: iso(ep.endedAt),
      data: {
        startedAt: ep.startedAt,
        endedAt: ep.endedAt,
        messages: ep.messages,
        topics: ep.topics || [],
        learned: ep.learned || [],
      },
    };
  }

  function episodeFromRow(row) {
    const data = row.data || {};
    return {
      id: row.mem_key,
      startedAt: data.startedAt || ms(row.learned_at) || nowMs(),
      endedAt: data.endedAt || ms(row.last_seen_at) || nowMs(),
      at: data.endedAt || ms(row.last_seen_at) || nowMs(),
      messages: data.messages || 0,
      topics: Array.isArray(data.topics) ? data.topics : [],
      learned: Array.isArray(data.learned) ? data.learned : [],
      summary: row.content && !/^\d+ messages$/.test(row.content) ? row.content : null,
      rev: row.rev || 1,
      dirty: false,
    };
  }

  /**
   * One fact, learned separately on two devices, and therefore holding two ids.
   * Keep a single copy and make both sides agree on which id it has.
   *
   * Whichever was learned first is treated as the original, because that is the
   * one every other device is most likely to already have. The loser's row is
   * tombstoned rather than left behind — an orphan duplicate in the table would
   * simply come back to the next device that pulls.
   */
  function mergeTwins(local, remote, state) {
    const merged = {
      // The longer phrasing usually carries more detail, same rule remember() uses.
      text: (local.text || '').length >= (remote.text || '').length ? local.text : remote.text,
      hits: Math.max(local.hits || 0, remote.hits || 0),
      lastSeenAt: Math.max(local.lastSeenAt || 0, remote.lastSeenAt || 0),
      at: Math.min(local.at || remote.at || nowMs(), remote.at || local.at || nowMs()),
      pinned: !!(local.pinned || remote.pinned),
      confidence: Math.max(local.confidence ?? 1, remote.confidence ?? 1),
    };

    const tomb = key => {
      const list = state.tombstones || [];
      if (list.indexOf(key) === -1) list.push(key);
      state.tombstones = list;
    };

    if ((remote.at || 0) <= (local.at || 0)) {
      // The cloud's copy is the elder, so its id is the one to converge on. The
      // local id may already be a row of its own up there.
      if (!local.dirty) tomb(local.id);
      Object.assign(local, remote, merged, { dirty: false });
    } else {
      // This device learned it first; retire the newer remote row instead.
      tomb(remote.id);
      Object.assign(local, merged, { dirty: true, rev: (local.rev || 1) + 1 });
    }
  }

  // ── Pull ─────────────────────────────────────────────────────────────

  /**
   * Bring the server's copy in and merge it.
   *
   * Conflicts go to the higher rev, then the later updated_at. Counters are the
   * exception: two devices both counting messages would lose half of them under
   * last-write-wins, so those take the larger of the two.
   *
   * @param {object} [opts]
   * @param {string[]} [opts.keys] Only merge these mem_keys. Used by selective
   *   restore, where the point is to leave the rest of the cloud copy alone.
   *   A filtered pull is deliberately NOT recorded as a sync: stamping
   *   lastPullAt after reading four of forty rows would tell the rest of the app
   *   this device is up to date when it is not.
   */
  async function pull(opts) {
    const only = opts && Array.isArray(opts.keys) ? new Set(opts.keys) : null;
    // An explicit empty selection means nothing was asked for, which is not the
    // same as no filter at all. Answering it with a full pull would be the exact
    // opposite of what was asked.
    if (only && !only.size) return { ok: true, rows: 0, adopted: 0, partial: true };

    const supabase = await whenClient();
    if (!supabase) return { ok: false, reason: 'no-client' };

    const name = await tableName(supabase);
    if (!name) return { ok: false, reason: 'no-table' };

    let rows = null;
    let error = null;
    // Her own record types only.
    //
    // This was `select('*')` with no filter, which is not merely untidy now that
    // the same table carries park spots, chat turns and app settings. PostgREST
    // caps a response at max-rows — 1000 by default — and an eighty-turn
    // conversation was spending that budget on rows this function looks at and
    // throws away. Past the cap the response is an arbitrary subset in physical
    // row order, so chat traffic could quietly crowd her facts out of the pull,
    // and the symptom would be her having forgotten things.
    ({ data: rows, error } = await supabase.from(name)
      .select('*')
      .in('record_type', RECORD_TYPES));

    if (error) {
      if (isMissingTable(error)) return { ok: false, reason: 'no-table' };
      if (isMissingColumn(error)) return { ok: false, reason: 'schema', error: error.message };
      console.warn('[SpinLog] 🧠 Could not read her memory from the cloud:', error);
      return {
        ok: false,
        reason: isDenied(error) ? 'denied' : 'error',
        error: error.message,
        code: error.code || null,
      };
    }

    const state = read();
    const byKey = new Map(state.facts.map(f => [f.id, f]));
    const episodeByKey = new Map(state.episodes.map(e => [e.id, e]));
    // Keys we have already decided to destroy, whose DELETE has not landed yet.
    const doomed = new Set(state.tombstones || []);
    let adopted = 0;

    (rows || []).forEach(row => {
      if (!row || !row.mem_key) return;
      if (only && !only.has(row.mem_key)) return;
      // Never adopt something that is queued for deletion.
      //
      // This is why a deleted memory came back. purge() takes the fact out of
      // local state and queues its key, then push() deletes the row. If anything
      // pulls in between — and opening settings runs a full sync, which pulls
      // BEFORE it pushes — the row is still in the table, so it was adopted
      // straight back in as a live fact. The delete then removed the row and left
      // the local copy behind, so she "remembered" it again and the count crept
      // back up. The same race hit a refused delete, permanently.
      if (doomed.has(row.mem_key)) return;
      const remoteRev = Number(row.rev) || 1;
      const remoteAt = ms(row.updated_at) || 0;

      if (row.record_type === 'fact') {
        const local = byKey.get(row.mem_key);
        if (!local) {
          const fact = factFromRow(row);
          if (!fact) return;
          // Matching on mem_key alone is not enough. The same thing learned on
          // two devices is stored twice with two generated ids, so a pull would
          // adopt it as a second fact — and her list slowly fills with pairs.
          // remember() already dedupes by fingerprint locally; the merge has to
          // do the same across devices.
          const print = fingerprint(fact.text);
          const twin = state.facts.find(f =>
            !f.archivedAt && !f.supersededBy && fingerprint(f.text) === print);
          if (twin) {
            mergeTwins(twin, fact, state);
            byKey.set(twin.id, twin);
            adopted += 1;
            return;
          }
          state.facts.push(fact);
          byKey.set(fact.id, fact);
          adopted += 1;
          return;
        }
        const localRev = Number(local.rev) || 1;
        // Local has unsent changes and is at least as new — keep it and push.
        if (local.dirty && localRev >= remoteRev) return;
        if (remoteRev > localRev || (remoteRev === localRev && remoteAt > (local.lastSeenAt || 0))) {
          Object.assign(local, factFromRow(row));
          adopted += 1;
        }
        return;
      }

      if (row.record_type === 'recap') {
        const localRev = state.recap?.rev || 0;
        if (state.recap?.dirty && localRev >= remoteRev) return;
        if (remoteRev > localRev && row.content) {
          state.recap = {
            text: row.content,
            throughTurns: (row.data && row.data.throughTurns) || 0,
            at: ms(row.learned_at) || remoteAt || nowMs(),
            rev: remoteRev,
            dirty: false,
          };
          adopted += 1;
        }
        return;
      }

      if (row.record_type === 'relationship') {
        const data = row.data || {};
        const rel = state.rel;
        const merged = {
          firstSeenAt: Math.min(rel.firstSeenAt || Infinity, data.firstSeenAt || Infinity),
          lastTalkedAt: Math.max(rel.lastTalkedAt || 0, data.lastTalkedAt || 0),
          conversations: Math.max(rel.conversations || 0, data.conversations || 0),
          messages: Math.max(rel.messages || 0, data.messages || 0),
          longestGapDays: Math.max(rel.longestGapDays || 0, data.longestGapDays || 0),
        };
        if (!Number.isFinite(merged.firstSeenAt)) merged.firstSeenAt = null;
        if (!merged.lastTalkedAt) merged.lastTalkedAt = null;

        const grew = merged.messages > (rel.messages || 0)
          || merged.conversations > (rel.conversations || 0);
        Object.assign(rel, merged);
        rel.rev = Math.max(rel.rev || 1, remoteRev);
        // Taking the max means our number may now be ahead of the server's.
        if (grew || (rel.messages || 0) > (data.messages || 0)) rel.dirty = true;
        if (grew) adopted += 1;
        return;
      }

      if (row.record_type === 'episode') {
        const local = episodeByKey.get(row.mem_key);
        if (!local) {
          state.episodes.push(episodeFromRow(row));
          adopted += 1;
          return;
        }
        if (!local.dirty && remoteRev > (local.rev || 1)) {
          Object.assign(local, episodeFromRow(row));
        }
      }
    });

    state.episodes.sort((a, b) => (a.endedAt || 0) - (b.endedAt || 0));
    trimEpisodes(state);
    prune(state, nowMs());

    // Only a full pull counts as being in step with the server.
    if (!only) {
      state.sync.lastPullAt = nowMs();
      state.sync.pulled = (rows || []).length;
      state.sync.lastError = null;
    }
    commit(state, { reason: 'pull', push: false });

    if (adopted) console.log(`[SpinLog] 🧠 Sage pulled ${adopted} memories from the cloud.`);
    return { ok: true, rows: (rows || []).length, adopted, partial: !!only };
  }

  // ── Push ─────────────────────────────────────────────────────────────

  function dirtyRows(state) {
    const rows = [];
    state.facts.filter(f => f.dirty).forEach(f => rows.push(rowFromFact(f)));
    if (state.recap?.dirty) rows.push(rowFromRecap(state.recap));
    if (state.rel?.dirty) rows.push(rowFromRel(state.rel));
    state.episodes.filter(e => e.dirty).forEach(e => rows.push(rowFromEpisode(e)));
    return rows;
  }

  function pendingCount() {
    const state = read();
    return dirtyRows(state).length + (state.tombstones?.length || 0);
  }

  /**
   * Write dirty records up.
   *
   * upsert on mem_key when the unique index exists, and select-then-write per
   * row when it does not — the same belt-and-braces dkCoverStore uses, because
   * the table may have been created by hand in the dashboard without the index.
   */
  async function writeRows(supabase, name, rows) {
    const { error } = await supabase.from(name).upsert(rows, { onConflict: 'mem_key' });
    if (!error) return { ok: true };

    // 42P10 is Postgres for "no unique or exclusion constraint matching the ON
    // CONFLICT specification" — i.e. the unique index on mem_key is not there,
    // which is exactly the case this fallback exists for. Matched by code as
    // well as by wording, because the wording is not ours to rely on.
    const noIndex = error.code === '42P10'
      || /no unique|on conflict|constraint matching/i.test(error.message || '');
    if (!noIndex) return { ok: false, error };
    console.warn('[SpinLog] 🧠 No unique index on mem_key — writing one row at a time.');

    // One at a time, which is slower but works on a table with no index.
    for (const row of rows) {
      const { data: found, error: readErr } = await supabase
        .from(name).select('id').eq('mem_key', row.mem_key).limit(1);
      if (readErr) return { ok: false, error: readErr };

      const { error: writeErr } = found && found.length
        ? await supabase.from(name).update(row).eq('id', found[0].id)
        : await supabase.from(name).insert([row]);
      if (writeErr) return { ok: false, error: writeErr };
    }
    return { ok: true };
  }

  // A push already on the wire, so a delete has something to wait for. See
  // settleBeforeDelete().
  let pushing = null;
  // Greater than zero while a wipe is running. Nothing goes up during one.
  let wiping = 0;

  /**
   * One push at a time, each waiting for the one before it.
   *
   * Chained rather than coalesced: returning the in-flight promise to the second
   * caller would report ITS rows as sent when they were never in the batch.
   */
  function push() {
    const run = () => runPush();
    const mine = pushing ? pushing.then(run, run) : run();
    pushing = mine;
    const release = () => { if (pushing === mine) pushing = null; };
    mine.then(release, release);
    return mine;
  }

  async function runPush() {
    // A wipe is mid-flight and local state is already empty, but the row list this
    // call would have been built from is not. Say nothing went up, because nothing
    // should.
    if (wiping) return { ok: true, pushed: 0, reason: 'wiping' };

    const supabase = await whenClient();
    if (!supabase) return { ok: false, reason: 'no-client' };

    const name = await tableName(supabase);
    if (!name) return { ok: false, reason: 'no-table' };

    const state = read();
    const rows = dirtyRows(state);
    const tombstones = (state.tombstones || []).slice();
    if (!rows.length && !tombstones.length) return { ok: true, pushed: 0 };

    // Checked again: resolving the client and the table name are both awaits, and a
    // wipe can start inside either one.
    if (wiping) return { ok: true, pushed: 0, reason: 'wiping' };

    if (rows.length) {
      const result = await writeRows(supabase, name, rows);
      if (!result.ok) {
        const failed = result.error;
        if (isMissingTable(failed)) return { ok: false, reason: 'no-table' };
        if (isMissingColumn(failed)) {
          console.warn('[SpinLog] 🧠 sage_memory is missing columns — run supabase/sage_memory.sql.');
          const s = read();
          s.sync.lastError = 'schema';
          commit(s, { reason: 'sync-error', push: false });
          return { ok: false, reason: 'schema' };
        }
        // The whole error, not just the message: Supabase puts the useful part
        // in `details` and `hint` as often as not, and a bare message like
        // "new row violates row-level security policy" without the code is a
        // guessing game.
        console.warn('[SpinLog] 🧠 Could not save her memory to the cloud:', failed);
        const s = read();
        s.sync.lastError = failed.message;
        commit(s, { reason: 'sync-error', push: false });
        return {
          ok: false,
          reason: isDenied(failed) ? 'denied' : 'error',
          error: failed.message,
          code: failed.code || null,
          details: failed.details || null,
          hint: failed.hint || null,
        };
      }
    }

    // A failed purge is KEPT QUEUED. Leaving her memory on the server after he
    // asked for it to be wiped is not something to shrug at, and the line that
    // clears the queue below used to run whether the delete worked or not — so a
    // denied delete logged a warning, dropped the tombstone, and left the rows
    // sitting in the table with nothing left to retry them.
    let purged = 0;
    let purgeError = null;
    if (tombstones.length) {
      const { error } = await supabase.from(name).delete().in('mem_key', tombstones);
      if (error) {
        purgeError = error;
        console.warn('[SpinLog] 🧠 Could not purge forgotten memories:', error.message);
      } else {
        purged = tombstones.length;
      }
    }

    // Re-read: a reply may have added a fact while the request was in flight, so
    // only the records that were actually sent get their dirty flag cleared.
    const sent = new Set(rows.map(r => r.mem_key));
    const fresh = read();
    fresh.facts.forEach(f => { if (sent.has(f.id)) f.dirty = false; });
    if (fresh.recap && sent.has('recap')) fresh.recap.dirty = false;
    if (fresh.rel && sent.has('relationship')) fresh.rel.dirty = false;
    fresh.episodes.forEach(e => { if (sent.has(e.id)) e.dirty = false; });
    // Only the tombstones the server actually accepted.
    if (purged) {
      fresh.tombstones = (fresh.tombstones || []).filter(k => !tombstones.includes(k));
    }
    fresh.sync.lastPushAt = nowMs();
    fresh.sync.pushed = rows.length;
    fresh.sync.lastError = purgeError ? purgeError.message : null;
    commit(fresh, { reason: 'push', push: false });

    if (rows.length) console.log(`[SpinLog] 🧠 Sage saved ${rows.length} memories to the cloud.`);
    return {
      ok: !purgeError,
      pushed: rows.length,
      purged,
      // Named so a caller can tell "nothing to delete" from "the delete was
      // refused and is still waiting".
      stillQueued: purgeError ? tombstones.length : 0,
      reason: purgeError ? (isDenied(purgeError) ? 'no-delete-policy' : 'error') : undefined,
      error: purgeError ? purgeError.message : undefined,
    };
  }

  // ── Orchestration ────────────────────────────────────────────────────

  let syncing = null;
  let lastSyncAt = 0;
  let pushTimer = null;

  /**
   * Pull then push, once at a time.
   * @param {{force?:boolean, pullOnly?:boolean}} [options]
   */
  function sync(options) {
    const opts = options || {};
    if (syncing) return syncing;

    const at = nowMs();
    if (!opts.force && at - lastSyncAt < SYNC_MIN_GAP_MS) {
      return Promise.resolve({ ok: true, reason: 'too-soon' });
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return Promise.resolve({ ok: false, reason: 'offline' });
    }

    lastSyncAt = at;
    syncing = (async () => {
      try {
        const pulled = await pull();
        if (!pulled.ok && (pulled.reason === 'no-table' || pulled.reason === 'no-client')) {
          if (pulled.reason === 'no-table') {
            console.warn('[SpinLog] 🧠 sage_memory table not found — run supabase/sage_memory.sql. '
              + 'Her memory stays on this device until then.');
          }
          return pulled;
        }
        if (opts.pullOnly) return pulled;
        const pushed = await push();

        // Unawaited and rate limited to once a day inside. Housekeeping must never
        // make a sync slower or a sync failure, so its outcome is not part of the
        // result either.
        housekeep().catch(() => {});

        // Hoist whichever stage failed to the top level. Returning only
        // {ok, pull, push} meant a push failure had no `reason` where callers
        // look for one, so the panel fell through to "could not reach the
        // cloud" and threw away the actual Postgres error — which is the only
        // thing that would have said what was wrong.
        const broke = !pulled.ok ? pulled : (!pushed.ok ? pushed : null);
        return {
          ok: pulled.ok && pushed.ok,
          reason: broke ? broke.reason : undefined,
          error: broke ? broke.error : undefined,
          code: broke ? broke.code : undefined,
          stage: broke ? (broke === pulled ? 'pull' : 'push') : undefined,
          pull: pulled,
          push: pushed,
        };
      } catch (err) {
        return { ok: false, reason: 'error', error: (err && err.message) || 'sync failed' };
      } finally {
        syncing = null;
        notify('sync');
      }
    })();
    return syncing;
  }

  // Once a day is plenty. This only clears rows that have been archived for over
  // a month, so there is nothing to gain from running it more often.
  const HOUSEKEEP_GAP_MS = 24 * 3600000;

  /**
   * Ask the database to clear out long-archived rows.
   *
   * `sage_memory_prune()` has existed since the first migration and nothing ever
   * called it — not the app, not pg_cron, not the keepalive workflow. Its comment
   * said "call it whenever you feel like it", which in practice meant never, so
   * every forgotten memory stayed in the table for good. Forgetting archives the
   * row rather than deleting it so the decision reaches his other devices; after
   * thirty days every device has long since seen it and the row is only weight.
   *
   * Failure is ignored on purpose. On a database where the function has not been
   * created the rpc 404s, and that is not worth a word to him — the rows are
   * tidy-up, not data.
   */
  async function housekeep(options) {
    const opts = options || {};
    const supabase = await whenClient();
    if (!supabase || !supabase.rpc) return { ok: false, reason: 'no-client' };

    const state = read();
    const last = state.sync.lastPruneAt || 0;
    if (!opts.force && nowMs() - last < HOUSEKEEP_GAP_MS) {
      return { ok: true, reason: 'too-soon' };
    }

    // Stamped before the call, so a function that does not exist is not retried
    // on every sync for the rest of the day.
    state.sync.lastPruneAt = nowMs();
    commit(state, { reason: 'housekeep', push: false });

    const { data, error } = await supabase.rpc('sage_memory_prune');
    if (error) return { ok: false, reason: 'no-function', error: error.message };
    const removed = Number(data) || 0;
    if (removed) console.log(`[SpinLog] 🧠 ${removed} long-forgotten row(s) cleared from the table.`);
    return { ok: true, removed };
  }

  /** Batch a burst of writes into one request. */
  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      push().catch(() => {});
    }, PUSH_DEBOUNCE_MS);
  }

  /**
   * Work out exactly what is stopping her memory reaching the cloud.
   *
   * A sync failure has half a dozen possible causes that all look identical
   * from outside — no client, wrong table name, missing columns, no read
   * policy, no write policy, no delete policy — and the difference matters
   * because each has a different fix. So rather than reporting the first error
   * and leaving it there, this probes each step on its own and says which one
   * actually failed.
   *
   * Writes and removes a single throwaway row, so it is safe to run whenever.
   * Exposed on SageMemory so it can be run from the console too.
   *
   * @returns {Promise<{ok:boolean, table:string|null, can:object, problem:string|null, fix:string|null, errors:object}>}
   */
  async function diagnose() {
    const out = {
      ok: false,
      table: null,
      can: { select: false, insert: false, update: false, delete: false },
      columns: { missing: [] },
      problem: null,
      fix: null,
      errors: {},
    };

    const supabase = await whenClient();
    if (!supabase) {
      out.problem = 'no-client';
      out.fix = 'The Supabase client never loaded. Check the supabase-js script tag in index.html and the browser console for a network error.';
      return out;
    }

    // Which name works, tried plainly rather than through the cached resolver.
    for (const name of [TABLE, TABLE_FALLBACK]) {
      const { error } = await supabase.from(name).select('id').limit(1);
      if (!error) { out.table = name; out.can.select = true; break; }
      out.errors[`select:${name}`] = { code: error.code || null, message: error.message };
      if (!isMissingTable(error)) {
        // The table is there; something else refused the read.
        out.table = name;
        out.problem = isDenied(error) ? 'no-read-policy' : 'read-failed';
        out.fix = isDenied(error)
          ? `The table exists but the anon key cannot read it. Run the RLS block in supabase/sage_memory.sql — it creates the "${TABLE} anon read" policy.`
          : `Reading ${name} failed: ${error.message}`;
        return out;
      }
    }

    if (!out.table) {
      out.problem = 'no-table';
      out.fix = `Neither "${TABLE}" nor "${TABLE_FALLBACK}" exists in the public schema. Run supabase/sage_memory.sql once in the SQL editor.`;
      return out;
    }

    // Every column this module writes. A missing one is the difference between
    // "run the SQL" and "the SQL ran but only partly".
    const NEEDED = [
      'mem_key', 'record_type', 'device_id', 'content', 'kind', 'topic', 'source',
      'weight', 'confidence', 'pinned', 'hits', 'learned_at', 'last_seen_at',
      'expires_at', 'superseded_by', 'archived_at', 'data', 'rev', 'updated_at',
    ];
    for (const column of NEEDED) {
      const { error } = await supabase.from(out.table).select(column).limit(1);
      if (error && isMissingColumn(error)) out.columns.missing.push(column);
    }
    if (out.columns.missing.length) {
      out.problem = 'schema';
      out.fix = `The table is missing ${out.columns.missing.length} column(s): ${out.columns.missing.join(', ')}. `
        + 'Run supabase/sage_memory.sql again — the add-column block is idempotent.';
      return out;
    }

    // Insert, update, delete, on a row that is obviously disposable.
    const probeKey = `__diagnose_${nowMs().toString(36)}`;
    // Through baseRow, so this probe exercises the same full column set a real
    // write uses. A cut-down probe would have passed while the real push failed,
    // which is the opposite of what a diagnostic is for.
    const probe = {
      ...baseRow(probeKey, 'fact'),
      content: 'connection test — safe to delete',
      archived_at: new Date().toISOString(),
    };

    const inserted = await supabase.from(out.table).insert([probe]);
    if (inserted.error) {
      out.errors.insert = { code: inserted.error.code || null, message: inserted.error.message };
      out.problem = isDenied(inserted.error) ? 'no-insert-policy' : 'insert-failed';
      out.fix = isDenied(inserted.error)
        ? `The anon key can read ${out.table} but not write to it. Run the RLS block in supabase/sage_memory.sql — it creates the "${TABLE} anon insert" policy.`
        : `Inserting failed: ${inserted.error.message}`;
      return out;
    }
    out.can.insert = true;

    const updated = await supabase.from(out.table)
      .update({ content: 'connection test — updated' }).eq('mem_key', probeKey).select('id');
    if (updated.error || !(updated.data && updated.data.length)) {
      out.errors.update = updated.error
        ? { code: updated.error.code || null, message: updated.error.message }
        : { code: null, message: 'the update matched no rows' };
      out.problem = 'no-update-policy';
      out.fix = `${out.table} has no working UPDATE policy for the anon key, so she can add memories but never change one. `
        + 'Run the RLS block in supabase/sage_memory.sql.';
    } else {
      out.can.update = true;
    }

    const removed = await supabase.from(out.table).delete().eq('mem_key', probeKey).select('id');
    if (removed.error || !(removed.data && removed.data.length)) {
      out.can.delete = false;
      out.errors.delete = removed.error
        ? { code: removed.error.code || null, message: removed.error.message }
        : { code: null, message: 'the delete matched no rows' };
      // Not fatal on its own: forgetting normally archives rather than deletes.
      // Only "forget everything" needs this, so it does not mask a worse problem.
      if (!out.problem) {
        out.problem = 'no-delete-policy';
        out.fix = `${out.table} has no DELETE policy for the anon key. Everything works except purging her memory completely. `
          + 'Run the RLS block in supabase/sage_memory.sql.';
      }
    } else {
      out.can.delete = true;
    }

    out.ok = !out.problem;
    if (out.ok) out.fix = null;
    console.log('[SpinLog] 🧠 Memory diagnosis:', out);
    return out;
  }

  function syncState() {
    const state = read();
    return {
      ...state.sync,
      pending: pendingCount(),
      online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
      hasClient: !!client(),
      syncing: !!syncing,
    };
  }

  /**
   * The plans she is holding that have not happened yet.
   *
   * She already classifies "we are going out tomorrow" and "i'll check the
   * brakes before we ride" as kind 'plan' or 'promise', and horizonFor() gives
   * them an expiresAt from the words he used. Nothing read that back, so a plan
   * she had written down only surfaced if he thought to ask — which is the one
   * situation where being asked is too late.
   *
   * A promise has no horizon by design (an open-ended "i'll get the chain done"
   * should not expire), so those are included with a null `when` and left to the
   * caller to rate-limit.
   *
   * Soonest first, so a caller taking the head of the list gets the one that
   * matters most.
   *
   * @param {number} [now]
   * @returns {Array<{id:string, text:string, kind:string, at:number, when:number|null, daysLeft:number|null}>}
   */
  function upcomingPlans(now) {
    const at = now || nowMs();
    const day = 86400000;

    return read().facts
      .filter(f => f
        && !f.archivedAt
        && !f.supersededBy
        && (f.kind === 'plan' || f.kind === 'promise')
        // A plan whose horizon has passed is history, not a plan. Promises have
        // no horizon and stay until he says otherwise.
        && (!f.expiresAt || f.expiresAt > at))
      .map(f => ({
        id: f.id,
        text: f.text,
        kind: f.kind,
        at: f.at || null,
        when: f.expiresAt || null,
        // horizonFor() adds two days of slack past the day itself, so this is a
        // window rather than a deadline. Good enough to sort and to decide
        // whether something is imminent.
        daysLeft: f.expiresAt ? Math.max(0, Math.round((f.expiresAt - at) / day) - 2) : null,
      }))
      .sort((a, b) => {
        if (a.when && b.when) return a.when - b.when;
        if (a.when) return -1;      // dated before open-ended
        if (b.when) return 1;
        return (b.at || 0) - (a.at || 0);
      });
  }

  /**
   * Bring her memory back from the cloud, adding nothing to it.
   *
   * pull() has always been able to do this, but nothing in the UI could ask for
   * it on its own — only "Sync now", which pushes as well. On a device that has
   * lost its local copy that distinction matters: you want to be able to say
   * "take what the cloud has" without any risk of the empty local state being
   * written over it.
   *
   * @param {object} [opts]
   * @param {string[]} [opts.keys] Restore only these mem_keys, from listRemote().
   * @returns {Promise<{ok:boolean, reason?:string, restored?:number, rows?:number}>}
   */
  async function restore(opts) {
    const before = count();
    const pulled = await pull(opts);
    if (!pulled.ok) return pulled;
    return {
      ok: true,
      restored: Math.max(0, count() - before),
      adopted: pulled.adopted || 0,
      rows: pulled.rows || 0,
      partial: !!pulled.partial,
    };
  }

  /**
   * Everything the cloud holds, as a list you can choose from.
   *
   * restore() is all-or-nothing, which is the right default and the wrong only
   * option: the cloud copy can hold one thing she got wrong next to thirty she
   * got right, and a device coming back from a wipe should not have to take the
   * mistake to get the rest.
   *
   * Split into two lists because they come back by two different routes.
   * `restorable` is live facts this device does not have — restore({keys}) takes
   * those. `forgotten` is archived rows, which restore correctly refuses to
   * resurrect; recoverForgotten({keys}) is the way back for those.
   *
   * Sorted newest first, and nothing already known is included, so the list is
   * only ever the things that are actually missing.
   *
   * @returns {Promise<{ok:boolean, reason?:string, restorable:object[], forgotten:object[]}>}
   */
  async function listRemote() {
    const supabase = await whenClient();
    if (!supabase) return { ok: false, reason: 'no-client', restorable: [], forgotten: [] };
    const name = await tableName(supabase);
    if (!name) return { ok: false, reason: 'no-table', restorable: [], forgotten: [] };

    const { data, error } = await supabase.from(name)
      .select('*').eq('record_type', 'fact');
    if (error) {
      console.warn('[SpinLog] 🧠 Could not list the cloud memory:', error.message);
      return {
        ok: false,
        reason: isMissingColumn(error) ? 'schema' : (isDenied(error) ? 'denied' : 'error'),
        error: error.message,
        restorable: [],
        forgotten: [],
      };
    }

    const state = read();
    // Anything queued for deletion is already gone as far as he is concerned, so
    // the chooser must not offer it back.
    const doomed = new Set(state.tombstones || []);
    const here = new Set(state.facts.filter(f => !f.archivedAt).map(f => f.id));
    // Matched on wording as well as key, for the same reason pull() does: the
    // same thing learned on two devices has two ids, and offering to restore
    // something she already knows under different wording is a broken promise.
    const prints = new Set(state.facts
      .filter(f => !f.archivedAt && !f.supersededBy)
      .map(f => fingerprint(f.text)));

    const restorable = [];
    const forgotten = [];

    (data || []).forEach(row => {
      if (!row || !row.mem_key || !row.content) return;
      if (doomed.has(row.mem_key)) return;
      const fact = factFromRow(row);
      if (!fact) return;
      const entry = {
        key: row.mem_key,
        text: fact.text,
        kind: fact.kind || 'fact',
        topic: fact.topic || '',
        at: fact.at || ms(row.learned_at) || ms(row.updated_at) || null,
        pinned: !!fact.pinned,
      };
      if (row.archived_at) {
        // Nothing to bring back if she already knows it, however it got there.
        if (!prints.has(fingerprint(entry.text))) forgotten.push(entry);
        return;
      }
      if (here.has(row.mem_key)) return;
      if (prints.has(fingerprint(entry.text))) return;
      restorable.push(entry);
    });

    const newestFirst = (a, b) => (b.at || 0) - (a.at || 0);
    restorable.sort(newestFirst);
    forgotten.sort(newestFirst);
    return { ok: true, restorable, forgotten };
  }

  /**
   * What the cloud is holding, and how much of it this device lacks.
   *
   * Reads three columns rather than the whole bank, so the panel can show honest
   * numbers on open without pulling. "Nothing came back" and "there was nothing
   * to come back" are different answers and the panel could not tell them apart.
   *
   * @returns {Promise<{rows:number, facts:number, missingHere:number, hasRecap:boolean, episodes:number}|null>}
   */
  async function remoteSummary() {
    const supabase = await whenClient();
    if (!supabase) return null;
    const name = await tableName(supabase);
    if (!name) return null;

    // Scoped to HER record types. This table also holds park spots, chat messages
    // and app settings now (see cloud-store.js), and counting those as part of her
    // memory would report "42 rows, 3 memories" and make the panel look broken
    // when it was simply looking at the wrong thing.
    const { data, error } = await supabase.from(name)
      .select('mem_key, record_type, archived_at')
      .in('record_type', RECORD_TYPES);
    if (error) {
      console.warn('[SpinLog] 🧠 Could not size the cloud memory:', error.message);
      return null;
    }

    // A row queued for deletion is not counted. Otherwise the Restore button keeps
    // its "there is something waiting" dot for the rows it has just been told to
    // destroy, which reads as the delete having failed.
    const doomed = new Set(read().tombstones || []);
    const rows = (data || []).filter(r => r && r.mem_key && !doomed.has(r.mem_key));
    const factRows = rows.filter(r => r.record_type === 'fact');
    const liveFactRows = factRows.filter(r => !r.archived_at);
    const here = new Set(read().facts.map(f => f.id));

    // Reported in full, because "the table has rows" and "she remembers things"
    // are not the same claim and the panel could not previously tell them apart.
    // A forgotten fact is still a row; so are the counters and the recap.
    const byType = {};
    rows.forEach(r => {
      const key = r.archived_at ? `${r.record_type}:forgotten` : r.record_type;
      byType[key] = (byType[key] || 0) + 1;
    });

    return {
      rows: rows.length,
      facts: liveFactRows.length,
      archivedFacts: factRows.length - liveFactRows.length,
      missingHere: liveFactRows.filter(r => !here.has(r.mem_key)).length,
      hasRecap: rows.some(r => r.record_type === 'recap' && !r.archived_at),
      episodes: rows.filter(r => r.record_type === 'episode' && !r.archived_at).length,
      byType,
    };
  }

  /**
   * Bring back facts that were forgotten rather than lost.
   *
   * Forgetting is a soft delete: the row stays, with archived_at set, so the
   * forget reaches his other devices instead of the fact reappearing on their
   * next push. The consequence is that a table can be full of rows while she
   * remembers nothing — and restore, which only ever takes live facts, correctly
   * declines to resurrect them.
   *
   * This is the deliberate way back. Separate from restore because undoing a
   * forget is a different intention from recovering a lost device.
   *
   * @param {object} [opts]
   * @param {string[]} [opts.keys] Recover only these mem_keys, from listRemote().
   * @returns {Promise<{ok:boolean, reason?:string, recovered?:number, found?:number}>}
   */
  async function recoverForgotten(opts) {
    const only = opts && Array.isArray(opts.keys) ? new Set(opts.keys) : null;
    if (only && !only.size) return { ok: true, recovered: 0, found: 0, partial: true };

    const supabase = await whenClient();
    if (!supabase) return { ok: false, reason: 'no-client' };
    const name = await tableName(supabase);
    if (!name) return { ok: false, reason: 'no-table' };

    const { data, error } = await supabase.from(name)
      .select('*').eq('record_type', 'fact').not('archived_at', 'is', null);
    if (error) {
      console.warn('[SpinLog] 🧠 Could not read the forgotten memories:', error.message);
      return { ok: false, reason: isMissingColumn(error) ? 'schema' : 'error', error: error.message };
    }

    // Same guard as pull(): a key queued for deletion is not a candidate for
    // recovery, or "delete for good" followed by "bring back" would resurrect it
    // from a row that is about to disappear.
    const doomed = new Set(read().tombstones || []);
    const rows = (data || []).filter(r =>
      r && r.mem_key && r.content
      && !doomed.has(r.mem_key)
      && (!only || only.has(r.mem_key)));
    if (!rows.length) return { ok: true, recovered: 0, found: 0, partial: !!only };

    const state = read();
    const now = nowMs();
    let recovered = 0;

    rows.forEach(row => {
      const fact = factFromRow(row);
      if (!fact) return;
      // Already live under some id? Then there is nothing to bring back.
      const print = fingerprint(fact.text);
      if (state.facts.some(f => !f.archivedAt && !f.supersededBy && fingerprint(f.text) === print)) return;

      fact.archivedAt = null;
      fact.supersededBy = null;
      fact.lastSeenAt = now;
      fact.rev = (fact.rev || 1) + 1;
      fact.dirty = true;          // so the un-forget reaches the other devices too

      const existing = state.facts.find(f => f.id === fact.id);
      if (existing) Object.assign(existing, fact);
      else state.facts.push(fact);
      recovered += 1;
    });

    if (recovered) {
      prune(state, now);
      // push: false, then pushed by hand below. commit() only *schedules* a push
      // 1.5s later, and the panel re-reads the cloud the instant this resolves —
      // so the rows it read still had archived_at set and the Forgotten count
      // stayed at 1 after a successful recovery. The count was right about the
      // server and wrong about what had just happened.
      commit(state, { reason: 'recover', push: false });
      const sent = await push();
      console.log(`[SpinLog] 🧠 Recovered ${recovered} forgotten memory(ies).`);
      if (!sent.ok) {
        // Local memory is correct either way; the cloud catches up when it can.
        return {
          ok: true, recovered, found: rows.length, partial: !!only,
          pending: true, error: sent.error,
        };
      }
    }
    return { ok: true, recovered, found: rows.length, partial: !!only };
  }

  /**
   * Delete for good. No archive, no way back.
   *
   * forget() is a soft delete on purpose: the row stays with archived_at set so
   * the forget reaches his other devices instead of the fact being pushed back
   * up by the next one to sync. The cost is that "forgotten" is a state you
   * accumulate, and there was no way to empty it — a memory he had deliberately
   * dropped stayed listed as recoverable forever.
   *
   * This is the other half. The rows are queued as tombstones, which push()
   * turns into a real DELETE, and the facts leave local state entirely rather
   * than being marked. Nothing can bring them back afterwards, including this
   * app and his other phones.
   *
   * @param {string[]} [keys] Which to destroy. Omitted means every forgotten one.
   * @returns {Promise<{ok:boolean, purged:number, pending?:boolean, reason?:string}>}
   */
  async function purge(keys) {
    const only = Array.isArray(keys) ? new Set(keys) : null;
    if (only && !only.size) return { ok: true, purged: 0 };

    const state = read();
    // With a list, take exactly what was named, whether or not it was forgotten
    // first — "delete this for good" should not need a forget as a prerequisite.
    const doomed = state.facts.filter(f => (only ? only.has(f.id) : !!f.archivedAt));
    const ids = new Set(doomed.map(f => f.id));

    // A named key with no local fact is still destroyed. The chooser lists what
    // the CLOUD holds, and prune() drops archived facts older than
    // TOMBSTONE_KEEP_MS from this device — so the rows most in need of purging
    // are exactly the ones that may not be here to filter out.
    if (only) {
      only.forEach(key => ids.add(key));
    } else {
      // No list means "empty the archive", and local state cannot answer that on
      // its own for the same reason: a fact forgotten two months ago has already
      // been pruned from this device while its row sits in the table. Reading the
      // archived keys back is the difference between emptying the archive and
      // emptying the recent part of it.
      const supabase = await whenClient();
      const name = supabase ? await tableName(supabase) : null;
      if (name) {
        const { data, error } = await supabase.from(name)
          .select('mem_key').eq('record_type', 'fact').not('archived_at', 'is', null);
        if (error) {
          console.warn('[SpinLog] 🧠 Could not list the archive to purge it:', error.message);
          return { ok: false, reason: isDenied(error) ? 'denied' : 'error', error: error.message };
        }
        (data || []).forEach(r => { if (r && r.mem_key) ids.add(r.mem_key); });
      }
    }
    if (!ids.size) return { ok: true, purged: 0 };

    // The texts about to be destroyed, so they can be taken out of anything that
    // quotes them. Only the ones this device actually holds — a named key with no
    // local fact has no wording here to match on.
    const goneTexts = new Set(doomed.map(f => f.text).filter(Boolean));

    state.facts = state.facts.filter(f => !ids.has(f.id));

    // An episode keeps up to six fact texts VERBATIM in its `learned` list, so a
    // memory deleted for good was still sitting there in full, in a row right
    // beside the one that was removed. Scrubbed for the same reason "forget
    // everything" now takes the conversation with it: destroying the index and
    // leaving the quotation is not destroying anything.
    //
    // The episode itself stays. It is a timeline entry — when they talked and for
    // how long — and that survives its subject being deleted; what cannot survive
    // is the wording.
    let scrubbed = 0;
    if (goneTexts.size) {
      state.episodes.forEach(ep => {
        if (!Array.isArray(ep.learned) || !ep.learned.length) return;
        const kept = ep.learned.filter(text => !goneTexts.has(text));
        if (kept.length === ep.learned.length) return;
        ep.learned = kept;
        ep.rev = (ep.rev || 1) + 1;
        ep.dirty = true;      // so the scrub reaches the row, and his other devices
        scrubbed += 1;
      });
    }

    // Capped the same way read() caps them, so a big purge cannot grow the
    // stored state without bound.
    state.tombstones = [...new Set([...(state.tombstones || []), ...ids])].slice(0, 500);
    commit(state, { reason: 'purge', push: false });

    const sent = await push();
    if (!sent.ok || sent.stillQueued) {
      // The local copy is gone and the tombstones are still queued, so this is
      // "not yet" rather than "did not work".
      return {
        ok: true,
        purged: ids.size,
        scrubbed,
        pending: true,
        reason: sent.reason || 'offline',
        error: sent.error,
      };
    }
    console.log(`[SpinLog] 🧠 Purged ${ids.size} memory(ies) for good.`);
    if (scrubbed) {
      console.log(`[SpinLog] 🧠 …and took their wording out of ${scrubbed} conversation record(s).`);
    }
    return { ok: true, purged: ids.size, scrubbed };
  }

  // ══ WIPE ═════════════════════════════════════════════════════════════

  /**
   * Stop anything queued or on the wire from writing back what is about to go.
   *
   * THIS is what left one `relationship` row in the table after every chat clear,
   * and it is worth spelling out, because the symptom pointed at the delete and
   * the delete was fine.
   *
   * push() builds its batch from whatever is dirty, sends one upsert, and only
   * clears the dirty flags when the response comes back. Clearing the chat inside
   * that window did all of its work between the request and the response:
   *
   *   push    reads rel — dirty, 23 messages — upsert goes out  ─────────┐
   *   clear   local rel blanked and marked clean, DELETE relationship ───┤ lands
   *   upsert lands: the row is back, still saying 23 messages  ──────────┘ second
   *
   * The delete worked. The upsert simply landed after it. And the row left behind
   * was then unreachable — local state said there was nothing to delete, so no
   * later clear would go near it, and nothing but the table itself showed it was
   * there. A couple of seconds either way and the same click came out clean, which
   * is how it survived a round of testing.
   *
   * cloud-store.js already had half of this lesson: its clearChat() opens with
   * cancel('chat') so a debounced insert cannot put the turns back. A debounce is
   * only the easy half, though. A request already on the wire has to be waited out,
   * and one that starts mid-delete has to be refused — which is what `wiping` does.
   */
  async function settleBeforeDelete() {
    // The queued one: drop it, the rows it would send are about to be wrong.
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
    // The ones already running: let them finish, so the delete is genuinely last.
    // Their failure is not this function's business, only their timing.
    if (pushing) { try { await pushing; } catch { /* timing, not outcome */ } }
    if (syncing) { try { await syncing; } catch { /* timing, not outcome */ } }
  }

  /**
   * Delete every row of these record types, then look, because a delete that
   * removed nothing is indistinguishable from one that worked.
   *
   * Two ways it silently does nothing, and neither reports an error:
   *   · no DELETE policy — PostgREST affects zero rows and returns success, which
   *     supabase/cloud_routing.sql spells out at length
   *   · a write landing afterwards — settleBeforeDelete() closes that off for this
   *     device; his other phone pushing at the same moment is not ours to stop
   *
   * So: delete, read back, delete whatever is still there by primary key, read
   * back again. Rows surviving a delete by id that reported success can only be
   * the policy, and saying so is worth more than a second cheerful "cleared".
   */
  async function wipeTypes(supabase, name, types) {
    const first = await supabase.from(name).delete().in('record_type', types);
    if (first.error) {
      return {
        ok: false,
        reason: isDenied(first.error) ? 'no-delete-policy' : 'error',
        error: first.error.message,
      };
    }

    const left = await supabase.from(name).select('id').in('record_type', types);
    // Cannot read it back, so cannot claim it is gone. The delete did not complain,
    // which is the most that can honestly be said.
    if (left.error) return { ok: true, verified: false };

    const ids = (left.data || []).map(r => r && r.id).filter(id => id !== null && id !== undefined);
    if (!ids.length) return { ok: true, verified: true, left: 0 };

    console.warn(`[SpinLog] 🧠 ${ids.length} row(s) outlived the delete — going again by id.`);
    const second = await supabase.from(name).delete().in('id', ids);
    if (second.error) {
      return {
        ok: false,
        reason: isDenied(second.error) ? 'no-delete-policy' : 'error',
        error: second.error.message,
        left: ids.length,
      };
    }

    const still = await supabase.from(name).select('id').in('record_type', types);
    if (still.error) return { ok: true, verified: false, retried: ids.length };
    const remaining = (still.data || []).length;
    if (!remaining) return { ok: true, verified: true, left: 0, retried: ids.length };

    return { ok: false, reason: 'no-delete-policy', verified: true, left: remaining };
  }

  /**
   * Wipe everything she has learned, in the database as well as here.
   *
   * This used to build the delete list from local state — every fact id, every
   * episode id, plus 'recap' and 'relationship' — and queue those as tombstones.
   * Which deleted exactly the rows THIS DEVICE happened to know about, and
   * nothing else. Two ways that left rows behind:
   *
   *   · prune() drops archived facts older than TOMBSTONE_KEEP_MS (30 days) from
   *     the device, so anything forgotten a while ago was not in the list.
   *   · a fact only ever written on another phone is not here to enumerate.
   *
   * So "forget everything" emptied the screen and left the table populated, which
   * is exactly what was reported. It deletes BY RECORD TYPE now: one statement,
   * no local list, nothing to be out of date about.
   *
   * Awaited rather than fire-and-forget, so the panel can report what actually
   * happened instead of reading the cloud back before the delete has landed.
   *
   * @returns {Promise<{ok:boolean, reason?:string, pending?:boolean}>}
   */
  /**
   * Forget the CONVERSATION without forgetting what she learned from it.
   *
   * Clearing the chat used to delete the `message` rows and stop there, which left
   * the table holding her record of a conversation that no longer existed: the
   * relationship counters still said "23 messages across 4 conversations", the
   * episodes still listed when each of them happened, and the recap still
   * summarised messages that had been deleted. With no memories saved, clearing the
   * chat left exactly one row on screen and nothing that could shift it.
   *
   * The line this draws: anything that is a RECORD OF the talking goes with the
   * talking. Anything she LEARNED from it stays. That is what the dialog has always
   * promised — "only the messages go, she still knows the N things she has learned
   * about you" — and the N things are the facts.
   *
   * Deleted by record_type rather than from a local id list, for the reason clear()
   * already had to learn: this device only knows the episodes it has not pruned,
   * and rows written on his other phone were never enumerable here at all.
   */
  async function forgetConversations() {
    // Before anything else: no push may be holding the counters we are about to
    // delete, or it lands after the delete and puts the row back.
    await settleBeforeDelete();

    wiping += 1;
    try {
      const state = read();
      const fresh = blank();

      // Facts and their tombstones survive untouched.
      state.episodes = [];
      state.recap = null;
      state.rel = fresh.rel;
      // Explicitly not dirty. A queued push would otherwise re-create the row we
      // are about to delete, a second after deleting it.
      state.rel.dirty = false;
      commit(state, { reason: 'forget-conversations', push: false });

      const supabase = await whenClient();
      if (!supabase) return { ok: true, pending: true, reason: 'no-client' };
      const name = await tableName(supabase);
      if (!name) return { ok: true, pending: true, reason: 'no-table' };

      const wiped = await wipeTypes(supabase, name, CONVERSATION_TYPES);
      if (!wiped.ok) {
        console.warn('[SpinLog] 🧠 Could not clear her record of the conversation:',
          wiped.error || wiped.reason);
        return { ok: true, pending: true, reason: wiped.reason, left: wiped.left };
      }

      console.log('[SpinLog] 🧠 Her record of the conversation is gone. Her memories are not.');
      return { ok: true, verified: wiped.verified !== false };
    } finally {
      wiping -= 1;
    }
  }

  async function clear() {
    // Same race as forgetConversations(), with more to lose: an in-flight push
    // holds facts as well as counters, so one landing late resurrects memories he
    // asked to be rid of.
    await settleBeforeDelete();

    wiping += 1;
    try {
      const state = read();
      const fresh = blank();
      fresh.sync.table = state.sync.table;
      // No tombstones. The delete below does not need them, and leaving them queued
      // would have push() try the same rows again with a list that is already gone.
      commit(fresh, { reason: 'clear', push: false });
      console.log('[SpinLog] 🧠 Sage has forgotten everything on this device.');

      const supabase = await whenClient();
      if (!supabase) return { ok: true, pending: true, reason: 'no-client' };
      const name = await tableName(supabase);
      if (!name) return { ok: true, pending: true, reason: 'no-table' };

      const wiped = await wipeTypes(supabase, name, RECORD_TYPES);
      if (!wiped.ok) {
        console.warn('[SpinLog] 🧠 Could not clear her memory in the cloud:',
          wiped.error || wiped.reason);
        return { ok: true, pending: true, reason: wiped.reason, left: wiped.left };
      }

      console.log('[SpinLog] 🧠 …and in the cloud.');
      return { ok: true, verified: wiped.verified !== false };
    } finally {
      wiping -= 1;
    }
  }

  // ══ EXPORT / IMPORT ══════════════════════════════════════════════════

  /** Her whole memory as a file he can keep. */
  function exportAll() {
    const state = read();
    return {
      app: 'SpinLog',
      what: 'sage-memory',
      v: VERSION,
      exportedAt: new Date().toISOString(),
      facts: state.facts.filter(f => !f.archivedAt).map(f => ({
        text: f.text, kind: f.kind, topic: f.topic, at: f.at,
        lastSeenAt: f.lastSeenAt, hits: f.hits, pinned: f.pinned,
        confidence: f.confidence, weight: f.weight,
      })),
      recap: state.recap ? { text: state.recap.text, at: state.recap.at } : null,
      episodes: state.episodes,
      rel: {
        firstSeenAt: state.rel.firstSeenAt,
        lastTalkedAt: state.rel.lastTalkedAt,
        conversations: state.rel.conversations,
        messages: state.rel.messages,
        longestGapDays: state.rel.longestGapDays,
      },
    };
  }

  /** Merge a previously exported memory back in. Never destructive. */
  function importAll(payload) {
    let data = payload;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { return { ok: false, reason: 'unreadable' }; }
    }
    if (!data || data.what !== 'sage-memory') return { ok: false, reason: 'not-mine' };

    let added = 0;
    (Array.isArray(data.facts) ? data.facts : []).forEach(f => {
      if (!f || !f.text) return;
      const stored = remember(f.text, {
        kind: f.kind, topic: f.topic, source: 'import',
        pinned: f.pinned, confidence: f.confidence, weight: f.weight,
        now: f.at || nowMs(),
      });
      if (stored.ok && stored.reason === 'added') added += 1;
    });

    const state = read();
    if (data.recap?.text && !state.recap?.text) {
      state.recap = { text: data.recap.text, throughTurns: 0, at: data.recap.at || nowMs(), rev: 1, dirty: true };
    }
    if (data.rel) {
      state.rel.firstSeenAt = Math.min(state.rel.firstSeenAt || Infinity, data.rel.firstSeenAt || Infinity) || null;
      if (!Number.isFinite(state.rel.firstSeenAt)) state.rel.firstSeenAt = data.rel.firstSeenAt || null;
      state.rel.messages = Math.max(state.rel.messages || 0, data.rel.messages || 0);
      state.rel.conversations = Math.max(state.rel.conversations || 0, data.rel.conversations || 0);
      state.rel.longestGapDays = Math.max(state.rel.longestGapDays || 0, data.rel.longestGapDays || 0);
      state.rel.rev = (state.rel.rev || 1) + 1;
      state.rel.dirty = true;
    }
    commit(state, { reason: 'import' });
    return { ok: true, added };
  }

  // ══ BOOT ═════════════════════════════════════════════════════════════

  /**
   * Get the bank in step with the server, then keep it there.
   * Everything here is best-effort: a failure leaves her working from the local
   * mirror, which is the same place she worked from before any of this existed.
   */
  function boot() {
    const start = () => {
      sync({ force: true }).catch(() => {});
    };

    if (typeof document !== 'undefined' && document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }

    if (root.addEventListener) {
      // Coming back online is the moment a queued write can finally land.
      root.addEventListener('online', () => sync({ force: true }).catch(() => {}));
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        const last = read().sync.lastPullAt || 0;
        if (nowMs() - last > PULL_STALE_MS) sync().catch(() => {});
      });
    }
  }

  root.SageMemory = {
    STORAGE, VERSION, MAX_FACTS, FACTS_IN_PROMPT, RECAP_AFTER_TURNS,
    TABLE, KINDS, RECORD_TYPES, HALF_LIFE_DAYS,
    // facts
    remember, forget, revise, pin, facts, recall, count, stats,
    absorb, fingerprint, classify, topicOf, score, relevance, overlap, stem,
    contradicts, refines, sameOccasion, occasionTokens, subjectTokens, overlapWords,
    horizonFor, findByText, sweep, upcomingPlans,
    // the net under the model, for plans she did not keep herself
    glean, plainWords, saidPart,
    // relationship + timeline
    noteMessage, relationship, episodes,
    // recap
    consolidate, recap,
    // prompt
    promptBlock,
    // cloud
    sync, pull, push, restore, recoverForgotten, purge, listRemote, remoteSummary,
    syncState, diagnose, housekeep, trimEpisodes,
    isMissingTable, isMissingColumn, isDenied, TABLE_FALLBACK,
    // whole bank
    read, clear, forgetConversations, CONVERSATION_TYPES,
    exportAll, importAll, onChange, deviceId,
  };

  boot();
})(typeof self !== 'undefined' ? self : this);
