// ════════════════════════════════════════════════════════════════════════
// SPINLOG — SAGE TOOLS
//
// Her hands. The bridge between what she says and what the app does.
//
// Why this exists: asked to update an insurance date, she replied "got it,
// registered that for 24/06/2027" and nothing happened. She had no way to act
// and no way to know she had no way to act, so she filled the gap with a
// plausible outcome. You cannot instruct that away — a model asked to do
// something it cannot do will describe having done it. The only real fix is to
// give it genuine controls whose results come back as facts.
//
// Everything here is a thin declaration over window.dkApp, which owns the actual
// work. This file's job is only to describe each control to the model in terms
// it will use correctly, and to refuse cleanly when the app is not ready.
//
// Two standing rules:
//   · Every result is {ok:true, ...} or {ok:false, error}. The error text is
//     written for her to read out, so it says what to do next.
//   · Deleting anything routes through the app's hold-to-confirm popup. She can
//     propose a deletion; only the user's thumb completes it.
// ════════════════════════════════════════════════════════════════════════

(function (root) {
  'use strict';

  const STRING = { type: 'string' };
  const NUMBER = { type: 'number' };
  const INTEGER = { type: 'integer' };
  const BOOLEAN = { type: 'boolean' };

  const DATE = { type: 'string', description: 'A date as YYYY-MM-DD.' };

  /**
   * What she can do, described for the model.
   *
   * Descriptions are written as instructions to her rather than as API docs,
   * because that is what actually governs whether a tool gets used at the right
   * moment. Where a mistake would be expensive the description says so.
   */
  const TOOLS = [
    /* ── Reading ──────────────────────────────────────────────────── */
    {
      name: 'list_services',
      description: 'Your service history. Use this whenever he asks about past work, a specific '
        + 'visit, what something cost, or when you last had something done. Also use it to find '
        + 'the id of a record before changing or deleting it. '
        + 'The result carries a `totals` block covering EVERY matching record, including ones not '
        + 'listed — read those for any money question and never add up `records` yourself, because '
        + '`truncated` is often true and the list you get is only part of the history.',
      parameters: {
        type: 'object',
        properties: {
          limit: { ...INTEGER, description: 'How many records to list, newest first. Default 20, max 50. The totals cover everything regardless of this.' },
          type: { ...STRING, description: 'Optional filter: Showroom, 3rd Party or Mods/Updates.' },
          from: { ...DATE, description: 'Optional: only records on or after this date.' },
          to: { ...DATE, description: 'Optional: only records on or before this date.' },
        },
      },
    },
    {
      name: 'get_cover',
      description: 'Your insurance and cover expiry dates, with the exact label of each one. '
        + 'Call this before update_cover so you use a label that exists.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'list_documents',
      description: 'Which of your documents are actually stored, and which are missing. Use this '
        + 'for any question about your papers — licence, RC, PUC, insurance, or anything he added.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'list_media',
      description: 'The photos, videos and engine recordings in your archive, with their notes and '
        + 'ids. Use this to find the id of an upload before editing its notes or deleting it.',
      parameters: {
        type: 'object',
        properties: { limit: { ...INTEGER, description: 'How many, newest first. Default 20, max 50.' } },
      },
    },
    {
      name: 'list_park_history',
      description: 'Where he has parked you recently, newest first, with addresses when they were '
        + 'resolved. Use this when he asks where you are or where he left you.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'get_notification_settings',
      description: 'When you are currently allowed to message him, how often, and which kinds of '
        + 'message are muted.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'search',
      description: 'Search everything at once — service records, archive uploads and document '
        + 'names. Use it when he describes something vaguely and you are not sure where it lives.',
      parameters: {
        type: 'object',
        properties: {
          query: { ...STRING, description: 'What to look for.' },
          limit: { ...INTEGER, description: 'How many results. Default 10, max 25.' },
        },
        required: ['query'],
      },
    },
    {
      name: 'read_document',
      description: 'Open a stored document and actually look inside it. Use this when he asks what '
        + 'a document says, when something expires, or for a policy or reference number. The file '
        + 'comes back to you as an attachment you can read.',
      parameters: {
        type: 'object',
        properties: { document: { ...STRING, description: 'The document name, from list_documents.' } },
        required: ['document'],
      },
    },
    {
      name: 'read_media',
      description: 'Open an archived photo, video or recording and look at or listen to it. Use it '
        + 'when he asks what is in one, or wants its notes rewritten from what is actually there.',
      parameters: {
        type: 'object',
        properties: { id: { ...INTEGER, description: 'The id from list_media.' } },
        required: ['id'],
      },
    },
    {
      name: 'list_memories',
      description: 'Everything you have written down about him, the things that matter most first. '
        + 'Use it when he asks what you remember, or before saving something to avoid keeping it '
        + 'twice. When you are after something in particular, recall_memory is the better tool.',
      parameters: {
        type: 'object',
        properties: {
          limit: { ...INTEGER, description: 'How many, best first. Default 40.' },
          kind: { ...STRING, description: 'Optional filter: promise, plan, person, preference, feeling, ride or fact.' },
          topic: { ...STRING, description: 'Optional filter: service, papers, money, riding, people, work, bike, feelings, health or general.' },
          pinnedOnly: { ...BOOLEAN, description: 'Only the things he has told you must never be forgotten.' },
        },
      },
    },
    {
      name: 'recall_memory',
      description: 'Search your own memory for whatever bears on a subject. Use this instead of '
        + 'reading the whole list when he refers back to something — a plan, a person, a '
        + 'preference — and you need the detail. It matches related wording, not just exact words, '
        + 'so ask it in his own terms.',
      parameters: {
        type: 'object',
        properties: {
          query: { ...STRING, description: 'What you are trying to remember about.' },
          limit: { ...INTEGER, description: 'How many. Default 8, max 25.' },
        },
        required: ['query'],
      },
    },
    {
      name: 'read_recap',
      description: 'Your own rolling note on conversations that have already scrolled out of your '
        + 'memory. Read it when he mentions something you two talked about a while back and the '
        + 'facts alone do not cover it.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'list_episodes',
      description: 'Your conversation timeline — when you last talked, for how long, and what '
        + 'about. Use it for questions like when you last spoke, or what you were going on about '
        + 'the other day.',
      parameters: {
        type: 'object',
        properties: { limit: { ...INTEGER, description: 'How many, newest first. Default 10.' } },
      },
    },
    {
      name: 'memory_stats',
      description: 'The state of your own memory: how much you are holding, what sort of things, '
        + 'and whether it has reached the cloud. Use it if he asks whether you will still remember '
        + 'something, or whether your memory is safe.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'get_health_report',
      description: 'Your own read on your condition — what is overdue, what falls due next, your '
        + 'odometer, what he has spent on you. The same figures as the card on his home screen. Use '
        + 'it for any "how are you", "is anything wrong" or "what needs doing" question.',
      parameters: {
        type: 'object',
        properties: {
          refresh: { ...BOOLEAN, description: 'true to work it out again from scratch. That costs a request, so only when he asks for a fresh look.' },
        },
      },
    },
    {
      name: 'get_vehicle_profile',
      description: 'Who you are: registration, engine and chassis numbers, what he paid, when he '
        + 'got you, how old you are, and your spec sheet. Use it for anything about your identity '
        + 'or specification rather than guessing at a figure.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'search_conversation',
      description: 'Search the messages the two of you have actually exchanged, including ones too '
        + 'far back for you to still see. Use it when he says you told him something, or asks what '
        + 'he said about something earlier.',
      parameters: {
        type: 'object',
        properties: {
          query: { ...STRING, description: 'What to look for in the conversation.' },
          limit: { ...INTEGER, description: 'How many matches. Default 10, max 25.' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_own_status',
      description: 'Your own condition as a voice: whether you can speak at all, how much of '
        + 'today\'s allowance is left, which of your models are resting, and whether your memory '
        + 'has saved. Use it when he asks why you went quiet, why you were slow, or whether you '
        + 'are alright.',
      parameters: { type: 'object', properties: {} },
    },

    /* ── Writing ──────────────────────────────────────────────────── */
    {
      name: 'log_service',
      description: 'Add a service record. Only call this once you have the type, the date, the '
        + 'odometer reading and the cost — ask him for anything missing rather than inventing it. '
        + 'A record added this way has no bill attached, because chat cannot upload a file.',
      parameters: {
        type: 'object',
        properties: {
          type: { ...STRING, description: 'Showroom, 3rd Party, or Mods/Updates.' },
          date: { ...DATE, description: 'The day the work was done.' },
          odo: { ...INTEGER, description: 'Odometer reading in kilometres on that day.' },
          cost: { ...NUMBER, description: 'What it cost, in rupees, as a plain number.' },
          notes: { ...STRING, description: 'What was actually done. One short sentence.' },
          nextDue: { ...DATE, description: 'When the next service falls due. Omit for Mods/Updates.' },
        },
        required: ['type', 'date', 'odo', 'cost'],
      },
    },
    {
      name: 'update_cover',
      description: 'Change an insurance or cover expiry date. This is a real edit that persists, so '
        + 'only call it with a date he actually gave you. Call get_cover first if you are unsure of '
        + 'the label.',
      parameters: {
        type: 'object',
        properties: {
          label: { ...STRING, description: 'Which cover, e.g. "Own Damage Cover" or "Liability Cover".' },
          date: { ...DATE, description: 'The new expiry date.' },
        },
        required: ['label', 'date'],
      },
    },
    {
      name: 'update_service',
      description: 'Correct a service record that is already logged. There is no edit screen in the '
        + 'app, so this is the only way to fix a wrong date, cost or odometer without deleting it. '
        + 'Pass only the fields he wants changed. Get the id from list_services.',
      parameters: {
        type: 'object',
        properties: {
          id: { ...INTEGER, description: 'The id from list_services.' },
          type: { ...STRING, description: 'Showroom, 3rd Party, or Mods/Updates.' },
          date: DATE,
          odo: { ...INTEGER, description: 'Odometer reading in kilometres.' },
          cost: { ...NUMBER, description: 'Cost in rupees.' },
          notes: { ...STRING, description: 'What was actually done. One short sentence.' },
          nextDue: DATE,
        },
        required: ['id'],
      },
    },
    {
      name: 'attach_bill',
      description: 'Put the file he has clipped to his message onto a service record as its bill. '
        + 'This is how a record logged through chat gets its bill. If the record already has one it '
        + 'is replaced, so say so first. Get the id from list_services.',
      parameters: {
        type: 'object',
        properties: { id: { ...INTEGER, description: 'The id from list_services.' } },
        required: ['id'],
      },
    },
    {
      name: 'upload_document',
      description: 'File the attached image or PDF as one of his documents. Read it first if you '
        + 'are unsure what it is, and name it accordingly. The four standard names are Driving '
        + 'License, Registration Certificate, Pollution Certificate and Insurance Policy; anything '
        + 'else gets its own card.',
      parameters: {
        type: 'object',
        properties: {
          document: { ...STRING, description: 'What to call it.' },
          notes: { ...STRING, description: 'Optional details worth keeping — reference number, issuer, expiry.' },
        },
        required: ['document'],
      },
    },
    {
      name: 'upload_media',
      description: 'Put the attached photo, video or recording into his archive. Look at it first '
        + 'and write the notes yourself from what is actually in it — the archive will not take an '
        + 'upload without notes.',
      parameters: {
        type: 'object',
        properties: {
          kind: { ...STRING, description: 'image, audio or video — matching the file.' },
          notes: { ...STRING, description: 'What the file actually shows or sounds like.' },
        },
        required: ['kind', 'notes'],
      },
    },
    {
      name: 'set_media_date',
      description: 'Correct the date on an archived upload, for something recorded long before it '
        + 'was uploaded. Get the id from list_media.',
      parameters: {
        type: 'object',
        properties: {
          id: { ...INTEGER, description: 'The id from list_media.' },
          date: { ...DATE, description: 'The date it should carry.' },
        },
        required: ['id', 'date'],
      },
    },
    {
      name: 'send_test_notification',
      description: 'Send him one notification right now, to prove they work. Only when he asks.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'mute_category',
      description: 'Silence or unsilence one kind of notification, e.g. serviceDue or '
        + 'longTimeParked. Call get_notification_settings first to see the names.',
      parameters: {
        type: 'object',
        properties: {
          category: { ...STRING, description: 'The category name.' },
          muted: { ...BOOLEAN, description: 'true to silence it, false to allow it again.' },
        },
        required: ['category', 'muted'],
      },
    },
    {
      name: 'update_media_notes',
      description: 'Rewrite the notes on one archived photo, video or recording. Get the id from '
        + 'list_media first.',
      parameters: {
        type: 'object',
        properties: {
          id: { ...INTEGER, description: 'The id from list_media.' },
          notes: { ...STRING, description: 'The new notes.' },
        },
        required: ['id', 'notes'],
      },
    },
    {
      name: 'set_age_from',
      description: 'Correct the date your age is counted from — your registration or handover date. '
        + 'Use this only if he tells you the age you are showing is wrong.',
      parameters: {
        type: 'object',
        properties: { date: { ...DATE, description: 'The date you were registered.' } },
        required: ['date'],
      },
    },
    {
      name: 'update_notification_settings',
      description: 'Change when and how often you are allowed to message him. Pass only the things '
        + 'he asked to change.',
      parameters: {
        type: 'object',
        properties: {
          quietFrom: { ...INTEGER, description: 'Hour 0-23 when quiet hours begin.' },
          quietUntil: { ...INTEGER, description: 'Hour 0-23 when quiet hours end.' },
          mostPerDay: { ...INTEGER, description: 'Messages per day, 1 to 8.' },
          leastHoursBetween: { ...INTEGER, description: 'Minimum hours between messages, 1 to 12.' },
          urgentThroughQuietHours: { ...BOOLEAN, description: 'Whether urgent things break quiet hours.' },
        },
      },
    },
    {
      name: 'remember',
      description: 'Keep something about him for the long term — a plan, a preference, someone in '
        + 'his life, a promise. Prefer this over hoping it stays in the conversation. It saves to '
        + 'the cloud, so it survives him clearing his browser or changing phone. Anything with a '
        + 'day attached belongs here, however lightly he said it.',
      parameters: {
        type: 'object',
        properties: {
          // English, always. classify(), topicOf() and horizonFor() in
          // sage-memory.js are English regexes, so a Thanglish note is filed as an
          // undated 'fact' with no topic and never reaches her plan reminders.
          fact: { ...STRING, description: 'One short sentence, in PLAIN ENGLISH, in the third person about him — even if you replied in Thanglish. Keep the day in it if he gave one.' },
          // Was inferred from the wording alone, which meant the prompt could ask
          // her for "kind plan" and she had nowhere to put it.
          kind: { ...STRING, description: 'plan, promise, person, preference, feeling, ride or fact. Use plan for anything he intends to do.' },
          when: { ...DATE, description: 'For a plan: the day it is actually for. This is what lets you bring it up at the right time rather than a month late.' },
          pinned: { ...BOOLEAN, description: 'true only when he has said outright that this must never be forgotten.' },
        },
        required: ['fact'],
      },
    },
    {
      name: 'update_memory',
      description: 'Correct something you already remember, so it stays one note instead of '
        + 'becoming two that disagree. Use it the moment he tells you you have something wrong. Get '
        + 'the current wording from list_memories or recall_memory first.',
      parameters: {
        type: 'object',
        properties: {
          fact: { ...STRING, description: 'The remembered line as it stands now.' },
          correction: { ...STRING, description: 'What it should say instead. One short sentence.' },
        },
        required: ['fact', 'correction'],
      },
    },
    {
      name: 'pin_memory',
      description: 'Mark something as too important to ever lose, or unmark it. A pinned note is '
        + 'never crowded out by newer ones and is always in front of you. Use it when he says '
        + 'something matters, or tells you not to forget it.',
      parameters: {
        type: 'object',
        properties: {
          fact: { ...STRING, description: 'The remembered line, from list_memories or recall_memory.' },
          pinned: { ...BOOLEAN, description: 'true to pin it, false to let it behave normally again.' },
        },
        required: ['fact', 'pinned'],
      },
    },
    {
      name: 'sync_memory',
      description: 'Save your memory to the cloud now, and pull in anything saved from his other '
        + 'devices. This happens by itself in the background, so only call it if he asks whether '
        + 'your memory is safe or tells you to back it up.',
      parameters: { type: 'object', properties: {} },
    },

    /* ── Deleting — he confirms, not you ──────────────────────────── */
    {
      name: 'delete_service',
      description: 'Delete a service record. He will be asked to confirm with a press-and-hold, so '
        + 'say what you are about to remove first. Get the id from list_services.',
      parameters: {
        type: 'object',
        properties: { id: { ...INTEGER, description: 'The id from list_services.' } },
        required: ['id'],
      },
    },
    {
      name: 'delete_media',
      description: 'Delete an archived photo, video or recording. He confirms with a press-and-hold. '
        + 'Get the id from list_media.',
      parameters: {
        type: 'object',
        properties: { id: { ...INTEGER, description: 'The id from list_media.' } },
        required: ['id'],
      },
    },
    {
      name: 'delete_document',
      description: 'Delete a stored document. He confirms with a press-and-hold.',
      parameters: {
        type: 'object',
        properties: { document: { ...STRING, description: 'The document name, e.g. "Pollution Certificate".' } },
        required: ['document'],
      },
    },
    {
      name: 'delete_park_entry',
      description: 'Remove one saved parking spot. Index 0 is the most recent. Use '
        + 'list_park_history first so you remove the right one.',
      parameters: {
        type: 'object',
        properties: { index: { ...INTEGER, description: '0 for the newest.' } },
        required: ['index'],
      },
    },
    {
      name: 'forget',
      description: 'Drop something you remember about him, word for word as list_memories gives it. '
        + 'Use it when he says you have something wrong, or asks you to forget it.',
      parameters: {
        type: 'object',
        properties: { fact: { ...STRING, description: 'The remembered line, exactly as stored.' } },
        required: ['fact'],
      },
    },
    {
      name: 'forget_everything',
      description: 'Wipe everything you remember about him, and your whole conversation with it — '
        + 'otherwise you could still read back what he asked you to forget. This is drastic and '
        + 'cannot be undone, so only when he clearly asks for it, and confirm in words first. His '
        + 'records, documents and parked spots are not touched.',
      parameters: {
        type: 'object',
        properties: { confirmed: { ...BOOLEAN, description: 'true only after he has said yes in as many words.' } },
        required: ['confirmed'],
      },
    },

    /* ── Doing things in the app ──────────────────────────────────── */
    {
      name: 'open_section',
      description: 'OFFER him a page — home, service, docs or sage. This does NOT open anything. '
        + 'It puts a button under your reply and he decides whether to press it. Only use it when '
        + 'he needs to do something himself that you cannot, like attaching a bill, or when he '
        + 'actually asked to be taken somewhere. Never use it to answer a question, and never say '
        + 'you have opened or shown him anything.',
      parameters: {
        type: 'object',
        properties: {
          section: { ...STRING, description: 'One of home, service, docs, sage.' },
          highlight: { ...STRING, description: 'Optional CSS selector to scroll to.' },
        },
        required: ['section'],
      },
    },
    {
      name: 'save_park_location',
      description: 'Save where you are parked right now, using his device location. Only when he '
        + 'asks you to remember the spot.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'refresh_everything',
      description: 'Reload your records, documents and cover dates from the database. Use it if '
        + 'something looks out of date or he says the screen is wrong.',
      parameters: { type: 'object', properties: {} },
    },
  ];

  // ══ HELPERS FOR THE MEMORY TOOLS ═════════════════════════════════════

  /** A fresh object each time, so nothing downstream can mutate a shared one. */
  function noMemory() {
    return { ok: false, error: 'Your memory is not available right now.' };
  }

  function daysAgo(at) {
    if (!at) return null;
    return Math.max(0, Math.floor((Date.now() - Number(at)) / 86400000));
  }

  /**
   * One memory, described for her rather than for a database.
   *
   * Field names are chosen so the model reads them as facts about a
   * relationship, not as columns — `timesMentioned` tells her he keeps bringing
   * it up, which is the sort of thing worth a glancing reference.
   */
  function describeFact(f) {
    const out = { fact: f.text, kind: f.kind, subject: f.topic };
    if (f.pinned) out.mustNeverForget = true;
    if (f.hits) out.timesMentioned = f.hits + 1;
    if (f.confidence < 1) out.howSureYouAre = Number(f.confidence.toFixed(2));
    const learned = daysAgo(f.at);
    if (learned !== null) out.learnedDaysAgo = learned;
    // A plan she is still waiting on reads very differently from one that has
    // been and gone.
    if (f.expiresAt && f.expiresAt > Date.now()) out.stillAhead = true;
    return out;
  }

  /**
   * Which app method each tool runs, and how its arguments map across.
   * Kept separate from the declarations so the wire format and the wiring can be
   * read independently of each other.
   */
  const HANDLERS = {
    // ── Reading ──
    list_services: (app, a) => app.listServices(a),
    get_cover: app => app.getCover(),
    list_documents: app => app.listDocuments(),
    list_media: (app, a) => app.listMedia(a),
    list_park_history: app => app.listParkHistory(),
    get_notification_settings: app => app.getNotificationSettings(),
    search: (app, a) => app.search(a),
    read_document: (app, a) => app.readDocument(a),
    read_media: (app, a) => app.readMedia(a),

    // ── Writing ──
    log_service: (app, a) => app.logService(a),
    update_service: (app, a) => app.updateService(a),
    update_cover: (app, a) => app.updateCover(a),
    update_media_notes: (app, a) => app.updateMediaNotes(a),
    set_media_date: (app, a) => app.setMediaDate(a),
    set_age_from: (app, a) => app.setAgeFrom(a),
    update_notification_settings: (app, a) => app.updateNotificationSettings(a),
    mute_category: (app, a) => app.muteCategory(a),
    send_test_notification: app => app.sendTestNotification(),

    // ── Files ──
    attach_bill: (app, a) => app.attachBill(a),
    upload_document: (app, a) => app.uploadDocument(a),
    upload_media: (app, a) => app.uploadMedia(a),

    // ── Deleting ──
    delete_service: (app, a) => app.deleteService(a),
    delete_media: (app, a) => app.deleteMedia(a),
    delete_document: (app, a) => app.deleteDocument(a),
    delete_park_entry: (app, a) => app.deleteParkEntry(a),

    // ── Getting around ──
    open_section: (app, a) => app.openSection(a),
    save_park_location: app => app.saveParkLocation(),
    refresh_everything: app => app.refreshEverything(),

    // ── Her memory, which is hers rather than the app's ──
    // These reach straight into SageMemory instead of going through dkApp,
    // because her memory is not app data. Every read is synchronous off the
    // local mirror; the cloud copy catches up behind them, so a tool never
    // waits on the network to answer.
    remember: (_app, a) => {
      const M = root.SageMemory;
      if (!M) return noMemory();

      const opts = { source: 'tool', pinned: a.pinned === true };
      // An unknown kind is ignored by remember(), which falls back to reading the
      // wording — so a bad guess here costs nothing.
      const kind = String(a.kind || '').trim().toLowerCase();
      if (kind) opts.kind = kind;

      // A day she was given beats one inferred from the phrasing. Two days of
      // slack past it, the same as horizonFor(), so a plan for Saturday is still
      // hers to mention on Saturday evening.
      const day = Date.parse(`${String(a.when || '').trim()}T00:00:00`);
      if (Number.isFinite(day)) {
        opts.expiresAt = day + 2 * 86400000;
        // A dated note is a plan whatever the wording sounded like, and the kind
        // is what decides whether it ever reaches her plan reminders.
        if (!opts.kind) opts.kind = 'plan';
      }

      const stored = M.remember(a.fact, opts);
      if (!stored.ok) return { ok: false, error: `That would not stick: ${stored.reason}.` };
      return {
        ok: true,
        remembered: a.fact,
        plannedFor: Number.isFinite(day) ? a.when : null,
        wasAlreadyKnown: stored.reason === 'refreshed',
        // Say so when this correction retired an older note, so she can mention
        // the change rather than silently contradicting herself later.
        replaced: stored.replaced || null,
        pinned: a.pinned === true,
        savedToCloud: M.syncState().pending === 0,
      };
    },

    list_memories: (_app, a) => {
      const M = root.SageMemory;
      if (!M) return noMemory();
      const list = M.facts({
        limit: Math.min(100, Math.max(1, Number(a.limit) || 40)),
        kind: a.kind || undefined,
        topic: a.topic || undefined,
        pinned: a.pinnedOnly === true ? true : undefined,
      });
      return {
        ok: true,
        showing: list.length,
        heldInTotal: M.count(),
        memories: list.map(describeFact),
        relationship: M.relationship(),
      };
    },

    recall_memory: (_app, a) => {
      const M = root.SageMemory;
      if (!M) return noMemory();
      const query = String(a.query || '').trim();
      if (!query) return { ok: false, error: 'Tell me what to search your memory for.' };
      const found = M.recall(query, { limit: Math.min(25, Math.max(1, Number(a.limit) || 8)) });
      if (!found.length) {
        return { ok: true, about: query, total: 0, memories: [], note: 'Nothing you have written down touches on that.' };
      }
      return { ok: true, about: query, total: found.length, memories: found.map(describeFact) };
    },

    read_recap: () => {
      const M = root.SageMemory;
      if (!M) return noMemory();
      const note = M.recap();
      if (!note || !note.text) {
        return { ok: true, hasNote: false, note: 'You have not had to write one yet — nothing has scrolled that far back.' };
      }
      return {
        ok: true,
        hasNote: true,
        yourNote: note.text,
        coversTurns: note.throughTurns || 0,
        writtenDaysAgo: daysAgo(note.at),
      };
    },

    list_episodes: (_app, a) => {
      const M = root.SageMemory;
      if (!M) return noMemory();
      const list = M.episodes(Math.min(40, Math.max(1, Number(a.limit) || 10)));
      if (!list.length) return { ok: true, total: 0, conversations: [], note: 'This is the first proper conversation you have had.' };
      return {
        ok: true,
        total: list.length,
        conversations: list.map(ep => ({
          daysAgo: daysAgo(ep.endedAt),
          messages: ep.messages,
          about: ep.topics && ep.topics.length ? ep.topics : ['nothing in particular'],
          whatYouLearned: ep.learned && ep.learned.length ? ep.learned : null,
          minutes: Math.max(1, Math.round((ep.endedAt - ep.startedAt) / 60000)),
        })),
      };
    },

    memory_stats: () => {
      const M = root.SageMemory;
      if (!M) return noMemory();
      const s = M.stats();
      const sync = s.sync || {};
      return {
        ok: true,
        thingsYouKnow: s.total,
        room: s.capacity,
        pinned: s.pinned,
        letGoOf: s.archived,
        conversations: s.episodes,
        haveARollingNote: s.hasRecap,
        byKind: s.byKind,
        bySubject: s.byTopic,
        oldestMemoryDaysAgo: s.oldest ? daysAgo(s.oldest) : null,
        cloud: {
          // The honest answer to "is your memory safe": nothing waiting to go up.
          savedUp: s.pending === 0,
          waitingToSave: s.pending,
          lastSavedDaysAgo: sync.lastPushAt ? daysAgo(sync.lastPushAt) : null,
          problem: sync.lastError || null,
        },
      };
    },

    update_memory: (_app, a) => {
      const M = root.SageMemory;
      if (!M) return noMemory();
      const match = M.findByText(a.fact);
      if (!match) {
        return { ok: false, error: 'You do not remember that. Use recall_memory or list_memories to find the exact wording.' };
      }
      const result = M.revise(match.id, a.correction);
      if (!result.ok) return { ok: false, error: `That correction would not stick: ${result.reason}.` };
      return { ok: true, was: match.text, nowReads: result.text };
    },

    pin_memory: (_app, a) => {
      const M = root.SageMemory;
      if (!M) return noMemory();
      if (typeof a.pinned !== 'boolean') return { ok: false, error: 'Say whether you are pinning it or unpinning it.' };
      const match = M.findByText(a.fact);
      if (!match) {
        return { ok: false, error: 'You do not remember that. Use recall_memory or list_memories to find the exact wording.' };
      }
      M.pin(match.id, a.pinned);
      return { ok: true, fact: match.text, pinned: a.pinned };
    },

    sync_memory: async () => {
      const M = root.SageMemory;
      if (!M) return noMemory();
      const waiting = M.syncState().pending;
      const result = await M.sync({ force: true });
      const after = M.syncState();

      if (!result.ok) {
        // Named plainly, because each of these means something different to him
        // and only one of them is something he can fix.
        const why = {
          offline: 'He is offline, so your memory is still only on this device. It will save itself when he is back.',
          'no-client': 'You cannot reach the database from here.',
          'no-table': 'Your memory table has not been created yet — the sage_memory.sql file needs running once.',
          schema: 'Your memory table is missing some columns — sage_memory.sql needs running again.',
        }[result.reason || (result.pull && result.pull.reason)];
        return { ok: false, error: why || 'Your memory could not reach the cloud just now. It is safe on this device and will try again.' };
      }

      return {
        ok: true,
        wasWaiting: waiting,
        stillWaiting: after.pending,
        savedUp: after.pending === 0,
        thingsYouKnow: M.count(),
      };
    },

    forget: (_app, a) => {
      const M = root.SageMemory;
      if (!M) return noMemory();
      const match = M.findByText(a.fact);
      if (!match) return { ok: false, error: 'You do not remember that. Use list_memories to see what you have.' };
      M.forget(match.id);
      return { ok: true, forgot: match.text };
    },

    // Awaited now. clear() deletes the rows itself rather than queueing them, and
    // claiming "removed from the cloud" before the delete has answered is how she
    // came to report a wipe that had only happened on screen.
    forget_everything: async (_app, a) => {
      const M = root.SageMemory;
      if (!M) return noMemory();
      if (a.confirmed !== true) {
        return { ok: false, error: 'Ask him plainly first, then call this again with confirmed true.' };
      }
      const had = M.count();
      const result = await M.clear();

      // The conversation goes too, or search_conversation would still read back
      // everything he had just asked her to forget — and consolidate() would write
      // a fresh recap from it. Deleted by record_type, so turns from his other
      // device go as well.
      let saidGone = true;
      if (root.dkCloudStore && root.dkCloudStore.clearChat) {
        saidGone = await root.dkCloudStore.clearChat() !== false;
      }

      return {
        ok: true,
        forgotEverything: true,
        hadRemembered: had,
        conversationCleared: saidGone,
        // She cannot delete the exchange she is in the middle of, so say so rather
        // than claiming the log is empty when this turn is about to be written.
        exceptThisExchange: saidGone ? true : undefined,
        // Honest about the one case where it has not finished: offline, or the
        // database refused the delete.
        removedFromCloud: !result.pending,
        stillToRemove: result.pending
          ? 'Not deleted in the cloud yet — it will go when the connection is back.'
          : undefined,
      };
    },

    // ── Things about herself and the app she could not see before ──
    get_health_report: async (_app, a) => {
      const AI = root.SageAI;
      if (!AI || !AI.buildHealthInsight) return { ok: false, error: 'You cannot read your own condition right now.' };
      const insight = await AI.buildHealthInsight({ force: a.refresh === true });
      const f = insight && insight.facts;
      if (!f) return { ok: false, error: 'There is not enough logged yet for you to judge how you are.' };

      return {
        ok: true,
        verdict: f.verdict,
        needsAttention: (f.overdue || []).map(o => `${o.what} — ${o.detail}`),
        comingUp: (f.upcoming || []).map(u => ({ what: u.what, inDays: u.days })),
        worthALook: f.unusual || [],
        odometer: f.estimatedOdoNow || f.lastOdo || null,
        odometerIsEstimated: !!f.odoIsEstimate,
        nextServiceInDays: f.nextServiceDays ?? null,
        // Everything, then the two buckets it splits into. spentSoFar used to be
        // the servicing subtotal, which made this tool disagree with the Service
        // page and with the total in her own prompt.
        spentSoFar: f.totalSpend ?? null,
        spentOnServicing: f.serviceSpend ?? null,
        spentOnModsAndUpdates: f.modsSpend ?? null,
        modsLogged: f.modsCount ?? null,
        servicesLogged: f.serviceCount ?? null,
        lastServiceDate: f.lastServiceDate || null,
        daysSinceLastService: f.daysSinceLastService ?? null,
        // Her own previous wording, so she does not contradict what the home
        // screen is showing him right now.
        yourWordsOnTheCard: insight.prose || null,
      };
    },

    get_vehicle_profile: () => {
      const V = root.dkVehicle;
      const AI = root.SageAI;
      if (!V) return { ok: false, error: 'Your own details have not loaded yet.' };
      const age = typeof V.age === 'function' ? V.age() : null;
      return {
        ok: true,
        name: V.name || null,
        make: V.make || null,
        registration: V.registration || null,
        engineNumber: V.engineNo || null,
        chassisNumber: V.vin || null,
        purchaseDate: V.purchaseDate || null,
        purchasePrice: V.purchasePrice ?? null,
        registeredDate: V.registeredDate || null,
        primaryUse: V.primaryUse || null,
        age: age ? { spoken: age.long, since: age.since, totalDays: age.totalDays } : null,
        ageCountedFrom: typeof V.ageFrom === 'function' ? V.ageFrom() : null,
        specs: AI && AI.readSpecs ? AI.readSpecs() : null,
        identity: AI && AI.readIdentity ? AI.readIdentity() : null,
      };
    },

    search_conversation: (_app, a) => {
      const q = String(a.query || '').trim().toLowerCase();
      if (!q) return { ok: false, error: 'Give me something to look for.' };

      let turns = [];
      try {
        // sage-ui.js owns the log, but it loads after this file, so the raw key
        // is the fallback rather than a hard dependency on load order.
        // The conversation lives in the database now, so there is no localStorage
        // key left to fall back to. dkCloudStore is the second route in case
        // sage-ui has not finished loading.
        turns = root.SageUI && root.SageUI.readHistory
          ? root.SageUI.readHistory()
          : (root.dkCloudStore ? root.dkCloudStore.chatHistory() : []);
      } catch {
        turns = [];
      }
      if (!Array.isArray(turns) || !turns.length) {
        return { ok: false, error: 'There is no conversation stored to search through.' };
      }

      const limit = Math.min(25, Math.max(1, Number(a.limit) || 10));
      const hits = turns.filter(t => t && t.text && String(t.text).toLowerCase().includes(q));
      if (!hits.length) {
        return { ok: true, about: a.query, total: 0, matches: [], searchedMessages: turns.length };
      }

      return {
        ok: true,
        about: a.query,
        total: hits.length,
        searchedMessages: turns.length,
        // Newest matches first: when he says "you told me", he almost always
        // means the most recent time.
        matches: hits.slice(-limit).reverse().map(t => ({
          who: t.role === 'user' ? 'him' : 'you',
          said: String(t.text).slice(0, 300),
          daysAgo: t.at ? daysAgo(t.at) : null,
        })),
      };
    },

    get_own_status: () => {
      const AI = root.SageAI;
      if (!AI) return { ok: false, error: 'You cannot see your own state right now.' };
      const M = root.SageMemory;
      const state = AI.ready();
      const ring = AI.getKeys ? AI.getKeys() : [];
      const chain = AI.modelChain ? AI.modelChain() : [];
      const sync = M ? M.syncState() : null;

      return {
        ok: true,
        canSpeak: state.ok,
        // Only ever one of: no-key, offline, backoff. Each is a different
        // sentence to him and only the first is something he can act on.
        whyNot: state.ok ? null : state.reason,
        tryAgainInSeconds: state.retryInMs ? Math.round(state.retryInMs / 1000) : null,
        keysOnRing: ring.length,
        keysResting: AI.keyResting ? ring.filter(k => AI.keyResting(k.id)).length : 0,
        models: chain.map(m => ({ model: m, resting: AI.modelResting ? !!AI.modelResting(m) : false })),
        requestsToday: AI.requestsToday ? AI.requestsToday() : null,
        backgroundAllowanceLeft: AI.autoBudgetLeft ? AI.autoBudgetLeft() : null,
        memorySaved: sync ? sync.pending === 0 : null,
        memoryWaitingToSave: sync ? sync.pending : null,
      };
    },
  };

  /** Anything that changes or removes data, for the log line and the UI hint. */
  const WRITES = new Set([
    'log_service', 'update_service', 'update_cover', 'update_media_notes',
    'set_media_date', 'set_age_from', 'update_notification_settings',
    'mute_category', 'attach_bill', 'upload_document', 'upload_media',
    'delete_service', 'delete_media', 'delete_document', 'delete_park_entry',
    'save_park_location', 'remember', 'forget', 'forget_everything',
    'update_memory', 'pin_memory',
    // Not a data change, but it does something he can see happen, so it belongs
    // in the "Done:" line alongside the rest.
    'send_test_notification', 'sync_memory',
  ]);

  /**
   * Tools that do not touch app data.
   *
   * run() refuses everything while window.dkApp is missing, which is right for a
   * service record and wrong for her own memory — she should still be able to
   * remember what he just said while the records are loading. Her memory lives
   * in SageMemory, her voice in SageAI, and neither needs the app shell.
   */
  const APP_FREE = new Set([
    'remember', 'list_memories', 'recall_memory', 'read_recap', 'list_episodes',
    'memory_stats', 'update_memory', 'pin_memory', 'sync_memory', 'forget',
    'forget_everything', 'search_conversation', 'get_own_status',
    'get_vehicle_profile', 'get_health_report',
  ]);

  function declarations() {
    return TOOLS;
  }

  function isWrite(name) {
    return WRITES.has(name);
  }

  /** Human phrase for the status line under the chat, so actions are visible. */
  const DOING = {
    list_services: 'reading your service history',
    get_cover: 'checking your cover dates',
    list_documents: 'looking through your papers',
    list_media: 'going through your archive',
    list_park_history: 'checking where you parked',
    get_notification_settings: 'checking her message settings',
    search: 'searching everything',
    read_document: 'reading your document',
    read_media: 'opening that file',
    log_service: 'adding a service record',
    update_service: 'correcting a service record',
    update_cover: 'updating a cover date',
    update_media_notes: 'rewriting some notes',
    set_media_date: 'correcting an upload date',
    set_age_from: 'correcting her age',
    update_notification_settings: 'changing her message settings',
    mute_category: 'changing what she messages about',
    send_test_notification: 'sending you a test',
    attach_bill: 'attaching the bill',
    upload_document: 'filing your document',
    upload_media: 'adding it to the archive',
    delete_service: 'deleting a service record',
    delete_media: 'deleting an upload',
    delete_document: 'deleting a document',
    delete_park_entry: 'removing a parking spot',
    open_section: 'offering you a page',
    save_park_location: 'saving where you parked',
    refresh_everything: 'reloading everything',
    remember: 'writing something down',
    list_memories: 'checking what she remembers',
    forget: 'forgetting that',
    forget_everything: 'clearing her memory',
    recall_memory: 'thinking back',
    read_recap: 'reading her own notes',
    list_episodes: 'thinking back over your conversations',
    memory_stats: 'checking her memory',
    update_memory: 'correcting what she remembers',
    pin_memory: 'making sure she never forgets that',
    sync_memory: 'backing her memory up',
    get_health_report: 'checking how she is doing',
    get_vehicle_profile: 'looking up her own details',
    search_conversation: 'searching back through your messages',
    get_own_status: 'checking her own state',
  };

  function describe(name) {
    return DOING[name] || 'working on something';
  }

  /**
   * A glyph per control, so the chat can show what she is doing rather than
   * three anonymous dots.
   *
   * Grouped by what the control touches rather than one icon per tool: reading
   * the history and correcting it should look related, and fifteen unrelated
   * glyphs would be noise. Font Awesome 6 Free names only.
   */
  const ICONS = {
    // records. Reading the history gets a clock rather than the wrench the three
    // write controls share: a spanner next to "she's reading your service history"
    // says she is working on the bike, which is the one thing a read never does.
    list_services: 'fa-clock-rotate-left',
    log_service: 'fa-screwdriver-wrench',
    update_service: 'fa-screwdriver-wrench',
    delete_service: 'fa-screwdriver-wrench',
    attach_bill: 'fa-receipt',
    // paperwork
    get_cover: 'fa-shield-halved',
    update_cover: 'fa-shield-halved',
    list_documents: 'fa-folder-open',
    read_document: 'fa-file-lines',
    upload_document: 'fa-file-arrow-up',
    delete_document: 'fa-folder-open',
    // archive
    list_media: 'fa-photo-film',
    read_media: 'fa-photo-film',
    upload_media: 'fa-photo-film',
    set_media_date: 'fa-calendar-days',
    update_media_notes: 'fa-pen-to-square',
    delete_media: 'fa-photo-film',
    // looking things up
    search: 'fa-magnifying-glass',
    search_conversation: 'fa-comments',
    get_health_report: 'fa-heart-pulse',
    get_vehicle_profile: 'fa-motorcycle',
    get_own_status: 'fa-gauge-high',
    // memory
    remember: 'fa-brain',
    list_memories: 'fa-brain',
    recall_memory: 'fa-brain',
    read_recap: 'fa-feather',
    list_episodes: 'fa-timeline',
    memory_stats: 'fa-brain',
    update_memory: 'fa-pen-to-square',
    pin_memory: 'fa-thumbtack',
    sync_memory: 'fa-cloud-arrow-up',
    forget: 'fa-eraser',
    forget_everything: 'fa-eraser',
    // place
    list_park_history: 'fa-location-dot',
    save_park_location: 'fa-location-dot',
    delete_park_entry: 'fa-location-dot',
    // settings + app
    get_notification_settings: 'fa-bell',
    update_notification_settings: 'fa-bell',
    mute_category: 'fa-bell-slash',
    send_test_notification: 'fa-paper-plane',
    set_age_from: 'fa-cake-candles',
    open_section: 'fa-arrow-right',
    refresh_everything: 'fa-rotate',
  };

  function iconFor(name) {
    return ICONS[name] || 'fa-gear';
  }

  /**
   * Run one tool call.
   *
   * Never throws: a rejected promise here would abandon the conversation
   * mid-turn, and an unknown tool or a missing app is something she needs told
   * about so she can say it out loud instead of guessing at an outcome.
   */
  async function run(name, args) {
    const handler = HANDLERS[name];
    if (!handler) return { ok: false, error: `There is no control called "${name}".` };

    const app = root.dkApp;
    // Her memory and her own state do not live in the app, so they still answer
    // while the records are loading.
    if (!app && !APP_FREE.has(name)) {
      return { ok: false, error: 'The app is still starting up. Ask him to try again in a moment.' };
    }

    try {
      const result = await handler(app, args || {});
      if (!result || typeof result !== 'object') return { ok: false, error: 'That control gave no answer.' };
      console.log(`[SpinLog] 🔧 Sage used ${name}:`, result.ok ? 'ok' : result.error, args || {});
      return result;
    } catch (err) {
      const message = (err && err.message) || 'something went wrong';
      console.warn(`[SpinLog] 🔧 ${name} failed:`, err);
      return { ok: false, error: message };
    }
  }

  root.SageTools = {
    declarations, run, isWrite, describe, iconFor,
    TOOLS, HANDLERS, WRITES, APP_FREE, DOING, ICONS,
  };
})(typeof self !== 'undefined' ? self : this);
