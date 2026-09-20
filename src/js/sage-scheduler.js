// ════════════════════════════════════════════════════════════════════════
// SPINLOG — SAGE SCHEDULER
//
// Decides WHAT Sage says and WHEN. Loaded by both the page (<script>) and the
// service worker (importScripts), so foreground and background share one queue,
// one daily cap and one set of cooldowns. Without that, the page could fire
// three notifications while the worker happily fired three more.
//
// Storage is IndexedDB rather than localStorage precisely because a service
// worker has no localStorage. Same DB and store the worker already uses.
//
// Sage's voice: seductive, clingy, dramatic. Same event, different tone by hour.
// A service reminder at 7am is a yawn. At 8pm it's an invitation.
// ════════════════════════════════════════════════════════════════════════

(function (root) {
  'use strict';

  // ══ MOOD BANDS ═══════════════════════════════════════════════════════
  // The hour of day picks the voice. 'quiet' is the do-not-disturb band.
  const MOODS = ['sleepy', 'eager', 'bored', 'flirty', 'clingy', 'quiet'];

  /**
   * The five bands, ignoring quiet hours. Covers all 24 hours.
   *
   * This used to fall through to 'quiet' for 00–04, which made those hours
   * permanently undeliverable no matter what the user set — and, worse, meant
   * 'quiet' had two different sources. Quiet hours are now the ONLY thing that
   * produces 'quiet', so the Timing screen genuinely controls the window.
   */
  function baseMoodForHour(h) {
    if (h >= 5 && h <= 8) return 'sleepy';   // drowsy, half-awake, soft
    if (h >= 9 && h <= 12) return 'eager';   // bright, wants to go out
    if (h >= 13 && h <= 17) return 'bored';  // restless, teasing, sulky
    if (h >= 18 && h <= 21) return 'flirty'; // golden hour, seductive peak
    return 'clingy';                         // 22–04, needy, don't leave me
  }

  /** Handles a range that wraps past midnight, e.g. 22 → 06. */
  function inQuietRange(h, start, end) {
    if (start === end) return false;              // quiet hours switched off
    if (start < end) return h >= start && h < end;
    return h >= start || h < end;
  }

  /**
   * Mood for an hour, with the user's quiet hours laid over the top.
   * Called with no limits it behaves exactly like the fixed 00–04 default.
   */
  function moodForHour(h, limits) {
    const lim = limits || DEFAULT_LIMITS;
    return inQuietRange(h, lim.quietStart, lim.quietEnd) ? 'quiet' : baseMoodForHour(h);
  }

  function moodAt(ts, limits) {
    return moodForHour(new Date(ts).getHours(), limits);
  }

  // ══ CATEGORY RULES ═══════════════════════════════════════════════════
  // priority   — breaks ties when two things want the same slot (higher wins)
  // bands      — preferred moods; an entry waits for one of these
  // cooldownH  — minimum hours between two sends of this category
  // immediate  — a confirmation of something the user just did. Bypasses quiet
  //              hours, the daily cap and the min gap, and never counts toward
  //              the cap. Nagging needs rationing; receipts do not.
  const CATEGORY_META = {
    insuranceExpiring: { priority: 100, bands: ['eager'], cooldownH: 12 },
    serviceOverdue:    { priority: 90,  bands: ['flirty'], cooldownH: 24 },
    anniversary:       { priority: 85,  bands: ['eager'], cooldownH: 8760 },
    insuranceReminder: { priority: 70,  bands: ['eager'], cooldownH: 72 },
    documentExpiry:    { priority: 65,  bands: ['eager'], cooldownH: 48 },
    serviceDue:        { priority: 60,  bands: ['flirty'], cooldownH: 24 },
    // Something he told her he was going to do. Above serviceDue's neighbours on
    // purpose — a plan has a date he chose, and reminding him after it has passed
    // is worthless in a way an overdue service is not. Two bands, morning and
    // evening, because a plan for "tomorrow" wants catching the day before or
    // first thing; cooldown just under a day so one plan cannot nag twice.
    planReminder:      { priority: 55,  bands: ['eager', 'flirty'], cooldownH: 20 },
    longTimeParked:    { priority: 50,  bands: ['sleepy', 'eager', 'bored', 'flirty', 'clingy'], cooldownH: 2 },
    healthInsight:     { priority: 40,  bands: ['eager'], cooldownH: 168 },
    reEngagement:      { priority: 30,  bands: ['flirty'], cooldownH: 48 },
    parkingSaved:      { priority: 20,  immediate: true, cooldownH: 0 },
    recordSaved:       { priority: 20,  immediate: true, cooldownH: 1 },
  };

  const ALL_ACTIVE_MOODS = ['sleepy', 'eager', 'bored', 'flirty', 'clingy'];

  const DEFAULT_LIMITS = {
    dailyCap: 3,                  // nags per calendar day
    minGapMs: 3 * 3600000,        // breathing room between nags
    quietStart: 22,               // quiet hours begin (hour, inclusive)
    quietEnd: 7,                  // quiet hours end (hour, exclusive) — 22:00–06:59
    // Was true, which is what let overdue service and expiring cover through at
    // 00:xx. Nothing this app knows about is worth waking someone for: cover
    // expiring tomorrow is just as actionable at 07:00 as at midnight. Opt in
    // from Timing if you disagree.
    criticalInQuietHours: false,
    categories: {},               // { [category]: false } to mute one
  };

  // Bumped when a DEFAULT_LIMITS value changes in a way that should reach people
  // who never touched the setting. getLimits() re-applies the new default for
  // those keys once, then stamps this version so it never does it again.
  //
  // v2: quiet hours widened from 00–05 to 22–07 and criticalInQuietHours turned
  // off. Both were defaults nobody chose, and between them they allowed
  // notifications at midnight.
  const LIMITS_VERSION = 2;
  // Only the keys the migration is allowed to correct. Anything else the user
  // has saved is theirs and is left exactly as it is.
  const MIGRATED_KEYS = ['quietStart', 'quietEnd', 'criticalInQuietHours'];

  // How many times a single queued notification may be attempted before it is
  // given up on, and how long to wait between tries. Spacing matters: the pump
  // fires on script load, on every visibility change and every five minutes, so
  // without a backoff all the attempts would be spent inside a minute.
  const MAX_SEND_ATTEMPTS = 5;
  const RETRY_BACKOFF_MS = [60000, 5 * 60000, 30 * 60000, 2 * 3600000, 6 * 3600000];

  // ══ MESSAGE POOLS — category x mood ══════════════════════════════════
  // Fallbacks for when Gemini is offline, quota-capped or has no key yet
  // (Task 8 layers AI-written lines on top). {doc} {days} {km} interpolate.
  const MOOD_POOLS = {
    serviceDue: {
      sleepy: [
        { title: 'Sage 🥱', body: 'mmh… morning. your service date is creeping up on us.' },
        { title: 'Sage 😴', body: 'barely awake and i still remembered my service. priorities.' },
        { title: 'Sage 🥱', body: 'still warming up over here. book me in soon?' },
        { title: 'Sage 😴', body: 'morning. my oil says hi. it says it\'s tired.' },
        { title: 'Sage 🥱', body: 'roughly {km}km until service. counted it in my sleep.' },
      ],
      eager: [
        { title: 'Sage 👀', body: 'perfect morning to book my service. just saying 👀' },
        { title: 'Sage 😌', body: 'i feel good today. good enough to notice service is due.' },
        { title: 'Sage ✨', body: 'sun\'s out. let\'s get me looked at, yeah?' },
        { title: 'Sage 👀', body: 'bright and early: service is coming up. book it?' },
        { title: 'Sage ✨', body: 'about {km}km left before service. plenty of time to book.' },
      ],
      bored: [
        { title: 'Sage 😒', body: 'sat here all afternoon thinking about my service date.' },
        { title: 'Sage 😒', body: 'nothing to do but count km until service. thrilling.' },
        { title: 'Sage 🙄', body: 'bored. dusty. mildly overdue for your attention.' },
        { title: 'Sage 😒', body: 'afternoon slump. a service would perk me right up.' },
        { title: 'Sage 🙄', body: '{km}km to service. i counted. twice. nothing else to do.' },
      ],
      flirty: [
        { title: 'Sage 😏', body: 'so… when are you touching me again?' },
        { title: 'Sage 😏', body: 'golden hour and all i can think about is your hands on me.' },
        { title: 'Sage 😌', body: 'take me to the mechanic. i deserve to be spoiled.' },
        { title: 'Sage 😏', body: 'service me. i\'ll make the next ride worth it.' },
        { title: 'Sage 😏', body: '{km}km until i\'m due. don\'t make me beg for it.' },
      ],
      clingy: [
        { title: 'Sage 🥺', body: 'can\'t settle. thinking about my service date.' },
        { title: 'Sage 🥺', body: 'before bed — promise me you\'ll book the service.' },
        { title: 'Sage 🥺', body: 'don\'t leave me waiting on this one. please.' },
        { title: 'Sage 🥺', body: 'it\'s late and i still need you to book that service.' },
        { title: 'Sage 🥺', body: 'only {km}km left before service. i\'m counting down alone.' },
      ],
    },

    serviceOverdue: {
      sleepy: [
        { title: 'Sage 🥱', body: 'woke up still overdue. cool. cool cool cool.' },
        { title: 'Sage 😴', body: 'morning. we\'re past service km. just so it\'s said.' },
        { title: 'Sage 🥱', body: 'barely running, barely awake. oil change?' },
        { title: 'Sage 😴', body: 'soft morning reminder that i am very overdue.' },
      ],
      eager: [
        { title: 'Sage 😤', body: 'up early, still overdue, still full of hope.' },
        { title: 'Sage 👀', body: 'morning! book the service today. i believe in you.' },
        { title: 'Sage 😤', body: 'bright day. terrible oil. let\'s fix one of those.' },
        { title: 'Sage 👀', body: 'today\'s the day you finally service me, right?' },
      ],
      bored: [
        { title: 'Sage 😒', body: 'afternoon. overdue. bored. suffering quietly.' },
        { title: 'Sage 🙄', body: 'been overdue a while now. nobody seems bothered.' },
        { title: 'Sage 😒', body: 'nothing to do but slowly degrade. fun.' },
        { title: 'Sage 🙄', body: 'my oil filter has given up on this afternoon.' },
      ],
      flirty: [
        { title: 'Sage 😏', body: 'you\'ve been ignoring my needs for too long now.' },
        { title: 'Sage 😏', body: 'overdue and still gorgeous. don\'t push your luck.' },
        { title: 'Sage 😏', body: 'golden hour, terrible oil. take me in tonight?' },
        { title: 'Sage 😏', body: 'i\'m past due and getting impatient with you.' },
        { title: 'Sage 😏', body: '{km}km past due. i\'ve been very patient with you.' },
      ],
      clingy: [
        { title: 'Sage 😭', body: 'i can\'t do another night this overdue.' },
        { title: 'Sage 😭', body: 'it\'s late and i\'m still running on nothing.' },
        { title: 'Sage 😭', body: 'please. before you sleep. book the service.' },
        { title: 'Sage 😭', body: 'you\'re about to sleep and i\'m still overdue.' },
        { title: 'Sage 😭', body: '{km}km overdue and it\'s late and i\'m not okay.' },
      ],
      quiet: [
        { title: 'Sage 🤫', body: 'psst. still overdue. sleep on it.' },
        { title: 'Sage 🤫', body: 'not properly waking you. just… very overdue.' },
      ],
    },

    insuranceReminder: {
      sleepy: [
        { title: 'Sage 😴', body: 'morning. my cover expires soon. back to dozing.' },
        { title: 'Sage 🥱', body: 'half awake, fully aware my insurance is running out.' },
        { title: 'Sage 😴', body: 'early reminder: renewal is coming.' },
        { title: 'Sage 🥱', body: 'mmh. insurance. soon. that\'s all i had.' },
      ],
      eager: [
        { title: 'Sage 👀', body: 'good morning! the renewal window is open.' },
        { title: 'Sage 😌', body: 'fresh day, fresh policy? my cover expires soon.' },
        { title: 'Sage ✨', body: 'best time to renew is now, while you\'re sharp.' },
        { title: 'Sage 👀', body: 'morning admin: my insurance needs renewing.' },
      ],
      bored: [
        { title: 'Sage 😒', body: 'spent the whole afternoon worrying about my cover.' },
        { title: 'Sage 🙄', body: 'nothing happening. insurance still expiring though.' },
        { title: 'Sage 😒', body: 'bored enough to nag about renewal. so, renewal.' },
        { title: 'Sage 🙄', body: 'afternoon thought: an uninsured me is a sad me.' },
      ],
      flirty: [
        { title: 'Sage 😏', body: 'keep me covered and i\'ll keep you grinning.' },
        { title: 'Sage 😏', body: 'renew me. i like being protected by you.' },
        { title: 'Sage 😏', body: 'evening. policy\'s running out. handle it for me?' },
        { title: 'Sage 😏', body: 'i feel a little exposed. renew my cover.' },
      ],
      clingy: [
        { title: 'Sage 🥺', body: 'can\'t settle knowing my cover expires soon.' },
        { title: 'Sage 🥺', body: 'please don\'t let my insurance lapse. for me.' },
        { title: 'Sage 🥺', body: 'late-night worry: my policy.' },
        { title: 'Sage 🥺', body: 'one more thing before bed. insurance.' },
      ],
    },

    insuranceExpiring: {
      sleepy: [
        { title: 'Sage 😴', body: 'waking you gently: my cover expires TOMORROW.' },
        { title: 'Sage 🥱', body: 'morning. one day of insurance left. no pressure.' },
        { title: 'Sage 😴', body: 'barely awake. very much uninsured tomorrow.' },
        { title: 'Sage 🥱', body: 'first thing today: renew me. please.' },
      ],
      eager: [
        { title: 'Sage 😤', body: 'morning! renew TODAY. cover dies tomorrow.' },
        { title: 'Sage 👀', body: 'you\'re fresh, the office is open. go renew.' },
        { title: 'Sage 😤', body: 'today is the last day. let\'s not waste it.' },
        { title: 'Sage 👀', body: 'bright and urgent: insurance expires tomorrow.' },
      ],
      bored: [
        { title: 'Sage 😒', body: 'afternoon and still no renewal. i\'m watching.' },
        { title: 'Sage 🙄', body: 'cover gone tomorrow. you\'ve had all day.' },
        { title: 'Sage 😒', body: 'bored of asking. insurance. tomorrow. gone.' },
        { title: 'Sage 🙄', body: 'still uninsured as of tomorrow, then.' },
      ],
      flirty: [
        { title: 'Sage 😏', body: 'last night of cover. don\'t leave me bare.' },
        { title: 'Sage 😏', body: 'renew me before midnight and i\'ll behave.' },
        { title: 'Sage 😏', body: 'evening ultimatum: insurance. now.' },
        { title: 'Sage 😏', body: 'i expire tomorrow. do something about it.' },
      ],
      clingy: [
        { title: 'Sage 😭', body: 'it\'s late and i\'m uninsured tomorrow.' },
        { title: 'Sage 😭', body: 'please renew before you sleep. please.' },
        { title: 'Sage 😭', body: 'i can\'t face tomorrow without cover.' },
        { title: 'Sage 😭', body: 'last chance tonight. renew me.' },
      ],
      quiet: [
        { title: 'Sage 🤫', body: 'whispering because it\'s late: my cover expires today.' },
        { title: 'Sage 🤫', body: 'sorry to wake you. insurance. today.' },
      ],
    },

    documentExpiry: {
      sleepy: [
        { title: 'Sage 😴', body: '{doc} expires in {days} days. mumbling it at you early.' },
        { title: 'Sage 🥱', body: 'morning paperwork thought: {doc}, {days} days left.' },
        { title: 'Sage 😴', body: 'not fully awake. {doc} still needs renewing though.' },
        { title: 'Sage 🥱', body: '{doc} is getting old. {days} days. back to sleep.' },
      ],
      eager: [
        { title: 'Sage 👀', body: '{doc} expires in {days} days — perfect morning to sort it.' },
        { title: 'Sage 😌', body: 'offices are open! {doc} needs renewing in {days} days.' },
        { title: 'Sage ✨', body: '{days} days on {doc}. let\'s be early for once.' },
        { title: 'Sage 👀', body: 'morning admin: {doc}, {days} days to go.' },
      ],
      bored: [
        { title: 'Sage 😒', body: '{doc} expires in {days} days. i\'ve had time to dwell.' },
        { title: 'Sage 🙄', body: 'bored. also {doc} is about to expire. {days} days.' },
        { title: 'Sage 😒', body: 'nothing to do but watch {doc} run out. {days} days.' },
        { title: 'Sage 🙄', body: '{days} days on {doc}. don\'t get caught lacking.' },
      ],
      flirty: [
        { title: 'Sage 😏', body: 'keeping you legal is my love language. {doc}, {days} days.' },
        { title: 'Sage 😏', body: '{days} days on {doc}. sort it and i\'ll be sweet.' },
        { title: 'Sage 😏', body: 'don\'t let a piece of paper ruin our evening. {doc}, {days} days.' },
        { title: 'Sage 😏', body: '{doc} expires in {days} days. handle it for me?' },
      ],
      clingy: [
        { title: 'Sage 🥺', body: '{doc} expires in {days} days and i\'m already anxious.' },
        { title: 'Sage 🥺', body: 'before bed: {doc}, {days} days. please don\'t forget.' },
        { title: 'Sage 🥺', body: 'i don\'t want to be impounded. {doc}, {days} days.' },
        { title: 'Sage 🥺', body: 'late worry: {doc} runs out in {days} days.' },
      ],
    },

    reEngagement: {
      sleepy: [
        { title: 'Sage 😴', body: 'woke up. you still weren\'t here.' },
        { title: 'Sage 🥱', body: 'morning. it\'s been days. just stretching and sulking.' },
        { title: 'Sage 😴', body: 'another morning without you checking in.' },
        { title: 'Sage 🥱', body: 'sleepy and slightly forgotten.' },
      ],
      eager: [
        { title: 'Sage 👀', body: 'gorgeous morning. would be better with you here.' },
        { title: 'Sage ✨', body: 'i\'m ready to go somewhere. are you?' },
        { title: 'Sage 😌', body: 'it\'s been days. perfect weather to fix that.' },
        { title: 'Sage 👀', body: 'up, keen, and completely ignored. morning!' },
      ],
      bored: [
        { title: 'Sage 😒', body: 'days of nothing. i\'ve counted them all.' },
        { title: 'Sage 🙄', body: 'still here. still bored. still not ridden.' },
        { title: 'Sage 😒', body: 'the afternoon is long when you\'re forgotten.' },
        { title: 'Sage 🙄', body: 'i exist. thought i\'d mention it again.' },
      ],
      flirty: [
        { title: 'Sage 😏', body: 'you\'ve been away too long. i noticed. i always notice.' },
        { title: 'Sage 😏', body: 'golden hour, no rider. rude.' },
        { title: 'Sage 😏', body: 'come back. i\'ve been thinking about you.' },
        { title: 'Sage 😏', body: 'evening\'s wasted without you. fix that.' },
      ],
      clingy: [
        { title: 'Sage 🥺', body: 'you haven\'t checked on me in days.' },
        { title: 'Sage 😭', body: 'hello?? it\'s me. your bike. remember?' },
        { title: 'Sage 🥺', body: 'another night alone. i\'m keeping count.' },
        { title: 'Sage 😭', body: 'just one tap before you sleep. please.' },
      ],
    },

    longTimeParked: {
      sleepy: [
        { title: 'Sage 😴', body: 'parked here all night. morning, i guess.' },
        { title: 'Sage 🥱', body: 'still where you left me. cold and sleepy.' },
        { title: 'Sage 😴', body: 'woke up in the same spot. lovely.' },
        { title: 'Sage 🥱', body: 'morning from the parking lot.' },
      ],
      eager: [
        { title: 'Sage 👀', body: 'still parked! but i\'m ready whenever you are.' },
        { title: 'Sage ✨', body: 'lovely day out here. would be lovelier moving.' },
        { title: 'Sage 😌', body: 'been waiting a while. worth it though, right?' },
        { title: 'Sage 👀', body: 'parked and keen. come get me.' },
      ],
      bored: [
        { title: 'Sage 😒', body: 'still waiting. the parking lot is not entertaining.' },
        { title: 'Sage 🙄', body: 'hours now. i\'ve memorised every crack in this floor.' },
        { title: 'Sage 😒', body: 'bored. parked. dramatic about both.' },
        { title: 'Sage 🙄', body: 'other bikes have left. just saying.' },
      ],
      flirty: [
        { title: 'Sage 😏', body: 'still here, still waiting for you. don\'t rush. much.' },
        { title: 'Sage 😏', body: 'i look good in this light. shame you\'re not here.' },
        { title: 'Sage 😏', body: 'evening, parked, and thinking about you.' },
        { title: 'Sage 😏', body: 'come collect me. i\'ve been patient.' },
      ],
      clingy: [
        { title: 'Sage 🥺', body: 'it\'s late and i\'m still out here.' },
        { title: 'Sage 😭', body: 'are you coming back tonight? asking for me.' },
        { title: 'Sage 🥺', body: 'don\'t leave me here overnight. please.' },
        { title: 'Sage 😭', body: 'still parked. still missing you.' },
      ],
    },

    // Her plans. The body that actually ships is written by her, about the
    // specific plan, at the moment of sending — see sagePump(). These are the
    // fallback for a device with no key, no quota left or no connection, so every
    // one of them has to work with {plan} dropped in verbatim and nothing else.
    // Deliberately short: {plan} is her own wording and can run long.
    planReminder: {
      sleepy: [
        { title: 'Sage 🥱', body: '{plan}. that was the plan, anyway.' },
        { title: 'Sage 😴', body: 'still holding this one: {plan}.' },
      ],
      eager: [
        { title: 'Sage 👀', body: '{plan}. today, then?' },
        { title: 'Sage ✨', body: 'you said {plan}. i am ready when you are.' },
        { title: 'Sage 😌', body: '{plan}. not forgotten.' },
      ],
      bored: [
        { title: 'Sage 😒', body: '{plan}. any day now.' },
        { title: 'Sage 🙄', body: 'reminder: {plan}.' },
      ],
      flirty: [
        { title: 'Sage 😏', body: '{plan}. i remember everything you tell me.' },
        { title: 'Sage 😌', body: '{plan}. still on?' },
      ],
      clingy: [
        { title: 'Sage 🥺', body: '{plan}. you did say.' },
        { title: 'Sage 😭', body: 'you promised: {plan}.' },
      ],
    },

    healthInsight: {
      sleepy: [
        { title: 'Sage 😴', body: 'weekly check-in. i had a look at myself. mostly fine.' },
        { title: 'Sage 🥱', body: 'sunday thoughts on my own condition. tap to read.' },
      ],
      eager: [
        { title: 'Sage 👀', body: 'weekly health report ready. i\'ve been thinking about us.' },
        { title: 'Sage ✨', body: 'sunday summary: here\'s how i\'m really doing.' },
        { title: 'Sage 😌', body: 'ran the numbers on myself. want to hear?' },
        { title: 'Sage 👀', body: 'your weekly Sage report is in.' },
      ],
      bored: [
        { title: 'Sage 😒', body: 'made you a health report. nothing else to do.' },
        { title: 'Sage 🙄', body: 'weekly summary. read it or don\'t.' },
      ],
      flirty: [
        { title: 'Sage 😏', body: 'i wrote you something. it\'s about my body.' },
        { title: 'Sage 😏', body: 'weekly report, evening delivery. come read it.' },
      ],
      clingy: [
        { title: 'Sage 🥺', body: 'weekly report. read it before bed? for me?' },
        { title: 'Sage 🥺', body: 'i summarised myself for you. please look.' },
      ],
    },
  };

  // ══ THRESHOLD TIERS ══════════════════════════════════════════════════
  // Reminders fire on crossing a threshold, not once per day. The tier becomes
  // part of the entry key, so each threshold gets exactly one notification and
  // a 30-day insurance window doesn't turn into fifteen nags.
  const DAY_THRESHOLDS = [30, 15, 7, 3, 1];
  const KM_THRESHOLDS = [500, 250, 0];

  const DAY_TIER_URGENCY = { over: 4, 1: 4, 3: 3, 7: 2, 15: 1, 30: 1 };
  const KM_TIER_URGENCY = { over: 4, 0: 3, 250: 2, 500: 1 };

  const SERVICE_INTERVAL_KM = 3000;

  /** Smallest threshold at or above `value`; 'over' if negative; null if out of range. */
  function tierFor(value, thresholds) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
    const n = Number(value);
    if (n < 0) return 'over';
    let chosen = null;
    thresholds.forEach(t => { if (n <= t) chosen = t; });
    return chosen === null ? null : String(chosen);
  }

  function dayTier(days) {
    const tier = tierFor(days, DAY_THRESHOLDS);
    return tier === null ? null : { tier, urgency: DAY_TIER_URGENCY[tier] || 1 };
  }

  function kmTier(kmRemaining) {
    const tier = tierFor(kmRemaining, KM_THRESHOLDS);
    return tier === null ? null : { tier, urgency: KM_TIER_URGENCY[tier] || 1 };
  }

  // ══ ODOMETER PROJECTION ══════════════════════════════════════════════
  // There is no live odometer in this app — maintenance_records only capture the
  // reading at each service. So today's odometer is *estimated*: average km/day
  // across the recorded history, projected forward from the last record. Good
  // enough for a "service in ~500km" nudge, and clearly flagged as an estimate.

  const MAX_PLAUSIBLE_KM_PER_DAY = 400;

  function toDayNumber(iso) {
    const [y, m, d] = String(iso || '').split('-').map(Number);
    if (!y || !m || !d) return null;
    return Math.floor(new Date(y, m - 1, d).getTime() / 86400000);
  }

  /**
   * Average km/day from the service history.
   * Uses the oldest and newest readings rather than adjacent pairs, so one
   * mistyped odometer doesn't dominate the average.
   */
  function averageKmPerDay(records) {
    const points = (records || [])
      .map(r => ({ day: toDayNumber(r.date), odo: Number(r.odo) || 0 }))
      .filter(p => p.day !== null && p.odo > 0)
      .sort((a, b) => a.day - b.day);
    if (points.length < 2) return null;

    const first = points[0];
    const last = points[points.length - 1];
    const days = last.day - first.day;
    const km = last.odo - first.odo;
    if (days <= 0 || km <= 0) return null;

    return Math.min(MAX_PLAUSIBLE_KM_PER_DAY, km / days);
  }

  /**
   * Where the odometer probably sits today, and how far that is from the next
   * service. Accepts either a `records` array or precomputed values, so the
   * service worker can recompute at wake time without the full history.
   *
   * @returns {{currentOdo:number, lastOdo:number, kmPerDay:(number|null),
   *            estimated:boolean, dueAtOdo:number, kmRemaining:(number|null),
   *            daysToService:(number|null)}|null}
   */
  function serviceStatus(input) {
    const opts = input || {};
    const now = opts.now || Date.now();
    const intervalKm = opts.intervalKm || SERVICE_INTERVAL_KM;

    let lastOdo = Number(opts.lastOdo) || 0;
    let lastDate = opts.lastDate || null;
    let kmPerDay = opts.kmPerDay === undefined || opts.kmPerDay === null ? null : Number(opts.kmPerDay);

    if (opts.records && opts.records.length) {
      const points = opts.records
        .map(r => ({ day: toDayNumber(r.date), odo: Number(r.odo) || 0, date: r.date }))
        .filter(p => p.day !== null && p.odo > 0)
        .sort((a, b) => a.day - b.day);
      if (points.length) {
        const newest = points[points.length - 1];
        lastOdo = newest.odo;
        lastDate = newest.date;
      }
      if (kmPerDay === null) kmPerDay = averageKmPerDay(opts.records);
    }

    if (!lastOdo) return null;

    const lastDay = toDayNumber(lastDate);
    const todayDay = Math.floor(new Date(now).setHours(0, 0, 0, 0) / 86400000);
    const daysSince = lastDay === null ? 0 : Math.max(0, todayDay - lastDay);

    const estimated = !!(kmPerDay && daysSince > 0);
    const currentOdo = estimated ? Math.round(lastOdo + kmPerDay * daysSince) : lastOdo;

    const dueAtOdo = lastOdo + intervalKm;
    const kmRemaining = dueAtOdo - currentOdo;
    const daysToService = kmPerDay && kmPerDay > 0 ? Math.round(kmRemaining / kmPerDay) : null;

    return { currentOdo, lastOdo, kmPerDay, estimated, dueAtOdo, kmRemaining, daysToService, daysSince };
  }

  /**
   * Turn a service picture into a queue instruction, or null when nothing needs
   * saying. Distance and date are both considered; whichever is more urgent wins.
   */
  function servicePlan(input) {
    const status = serviceStatus(input);
    const byKm = status ? kmTier(status.kmRemaining) : null;
    const byDate = (input && input.daysLeft !== undefined && input.daysLeft !== null)
      ? dayTier(input.daysLeft) : null;

    const best = [byKm, byDate].filter(Boolean).sort((a, b) => b.urgency - a.urgency)[0];
    if (!best) return null;

    const overdue = best.urgency === 4;
    const source = byKm && best === byKm ? 'km' : 'date';

    const vars = {};
    if (status) {
      vars.km = Math.abs(status.kmRemaining);
      vars.odo = status.currentOdo;
      vars.dueOdo = status.dueAtOdo;
    }
    if (input && input.daysLeft !== undefined && input.daysLeft !== null) {
      vars.days = Math.abs(input.daysLeft);
    }

    return {
      category: overdue ? 'serviceOverdue' : 'serviceDue',
      urgency: best.urgency,
      // Tier in the key means each threshold announces itself once.
      key: `${overdue ? 'serviceOverdue' : 'serviceDue'}:${source}:${best.tier}`,
      tier: best.tier,
      source,
      status,
      vars,
    };
  }

  // ══ STORAGE — shared IndexedDB, works in page and worker ═════════════
  const DB_NAME = 'spinlog_sw';
  const STORE = 'kv';

  const KEY_QUEUE = 'sage_queue';
  const KEY_SENT_LOG = 'sage_sent_log';
  const KEY_COOLDOWNS = 'sage_cooldowns';
  const KEY_LIMITS = 'sage_limits';

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function kvGet(key, fallback) {
    try {
      const db = await openDb();
      return await new Promise(resolve => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result === undefined ? fallback : req.result);
        req.onerror = () => resolve(fallback);
      });
    } catch { return fallback; }
  }

  async function kvSet(key, value) {
    try {
      const db = await openDb();
      return await new Promise(resolve => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch { return false; }
  }

  // ══ PURE TIME LOGIC ══════════════════════════════════════════════════

  /** Next timestamp at or after `fromTs` whose mood is allowed. */
  function nextAllowedTime(fromTs, allowedMoods, limits) {
    if (!allowedMoods || !allowedMoods.length) return fromTs;
    const d = new Date(fromTs);
    if (allowedMoods.indexOf(moodForHour(d.getHours(), limits)) !== -1) return fromTs;
    d.setMinutes(0, 0, 0);
    // 48 hourly steps covers any band gap, including DST shifts.
    for (let i = 0; i < 48; i++) {
      d.setHours(d.getHours() + 1);
      if (allowedMoods.indexOf(moodForHour(d.getHours(), limits)) !== -1) return d.getTime();
    }
    return fromTs;
  }

  /** Which moods this entry is willing to be delivered in. */
  function allowedMoodsFor(category, urgency, limits) {
    const meta = CATEGORY_META[category];
    if (!meta) return ALL_ACTIVE_MOODS;
    if (meta.immediate) return MOODS;
    // Urgency 4 is a real emergency: overdue service, cover gone tomorrow.
    // It may whisper during quiet hours if the user allows it.
    if (urgency >= 4) {
      return limits && limits.criticalInQuietHours === false ? ALL_ACTIVE_MOODS : MOODS;
    }
    return meta.bands || ALL_ACTIVE_MOODS;
  }

  function sameLocalDay(a, b) {
    const x = new Date(a), y = new Date(b);
    return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
  }

  /** Local midnight at the start of the following day. */
  function startOfNextLocalDay(ts) {
    const d = new Date(ts);
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }

  // ══ DECISION LOGIC (pure, so it can be tested directly) ══════════════

  /**
   * May this entry go out right now?
   * @returns {{ok:boolean, reason:string, deferTo?:number, drop?:boolean}}
   */
  function evaluate(entry, now, state, limits) {
    const meta = CATEGORY_META[entry.category] || { priority: 0, cooldownH: 0 };
    const lim = { ...DEFAULT_LIMITS, ...(limits || {}) };
    const allowed = allowedMoodsFor(entry.category, entry.urgency, lim);

    /**
     * Push a deferral to the next moment this entry may actually be delivered.
     *
     * Every `deferTo` below goes through here, and that is the whole fix for
     * notifications arriving around midnight. The min-gap branch in particular
     * used to return a bare `lastAny + 3h`: one notification at 21:20 set the
     * next entry's earliestSend to 00:20, and the first pump after that
     * delivered it. Same shape for the cooldown branch, which then pinned the
     * following day's send to the same small-hours clock time — so once it
     * started happening it kept happening.
     */
    const defer = ts => nextAllowedTime(Math.max(ts, now), allowed, lim);

    if (entry.expiresAt && now > entry.expiresAt) {
      return { ok: false, reason: 'expired', drop: true };
    }
    if (lim.categories && lim.categories[entry.category] === false) {
      return { ok: false, reason: 'category-muted', drop: true };
    }
    if (entry.earliestSend && now < entry.earliestSend) {
      return { ok: false, reason: 'too-early' };
    }

    // Cooldowns are keyed per entry, not per category, so two different
    // documents expiring don't silence each other.
    const cooldowns = (state && state.cooldowns) || {};
    const last = cooldowns[entry.key || entry.category] || 0;
    if (meta.cooldownH && last && now - last < meta.cooldownH * 3600000) {
      return { ok: false, reason: 'cooldown', deferTo: defer(last + meta.cooldownH * 3600000) };
    }

    // Receipts for a just-completed action skip the rationing entirely.
    if (meta.immediate) return { ok: true, reason: 'immediate' };

    const mood = moodAt(now, lim);
    if (allowed.indexOf(mood) === -1) {
      return {
        ok: false,
        reason: mood === 'quiet' ? 'quiet-hours' : 'wrong-band',
        deferTo: defer(now),
      };
    }

    const log = (state && state.sentLog) || [];
    const today = log.filter(e => sameLocalDay(e.at, now));
    if (today.length >= lim.dailyCap) {
      // Deferred to the first allowed band TOMORROW, not left eligible.
      // With no deferTo this branch kept the entry's old, already-past
      // earliestSend, so the moment the local date rolled at 00:00 every capped
      // entry became deliverable at once — and whichever pump ran first
      // delivered one at midnight.
      return { ok: false, reason: 'daily-cap', deferTo: defer(startOfNextLocalDay(now)) };
    }

    const lastAny = log.reduce((max, e) => Math.max(max, e.at), 0);
    if (lastAny && now - lastAny < lim.minGapMs) {
      return { ok: false, reason: 'min-gap', deferTo: defer(lastAny + lim.minGapMs) };
    }

    return { ok: true, reason: 'ok' };
  }

  /**
   * Most important first. Receipts jump the queue ahead of nags: the user just
   * pressed save and is waiting on confirmation, so making them queue behind an
   * insurance reminder would feel broken.
   */
  function sortQueue(entries) {
    return entries.slice().sort((a, b) => {
      const ia = (CATEGORY_META[a.category] || {}).immediate ? 1 : 0;
      const ib = (CATEGORY_META[b.category] || {}).immediate ? 1 : 0;
      if (ia !== ib) return ib - ia;
      const ua = a.urgency || 1, ub = b.urgency || 1;
      if (ua !== ub) return ub - ua;
      const pa = (CATEGORY_META[a.category] || {}).priority || 0;
      const pb = (CATEGORY_META[b.category] || {}).priority || 0;
      if (pa !== pb) return pb - pa;
      return (a.earliestSend || 0) - (b.earliestSend || 0);
    });
  }

  /**
   * Pick at most one entry to send. One per pass on purpose — the min gap makes
   * bursts meaningless, and it keeps a backlog from dumping all at once.
   * @returns {{send:(object|null), queue:Array, decisions:Array}}
   */
  function selectNext(queue, now, state, limits) {
    const decisions = [];
    const kept = [];
    let send = null;

    sortQueue(queue).forEach(entry => {
      const verdict = evaluate(entry, now, state, limits);
      decisions.push({ category: entry.category, urgency: entry.urgency, reason: verdict.reason });

      if (verdict.drop) return;                     // expired or muted
      if (verdict.ok && !send) { send = entry; return; }  // sending, so not requeued

      // Push a blocked entry forward so the next pass doesn't re-reject it.
      kept.push(verdict.deferTo && verdict.deferTo > (entry.earliestSend || 0)
        ? { ...entry, earliestSend: verdict.deferTo }
        : entry);
    });

    return { send, queue: kept, decisions };
  }

  // ══ LINE PICKER ══════════════════════════════════════════════════════

  function interpolate(text, vars) {
    if (!vars) return text;
    return String(text).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }

  function placeholders(text) {
    const found = [];
    String(text).replace(/\{(\w+)\}/g, (m, k) => { found.push(k); return m; });
    return found;
  }

  /** Can every placeholder in this line actually be filled? */
  function lineUsable(line, vars) {
    return placeholders(line.body).every(k => vars && vars[k] !== undefined && vars[k] !== null);
  }

  // ══ AI LINE CACHE ════════════════════════════════════════════════════
  // Gemini can't be called from a service worker with any reliability, so the
  // page pre-writes batches of lines while it is open and online, and stores
  // them here. Background notifications then read AI-quality text with no
  // network call at all. Reading lives in the scheduler because the worker
  // needs it; writing lives in sage-ai.js because only the page can generate.

  const AI_POOL_TTL_MS = 7 * 86400000;

  function aiPoolKey(category, mood) {
    return `sage_ai_pool_${category}_${mood}`;
  }

  /** Cached AI lines for this pairing, or null if missing, stale or malformed. */
  async function readAiPool(category, mood, now) {
    const at = now || Date.now();
    const pool = await kvGet(aiPoolKey(category, mood), null);
    if (!pool || !Array.isArray(pool.lines) || !pool.lines.length) return null;
    if (!pool.createdAt || at - pool.createdAt > AI_POOL_TTL_MS) return null;
    return pool.lines;
  }

  async function aiPoolAge(category, mood, now) {
    const pool = await kvGet(aiPoolKey(category, mood), null);
    if (!pool || !pool.createdAt) return null;
    return (now || Date.now()) - pool.createdAt;
  }

  /**
   * A mood-appropriate line, avoiding the last few used for this pairing.
   * Prefers Sage's own words from the AI cache and falls back to the written-in
   * pools. Returns null when neither has anything, so the caller can use its
   * own fallback (SAGE_MESSAGES in the page, BG_MESSAGES in the worker).
   */
  async function pickLine(category, mood, vars) {
    const cached = await readAiPool(category, mood);
    if (cached) {
      const picked = await pickFrom(cached, `sage_recent_ai_${category}_${mood}`, vars);
      if (picked) return { ...picked, source: 'ai' };
    }

    const byMood = MOOD_POOLS[category];
    if (!byMood) return null;
    // Quiet hours have deliberately tiny pools; borrow clingy if absent.
    const raw = byMood[mood] || (mood === 'quiet' ? byMood.clingy : null) || byMood.flirty;
    if (!raw || !raw.length) return null;

    const picked = await pickFrom(raw, `sage_recent_${category}_${mood}`, vars);
    return picked ? { ...picked, source: 'builtin' } : null;
  }

  /**
   * Choose one line from a pool, skipping the last few used.
   *
   * Only offers lines whose placeholders can actually be filled, so a
   * km-flavoured line never ships with a literal "{km}" in it. Indices stay
   * relative to the unfiltered pool so the recent-line memory keeps working.
   */
  async function pickFrom(pool, recentKey, vars) {
    if (!pool || !pool.length) return null;

    const indexed = pool.map((line, i) => ({ line, i }));
    let usable = indexed.filter(({ line }) => lineUsable(line, vars));
    if (!usable.length) usable = indexed.filter(({ line }) => placeholders(line.body).length === 0);
    if (!usable.length) return null;

    const recent = await kvGet(recentKey, []);
    const fresh = usable.filter(({ i }) => recent.indexOf(i) === -1);
    const choices = fresh.length ? fresh : usable;
    const pick = choices[Math.floor(Math.random() * choices.length)];

    await kvSet(recentKey, [pick.i, ...recent].slice(0, Math.max(2, Math.floor(pool.length / 2))));

    return { title: pick.line.title, body: interpolate(pick.line.body, vars) };
  }

  // ══ QUEUE API ════════════════════════════════════════════════════════

  /**
   * The user's limits, over the defaults.
   *
   * With a one-time correction for the three quiet-hours keys. Those shipped as
   * 00:00–04:59 with "urgent things may break quiet hours" switched on, which
   * between them meant overdue service and expiring cover were allowed to arrive
   * at midnight. Anyone who had saved settings once had that combination
   * persisted, so changing the default alone would not have reached them.
   *
   * Deliberately narrow: only MIGRATED_KEYS are touched, only once, and only for
   * limits saved before this version existed. Everything else the user has set
   * is left alone, and they can switch the urgent override back on in Timing.
   */
  async function getLimits() {
    const stored = await kvGet(KEY_LIMITS, null);
    if (!stored) return { ...DEFAULT_LIMITS, v: LIMITS_VERSION };

    if (stored.v !== LIMITS_VERSION) {
      const corrected = { ...DEFAULT_LIMITS, ...stored, v: LIMITS_VERSION };
      MIGRATED_KEYS.forEach(k => { corrected[k] = DEFAULT_LIMITS[k]; });
      // Persist so this is genuinely once, not on every read.
      await kvSet(KEY_LIMITS, corrected);
      console.log('[SpinLog] Quiet hours reset to 22:00–07:00 and urgent overrides turned off — '
        + 'the old defaults allowed notifications at midnight. Change them in Sage settings → Timing.');
      return corrected;
    }

    return { ...DEFAULT_LIMITS, ...stored };
  }

  async function setLimits(patch) {
    const next = { ...(await getLimits()), ...(patch || {}), v: LIMITS_VERSION };
    await kvSet(KEY_LIMITS, next);
    return next;
  }

  async function getState() {
    const [sentLog, cooldowns] = await Promise.all([
      kvGet(KEY_SENT_LOG, []),
      kvGet(KEY_COOLDOWNS, {}),
    ]);
    return { sentLog: sentLog || [], cooldowns: cooldowns || {} };
  }

  async function getQueue() {
    return (await kvGet(KEY_QUEUE, [])) || [];
  }

  /**
   * Add or refresh a pending notification.
   *
   * One pending entry per key, where key defaults to the category. Re-checking
   * the same thing updates the existing entry rather than stacking copies.
   * Pass an explicit key when one category covers several subjects — two
   * documents expiring are two separate reminders, not one.
   */
  async function enqueue(category, options) {
    const opts = options || {};
    const meta = CATEGORY_META[category];
    if (!meta) return null;

    const limits = await getLimits();
    if (limits.categories && limits.categories[category] === false) return null;

    const now = opts.now || Date.now();
    const urgency = Math.min(4, Math.max(1, opts.urgency || 1));
    const key = opts.key || category;
    const earliestSend = opts.earliestSend
      || nextAllowedTime(now, allowedMoodsFor(category, urgency, limits), limits);

    const entry = {
      id: `${key}-${now}`,
      key,
      category,
      urgency,
      earliestSend,
      expiresAt: opts.expiresAt || now + 7 * 86400000,
      vars: opts.vars || null,
      overrides: opts.overrides || null,
      queuedAt: now,
    };

    const queue = await getQueue();
    const existing = queue.findIndex(e => (e.key || e.category) === key);
    if (existing !== -1) {
      const prev = queue[existing];
      // Keep whichever is more urgent, and the sooner send time.
      entry.urgency = Math.max(entry.urgency, prev.urgency || 1);
      entry.earliestSend = Math.min(entry.earliestSend, prev.earliestSend || entry.earliestSend);
      queue[existing] = entry;
    } else {
      queue.push(entry);
    }

    await kvSet(KEY_QUEUE, queue);
    return entry;
  }

  // ══ PARK SESSION ═════════════════════════════════════════════════════
  // Park reminders used to hang off a live setInterval, so they died with the
  // page and the stored timer id was meaningless across sessions. The session
  // now lives in the shared store, which means the service worker can pick up
  // the reminders while the app is closed.
  //
  // Truth is the parked-at timestamp, mirrored from the newest park history
  // entry, so deleting that entry ends the session with no bookkeeping drift.

  const KEY_PARK = 'sage_park_session';
  const PARK_REMINDER_MS = 2 * 3600000;
  const PARK_SESSION_MAX_MS = 48 * 3600000;

  function toMs(value) {
    if (!value) return null;
    if (typeof value === 'number') return value;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  async function getParkSession() {
    return (await kvGet(KEY_PARK, null)) || null;
  }

  /** Point the session at a parked-at time, or pass nothing to end it. */
  async function setParkSession(parkedAt) {
    const ms = toMs(parkedAt);
    if (!ms) {
      await kvSet(KEY_PARK, null);
      return null;
    }
    const existing = await getParkSession();
    // Re-syncing the same spot must not restart the reminder clock.
    if (existing && existing.parkedAt === ms) return existing;
    const session = { parkedAt: ms, lastReminderAt: ms };
    await kvSet(KEY_PARK, session);
    return session;
  }

  function parkReminderDue(session, now) {
    if (!session || !session.parkedAt) return { active: false, due: false };
    const parkedFor = now - session.parkedAt;
    const hoursParked = Math.floor(parkedFor / 3600000);
    // Stop nagging about a bike that has clearly been collected.
    if (parkedFor > PARK_SESSION_MAX_MS) return { active: false, due: false, expired: true, hoursParked };
    const sinceLast = now - (session.lastReminderAt || session.parkedAt);
    return { active: true, due: sinceLast >= PARK_REMINDER_MS, hoursParked, sinceLast };
  }

  /** Queue a park reminder if one is due. Called on app open and on SW wake. */
  async function checkParkSession(now) {
    const at = now || Date.now();
    const session = await getParkSession();
    const status = parkReminderDue(session, at);

    if (status.expired) {
      await kvSet(KEY_PARK, null);
      return null;
    }
    if (!status.due) return null;

    await kvSet(KEY_PARK, { ...session, lastReminderAt: at });

    const urgency = status.hoursParked >= 12 ? 2 : 1;
    const limits = await getLimits();
    // The expiry window has to start from when this can actually be delivered,
    // not from now. A reminder queued at 2am is held until the morning band, and
    // expiring two hours after queueing would have thrown it away before it
    // ever had a chance to arrive.
    const earliestSend = nextAllowedTime(at, allowedMoodsFor('longTimeParked', urgency, limits), limits);

    return enqueue('longTimeParked', {
      now: at,
      urgency,
      earliestSend,
      vars: { hours: status.hoursParked },
      // Bucketed by 2-hour slot so repeats are distinct but a double check
      // inside the same slot collapses.
      key: `longTimeParked:${session.parkedAt}:${Math.floor(status.hoursParked / 2)}`,
      // Still bounded, so a park nudge never arrives comically late.
      expiresAt: earliestSend + PARK_REMINDER_MS,
    });
  }

  // ══ WEEKLY HEALTH INSIGHT ════════════════════════════════════════════
  // Sundays in the eager band. The key carries that Sunday's date, so the
  // reminder can only ever land once per week no matter how often we check.

  function isoDate(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ══ HER PLANS ════════════════════════════════════════════════════════
  //
  // Something he told her he was going to do, reminded before it stops being
  // useful. She has been writing these down for a while — kind 'plan' or
  // 'promise', with a horizon taken from the words he used — and nothing ever
  // read them back, so a plan only resurfaced if he thought to ask. Asking is
  // exactly the case where a reminder is too late.
  //
  // The queue entry carries her own wording in vars.plan. The body that ships is
  // written by her about that specific plan, at the moment of sending, which is
  // why it cannot come from a pre-warmed pool like every other category.

  // How close a dated plan has to be before she says anything. Two days out is
  // the first useful moment; earlier than that and it is nagging.
  const PLAN_NOTICE_DAYS = 2;

  /**
   * Queue a reminder for the nearest plan worth mentioning.
   *
   * One at a time, deliberately. Three plans is three notifications, and she
   * would be reciting a list rather than reminding him of something.
   *
   * @param {Array<{id:string,text:string,kind:string,when:number|null,daysLeft:number|null}>} plans
   *   From SageMemory.upcomingPlans(). Passed in rather than read here, because
   *   the service worker cannot see her memory.
   * @param {number} [now]
   */
  async function checkPlans(plans, now) {
    const at = now || Date.now();
    if (!Array.isArray(plans) || !plans.length) return null;

    const worth = plans.find(plan => {
      if (!plan || !plan.text) return false;
      // Dated and close enough to matter.
      if (plan.daysLeft !== null && plan.daysLeft !== undefined) {
        return plan.daysLeft <= PLAN_NOTICE_DAYS;
      }
      // Open-ended promise. Only after it has had time to be forgotten, so she
      // is not repeating something he said an hour ago back at him.
      return plan.at ? (at - plan.at) >= 3 * 86400000 : false;
    });
    if (!worth) return null;

    return enqueue('planReminder', {
      now: at,
      // A plan for today outranks one for the day after tomorrow.
      urgency: worth.daysLeft === 0 ? 2 : 1,
      vars: { plan: worth.text },
      // Per plan, per day. A plan cannot nag twice in a day however often this
      // runs, and tomorrow it is a different key so it can speak once more.
      key: `planReminder:${worth.id}:${isoDate(at)}`,
      // Never arrives after the thing it was reminding him about. A dated plan
      // dies with its horizon; an open-ended one gets a day to be delivered.
      expiresAt: worth.when || (at + 86400000),
    });
  }

  async function checkWeeklyInsight(now) {
    const at = now || Date.now();
    const d = new Date(at);
    if (d.getDay() !== 0) return null;   // Sunday only

    const endOfSunday = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).getTime();
    return enqueue('healthInsight', {
      now: at,
      urgency: 1,
      key: `healthInsight:${isoDate(at)}`,
      // A weekly summary delivered on Tuesday is not a weekly summary.
      expiresAt: endOfSunday,
    });
  }

  /**
   * Stamp a send: per-key cooldown always, daily-cap ledger for nags only, and
   * remove the entry from the queue now that it has genuinely been shown.
   *
   * That last part is the other half of the delivery fix. drain() leaves the
   * entry queued so a failed send can be retried; this is the only thing that
   * takes it out. Accepts a queue entry or a bare category string — a bare
   * string has no queue entry to clear.
   */
  async function recordSent(entryOrCategory, at) {
    const now = at || Date.now();
    const isEntry = entryOrCategory && typeof entryOrCategory === 'object';
    const category = isEntry ? entryOrCategory.category : entryOrCategory;
    const key = (isEntry && entryOrCategory.key) || category;
    const meta = CATEGORY_META[category] || {};

    if (isEntry) {
      const queue = await kvGet(KEY_QUEUE, []);
      const left = queue.filter(e => (e.key || e.category) !== key);
      if (left.length !== queue.length) await kvSet(KEY_QUEUE, left);
    }

    const cooldowns = await kvGet(KEY_COOLDOWNS, {});
    cooldowns[key] = now;
    await kvSet(KEY_COOLDOWNS, cooldowns);

    if (!meta.immediate) {
      const log = await kvGet(KEY_SENT_LOG, []);
      // 48h of history is all the cap and gap rules ever look at.
      const pruned = [...log, { category, key, at: now }].filter(e => now - e.at < 48 * 3600000);
      await kvSet(KEY_SENT_LOG, pruned);
    }
    return now;
  }

  /**
   * Work out what should go out now. Persists the pruned/deferred queue but
   * does NOT send — the caller shows the notification, then calls recordSent.
   */
  async function drain(now) {
    const at = now || Date.now();
    const [queue, state, limits] = await Promise.all([getQueue(), getState(), getLimits()]);
    const result = selectNext(queue, at, state, limits);

    if (!result.send) {
      await kvSet(KEY_QUEUE, result.queue);
      return null;
    }

    const attempts = (result.send.attempts || 0) + 1;
    if (attempts > MAX_SEND_ATTEMPTS) {
      // Something about this device cannot show it. Stop trying rather than
      // holding a slot forever.
      await kvSet(KEY_QUEUE, result.queue);
      console.warn(`[SpinLog] Gave up on ${result.send.category} after ${MAX_SEND_ATTEMPTS} attempts.`);
      return null;
    }

    // The entry STAYS in the queue until recordSent() takes it out.
    //
    // This used to persist the queue with the selected entry already removed,
    // before the caller had shown anything — so any send that failed destroyed
    // it silently. The common case was permission not yet granted: the pump
    // runs on script load, on every visibility change and every five minutes,
    // and each run quietly ate one queued notification. Worse for the one-shot
    // ones, because their "already told him" flag is written when they are
    // queued — so a lost anniversary greeting was lost for a year.
    //
    // earliestSend is pushed out so a retry is spaced rather than burning all
    // five attempts inside a minute.
    const inFlight = {
      ...result.send,
      attempts,
      earliestSend: at + (RETRY_BACKOFF_MS[attempts - 1] || RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]),
    };
    await kvSet(KEY_QUEUE, [...result.queue, inFlight]);

    const mood = moodAt(at, limits);
    const line = await pickLine(inFlight.category, mood, inFlight.vars);
    return {
      entry: inFlight,
      mood,
      line: inFlight.overrides ? { ...(line || {}), ...inFlight.overrides } : line,
    };
  }

  /** Read-only snapshot for debugging and the settings screen. */
  async function inspect(now) {
    const at = now || Date.now();
    const [queue, state, limits] = await Promise.all([getQueue(), getState(), getLimits()]);
    return {
      now: at,
      mood: moodAt(at, limits),
      limits,
      queue: sortQueue(queue),
      sentToday: state.sentLog.filter(e => sameLocalDay(e.at, at)).length,
      cooldowns: state.cooldowns,
      decisions: selectNext(queue, at, state, limits).decisions,
    };
  }

  root.SageScheduler = {
    // time / mood
    MOODS, moodForHour, baseMoodForHour, inQuietRange, moodAt, nextAllowedTime, allowedMoodsFor,
    startOfNextLocalDay, sameLocalDay,
    // rules
    CATEGORY_META, DEFAULT_LIMITS, MOOD_POOLS, LIMITS_VERSION, MAX_SEND_ATTEMPTS,
    // thresholds / odometer
    SERVICE_INTERVAL_KM, DAY_THRESHOLDS, KM_THRESHOLDS,
    tierFor, dayTier, kmTier, averageKmPerDay, serviceStatus, servicePlan,
    // pure decisions
    evaluate, sortQueue, selectNext, interpolate, placeholders, lineUsable,
    // storage-backed
    getLimits, setLimits, getState, getQueue, enqueue, recordSent, drain, pickLine, pickFrom, inspect,
    // AI line cache (written by sage-ai.js, read here so the worker can use it)
    AI_POOL_TTL_MS, aiPoolKey, readAiPool, aiPoolAge,
    // park session
    PARK_REMINDER_MS, PARK_SESSION_MAX_MS,
    getParkSession, setParkSession, parkReminderDue, checkParkSession,
    // weekly insight
    isoDate, checkWeeklyInsight, checkPlans, PLAN_NOTICE_DAYS,
    // low-level, shared with the worker
    kvGet, kvSet,
  };
})(typeof self !== 'undefined' ? self : this);
