// ════════════════════════════════════════════════════════════════════════
// SPINLOG — CLOUD STORE
//
// The last of the data that only existed on whichever machine you typed it into.
// It now lives in the database and is read back from there, so a laptop and a
// phone show the same thing.
//
//   park history    where the bike was left
//   conversation    your messages with her
//   purchase date   the override that lines "together for" up with your papers
//   upload notes    text about one historic upload
//   upload dates    the date that upload is FROM, not when it was uploaded
//
// NO NEW TABLES, and that shaped the design rather than being a constraint worked
// around. Notes and dates are columns on media_files, the row they describe —
// they were a JSON map keyed by row id, which is a foreign key pretending not to
// be one. The other three are record types in sage_memory, which was built to
// hold several kinds of row told apart by record_type and already has the unique
// mem_key index, a jsonb column, updated_at, and a full RLS set including DELETE.
//
//   record_type = 'park'      content = address, data = { lat, lng, accuracy }
//   record_type = 'message'   content = the text, data = { role, file }
//   record_type = 'setting'   content = the value
//
// An earlier attempt at this was one key/value table of JSON blobs. It worked and
// it was the wrong shape: nothing could be queried, ordered or counted, and a
// single parked spot could not be deleted without rewriting the whole list. Every
// read here is a real query and every delete removes a real row.
//
// READS ARE SYNCHRONOUS, from a cache that load() fills once. The call sites are
// render paths that expect a value in hand; making a dozen of them async to await
// a round trip would have traded a sync bug for a screen of spinners. The cache is
// memory only — nothing is written to localStorage, which is the point.
//
// SageMemory.pull() ignores record types it does not know, and clear() only ever
// tombstones fact / episode / recap / relationship keys. So none of this is
// touched by her memory syncing or by "forget everything", which is correct: where
// you parked is not something she remembers about you.
// ════════════════════════════════════════════════════════════════════════

window.dkCloudStore = (function () {
  'use strict';

  const TABLE = 'sage_memory';
  const MEDIA_TABLE = 'media_files';

  // What each list is capped at. The cap is applied in the cloud, not just on
  // screen, so a year of parking does not accumulate for ever.
  const PARK_KEEP = 5;
  const CHAT_KEEP = 80;

  // How many rows of one type load() will read. Comfortably above both caps, so
  // there is room to SEE the surplus and delete it — a limit set exactly at the cap
  // would make over-cap rows invisible again, which is the bug this replaces.
  const READ_LIMIT = 400;

  // The client is built inside script.js's DOMContentLoaded and this file runs
  // before it, so waiting beats assuming.
  const CLIENT_WAIT_TRIES = 40;
  const CLIENT_WAIT_GAP_MS = 250;

  // Written on every change, sent shortly after. Typing a note fires a write per
  // keystroke in some call sites and each one does not need its own request.
  const PUSH_DEBOUNCE_MS = 800;

  const cache = {
    park: [],          // [{ at, lat, lng, accuracy, address }] newest first
    chat: [],          // [{ role, text, at, file }] oldest first
    settings: {},      // { ageFrom: '2024-06-27' }
    notes: {},         // { [mediaRowId]: 'text' }
    dates: {},         // { [mediaRowId]: '2025-04-02' }
  };

  const listeners = new Set();
  const timers = new Map();
  let loaded = false;
  let missing = false;      // the columns/table are not there yet
  let clientWait = null;

  // ══ Plumbing ═══════════════════════════════════════════════════════════

  function client() {
    return window.supabaseClient || null;
  }

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

  function isMissing(error) {
    if (!error) return false;
    return error.code === '42P01' || error.code === '42703'
      || /does not exist|schema cache|not find the table|column/i.test(error.message || '');
  }

  function offline() {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  }

  function deviceId() {
    const hers = window.SageMemory && window.SageMemory.deviceId;
    if (typeof hers === 'function') {
      try { return hers(); } catch { /* fall through */ }
    }
    return 'unknown';
  }

  function notify(what) {
    listeners.forEach(fn => {
      try { fn(what); } catch { /* a bad listener must not break a write */ }
    });
  }

  function iso(ms) {
    const d = new Date(Number(ms) || Date.now());
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }

  /**
   * Write one sage_memory row, or update it if the mem_key is already there.
   *
   * Select-then-write rather than upsert, matching dkCoverStore and SageMemory:
   * it works whether or not the unique index on mem_key is reported in the schema
   * cache the way onConflict needs.
   */
  async function writeRow(row) {
    if (missing || offline()) return false;
    const supabase = await whenClient();
    if (!supabase) return false;

    const { data: found, error: readErr } = await supabase
      .from(TABLE).select('id').eq('mem_key', row.mem_key).limit(1);
    if (readErr) {
      if (isMissing(readErr)) missing = true;
      else console.warn(`[SpinLog] ☁️ Could not check ${row.mem_key}:`, readErr.message);
      return false;
    }

    const { error } = found && found.length
      ? await supabase.from(TABLE).update(row).eq('mem_key', row.mem_key)
      : await supabase.from(TABLE).insert([row]);

    if (error) {
      if (isMissing(error)) missing = true;
      else console.warn(`[SpinLog] ☁️ Could not save ${row.mem_key}:`, error.message);
      return false;
    }
    return true;
  }

  async function deleteKeys(keys) {
    if (!keys.length || missing || offline()) return false;
    const supabase = await whenClient();
    if (!supabase) return false;
    const { error } = await supabase.from(TABLE).delete().in('mem_key', keys);
    if (error) {
      if (isMissing(error)) missing = true;
      // A refused delete is worth naming: without the policy it returns no error
      // at all, so this branch means something else went wrong.
      else console.warn('[SpinLog] ☁️ Could not delete:', error.message);
      return false;
    }
    return true;
  }

  /**
   * Delete every row of one type.
   *
   * For "clear all of it", which cannot be done from a local key list. This device
   * only ever holds the newest CHAT_KEEP turns and PARK_KEEP spots, so a list built
   * from the cache leaves behind everything older than that window and everything
   * only ever written on the other phone — you clear the conversation, the screen
   * empties, and the table is still full. SageMemory.clear() needed exactly this
   * correction for the same reason.
   */
  async function deleteByType(type) {
    if (missing || offline()) return false;
    const supabase = await whenClient();
    if (!supabase) return false;
    const { error } = await supabase.from(TABLE).delete().eq('record_type', type);
    if (error) {
      if (isMissing(error)) missing = true;
      else console.warn(`[SpinLog] ☁️ Could not clear ${type} rows:`, error.message);
      return false;
    }
    return true;
  }

  /** Drop a queued write, so a delete cannot be undone by it a moment later. */
  function cancel(name) {
    if (!timers.has(name)) return;
    clearTimeout(timers.get(name));
    timers.delete(name);
  }

  /** Debounce by a name, so rapid edits to the same thing coalesce. */
  function later(name, fn) {
    if (timers.has(name)) clearTimeout(timers.get(name));
    timers.set(name, setTimeout(() => {
      timers.delete(name);
      Promise.resolve(fn()).catch(() => {});
    }, PUSH_DEBOUNCE_MS));
  }

  // ══ Park history ═══════════════════════════════════════════════════════

  const parkKey = at => `park:${iso(at)}`;

  /** Newest first, which is the only order this is read in. */
  function parkHistory() {
    return cache.park.slice();
  }

  /**
   * Save a parked spot. One row, not a rewritten list — which is the difference
   * between this and the blob table it replaces.
   */
  function addPark(entry) {
    if (!entry || !Number.isFinite(Number(entry.lat))) return false;
    const at = entry.timestamp || entry.at || Date.now();
    const spot = {
      at: new Date(at).getTime() || Date.now(),
      lat: Number(entry.lat),
      lng: Number(entry.lng),
      accuracy: Number.isFinite(Number(entry.accuracy)) ? Number(entry.accuracy) : null,
      address: entry.address || null,
    };

    cache.park = [spot, ...cache.park.filter(p => p.at !== spot.at)]
      .sort((a, b) => b.at - a.at);

    // Trim in the cloud too, not just on screen.
    const dropped = cache.park.slice(PARK_KEEP);
    cache.park = cache.park.slice(0, PARK_KEEP);

    notify('park');
    later(`park:${spot.at}`, async () => {
      await writeRow({
        mem_key: parkKey(spot.at),
        record_type: 'park',
        content: spot.address,
        data: { lat: spot.lat, lng: spot.lng, accuracy: spot.accuracy },
        learned_at: iso(spot.at),
        last_seen_at: iso(spot.at),
        updated_at: new Date().toISOString(),
        device_id: deviceId(),
        // sage_memory has NOT NULL defaults on these and PostgREST writes NULL for
        // any key missing from a batch, so they are always sent explicitly.
        weight: 1, confidence: 1, pinned: false, hits: 0, rev: 1,
      });
      if (dropped.length) await deleteKeys(dropped.map(p => parkKey(p.at)));
    });
    return true;
  }

  /** Update a spot in place — the address arrives after the coordinates do. */
  function setParkAddress(at, address) {
    const when = new Date(at).getTime();
    const spot = cache.park.find(p => p.at === when);
    if (!spot) return false;
    spot.address = address || null;
    notify('park');
    later(`park:${when}`, () => writeRow({
      mem_key: parkKey(when),
      record_type: 'park',
      content: spot.address,
      data: { lat: spot.lat, lng: spot.lng, accuracy: spot.accuracy },
      learned_at: iso(when),
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      device_id: deviceId(),
      weight: 1, confidence: 1, pinned: false, hits: 0, rev: 1,
    }));
    return true;
  }

  /** Forget one spot. A real DELETE of a real row. */
  async function removePark(index) {
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= cache.park.length) return null;
    const [gone] = cache.park.splice(i, 1);
    notify('park');
    await deleteKeys([parkKey(gone.at)]);
    return gone;
  }

  async function clearPark() {
    cache.park.forEach(p => cancel(`park:${p.at}`));
    cache.park = [];
    notify('park');
    return deleteByType('park');
  }

  // ══ Conversation ═══════════════════════════════════════════════════════

  const chatKey = turn => `msg:${Number(turn.at) || 0}:${turn.role}`;

  /** Oldest first, which is how the log renders and how the model wants it. */
  function chatHistory() {
    return cache.chat.slice();
  }

  /**
   * Replace the conversation.
   *
   * The call site hands over the whole array because that is how the chat has
   * always worked. The diff against what is already stored is worked out here, so
   * a new message is one INSERT rather than eighty.
   */
  function setChat(turns) {
    const clean = (Array.isArray(turns) ? turns : [])
      .filter(t => t && t.role && t.text)
      .slice(-CHAT_KEEP);

    const before = new Map(cache.chat.map(t => [chatKey(t), t]));
    cache.chat = clean;
    notify('chat');

    const now = new Date().toISOString();
    const added = clean.filter(t => !before.has(chatKey(t)));
    const kept = new Set(clean.map(chatKey));
    const gone = [...before.keys()].filter(k => !kept.has(k));

    later('chat', async () => {
      for (const turn of added) {
        await writeRow({
          mem_key: chatKey(turn),
          record_type: 'message',
          content: turn.text,
          // `files` is the list a turn can now carry; `file` stays for the turns
          // written before it existed, and for anything still reading that shape.
          data: { role: turn.role, file: turn.file || null, files: turn.files || null },
          learned_at: iso(turn.at),
          last_seen_at: now,
          updated_at: now,
          device_id: deviceId(),
          weight: 1, confidence: 1, pinned: false, hits: 0, rev: 1,
        });
      }
      if (gone.length) await deleteKeys(gone);
    });
    return true;
  }

  async function clearChat() {
    // A queued write would otherwise re-insert the turns a moment after the
    // delete: setChat() defers its INSERTs by PUSH_DEBOUNCE_MS, so sending a
    // message and immediately clearing the log raced, and the message won.
    cancel('chat');
    cache.chat = [];
    notify('chat');
    return deleteByType('message');
  }

  // ══ Settings ═══════════════════════════════════════════════════════════

  function setting(name, fallback) {
    const value = cache.settings[name];
    return value === undefined || value === null ? fallback : value;
  }

  function setSetting(name, value) {
    if (value === null || value === undefined || value === '') {
      delete cache.settings[name];
      notify('setting');
      deleteKeys([`setting:${name}`]).catch(() => {});
      return true;
    }
    cache.settings[name] = value;
    notify('setting');
    const now = new Date().toISOString();
    later(`setting:${name}`, () => writeRow({
      mem_key: `setting:${name}`,
      record_type: 'setting',
      content: String(value),
      learned_at: now,
      last_seen_at: now,
      updated_at: now,
      device_id: deviceId(),
      weight: 1, confidence: 1, pinned: false, hits: 0, rev: 1,
    }));
    return true;
  }

  // ══ Upload notes and dates ═════════════════════════════════════════════
  //
  // Columns on media_files, so they travel with the upload and disappear with it.

  function note(id) {
    return cache.notes[String(id)] || '';
  }

  function uploadDate(id) {
    return cache.dates[String(id)] || '';
  }

  async function setNote(id, text) {
    const key = String(id);
    cache.notes[key] = text || '';
    notify('notes');
    return writeMedia(id, { notes: text || null });
  }

  async function setUploadDate(id, isoDate) {
    const key = String(id);
    cache.dates[key] = isoDate || '';
    notify('dates');
    return writeMedia(id, { historic_date: isoDate || null });
  }

  async function writeMedia(id, patch) {
    if (offline()) return false;
    const supabase = await whenClient();
    if (!supabase) return false;
    const { error } = await supabase.from(MEDIA_TABLE).update(patch).eq('id', id);
    if (error) {
      // 42703 is "column does not exist", i.e. the migration has not been run.
      if (!isMissing(error)) console.warn('[SpinLog] ☁️ Could not save upload detail:', error.message);
      return false;
    }
    return true;
  }

  /** Drop the local copy when the upload itself is deleted. */
  function forgetUpload(id) {
    const key = String(id);
    delete cache.notes[key];
    delete cache.dates[key];
    notify('notes');
  }

  // ══ Loading ════════════════════════════════════════════════════════════

  /**
   * Fill the cache from the cloud. Once, at boot.
   *
   * Everything reads from the cache after this, which is what keeps the render
   * paths synchronous. A failure leaves the cache empty rather than stale: there
   * is no device copy to fall back to, because not keeping one is the point.
   */
  async function load() {
    const supabase = await whenClient();
    if (!supabase) { loaded = true; return { ok: false, reason: 'no-client' }; }

    // Three reads rather than one, newest first, and bounded.
    //
    // This was a single unordered, unlimited `.in(...)` whose surplus was sliced
    // off in memory afterwards, and that was wrong twice over. PostgREST caps a
    // response at max-rows — 1000 by default — and with no ORDER BY the rows past
    // the cap are whatever physical order hands back, so `.slice(-80)` could be
    // the wrong eighty. Worse, anything sliced off was dropped from the cache and
    // never deleted, which made it unreachable for good: setChat() diffs against
    // the cache, so a key it can no longer see can never appear in its delete list
    // again.
    //
    // Settings get their own unbounded read because they are few and fixed-key,
    // and sharing an ordered limit with the conversation would let a busy chat push
    // `ageFrom` out of the window and silently lose it. Park and messages are
    // separated for the same reason.
    const COLUMNS = 'mem_key, record_type, content, data, learned_at';
    const [parkRead, chatRead, settingRead] = await Promise.all([
      supabase.from(TABLE).select(COLUMNS).eq('record_type', 'park')
        .order('learned_at', { ascending: false }).limit(READ_LIMIT),
      supabase.from(TABLE).select(COLUMNS).eq('record_type', 'message')
        .order('learned_at', { ascending: false }).limit(READ_LIMIT),
      supabase.from(TABLE).select(COLUMNS).eq('record_type', 'setting'),
    ]);

    const failed = [parkRead, chatRead, settingRead].find(r => r.error);
    if (failed) {
      loaded = true;
      if (isMissing(failed.error)) {
        missing = true;
        console.warn('[SpinLog] ☁️ Run supabase/cloud_routing.sql once to share '
          + 'park history, your conversation and settings between devices.');
        return { ok: false, reason: 'no-table' };
      }
      console.warn('[SpinLog] ☁️ Could not read shared data:', failed.error.message);
      return { ok: false, reason: 'error' };
    }

    // Parsed with their keys still attached, so anything over the cap can be named
    // in a DELETE rather than merely forgotten.
    const park = [];
    (parkRead.data || []).forEach(row => {
      const data = (row && row.data) || {};
      if (!row || !row.mem_key || !Number.isFinite(Number(data.lat))) return;
      park.push({
        key: row.mem_key,
        at: Date.parse(row.learned_at || '') || 0,
        lat: Number(data.lat),
        lng: Number(data.lng),
        accuracy: Number.isFinite(Number(data.accuracy)) ? Number(data.accuracy) : null,
        address: row.content || null,
      });
    });

    const chat = [];
    (chatRead.data || []).forEach(row => {
      if (!row || !row.mem_key || !row.content) return;
      const data = row.data || {};
      chat.push({
        key: row.mem_key,
        role: data.role === 'user' ? 'user' : 'model',
        text: row.content,
        at: Date.parse(row.learned_at || '') || 0,
        file: data.file || undefined,
        // An older row has one `file` and no list; promote it so the bubble only
        // ever has to read one shape.
        files: Array.isArray(data.files) && data.files.length
          ? data.files
          : (data.file ? [data.file] : undefined),
      });
    });

    const settings = {};
    (settingRead.data || []).forEach(row => {
      if (!row || !row.mem_key) return;
      settings[row.mem_key.replace(/^setting:/, '')] = row.content;
    });

    park.sort((a, b) => b.at - a.at);
    chat.sort((a, b) => a.at - b.at);

    const strip = ({ key, ...rest }) => rest;
    cache.park = park.slice(0, PARK_KEEP).map(strip);
    cache.chat = chat.slice(-CHAT_KEEP).map(strip);
    cache.settings = settings;

    // Whatever was over the cap is deleted here rather than left behind. Converges:
    // each load clears the surplus it can see, so a table that somehow got ahead of
    // the caps walks back down to them instead of staying bloated for ever. Only
    // ever park and message rows, only ever ones older than the newest PARK_KEEP /
    // CHAT_KEEP — which is the same policy the app already applies on every write.
    const surplus = [
      ...park.slice(PARK_KEEP).map(p => p.key),
      ...chat.slice(0, Math.max(0, chat.length - CHAT_KEEP)).map(c => c.key),
    ];
    if (surplus.length) {
      console.log(`[SpinLog] ☁️ Clearing ${surplus.length} row(s) past the keep limit.`);
      deleteKeys(surplus).catch(() => {});
    }

    // Notes and dates come from the uploads themselves.
    const media = await supabase.from(MEDIA_TABLE).select('id, notes, historic_date');
    if (!media.error) {
      const notes = {};
      const dates = {};
      (media.data || []).forEach(row => {
        if (!row) return;
        if (row.notes) notes[String(row.id)] = row.notes;
        if (row.historic_date) dates[String(row.id)] = String(row.historic_date).slice(0, 10);
      });
      cache.notes = notes;
      cache.dates = dates;
    } else if (isMissing(media.error)) {
      console.warn('[SpinLog] ☁️ media_files is missing the notes / historic_date '
        + 'columns — run supabase/cloud_routing.sql once.');
    }

    loaded = true;
    notify('all');
    console.log(`[SpinLog] ☁️ Loaded ${cache.park.length} parked spot(s), `
      + `${cache.chat.length} message(s), ${Object.keys(cache.notes).length} upload note(s).`);
    return { ok: true };
  }

  function isReady() {
    return loaded;
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // Coming back online is the moment to catch up on what could not be sent.
  if (window.addEventListener) {
    window.addEventListener('online', () => { load().catch(() => {}); });
  }

  return {
    TABLE, MEDIA_TABLE, PARK_KEEP, CHAT_KEEP, READ_LIMIT,
    load, isReady, onChange, deviceId,
    // park
    parkHistory, addPark, setParkAddress, removePark, clearPark,
    // conversation
    chatHistory, setChat, clearChat,
    // settings
    setting, setSetting,
    // uploads
    note, uploadDate, setNote, setUploadDate, forgetUpload,
  };
})();
