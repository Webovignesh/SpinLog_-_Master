// ════════════════════════════════════════════════════════════════════════
// SPINLOG — SAGE KEY VAULT
//
// Encrypted backup of the Gemini API key ring, so five keys do not have to be
// pasted in again on a new phone or after clearing site data.
//
// ── Why this is not just another synced table ────────────────────────
// Her memory syncs in the clear, and that is fine: it is notes about a bike.
// An API key is a billable credential, and this app reaches Supabase with the
// anon key — which ships inside the JavaScript the browser downloads. Every
// policy in this project is `using (true)` because there is no login. So any
// table here is, in practice, world-readable.
//
// Putting a Gemini key in that is the same as publishing it.
//
// So the key never leaves this file in plaintext:
//
//   passphrase ──PBKDF2(SHA-256, 310k)──► AES-256-GCM key
//   api key    ──AES-GCM(key, random iv)──► ciphertext ──► Supabase
//
// The passphrase is never sent anywhere and is not stored in any column. What
// the server holds is a masked label (already shown on screen anyway), a
// non-secret fingerprint, and a blob nobody can read without the passphrase.
//
// The trade is real and worth stating plainly: forget the passphrase and the
// backup is unrecoverable. There is no reset, because a reset would mean the
// server could decrypt it, which is the thing being avoided.
//
// Everything degrades quietly. No passphrase, no table, no network, no
// WebCrypto — the app behaves exactly as it did before any of this existed,
// with keys living in localStorage. See supabase/gemini_keys.sql.
// ════════════════════════════════════════════════════════════════════════

(function (root) {
  'use strict';

  const TABLE = 'gemini_keys';
  const TABLE_FALLBACK = 'Gemini Api keys';

  // The passphrase lives in localStorage, beside the keys it protects.
  //
  // It was in sessionStorage, which meant every reload locked the vault — and
  // while locked the Back up and Restore buttons are hidden, so there was no way
  // to reach them without retyping the passphrase first. That made the backup
  // look broken.
  //
  // It is also not the weakening it sounds like. The threat this design guards
  // against is the *server* copy being readable by anyone holding the anon key.
  // Anything with access to this device's localStorage already has the API keys
  // themselves, in plaintext, under sage_gemini_keys — so protecting the
  // passphrase more carefully than the thing it protects buys nothing. The Lock
  // button is there for a shared machine.
  const PASS_STORAGE = 'sage_vault_pass';
  // Where it used to live, so an existing unlocked session is carried over
  // instead of silently asking again.
  const PASS_STORAGE_LEGACY_SESSION = 'sage_vault_pass';
  const SALT_STORAGE = 'sage_vault_salt';
  const META_STORAGE = 'sage_vault_meta';

  // 310,000 matches the current OWASP guidance for PBKDF2-HMAC-SHA256. It costs
  // a few hundred milliseconds once per session, which is the point.
  const PBKDF2_ITERATIONS = 310000;
  const SALT_BYTES = 16;
  const IV_BYTES = 12;          // 96 bits, the size AES-GCM is specified for

  const CLIENT_WAIT_TRIES = 40;
  const CLIENT_WAIT_GAP_MS = 250;

  // ── Small helpers ────────────────────────────────────────────────────

  function crypto_() {
    return (root.crypto && root.crypto.subtle) ? root.crypto : null;
  }

  /** WebCrypto needs a secure context, so this is false on plain http. */
  function available() {
    return !!crypto_();
  }

  function toB64(bytes) {
    let out = '';
    const view = new Uint8Array(bytes);
    for (let i = 0; i < view.length; i++) out += String.fromCharCode(view[i]);
    return btoa(out);
  }

  function fromB64(text) {
    const raw = atob(String(text || ''));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function randomBytes(n) {
    const out = new Uint8Array(n);
    crypto_().getRandomValues(out);
    return out;
  }

  function readLocal(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : raw;
    } catch { return fallback; }
  }

  function writeLocal(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
      return true;
    } catch { return false; }
  }

  /** The passphrase, carrying over anything an older build left in sessionStorage. */
  function readPass() {
    const stored = readLocal(PASS_STORAGE, null);
    if (stored) return stored;
    let legacy = null;
    try { legacy = sessionStorage.getItem(PASS_STORAGE_LEGACY_SESSION); } catch { legacy = null; }
    if (legacy) {
      writeLocal(PASS_STORAGE, legacy);
      try { sessionStorage.removeItem(PASS_STORAGE_LEGACY_SESSION); } catch { /* ignore */ }
      return legacy;
    }
    return null;
  }

  function writePass(value) {
    if (value === null) {
      try { sessionStorage.removeItem(PASS_STORAGE_LEGACY_SESSION); } catch { /* ignore */ }
    }
    return writeLocal(PASS_STORAGE, value);
  }

  // ── Crypto ───────────────────────────────────────────────────────────

  let derived = null;       // { key: CryptoKey, salt: string }

  /**
   * The vault's salt. One per vault rather than one per key, so the expensive
   * derivation happens once instead of once per key. A salt is not secret — it
   * exists to stop one precomputed table attacking every vault at once.
   */
  function salt() {
    let stored = readLocal(SALT_STORAGE, null);
    if (!stored) {
      stored = toB64(randomBytes(SALT_BYTES));
      writeLocal(SALT_STORAGE, stored);
    }
    return stored;
  }

  function adoptSalt(b64) {
    if (!b64) return;
    const current = readLocal(SALT_STORAGE, null);
    if (current === b64) return;
    // A vault created on another device owns the salt. Taking theirs is what
    // makes the same passphrase produce the same key on both.
    writeLocal(SALT_STORAGE, b64);
    derived = null;
  }

  async function keyFor(passphrase, saltB64) {
    const c = crypto_();
    if (!c) throw new Error('no-crypto');
    const base = await c.subtle.importKey(
      'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return c.subtle.deriveKey(
      { name: 'PBKDF2', salt: fromB64(saltB64), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /** The derived key for this session, or null when no passphrase is set. */
  async function unlocked() {
    const pass = readPass();
    if (!pass || !available()) return null;
    const current = salt();
    if (derived && derived.salt === current) return derived.key;
    derived = { key: await keyFor(pass, current), salt: current };
    return derived.key;
  }

  async function encrypt(plaintext) {
    const key = await unlocked();
    if (!key) throw new Error('locked');
    const iv = randomBytes(IV_BYTES);
    const buf = await crypto_().subtle.encrypt(
      { name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
    return { cipher: toB64(buf), iv: toB64(iv), salt: salt() };
  }

  /**
   * Returns null rather than throwing on a wrong passphrase.
   *
   * AES-GCM authenticates, so a wrong key fails the integrity check instead of
   * producing plausible rubbish. That is what makes "is this the right
   * passphrase" answerable at all.
   */
  async function decrypt(row) {
    const key = await unlocked();
    if (!key || !row || !row.cipher || !row.iv) return null;
    try {
      const buf = await crypto_().subtle.decrypt(
        { name: 'AES-GCM', iv: fromB64(row.iv) }, key, fromB64(row.cipher));
      return new TextDecoder().decode(buf);
    } catch {
      return null;
    }
  }

  // ── Passphrase ───────────────────────────────────────────────────────

  function hasPassphrase() {
    return !!readPass();
  }

  /** Whether a vault has ever been set up on this device. */
  function isConfigured() {
    return readLocal(META_STORAGE, null) === '1';
  }

  /**
   * Take a passphrase for this session and prove it against whatever is already
   * in the cloud, so a typo is caught here rather than silently creating a
   * second vault nobody can merge.
   *
   * @returns {Promise<{ok:boolean, reason?:string, keys?:number}>}
   */
  async function setPassphrase(passphrase) {
    const pass = String(passphrase || '');
    if (!available()) return { ok: false, reason: 'no-crypto' };
    if (pass.length < 8) return { ok: false, reason: 'too-short' };

    writePass(pass);
    derived = null;

    // If the cloud already holds rows, the passphrase has to match them.
    const rows = await fetchRows();
    if (rows && rows.length) {
      adoptSalt(rows[0].salt);
      derived = null;
      const probe = await decrypt(rows.find(r => r.cipher) || rows[0]);
      if (probe === null) {
        writePass(null);
        derived = null;
        return { ok: false, reason: 'wrong-passphrase', keys: rows.length };
      }
    }

    writeLocal(META_STORAGE, '1');
    notify('unlocked');
    return { ok: true, keys: (rows || []).length };
  }

  /** Forget it for this session. The cloud copy is untouched. */
  function lock() {
    writePass(null);
    derived = null;
    notify('locked');
    return true;
  }

  /**
   * Stop using the vault on this device and remove the cloud copy.
   * The keys themselves stay on the ring — this only drops the backup.
   */
  async function forget() {
    const supabase = await whenClient();
    const name = supabase ? await tableName(supabase) : null;
    if (supabase && name) {
      try { await supabase.from(name).delete().not('key_id', 'is', null); }
      catch { /* offline: the local flags still go, which is the visible part */ }
    }
    writePass(null);
    writeLocal(META_STORAGE, null);
    writeLocal(SALT_STORAGE, null);
    derived = null;
    notify('forgotten');
    return true;
  }

  // ── Listeners ────────────────────────────────────────────────────────

  const listeners = new Set();

  function onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function notify(reason) {
    listeners.forEach(fn => {
      try { fn(reason); } catch { /* a bad listener must not break a sync */ }
    });
  }

  // ── Supabase ─────────────────────────────────────────────────────────

  let clientWait = null;
  let resolvedTable = null;
  let lastError = null;
  let lastSyncAt = null;

  function client() {
    return root.supabaseClient || null;
  }

  /** The client is made inside script.js's DOMContentLoaded, so wait for it. */
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

  function isMissingColumn(error) {
    if (!error) return false;
    return error.code === '42703' || /column .* does not exist/i.test(error.message || '');
  }

  function isMissingTable(error) {
    if (!error) return false;
    if (error.code === '42P01') return true;
    if (isMissingColumn(error)) return false;
    return /relation .* does not exist|schema cache|not find the table/i.test(error.message || '');
  }

  async function tableName(supabase) {
    if (resolvedTable) return resolvedTable;
    for (const name of [TABLE, TABLE_FALLBACK]) {
      const { error } = await supabase.from(name).select('id').limit(1);
      if (!error) { resolvedTable = name; return name; }
      if (!isMissingTable(error)) { resolvedTable = name; return name; }
    }
    return null;
  }

  async function fetchRows() {
    const supabase = await whenClient();
    if (!supabase) { lastError = 'no-client'; return null; }
    const name = await tableName(supabase);
    if (!name) { lastError = 'no-table'; return null; }

    const { data, error } = await supabase
      .from(name).select('key_id, label, cipher, iv, salt, added_at');
    if (error) {
      lastError = isMissingColumn(error) ? 'schema' : error.message;
      console.warn('[SpinLog] 🔑 Could not read the key vault:', error);
      return null;
    }
    lastError = null;
    return (data || []).filter(r => r && r.key_id);
  }

  // ── Push / pull ──────────────────────────────────────────────────────

  /**
   * Encrypt every key on the ring and write it up. Keys already backed up under
   * the same fingerprint are left alone rather than re-encrypted, so a push is
   * cheap and the ciphertext does not churn.
   *
   * ADDS ONLY. It never removes a row for a key this device happens not to have.
   *
   * It used to prune the vault to match the local ring, which sounds tidy and
   * was wrong in the one case that matters: clearing the keys on this device
   * emptied the ring, the next push deleted every row, and Restore then had
   * nothing to give back. A backup that disappears when you clear the device is
   * not a backup. Removing a row is now only ever an explicit act — replace()
   * to match the device, forget() to empty it.
   *
   * @returns {Promise<{ok:boolean, reason?:string, pushed?:number}>}
   */
  async function push() {
    const AI = root.SageAI;
    if (!AI) return { ok: false, reason: 'no-ai' };
    if (!available()) return { ok: false, reason: 'no-crypto' };
    if (!hasPassphrase()) return { ok: false, reason: 'locked' };

    const supabase = await whenClient();
    if (!supabase) return { ok: false, reason: 'no-client' };
    const name = await tableName(supabase);
    if (!name) return { ok: false, reason: 'no-table' };

    const ring = AI.getKeys();
    const existing = await fetchRows();
    if (existing === null) return { ok: false, reason: lastError === 'schema' ? 'schema' : 'error' };
    const known = new Set(existing.map(r => r.key_id));

    const rows = [];
    for (const k of ring) {
      if (known.has(k.id)) continue;
      let sealed;
      try { sealed = await encrypt(k.key); }
      catch { return { ok: false, reason: 'locked' }; }
      rows.push({
        key_id: k.id,
        label: AI.maskKey(k.key),
        cipher: sealed.cipher,
        iv: sealed.iv,
        salt: sealed.salt,
        device_id: deviceId(),
        added_at: new Date(k.addedAt || Date.now()).toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    if (rows.length) {
      const { error } = await supabase.from(name).upsert(rows, { onConflict: 'key_id' });
      if (error) {
        lastError = isMissingColumn(error) ? 'schema' : error.message;
        console.warn('[SpinLog] 🔑 Could not back up the keys:', error);
        return { ok: false, reason: lastError === 'schema' ? 'schema' : 'error', error: error.message };
      }
    }

    lastSyncAt = Date.now();
    lastError = null;
    if (rows.length) console.log(`[SpinLog] 🔑 Key vault updated — ${rows.length} added.`);
    notify('push');
    return { ok: true, pushed: rows.length };
  }

  // There is deliberately no per-key delete here any more.
  //
  // dropKey(id) existed and got wired to the × on each key tile, so tidying the
  // list ate the backup one row at a time — which is how a restore came back
  // with nothing. Removing the function removes the temptation: the only two
  // ways a row leaves this table are replace(), which makes the vault match the
  // device on request, and forget(), which empties it. Both are named buttons
  // and neither happens as a side effect of anything else.

  /**
   * Decrypt whatever is in the cloud and put any missing key back on the ring.
   * Never removes a local key: a restore is additive by definition.
   *
   * @returns {Promise<{ok:boolean, reason?:string, restored?:number, total?:number}>}
   */
  async function pull() {
    const AI = root.SageAI;
    if (!AI) return { ok: false, reason: 'no-ai' };
    if (!available()) return { ok: false, reason: 'no-crypto' };

    const rows = await fetchRows();
    if (rows === null) {
      return { ok: false, reason: lastError === 'no-table' ? 'no-table'
        : (lastError === 'no-client' ? 'no-client' : 'error') };
    }
    if (!rows.length) return { ok: true, restored: 0, total: 0 };

    // The vault's own salt wins, so the same passphrase works on a new device.
    adoptSalt(rows[0].salt);
    if (!hasPassphrase()) return { ok: false, reason: 'locked', total: rows.length };

    let restored = 0;
    let unreadable = 0;
    for (const row of rows) {
      const plain = await decrypt(row);
      if (plain === null) { unreadable += 1; continue; }
      const added = AI.addKey(plain);
      if (added && added.ok) restored += 1;
    }

    if (unreadable && !restored) {
      return { ok: false, reason: 'wrong-passphrase', total: rows.length };
    }

    lastSyncAt = Date.now();
    if (restored) console.log(`[SpinLog] 🔑 Restored ${restored} key(s) from the vault.`);
    notify('pull');
    return { ok: true, restored, total: rows.length, unreadable };
  }

  /**
   * Make the cloud copy exactly match this device: upload anything missing, and
   * remove anything the ring no longer has.
   *
   * The ONLY operation here that deletes, and it is only ever reached by its own
   * button. push() used to do this as a side effect and it quietly ate the
   * backup every time the ring shrank — including all the way to nothing.
   *
   * @returns {Promise<{ok:boolean, reason?:string, pushed?:number, removed?:number}>}
   */
  async function replace() {
    const AI = root.SageAI;
    if (!AI) return { ok: false, reason: 'no-ai' };
    if (!hasPassphrase()) return { ok: false, reason: 'locked' };

    const supabase = await whenClient();
    if (!supabase) return { ok: false, reason: 'no-client' };
    const name = await tableName(supabase);
    if (!name) return { ok: false, reason: 'no-table' };

    const existing = await fetchRows();
    if (existing === null) return { ok: false, reason: lastError === 'schema' ? 'schema' : 'error' };

    const onRing = new Set(AI.getKeys().map(k => k.id));
    const stale = existing.filter(r => !onRing.has(r.key_id)).map(r => r.key_id);
    if (stale.length) {
      const { error } = await supabase.from(name).delete().in('key_id', stale);
      if (error) {
        console.warn('[SpinLog] 🔑 Could not prune the vault:', error.message);
        return { ok: false, reason: 'error', error: error.message };
      }
    }

    const pushed = await push();
    if (!pushed.ok) return pushed;
    notify('replace');
    return { ok: true, pushed: pushed.pushed || 0, removed: stale.length };
  }

  /**
   * How many backed-up keys this device does not have — without decrypting
   * anything, and so without needing the passphrase.
   *
   * The row's key_id is the same fingerprint AI.keyId() produces from the key
   * itself, so the two sets can be compared directly. That is what lets the
   * panel say "3 in the backup you do not have" and offer a Restore, rather than
   * restoring uninvited to find out.
   *
   * @returns {Promise<number|null>} null when the vault cannot be read
   */
  async function missingHere() {
    const AI = root.SageAI;
    const rows = await fetchRows();
    if (rows === null || !AI) return null;
    const onRing = new Set(AI.getKeys().map(k => k.id));
    return rows.filter(r => !onRing.has(r.key_id)).length;
  }

  // There is deliberately no sync() here.
  //
  // It existed as pull-then-push and was wired to the Unlock button, so entering
  // the passphrase silently restored keys nobody had asked to restore. Unlocking
  // grants access; it does not change the key ring. Restore is its own button,
  // for the same reason removing a key is not allowed to touch the backup.

  function deviceId() {
    const M = root.SageMemory;
    if (M && typeof M.deviceId === 'function') return M.deviceId();
    return 'unknown';
  }

  /** Everything the settings panel needs to describe the vault in one line. */
  function syncState() {
    const AI = root.SageAI;
    return {
      available: available(),
      configured: isConfigured(),
      unlocked: hasPassphrase(),
      hasClient: !!client(),
      online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
      keysOnRing: AI && AI.getKeys ? AI.getKeys().length : 0,
      lastSyncAt,
      lastError,
      table: resolvedTable,
    };
  }

  /**
   * How many keys the cloud is holding, without needing the passphrase.
   * Lets the panel offer a restore before anything has been unlocked.
   */
  async function countRemote() {
    const rows = await fetchRows();
    return rows === null ? null : rows.length;
  }

  /**
   * Work out exactly what is stopping a backup or a restore.
   *
   * "It did not work" has half a dozen causes here — no secure context, no
   * client, no table, missing columns, an empty vault, a passphrase that cannot
   * decrypt — and they need different fixes. So each step is checked on its own
   * and the one that failed is named.
   *
   * @returns {Promise<{ok:boolean, problem:string|null, fix:string|null, detail:object}>}
   */
  async function diagnose() {
    const AI = root.SageAI;
    const out = {
      ok: false,
      problem: null,
      fix: null,
      detail: {
        secureContext: typeof isSecureContext === 'undefined' ? null : isSecureContext,
        webCrypto: available(),
        hasClient: !!client(),
        table: null,
        rows: null,
        decryptable: null,
        keysOnRing: AI && AI.getKeys ? AI.getKeys().length : 0,
        unlocked: hasPassphrase(),
      },
    };

    if (!available()) {
      out.problem = 'no-crypto';
      // By far the most likely cause of this in practice.
      out.fix = out.detail.secureContext === false
        ? 'Encryption needs a secure context. This page is on plain http from a '
          + 'non-local address, so the browser withholds crypto.subtle. Use '
          + 'http://localhost, or https, and it will work.'
        : 'This browser does not provide WebCrypto, so keys cannot be encrypted.';
      return out;
    }

    const supabase = await whenClient();
    if (!supabase) {
      out.problem = 'no-client';
      out.fix = 'The Supabase client never loaded. Check the browser console for a network error.';
      return out;
    }
    out.detail.hasClient = true;

    const name = await tableName(supabase);
    out.detail.table = name;
    if (!name) {
      out.problem = 'no-table';
      out.fix = `Neither "${TABLE}" nor "${TABLE_FALLBACK}" exists. Run supabase/gemini_keys.sql once in the SQL editor.`;
      return out;
    }

    // Column by column, so "run the SQL again" can be said with certainty.
    const NEEDED = ['key_id', 'label', 'cipher', 'iv', 'salt', 'device_id', 'added_at', 'updated_at'];
    const missing = [];
    for (const column of NEEDED) {
      const { error } = await supabase.from(name).select(column).limit(1);
      if (error && isMissingColumn(error)) missing.push(column);
    }
    if (missing.length) {
      out.problem = 'schema';
      out.fix = `The ${name} table is missing ${missing.length} column(s): ${missing.join(', ')}. `
        + 'Run supabase/gemini_keys.sql again — it only adds what is absent.';
      out.detail.missingColumns = missing;
      return out;
    }

    const rows = await fetchRows();
    if (rows === null) {
      out.problem = 'read-failed';
      out.fix = `Reading ${name} failed: ${lastError || 'unknown error'}. If that mentions a policy, `
        + 'run the RLS block in supabase/gemini_keys.sql.';
      return out;
    }
    out.detail.rows = rows.length;

    if (!rows.length) {
      out.problem = 'empty';
      out.fix = out.detail.keysOnRing
        ? 'There is nothing in the backup yet. Press "Back up now" to encrypt and upload '
          + `the ${out.detail.keysOnRing} key(s) on this device.`
        : 'There is nothing in the backup and no keys on this device, so there is nothing to restore.';
      return out;
    }

    if (!hasPassphrase()) {
      out.problem = 'locked';
      out.fix = `${rows.length} key(s) are in the backup. Enter your passphrase to decrypt them.`;
      return out;
    }

    adoptSalt(rows[0].salt);
    const probe = await decrypt(rows.find(r => r.cipher) || rows[0]);
    out.detail.decryptable = probe !== null;
    if (probe === null) {
      out.problem = 'wrong-passphrase';
      out.fix = `${rows.length} key(s) are in the backup but this passphrase cannot decrypt them. `
        + 'Press Lock, then enter the passphrase you used when you created the backup.';
      return out;
    }

    out.ok = true;
    console.log('[SpinLog] 🔑 Key vault healthy:', out.detail);
    return out;
  }

  root.SageKeyVault = {
    TABLE, PBKDF2_ITERATIONS,
    available, isConfigured, hasPassphrase,
    setPassphrase, lock, forget,
    push, pull, replace, syncState, countRemote, missingHere, diagnose, onChange,
    // exposed for the settings panel's own messaging
    isMissingTable, isMissingColumn,
  };
})(typeof self !== 'undefined' ? self : this);
