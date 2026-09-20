// Bump this on every asset-list change: the activate handler deletes any
// spinlog-cache-* key that is not the current name, which is what forces the
// new precache to be written.
const CACHE_NAME = 'spinlog-cache-v1.7.83-emoji-by-mood-no-tics';
const OFFLINE_URL = 'index.html';

// The scheduler is shared with the page so foreground and background agree on
// one queue, one daily cap and one set of cooldowns. importScripts is
// synchronous, so SageScheduler is ready before any event handler runs.
importScripts('./src/js/sage-scheduler.js');

// three.js is vendored rather than pulled from a CDN specifically so the ambient
// backdrop survives offline loads. Since r167 the module build is split, so
// three.core.js must be cached too — three.module.min.js imports it by name.
const PRECACHE = [
  OFFLINE_URL,
  './src/css/styles.css',
  './src/css/home.css',
  './src/js/script.js',
  './src/js/cloud-store.js',
  './src/js/sage-confirm.js',
  './src/js/sage-scheduler.js',
  './src/js/sage-memory.js',
  './src/js/sage-tools.js',
  './src/js/sage-ai.js',
  './src/js/sage-keyvault.js',
  './src/js/sage-autofill.js',
  './src/js/sage-ui.js',
  './src/js/notifications.js',
  './src/js/home3d.js',
  './src/js/docs3d.js',
  './vendor/three.module.min.js',
  './vendor/three.core.js',
  './assets/img/sage.webp',
  './assets/img/bike-bg.webp',
  './assets/fonts/BlenderPro-Heavy.woff2',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // addAll() is atomic: one 404 would throw away the whole precache and
      // leave the app with no offline copy at all. Cache per-asset instead.
      Promise.all(PRECACHE.map(url =>
        cache.add(url).catch(err => {
          console.warn('[SpinLog SW] Skipped precache for', url, err);
        })
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(key => key.startsWith('spinlog-cache-') && key !== CACHE_NAME)
        .map(key => caches.delete(key))
    )).then(() => {
      // Run background notification check on activation
      return checkBackgroundNotifications();
    })
  );
  self.clients.claim();
});

// ── Push notification handler ──────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const { title, body } = event.data.json();
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: './assets/img/sage.webp',
      badge: './assets/icons/icon-192.png',
      vibrate: [120, 60, 120],
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  // 'Later' just dismisses — don't drag the app open for it.
  if (event.action === 'dismiss') return;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes('index.html') || c.url.endsWith('/'));
      if (existing) return existing.focus();
      return clients.openWindow('./index.html');
    })
  );
});

// ════════════════════════════════════════════════════════════════════════
// PERIODIC BACKGROUND SYNC — Sage notifications when app is closed
// ════════════════════════════════════════════════════════════════════════

self.addEventListener('periodicsync', event => {
  if (event.tag === 'spinlog-sage-notifs') {
    event.waitUntil(checkBackgroundNotifications());
  }
});

// Fallback: also check on simple 'sync' events (one-time background sync)
self.addEventListener('sync', event => {
  if (event.tag === 'spinlog-sage-notifs') {
    event.waitUntil(checkBackgroundNotifications());
  }
});

// ── Sage message pools (subset for background use) ─────────────────────
const BG_MESSAGES = {
  insuranceReminder: [
    { title: 'Sage 👀', body: 'insurance renews in ~30 days. heads up 👀' },
    { title: 'Sage 😏', body: 'cover expires soon. i\'d prefer to stay covered tyvm' },
    { title: 'Sage 🥺', body: 'please don\'t let my insurance lapse. for me.' },
    { title: 'Sage 😌', body: 'renewal time approaching. no stress, early warning 🙂' },
    { title: 'Sage 👀', body: 'insurance clock is ticking 👀' },
  ],
  insuranceExpiring: [
    { title: 'Sage 😭', body: 'cover expires TOMORROW. please fix this today.' },
    { title: 'Sage 😤', body: 'tomorrow. no insurance. this is urgent.' },
    { title: 'Sage 😭', body: 'insurance. expires. tomorrow. are you seeing this?' },
    { title: 'Sage 😤', body: 'renew today. not tomorrow. today.' },
    { title: 'Sage 😭', body: 'please please please renew today 😭' },
  ],
  serviceDue: [
    { title: 'Sage 😏', body: 'service due soon. book it before i remind you again.' },
    { title: 'Sage 🥺', body: 'service time is coming up. just saying.' },
    { title: 'Sage 👀', body: 'you DO remember my service is due right' },
    { title: 'Sage 😏', body: 'take me to the mechanic. i deserve it.' },
    { title: 'Sage 😌', body: 'running smooth but a checkup would be nice ✨' },
  ],
  serviceOverdue: [
    { title: 'Sage 😭', body: 'we\'ve passed the service km. why.' },
    { title: 'Sage 😤', body: 'overdue. just leaving that here.' },
    { title: 'Sage 😭', body: 'i\'m literally running on vibes at this point' },
    { title: 'Sage 😤', body: 'do you even care about my oil anymore' },
    { title: 'Sage 😤', body: 'OVERDUE. typing in caps because i mean it.' },
  ],
  anniversary: [
    { title: 'Sage ❤️', body: 'one year of you and me 🥹 what a ride.' },
    { title: 'Sage 😏', body: 'anniversary unlocked. you\'re stuck with me now 😌' },
    { title: 'Sage ❤️', body: 'today\'s our day 💛 happy anniversary, Viky.' },
    { title: 'Sage ❤️', body: 'happy anniversary 🥹 grateful for every km.' },
    { title: 'Sage 😏', body: 'anniversary. no speech. just more km ahead 😏' },
  ],
  reEngagement: [
    { title: 'Sage 🥺', body: 'you haven\'t checked on me in days 🥺' },
    { title: 'Sage 😭', body: 'hello?? it\'s me. your bike. remember?' },
    { title: 'Sage 🥺', body: 'i exist. just so you know. 🥺' },
    { title: 'Sage 😭', body: 'days since last check-in. this is concerning.' },
    { title: 'Sage 🥺', body: 'missing our routine 🥺 open the app?' },
  ],
};

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── IndexedDB/localStorage alternative for service worker ──────────────
// Service workers can't access localStorage, so we use IndexedDB via a simple wrapper

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('spinlog_sw', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function swGet(key) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('kv', 'readonly');
      const store = tx.objectStore('kv');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });
  } catch { return undefined; }
}

async function swSet(key, value) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('kv', 'readwrite');
      const store = tx.objectStore('kv');
      store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* silent */ }
}

// ── Cooldown check (hours-based, stored in IndexedDB) ──────────────────
async function bgCooledDown(key, hours) {
  const last = await swGet(`bg_cooldown_${key}`);
  if (!last) return true;
  return Date.now() - last > hours * 3600000;
}

async function bgStamp(key) {
  await swSet(`bg_cooldown_${key}`, Date.now());
}

// ── Background notification fire ───────────────────────────────────────
// tag was previously the bare category, so a second notification in the same
// category silently replaced the first instead of stacking beside it. Stamping
// the tag with the send time keeps each one distinct.
//
// `line` comes from the scheduler's mood pools when it has one for this
// category; BG_MESSAGES is the mood-agnostic fallback.
async function fireBgNotif(category, line, opts) {
  const chosen = line || pickRandom(BG_MESSAGES[category] || []);
  if (!chosen || !chosen.title) return false;
  const now = Date.now();
  const whisper = opts && opts.whisper;
  await self.registration.showNotification(chosen.title, {
    body: chosen.body,
    icon: './assets/img/sage.webp',
    badge: './assets/icons/icon-192.png',
    // Quiet-hours emergencies land silently rather than buzzing at 3am.
    vibrate: whisper ? [0] : [120, 60, 120],
    silent: !!whisper,
    tag: `sage-${category}-${now}`,
    renotify: false,
    timestamp: now,
    data: { category, sentAt: now, source: 'background', url: './index.html' },
    actions: [
      { action: 'open', title: 'Open SpinLog' },
      { action: 'dismiss', title: 'Later' },
    ],
  });
  return true;
}

// ── Scheduler pump ─────────────────────────────────────────────────────
// Asks the scheduler for the single next thing worth saying, shows it, then
// stamps it. Cooldowns, the daily cap, the min gap and quiet hours all live in
// the scheduler, so this stays dumb on purpose.
async function pumpScheduler() {
  const S = self.SageScheduler;
  if (!S) return false;
  const decision = await S.drain();
  if (!decision) return false;
  const shown = await fireBgNotif(decision.entry.category, decision.line, {
    whisper: decision.mood === 'quiet',
  });
  if (shown) await S.recordSent(decision.entry);
  return shown;
}

// ── Main background check logic ────────────────────────────────────────
// Two phases now. First work out what is true and queue it; then let the
// scheduler decide whether this is a good moment to say any of it. Previously
// this fired straight away, which is why notifications could arrive at 4am.
async function checkBackgroundNotifications() {
  try {
    const S = self.SageScheduler;
    const notifData = await swGet('spinlog_notif_data');

    if (S) {
      const data = notifData || {};
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const daysUntil = iso => {
        const [y, m, d] = String(iso).split('-').map(Number);
        if (!y || !m || !d) return null;
        return Math.ceil((new Date(y, m - 1, d) - today) / 86400000);
      };

      // 1. Insurance — 30/15/7/3/1 day thresholds, each announced once
      if (data.insuranceExpiry) {
        const diff = daysUntil(data.insuranceExpiry);
        const tier = diff === null ? null : S.dayTier(diff);
        if (tier) {
          const category = tier.urgency === 4 ? 'insuranceExpiring' : 'insuranceReminder';
          await S.enqueue(category, {
            key: `${category}:${tier.tier}`,
            urgency: tier.urgency,
            vars: { days: Math.abs(diff) },
          });
        }
      }

      // 2. Service — distance and date, whichever is more urgent. The odometer
      //    is re-projected here rather than trusting the estimate the app sent,
      //    which may be days old.
      {
        const daysLeft = data.nextServiceDate ? daysUntil(data.nextServiceDate) : null;
        const plan = S.servicePlan({
          lastOdo: data.lastRecordOdo || data.maxOdo || 0,
          lastDate: data.lastRecordDate || null,
          kmPerDay: data.kmPerDay,
          daysLeft,
        });
        if (plan) {
          await S.enqueue(plan.category, { urgency: plan.urgency, key: plan.key, vars: plan.vars });
        }
      }

      // 3. Anniversary — once per year, tracked separately from the cooldown
      //    so a cleared queue can't cause a repeat.
      if (today.getMonth() + 1 === 6 && today.getDate() === 27) {
        const annivKey = `anniversary_${today.getFullYear()}`;
        if (!(await swGet(annivKey))) {
          await S.enqueue('anniversary', { urgency: 2, expiresAt: Date.now() + 86400000 });
          await swSet(annivKey, true);
        }
      }

      // 4. Re-engagement
      const lastOpen = await swGet('last_app_open');
      if (lastOpen) {
        const daysSince = (Date.now() - lastOpen) / 86400000;
        if (daysSince >= 2) await S.enqueue('reEngagement', { urgency: daysSince >= 7 ? 2 : 1 });
      }

      // 5. Still parked? This is the case that used to break entirely, because
      //    the reminder lived in a page timer that died with the tab.
      await S.checkParkSession();

      // 6. Sunday morning: the weekly read on herself. The prose is written by
      //    the page during the week; the worker only delivers the nudge.
      await S.checkWeeklyInsight();

      await pumpScheduler();
      return;
    }

    // ── Fallback: scheduler unavailable (importScripts failed) ──────────
    // Keep the old direct-fire behaviour rather than going silent.
    if (!notifData) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (notifData.insuranceExpiry) {
      const [y, m, d] = notifData.insuranceExpiry.split('-').map(Number);
      const diff = Math.ceil((new Date(y, m - 1, d) - today) / 86400000);
      if (diff === 1 && await bgCooledDown('insuranceExpiring', 12)) {
        await fireBgNotif('insuranceExpiring');
        await bgStamp('insuranceExpiring');
      } else if (diff > 1 && diff <= 30 && await bgCooledDown('insuranceReminder', 72)) {
        await fireBgNotif('insuranceReminder');
        await bgStamp('insuranceReminder');
      }
    }

    if (notifData.nextServiceDate) {
      const [y, m, d] = notifData.nextServiceDate.split('-').map(Number);
      const daysLeft = Math.ceil((new Date(y, m - 1, d) - today) / 86400000);
      if (daysLeft < 0 && await bgCooledDown('serviceOverdue', 72)) {
        await fireBgNotif('serviceOverdue');
        await bgStamp('serviceOverdue');
      } else if (daysLeft >= 0 && daysLeft <= 14 && await bgCooledDown('serviceDue', 24)) {
        await fireBgNotif('serviceDue');
        await bgStamp('serviceDue');
      }
    }
  } catch (err) {
    // Silent fail — background checks should never crash the SW
    console.warn('[SpinLog SW] Background notif check error:', err);
  }
}

// ── Message handler: receive data from main thread ─────────────────────

// The main thread syncs in two separate passes: initApp() knows the cover
// expiry dates but not the service date, and updateHomeServiceInfo() knows the
// service date but not the cover dates. A wholesale swSet() therefore had the
// second pass erase whatever the first one wrote, which is why background
// insurance reminders never fired. Merge key-by-key instead, and treat
// null/undefined as "no news" rather than "clear this".
async function mergeNotifData(payload) {
  if (!payload || typeof payload !== 'object') return;
  const existing = (await swGet('spinlog_notif_data')) || {};
  const merged = { ...existing };

  Object.keys(payload).forEach(key => {
    const value = payload[key];
    if (value !== null && value !== undefined) merged[key] = value;
  });

  await swSet('spinlog_notif_data', merged);
  if (payload.lastAppOpen) await swSet('last_app_open', payload.lastAppOpen);
}

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SPINLOG_SYNC_NOTIF_DATA') {
    event.waitUntil(mergeNotifData(event.data.payload));
  }

  // Lets the app confirm what the worker is actually holding — used by the
  // Task 1 verification step and handy for debugging background notifs.
  if (event.data && event.data.type === 'SPINLOG_GET_NOTIF_DATA') {
    const port = event.ports && event.ports[0];
    event.waitUntil(
      swGet('spinlog_notif_data').then(data => {
        if (port) port.postMessage({ type: 'SPINLOG_NOTIF_DATA', payload: data || null });
      })
    );
  }
});
