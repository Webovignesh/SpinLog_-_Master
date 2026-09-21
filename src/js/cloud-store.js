// ════════════════════════════════════════════════════════════════════════
// SPINLOG — CLOUD STORE
//
// The last of the data that only existed on whichever machine you typed it into.
// It now lives in the database and is read back from there, so a laptop and a
// phone show the same thing.
//
//   park history    where the bike was left   → park_locations
//   conversation    your messages with her    → sage_memory
//   purchase date   the override that lines "together for" up with your papers
//   upload notes    text about one historic upload
//   upload dates    the date that upload is FROM, not when it was uploaded
//
// This started as NO NEW TABLES, and that shaped the design rather than being a
// constraint worked around. Notes and dates are columns on media_files, the row
// they describe — they were a JSON map keyed by row id, which is a foreign key
// pretending not to be one. The conversation and the settings are record types in
// sage_memory, which was built to hold several kinds of row told apart by
// record_type and already has the unique mem_key index, a jsonb column, updated_at,
// and a full RLS set including DELETE.
//
//   record_type = 'message'   content = the text, data = { role, file, files }
//   record_type = 'setting'   content = the value
//
// PARK SPOTS USED TO BE record_type = 'park' AND NOW HAVE A TABLE OF THEIR OWN.
// The rule held while a spot was three numbers and a string. It stopped holding
// when a spot wanted a label, a level, a note, a photo and a time limit worth being
// reminded about — six more untyped keys in a jsonb blob on a table named after
// something else, and `until` has to be a real timestamptz because "which spots are
// due soon" is a query, not a field. See supabase/park_locations.sql.
//
// Until that file is run the park layer reads and writes the old sage_memory rows
// exactly as before, so updating the app and updating the database do not have to
// happen in the same minute.
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
  const PARK_TABLE = 'park_locations';

  // What each list is capped at. The cap is applied in the cloud, not just on
  // screen, so a year of parking does not accumulate for ever.
  //
  // Park was 5 while a spot was three numbers. Now that a spot can carry a label, a
  // note and a photo, quietly destroying the sixth-oldest one on every save is a
  // different thing to do, so the window is wider. READ_LIMIT is far above it.
  const PARK_KEEP = 20;
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
    // [{ at, lat, lng, accuracy, address, label, level, notes, photo, until,
    //    remindedAt }] newest first
    park: [],
    chat: [],          // [{ role, text, at, file }] oldest first
    settings: {},      // { ageFrom: '2024-06-27' }
    notes: {},         // { [mediaRowId]: 'text' }
    dates: {},         // { [mediaRowId]: '2025-04-02' }        the DAY the rider set
    takenAt: {},       // { [mediaRowId]: ISO instant }         what the FILE reported
  };

  const listeners = new Set();
  const timers = new Map();
  let loaded = false;
  let clientWait = null;

  // Which tables are not there yet, BY NAME.
  //
  // This was one module-wide `missing` boolean, and with a second table that turns
  // into a real bug: park_locations is the one table here the user has to create by
  // hand, so the likeliest state in the world is that it is absent — and a single
  // flag meant one 42P01 from a park write would also stop the conversation and the
  // settings from ever being saved again. Missing is a fact about a table.
  const absent = new Set();

  const isAbsent = table => absent.has(table);
  const markAbsent = table => absent.add(table);

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
    if (isAbsent(TABLE) || offline()) return false;
    const supabase = await whenClient();
    if (!supabase) return false;

    const { data: found, error: readErr } = await supabase
      .from(TABLE).select('id').eq('mem_key', row.mem_key).limit(1);
    if (readErr) {
      if (isMissing(readErr)) markAbsent(TABLE);
      else console.warn(`[SpinLog] ☁️ Could not check ${row.mem_key}:`, readErr.message);
      return false;
    }

    const { error } = found && found.length
      ? await supabase.from(TABLE).update(row).eq('mem_key', row.mem_key)
      : await supabase.from(TABLE).insert([row]);

    if (error) {
      if (isMissing(error)) markAbsent(TABLE);
      else console.warn(`[SpinLog] ☁️ Could not save ${row.mem_key}:`, error.message);
      return false;
    }
    return true;
  }

  async function deleteKeys(keys) {
    if (!keys.length || isAbsent(TABLE) || offline()) return false;
    const supabase = await whenClient();
    if (!supabase) return false;
    const { error } = await supabase.from(TABLE).delete().in('mem_key', keys);
    if (error) {
      if (isMissing(error)) markAbsent(TABLE);
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
    if (isAbsent(TABLE) || offline()) return false;
    const supabase = await whenClient();
    if (!supabase) return false;
    const { error } = await supabase.from(TABLE).delete().eq('record_type', type);
    if (error) {
      if (isMissing(error)) markAbsent(TABLE);
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
  //
  // PARKED_AT IS THE ROW IDENTITY, not id.
  //
  // Which looks like a mistake and is deliberate. The whole park surface above and
  // below this file is addressed by the moment the bike was left: the cache is
  // keyed on it, the debounce name is keyed on it, the address arrives in a second
  // write that has to find the same row, and the phone and the laptop have to agree
  // on which row that is without having seen each other's ids. An identity the
  // client can compute is the only one that survives all of those. `id` is still
  // the primary key; nothing here needs to know it.
  //
  // The column is UNIQUE in park_locations, so a double save of the same instant
  // cannot become two rows.

  /** The old sage_memory mem_key. Only used on the fallback path below. */
  const parkKey = at => `park:${iso(at)}`;

  /** True while park_locations does not exist — i.e. the migration is unrun. */
  const parkLegacy = () => isAbsent(PARK_TABLE);

  const asNum = v => (Number.isFinite(Number(v)) ? Number(v) : null);
  const asText = v => {
    const s = v === null || v === undefined ? '' : String(v).trim();
    return s || null;
  };
  const asTime = v => {
    if (v === null || v === undefined || v === '') return null;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  };

  /** The cache shape, built from anything a caller hands over. */
  function asSpot(entry, at) {
    return {
      at,
      lat: asNum(entry.lat),
      lng: asNum(entry.lng),
      accuracy: asNum(entry.accuracy),
      address: asText(entry.address),
      // The advanced part. A car park is not a street address: "Phoenix Mall" plus
      // "P2, row C" is how somebody actually finds a bike again, and neither is
      // derivable from coordinates that are ±15m and indoors.
      label: asText(entry.label),
      level: asText(entry.level),
      notes: asText(entry.notes),
      photo: asText(entry.photo || entry.photo_path),
      until: asTime(entry.until),
      remindedAt: asTime(entry.remindedAt || entry.reminded_at),
    };
  }

  /**
   * One park_locations row.
   *
   * Every column is sent on every write, including the null ones. An update is
   * therefore "this is the spot now" rather than a patch, which is what makes
   * clearing a label actually clear it instead of leaving the old value behind.
   */
  function parkRow(spot) {
    return {
      parked_at: iso(spot.at),
      lat: spot.lat,
      lng: spot.lng,
      accuracy_m: spot.accuracy,
      address: spot.address,
      label: spot.label,
      level: spot.level,
      notes: spot.notes,
      photo_path: spot.photo,
      until: spot.until ? iso(spot.until) : null,
      reminded_at: spot.remindedAt ? iso(spot.remindedAt) : null,
      device_id: deviceId(),
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * The same spot in the old sage_memory shape.
   *
   * Still carries the advanced fields, in `data`, so the feature works on a
   * database where park_locations.sql has not been run yet — and section 5 of that
   * file copies them across when it eventually is, so nothing typed here is lost by
   * migrating later.
   */
  function legacyParkRow(spot) {
    const now = new Date().toISOString();
    return {
      mem_key: parkKey(spot.at),
      record_type: 'park',
      content: spot.address,
      data: {
        lat: spot.lat, lng: spot.lng, accuracy: spot.accuracy,
        label: spot.label, level: spot.level, notes: spot.notes,
        photo: spot.photo,
        until: spot.until ? iso(spot.until) : null,
        remindedAt: spot.remindedAt ? iso(spot.remindedAt) : null,
      },
      learned_at: iso(spot.at),
      last_seen_at: now,
      updated_at: now,
      device_id: deviceId(),
      // sage_memory has NOT NULL defaults on these and PostgREST writes NULL for
      // any key missing from a batch, so they are always sent explicitly. Note that
      // park_locations needs none of it — that padding is half of why this moved.
      weight: 1, confidence: 1, pinned: false, hits: 0, rev: 1,
    };
  }

  /** Insert or update one row of park_locations, matched on parked_at. */
  async function writeParkRow(spot) {
    const supabase = await whenClient();
    if (!supabase) return false;
    const when = iso(spot.at);

    // Select-then-write rather than upsert, for the same reason writeRow() does it:
    // it works whether or not the unique index is reported in the schema cache the
    // way onConflict needs.
    const { data: found, error: readErr } = await supabase
      .from(PARK_TABLE).select('id').eq('parked_at', when).limit(1);
    if (readErr) {
      if (isMissing(readErr)) markAbsent(PARK_TABLE);
      else console.warn('[SpinLog] ☁️ Could not check the parked spot:', readErr.message);
      return false;
    }

    const row = parkRow(spot);
    const { error } = found && found.length
      ? await supabase.from(PARK_TABLE).update(row).eq('parked_at', when)
      : await supabase.from(PARK_TABLE).insert([row]);

    if (error) {
      if (isMissing(error)) markAbsent(PARK_TABLE);
      else console.warn('[SpinLog] ☁️ Could not save the parked spot:', error.message);
      return false;
    }
    return true;
  }

  async function deleteParkRows(times) {
    const supabase = await whenClient();
    if (!supabase) return false;
    const { error } = await supabase
      .from(PARK_TABLE).delete().in('parked_at', times.map(iso));
    if (error) {
      if (isMissing(error)) markAbsent(PARK_TABLE);
      // A refused delete is worth naming: without the policy it affects no rows and
      // returns no error at all, so reaching this branch means something else broke.
      else console.warn('[SpinLog] ☁️ Could not forget the parked spot:', error.message);
      return false;
    }
    return true;
  }

  /**
   * Save one spot, wherever it lives.
   *
   * If park_locations turns out not to exist the write is retried in the old shape
   * immediately rather than on the next save, so the spot that discovered the
   * missing table is not the one that gets lost.
   */
  async function writeSpot(spot) {
    if (offline()) return false;
    if (!parkLegacy()) {
      const ok = await writeParkRow(spot);
      if (ok || !parkLegacy()) return ok;
      console.warn('[SpinLog] ☁️ No park_locations table yet — saving the spot the '
        + 'old way. Run supabase/park_locations.sql once to give parking its own table.');
    }
    return writeRow(legacyParkRow(spot));
  }

  async function deleteSpots(times) {
    if (!times.length || offline()) return false;
    if (!parkLegacy()) {
      const ok = await deleteParkRows(times);
      if (ok || !parkLegacy()) return ok;
    }
    return deleteKeys(times.map(parkKey));
  }

  /** Newest first, which is the only order this is read in. */
  function parkHistory() {
    return cache.park.map(p => ({ ...p }));
  }

  /** One spot by the moment it was parked, for a screen that edits just that one. */
  function parkAt(at) {
    const when = asTime(at);
    const spot = when === null ? null : cache.park.find(p => p.at === when);
    return spot ? { ...spot } : null;
  }

  /**
   * Spots with a time limit that is coming up and has not been mentioned yet.
   *
   * This is the question park_locations_due_idx exists for. Asked of the cache
   * rather than the database because the reminder runs on a timer in the page and
   * the cache is already the newest PARK_KEEP spots.
   */
  function parkDue(withinMs) {
    const window = Number(withinMs);
    const limit = Date.now() + (Number.isFinite(window) ? window : 0);
    return cache.park
      .filter(p => p.until && !p.remindedAt && p.until <= limit)
      .sort((a, b) => a.until - b.until)
      .map(p => ({ ...p }));
  }

  /**
   * Save a parked spot. One row, not a rewritten list — which is the difference
   * between this and the blob table it replaces.
   */
  function addPark(entry) {
    if (!entry) return false;
    const lat = asNum(entry.lat);
    const lng = asNum(entry.lng);
    // Both, not just lat. A spot with one coordinate cannot be mapped or walked
    // back to, and storing it only produces a history row that does nothing.
    if (lat === null || lng === null) return false;

    const at = asTime(entry.timestamp || entry.at) || Date.now();
    const spot = asSpot(entry, at);

    cache.park = [spot, ...cache.park.filter(p => p.at !== spot.at)]
      .sort((a, b) => b.at - a.at);

    // Trim in the cloud too, not just on screen.
    const dropped = cache.park.slice(PARK_KEEP);
    cache.park = cache.park.slice(0, PARK_KEEP);
    dropped.forEach(p => cancel(`park:${p.at}`));

    notify('park');
    later(`park:${spot.at}`, async () => {
      await writeSpot(spot);
      if (dropped.length) await deleteSpots(dropped.map(p => p.at));
    });
    return true;
  }

  /**
   * Change a saved spot.
   *
   * Everything the park sheet edits goes through here: the address that arrives
   * after the coordinates, the label and level typed afterwards, the photo, the
   * time limit, and the flag saying the reminder has been sent. Only the keys
   * present in the patch are touched; the row is then written whole.
   */
  function updatePark(at, patch) {
    const when = asTime(at);
    if (when === null || !patch || typeof patch !== 'object') return false;
    const spot = cache.park.find(p => p.at === when);
    // Not found means the spot fell out of the keep window, or never existed. Say
    // so rather than quietly writing a new row the caller did not ask for.
    if (!spot) return false;

    if ('address' in patch) spot.address = asText(patch.address);
    if ('label' in patch) spot.label = asText(patch.label);
    if ('level' in patch) spot.level = asText(patch.level);
    if ('notes' in patch) spot.notes = asText(patch.notes);
    if ('photo' in patch) spot.photo = asText(patch.photo);
    if ('until' in patch) spot.until = asTime(patch.until);
    if ('remindedAt' in patch) spot.remindedAt = asTime(patch.remindedAt);
    // A limit that moved has not been reminded about at its new time.
    if ('until' in patch && !('remindedAt' in patch)) spot.remindedAt = null;

    notify('park');
    const snapshot = { ...spot };
    later(`park:${when}`, () => writeSpot(snapshot));
    return true;
  }

  /** Update a spot in place — the address arrives after the coordinates do. */
  function setParkAddress(at, address) {
    return updatePark(at, { address });
  }

  /** Forget one spot. A real DELETE of a real row. */
  async function removePark(index) {
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= cache.park.length) return null;
    const [gone] = cache.park.splice(i, 1);
    // Without this a spot deleted within PUSH_DEBOUNCE_MS of being saved or edited
    // came straight back: the queued write fired after the DELETE and re-inserted
    // the row. clearChat() needed the same correction.
    cancel(`park:${gone.at}`);
    notify('park');
    await deleteSpots([gone.at]);
    return gone;
  }

  /** The same, addressed by when it was parked rather than by list position. */
  async function removeParkAt(at) {
    const when = asTime(at);
    if (when === null) return null;
    const i = cache.park.findIndex(p => p.at === when);
    return i < 0 ? null : removePark(i);
  }

  async function clearPark() {
    const times = cache.park.map(p => p.at);
    times.forEach(t => cancel(`park:${t}`));
    cache.park = [];
    notify('park');
    // Not deleteByType('park'): on the new table there is no record_type to filter
    // on and every row in it is a park spot, so this clears the whole table. The
    // legacy path still narrows by type, because it shares sage_memory.
    if (!parkLegacy()) {
      const supabase = await whenClient();
      if (!supabase) return false;
      // Filtered on id is not null rather than left bare, because PostgREST refuses
      // an unfiltered DELETE outright. id is the primary key, so it matches all of
      // them.
      const { error } = await supabase.from(PARK_TABLE).delete().not('id', 'is', null);
      if (error) {
        if (isMissing(error)) markAbsent(PARK_TABLE);
        else console.warn('[SpinLog] ☁️ Could not clear park history:', error.message);
        return false;
      }
      return true;
    }
    if (times.length) await deleteSpots(times);
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

  /**
   * The full instant the file was recorded, as an ISO string, or ''.
   *
   * Separate from uploadDate() because the two columns behind them are different
   * types and mean different things: historic_date is a DATE the rider set, taken_at
   * is a TIMESTAMP the file itself reported. The table prefers this one and falls
   * back to the other, so a hand correction survives and a row with real metadata
   * gets to show a clock reading.
   */
  function takenAt(id) {
    return cache.takenAt[String(id)] || '';
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

  /**
   * @param {string|null} stamp An ISO instant, or null to clear it.
   *
   * Writes BOTH columns, and the reason is that they answer different questions and
   * the table reads both. taken_at is the instant; historic_date is the day, which
   * the date filter matches on and which stays correct for anyone whose database
   * has not had media_taken_at.sql run against it yet.
   *
   * The day is derived LOCALLY rather than from the ISO string. Slicing the first
   * ten characters off a UTC instant is the off-by-a-day this app has already been
   * bitten by twice: 2025-06-27T19:30 in India is 14:00 UTC on the 27th, but
   * 2025-06-27T02:30 is the 26th in UTC and the 27th on the phone.
   */
  async function setTakenAt(id, stamp) {
    const key = String(id);
    const when = stamp ? new Date(stamp) : null;
    const good = when && !Number.isNaN(when.getTime()) ? when : null;

    cache.takenAt[key] = good ? good.toISOString() : '';

    // CLEARING THE INSTANT DOES NOT CLEAR THE DAY.
    //
    // They are separate facts and the day is the one that survives. A rider who
    // empties the time field in the edit sheet is saying "only the day is known
    // for this one", not "forget when it is from" — and the first version of this
    // wrote historic_date: null alongside, so emptying one input blanked the whole
    // Uploaded cell and lost a date nothing else could recover.
    if (!good) {
      notify('dates');
      return writeMedia(id, { taken_at: null });
    }

    const day = `${good.getFullYear()}-${String(good.getMonth() + 1).padStart(2, '0')}`
      + `-${String(good.getDate()).padStart(2, '0')}`;
    cache.dates[key] = day;
    notify('dates');

    // Sent as two patches rather than one, because taken_at may not exist yet. A
    // single object would take the day down with the timestamp on any database that
    // has not run the migration, and the day is the part that already worked.
    const dayOk = await writeMedia(id, { historic_date: day });
    const stampOk = await writeMedia(id, { taken_at: good.toISOString() });
    return dayOk || stampOk;
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
    delete cache.takenAt[key];
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
    const PARK_COLUMNS = 'parked_at, lat, lng, accuracy_m, address, label, level, '
      + 'notes, photo_path, until, reminded_at';
    const [parkRead, chatRead, settingRead] = await Promise.all([
      supabase.from(PARK_TABLE).select(PARK_COLUMNS)
        .order('parked_at', { ascending: false }).limit(READ_LIMIT),
      supabase.from(TABLE).select(COLUMNS).eq('record_type', 'message')
        .order('learned_at', { ascending: false }).limit(READ_LIMIT),
      supabase.from(TABLE).select(COLUMNS).eq('record_type', 'setting'),
    ]);

    // Only the two that share sage_memory can fail the load together. Park has its
    // own table now and therefore its own answer — a database where
    // park_locations.sql has not been run yet must still get its conversation.
    const failed = [chatRead, settingRead].find(r => r.error);
    if (failed) {
      loaded = true;
      if (isMissing(failed.error)) {
        markAbsent(TABLE);
        console.warn('[SpinLog] ☁️ Run supabase/cloud_routing.sql once to share '
          + 'your conversation and settings between devices.');
        return { ok: false, reason: 'no-table' };
      }
      console.warn('[SpinLog] ☁️ Could not read shared data:', failed.error.message);
      return { ok: false, reason: 'error' };
    }

    // Park, from the new table if it is there and from the old rows if it is not.
    let parkRows = parkRead.data || [];
    let parkIsLegacy = false;
    if (parkRead.error) {
      parkRows = [];
      if (isMissing(parkRead.error)) {
        markAbsent(PARK_TABLE);
        parkIsLegacy = true;
        console.warn('[SpinLog] ☁️ No park_locations table — reading park history '
          + 'out of sage_memory. Run supabase/park_locations.sql once to move it '
          + 'across and unlock labels, levels, photos and time limits.');
        const legacy = await supabase.from(TABLE).select(COLUMNS)
          .eq('record_type', 'park')
          .order('learned_at', { ascending: false }).limit(READ_LIMIT);
        if (legacy.error) {
          if (isMissing(legacy.error)) markAbsent(TABLE);
          else console.warn('[SpinLog] ☁️ Could not read park history:', legacy.error.message);
        } else {
          parkRows = legacy.data || [];
        }
      } else {
        console.warn('[SpinLog] ☁️ Could not read park history:', parkRead.error.message);
      }
    }

    // `at` is the identity on both paths, so anything over the cap can be named in a
    // DELETE rather than merely forgotten — which was the bug that made surplus rows
    // unreachable for good.
    const park = [];
    parkRows.forEach(row => {
      if (!row) return;
      if (parkIsLegacy) {
        const data = row.data || {};
        const at = Date.parse(row.learned_at || '') || 0;
        if (!at || !Number.isFinite(Number(data.lat))) return;
        park.push(asSpot({ ...data, address: row.content }, at));
        return;
      }
      const at = Date.parse(row.parked_at || '') || 0;
      if (!at || !Number.isFinite(Number(row.lat))) return;
      park.push(asSpot({
        lat: row.lat,
        lng: row.lng,
        accuracy: row.accuracy_m,
        address: row.address,
        label: row.label,
        level: row.level,
        notes: row.notes,
        photo: row.photo_path,
        until: row.until,
        remindedAt: row.reminded_at,
      }, at));
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
    cache.park = park.slice(0, PARK_KEEP);
    cache.chat = chat.slice(-CHAT_KEEP).map(strip);
    cache.settings = settings;

    // Whatever was over the cap is deleted here rather than left behind. Converges:
    // each load clears the surplus it can see, so a table that somehow got ahead of
    // the caps walks back down to them instead of staying bloated for ever. Only
    // ever park and message rows, only ever ones older than the newest PARK_KEEP /
    // CHAT_KEEP — which is the same policy the app already applies on every write.
    const oldSpots = park.slice(PARK_KEEP).map(p => p.at);
    const oldTurns = chat.slice(0, Math.max(0, chat.length - CHAT_KEEP)).map(c => c.key);
    if (oldSpots.length + oldTurns.length) {
      console.log(`[SpinLog] ☁️ Clearing ${oldSpots.length + oldTurns.length} `
        + 'row(s) past the keep limit.');
      if (oldSpots.length) deleteSpots(oldSpots).catch(() => {});
      if (oldTurns.length) deleteKeys(oldTurns).catch(() => {});
    }

    // Notes, days and instants come from the uploads themselves.
    //
    // SELECT * AND NOT A COLUMN LIST, and that is the opposite of the usual advice.
    //
    // These three columns arrived in three different migrations, so any explicit list
    // is a list of assumptions about which of them a given database has — and naming
    // one that is missing does not degrade, it 400s the WHOLE read and takes the
    // other two down with it. The first attempt at this asked for `taken_at` and
    // retried without it, which worked but put a red 400 in the console on every
    // single boot until the migration was run: a feature that is merely not enabled
    // yet, presented as a fault.
    //
    // `*` cannot be wrong about the schema. It costs the columns the docs table also
    // fetches — file_name, file_size, content_type — which for a table this size is
    // nothing next to one guaranteed-clean read.
    const media = await supabase.from(MEDIA_TABLE).select('*');
    if (!media.error) {
      const notes = {};
      const dates = {};
      const takenAtMap = {};
      (media.data || []).forEach(row => {
        if (!row) return;
        if (row.notes) notes[String(row.id)] = row.notes;
        if (row.historic_date) dates[String(row.id)] = String(row.historic_date).slice(0, 10);
        if (row.taken_at) takenAtMap[String(row.id)] = String(row.taken_at);
      });
      cache.notes = notes;
      cache.dates = dates;
      cache.takenAt = takenAtMap;

      // PostgREST returns every column as a key, null included, so the key being
      // absent is the column being absent. With no rows at all there is nothing to
      // look at and nothing worth saying.
      const sample = (media.data || [])[0];
      if (sample && !('taken_at' in sample)) {
        console.warn('[SpinLog] ☁️ media_files has no taken_at column, so uploads show a '
          + 'day with no time — run supabase/media_taken_at.sql once.');
      }
      if (sample && !('historic_date' in sample)) {
        console.warn('[SpinLog] ☁️ media_files has no historic_date column — '
          + 'run supabase/cloud_routing.sql once.');
      }
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
    TABLE, MEDIA_TABLE, PARK_TABLE, PARK_KEEP, CHAT_KEEP, READ_LIMIT,
    load, isReady, onChange, deviceId,
    // park
    parkHistory, parkAt, parkDue, addPark, updatePark, setParkAddress,
    removePark, removeParkAt, clearPark,
    // true while park_locations.sql has not been run, so the UI can say so
    parkLegacy,
    // conversation
    chatHistory, setChat, clearChat,
    // settings
    setting, setSetting,
    // uploads
    note, uploadDate, takenAt, setNote, setUploadDate, setTakenAt, forgetUpload,
  };
})();
