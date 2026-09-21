// ════════════════════════════════════════════════════════════════════════
// SPINLOG — SAGE AUTOFILL
//
// Sage filling in the boring parts: the service entry form, the add-a-document
// name and notes, and the notes required on historic media uploads.
//
// Two deliberate design rules run through all of it.
//
//   1. NOTHING IS EVER SUBMITTED. Every fill lands in the form, marked so you
//      can see what she touched, and you still press the button yourself. She
//      is drafting, not deciding.
//
//   2. IT WORKS WITHOUT A KEY. Each form has a deterministic local guess built
//      from data the app already holds — today's date, the projected odometer,
//      the usual gap between services, the file name you picked. The model
//      layers on top of that when it is available and improves it; it is never
//      the only thing standing between you and a filled field.
//
// Anything the model returns is validated before it goes near an input: types
// must be one of the three real options, dates must parse, the odometer must be
// plausible against the last reading, and a cost is only ever accepted when you
// actually mentioned one. An omitted field is always better than a wrong one.
// ════════════════════════════════════════════════════════════════════════

(function (root) {
  'use strict';

  const TYPES = ['Showroom', '3rd Party', 'Mods/Updates'];
  const RESERVED_DOC_TYPES = [
    'Driving License', 'Registration Certificate',
    'Pollution Certificate', 'Insurance Policy',
  ];

  // Form data, not conversation — so the persona is deliberately swapped out.
  // Her voice belongs in the chat and in notifications; a service note needs to
  // be something you can read back in two years and understand.
  const SYSTEM = [
    'You fill in fields in a vehicle maintenance log for a KTM Duke 250 motorcycle.',
    'Be precise, plain and brief. No personality, no emoji, no markdown, no commentary,',
    'no explanation. Return only the JSON object you were asked for.',
  ].join(' ');

  // Acronyms that must not be title-cased into nonsense when guessing a
  // document name from a file name.
  const ACRONYMS = ['KTM', 'NOC', 'RC', 'PUC', 'DL', 'RTO', 'EMI', 'GST', 'TN', 'ID', 'NCB', 'OD'];

  let mediaContext = null;

  // ══ READING THE ACTUAL FILE ══════════════════════════════════════════
  // The point of all of this. Guessing from a file name gets you "Warranty Card
  // Ktm"; reading the invoice gets you the date, the total, the odometer reading
  // and what was actually done to her.

  // Inline attachments are base64, which inflates by a third, and the whole
  // request has to stay under Gemini's ~20MB ceiling. 9MB of file is a
  // comfortable fit and well above anything this app normally stores — service
  // bills are already capped at 5MB by validateFileUpload().
  const MAX_INLINE_BYTES = 9 * 1024 * 1024;

  // Browsers leave File.type empty for plenty of real formats, so extensions are
  // the fallback. Only types Gemini can actually take are listed: anything not
  // here is not sent, and the caller falls back to metadata.
  const MIME_BY_EXT = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp',
    heic: 'image/heic', heif: 'image/heif',
    gif: 'image/gif',
    mp3: 'audio/mp3', wav: 'audio/wav', m4a: 'audio/mp4',
    aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
    avi: 'video/x-msvideo', mpeg: 'video/mpeg', mpg: 'video/mpeg',
  };

  const READABLE = /^(image|audio|video)\/|^application\/pdf$/;

  function mimeFor(fileName, declared) {
    const type = String(declared || '').toLowerCase();
    if (READABLE.test(type)) return type;
    const ext = String(fileName || '').split('.').pop().toLowerCase();
    return MIME_BY_EXT[ext] || null;
  }

  /** Blob → bare base64, without the data: prefix Gemini does not want. */
  function toBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('could not read the file'));
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma === -1 ? result : result.slice(comma + 1));
      };
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Turn a File or Blob into an attachment Sage can look at.
   *
   * Returns null rather than throwing for every "we cannot read this" case —
   * too big, wrong format, unreadable — because each caller has a metadata-only
   * path that still does something useful.
   *
   * @returns {Promise<{mimeType:string, data:string, bytes:number}|null>}
   */
  async function readAttachment(blob, fileName) {
    if (!blob) return null;
    const name = fileName || blob.name || '';
    const size = Number(blob.size) || 0;

    if (size <= 0) return null;
    if (size > MAX_INLINE_BYTES) {
      console.warn(`[SpinLog] ${name} is ${(size / 1048576).toFixed(1)}MB — too big to send, going on its details instead.`);
      return null;
    }

    const mimeType = mimeFor(name, blob.type);
    if (!mimeType) {
      console.warn(`[SpinLog] Sage cannot read ${name} — unsupported format.`);
      return null;
    }

    try {
      const data = await toBase64(blob);
      return data ? { mimeType, data, bytes: size } : null;
    } catch {
      return null;
    }
  }

  /** The file already in Supabase behind a historic-media row. */
  async function fetchStoredMedia(storageName, sizeBytes) {
    if (!storageName) return null;
    if (Number(sizeBytes) > MAX_INLINE_BYTES) {
      console.warn(`[SpinLog] ${storageName} is too big to fetch and send; using its details instead.`);
      return null;
    }
    if (!root.dkGetHistoricMediaUrl) return null;
    try {
      const url = await root.dkGetHistoricMediaUrl(storageName);
      if (!url) return null;
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      return await readAttachment(blob, storageName);
    } catch {
      return null;
    }
  }

  // ══ SMALL HELPERS ════════════════════════════════════════════════════

  function el(id) { return document.getElementById(id); }

  function serviceForm() { return el('serviceEntryForm'); }

  /** Service form inputs carry a name and mostly no id, so go through the form. */
  function field(name) {
    const f = serviceForm();
    return f ? f.querySelector(`[name="${name}"]`) : null;
  }

  function isoToday(now) {
    const d = now ? new Date(now) : new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function parseIso(iso) {
    const [y, m, d] = String(iso || '').split('-').map(Number);
    if (!y || !m || !d) return null;
    const date = new Date(y, m - 1, d);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function addDays(iso, days) {
    const date = parseIso(iso);
    if (!date) return null;
    date.setDate(date.getDate() + Math.round(days));
    return isoToday(date);
  }

  function dayGap(fromIso, toIso) {
    const a = parseIso(fromIso);
    const b = parseIso(toIso);
    if (!a || !b) return null;
    return Math.round((b - a) / 86400000);
  }

  function snapshot() {
    const snap = root.dkGetSnapshot ? root.dkGetSnapshot() : null;
    return snap || { all: [], services: [], maxOdo: 0, latest: null };
  }

  function serviceStatus() {
    return root.sageServiceStatus || null;
  }

  // ══ VALIDATION ═══════════════════════════════════════════════════════
  // Everything below runs on model output before it touches an input.

  function cleanIso(value, options) {
    const opts = options || {};
    const raw = String(value || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const date = parseIso(raw);
    if (!date) return null;
    // Round-trip guards against 2026-02-31 parsing into March.
    if (isoToday(date) !== raw) return null;
    if (opts.notBefore && raw < opts.notBefore) return null;
    if (opts.notAfter && raw > opts.notAfter) return null;
    return raw;
  }

  function cleanInt(value, min, max) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return null;
    if (min !== undefined && n < min) return null;
    if (max !== undefined && n > max) return null;
    return n;
  }

  function cleanText(value, max) {
    const out = String(value ?? '')
      .replace(/\s+/g, ' ')
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
      .replace(/^[-*•]\s+/, '')
      .trim();
    if (!out) return null;
    return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
  }

  function parseJson(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { /* some replies wrap it in prose */ }
    const match = String(raw).match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }

  /**
   * One request that should come back as JSON.
   *
   * Charged to chat rather than the background budget: you pressed a button.
   * The raw text is kept alongside the parsed object because a model that
   * answers in prose is still answering — a required notes field should not be
   * refused just because the braces went missing.
   *
   * @returns {Promise<{data:object|null, text:string|null}>}
   */
  async function ask(prompt, options) {
    const AI = root.SageAI;
    if (!AI) return { data: null, text: null };
    const opts = options || {};
    const meta = {};

    const raw = await AI.generate(prompt, {
      system: opts.system || SYSTEM,
      length: 'task',
      // Low: this is data entry, and invention is the failure mode.
      temperature: opts.temperature ?? 0.25,
      // Reading a document needs real room. Being stingy here is what made the
      // first version come back empty.
      maxOutputTokens: opts.maxOutputTokens ?? 1200,
      responseMimeType: 'application/json',
      files: opts.files || null,
      purpose: 'chat',
      meta,
    });

    if (!raw) {
      console.warn('[SpinLog] Autofill got nothing back from Gemini.');
      return { data: null, text: null };
    }
    if (meta.truncated) {
      console.warn('[SpinLog] Autofill reply hit the token ceiling; some fields may be missing.');
    }

    const data = parseJson(raw);
    if (!data) console.warn('[SpinLog] Autofill reply was not JSON:', String(raw).slice(0, 200));
    return { data, text: String(raw) };
  }

  function canAsk() {
    const AI = root.SageAI;
    return !!(AI && AI.ready().ok);
  }

  /** Why she cannot answer right now, in words that suggest a fix. */
  function blockedReason() {
    const AI = root.SageAI;
    if (!AI) return 'Sage is not loaded.';
    const state = AI.ready();
    if (state.ok) return null;
    if (state.reason === 'no-key') return 'Add a Gemini key in Sage settings and she can do the rest.';
    if (state.reason === 'offline') return 'You are offline, so she filled in what she could work out herself.';
    if (state.reason === 'backoff') return 'Her models are busy, so she filled in what she could work out herself.';
    return 'She could not reach her models, so this is what she worked out herself.';
  }

  // ══ APPLYING VALUES ══════════════════════════════════════════════════

  /**
   * Write a value and let the app's own UI layers react to it.
   *
   * No visual marking: a glow on the filled fields read as the same "look here"
   * flash the Log Service shortcut uses to point at this very form, so it said
   * "navigate" when it meant "she wrote this". The hint line under the button
   * already names every field she touched, which is the part worth reading.
   */
  function fill(input, value) {
    if (!input) return false;
    if (value === null || value === undefined || value === '') return false;
    input.value = String(value);
    // The date shell and the mods/updates toggle both listen for these, so the
    // visible pill and the Next Due row stay correct.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  /**
   * The service type is a custom listbox over a hidden input, so the honest way
   * to set it is to activate the option the user would have tapped. That runs
   * the existing handler, which syncs the label, closes the menu and fires
   * change — none of which we have to reimplement or keep in step.
   */
  function setServiceType(value) {
    if (!value || TYPES.indexOf(value) === -1) return false;
    const option = el('serviceTypeMenu')
      ?.querySelector(`.entry-select-option[data-value="${CSS.escape(value)}"]`);
    if (option) {
      option.click();
      return true;
    }
    // Fallback if the menu markup ever changes: the hidden input plus a change
    // event is still enough for the form to submit correctly.
    const hidden = el('serviceType');
    if (!hidden) return false;
    hidden.value = value;
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // ══ SERVICE FORM ═════════════════════════════════════════════════════

  /** What you have already typed. Never overwritten. */
  function currentService() {
    const type = el('serviceType');
    return {
      type: (type?.value || '').trim(),
      date: (field('date')?.value || '').trim(),
      nextDue: (field('nextDue')?.value || '').trim(),
      odo: (field('odo')?.value || '').trim(),
      cost: (field('cost')?.value || '').trim(),
      notes: (field('notes')?.value || '').trim(),
    };
  }

  /** Typical days between services, from the record history. */
  function usualServiceGapDays(services) {
    const dates = (services || [])
      .map(s => s.date)
      .filter(Boolean)
      .sort();
    if (dates.length < 2) return null;
    const gaps = [];
    for (let i = 1; i < dates.length; i++) {
      const gap = dayGap(dates[i - 1], dates[i]);
      if (gap && gap > 0) gaps.push(gap);
    }
    if (!gaps.length) return null;
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)];   // median resists one odd visit
  }

  /**
   * Everything that can be worked out with no model at all. This is what makes
   * the button useful on a dead key or a flaky connection.
   */
  function localServiceGuess() {
    const snap = snapshot();
    const status = serviceStatus();
    const services = snap.services || [];
    const latest = snap.latest || null;
    const today = isoToday();
    const out = { date: today };

    // Odometer: the projected reading if the scheduler has one, otherwise the
    // last recorded figure. Rounded, because a projection is not a measurement.
    const projected = status?.currentOdo;
    const base = Number(snap.maxOdo) || 0;
    if (Number.isFinite(projected) && projected >= base) out.odo = Math.round(projected / 10) * 10;
    else if (base > 0) out.odo = base;

    // Next due: prefer the interval divided by real daily distance, fall back to
    // the usual gap between visits, then to a plain quarter.
    const intervalKm = root.SageScheduler?.SERVICE_INTERVAL_KM || null;
    const kmPerDay = status?.kmPerDay;
    let days = null;
    if (intervalKm && Number.isFinite(kmPerDay) && kmPerDay > 0.5) days = intervalKm / kmPerDay;
    if (!days) days = usualServiceGapDays(services);
    if (!days) days = 90;
    out.nextDue = addDays(today, Math.min(365, Math.max(30, days)));

    // Type: whatever this bike usually gets. Only when there is a clear habit —
    // a wrong type is more annoying than an empty one.
    const counts = {};
    services.slice(0, 6).forEach(s => {
      if (TYPES.indexOf(s.type) !== -1) counts[s.type] = (counts[s.type] || 0) + 1;
    });
    const ranked = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    if (ranked.length && counts[ranked[0]] >= 2) out.type = ranked[0];
    else if (latest && TYPES.indexOf(latest.type) !== -1) out.type = latest.type;

    // Cost and notes are never guessed. Money must not be invented, and a made
    // up note is worse than a blank one.
    return out;
  }

  /** Trimmed history for the prompt — enough to reason from, small enough to send. */
  function serviceContext() {
    const snap = snapshot();
    const status = serviceStatus();
    return {
      today: isoToday(),
      lastServiceOdo: Number(snap.maxOdo) || null,
      lastServiceDate: snap.latest?.date || null,
      lastServiceType: snap.latest?.type || null,
      scheduledNextDue: snap.latest?.next_due || null,
      estimatedOdoNow: Number.isFinite(status?.currentOdo) ? Math.round(status.currentOdo) : null,
      kmPerDayAverage: Number.isFinite(status?.kmPerDay) ? Math.round(status.kmPerDay) : null,
      serviceIntervalKm: root.SageScheduler?.SERVICE_INTERVAL_KM || null,
      usualGapDays: usualServiceGapDays(snap.services),
      recentServices: (snap.services || []).slice(0, 6).map(s => ({
        date: s.date, type: s.type,
        odo: Number(s.odo) || null,
        cost: Number(s.cost) || null,
        notes: s.notes || null,
      })),
    };
  }

  function servicePrompt(current, description, context, hasFile) {
    const filled = Object.keys(current).filter(k => current[k]);
    const lines = ['Fill in one service log entry for this motorcycle.', ''];

    if (hasFile) {
      // Reading a real invoice, so the history is background only. Anything the
      // document does not say must come back absent rather than estimated.
      lines.push(
        'The attached file is the bill or invoice for this service visit. Read it and',
        'transcribe what it actually says.',
        '',
        'How to read it:',
        '- Every value must come from the document. Do not calculate anything, and do not',
        '  fill a gap from the history below — it is there only to sanity-check what you read.',
        '- If the document does not clearly show a field, omit that key. A blank field is',
        '  the correct answer; a plausible guess is not.',
        '- "cost" is the final total payable: after any discount, including tax.',
        '- The odometer may be labelled KM, Kms, ODO or "vehicle reading". If the document',
        '  shows both a current reading and a next-service reading, take the current one.',
        '- "type" is "Showroom" for an authorised KTM dealer invoice, "3rd Party" for an',
        '  independent garage or roadside mechanic, and "Mods/Updates" when the bill is only',
        '  for parts, accessories or customisation rather than servicing.',
        '- "notes" summarises the actual line items on the bill in one short sentence.',
        '- "nextDue" only if the document states a next service date. Never work it out.',
        description ? `\nThe rider also says:\n${description}` : '',
      );
    } else {
      lines.push(
        description
          ? `What the rider says happened:\n${description}`
          : 'The rider has attached nothing and described nothing, so infer sensible values from the history alone.',
      );
    }

    lines.push(
      '',
      filled.length
        ? `Already filled in by the rider — do not return these keys at all:\n${
            JSON.stringify(Object.fromEntries(filled.map(k => [k, current[k]])))}`
        : 'Nothing is filled in yet.',
      '',
      `${hasFile ? 'For cross-checking only' : "The bike's history and current state"}:\n${JSON.stringify(context, null, 1)}`,
      '',
      'Return a JSON object using only the keys you can fill confidently:',
      '{',
      `  "type": one of ${JSON.stringify(TYPES)},`,
      '  "date": "YYYY-MM-DD" — the day the work was done,',
      '  "nextDue": "YYYY-MM-DD" — when the next service falls due; omit entirely for Mods/Updates,',
      '  "odo": whole kilometres on the clock that day,',
      '  "cost": rupees, a number with no symbol,',
      '  "notes": one short factual sentence describing the work done',
      '}',
      '',
      'Rules:',
      '- Omit any key you would be guessing at. A missing key is always better than a wrong value.',
      hasFile
        ? '- Never invent a cost. If no total is legible on the bill, omit "cost".'
        : '- Never invent a cost. Include "cost" only if the rider actually stated an amount.',
      '- "date" cannot be in the future.',
      '- "notes" describes the work, not the bike, and stays under 200 characters.',
      '- No units, no currency symbols, no commas inside numbers.',
      '- Output the JSON object and nothing else.',
    );

    return lines.filter(l => l !== '').join('\n');
  }

  /**
   * Validate model output against reality before any of it is applied.
   *
   * @param {object} raw
   * @param {object} context
   * @param {boolean} [fromDocument] Transcribed off an invoice rather than
   *   inferred. The odometer floor is dropped in that case: a bill being filed
   *   late is legitimately below the highest reading already recorded, and
   *   rejecting it would silently discard a correct value.
   */
  function validateService(raw, context, fromDocument) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;

    if (TYPES.indexOf(raw.type) !== -1) out.type = raw.type;

    const today = isoToday();
    const date = cleanIso(raw.date, { notAfter: today });
    if (date) out.date = date;

    // A next-due date must be after the work itself and inside a sane horizon.
    const from = out.date || context.today;
    const nextDue = cleanIso(raw.nextDue, { notBefore: from, notAfter: addDays(from, 400) });
    if (nextDue && out.type !== 'Mods/Updates') out.nextDue = nextDue;

    // Inferred readings only go up. Transcribed ones are trusted, with a ceiling
    // that still catches a phone number read as an odometer.
    const highest = Number(context.lastServiceOdo) || 0;
    const floor = fromDocument ? 0 : highest;
    const odo = cleanInt(raw.odo, floor, highest + 60000);
    if (odo !== null) out.odo = odo;

    const cost = cleanInt(raw.cost, 0, 500000);
    if (cost !== null) out.cost = cost;

    const notes = cleanText(raw.notes, 200);
    if (notes) out.notes = notes;

    return out;
  }

  function serviceHint(message, kind) {
    const hint = el('serviceAutofillHint');
    if (!hint) return;
    hint.textContent = message || '';
    hint.classList.remove('is-ok', 'is-bad', 'is-warn');
    if (kind) hint.classList.add(`is-${kind}`);
  }

  // The proposal panel lived here: proposalHost(), propose(), clearProposal(),
  // showValue() and an escapeHtml() that only it used.
  //
  // It listed what she had read and waited for a second press — "Fill these in" —
  // before anything reached the form. That was the right answer to the wrong
  // problem. The complaint it was built for was that she filled the form UNASKED,
  // and the button staying dormant until a file is attached already fixes that: he
  // attaches, he presses, she fills. Asking again after he has pressed the one
  // button whose whole purpose is "fill this in" is a confirmation of the thing he
  // just confirmed, and the panel repeated in a read-only box the same values that
  // were about to appear in the editable fields directly above it.
  //
  // The fields are the review. They are labelled, they are editable, they are where
  // he was going to look anyway, and a wrong value is retyped in place rather than
  // discarded and re-entered from scratch. What survives is the part that mattered:
  // a value that REPLACED something he typed is still named in the hint, so a fill
  // is never a silent overwrite.

  // ══ PROGRESS ═════════════════════════════════════════════════════════
  // A single generateContent call reports nothing at all until it returns, so
  // this percentage is paced, not measured — the same approach
  // startUploadPercent() already uses for uploads in script.js.
  //
  // Two rules keep it honest: it creeps toward a ceiling below 100 and slows as
  // it goes, so it never stalls on a round number and never claims to be
  // finished; and the real phase boundaries (file read, reply received) push it
  // forward, so the jumps line up with work actually completing.
  const PROGRESS_CEILING = 94;
  const PROGRESS_TICK_MS = 200;

  function labelOf(button) {
    return button?.querySelector('.sage-fill-label') || null;
  }

  /** Put a button back to normal without claiming success. */
  function releaseButton(button) {
    if (!button) return;
    button.disabled = false;
    button.classList.remove('is-busy');
    const text = labelOf(button);
    if (text) text.textContent = button.dataset.idleLabel || 'Let Sage fill it in';
  }

  /**
   * @param {HTMLElement|null} button
   * @param {string} phase Verb shown beside the percentage.
   * @returns {{to:Function, done:Function}}
   */
  function startProgress(button, phase) {
    if (!button) return { to() {}, done() {} };

    const text = labelOf(button);
    const idle = button.dataset.idleLabel || 'Let Sage fill it in';
    let pct = 1;
    let word = phase || 'Working';

    const paint = () => { if (text) text.textContent = `${word} ${Math.round(pct)}%`; };

    button.disabled = true;
    button.classList.add('is-busy');
    paint();

    const timer = setInterval(() => {
      const room = PROGRESS_CEILING - pct;
      if (room <= 0.4) return;
      // Ease out: fast while there is a lot of room, crawling near the ceiling.
      pct += Math.max(0.3, room * 0.055);
      paint();
    }, PROGRESS_TICK_MS);

    return {
      /** A real phase finished — jump the bar and optionally rename it. */
      to(next, nextWord) {
        if (nextWord) word = nextWord;
        if (Number.isFinite(next) && next > pct) pct = Math.min(PROGRESS_CEILING, next);
        paint();
      },
      done(ok) {
        clearInterval(timer);
        pct = 100;
        word = ok === false ? 'Nothing' : 'Done';
        paint();
        button.classList.remove('is-busy');
        button.disabled = false;
        // Held briefly so 100% is actually seen before the label goes back.
        setTimeout(() => { if (text) text.textContent = idle; }, 1100);
      },
    };
  }

  const FIELD_LABELS = {
    type: 'type', date: 'date', nextDue: 'next due',
    odo: 'ODO', cost: 'cost', notes: 'notes',
  };

  /**
   * Fill the empty parts of the service form.
   * @param {{force?:boolean}} [options] force overwrites what you already typed.
   */
  async function service(options) {
    const opts = options || {};
    const button = el('serviceAutofill');
    if (!serviceForm()) return { ok: false, reason: 'no-form' };

    const current = currentService();
    // Your notes double as the brief: describe the work there and she has
    // something real to work from. It is optional.
    const description = current.notes || '';

    const billFile = el('fileInput')?.files?.[0] || null;
    const progress = startProgress(button, billFile ? 'Opening' : 'Thinking');
    serviceHint('');

    // The bill, if you have attached one. This is the good path — a real invoice
    // carries the date, the total, the odometer and the work itself.
    const attachment = billFile ? await readAttachment(billFile) : null;
    const readingFile = !!attachment;

    let fromModel = {};
    let asked = false;

    if (canAsk()) {
      asked = true;
      progress.to(28, readingFile ? 'Reading' : 'Thinking');
      const context = serviceContext();
      const { data } = await ask(
        servicePrompt(current, description, context, readingFile),
        { files: attachment ? [attachment] : null, maxOutputTokens: readingFile ? 1400 : 900 }
      );
      progress.to(90, 'Filling in');
      fromModel = validateService(data, context, readingFile);
    } else {
      progress.to(70, 'Working out');
    }

    // With a document in hand, what it does not say is left blank on purpose:
    // an estimated odometer sitting beside transcribed invoice figures would
    // read as fact. Without one, the local guess is the useful floor.
    const base = readingFile ? {} : localServiceGuess();
    const merged = { ...base, ...fromModel };

    // NEXT DUE IS HIS, ALWAYS.
    //
    // Every other field on this form is a fact about a visit that has happened —
    // it is on the bill, or it is not. Next due is a DECISION about the future,
    // and hers was the least reliable value on the panel: with a bill she took
    // whatever date the invoice printed, which dealers put there optimistically,
    // and without one she worked it out from average daily distance. Either way he
    // was checking it rather than reading it, and a field you always check is a
    // field better left blank.
    //
    // The calendar's +3/+6/+12 chips, measured from the service date, do this job
    // properly and in one tap — see chipsFor() in src/js/date-picker.js.
    delete merged.nextDue;

    // Which fields she can actually change: she has a value, and it differs from
    // what is in the form. Just the keys — this used to carry a formatted `shown`
    // and `was` for each row, which the review panel displayed. The panel is gone and
    // the fill loop below reads `merged` directly, so formatting both values for
    // every field was work whose only output was discarded.
    // nextDue is absent on purpose — see the delete above.
    const changes = ['type', 'date', 'odo', 'cost', 'notes']
      .filter(key => merged[key] !== undefined && merged[key] !== null && merged[key] !== '')
      .filter(key => String(merged[key]) !== String(current[key] || ''));

    progress.done(changes.length > 0);

    const blocked = blockedReason();
    if (!changes.length) {
      let why = blocked;
      if (!why && readingFile) why = 'She could not make out any new details on that bill. Fill them in yourself.';
      if (!why && asked && billFile) why = 'That file could not be read, so there was nothing new to take from it.';
      serviceHint(why || 'Nothing she can add to this — it is already filled in.', why ? 'warn' : 'ok');
      return { ok: false, applied: [], skipped: [], readFile: readingFile };
    }

    const missing = ['type', 'date', 'odo', 'cost', 'notes']
      .filter(k => !merged[k] && !current[k])
      .map(k => FIELD_LABELS[k] || k);
    const note = [
      missing.length
        ? `No ${missing.join(', ')} — she could not read ${missing.length === 1 ? 'it' : 'those'}.`
        : '',
      blocked || '',
    ].filter(Boolean).join(' ');

    // STRAIGHT INTO THE FIELDS.
    //
    // The review panel is gone. It was the right answer to the wrong problem: the
    // complaint it fixed was that she filled the form UNASKED, and the button being
    // dormant until a bill is attached already fixes that — he attaches, he presses,
    // she fills. Asking again after he has pressed the one button whose entire
    // purpose is "fill this in" is a confirmation for a thing he just confirmed.
    //
    // The fields are the review. They are editable, they are labelled, they are
    // where he was going to look anyway, and a wrong value is retyped in place
    // rather than discarded and re-entered from scratch.
    const applied = [];
    const replaced = [];

    // Type first: it decides whether the Next Due row is even visible.
    if (merged.type && setServiceType(merged.type)) applied.push('type');
    [
      ['date', field('date')],
      ['odo', field('odo')],
      ['cost', field('cost')],
      ['notes', field('notes')],
    ].forEach(([key, input]) => {
      if (merged[key] === undefined || merged[key] === null || merged[key] === '') return;
      if (String(merged[key]) === String(current[key] || '')) return;
      if (current[key]) replaced.push(FIELD_LABELS[key] || key);
      if (fill(input, merged[key])) applied.push(key);
    });

    const names = applied.map(k => FIELD_LABELS[k] || k).join(', ');
    // Replacements are still named. He pressed the button, so overwriting is what he
    // asked for — but which of his own words went is not something to leave him to
    // notice on his own.
    const over = replaced.length ? ` Replaced what you had in ${replaced.join(', ')}.` : '';
    serviceHint(`Filled in ${names}.${over}${note ? ` ${note}` : ''}`, 'ok');

    return { ok: true, applied, replaced, values: merged, readFile: readingFile };
  }

  // ══ ADD-A-DOCUMENT ═══════════════════════════════════════════════════

  /** "warranty_card_ktm.pdf" → "Warranty Card KTM" */
  function nameFromFile(fileName) {
    const base = String(fileName || '')
      .replace(/\.[a-z0-9]{1,6}$/i, '')
      .replace(/[_\-.]+/g, ' ')
      .replace(/\d{6,}/g, ' ')          // upload timestamps carry no meaning
      .replace(/\s+/g, ' ')
      .trim();
    if (!base) return null;
    const titled = base.split(' ').filter(Boolean).map(word => {
      const upper = word.toUpperCase();
      if (ACRONYMS.indexOf(upper) !== -1) return upper;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(' ');
    return titled.slice(0, 40);
  }

  function docPrompt(fileName, current, hasFile) {
    const V = root.dkVehicle || null;
    return [
      'The rider is filing a document about his motorcycle and needs it named and described.',
      '',
      hasFile
        ? 'The document itself is attached. Read it and describe what it actually is.'
        : `Only the file name is available: ${fileName}`,
      V ? `His bike: ${V.make} ${V.name}, registration ${V.registration}.` : '',
      `These four already have their own card, so must NOT be returned as the name: ${JSON.stringify(RESERVED_DOC_TYPES)}.`,
      'If the document really is one of those four, give a more specific name instead —',
      'add the insurer, the authority or the year, so it stands apart from the fixed card.',
      current.name ? `He has already typed the name "${current.name}" — do not return "name".` : '',
      current.notes ? 'He has already typed notes — do not return "notes".' : '',
      '',
      'Return a JSON object:',
      '{',
      '  "name": a short human label for this document, title case, 3 to 40 characters,',
      '  "notes": what it is and the details worth having to hand later',
      '}',
      '',
      'Rules:',
      hasFile
        ? '- Take everything from the document. Reference numbers, the issuer and any expiry '
          + 'or validity date are exactly what makes the note useful later, so include them when '
          + 'they are legible — but never invent or complete one you cannot fully read.'
        : '- Base the name on the file name alone. Do not invent a reference number, an issuer or a date.',
      '- If you cannot tell what the document is, omit "name" rather than guessing.',
      '- "notes" stays under 280 characters, plain sentences, no bullet points.',
      '- Output the JSON object and nothing else.',
    ].filter(Boolean).join('\n');
  }

  function docHint(message, kind) {
    const hint = el('docAddHint');
    if (!hint) return;
    hint.textContent = message || '';
    hint.classList.toggle('is-bad', kind === 'bad');
  }

  /** Fill the add-a-document name and notes from the file you picked. */
  async function doc(options) {
    const opts = options || {};
    const button = el('docAddAutofill');
    const nameEl = el('docAddName');
    const notesEl = el('docAddNotes');
    const fileEl = el('docAddFile');
    if (!nameEl || !fileEl) return { ok: false, reason: 'no-form' };

    const file = fileEl.files && fileEl.files[0];
    if (!file) {
      docHint('Pick the file first — she names it from that.', 'bad');
      return { ok: false, reason: 'no-file' };
    }

    const current = { name: nameEl.value.trim(), notes: (notesEl?.value || '').trim() };
    const progress = startProgress(button, 'Opening');

    const attachment = await readAttachment(file);
    const readingFile = !!attachment;

    // The file name is only ever the floor here, and only when the document
    // itself could not be read.
    const merged = {};
    if (!readingFile) {
      const guess = nameFromFile(file.name);
      if (guess) merged.name = guess;
    }

    if (canAsk()) {
      progress.to(28, readingFile ? 'Reading' : 'Thinking');
      const { data } = await ask(
        docPrompt(file.name, current, readingFile),
        { files: attachment ? [attachment] : null, maxOutputTokens: readingFile ? 1200 : 500 }
      );
      progress.to(90, 'Naming');
      if (data && typeof data === 'object') {
        const name = cleanText(data.name, 40);
        // A name colliding with one of the four fixed cards is rejected by the
        // save handler, so it is dropped here instead of failing later.
        const clashes = name && RESERVED_DOC_TYPES
          .some(t => t.toLowerCase() === name.toLowerCase());
        if (name && !clashes) merged.name = name;

        const notes = cleanText(data.notes, 280);
        if (notes) merged.notes = notes;
      }
    }

    // Same rule as the service form: she proposes, he applies. Global means global
    // — a document's name is the thing he will search for later, so having her
    // quietly replace one he chose himself is the same fault in a smaller field.
    const rows = [
      { key: 'name', label: 'Name', input: nameEl, value: merged.name },
      { key: 'notes', label: 'Notes', input: notesEl, value: merged.notes },
    ]
      .filter(r => r.input && r.value && String(r.value) !== String(current[r.key] || ''))
      .map(r => ({
        key: r.key,
        label: r.label,
        value: r.value,
        shown: String(r.value),
        was: current[r.key] ? String(current[r.key]) : '',
      }));

    progress.done(rows.length > 0);

    if (!rows.length) {
      docHint(blockedReason()
        || (readingFile
          ? 'She could not tell what that document is. Name it yourself.'
          : 'Nothing to add — it already looks named.'), 'bad');
      return { ok: false, applied: [], readFile: readingFile };
    }

    // STRAIGHT INTO THE FIELDS, the same as the service form above.
    //
    // This was the last review panel left. It listed the name and the note, then
    // asked him to press "Fill these in" — a confirmation of the button he had just
    // pressed, whose entire purpose was to fill them in. Two presses for one
    // intention, and the panel repeated in a read-only box the two values that were
    // about to appear in the two editable fields directly above it.
    //
    // The fields are the review. Both are text inputs he can retype, and a name he
    // dislikes is quicker to correct in place than to discard and think up himself.
    const blocked = blockedReason();
    const applied = [];
    const replaced = [];
    rows.forEach(r => {
      const input = r.key === 'name' ? nameEl : notesEl;
      if (!input) return;
      if (r.was) replaced.push(r.label);
      if (fill(input, r.value)) applied.push(r.key);
    });

    const names = applied.map(k => (k === 'name' ? 'Name' : 'Notes')).join(' and ');
    // A replacement is still named. He asked for the fill, so overwriting is what he
    // wanted — but which of his own words went is not something to leave him to spot.
    const over = replaced.length ? ` Replaced what you had in ${replaced.join(' and ')}.` : '';
    docHint(applied.length
      ? `Filled in ${names}.${over}${blocked ? ` ${blocked}` : ''}`
      : 'Nothing was changed.', applied.length ? 'ok' : 'warn');

    return { ok: true, applied, replaced, values: merged, readFile: readingFile };
  }

  // ══ HISTORIC MEDIA NOTES ═════════════════════════════════════════════

  /**
   * Context for the notes modal, handed over by the upload flow so she knows
   * what she is writing about. Cleared when the modal closes.
   */
  function setMediaContext(context) {
    mediaContext = context || null;
    const button = el('historicNotesAutofill');
    if (button) button.hidden = !mediaContext;
  }

  function mediaPrompt(context, existing, hasFile) {
    const V = root.dkVehicle || null;
    const kind = context.mediaType || 'file';
    const lines = [
      'The rider is archiving a piece of media about his motorcycle and needs a note',
      'describing it, so it still makes sense to him years from now.',
      '',
    ];

    if (hasFile) {
      lines.push(
        `The ${kind} itself is attached. Look at it — or listen to it — and describe what is actually there.`,
        '',
        'What makes a useful note:',
        kind === 'audio'
          ? '- What you can hear: cold start, idle, revs, exhaust note, any knock, rattle or whine, '
            + 'and roughly how long it runs for.'
          : '- What is actually in the frame: the bike, the setting, time of day, weather, the road or '
            + 'location, anything modified or newly fitted, anyone present, and the condition she is in.',
        '- Anything legible in it counts: an odometer reading, a number plate, a service board, a sign.',
        '- Say what makes this one worth keeping rather than narrating every detail.',
      );
    } else {
      lines.push(
        'The file itself could not be attached, so work from its details alone and stay general.',
      );
    }

    lines.push(
      '',
      `File name: ${context.fileName || 'unknown'}`,
      `Kind: ${kind}`,
      context.uploadedOn ? `Dated: ${context.uploadedOn}` : '',
      V ? `The bike: ${V.make} ${V.name}, registration ${V.registration}` : '',
      existing ? `\nHe has already written this — tighten and extend it rather than starting over:\n${existing}` : '',
      '',
      'Return a JSON object:',
      '{ "notes": one to three short sentences }',
      '',
      'Rules:',
      hasFile
        ? '- Describe only what is genuinely in the file. Never guess at a date, a place or a '
          + 'reading you cannot actually make out.'
        : '- Invent nothing. A plain, honest note about the kind of file it is beats a made-up scene.',
      '- Plain factual sentences. No markdown, no emoji, no bullet points.',
      '- Under 320 characters.',
      '- Output the JSON object and nothing else.',
    );

    return lines.filter(l => l !== '').join('\n');
  }

  function mediaHint(message, kind) {
    const help = el('historicNotesHelp');
    if (!help) return;
    help.textContent = message;
    help.classList.toggle('is-bad', kind === 'bad');
  }

  /** Draft the required note on a historic media upload. */
  async function mediaNotes() {
    const button = el('historicNotesAutofill');
    const input = el('historicNotesInput');
    if (!input) return { ok: false, reason: 'no-form' };

    if (!mediaContext) {
      mediaHint('She needs to know which file this is before she can write about it.', 'bad');
      return { ok: false, reason: 'no-context' };
    }
    // Unlike the other two forms there is no honest local fallback here: a note
    // assembled from a file name by string surgery is worse than no note, and
    // this field is required, so the rider would just have to rewrite it.
    if (!canAsk()) {
      mediaHint(blockedReason() || 'She cannot write this one right now.', 'bad');
      return { ok: false, reason: 'not-ready' };
    }

    const progress = startProgress(button, 'Opening');

    // Either the file being uploaded right now, or the one already in the vault
    // behind this Record History row.
    let attachment = null;
    if (mediaContext.file) {
      attachment = await readAttachment(mediaContext.file, mediaContext.fileName);
    } else if (mediaContext.storageName) {
      attachment = await fetchStoredMedia(mediaContext.storageName, mediaContext.sizeBytes);
    }

    const kind = mediaContext.mediaType || 'file';
    progress.to(30, attachment
      ? (kind === 'audio' ? 'Listening' : 'Looking')
      : 'Writing');

    const { data, text } = await ask(
      mediaPrompt(mediaContext, input.value.trim(), !!attachment),
      { files: attachment ? [attachment] : null, maxOutputTokens: attachment ? 1200 : 600 }
    );
    progress.to(92, 'Writing');

    // A note is required by this form, so prose that missed the JSON braces is
    // still accepted rather than thrown away — that refusal is what made this
    // dead-end at "did not come back as anything useful".
    let notes = data && typeof data === 'object' ? cleanText(data.notes ?? data.note, 400) : null;
    if (!notes && data && typeof data === 'string') notes = cleanText(data, 400);
    if (!notes && text && !/^\s*[[{]/.test(text)) notes = cleanText(text, 400);

    if (!notes) {
      progress.done(false);
      mediaHint(attachment
        ? 'She looked at it but could not describe it. Write it yourself, or try again.'
        : 'That file was too large or the wrong format for her to open. Write the note yourself.',
        'bad');
      return { ok: false, reason: 'empty', readFile: !!attachment };
    }

    progress.done(true);
    fill(input, notes);
    mediaHint(attachment
      ? `She ${kind === 'audio' ? 'listened to' : 'looked at'} it and wrote this. Edit anything wrong, then save.`
      : 'Written from the file details only. Edit anything wrong, then save.');
    return { ok: true, values: { notes }, readFile: !!attachment };
  }

  // ══ WIRING ═══════════════════════════════════════════════════════════

  /** Identity of a picked file, so the same one is never read twice. */
  function fileSignature(file) {
    return file ? `${file.name}|${file.size}|${file.lastModified || 0}` : '';
  }

  /**
   * Offer to read a file the moment it is attached. Do not read it.
   *
   * This used to fire `run()` on the change event, on the reasoning that attaching
   * the bill is the point at which every field becomes knowable, so a second tap
   * was asking for something the app already had.
   *
   * That reasoning was wrong in the way that matters: it spent a Gemini request
   * and overwrote fields he may have already filled, without being asked. Picking
   * a file is him filing a bill, not him asking her to read it — and the two are
   * only the same action about half the time. Worse, it made the button a lie:
   * "Let Sage fill it in" is an offer, and the offer had already been taken before
   * he could decline it.
   *
   * So the file arms the button instead. The hint names what she would read, the
   * button picks up `.is-offered` so it is visibly the next thing to press, and
   * nothing leaves the device until he presses it.
   */
  /**
   * Dormant until there is something to read, then live.
   *
   * She could work without a file — localServiceGuess() estimates the odometer from
   * average daily distance and the type from what this bike usually gets. That is
   * exactly the behaviour that came across as random filling, and it is the weakest
   * thing she does: an estimate in a field that looks identical to a transcription
   * is worse than an empty field, because there is nothing about it that says
   * "check me". A bill is the only input that makes her reliable.
   *
   * So no file, no offer. The button is visibly dormant and says why when pressed —
   * `aria-disabled` rather than the `disabled` attribute, because a dead control
   * that swallows the click teaches him nothing, and `disabled` is already spoken
   * for by the busy state.
   */
  function setDormant(button, dormant, why) {
    if (!button) return;
    button.classList.toggle('is-dormant', !!dormant);
    button.classList.toggle('is-offered', !dormant);
    if (dormant) button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
    if (why) button.title = why;
  }

  function offerOnPick(input, button, hint) {
    if (!input || input.dataset.sageAutoRead === 'true') return;
    input.dataset.sageAutoRead = 'true';
    // `dk-bill-ready` as well as `change`: when several files are picked they are
    // merged into one PDF first, and the `change` that fired at pick time carried a
    // list she cannot read. script.js fires this once the input holds the single
    // merged file. See setupFileInput() there.
    ['change', 'dk-bill-ready'].forEach(type => input.addEventListener(type, () => {
      // script.js validates first and clears the input when a file is rejected,
      // so an empty list here means there is nothing worth offering.
      const file = input.files && input.files[0];
      if (!button) return;
      if (!file) {
        setDormant(button, true, DORMANT_WHY);
        if (hint) hint('');
        return;
      }
      // Still signature-guarded, so re-rendering a form does not re-nudge him
      // about a file he has already dealt with.
      const signature = fileSignature(file);
      if (signature === input.dataset.sageLastOffered) return;
      input.dataset.sageLastOffered = signature;
      setDormant(button, false);
      button.title = `Read ${file.name}`;
      if (hint) hint(`${file.name} is attached — tap to have her read it.`);
    }));
  }

  const DORMANT_WHY = 'Attach the bill first — she reads the details off it.';

  function setup() {
    const serviceBtn = el('serviceAutofill');
    if (serviceBtn && serviceBtn.dataset.ready !== 'true') {
      serviceBtn.dataset.ready = 'true';
      serviceBtn.dataset.idleLabel = serviceBtn.querySelector('.sage-fill-label')?.textContent?.trim()
        || 'Let Sage fill it in';
      // Dormant from the start: an empty form has no bill in it.
      setDormant(serviceBtn, true, DORMANT_WHY);
      serviceBtn.addEventListener('click', () => {
        if (serviceBtn.getAttribute('aria-disabled') === 'true') {
          serviceHint(DORMANT_WHY, 'warn');
          el('customFileButton')?.focus({ preventScroll: true });
          return;
        }
        serviceBtn.classList.remove('is-offered');
        service().catch(() => releaseButton(serviceBtn));
      });
      offerOnPick(el('fileInput'), serviceBtn, serviceHint);
      // A reset clears her hint and lets the next bill be offered for a fresh entry.
      serviceForm()?.addEventListener('reset', () => {
        window.setTimeout(() => {
          const input = el('fileInput');
          if (input) {
            input.dataset.sageLastRead = '';
            input.dataset.sageLastOffered = '';
          }
          // Back to dormant with the rest of the form: reset clears the file input,
          // so there is nothing for her to read again.
          setDormant(serviceBtn, true, DORMANT_WHY);
          serviceHint('');
        }, 0);
      });
    }

    const docBtn = el('docAddAutofill');
    if (docBtn && docBtn.dataset.ready !== 'true') {
      docBtn.dataset.ready = 'true';
      docBtn.dataset.idleLabel = docBtn.querySelector('.sage-fill-label')?.textContent?.trim()
        || 'Let Sage name it';
      // The document form is the same bargain: she names a document by reading it,
      // so with nothing attached there is nothing to name it from.
      const docWhy = 'Pick the file first — she names it from that.';
      setDormant(docBtn, true, docWhy);
      docBtn.addEventListener('click', () => {
        if (docBtn.getAttribute('aria-disabled') === 'true') {
          docHint(docWhy, 'bad');
          return;
        }
        docBtn.classList.remove('is-offered');
        doc().catch(() => releaseButton(docBtn));
      });
      // Same rule as the service form: attaching arms the button, it does not fire
      // it. "Global change" — no upload anywhere starts her on its own.
      offerOnPick(el('docAddFile'), docBtn, null);
    }

    const mediaBtn = el('historicNotesAutofill');
    if (mediaBtn && mediaBtn.dataset.ready !== 'true') {
      mediaBtn.dataset.ready = 'true';
      mediaBtn.dataset.idleLabel = mediaBtn.querySelector('.sage-fill-label')?.textContent?.trim()
        || 'Let Sage draft it';
      mediaBtn.addEventListener('click', () => mediaNotes().catch(() => releaseButton(mediaBtn)));
    }

    console.log('[SpinLog] ✅ Sage autofill ready');
  }

  root.SageAutofill = {
    TYPES, RESERVED_DOC_TYPES, MAX_INLINE_BYTES,
    setup, service, doc, mediaNotes, setMediaContext,
    // reading files
    readAttachment, fetchStoredMedia, mimeFor,
    // exposed for the forms and for reasoning about them
    localServiceGuess, serviceContext, validateService, nameFromFile,
    cleanIso, cleanInt, cleanText, parseJson, canAsk, blockedReason,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup, { once: true });
  } else {
    setup();
  }
})(typeof self !== 'undefined' ? self : this);
