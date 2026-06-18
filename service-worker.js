const CACHE_NAME = 'spinlog-cache-v1.7.1-bg-notifs';
const OFFLINE_URL = 'index.html';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll([
      OFFLINE_URL,
      './styles.css',
      './script.js',
      './notifications.js',
      './Imgs/sage.webp',
      './manifest.json'
    ]))
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
      icon: './Imgs/sage.webp',
      badge: './icons/icon-192.png',
      vibrate: [120, 60, 120],
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
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
  emiDue: [
    { title: 'Sage 😏', body: 'EMI day. you know what to do 😌' },
    { title: 'Sage 🥺', body: 'EMI due today 🥺 don\'t make the bank mad' },
    { title: 'Sage 😌', body: 'today\'s the day. EMI. pay it. ✅' },
    { title: 'Sage 😏', body: 'EMI due. you\'ve always paid on time. keep that streak.' },
    { title: 'Sage 🥺', body: 'gentle nudge: EMI. today. love you 🥺' },
  ],
  emiOverdue: [
    { title: 'Sage 😭', body: 'EMI missed. i feel the tension.' },
    { title: 'Sage 😤', body: 'the bank is not happy. i\'m not happy. pay it.' },
    { title: 'Sage 😭', body: 'overdue EMI. this is giving bad credit energy 😭' },
    { title: 'Sage 😤', body: 'pay the EMI. today. right now. seriously.' },
    { title: 'Sage 😭', body: 'EMI overdue. please don\'t let me become a repo story.' },
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
async function fireBgNotif(category) {
  const pool = BG_MESSAGES[category];
  if (!pool || !pool.length) return;
  const { title, body } = pickRandom(pool);
  await self.registration.showNotification(title, {
    body,
    icon: './Imgs/sage.webp',
    badge: './icons/icon-192.png',
    vibrate: [120, 60, 120],
    tag: category,
    renotify: true,
  });
}

// ── Main background check logic ────────────────────────────────────────
async function checkBackgroundNotifications() {
  try {
    // Read stored notification data from IndexedDB
    const notifData = await swGet('spinlog_notif_data');
    if (!notifData) return; // No data stored yet — app hasn't synced

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. Insurance checks
    if (notifData.insuranceExpiry) {
      const [y, m, d] = notifData.insuranceExpiry.split('-').map(Number);
      const due = new Date(y, m - 1, d);
      const diff = Math.ceil((due - today) / 86400000);

      if (diff === 1 && await bgCooledDown('insuranceExpiring', 12)) {
        await fireBgNotif('insuranceExpiring');
        await bgStamp('insuranceExpiring');
      } else if (diff > 1 && diff <= 30 && await bgCooledDown('insuranceReminder', 72)) {
        await fireBgNotif('insuranceReminder');
        await bgStamp('insuranceReminder');
      }
    }

    // 2. EMI check
    if (notifData.nextEMIDate) {
      const emiDate = new Date(notifData.nextEMIDate);
      emiDate.setHours(0, 0, 0, 0);
      const diff = Math.ceil((emiDate - today) / 86400000);

      if (diff < 0 && await bgCooledDown('emiOverdue', 48)) {
        await fireBgNotif('emiOverdue');
        await bgStamp('emiOverdue');
      } else if (diff >= 0 && diff <= 2 && await bgCooledDown('emiDue', 24)) {
        await fireBgNotif('emiDue');
        await bgStamp('emiDue');
      }
    }

    // 3. Service due check
    if (notifData.nextServiceDate) {
      const [y, m, d] = notifData.nextServiceDate.split('-').map(Number);
      const due = new Date(y, m - 1, d);
      const daysLeft = Math.ceil((due - today) / 86400000);

      if (daysLeft < 0 && await bgCooledDown('serviceOverdue', 72)) {
        await fireBgNotif('serviceOverdue');
        await bgStamp('serviceOverdue');
      } else if (daysLeft >= 0 && daysLeft <= 14 && await bgCooledDown('serviceDue', 24)) {
        await fireBgNotif('serviceDue');
        await bgStamp('serviceDue');
      }
    }

    // 4. Anniversary check (June 27 every year)
    if (today.getMonth() + 1 === 6 && today.getDate() === 27) {
      const annivKey = `anniversary_${today.getFullYear()}`;
      const fired = await swGet(annivKey);
      if (!fired) {
        await fireBgNotif('anniversary');
        await swSet(annivKey, true);
      }
    }

    // 5. Re-engagement check
    const lastOpen = await swGet('last_app_open');
    if (lastOpen) {
      const daysSince = (Date.now() - lastOpen) / 86400000;
      if (daysSince >= 3 && await bgCooledDown('reEngagement', 72)) {
        await fireBgNotif('reEngagement');
        await bgStamp('reEngagement');
      }
    }

  } catch (err) {
    // Silent fail — background checks should never crash the SW
    console.warn('[SpinLog SW] Background notif check error:', err);
  }
}

// ── Message handler: receive data from main thread ─────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SPINLOG_SYNC_NOTIF_DATA') {
    // Main thread sends notification-relevant data for background checks
    event.waitUntil(
      swSet('spinlog_notif_data', event.data.payload).then(() => {
        if (event.data.payload.lastAppOpen) {
          return swSet('last_app_open', event.data.payload.lastAppOpen);
        }
      })
    );
  }
});
