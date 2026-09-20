// ════════════════════════════════════════════════════════════════════════
// SpinLog | VEHICLE IDENTITY
//
// The bike's own facts had no single owner. The purchase date in particular
// existed twice — as "27-06-2025" text in the Ownership Snapshot and as the
// ISO literal '2025-06-27' passed to checkAnniversaryNotif() — so "how old is
// she" could not be answered without scraping markup. This module is now the
// one place that knows, and it is read by the Vehicle Overview age row, the
// anniversary notification and Sage's context builder.
//
// Deliberately outside the DOMContentLoaded closure: the command-center IIFE
// at the bottom of this file needs it too, and neither can see the other's
// scope.
// ════════════════════════════════════════════════════════════════════════
window.dkVehicle = (function () {
  'use strict';

  const FACTS = {
    make: 'KTM',
    name: 'Duke 250 Gen 3',
    registration: 'TN 60 BV 1227',
    engineNo: 'S-962*15524*',
    vin: 'MD2JPEXC0SN078159',
    purchaseDate: '2025-06-27',   // ISO. Shown as 27-06-2025 in the snapshot.
    purchasePrice: 284000,
    primaryUse: 'Daily + Weekend Rides',
    // Age counts from HERE, not from purchaseDate, and the two are deliberately
    // three days apart. This is the date she was registered and handed over —
    // what KTM's own app counts from — while purchaseDate is the date the sale
    // was recorded in SpinLog and is what the anniversary notification uses.
    // If your papers say something else, call dkVehicle.setAgeFrom('YYYY-MM-DD')
    // once and it sticks; nothing here needs editing.
    registeredDate: '2025-06-24',
  };

  // A correction to the registration date, so it can be aligned with the KTM app
  // without touching source.
  const isIso = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

  /**
   * The date her age is measured from, honouring any correction you have made.
   *
   * Stored in the cloud, so "together for 1 yr 2 mo" is the same figure on the
   * phone as on the laptop. Falls back to the shipped registration date until the
   * store has loaded, which is also what a first run looks like.
   */
  function ageFrom() {
    const store = cloudStore();
    const stored = store ? store.setting('ageFrom', null) : null;
    if (isIso(stored)) return stored;
    return FACTS.registeredDate || FACTS.purchaseDate;
  }

  /**
   * Align her age with what your registration actually says.
   * @param {string} iso 'YYYY-MM-DD', or '' to go back to the shipped date.
   */
  function setAgeFrom(iso) {
    const store = cloudStore();
    if (!store) return false;
    if (!iso) { store.setSetting('ageFrom', null); return true; }
    if (!isIso(iso)) return false;
    store.setSetting('ageFrom', iso);
    return true;
  }

  function parseIso(iso) {
    const [y, m, d] = String(iso || '').split('-').map(Number);
    if (!y || !m || !d) return null;
    const date = new Date(y, m - 1, d);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  /**
   * "1 yr 2 mo 21 d" — the compact form the fact grid has room for.
   * Zero units are dropped rather than shown as "0 mo", so an exact anniversary
   * reads as "1 yr" instead of "1 yr 0 mo 0 d".
   */
  function shortLabel(years, months, days) {
    const parts = [];
    if (years) parts.push(`${years} yr`);
    if (months) parts.push(`${months} mo`);
    if (days) parts.push(`${days} d`);
    if (parts.length) return parts.join(' ');
    return 'Day one';
  }

  /** "1 year, 2 months and 21 days" — the form Sage can say out loud. */
  function longLabel(years, months, days) {
    const parts = [];
    if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`);
    if (months) parts.push(`${months} month${months === 1 ? '' : 's'}`);
    if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
    if (!parts.length) return 'brand new today';
    if (parts.length === 1) return parts[0];
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  }

  /**
   * Calendar age, counted the way a person counts it: a month is only complete
   * once the day-of-month comes round again, so 27 Jun to 26 Jul is still
   * 0 months rather than 1.
   *
   * @returns {{years:number, months:number, days:number, totalDays:number,
   *            label:string, long:string, since:string}|null}
   */
  function age(now) {
    const from = parseIso(ageFrom());
    if (!from) return null;
    const to = now ? new Date(now) : new Date();
    if (Number.isNaN(to.getTime()) || to < from) return null;

    let years = to.getFullYear() - from.getFullYear();
    let months = to.getMonth() - from.getMonth();
    let days = to.getDate() - from.getDate();

    if (days < 0) {
      months--;
      // Borrow from the month that has just ended, not from a flat 30.
      days += new Date(to.getFullYear(), to.getMonth(), 0).getDate();
    }
    if (months < 0) { years--; months += 12; }

    return {
      years, months, days,
      totalDays: Math.floor((to - from) / 86400000),
      label: shortLabel(years, months, days),
      long: longLabel(years, months, days),
      since: from.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    };
  }

  return { ...FACTS, parseIso, age, ageFrom, setAgeFrom };
})();

// ════════════════════════════════════════════════════════════
// THE CLOUD STORE, REACHED FROM HERE
//
// Park history, upload notes, upload dates and the purchase-date override are in
// the database now rather than on whichever machine you typed them into. See
// src/js/cloud-store.js for where each one lives.
//
// This accessor MUST STAY AT TOP LEVEL, and that is not a style preference.
//
// This file is one enormous DOMContentLoaded handler from roughly line 200 to
// roughly line 3850, and several sections — LAST PARKED LOCATION, COVER DATE
// EDITING — sit AFTER it at true top level. Indentation is inconsistent enough
// that column 0 says nothing about scope. Declared inside the handler, this is
// invisible to those sections, and the first one to call it throws a
// ReferenceError during script evaluation. Everything below that point then never
// gets defined, so initApp() reaches setupParkFeature() and dies — which looks
// like an app stuck on "CHECKING…" with one section rendered. That shipped once;
// `node tools/audit-boot.mjs` is what catches it.
// ════════════════════════════════════════════════════════════

/** The cloud store, or null. Every caller degrades quietly without it. */
function cloudStore() {
  return window.dkCloudStore || null;
}

document.addEventListener('DOMContentLoaded', function() {
  // Supabase configuration
  const SUPABASE_URL = 'https://ysjkedaekburdxgoccwd.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlzamtlZGFla2J1cmR4Z29jY3dkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5NzkzNDEsImV4cCI6MjA2OTU1NTM0MX0.OsIZS9tLApsWB07fAU5QUy30rDhnWm9-axn0bdnfjOw';
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.supabaseClient = supabase;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./service-worker.js')
  });
}

let uploadPercentInterval = null;
function startUploadPercent() {
  let percent = 1;
  showPopup('loading', `Uploading... ${percent}%`);
  if (uploadPercentInterval) clearInterval(uploadPercentInterval);
  uploadPercentInterval = setInterval(() => {
    if (percent < 93) {
      percent += Math.floor(Math.random() * 7) + 2;
      if (percent > 93) percent = 93;
      showPopup('loading', `Uploading... ${percent}%`);
    }
  }, 130);
}

function finishUploadPercent() {
  if (uploadPercentInterval) clearInterval(uploadPercentInterval);
  showPopup('loading', `Uploading... 100%`);
  setTimeout(() => {
    hidePopup();
  }, 700);
}

function errorUploadPercent() {
  if (uploadPercentInterval) clearInterval(uploadPercentInterval);
  showPopup('error', 'Upload failed.');
}


function showProgressBar() {
  const bar = document.getElementById('uploadProgressBar');
  if (!bar) return;
  bar.style.display = 'block';
  bar.style.width = '1%';
  let progress = 1;
  bar._timer = setInterval(() => {
    // Animate progress to simulate real upload
    if (progress < 92) { // don't reach 100% until done
      progress += Math.random() * 5 + 1;
      bar.style.width = Math.min(progress, 92) + '%';
    }
  }, 130);
}

function finishProgressBar() {
  const bar = document.getElementById('uploadProgressBar');
  if (!bar) return;
  clearInterval(bar._timer);
  bar.style.width = '100%';
  setTimeout(() => {
    bar.style.display = 'none';
    bar.style.width = '0%';
  }, 550);
}

function errorProgressBar() {
  const bar = document.getElementById('uploadProgressBar');
  if (!bar) return;
  clearInterval(bar._timer);
  bar.style.background = '#b52222';
  bar.style.width = '100%';
  setTimeout(() => {
    bar.style.display = 'none';
    bar.style.width = '0%';
    bar.style.background = 'linear-gradient(90deg, #fb6900 60%, #fba600 100%)';
  }, 1200);
}


// --- PDF modal preview function (global) ---
function showPdfModal(signedUrl) {
  const modal = document.getElementById('pdfPreviewModal');
  const frame = document.getElementById('fullPreviewPdf');
  if (!modal || !frame) return;
  frame.src = signedUrl + "#toolbar=1";
  modal.style.display = 'flex';
  modal.onclick = function() {
    modal.style.display = 'none';
    frame.src = '';
  };
}

// confirmDeleteWithHold() used to live here as a press-and-hold button injected
// into #customPopup. It now comes from src/js/sage-confirm.js, which loads before
// this file, and every delete in the app goes through one slide-to-delete dialog
// instead.
//
// It was deleted rather than left unused on purpose. A top-level `function
// confirmDeleteWithHold` in this file becomes a window property, and this file
// loads *after* sage-confirm.js — so keeping the old one here would silently win
// and nothing would change on screen.
//
// Three things the old one got wrong, so they do not come back:
//   · It built its dialog inside #customPopup, the same element showPopup() uses
//     for "Deleting…". The confirmation and the progress it caused were one node.
//   · mouseleave cancelled the hold, so a finger that drifted a pixel reset the
//     countdown with no explanation.
//   · There was no cancel callback at all, which is why askToConfirm() below had
//     to watch the overlay's class list to notice a dismissal.

  // Popup functions
// Fixed showPopup function - replace your existing one with this
function showPopup(type, message) {
  const popup = document.getElementById('customPopup');
  const spinner = document.getElementById('popupSpinner');
  const success = document.getElementById('popupSuccess');
  const error = document.getElementById('popupError');
  const messageEl = document.getElementById('popupMessage');
  
  spinner.style.display = 'none';
  success.style.display = 'none';
  error.style.display = 'none';
  messageEl.innerHTML = message;
  
  if (type === 'loading') {
    spinner.style.display = 'block';
  } else if (type === 'success') {
    success.style.display = 'block';
  } else if (type === 'error') {
    error.style.display = 'block';
  }
  
  popup.classList.add('show');

  // Most result popups self-dismiss. Ones the user is meant to read or click
  // (the DB status card and its Check again button) opt out with
  // data-popup-persist; backdrop click and Escape still close them.
  const persistent = typeof message === 'string' &&
    (message.includes('Hold') || message.includes('data-popup-persist'));

  if ((type === 'success' || type === 'error') && !persistent) {
    setTimeout(hidePopup, 3000);
  }
}


  function hidePopup() {
    document.getElementById('customPopup').classList.remove('show');
  }
  function updatePopup(type, message) {
    const spinner = document.getElementById('popupSpinner');
    const success = document.getElementById('popupSuccess');
    const error = document.getElementById('popupError');
    const messageEl = document.getElementById('popupMessage');
    spinner.style.display = 'none';
    success.style.display = 'none';
    error.style.display = 'none';
    messageEl.textContent = message;
    if (type === 'success') {
      success.style.display = 'block';
    } else if (type === 'error') {
      error.style.display = 'block';
    }
    setTimeout(hidePopup, 3000);
  }

  // Exposed so code outside this closure can reuse the real popup instead of
  // re-implementing it. The park feature's showAppPopup() tested for a bare
  // `showPopup` identifier it could never see from its own IIFE, so it always
  // fell through to a duplicate implementation.
  window.showPopup = showPopup;
  window.hidePopup = hidePopup;
  window.updatePopup = updatePopup;

  // Dismiss the popup by clicking the dimmed backdrop, or with Escape. Only a
  // click on the overlay itself counts — clicks inside .popup-content must not
  // close it.
  (function enablePopupDismiss() {
    const overlay = document.getElementById('customPopup');
    if (!overlay) return;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) hidePopup(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('show')) hidePopup();
    });
  })();

  // Test Supabase connection
  async function testConnection() {
    try {
      const { error } = await supabase
        .from('maintenance_records')
        .select('id', { count: 'exact', head: true });
      return !error;
    } catch {
      return false;
    }
  }

  // Home page DB status + lightweight keep-alive when SpinLog opens.
  const DB_STATUS_STORAGE_KEY = 'spinlogDbStatus';

  function formatDbStatusTime(isoValue) {
    if (!isoValue) return 'Not checked yet';
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) return 'Not checked yet';
    return date.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function getStoredDbStatus() {
    try {
      return JSON.parse(localStorage.getItem(DB_STATUS_STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function setDbStatusUi(state, checkedAt) {
    const button = document.getElementById('dbStatusButton');
    const text = document.getElementById('dbStatusText');
    if (!button || !text) return;

    button.classList.remove('db-status-online', 'db-status-offline', 'db-status-checking');
    button.classList.add(`db-status-${state}`);

    const label = state === 'online' ? 'Online' : state === 'offline' ? 'Offline' : 'Checking...';
    text.textContent = label;
    button.setAttribute('aria-label', `Database status: ${label}. Last checked: ${formatDbStatusTime(checkedAt)}`);
  }

  async function getDbTableCount(tableName) {
    try {
      const { count, error } = await supabase
        .from(tableName)
        .select('id', { count: 'exact', head: true });
      if (error) return null;
      return Number.isFinite(count) ? count : 0;
    } catch {
      return null;
    }
  }

  async function fetchDbStatusData() {
    const [serviceRecords, vehicleDocs, historicUploads] = await Promise.all([
      getDbTableCount('maintenance_records'),
      getDbTableCount('vehicle_documents'),
      getDbTableCount('media_files')
    ]);

    return {
      serviceRecords,
      vehicleDocs,
      historicUploads
    };
  }

  function formatDbCount(value) {
    return value === null || value === undefined ? '-' : String(value);
  }

  async function refreshDbStatus(showDetails = false) {
    const checkedAt = new Date().toISOString();
    setDbStatusUi('checking', checkedAt);
    const online = await testConnection();
    const status = {
      state: online ? 'online' : 'offline',
      checkedAt,
      table: 'maintenance_records'
    };
    localStorage.setItem(DB_STATUS_STORAGE_KEY, JSON.stringify(status));
    setDbStatusUi(status.state, status.checkedAt);
    if (showDetails) {
      status.data = online ? await fetchDbStatusData() : null;
      showDbStatusDetails(status);
    }
    return status;
  }

  function showDbStatusDetails(status) {
    const isOnline = status.state === 'online';
    const data = status.data || {};
    const table = status.table || 'maintenance_records';

    // Built as a self-contained status card rather than a stack of
    // "label: value" lines, which read like console output. The shared popup's
    // own icon is hidden for this one (see .popup-content:has(.db-status-popup)
    // in styles.css) because the card carries its own state indicator.
    showPopup(isOnline ? 'success' : 'error', `
      <div class="db-status-popup" data-state="${isOnline ? 'online' : 'offline'}" data-popup-persist>
        <div class="dbs-head">
          <span class="dbs-dot" aria-hidden="true"></span>
          <span class="dbs-head-copy">
            <small>Supabase</small>
            <strong>${isOnline ? 'Online' : 'Not responding'}</strong>
          </span>
          <button type="button" class="dbs-recheck" onclick="window.dkRecheckDb && window.dkRecheckDb()"
                  aria-label="Check again">
            <i class="fas fa-rotate" aria-hidden="true"></i>
          </button>
        </div>

        ${isOnline ? `
          <dl class="dbs-grid" aria-label="Row counts">
            <div class="dbs-tile">
              <dt>Service</dt>
              <dd>${formatDbCount(data.serviceRecords)}</dd>
            </div>
            <div class="dbs-tile">
              <dt>Docs</dt>
              <dd>${formatDbCount(data.vehicleDocs)}</dd>
            </div>
            <div class="dbs-tile">
              <dt>Media</dt>
              <dd>${formatDbCount(data.historicUploads)}</dd>
            </div>
          </dl>
        ` : `
          <p class="dbs-note">
            The project is probably paused. Open the Supabase dashboard and resume it,
            then check again.
          </p>
        `}

        <div class="dbs-foot">
          <span><i class="fas fa-clock" aria-hidden="true"></i> ${formatDbStatusTime(status.checkedAt)}</span>
          <span class="dbs-table"><i class="fas fa-table" aria-hidden="true"></i> ${table}</span>
        </div>
      </div>
    `);
  }

  // Lets the Check again button inside the status card re-run the same check the
  // chip does. The button spins while the request is in flight; refreshDbStatus
  // re-renders the whole card on completion, which replaces the button.
  window.dkRecheckDb = () => {
    const btn = document.querySelector('.db-status-popup .dbs-recheck');
    if (btn) {
      btn.classList.add('is-busy');
      btn.disabled = true;
    }
    return refreshDbStatus(true);
  };

  function initDbStatusMonitor() {
    const button = document.getElementById('dbStatusButton');
    const stored = getStoredDbStatus();
    if (stored.state) setDbStatusUi(stored.state, stored.checkedAt);

    if (button) {
      button.addEventListener('click', () => refreshDbStatus(true));
    }

    // One lightweight heartbeat on app open. This helps when the site is visited;
    // use the GitHub Actions workflow for no-visitor days.
    refreshDbStatus(false);
  }

// ==== DOCS SECTION: VEHICLE DOCS LOGIC ====

// The four fixed slots. Anything else in vehicle_documents.document_type is a
// user-added document and gets its own card built at load time.
const VEHICLE_TYPES = [
  'Driving License',
  'Registration Certificate',
  'Pollution Certificate',
  'Insurance Policy'
];

/**
 * Today in the rider's own calendar.
 *
 * toISOString() is UTC, so east of Greenwich it returns yesterday for the whole
 * evening — which quietly dated late-night uploads and edits to the day before.
 */
function localIsoDate(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* Custom document types remembered from the last visit.
   Custom cards only exist in the DOM once the vault query has come back, so on
   every load the grid painted four fixed cards and then visibly grew as the
   user-added ones arrived. Keeping the list locally lets those cards go up in
   the first paint alongside the fixed four; loadVehicleDocsFast() then reconciles
   them against the real data, so the cache being stale is self-correcting. */
const CUSTOM_DOCS_KEY = 'spinlogCustomDocTypes';

function readCustomDocCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_DOCS_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(row => row && typeof row.type === 'string' && row.type) : [];
  } catch {
    return [];
  }
}

function writeCustomDocCache(rows) {
  try { localStorage.setItem(CUSTOM_DOCS_KEY, JSON.stringify(rows.slice(0, 40))); }
  catch { /* quota — the cards still arrive with the query, just a beat later */ }
}

/** Put last visit's custom cards up now, before the vault answers. */
function primeCustomDocCards() {
  const built = [];
  readCustomDocCache().forEach(({ type, notes }) => {
    if (VEHICLE_TYPES.includes(type)) return;
    const descriptor = createCustomDocCard(type, notes);
    if (descriptor) built.push(descriptor);
  });
  return built;
}

// Helper: get signed URL for private bucket
async function getSignedUrl(fileName) {
  const { data, error } = await supabase
    .storage
    .from('vehicle-documents')
    .createSignedUrl(fileName, 60 * 60); // 1 hour
  if (error || !data) return null;
  return data.signedUrl;
}

// Utility helpers for docs/media rendering
function docsEscapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function docsEscapeAttr(value) {
  return docsEscapeHtml(value).replace(/`/g, '&#96;');
}

function docsFormatBytes(bytes) {
  const size = Number(bytes || 0);
  if (!size) return 'File';
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function docsFormatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function docsIconForType(type, fileName = '') {
  const ext = String(fileName).split('.').pop().toLowerCase();
  if (type === 'audio') return 'fa-wave-square';
  if (type === 'video') return 'fa-play';
  if (type === 'image') return 'fa-image';
  if (ext === 'pdf') return 'fa-file-pdf';
  return 'fa-file-lines';
}

// Notes and dates on historic uploads.
//
// Columns on the media_files row they describe, reached through the cloud store.
// They were a JSON map in localStorage keyed by the row id — a foreign key
// pretending not to be one — which is why a note typed on the laptop was not on
// the phone, and why deleting an upload left its note behind for ever.
//
// The names still say "Local" because a dozen call sites use them and the word is
// the only thing about them that is now wrong.

function setHistoricLocalNote(id, notes) {
  const store = cloudStore();
  if (store) store.setNote(id, notes);
}

function getHistoricLocalNote(id) {
  const store = cloudStore();
  return store ? store.note(id) : '';
}

function setHistoricLocalDate(id, isoDate) {
  const store = cloudStore();
  if (store) store.setUploadDate(id, isoDate);
}

function getHistoricLocalDate(id) {
  const store = cloudStore();
  return store ? store.uploadDate(id) : '';
}

/**
 * @param {object} [options]
 * @param {object|null} [options.context] What the file actually is
 *   ({fileName, mediaType, uploadedOn}). Handed to Sage's autofill so her
 *   "draft it" button knows what it is writing about; without it that button
 *   stays hidden rather than inventing something.
 */
function showHistoricNotesModal({ title = 'Add upload notes', help = 'Write what this file is about. Notes are required.', initial = '', required = true, context = null } = {}) {
  return new Promise(resolve => {
    const modal = document.getElementById('historicNotesModal');
    const titleEl = document.getElementById('historicNotesTitle');
    const helpEl = document.getElementById('historicNotesHelp');
    const input = document.getElementById('historicNotesInput');
    const saveBtn = document.getElementById('historicNotesSave');
    const cancelBtn = document.getElementById('historicNotesSkip');
    const closeBtn = document.getElementById('historicNotesCancel');

    if (!modal || !input || !saveBtn || !cancelBtn || !closeBtn) {
      const fallback = prompt(title, initial || '');
      const value = (fallback || '').trim();
      resolve(required && !value ? null : value);
      return;
    }

    titleEl.textContent = title;
    helpEl.textContent = help;
    helpEl.classList.remove('is-bad');
    input.value = initial || '';
    // Reveals (or hides) the "let Sage draft it" button for this upload.
    window.SageAutofill?.setMediaContext(context);
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => input.focus(), 50);

    const clean = () => {
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
      window.SageAutofill?.setMediaContext(null);
      saveBtn.onclick = null;
      cancelBtn.onclick = null;
      closeBtn.onclick = null;
      modal.onclick = null;
      document.removeEventListener('keydown', onKey);
    };
    const cancel = () => { clean(); resolve(null); };
    const save = () => {
      const notes = input.value.trim();
      if (required && !notes) {
        input.focus();
        input.style.borderColor = '#ff4d4d';
        helpEl.textContent = 'Notes are required before saving this upload.';
        return;
      }
      input.style.borderColor = '';
      clean();
      resolve(notes);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') cancel();
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') save();
    };

    saveBtn.onclick = save;
    cancelBtn.onclick = cancel;
    closeBtn.onclick = cancel;
    modal.onclick = (e) => { if (e.target === modal) cancel(); };
    document.addEventListener('keydown', onKey);
  });
}

// Async: Render one vehicle doc card without bulky embedded previews.
// Fast path: do NOT create a signed URL during page load. Create it only when View is tapped.
window._vehicleDocRows = window._vehicleDocRows || new Map();
function renderVehicleDocPreview(previewEl, type, fileName, origName, uploadBtn) {
  const card = uploadBtn.closest('.doc-card');
  const headerDeleteBtn = card.querySelector('.doc-delete-btn');
  window._vehicleDocRows.set(type, { fileName, origName });

  previewEl.innerHTML = `<button class="doc-open-pill" type="button" onclick="window._openVehicleDoc && window._openVehicleDoc('${docsEscapeAttr(type)}')"><i class="fas fa-arrow-up-right-from-square"></i> View</button>`;

  if (headerDeleteBtn) headerDeleteBtn.style.display = 'inline-flex';
  uploadBtn.style.display = 'none';
  uploadBtn.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Upload document';
}

window._openVehicleDoc = async function(type) {
  const row = window._vehicleDocRows?.get(type);
  if (!row || !row.fileName) {
    updatePopup('error', 'Could not find this document. Refresh and try again.');
    return;
  }
  showPopup('loading', 'Opening document...');
  const signedUrl = await getSignedUrl(row.fileName);
  hidePopup();
  if (!signedUrl) {
    updatePopup('error', 'Could not create file link.');
    return;
  }
  window.open(signedUrl, '_blank', 'noopener');
};

// Async: load most recent doc for a type (on startup)
async function loadVehicleDoc(type, previewEl, uploadBtn) {
  const { data, error } = await supabase
    .from('vehicle_documents')
    .select('*')
    .eq('document_type', type)
    .order('upload_date', { ascending: false })
    .limit(1);

  const card = uploadBtn.closest('.doc-card');
  const headerDeleteBtn = card.querySelector('.doc-delete-btn');

  if (error || !data || !data.length) {
    previewEl.innerHTML = '';
    uploadBtn.style.display = 'inline-flex';
    uploadBtn.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Upload document';
    if (headerDeleteBtn) headerDeleteBtn.style.display = 'none';
    return;
  }

  const fileRow = data[0];
  await renderVehicleDocPreview(previewEl, type, fileRow.file_name, fileRow.original_name, uploadBtn);
}

// Helper function to show image modal
function showImageModal(src) {
  const modal = document.getElementById('imagePreviewModal');
  const img = document.getElementById('fullPreviewImg');
  if (!modal || !img) return;
  img.src = src;
  modal.style.display = 'flex';
  modal.onclick = () => {
    modal.style.display = 'none';
    img.src = '';
  };
}

// Helper function to get current file info for deletion
async function getCurrentFileForDelete(type, deleteBtn, previewEl, uploadBtn) {
  const { data, error } = await supabase
    .from('vehicle_documents')
    .select('*')
    .eq('document_type', type)
    .order('upload_date', { ascending: false })
    .limit(1);

  if (error || !data || !data.length) {
    showPopup('error', 'No file found to delete');
    return;
  }

  const fileRow = data[0];
  confirmDeleteWithHold(
    'It comes off the vault and off this device.<br><b>This cannot be undone.</b>',
    async () => {
      showPopup('loading', 'Deleting...');
      await supabase.from('vehicle_documents').delete().eq('file_name', fileRow.file_name).eq('document_type', type);
      await supabase.storage.from('vehicle-documents').remove([fileRow.file_name]);
      previewEl.innerHTML = '<span class="doc-empty-state"><i class="fas fa-cloud-arrow-up"></i><strong>No document uploaded</strong><small>Upload once to store this file in the vault.</small></span>';
      uploadBtn.style.display = 'inline-flex';
      uploadBtn.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Upload document';
      deleteBtn.style.display = 'none';
      updatePopup('success', 'Deleted!');
    },
    // The document type names what is going, so the heading can say it rather
    // than asking "are you sure" about an unnamed thing.
    { title: `Delete your ${type}?`, icon: 'fa-file-circle-xmark' }
  );
}

// Helper function to show upload badge
function showUploadedBadge(previewEl) {
  const badge = document.createElement('div');
  badge.className = 'uploaded-badge';
  badge.textContent = 'Uploaded';
  const parent = previewEl.parentElement;
  parent.style.position = 'relative';
  parent.appendChild(badge);
  setTimeout(() => badge.remove(), 3000);
}

async function getLatestVehicleDoc(type) {
  const { data } = await supabase
    .from('vehicle_documents')
    .select('*')
    .eq('document_type', type)
    .order('upload_date', { ascending: false })
    .limit(1);
  return data && data.length ? data[0] : null;
}

// The main initializer for docs section. Fast path: one DB query for all vehicle docs, no signed URLs until View is tapped.
// Kept so a refresh can re-render the fixed cards without re-wiring them.
let docsFixedCards = [];

async function initDocsUpload() {
  if (spinlogLazyState.docsSetup) return;
  spinlogLazyState.docsSetup = true;

  const cards = VEHICLE_TYPES.map(type => {
    const card = document.querySelector(`.doc-card[data-type="${type}"]`);
    if (!card) return null;
    return {
      type,
      card,
      fileInput: card.querySelector('input[type="file"]'),
      uploadBtn: card.querySelector('.upload-btn'),
      previewEl: card.querySelector('.doc-preview'),
      headerDeleteBtn: card.querySelector('.doc-delete-btn')
    };
  }).filter(Boolean);

  cards.forEach(wireDocCard);
  docsFixedCards = cards;

  // Last visit's custom cards go up with the fixed four, so the grid does not
  // visibly grow a moment later when the vault query lands.
  primeCustomDocCards();

  await loadVehicleDocsFast(cards);
}

/** Wire one document card's upload / delete behaviour. */
function wireDocCard({ type, fileInput, uploadBtn, previewEl, headerDeleteBtn }) {
  {
    uploadBtn?.addEventListener('click', () => fileInput.click());

    if (headerDeleteBtn) {
      headerDeleteBtn.addEventListener('click', function() {
        getCurrentFileForDelete(type, headerDeleteBtn, previewEl, uploadBtn);
      });
    }

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;

      const clean = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const fileName = `${Date.now()}-${clean}`;
      const bucket = 'vehicle-documents';
      const contentType = file.type || 'application/octet-stream';
      const current = await getLatestVehicleDoc(type);
      if (current?.file_name) {
        showPopup('error', 'Delete the existing document before uploading a new one.');
        fileInput.value = '';
        return;
      }

      startUploadPercent();

      const { error: uploadErr } = await supabase.storage.from(bucket).upload(fileName, file, {
        contentType,
        cacheControl: '3600',
        upsert: false
      });

      if (uploadErr) {
        updatePopup('error', 'Upload failed');
        return;
      }

      const { error } = await supabase.from('vehicle_documents').insert([{
        file_name: fileName,
        original_name: file.name,
        document_type: type,
        file_size: file.size,
        content_type: contentType,
        upload_date: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }]);

      if (error) {
        updatePopup('error', 'DB error');
        await supabase.storage.from(bucket).remove([fileName]);
        return;
      }

      updatePopup('success', 'Uploaded!');
      renderVehicleDocPreview(previewEl, type, fileName, file.name, uploadBtn);
      showUploadedBadge(previewEl);
      fileInput.value = '';
    });
  }
}

/**
 * Build a card for a user-added document type and wire it like the fixed ones.
 * Returns the same descriptor shape loadVehicleDocsFast() expects.
 */
function createCustomDocCard(type, notes) {
  const grid = document.querySelector('.vehicle-docs-grid');
  if (!grid) return null;

  const existing = grid.querySelector(`.doc-card[data-type="${CSS.escape(type)}"]`);
  if (existing) return null;

  const card = document.createElement('div');
  card.className = 'doc-card is-custom';
  card.dataset.type = type;
  card.innerHTML = `
    <div class="doc-card-top">
      <div class="doc-icon"><i class="fas fa-file-lines"></i></div>
      <button class="doc-delete-btn" title="Delete ${docsEscapeAttr(type)}" aria-label="Delete ${docsEscapeAttr(type)}">
        <i class="fas fa-trash"></i>
      </button>
    </div>
    <h4>${docsEscapeHtml(type)}</h4>
    ${notes ? `<span class="doc-note">${docsEscapeHtml(notes)}</span>` : '<p>Added by you.</p>'}
    <span class="doc-status-chip">Custom</span>
    <input type="file" accept="image/*,.pdf" hidden />
    <button class="upload-btn angled-btn" type="button"><i class="fas fa-cloud-arrow-up"></i> Upload Document</button>
    <div class="doc-preview"></div>`;

  // keep the add tile last
  const tile = document.getElementById('docAddTile');
  if (tile) grid.insertBefore(card, tile); else grid.appendChild(card);

  const descriptor = {
    type,
    card,
    fileInput: card.querySelector('input[type="file"]'),
    uploadBtn: card.querySelector('.upload-btn'),
    previewEl: card.querySelector('.doc-preview'),
    headerDeleteBtn: card.querySelector('.doc-delete-btn'),
  };
  wireDocCard(descriptor);
  return descriptor;
}

/* ── Add-a-document flow ───────────────────────────────────────────────── */

function setupDocAddFlow() {
  const tile = document.getElementById('docAddTile');
  const modal = document.getElementById('docAddModal');
  const nameEl = document.getElementById('docAddName');
  const notesEl = document.getElementById('docAddNotes');
  const pickBtn = document.getElementById('docAddPick');
  const fileEl = document.getElementById('docAddFile');
  const fileName = document.getElementById('docAddFileName');
  const hint = document.getElementById('docAddHint');
  const saveBtn = document.getElementById('docAddSave');
  if (!tile || !modal || !nameEl || !fileEl) return;

  const RESERVED = new Set(VEHICLE_TYPES.map(t => t.toLowerCase()));

  function setHint(msg, bad) {
    if (!hint) return;
    hint.textContent = msg;
    hint.classList.toggle('is-bad', !!bad);
  }

  function close() {
    modal.classList.remove('sl-modal--open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function open() {
    nameEl.value = '';
    if (notesEl) notesEl.value = '';
    fileEl.value = '';
    if (fileName) fileName.textContent = 'Choose a file…';
    pickBtn?.classList.remove('has-file');
    setHint('Give it a short name so you can find it later.', false);
    modal.classList.add('sl-modal--open');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => nameEl.focus({ preventScroll: true }), 60);
  }

  tile.addEventListener('click', open);
  document.getElementById('docAddClose')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('sl-modal--open')) close();
  });

  pickBtn?.addEventListener('click', () => fileEl.click());
  fileEl.addEventListener('change', () => {
    const f = fileEl.files[0];
    if (fileName) fileName.textContent = f ? f.name : 'Choose a file…';
    pickBtn?.classList.toggle('has-file', !!f);
  });

  saveBtn?.addEventListener('click', async () => {
    const type = nameEl.value.trim().replace(/\s+/g, ' ');
    const file = fileEl.files[0];

    if (!type) { setHint('Name the document first.', true); nameEl.focus(); return; }
    if (RESERVED.has(type.toLowerCase())) {
      setHint(`"${type}" already has its own card above.`, true); return;
    }
    if (document.querySelector(`.doc-card[data-type="${CSS.escape(type)}"]`)) {
      setHint(`You already have a document called "${type}".`, true); return;
    }
    if (!file) { setHint('Pick a file to upload.', true); return; }
    if (typeof validateFileUpload === 'function' && !validateFileUpload(file)) return;

    const clean = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const storedName = `${Date.now()}-${clean}`;
    const contentType = file.type || 'application/octet-stream';

    close();
    startUploadPercent();

    const { error: uploadErr } = await supabase.storage
      .from('vehicle-documents')
      .upload(storedName, file, { contentType, cacheControl: '3600', upsert: false });
    if (uploadErr) { updatePopup('error', 'Upload failed'); return; }

    const notes = (notesEl?.value || '').trim();
    const row = {
      file_name: storedName,
      original_name: file.name,
      document_type: type,
      file_size: file.size,
      content_type: contentType,
      upload_date: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Older deployments of this table have no notes column. Try with notes,
    // and fall back to the bare row rather than failing the whole upload.
    let { error } = await supabase.from('vehicle_documents').insert([{ ...row, notes }]);
    if (error && /notes/i.test(error.message || '')) {
      console.warn('[SpinLog] vehicle_documents has no notes column; saving without it.');
      ({ error } = await supabase.from('vehicle_documents').insert([row]));
    }
    if (error) {
      updatePopup('error', 'DB error');
      await supabase.storage.from('vehicle-documents').remove([storedName]);
      return;
    }

    const descriptor = createCustomDocCard(type, notes);
    if (descriptor) {
      renderVehicleDocPreview(descriptor.previewEl, type, storedName, file.name, descriptor.uploadBtn);
      showUploadedBadge(descriptor.previewEl);
    }
    updatePopup('success', 'Document added!');
    if (window.triggerRecordSavedNotif) window.triggerRecordSavedNotif();
  });
}

/* Guards against two overlapping refreshes finishing out of order and leaving
   the grid showing the older result. Same pattern as serviceRenderRun. */
let docsRenderRun = 0;

async function loadVehicleDocsFast(cards) {
  if (!cards?.length) return;
  const renderId = ++docsRenderRun;
  // No document_type filter: user-added documents are exactly the rows whose
  // type is not one of the fixed four, and we need them to rebuild their cards.
  // notes is optional in older schemas, so ask for it and retry without.
  let { data, error } = await supabase
    .from('vehicle_documents')
    .select('file_name,original_name,document_type,upload_date,notes')
    .order('upload_date', { ascending: false });
  if (error && /notes/i.test(error.message || '')) {
    ({ data, error } = await supabase
      .from('vehicle_documents')
      .select('file_name,original_name,document_type,upload_date')
      .order('upload_date', { ascending: false }));
  }

  if (renderId !== docsRenderRun) return;

  const latestByType = new Map();
  if (!error && data) {
    for (const row of data) {
      if (!latestByType.has(row.document_type)) latestByType.set(row.document_type, row);
    }
  }

  const known = new Set(VEHICLE_TYPES);

  // Remember which custom documents exist, so the next load can paint them
  // immediately instead of waiting on this query. Only written on a clean read —
  // caching the result of a failed query would erase the list.
  if (!error) {
    writeCustomDocCache(
      Array.from(latestByType.entries())
        .filter(([type]) => !known.has(type))
        .map(([type, row]) => ({ type, notes: row?.notes || '' }))
    );
  }

  /* Drop custom cards the vault no longer has a row for. createCustomDocCard()
     only ever added, so a deleted custom document kept its card until a full
     reload — and since the section keeps its DOM while hidden, that stale card
     was still there on the next visit. Skipped when the query failed, so a
     network blip never wipes the grid. */
  if (!error) {
    document.querySelectorAll('.vehicle-docs-grid .doc-card.is-custom').forEach((card) => {
      const type = card.dataset.type;
      if (type && !latestByType.has(type)) card.remove();
    });
  }

  // rebuild a card for every custom type found in the data
  const all = cards.filter(({ card }) => card.isConnected);
  for (const type of latestByType.keys()) {
    if (known.has(type)) continue;
    const descriptor = createCustomDocCard(type, latestByType.get(type)?.notes);
    // already on the page from a previous load — reuse its nodes
    all.push(descriptor || describeExistingDocCard(type));
  }

  all.filter(Boolean).forEach(({ type, previewEl, uploadBtn, headerDeleteBtn }) => {
    const row = latestByType.get(type);
    if (row) {
      renderVehicleDocPreview(previewEl, type, row.file_name, row.original_name, uploadBtn);
    } else {
      previewEl.innerHTML = '';
      uploadBtn.style.display = 'inline-flex';
      uploadBtn.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Upload document';
      if (headerDeleteBtn) headerDeleteBtn.style.display = 'none';
    }
  });

  // the static markup's Upload/Delete buttons were hidden until now
  document.querySelector('.vehicle-docs-grid')?.classList.remove('is-loading');
}

/**
 * Descriptor for a custom card that is already in the DOM (wired on a previous
 * load), so a refresh can re-render it without duplicating listeners.
 */
function describeExistingDocCard(type) {
  const card = document.querySelector(`.vehicle-docs-grid .doc-card[data-type="${CSS.escape(type)}"]`);
  if (!card) return null;
  return {
    type,
    card,
    fileInput: card.querySelector('input[type="file"]'),
    uploadBtn: card.querySelector('.upload-btn'),
    previewEl: card.querySelector('.doc-preview'),
    headerDeleteBtn: card.querySelector('.doc-delete-btn'),
  };
}

async function ensureDocsLoaded() {
  if (!spinlogLazyState.docsLoaded) {
    spinlogLazyState.docsLoaded = true;
    setupDocAddFlow();
    /* The grid's first paint comes from static HTML, before the vault query
       resolves, so every card would briefly show "Upload Document" and a delete
       button — including cards whose document is already stored. Hide those
       controls behind a skeleton until the data lands. */
    document.querySelector('.vehicle-docs-grid')?.classList.add('is-loading');
    await initDocsUpload();
    await loadHistoricUploads();
    return;
  }

  /* Every later visit. #docs keeps its DOM while hidden (section { display:none }
     with a fadeIn on .active), so without this you are looking at whatever was
     rendered last time and it never self-corrects — that is the "old entry
     appears for a split second" ghost. */
  await Promise.all([
    loadVehicleDocsFast(docsFixedCards),
    loadHistoricUploads(),
  ]);
}

// --- HISTORIC MEDIA LOGIC ---

async function updateHistoricNotes(id, notes) {
  // Notes are supported in newer schemas. If the notes column/update policy is not present, keep them locally.
  let { error } = await supabase
    .from('media_files')
    .update({ notes })
    .eq('id', id);

  if (error) {
    console.warn('Historic notes DB update skipped:', error);
    setHistoricLocalNote(id, notes);
    return false;
  }
  setHistoricLocalNote(id, notes);
  return true;
}

// Helper: get signed URL for historic-media bucket
async function handleHistoricUpload(file, type, dropZone) {
  const notes = await showHistoricNotesModal({
    title: 'Add notes for this upload',
    help: 'Notes are required for Historic Audio & Images uploads.',
    initial: '',
    required: true,
    // The File itself goes over, so she describes what is actually in it rather
    // than guessing from the name.
    context: {
      file,
      fileName: file.name,
      mediaType: type,
      sizeBytes: file.size,
      uploadedOn: localIsoDate(),
    }
  });
  if (!notes) {
    const input = dropZone?.querySelector('input[type="file"]');
    if (input) input.value = '';
    return;
  }

  const bucket = 'historic-media';
  const clean = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const fileName = `${Date.now()}-${clean}`;
  const ext = file.name.split('.').pop().toLowerCase();
  let contentType = file.type || 'application/octet-stream';
  if (ext === 'mp4') contentType = 'video/mp4';
  if (ext === 'mov') contentType = 'video/quicktime';
  if (ext === 'avi') contentType = 'video/x-msvideo';
  if (ext === 'webm') contentType = 'video/webm';

  startUploadPercent();

  const { error: uploadErr } = await supabase.storage.from(bucket).upload(fileName, file, {
    contentType,
    cacheControl: '3600',
    upsert: false
  });

  if (uploadErr) {
    errorUploadPercent();
    updatePopup('error', 'Upload failed: ' + uploadErr.message);
    return;
  }

  const row = {
    media_type: type,
    file_name: fileName,
    original_name: file.name,
    file_size: file.size,
    content_type: contentType,
    upload_date: new Date().toISOString(),
    notes
  };

  let inserted = null;
  let { data, error } = await supabase.from('media_files').insert([row]).select();
  if (error && String(error.message || '').toLowerCase().includes('notes')) {
    const fallback = { ...row };
    delete fallback.notes;
    const retry = await supabase.from('media_files').insert([fallback]).select();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    errorUploadPercent();
    updatePopup('error', 'DB error: ' + error.message);
    await supabase.storage.from(bucket).remove([fileName]);
    return;
  }

  inserted = data && data[0];
  if (inserted?.id) setHistoricLocalNote(inserted.id, notes);
  finishUploadPercent();
  updatePopup('success', 'Uploaded with notes!');
  const input = dropZone?.querySelector('input[type="file"]');
  if (input) input.value = '';
  loadHistoricUploads();
}

// Setup drag/drop and file pickers for all drop-zones
function setupHistoricDropzones() {
  document.querySelectorAll('.drop-zone').forEach(dropZone => {
    const input = dropZone.querySelector('input[type="file"]');
    const type = dropZone.dataset.type;

    dropZone.addEventListener('click', () => input.click());

    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      handleHistoricUpload(file, type, dropZone);
    });

    dropZone.addEventListener('dragover', e => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', e => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (!file) return;
      handleHistoricUpload(file, type, dropZone);
    });
  });
}

// Helper: get signed URL for historic-media bucket files
async function getHistoricMediaUrl(fileName) {
  const { data, error } = await supabase
    .storage
    .from('historic-media')
    .createSignedUrl(fileName, 60 * 60);
  if (error || !data) return null;
  return data.signedUrl;
}
// Exposed so Sage's autofill can fetch a stored upload and actually look at it
// when re-writing its notes from Record History. Read-only, and the signed URL
// it returns expires in an hour.
window.dkGetHistoricMediaUrl = getHistoricMediaUrl;

window._historicMediaRows = new Map();
const spinlogLazyState = { docsSetup: false, docsLoaded: false, serviceLoaded: false };


function buildHistoricPreview(row) {
  const icon = docsIconForType(row.media_type, row.original_name);
  const label = row.media_type === 'audio' || row.media_type === 'video' ? 'Play' : row.media_type === 'image' ? 'View' : 'Open';
  return `<button class="docs-preview-pill media-preview-btn" type="button" onclick="window._previewHistoricUpload && window._previewHistoricUpload(${row.id})"><i class="fas ${icon}"></i> ${label}</button>`;
}

window._previewHistoricUpload = async function(id) {
  const row = window._historicMediaRows?.get(Number(id));
  if (!row) {
    updatePopup('error', 'Could not find this upload. Refresh and try again.');
    return;
  }
  showPopup('loading', 'Opening preview...');
  const url = await getHistoricMediaUrl(row.file_name);
  hidePopup();
  if (!url) {
    updatePopup('error', 'Could not create preview link.');
    return;
  }
  if (row.media_type === 'audio') return window._showAudioPreview && window._showAudioPreview(url, row.original_name);
  if (row.media_type === 'video') return window._showVideoPreview && window._showVideoPreview(url, row.original_name);
  if (row.media_type === 'image') return window._showImagePreview && window._showImagePreview(url);
  window.open(url, '_blank', 'noopener');
};

// Load all media uploads and render table. Fast path: do NOT create signed URLs during list load.
async function fetchHistoricRowsForList() {
  // Some existing Supabase tables do not have a notes column yet. Try notes first, then fall back cleanly.
  const baseCols = 'id,media_type,file_name,original_name,file_size,content_type,upload_date';
  let result = await supabase
    .from('media_files')
    .select(baseCols + ',notes')
    .order('upload_date', { ascending: false });

  if (result.error && String(result.error.message || '').toLowerCase().includes('notes')) {
    result = await supabase
      .from('media_files')
      .select(baseCols)
      .order('upload_date', { ascending: false });
  }
  return result;
}

// Load all media uploads and render table. Fast path: do NOT create signed URLs during list load.
async function loadHistoricUploads() {
  const table = document.querySelector('#mediaRecordTable tbody');
  if (!table) return;
  table.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#777;">Loading...</td></tr>';

  const { data, error } = await fetchHistoricRowsForList();

  if (error || !data) {
    console.warn('Historic uploads load failed:', error);
    table.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#b44;">Could not load uploads${error?.message ? ': ' + docsEscapeHtml(error.message) : ''}</td></tr>`;
    return;
  }
  if (!data.length) {
    window._historicMediaRows = new Map();
    table.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#777;">No uploads yet</td></tr>';
    return;
  }

  window._historicMediaRows = new Map(data.map(row => [Number(row.id), row]));
  table.innerHTML = '';
  const fragment = document.createDocumentFragment();
  for (const row of data) {
    const notes = row.notes || getHistoricLocalNote(row.id) || 'No notes saved';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="File">
        <div class="docs-file-cell">
          <span class="docs-file-icon"><i class="fas ${docsIconForType(row.media_type, row.original_name)}"></i></span>
          <span class="docs-file-meta">
            <strong title="${docsEscapeAttr(row.original_name)}">${docsEscapeHtml(row.original_name)}</strong>
            <span>${docsEscapeHtml(row.media_type)} · ${docsFormatBytes(row.file_size)}</span>
          </span>
        </div>
      </td>
      <td data-label="Notes"><div class="docs-notes-cell">${docsEscapeHtml(notes)}</div></td>
      <td data-label="Preview">${buildHistoricPreview(row)}</td>
      <td data-label="Uploaded">
        <div class="docs-date-cell">
          <span>${docsFormatDate(getHistoricLocalDate(row.id) || row.upload_date)}</span>
          <button class="docs-date-edit-btn" type="button" title="Edit uploaded date" aria-label="Edit uploaded date" onclick="window._editHistoricDate && window._editHistoricDate(${row.id}, '${docsEscapeAttr(getHistoricLocalDate(row.id) || row.upload_date || '')}', this)"><i class="fas fa-pen"></i></button>
        </div>
      </td>
      <td data-label="Action">
        <div class="docs-action-stack">
          <button class="docs-mini-btn" type="button" onclick="window._editHistoricNotes && window._editHistoricNotes(${row.id}, this)"><i class="fas fa-pen"></i> Notes</button>
          <button class="docs-action-btn delete-btn" type="button" title="Delete" onclick="window._delHistoricUpload && window._delHistoricUpload(${row.id}, '${docsEscapeAttr(row.file_name)}', this)"><i class="fas fa-xmark"></i> Delete</button>
        </div>
      </td>`;
    fragment.appendChild(tr);
  }
  table.appendChild(fragment);
}

window._editHistoricNotes = async function(id, btn) {
  const rowEl = btn.closest('tr');
  const current = rowEl?.querySelector('.docs-notes-cell')?.textContent?.trim() || getHistoricLocalNote(id) || '';
  // The stored row is what tells Sage which file this note belongs to.
  const row = window._historicMediaRows?.get(Number(id)) || null;
  const notes = await showHistoricNotesModal({
    title: 'Edit upload notes',
    help: 'Update the context for this historic upload.',
    initial: current === 'No notes saved' ? '' : current,
    required: true,
    // storageName lets her pull the file back out of the vault and look at it;
    // sizeBytes lets her skip that when it is too big to send.
    context: row ? {
      storageName: row.file_name,
      fileName: row.original_name,
      mediaType: row.media_type,
      sizeBytes: row.file_size,
      uploadedOn: String(getHistoricLocalDate(id) || row.upload_date || '').slice(0, 10),
    } : null
  });
  if (!notes) return;
  showPopup('loading', 'Saving notes...');
  await updateHistoricNotes(id, notes);
  updatePopup('success', 'Notes updated!');
  loadHistoricUploads();
};

async function persistHistoricDateToDatabase(id, selectedDate) {
  const nextIso = `${selectedDate}T12:00:00.000Z`;
  const payload = { upload_date: nextIso };

  const { data, error } = await supabase
    .from('media_files')
    .update(payload)
    .eq('id', id)
    .select('id,upload_date')
    .single();

  if (error) {
    console.warn('Historic date DB update failed:', error);
    return { ok: false, id, value: nextIso, error };
  }

  if (!data || !data.upload_date) {
    return { ok: false, id, value: nextIso, error: { message: 'No updated row returned. Check UPDATE RLS policy.' } };
  }

  return { ok: true, id: data.id || id, value: data.upload_date, mode: 'update' };
}

window._editHistoricDate = function(id, currentDate, btn) {
  const currentIso = currentDate ? String(currentDate).slice(0, 10) : localIsoDate();
  const popup = document.getElementById('customPopup');
  const spinner = document.getElementById('popupSpinner');
  const success = document.getElementById('popupSuccess');
  const errorIcon = document.getElementById('popupError');
  const messageEl = document.getElementById('popupMessage');
  if (!popup || !messageEl) return;

  popup.classList.add('docs-date-popup');
  if (spinner) spinner.style.display = 'none';
  if (success) success.style.display = 'none';
  if (errorIcon) errorIcon.style.display = 'none';

  messageEl.innerHTML = `
    <div class="docs-inline-editor docs-date-editor-box">
      <strong><i class="fas fa-pen"></i> Edit uploaded date</strong>
      <p>Pick the correct date for this historic record.</p>
      <label class="docs-date-editor-field" for="historicDateEditor">
        <i class="fas fa-calendar-days"></i>
        <input id="historicDateEditor" type="date" value="${docsEscapeAttr(currentIso)}" />
      </label>
      <div class="docs-inline-editor-actions">
        <button type="button" id="historicDateCancel" class="docs-secondary-btn"><i class="fas fa-xmark"></i> Cancel</button>
        <button type="button" id="historicDateSave" class="docs-primary-btn"><i class="fas fa-check"></i> Save</button>
      </div>
    </div>
  `;
  popup.classList.add('show');
  popup.onclick = function(e) {
    if (e.target === popup) {
      popup.classList.remove('docs-date-popup');
      hidePopup();
    }
  };
  messageEl.onclick = e => e.stopPropagation();

  requestAnimationFrame(() => {
    const input = document.getElementById('historicDateEditor');
    const cancel = document.getElementById('historicDateCancel');
    const save = document.getElementById('historicDateSave');
    cancel?.addEventListener('click', () => {
      popup.classList.remove('docs-date-popup');
      hidePopup();
    });
    input?.addEventListener('click', () => {
      if (typeof input.showPicker === 'function') input.showPicker();
    });
    save?.addEventListener('click', async () => {
      const selected = input?.value;
      if (!selected) {
        input?.focus();
        input?.classList.add('field-error');
        return;
      }
      const nextIso = `${selected}T12:00:00.000Z`;
      save.disabled = true;
      save.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Saving';
      const result = await persistHistoricDateToDatabase(id, selected);
      popup.classList.remove('docs-date-popup');
      if (result.ok) {
        setHistoricLocalDate(result.id, result.value);
        updatePopup('success', 'Date updated in database!');
      } else {
        updatePopup('error', 'Date saved only on this device. Add an UPDATE policy for media_files to sync it to Supabase.');
      }
      await loadHistoricUploads();
    });
    input?.focus();
  });
};

// Delete handler: attach to window so inline HTML can call it
window._delHistoricUpload = async function(id, fileName, btn) {
  confirmDeleteWithHold(
    `“${docsEscapeHtml(fileName)}” goes from storage, and its note and date with it.`
    + '<br><b>This cannot be undone.</b>',
    async () => {
      showPopup('loading', 'Deleting...');
      const { error: dbError } = await supabase.from('media_files').delete().eq('id', id);
      if (dbError) {
        updatePopup('error', 'DB delete failed: ' + dbError.message);
        return;
      }
      const { error: storageError } = await supabase.storage.from('historic-media').remove([fileName]);
      if (storageError) {
        updatePopup('error', 'File delete failed: ' + storageError.message);
        return;
      }
      // Nothing to clean up in the database: the note and the date are columns on
      // the row that was just deleted, so they went with it. This only drops the
      // local copy so the table does not redraw them.
      cloudStore()?.forgetUpload(id);
      btn.closest('tr')?.remove();
      updatePopup('success', 'Deleted!');
      setTimeout(() => { hidePopup(); }, 1200);
    },
    { title: 'Delete this upload?', icon: 'fa-file-circle-xmark' }
  );
};



// Audio preview popup
window._showAudioPreview = function(url, name) {
  const modal = document.getElementById('audioPreviewModal');
  const player = document.getElementById('fullPreviewAudio');
  player.src = url;
  player.setAttribute('aria-label', 'Audio: ' + (name || ''));
  modal.style.display = 'flex';
  player.focus();
  modal.onclick = function(e) {
    // Only close if click outside player
    if (e.target === modal) {
      modal.style.display = 'none';
      player.pause();
      player.src = '';
    }
  }
  document.onkeydown = function(e) {
    if (e.key === 'Escape') {
      modal.style.display = 'none';
      player.pause();
      player.src = '';
    }
  }
}

// Video preview popup
window._showVideoPreview = function(url, name) {
  const modal = document.getElementById('videoPreviewModal');
  const player = document.getElementById('fullPreviewVideo');
  player.src = url;
  player.setAttribute('aria-label', 'Video: ' + (name || ''));
  modal.style.display = 'flex';
  player.play();
  player.focus();
  modal.onclick = function(e) {
    if (e.target === modal) {
      modal.style.display = 'none';
      player.pause();
      player.src = '';
    }
  }
  document.onkeydown = function(e) {
    if (e.key === 'Escape') {
      modal.style.display = 'none';
      player.pause();
      player.src = '';
    }
  }
}

// Image preview (reuse your existing logic)
window._showImagePreview = function(url) {
  const modal = document.getElementById('imagePreviewModal');
  const img = document.getElementById('fullPreviewImg');
  img.src = url;
  modal.style.display = 'flex';
  img.focus();
  modal.onclick = function(e) {
    if (e.target === modal) {
      modal.style.display = 'none';
      img.src = '';
    }
  }
  document.onkeydown = function(e) {
    if (e.key === 'Escape') {
      modal.style.display = 'none';
      img.src = '';
    }
  }
}

  // Navigation
  const navButtons = document.querySelectorAll('.desktop-nav li button, .mobile-nav-list li button');
  const navItems = document.querySelectorAll('.desktop-nav li, .mobile-nav-list li');
  const sections = document.querySelectorAll('main section');
  const mobileToggle = document.getElementById('mobileToggle');
  const mobileMenu = document.getElementById('mobileMenu');
  const mobileOverlay = document.getElementById('mobileOverlay');

  // ── Which page you were on, remembered across refreshes ──────────────
  const SECTION_KEY = 'spinlogActiveSection';

  /** Only accept a name that is actually a section in this document. */
  function isKnownSection(name) {
    return !!name && !!document.getElementById(name)
      && document.getElementById(name).matches('main section');
  }

  function rememberSection(section) {
    try { localStorage.setItem(SECTION_KEY, section); } catch { /* private mode */ }
    // Best effort only. On a file:// origin some browsers refuse replaceState,
    // and localStorage above is the part that actually has to work.
    try { history.replaceState(null, '', `#${section}`); } catch { /* ignore */ }
  }

  function setActiveSection(section) {
    if (!isKnownSection(section)) return;
    navItems.forEach(nav => nav.classList.remove('active'));
    navButtons.forEach(btn => btn.removeAttribute('aria-current'));
    document.querySelectorAll(`[data-section="${section}"]`).forEach(nav => {
      nav.classList.add('active');
      const btn = nav.querySelector('button');
      if (btn) btn.setAttribute('aria-current', 'page');
    });
    sections.forEach(sec => sec.classList.remove('active'));
    document.getElementById(section).classList.add('active');
    // Instant, not smooth: animating a long scroll while the incoming section
    // is doing its first layout is what made navigation feel sluggish.
    window.scrollTo({ top: 0, behavior: 'auto' });
    // The backdrop stays on screen everywhere, but it only needs to ANIMATE on
    // home. Off home it is a static image behind a long scrolling list, and a
    // full-viewport shader redrawing per frame is pure scroll cost.
    window.SpinLog3D?.setAnimating?.(section === 'home');
    closeMobileMenu();
    ensureSectionData(section);
    rememberSection(section);
  }
  // Exposed so the v1.7 command-center search can navigate between sections.
  window.dkNavigate = setActiveSection;
  navButtons.forEach(button => {
    button.addEventListener('click', e => {
      e.preventDefault();
      setActiveSection(button.closest('li').dataset.section);
    });
    button.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setActiveSection(button.closest('li').dataset.section);
      }
    });
  });

  document.querySelectorAll('[data-home-section]').forEach(button => {
    button.addEventListener('click', () => {
      const target = button.getAttribute('data-home-section');
      if (target && document.getElementById(target)) setActiveSection(target);
    });
  });
  function openMobileMenu() {
    if (!mobileToggle || !mobileMenu || !mobileOverlay) return;
    mobileToggle.classList.add('active');
    mobileToggle.setAttribute('aria-expanded', 'true');
    mobileMenu.classList.add('show');
    mobileOverlay.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  function closeMobileMenu() {
    if (!mobileToggle || !mobileMenu || !mobileOverlay) return;
    mobileToggle.classList.remove('active');
    mobileToggle.setAttribute('aria-expanded', 'false');
    mobileMenu.classList.remove('show');
    mobileOverlay.classList.remove('show');
    document.body.style.overflow = '';
  }
  if (mobileToggle && mobileMenu) {
    mobileToggle.addEventListener('click', e => {
      e.preventDefault();
      mobileMenu.classList.contains('show') ? closeMobileMenu() : openMobileMenu();
    });
  }
  if (mobileOverlay) {
    mobileOverlay.addEventListener('click', e => {
      e.preventDefault();
      closeMobileMenu();
    });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && mobileMenu && mobileMenu.classList.contains('show')) {
      closeMobileMenu();
    }
  });

  function formatDateUIValue(value) {
    if (!value) return '';
    const parsed = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }).replace(',', '');
  }

  function updateDateUI(input) {
    if (!input) return;
    const shell = input.closest('.date-shell');
    const display = shell?.querySelector('.date-display');
    const hasValue = Boolean(input.value);
    if (display) {
      display.textContent = hasValue ? formatDateUIValue(input.value) : (input.dataset.emptyLabel || 'Select date');
    }
    shell?.classList.toggle('has-date', hasValue);
  }

  function refreshDateUIs(scope = document) {
    scope.querySelectorAll?.('input[type="date"][data-date-ui]').forEach(updateDateUI);
  }

  function setupDateUI() {
    function openDatePicker(input) {
      if (!input) return;
      try {
        input.focus({ preventScroll: true });
      } catch (_) {
        input.focus();
      }
      if (typeof input.showPicker === 'function') {
        try {
          input.showPicker();
          return;
        } catch (_) {
          // Fall back to a programmatic click when showPicker is blocked or unavailable.
        }
      }
      try { input.click(); } catch (_) {}
    }

    document.querySelectorAll('input[type="date"][data-date-ui]').forEach(input => {
      if (input.dataset.dateUiReady === 'true') return;
      input.dataset.dateUiReady = 'true';
      updateDateUI(input);

      input.addEventListener('input', () => updateDateUI(input));
      input.addEventListener('change', () => updateDateUI(input));
      input.addEventListener('blur', () => updateDateUI(input));
      input.addEventListener('click', event => {
        // Let the transparent native date input receive the real user click.
        // This keeps iOS/Android/desktop pickers reliable and avoids the custom shell cancelling the picker.
        event.stopPropagation();
      });
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openDatePicker(input);
        }
      });

      const shell = input.closest('.date-shell');
      shell?.setAttribute('tabindex', '0');
      shell?.setAttribute('role', 'button');
      shell?.addEventListener('click', event => {
        if (event.target === input) return;
        event.preventDefault();
        openDatePicker(input);
      });
      shell?.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openDatePicker(input);
        }
      });
    });

    document.querySelectorAll('form').forEach(form => {
      if (form.dataset.dateUiResetReady === 'true') return;
      form.dataset.dateUiResetReady = 'true';
      form.addEventListener('reset', () => {
        window.setTimeout(() => refreshDateUIs(form), 0);
      });
    });
  }

  function getServiceEntryTypeControls() {
    return {
      input: document.getElementById('serviceType'),
      wrapper: document.querySelector('[data-service-entry-type]'),
      button: document.getElementById('serviceTypeButton'),
      value: document.getElementById('serviceTypeValue'),
      menu: document.getElementById('serviceTypeMenu')
    };
  }

  function syncServiceEntryTypeDropdown(value = '') {
    const controls = getServiceEntryTypeControls();
    const label = value || 'Select service type';
    if (controls.value) controls.value.textContent = label;
    controls.wrapper?.classList.toggle('has-value', Boolean(value));
    controls.menu?.querySelectorAll('.entry-select-option').forEach(option => {
      const selected = (option.dataset.value || '') === value;
      option.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  function closeServiceEntryTypeDropdown() {
    const controls = getServiceEntryTypeControls();
    controls.wrapper?.classList.remove('is-open');
    controls.button?.setAttribute('aria-expanded', 'false');
  }

  function setupServiceEntryTypeDropdown() {
    const controls = getServiceEntryTypeControls();
    if (!controls.input || controls.input.dataset.entryTypeReady === 'true') return;
    controls.input.dataset.entryTypeReady = 'true';

    controls.button?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const isOpen = controls.wrapper?.classList.toggle('is-open');
      controls.button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    controls.menu?.querySelectorAll('.entry-select-option').forEach(option => {
      option.addEventListener('click', event => {
        event.preventDefault();
        const value = option.dataset.value || '';
        controls.input.value = value;
        syncServiceEntryTypeDropdown(value);
        closeServiceEntryTypeDropdown();
        controls.input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });

    document.addEventListener('click', event => {
      if (controls.wrapper && !controls.wrapper.contains(event.target)) closeServiceEntryTypeDropdown();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeServiceEntryTypeDropdown();
    });

    controls.input.closest('form')?.addEventListener('reset', () => {
      window.setTimeout(() => {
        controls.input.value = '';
        syncServiceEntryTypeDropdown('');
        closeServiceEntryTypeDropdown();
        controls.input.dispatchEvent(new Event('change', { bubbles: true }));
      }, 0);
    });

    syncServiceEntryTypeDropdown(controls.input.value || '');
  }

  // ── Cover badge helper (shared, reused by cover-date editor) ──────────
  function updateCoverBadge(el) {
    const due = el.getAttribute('data-due');
    if (!due) return;
    const [y, m, d] = due.split('-').map(Number);
    const dueDate = new Date(y, m - 1, d, 23, 59, 59);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.ceil((dueDate - today) / 86400000);
    const formatted = due.split('-').reverse().join('-');
    el.classList.remove('expired', 'expiring');

    // Two-part output matching the .dk-cover-status contract in home.css:
    // a coloured state pill plus the plain date underneath.
    let state, icon, note;
    if (diff < 0) {
      el.classList.add('expired');
      state = 'Expired';
      icon = 'fa-circle-exclamation';
      note = 'Lapsed on ' + formatted;
    } else if (diff <= 30) {
      el.classList.add('expiring');
      state = `${diff} day${diff === 1 ? '' : 's'} left`;
      icon = 'fa-triangle-exclamation';
      note = 'Renew by ' + formatted;
    } else {
      state = 'Active';
      icon = 'fa-circle-check';
      note = 'Valid till ' + formatted;
    }

    el.innerHTML =
      `<b class="dk-cover-state"><i class="fas ${icon}" aria-hidden="true"></i>${state}</b>` +
      `<small>${note}</small>`;
  }
  window.updateCoverBadge = updateCoverBadge;
  setupCoverDateEditing();
  document.querySelectorAll('.dk-cover-status[data-due]').forEach(updateCoverBadge);
  // Then pull the authoritative dates from vehicle_cover and repaint. Left
  // unawaited on purpose: the cards already show the local values, so this is
  // a correction pass rather than a blocking load.
  window.dkCoverStore.hydrate();

  // Everything that used to live only on this machine — park history, upload notes
  // and dates, the purchase-date override, the conversation — is read from the
  // database here. The screen repaints through the listener rather than by
  // reloading, so a spot saved on the laptop appears on the phone without a flash.
  if (window.dkCloudStore) {
    window.dkCloudStore.onChange(what => {
      const all = what === 'all';

      if ((all || what === 'park') && typeof window.dkRefreshParkUI === 'function') {
        window.dkRefreshParkUI();
      }
      // The same repaint the setAgeFrom control uses, rather than a second one
      // that could drift from it.
      if ((all || what === 'setting')
        && typeof window.dkHomeInsights === 'function'
        && typeof window.dkGetSnapshot === 'function') {
        window.dkHomeInsights(window.dkGetSnapshot());
      }
      // Notes and dates are read as the historic table renders, so the table is
      // what has to be rebuilt. Only when it is already on screen — rebuilding a
      // table nobody is looking at costs a query for nothing.
      //
      // Called directly, not through window. loadHistoricUploads is declared
      // inside this same DOMContentLoaded handler, so it is NOT a window property
      // however far left it sits — a `typeof window.loadHistoricUploads` guard
      // here was simply always false, and the table quietly never repainted.
      if ((all || what === 'notes' || what === 'dates') && spinlogLazyState.docsLoaded) {
        loadHistoricUploads();
      }
      if ((all || what === 'chat') && typeof window.SageUI?.renderChat === 'function') {
        window.SageUI.renderChat();
      }
    });
    // Unawaited: the rest of the boot does not wait on the network, and every
    // reader handles an empty cache by showing nothing rather than breaking.
    window.dkCloudStore.load();
  }

  // Hide Next Due for Mods/Updates
  document.getElementById('serviceType')?.addEventListener('change', function() {
    const lbl = document.getElementById('nextDueLabel');
    const form = document.getElementById('serviceEntryForm');
    if (!lbl) return;
    const isMods = this.value === 'Mods/Updates';
    form?.classList.toggle('is-mods-entry', isMods);
    if (isMods) {
      lbl.style.display = 'none';
      const dueInput = lbl.querySelector('input');
      if (dueInput) {
        dueInput.value = '';
        updateDateUI(dueInput);
      }
    } else {
      lbl.style.display = '';
    }
  });

  // Service entries store + modern history filters
  let serviceEntries = [];
  let serviceRenderRun = 0;
  let serviceFilterTimer = null;

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function escapeAttr(value) {
    return escapeHTML(value).replace(/`/g, '&#96;');
  }

  function formatServiceDate(value) {
    if (!value) return '-';
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return escapeHTML(value);
    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }

  function formatServiceNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return value ? escapeHTML(value) : '-';
    return number.toLocaleString('en-IN');
  }

  function formatServiceCost(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return value ? escapeHTML(value) : '-';
    return `₹${number.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }

  function getServiceEntryCost(entry) {
    const cost = Number(entry?.cost);
    return Number.isFinite(cost) ? cost : 0;
  }

  function renderServiceSpendCard(label, value, extraClass = '') {
    return `
      <div class="history-spend-card ${extraClass}">
        <span>${escapeHTML(label)}</span>
        <strong>${escapeHTML(value)}</strong>
      </div>
    `;
  }

  function updateServiceSpendSummary(entries, filters) {
    const strip = document.getElementById('serviceHistorySpendStrip');
    if (!strip) return;

    const list = Array.isArray(entries) ? entries : [];
    const totalSpend = list.reduce((sum, entry) => sum + getServiceEntryCost(entry), 0);
    const serviceSpend = list
      .filter(entry => String(entry.type || '').toLowerCase() !== 'mods/updates')
      .reduce((sum, entry) => sum + getServiceEntryCost(entry), 0);
    const modsSpend = list
      .filter(entry => String(entry.type || '').toLowerCase() === 'mods/updates')
      .reduce((sum, entry) => sum + getServiceEntryCost(entry), 0);
    const hasFilters = Boolean(filters?.query || filters?.type || filters?.from || filters?.to);

    strip.innerHTML = [
      renderServiceSpendCard(hasFilters ? 'Filtered Spend' : 'Total Spend', formatServiceCost(totalSpend), 'history-spend-total'),
      renderServiceSpendCard('Service Spend', formatServiceCost(serviceSpend), 'history-spend-service'),
      renderServiceSpendCard('Mods Spend', formatServiceCost(modsSpend), 'history-spend-mods'),
      renderServiceSpendCard('Records', String(list.length), 'history-spend-count')
    ].join('');
  }

  function getServiceHistoryControls() {
    return {
      search: document.getElementById('serviceHistorySearch'),
      type: document.getElementById('serviceHistoryTypeFilter'),
      from: document.getElementById('serviceHistoryFromDate'),
      to: document.getElementById('serviceHistoryToDate'),
      clear: document.getElementById('serviceHistoryClearFilters'),
      toggle: document.getElementById('serviceHistoryFilterToggle'),
      filterPanel: document.getElementById('serviceHistoryFilters'),
      filterCount: document.getElementById('serviceHistoryFilterCount'),
      typeButton: document.getElementById('serviceHistoryTypeButton'),
      typeValue: document.getElementById('serviceHistoryTypeValue'),
      typeMenu: document.getElementById('serviceHistoryTypeMenu'),
      summary: document.getElementById('serviceHistorySummary'),
      active: document.getElementById('serviceHistoryActiveFilters')
    };
  }

  function getServiceHistoryFilters() {
    const controls = getServiceHistoryControls();
    const rawFrom = controls.from?.value || '';
    const rawTo = controls.to?.value || '';
    let from = rawFrom;
    let to = rawTo;

    if (from && to && from > to) {
      [from, to] = [to, from];
    }

    return {
      query: (controls.search?.value || '').trim().toLowerCase(),
      type: controls.type?.value || '',
      from,
      to,
      rawFrom,
      rawTo
    };
  }

  function getServiceEntrySearchText(entry) {
    return [
      entry.type,
      entry.date,
      formatServiceDate(entry.date),
      entry.next_due,
      formatServiceDate(entry.next_due),
      entry.odo,
      entry.cost,
      entry.notes,
      entry.bill
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function entryMatchesServiceFilters(entry, filters) {
    const entryDate = entry.date || '';

    if (filters.type && entry.type !== filters.type) return false;
    if (filters.from && (!entryDate || entryDate < filters.from)) return false;
    if (filters.to && (!entryDate || entryDate > filters.to)) return false;
    if (filters.query && !getServiceEntrySearchText(entry).includes(filters.query)) return false;

    return true;
  }

  function getFilteredServiceEntries() {
    const filters = getServiceHistoryFilters();
    return serviceEntries.filter(entry => entryMatchesServiceFilters(entry, filters));
  }

  function updateServiceHistoryMeta(visibleCount, totalCount, filters) {
    const controls = getServiceHistoryControls();
    const hasFilters = Boolean(filters.query || filters.type || filters.from || filters.to);

    if (controls.summary) {
      let summaryText = '';

      if (!totalCount) {
        summaryText = 'No service records yet. Add the first entry above.';
      } else if (hasFilters) {
        summaryText = `Showing ${visibleCount} of ${totalCount} ${totalCount === 1 ? 'record' : 'records'}.`;
      }

      controls.summary.textContent = summaryText;
      controls.summary.classList.toggle('is-hidden', !summaryText);
    }

    const chips = [];
    if (filters.query) chips.push(`<span class="history-chip"><i class="fas fa-magnifying-glass" aria-hidden="true"></i> ${escapeHTML(filters.query)}</span>`);
    if (filters.type) chips.push(`<span class="history-chip"><i class="fas fa-filter" aria-hidden="true"></i> ${escapeHTML(filters.type)}</span>`);
    if (filters.from) chips.push(`<span class="history-chip"><i class="far fa-calendar" aria-hidden="true"></i> From ${formatServiceDate(filters.from)}</span>`);
    if (filters.to) chips.push(`<span class="history-chip"><i class="far fa-calendar-check" aria-hidden="true"></i> To ${formatServiceDate(filters.to)}</span>`);

    if (controls.active) {
      controls.active.innerHTML = chips.join('');
      controls.active.classList.toggle('has-filters', chips.length > 0);
    }

    if (controls.clear) {
      controls.clear.disabled = chips.length === 0;
      controls.clear.classList.toggle('is-disabled', chips.length === 0);
    }

    if (controls.filterCount) {
      controls.filterCount.textContent = String(chips.length);
      controls.filterCount.hidden = chips.length === 0;
    }
  }

  function syncServiceTypeDropdown(value = '') {
    const controls = getServiceHistoryControls();
    if (!controls.typeButton || !controls.typeMenu) return;

    const label = value || 'All types';
    if (controls.typeValue) controls.typeValue.textContent = label;

    controls.typeMenu.querySelectorAll('.history-select-option').forEach(option => {
      const selected = (option.dataset.value || '') === value;
      option.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  function closeServiceTypeDropdown() {
    const controls = getServiceHistoryControls();
    const wrapper = document.querySelector('[data-service-type-filter]');
    wrapper?.classList.remove('is-open');
    controls.typeButton?.setAttribute('aria-expanded', 'false');
  }

  function setupServiceHistoryFilters() {
    const controls = getServiceHistoryControls();
    if (!controls.search || controls.search.dataset.ready === 'true') return;

    const delayedRender = () => {
      window.clearTimeout(serviceFilterTimer);
      serviceFilterTimer = window.setTimeout(() => {
        renderServiceTable();
      }, 140);
    };

    controls.search.addEventListener('input', delayedRender);
    [controls.type, controls.from, controls.to].forEach(control => {
      control?.addEventListener('change', () => renderServiceTable());
    });

    controls.toggle?.addEventListener('click', () => {
      const isOpen = controls.filterPanel?.classList.toggle('is-open');
      controls.toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    const typeWrapper = document.querySelector('[data-service-type-filter]');
    controls.typeButton?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const isOpen = typeWrapper?.classList.toggle('is-open');
      controls.typeButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    controls.typeMenu?.querySelectorAll('.history-select-option').forEach(option => {
      option.addEventListener('click', event => {
        event.preventDefault();
        const value = option.dataset.value || '';
        controls.type.value = value;
        syncServiceTypeDropdown(value);
        closeServiceTypeDropdown();
        controls.type.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });

    document.addEventListener('click', event => {
      if (typeWrapper && !typeWrapper.contains(event.target)) {
        closeServiceTypeDropdown();
      }
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeServiceTypeDropdown();
    });

    controls.clear?.addEventListener('click', () => {
      controls.search.value = '';
      controls.type.value = '';
      controls.from.value = '';
      controls.to.value = '';
      updateDateUI(controls.from);
      updateDateUI(controls.to);
      syncServiceTypeDropdown('');
      renderServiceTable();
      controls.search.focus();
    });

    syncServiceTypeDropdown(controls.type.value || '');
    controls.search.dataset.ready = 'true';
  }

  // Update home odometer & service info
  function updateHomeText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
  }

  function updateHomeServiceInfo() {
    const serviceOnly = serviceEntries
      .filter(e => e.type !== 'Mods/Updates')
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    if (!serviceOnly.length) {
      updateHomeText('home-odo', '0 km');
      updateHomeText('home-odo-mobile', '0 km');
      updateHomeText('home-last', 'N/A');
      updateHomeText('home-last-mobile', 'N/A');
      updateHomeText('home-next', 'N/A');
      updateHomeText('home-next-mobile', 'N/A');
      if (window.dkHomeInsights) {
        window.dkHomeInsights({ all: serviceEntries, services: [], maxOdo: 0, latest: null });
      }
      return;
    }

    const maxOdo = Math.max(...serviceOnly.map(e => Number(e.odo) || 0));
    const latest = serviceOnly[0];
    const lastDate = new Date(`${latest.date}T00:00:00`).toLocaleDateString('en-GB');
    const nextDate = latest.next_due
      ? new Date(`${latest.next_due}T00:00:00`).toLocaleDateString('en-GB')
      : 'Not scheduled';
    const odoText = `${maxOdo.toLocaleString('en-IN')} km`;

    updateHomeText('home-odo', odoText);
    updateHomeText('home-odo-mobile', odoText);
    updateHomeText('home-last', lastDate);
    updateHomeText('home-last-mobile', lastDate);
    updateHomeText('home-next', nextDate);
    updateHomeText('home-next-mobile', nextDate);

    // Hand the same data to the v1.7 command-center widgets (odometer delta,
    // relative dates, maintenance timeline, next-service projection).
    if (window.dkHomeInsights) {
      window.dkHomeInsights({ all: serviceEntries, services: serviceOnly, maxOdo, latest });
    }

    // ── Sage notification triggers ──
    // serviceOnly is handed over so the scheduler can estimate today's odometer
    // and warn on distance, not just on the calendar.
    if (window.checkServiceNotif) {
      window.checkServiceNotif(maxOdo, latest.next_due || null, serviceOnly);
    }

    // The health card needs real records, so it is built here rather than at
    // boot when the snapshot is still empty.
    if (window.sageRefreshHealthCard) window.sageRefreshHealthCard();

    // Sync service data to the worker for background notifications. Only the
    // service keys are sent — the worker merges, so the cover dates written by
    // syncNotifDataToSW() survive this write.
    //
    // kmPerDay and the last reading go along too, so the worker can re-project
    // the odometer at wake time instead of reusing a stale estimate.
    const kmPerDay = window.SageScheduler?.averageKmPerDay
      ? window.SageScheduler.averageKmPerDay(serviceOnly)
      : null;
    postToSW({
      type: 'SPINLOG_SYNC_NOTIF_DATA',
      payload: {
        nextServiceDate: latest.next_due || null,
        maxOdo,
        lastRecordOdo: maxOdo,
        lastRecordDate: latest.date || null,
        kmPerDay,
        lastAppOpen: Date.now(),
      }
    });
  }

  function getServiceTypeClass(type) {
    return `history-type-${String(type || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  }

  function getServiceTypeIcon(type) {
    const normalized = String(type || '').toLowerCase();
    if (normalized.includes('mods')) return 'fas fa-bolt';
    if (normalized.includes('showroom')) return 'fas fa-shop';
    if (normalized.includes('3rd')) return 'fas fa-toolbox';
    return 'fas fa-screwdriver-wrench';
  }

  window._serviceBillRows = window._serviceBillRows || new Map();

  function buildBillPreview(entry) {
    if (!entry.bill || !String(entry.bill).trim()) {
      return '<span class="history-empty-pill">No bill</span>';
    }

    window._serviceBillRows.set(String(entry.id), String(entry.bill));
    const fileName = String(entry.bill);
    const ext = fileName.split('.').pop().toLowerCase();
    let iconClass = 'fas fa-file-lines';
    let fileClass = 'bill-preview-file';

    if (['jpg','jpeg','png','gif','webp','bmp','tiff','svg','heic','heif'].includes(ext)) {
      iconClass = 'fas fa-image';
      fileClass = 'bill-preview-image';
    } else if (ext === 'pdf') {
      iconClass = 'fas fa-file-pdf';
      fileClass = 'bill-preview-pdf';
    }

    return `
      <button class="bill-preview-link ${fileClass}" type="button" onclick="window._openServiceBill && window._openServiceBill('${escapeAttr(entry.id)}')" title="Open bill preview">
        <i class="${iconClass}" aria-hidden="true"></i>
        <span>View</span>
      </button>
    `;
  }

  window._openServiceBill = async function(id) {
    const fileName = window._serviceBillRows?.get(String(id));
    if (!fileName) {
      updatePopup('error', 'Could not find this bill. Refresh and try again.');
      return;
    }
    showPopup('loading', 'Opening bill...');
    const url = await getBillFileUrl(fileName);
    hidePopup();
    if (!url) {
      updatePopup('error', 'Could not create bill link.');
      return;
    }
    window.open(url, '_blank', 'noopener');
  };

  function renderServiceEmptyState(message, icon = 'fa-folder-open') {
    return `
      <tr class="history-empty-row">
        <td colspan="8">
          <div class="history-empty-state">
            <i class="fas ${icon}" aria-hidden="true"></i>
            <span>${escapeHTML(message)}</span>
          </div>
        </td>
      </tr>
    `;
  }

  async function renderServiceTable() {
    const tbody = document.getElementById('serviceTableBody');
    if (!tbody) return;

    const renderId = ++serviceRenderRun;
    const filters = getServiceHistoryFilters();
    const filteredEntries = getFilteredServiceEntries();
    updateServiceHistoryMeta(filteredEntries.length, serviceEntries.length, filters);
    updateServiceSpendSummary(filteredEntries, filters);

    if (!serviceEntries.length) {
      tbody.innerHTML = renderServiceEmptyState('No service records found', 'fa-folder-open');
      updateHomeServiceInfo();
      return;
    }

    if (!filteredEntries.length) {
      tbody.innerHTML = renderServiceEmptyState('No records match your filters', 'fa-magnifying-glass');
      updateHomeServiceInfo();
      return;
    }

    const rows = [];
    for (const entry of filteredEntries) {
      const billLink = buildBillPreview(entry);
      if (renderId !== serviceRenderRun) return;

      const deleteBtn = `
        <button type="button" class="delete-btn service-record-delete" data-id="${escapeAttr(entry.id)}" data-bill="${escapeAttr(entry.bill || '')}" title="Delete record" aria-label="Delete service record">
          ×
        </button>
      `;

      rows.push(`
        <tr class="service-record-row" data-record-id="${escapeAttr(entry.id)}" title="Hold to edit this record">
          <td data-label="Type" class="service-type-cell"><span class="history-type-badge ${getServiceTypeClass(entry.type)}"><i class="${getServiceTypeIcon(entry.type)}" aria-hidden="true"></i>${escapeHTML(entry.type || '-')}</span></td>
          <td data-label="Date" class="service-date-cell">${formatServiceDate(entry.date)}</td>
          <td data-label="Next Due" class="service-due-cell">${entry.next_due ? formatServiceDate(entry.next_due) : '<span class="history-empty-pill">Not set</span>'}</td>
          <td data-label="Odo (km)" class="service-odo-cell">${formatServiceNumber(entry.odo)} km</td>
          <td data-label="Cost (₹)" class="service-cost-cell">${formatServiceCost(entry.cost)}</td>
          <td data-label="Notes" class="record-notes service-notes-cell"><span class="history-notes-text">${escapeHTML(entry.notes || '-')}</span></td>
          <td data-label="Bill" class="bill-cell service-bill-cell">${billLink}</td>
          <td data-label="Action" class="action-cell service-action-cell">${deleteBtn}</td>
        </tr>
      `);
    }

    if (renderId !== serviceRenderRun) return;
    tbody.innerHTML = rows.join('');

    tbody.querySelectorAll('.service-record-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        window.deleteServiceRecord(Number(btn.dataset.id), btn.dataset.bill || '', btn);
      });
    });

    updateHomeServiceInfo();
  }

  // Load entries from Supabase
  async function loadServiceEntries() {
    try {
      const { data, error } = await supabase
        .from('maintenance_records')
        .select('*')
        .order('date', { ascending: false });
      if (error) {
        showPopup('error', 'Could not load existing service records.');
        return;
      }
      serviceEntries = data || [];
      await renderServiceTable();
    } catch {
      showPopup('error', 'Database connection failed.');
    }
  }

  // Form submission
  document.getElementById('serviceEntryForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const form = e.target;
  const data = new FormData(form);
  
  // Validate required fields manually so the custom date/type UI does not trigger browser-native tooltip glitches.
  const file = data.get('bill');
  if (!data.get('type') || !data.get('date') || !data.get('odo') || !data.get('cost') || !String(data.get('notes') || '').trim() || !file || !file.size) {
    showPopup('error', 'Please fill in all required fields and upload the bill.');
    return;
  }
  
  if (!validateFileUpload(file)) return;

  const entry = {
    type: data.get('type'),
    date: data.get('date'),
    nextDue: data.get('type') === 'Mods/Updates' ? '' : data.get('nextDue'),
    odo: data.get('odo'),
    cost: data.get('cost'),
    notes: data.get('notes')
  };

  const btn = form.querySelector('button[type="submit"].drawer-submit');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
  
  // Show loading popup
  showPopup('loading', 'Saving service entry...');

  let saved = false;
  let billName = null;
  
  try {
    // 1. Upload file first (if exists)
    if (file && file.size > 0) {
      try {
        billName = await uploadBillFile(file);
        console.log('✅ Bill uploaded:', billName);
      } catch (uploadError) {
        console.error('❌ Bill upload failed:', uploadError);
        updatePopup('error', 'Failed to upload bill: ' + uploadError.message);
        return;
      }
    }
    
    // 2. Save to database
    const insert = {
      type: entry.type,
      date: entry.date,
      next_due: entry.nextDue || null,
      odo: parseInt(entry.odo),
      cost: parseFloat(entry.cost),
      notes: entry.notes || null,
      bill: billName // This will be null if no file was uploaded
    };
    
    const { data: insertedData, error } = await supabase
      .from('maintenance_records')
      .insert([insert])
      .select();
    
    if (error) {
      console.error('❌ Database error:', error);
      // If database insert fails, clean up uploaded file
      if (billName) {
        console.log('🧹 Cleaning up uploaded file due to DB error...');
        await deleteBillFile(billName);
      }
      throw new Error('Database error: ' + error.message);
    }
    
    // 3. Success - update local data and UI
    console.log('✅ Service entry saved successfully');
    serviceEntries.unshift(insertedData[0]);
    saved = true;
    if (window.triggerRecordSavedNotif) window.triggerRecordSavedNotif();
    
  } catch (error) {
    console.error('❌ Save failed:', error);
    updatePopup('error', 'Failed to save: ' + error.message);
  }
  
  // 4. Clean up UI
  if (saved) {
    await renderServiceTable();
    form.reset();
    document.getElementById('nextDueLabel').style.display = '';
    const info = document.getElementById('fileInfo');
    if (info) info.innerHTML = '';
    updatePopup('success', 'Service entry saved successfully!');
  }
  
  btn.disabled = false;
  btn.innerHTML = original;
});

  // File validation
 function validateFileUpload(file) {
  const maxSize = 5 * 1024 * 1024; // 5MB
  const allowedExts = ['.jpg','.jpeg','.png','.gif','.webp','.bmp','.tiff','.svg','.heic','.heif','.pdf'];
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  
  if (!file.size) { 
    showPopup('error','No file selected'); 
    return false; 
  }
  if (file.size > maxSize) { 
    showPopup('error',`File size exceeds 5MB limit (${(file.size/1024/1024).toFixed(1)}MB)`); 
    return false; 
  }
  if (!allowedExts.includes(ext)) {
    showPopup('error',`Invalid file type: ${ext}. Allowed: JPG, PNG, PDF, etc.`); 
    return false;
  }
  return true;
}

  // Upload to Supabase Storage
async function uploadBillFile(file) {
  const timestamp = Date.now();
  const clean = file.name.replace(/[^a-zA-Z0-9.\-_]/g,'_');
  const name = `${timestamp}-${clean}`;
  
  console.log('🔄 Starting bill upload:', name);
  
  try {
    // Upload file with proper content type and options
    const { data, error } = await supabase.storage
      .from('service-bills')
      .upload(name, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || 'application/octet-stream'
      });
    
    if (error) {
      console.error('❌ Storage upload error:', error);
      throw new Error(`Upload failed: ${error.message}`);
    }
    
    console.log('✅ File uploaded successfully:', name);
    return name;
    
  } catch (err) {
    console.error('❌ Upload failed:', err);
    throw err;
  }
}

// Get public URL
async function getBillFileUrl(fileName) {
  if (!fileName || fileName.trim() === '') {
    return null;
  }
  
  try {

    const { data, error } = await supabase
      .storage
      .from('service-bills')
      .createSignedUrl(fileName, 60 * 60); // valid for 1 hour
    
    if (error) {
      console.warn('⚠️ Failed to get signed URL:', error);
      return null;
    }
    
    if (!data || !data.signedUrl) {
      console.warn('⚠️ No signed URL returned for:', fileName);
      return null;
    }
    return data.signedUrl;
    
  } catch (err) {
    console.error('❌ Error getting signed URL:', err);
    return null;
  }
}


  // Delete file
  async function deleteBillFile(fileName) {
    await supabase.storage.from('service-bills').remove([fileName]);
  }

  // File input setup
 function setupFileInput() {
  const fileInput = document.getElementById('fileInput');
  const button = document.getElementById('customFileButton');
  const fileInfo = document.getElementById('fileInfo');

  if (!fileInput || !button || !fileInfo) return;

  button.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) {
      fileInfo.innerHTML = '';
      return;
    }
    if (!validateFileUpload(file)) {
      fileInput.value = '';
      fileInfo.innerHTML = '';
      return;
    }
    const size = file.size < 1024 * 1024
      ? `${(file.size / 1024).toFixed(1)} KB`
      : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
    const ext = file.name.split('.').pop().toLowerCase();
    let icon = '📄';
    if (['jpg','jpeg','png','gif','webp','bmp','tiff','svg','heic','heif'].includes(ext)) icon = '🖼️';
    else if (ext === 'pdf') icon = '📋';
    fileInfo.innerHTML = `<div class="selected-file-pill">
      <span aria-hidden="true">${icon}</span><span>Selected: <strong>${file.name}</strong></span><small>${size}</small>
    </div>`;
  });
}

function createFileInfoElement() {
    const input = document.querySelector('input[name="bill"]');
    const div = document.createElement('div');
    div.id = 'fileInfo';
    input.parentNode.insertBefore(div, input.nextSibling);
    return div;
  }

  window.deleteServiceRecord = async function(id, billFileName, btnElement) {
  console.log('🗑️ Deleting service record:', { id, billFileName });

  confirmDeleteWithHold(
    (billFileName && billFileName.trim()
      ? 'The record and its bill both go.'
      : 'The record goes from your history.')
    + '<br><b>This cannot be undone.</b>',
    async () => {
      showPopup('loading', 'Deleting...');

      try {
        // DELETE FROM DB
        const { error: dbError } = await supabase
          .from('maintenance_records')
          .delete()
          .eq('id', id);

        if (dbError) {
          throw new Error('Database delete failed: ' + dbError.message);
        }

        // DELETE FROM STORAGE
        if (billFileName && billFileName.trim()) {
          console.log('🔄 Attempting file delete:', billFileName);
          const { error: storageError } = await supabase
            .storage
            .from('service-bills')
            .remove([billFileName]);

          if (storageError) {
            console.error('❌ Storage delete error:', storageError);
            throw new Error('Failed to delete file: ' + storageError.message);
          } else {
            console.log('✅ File deleted from storage');
          }
        } else {
          console.warn('⚠️ No file name provided, skipping storage delete');
        }

        // CLEANUP
        serviceEntries = serviceEntries.filter(e => Number(e.id) !== Number(id));
        await renderServiceTable();
        updateHomeServiceInfo();
        updatePopup('success', 'Deleted!');
      } catch (err) {
        console.error('❌ Delete failed:', err);
        updatePopup('error', err.message || 'Delete failed');
      }
    },
    { title: 'Delete this service record?', icon: 'fa-screwdriver-wrench' }
  );
};


  // ════════════════════════════════════════════════════════════════════
  // HOLD A ROW TO EDIT IT
  //
  // The app could only ever insert and delete a service record, so correcting a
  // mistyped odometer meant deleting the row — and re-uploading its bill, because
  // the delete takes the file with it. dkApp.updateService has existed for a while
  // for exactly this, but only Sage could reach it.
  //
  // Everything below lives inside this handler on purpose: it needs
  // `serviceEntries` and `renderServiceTable`, both of which are closure-local.
  // ════════════════════════════════════════════════════════════════════

  // Long enough not to fire on a tap or the start of a scroll, short enough that
  // you are not holding a phone still wondering whether it worked.
  const SVC_HOLD_MS = 520;
  const SVC_HOLD_MOVE = 10;

  let svcEditing = null;

  function svcEditEls() {
    return {
      modal: document.getElementById('serviceEditModal'),
      form: document.getElementById('serviceEditForm'),
      what: document.getElementById('serviceEditWhat'),
      type: document.getElementById('serviceEditType'),
      date: document.getElementById('serviceEditDate'),
      due: document.getElementById('serviceEditDue'),
      dueField: document.getElementById('serviceEditDueField'),
      odo: document.getElementById('serviceEditOdo'),
      cost: document.getElementById('serviceEditCost'),
      notes: document.getElementById('serviceEditNotes'),
      status: document.getElementById('serviceEditStatus'),
      save: document.getElementById('serviceEditSave'),
      cancel: document.getElementById('serviceEditCancel'),
      close: document.getElementById('serviceEditClose'),
    };
  }

  /** Next Due means nothing for a mod, so it is hidden rather than ignored. */
  function svcSyncDueField() {
    const e = svcEditEls();
    if (!e.dueField) return;
    e.dueField.hidden = e.type.value === 'Mods/Updates';
  }

  function openServiceEditor(record) {
    const e = svcEditEls();
    if (!e.modal || !record) return;

    svcEditing = record;
    e.what.textContent = `${record.type || 'Record'} · ${formatServiceDate(record.date)}`;
    e.type.value = ['Showroom', '3rd Party', 'Mods/Updates'].includes(record.type)
      ? record.type : 'Showroom';
    e.date.value = record.date || '';
    e.due.value = record.next_due || '';
    e.odo.value = record.odo ?? '';
    e.cost.value = record.cost ?? '';
    e.notes.value = record.notes || '';
    e.status.textContent = '';
    e.status.className = 'svc-edit-status';
    svcSyncDueField();

    e.modal.setAttribute('aria-hidden', 'false');
    e.modal.classList.add('sl-modal--open');
    // Focused after the sheet has finished arriving, or a phone scrolls the page
    // to the field mid-animation.
    setTimeout(() => e.odo?.focus({ preventScroll: true }), 80);
  }

  function closeServiceEditor() {
    const e = svcEditEls();
    svcEditing = null;
    e.modal?.classList.remove('sl-modal--open');
    e.modal?.setAttribute('aria-hidden', 'true');
  }

  async function saveServiceEditor() {
    const e = svcEditEls();
    if (!svcEditing) return;

    const fail = msg => {
      e.status.textContent = msg;
      e.status.className = 'svc-edit-status is-bad';
    };

    // Checked here as well as in updateService, because an emptied number field
    // is the one case that would pass validation and do real damage: Number('')
    // is 0, which is finite and >= 0, so a cleared ODO would save as 0 km.
    if (!e.date.value) return fail('Pick the date this was done.');
    if (e.odo.value === '') return fail('ODO cannot be left empty.');
    if (e.cost.value === '') return fail('Cost cannot be left empty — use 0 if it was free.');

    e.save.disabled = true;
    const label = e.save.innerHTML;
    e.save.innerHTML = '<span class="sl-spinner" aria-hidden="true"></span> Saving';
    e.status.textContent = '';
    e.status.className = 'svc-edit-status';

    // updateService does not blank next_due for a mod the way logService does, so
    // an explicit empty string is sent rather than leaving a stale date behind a
    // hidden field.
    const result = await window.dkApp.updateService({
      id: svcEditing.id,
      type: e.type.value,
      date: e.date.value,
      nextDue: e.type.value === 'Mods/Updates' ? '' : (e.due.value || ''),
      odo: e.odo.value,
      cost: e.cost.value,
      notes: e.notes.value.trim(),
    });

    e.save.disabled = false;
    e.save.innerHTML = label;

    if (!result || !result.ok) {
      fail(result?.error || 'That did not save.');
      return;
    }

    closeServiceEditor();
    if (typeof showPopup === 'function') showPopup('success', 'Record updated!');
  }

  /**
   * Hold detection, delegated on the tbody.
   *
   * Delegated rather than per row because renderServiceTable() replaces the whole
   * tbody with one innerHTML assignment on every repaint — and it repaints after
   * every add, edit, delete and filter keystroke. A listener attached to a row in
   * that loop would be discarded seconds later.
   */
  function setupServiceRowHold() {
    const tbody = document.getElementById('serviceTableBody');
    if (!tbody) return;

    let timer = null;
    let row = null;
    let startX = 0;
    let startY = 0;

    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      row?.classList.remove('is-holding');
      row = null;
    };

    tbody.addEventListener('pointerdown', ev => {
      clear();
      // The two controls inside a row own their own taps. Without this, holding
      // the bill button or the × would open the editor behind the dialog they
      // just opened.
      if (ev.target.closest('button, a')) return;

      const hit = ev.target.closest('.service-record-row');
      if (!hit || !hit.dataset.recordId) return;

      row = hit;
      startX = ev.clientX;
      startY = ev.clientY;
      row.classList.add('is-holding');

      timer = setTimeout(() => {
        const id = row?.dataset.recordId;
        clear();
        const record = serviceEntries.find(r => String(r.id) === String(id));
        if (record) openServiceEditor(record);
      }, SVC_HOLD_MS);
    });

    // A scroll that starts on a row must not become an edit. pointercancel covers
    // the browser taking the gesture over for scrolling; the move threshold covers
    // a slow drag that never gets that far.
    tbody.addEventListener('pointermove', ev => {
      if (!timer) return;
      if (Math.abs(ev.clientX - startX) > SVC_HOLD_MOVE
        || Math.abs(ev.clientY - startY) > SVC_HOLD_MOVE) clear();
    });
    tbody.addEventListener('pointerup', clear);
    tbody.addEventListener('pointerleave', clear);
    tbody.addEventListener('pointercancel', clear);
    // Holding on a phone otherwise raises the native text-selection callout on top
    // of the sheet. The CSS kills the selection; this kills the menu.
    tbody.addEventListener('contextmenu', ev => {
      if (ev.target.closest('.service-record-row')) ev.preventDefault();
    });

    const e = svcEditEls();
    e.form?.addEventListener('submit', ev => { ev.preventDefault(); saveServiceEditor(); });
    e.type?.addEventListener('change', svcSyncDueField);
    e.cancel?.addEventListener('click', closeServiceEditor);
    e.close?.addEventListener('click', closeServiceEditor);
    e.modal?.addEventListener('click', ev => { if (ev.target === e.modal) closeServiceEditor(); });
    document.addEventListener('keydown', ev => {
      if (ev.key !== 'Escape') return;
      if (!e.modal?.classList.contains('sl-modal--open')) return;
      // The slide dialog handles its own Escape in the capture phase; if it is up,
      // it is on top of this and the key is its to consume.
      if (window.SageConfirm?.isOpen()) return;
      closeServiceEditor();
    });
  }

  setupServiceRowHold();


  // ════════════════════════════════════════════════════════════════════
  // APP API — window.dkApp
  //
  // Everything Sage can actually DO, in one place.
  //
  // Before this she had no hands at all, only a read-only snapshot. Asked to
  // update an insurance date she replied "got it, registered that for
  // 24/06/2027" and nothing whatsoever happened — she had no way to act and no
  // way to know that, so she invented the outcome. That is the worst failure
  // mode available to an assistant, and it is fixed by giving her real controls
  // that report real results rather than by asking her not to lie.
  //
  // Deliberate rules for everything below:
  //   · Every method resolves to {ok:true, ...} or {ok:false, error}. Never
  //     throws, never returns undefined — the tool layer forwards this verbatim
  //     to the model, so a failure has to be legible to her.
  //   · Nothing here is destructive without going through the app's own
  //     slide-to-delete dialog, so a delete always passes through the user's
  //     thumb rather than her judgement.
  //   · Every write refreshes the UI it affects, so the screen and her claim
  //     about the screen cannot disagree.
  // ════════════════════════════════════════════════════════════════════

  /**
   * Ask the user to confirm, using the same slide-to-delete dialog as the UI.
   *
   * The dialog resolves true or false on its own now, so this is a thin pass
   * through. It used to poll #customPopup's class list every 250ms to notice a
   * dismissal, because the hold-to-delete popup had no cancel callback — which
   * meant a cancel took up to a quarter of a second to register, and a delete
   * that reused the popup for its progress message looked like a confirmation.
   *
   * If the dialog did not load, this answers no. Sage asking to delete something
   * and getting silence is the safe failure; her deleting it unasked is not.
   */
  async function askToConfirm(message, title) {
    const C = window.SageConfirm;
    if (!C || typeof C.slide !== 'function') {
      console.warn('[SpinLog] Slide-to-delete is not loaded, so her delete was refused.');
      return false;
    }
    return C.slide({
      title: title || 'Sage wants to delete this',
      // Trusted markup: every caller below escapes the parts that come from the
      // database and supplies the <br> and <b> itself.
      html: message,
      label: 'Slide to delete',
      icon: 'fa-trash-can',
    });
  }

  const okISO = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

  /* ── The attachment desk ────────────────────────────────────────────
     A file the user has clipped to a chat message, waiting to be used. Sage
     sees it as an image or PDF in the conversation; these controls are how it
     gets stored somewhere permanent. One slot only: a chat message carries one
     file, and holding more would just create ambiguity about which one a tool
     meant. Cleared once used or once the message is done with. */
  // A QUEUE, not one slot. A message can carry several files, and each upload
  // control takes the one that suits its kind and releases only that — so "file
  // the bill and put the photo in the archive" is two calls over one message
  // instead of two messages.
  let heldFiles = [];

  const MAX_UPLOAD_BYTES = 9 * 1024 * 1024;

  const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg', 'heic', 'heif'];
  const KIND_EXT = {
    image: IMAGE_EXT,
    audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'],
    video: ['mp4', 'mov', 'avi', 'webm', 'mpeg', 'mpg'],
    document: [...IMAGE_EXT, 'pdf'],
  };

  function extOf(name) {
    return String(name || '').split('.').pop().toLowerCase();
  }

  /** Validation that returns a sentence rather than throwing a popup. */
  function checkHeldFile(kind) {
    if (!heldFiles.length) {
      return { ok: false, error: 'There is no file attached. Ask him to clip one to his message with the paperclip, then try again.' };
    }

    const allowed = KIND_EXT[kind];
    // Picked BY KIND rather than always taking the first. That is what makes a
    // mixed message work: with a PDF bill and a photo both clipped on, attach_bill
    // finds the PDF and upload_media finds the image, and neither has to ask him
    // which was which.
    const match = allowed
      ? heldFiles.find(f => allowed.includes(extOf(f.name)))
      : heldFiles[0];

    if (!match) {
      const names = heldFiles.map(f => f.name).join(', ');
      return {
        ok: false,
        error: `None of the attached files can be a ${kind}. He clipped ${names}. Allowed: ${allowed.join(', ')}.`,
      };
    }
    if (match.size > MAX_UPLOAD_BYTES) {
      return { ok: false, error: `${match.name} is ${(match.size / 1048576).toFixed(1)}MB, over the ${MAX_UPLOAD_BYTES / 1048576}MB limit.` };
    }
    return { ok: true, file: match };
  }

  /** Bytes for a stored file, so she can open and actually read it. */
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('could not read that file'));
      reader.onload = () => {
        const out = String(reader.result || '');
        const comma = out.indexOf(',');
        resolve(comma === -1 ? out : out.slice(comma + 1));
      };
      reader.readAsDataURL(blob);
    });
  }

  const READABLE_MIME = /^(image|audio|video)\/|^application\/pdf$/;
  const MIME_BY_EXT = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', gif: 'image/gif',
    mp3: 'audio/mp3', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
    flac: 'audio/flac', ogg: 'audio/ogg', mp4: 'video/mp4', mov: 'video/quicktime',
    webm: 'video/webm', avi: 'video/x-msvideo', mpeg: 'video/mpeg', mpg: 'video/mpeg',
  };

  /**
   * Pull a stored file out of Supabase and hand it back as something she can
   * look at. The tool layer forwards `_attachFile` into the conversation as an
   * inline attachment, which is what turns "open my RC" into her actually
   * reading it rather than reciting its file name.
   */
  async function fetchForReading(bucket, fileName, signer) {
    const url = await signer(fileName);
    if (!url) return { ok: false, error: 'Could not get a link to that file.' };
    const res = await fetch(url);
    if (!res.ok) return { ok: false, error: 'That file could not be downloaded.' };
    const blob = await res.blob();
    if (blob.size > MAX_UPLOAD_BYTES) {
      return { ok: false, error: `That file is ${(blob.size / 1048576).toFixed(1)}MB — too big to open. Its details are all you have.` };
    }
    const mimeType = READABLE_MIME.test(blob.type) ? blob.type : MIME_BY_EXT[extOf(fileName)];
    if (!mimeType) return { ok: false, error: `You cannot read a .${extOf(fileName)} file.` };
    return { ok: true, mimeType, data: await blobToBase64(blob) };
  }

  window.dkApp = {
    /* ── The attachment desk ──────────────────────────────────────── */

    holdFiles(list) {
      heldFiles = Array.from(list || []).filter(Boolean);
      return { ok: true, holding: heldFiles.map(f => f.name) };
    },
    /** The single-file shape, kept so any older caller still works. */
    holdFile(file) { return window.dkApp.holdFiles(file ? [file] : []); },
    heldFile() { return heldFiles[0] || null; },
    heldFiles() { return heldFiles.slice(); },
    /**
     * Drop one file once it has been stored somewhere, or all of them.
     *
     * The argument matters: called bare it empties the queue, which is right when
     * the message is done with but wrong after a single successful upload — that
     * would throw away the other files he clipped on before she got to them.
     */
    releaseFile(file) {
      if (!file) { heldFiles = []; return; }
      heldFiles = heldFiles.filter(f => f !== file);
    },
    describeHeldFile() {
      const f = heldFiles[0];
      if (!f) return null;
      return { fileName: f.name, sizeBytes: f.size, type: f.type || null };
    },
    describeHeldFiles() {
      return heldFiles.map(f => ({ fileName: f.name, sizeBytes: f.size, type: f.type || null }));
    },

    /* ── Reading ──────────────────────────────────────────────────── */

    /**
     * Service history, newest first.
     *
     * Returns cost totals over EVERY matching record, not just the page it
     * hands back. Without them the only way to answer "what have I spent" from
     * this tool was to add up `records` — and since the default limit is 20
     * against 21 records, that silently dropped the oldest row and produced
     * ₹26,604 against a real total of ₹27,103. `truncated` says so outright, so
     * a partial list can never be mistaken for the whole set.
     */
    async listServices({ limit = 20, type = null, from = null, to = null } = {}) {
      let rows = serviceEntries.slice();
      if (type) rows = rows.filter(r => String(r.type || '').toLowerCase() === String(type).toLowerCase());
      if (okISO(from)) rows = rows.filter(r => r.date && r.date >= from);
      if (okISO(to)) rows = rows.filter(r => r.date && r.date <= to);
      rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));

      const shown = rows.slice(0, Math.min(50, Math.max(1, limit)));
      const isMod = r => String(r.type || '').toLowerCase() === 'mods/updates';
      const sum = list => Math.round(list.reduce((t, r) => {
        const cost = Number(r.cost);
        return t + (Number.isFinite(cost) ? cost : 0);
      }, 0));
      const mods = rows.filter(isMod);

      return {
        ok: true,
        total: rows.length,
        showing: shown.length,
        truncated: shown.length < rows.length,
        // Over all `total` records, including any not listed below.
        totals: {
          everything: sum(rows),
          servicing: sum(rows.filter(r => !isMod(r))),
          modsAndUpdates: sum(mods),
          modsCounted: mods.length,
          servicesCounted: rows.length - mods.length,
          currency: 'INR',
        },
        records: shown.map(r => ({
          id: r.id, date: r.date, type: r.type,
          odo: r.odo, cost: r.cost, nextDue: r.next_due,
          notes: r.notes, hasBill: !!r.bill,
        })),
      };
    },

    async getCover() {
      const cards = Array.from(document.querySelectorAll('.dk-cover-card')).map(card => ({
        label: card.querySelector('.dk-cover-label')?.textContent?.trim() || '',
        expiry: card.querySelector('.dk-cover-status[data-due]')?.getAttribute('data-due') || null,
      })).filter(c => c.label && c.expiry);
      return { ok: true, cover: cards };
    },

    async listDocuments() {
      await ensureDocsLoaded();
      const docs = Array.from(document.querySelectorAll('.vehicle-docs-grid .doc-card[data-type]')).map(card => ({
        document: card.dataset.type,
        onFile: !!card.querySelector('.doc-open-pill'),
        custom: card.classList.contains('is-custom'),
      }));
      return { ok: true, documents: docs };
    },

    async listMedia({ limit = 20 } = {}) {
      await ensureDocsLoaded();
      const rows = Array.from(window._historicMediaRows?.values() || []);
      rows.sort((a, b) => String(b.upload_date).localeCompare(String(a.upload_date)));
      return {
        ok: true,
        total: rows.length,
        media: rows.slice(0, Math.min(50, Math.max(1, limit))).map(r => ({
          id: r.id, kind: r.media_type, fileName: r.original_name,
          uploadedOn: String(r.upload_date || '').slice(0, 10),
          notes: r.notes || getHistoricLocalNote(r.id) || null,
        })),
      };
    },

    async listParkHistory() {
      const history = cloudStore()?.parkHistory() || [];
      return {
        ok: true,
        total: history.length,
        parked: history.map(p => ({
          when: new Date(p.at).toISOString(), address: p.address || null,
          lat: p.lat, lng: p.lng, accuracyM: p.accuracy || null,
        })),
      };
    },

    /* ── Writing ──────────────────────────────────────────────────── */

    async logService({ type, date, odo, cost, notes = null, nextDue = null }) {
      if (!type) return { ok: false, error: 'A service type is required: Showroom, 3rd Party or Mods/Updates.' };
      const allowed = ['Showroom', '3rd Party', 'Mods/Updates'];
      const matched = allowed.find(t => t.toLowerCase() === String(type).toLowerCase());
      if (!matched) return { ok: false, error: `type must be one of ${allowed.join(', ')}.` };
      if (!okISO(date)) return { ok: false, error: 'date must be YYYY-MM-DD.' };
      if (nextDue && !okISO(nextDue)) return { ok: false, error: 'nextDue must be YYYY-MM-DD.' };

      const odoNum = Number(odo);
      const costNum = Number(cost);
      if (!Number.isFinite(odoNum) || odoNum < 0) return { ok: false, error: 'odo must be a number of kilometres.' };
      if (!Number.isFinite(costNum) || costNum < 0) return { ok: false, error: 'cost must be a number of rupees.' };

      const insert = {
        type: matched, date,
        next_due: matched === 'Mods/Updates' ? null : (nextDue || null),
        odo: Math.round(odoNum),
        cost: costNum,
        notes: notes || null,
        // No bill: the chat has no file to attach. The record is still valid and
        // the History row will simply show "No bill".
        bill: null,
      };

      const { data, error } = await supabase.from('maintenance_records').insert([insert]).select();
      if (error) return { ok: false, error: `The database refused it: ${error.message}` };

      serviceEntries.unshift(data[0]);
      await renderServiceTable();
      if (window.sageRefreshHealthCard) window.sageRefreshHealthCard();

      return {
        ok: true,
        saved: { id: data[0].id, ...insert },
        note: 'Saved without a bill, because chat cannot attach a file. He can add one from the Service page.',
      };
    },

    async updateCover({ label, date }) {
      if (!okISO(date)) return { ok: false, error: 'date must be YYYY-MM-DD.' };

      const cards = Array.from(document.querySelectorAll('.dk-cover-card'));
      const wanted = String(label || '').toLowerCase().trim();
      const card = cards.find(c => {
        const name = c.querySelector('.dk-cover-label')?.textContent?.trim().toLowerCase() || '';
        return name === wanted || (wanted && name.includes(wanted));
      });
      if (!card) {
        return {
          ok: false,
          error: `No cover called "${label}". Available: ${cards.map(c => c.querySelector('.dk-cover-label')?.textContent?.trim()).filter(Boolean).join(', ')}.`,
        };
      }

      const statusEl = card.querySelector('.dk-cover-status[data-due]');
      const name = card.querySelector('.dk-cover-label')?.textContent?.trim();
      const was = statusEl.getAttribute('data-due');

      statusEl.setAttribute('data-due', date);
      window.dkCoverStore.writeLocal(name, date);
      if (typeof window.updateCoverBadge === 'function') window.updateCoverBadge(statusEl);
      if (window.checkInsuranceNotif) window.checkInsuranceNotif(date);
      if (window.checkDocNotif) window.checkDocNotif(date, name);
      if (window.dkSyncNotifData) window.dkSyncNotifData();

      const storedInDb = await window.dkCoverStore.saveToDb(name, date);
      if (window.sageRefreshHealthCard) window.sageRefreshHealthCard();

      return {
        ok: true,
        cover: name,
        was,
        now: date,
        storedInDb,
        note: storedInDb ? undefined : 'Saved on this device only — the database did not accept it.',
      };
    },

    async updateMediaNotes({ id, notes }) {
      const text = String(notes || '').trim();
      if (!text) return { ok: false, error: 'notes cannot be empty.' };
      await ensureDocsLoaded();
      const row = window._historicMediaRows?.get(Number(id));
      if (!row) return { ok: false, error: `No upload with id ${id}. Use listMedia first.` };
      const synced = await updateHistoricNotes(Number(id), text);
      await loadHistoricUploads();
      return { ok: true, id: Number(id), fileName: row.original_name, notes: text, storedInDb: synced };
    },

    async setAgeFrom({ date }) {
      if (!okISO(date)) return { ok: false, error: 'date must be YYYY-MM-DD.' };
      if (!window.dkVehicle.setAgeFrom(date)) return { ok: false, error: 'That date was refused.' };
      if (window.dkHomeInsights) window.dkHomeInsights(window.dkGetSnapshot());
      return { ok: true, ageCountedFrom: date, age: window.dkVehicle.age()?.long || null };
    },

    /**
     * Edit an existing service record. The app has no edit screen at all — the
     * form only inserts — so this is the only way to correct a typo in a logged
     * record without deleting and re-adding it.
     */
    async updateService({ id, type, date, odo, cost, notes, nextDue }) {
      const record = serviceEntries.find(r => Number(r.id) === Number(id));
      if (!record) return { ok: false, error: `No service record with id ${id}. Use list_services first.` };

      const patch = {};
      if (type !== undefined) {
        const allowed = ['Showroom', '3rd Party', 'Mods/Updates'];
        const matched = allowed.find(t => t.toLowerCase() === String(type).toLowerCase());
        if (!matched) return { ok: false, error: `type must be one of ${allowed.join(', ')}.` };
        patch.type = matched;
      }
      if (date !== undefined) {
        if (!okISO(date)) return { ok: false, error: 'date must be YYYY-MM-DD.' };
        patch.date = date;
      }
      if (nextDue !== undefined) {
        if (nextDue && !okISO(nextDue)) return { ok: false, error: 'nextDue must be YYYY-MM-DD.' };
        patch.next_due = nextDue || null;
      }
      if (odo !== undefined) {
        const n = Number(odo);
        if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'odo must be a number of kilometres.' };
        patch.odo = Math.round(n);
      }
      if (cost !== undefined) {
        const n = Number(cost);
        if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'cost must be a number of rupees.' };
        patch.cost = n;
      }
      if (notes !== undefined) patch.notes = notes || null;

      if (!Object.keys(patch).length) return { ok: false, error: 'Nothing to change — name at least one field.' };

      const { data, error } = await supabase
        .from('maintenance_records').update(patch).eq('id', record.id).select();
      if (error) return { ok: false, error: `The database refused it: ${error.message}` };
      if (!data || !data.length) {
        return { ok: false, error: 'The database accepted nothing back. It probably has no UPDATE policy for maintenance_records.' };
      }

      Object.assign(record, data[0]);
      await renderServiceTable();
      if (window.sageRefreshHealthCard) window.sageRefreshHealthCard();
      return { ok: true, id: record.id, changed: patch };
    },

    /* ── Files, in and out ────────────────────────────────────────── */

    /** Put the attached file on a service record as its bill. */
    async attachBill({ id }) {
      const record = serviceEntries.find(r => Number(r.id) === Number(id));
      if (!record) return { ok: false, error: `No service record with id ${id}. Use list_services first.` };

      const held = checkHeldFile('document');
      if (!held.ok) return held;

      const previous = record.bill || null;
      let stored;
      try {
        stored = await uploadBillFile(held.file);
      } catch (err) {
        return { ok: false, error: `The upload failed: ${err.message}` };
      }

      const { data, error } = await supabase
        .from('maintenance_records').update({ bill: stored }).eq('id', record.id).select();
      if (error || !data || !data.length) {
        // Do not leave an orphan in storage if the row would not take it.
        await supabase.storage.from('service-bills').remove([stored]);
        return {
          ok: false,
          error: error ? `The database refused it: ${error.message}`
            : 'The database accepted nothing back — maintenance_records probably has no UPDATE policy.',
        };
      }

      // Only now is the old bill safe to drop.
      if (previous) await supabase.storage.from('service-bills').remove([previous]);

      record.bill = stored;
      await renderServiceTable();
      // Only the file that was just stored. Bare, this cleared the whole queue and
      // the other files he clipped on were gone before she reached them.
      window.dkApp.releaseFile(held.file);
      return {
        ok: true,
        id: record.id,
        billFileName: held.file.name,
        replacedAnOlderBill: !!previous,
      };
    },

    /** Store the attached file as one of his documents. */
    async uploadDocument({ document: type, notes = null }) {
      const name = String(type || '').trim().replace(/\s+/g, ' ');
      if (!name) return { ok: false, error: 'Name the document, e.g. "Warranty Card".' };

      const held = checkHeldFile('document');
      if (!held.ok) return held;

      await ensureDocsLoaded();
      const existing = await getLatestVehicleDoc(name);
      if (existing) {
        return {
          ok: false,
          error: `There is already a ${name} on file. Delete that one first, or use a different name.`,
        };
      }

      const clean = held.file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const storedName = `${Date.now()}-${clean}`;
      const contentType = held.file.type || 'application/octet-stream';

      const { error: uploadErr } = await supabase.storage
        .from('vehicle-documents')
        .upload(storedName, held.file, { contentType, cacheControl: '3600', upsert: false });
      if (uploadErr) return { ok: false, error: `The upload failed: ${uploadErr.message}` };

      const row = {
        file_name: storedName,
        original_name: held.file.name,
        document_type: name,
        file_size: held.file.size,
        content_type: contentType,
        upload_date: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Older deployments of this table have no notes column.
      let { error } = await supabase.from('vehicle_documents').insert([{ ...row, notes }]);
      if (error && /notes/i.test(error.message || '')) {
        ({ error } = await supabase.from('vehicle_documents').insert([row]));
      }
      if (error) {
        await supabase.storage.from('vehicle-documents').remove([storedName]);
        return { ok: false, error: `The database refused it: ${error.message}` };
      }

      await loadVehicleDocsFast(docsFixedCards);
      // Only the file that was just stored. Bare, this cleared the whole queue and
      // the other files he clipped on were gone before she reached them.
      window.dkApp.releaseFile(held.file);
      if (window.triggerRecordSavedNotif) window.triggerRecordSavedNotif();
      return { ok: true, document: name, fileName: held.file.name };
    },

    /** Store the attached file in the historic archive. */
    async uploadMedia({ kind, notes }) {
      const allowed = ['image', 'audio', 'video'];
      if (!allowed.includes(kind)) return { ok: false, error: `kind must be one of ${allowed.join(', ')}.` };
      const text = String(notes || '').trim();
      if (!text) return { ok: false, error: 'The archive requires notes. Describe what the file is first.' };

      const held = checkHeldFile(kind);
      if (!held.ok) return held;

      const clean = held.file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const storedName = `${Date.now()}-${clean}`;
      const ext = extOf(held.file.name);
      const contentType = held.file.type || MIME_BY_EXT[ext] || 'application/octet-stream';

      const { error: uploadErr } = await supabase.storage
        .from('historic-media')
        .upload(storedName, held.file, { contentType, cacheControl: '3600', upsert: false });
      if (uploadErr) return { ok: false, error: `The upload failed: ${uploadErr.message}` };

      const row = {
        media_type: kind,
        file_name: storedName,
        original_name: held.file.name,
        file_size: held.file.size,
        content_type: contentType,
        upload_date: new Date().toISOString(),
        notes: text,
      };

      let { data, error } = await supabase.from('media_files').insert([row]).select();
      if (error && /notes/i.test(error.message || '')) {
        const bare = { ...row };
        delete bare.notes;
        ({ data, error } = await supabase.from('media_files').insert([bare]).select());
      }
      if (error) {
        await supabase.storage.from('historic-media').remove([storedName]);
        return { ok: false, error: `The database refused it: ${error.message}` };
      }

      if (data?.[0]?.id) setHistoricLocalNote(data[0].id, text);
      await loadHistoricUploads();
      // Only the file that was just stored. Bare, this cleared the whole queue and
      // the other files he clipped on were gone before she reached them.
      window.dkApp.releaseFile(held.file);
      return { ok: true, id: data?.[0]?.id ?? null, kind, fileName: held.file.name, notes: text };
    },

    /** Open a stored document so she can read what is inside it. */
    async readDocument({ document: type }) {
      await ensureDocsLoaded();
      const latest = await getLatestVehicleDoc(type);
      if (!latest) return { ok: false, error: `Nothing on file for "${type}". Use list_documents to see what is there.` };
      const file = await fetchForReading('vehicle-documents', latest.file_name, getSignedUrl);
      if (!file.ok) return file;
      return {
        ok: true,
        document: type,
        fileName: latest.original_name,
        opened: true,
        _attachFile: { mimeType: file.mimeType, data: file.data },
      };
    },

    /** Open a stored photo, recording or video so she can describe it. */
    async readMedia({ id }) {
      await ensureDocsLoaded();
      const row = window._historicMediaRows?.get(Number(id));
      if (!row) return { ok: false, error: `No upload with id ${id}. Use list_media first.` };
      const file = await fetchForReading('historic-media', row.file_name, getHistoricMediaUrl);
      if (!file.ok) return file;
      return {
        ok: true,
        id: row.id,
        fileName: row.original_name,
        kind: row.media_type,
        opened: true,
        _attachFile: { mimeType: file.mimeType, data: file.data },
      };
    },

    async setMediaDate({ id, date }) {
      if (!okISO(date)) return { ok: false, error: 'date must be YYYY-MM-DD.' };
      await ensureDocsLoaded();
      const row = window._historicMediaRows?.get(Number(id));
      if (!row) return { ok: false, error: `No upload with id ${id}. Use list_media first.` };
      const result = await persistHistoricDateToDatabase(Number(id), date);
      setHistoricLocalDate(result.id || Number(id), result.value);
      await loadHistoricUploads();
      return {
        ok: true, id: Number(id), date, storedInDb: result.ok,
        note: result.ok ? undefined : 'Saved on this device only — media_files has no UPDATE policy.',
      };
    },

    /* ── Looking things up ────────────────────────────────────────── */

    async search({ query, limit = 10 }) {
      const q = String(query || '').trim().toLowerCase();
      if (!q) return { ok: false, error: 'Give me something to search for.' };
      const cap = Math.min(25, Math.max(1, limit));
      const hits = [];

      serviceEntries.forEach(r => {
        const hay = [r.type, r.date, r.next_due, r.odo, r.cost, r.notes].filter(Boolean).join(' ').toLowerCase();
        if (hay.includes(q)) {
          hits.push({ where: 'service', id: r.id, date: r.date, type: r.type, odo: r.odo, cost: r.cost, notes: r.notes });
        }
      });

      Array.from(window._historicMediaRows?.values() || []).forEach(r => {
        const hay = [r.original_name, r.notes, r.media_type].filter(Boolean).join(' ').toLowerCase();
        if (hay.includes(q)) {
          hits.push({ where: 'archive', id: r.id, kind: r.media_type, fileName: r.original_name, notes: r.notes || null });
        }
      });

      document.querySelectorAll('.vehicle-docs-grid .doc-card[data-type]').forEach(card => {
        const type = card.dataset.type || '';
        if (type.toLowerCase().includes(q)) {
          hits.push({ where: 'document', document: type, onFile: !!card.querySelector('.doc-open-pill') });
        }
      });

      return { ok: true, query, total: hits.length, results: hits.slice(0, cap) };
    },

    /* ── Deleting — always through his thumb, never on her word ────── */

    async deleteService({ id }) {
      const record = serviceEntries.find(r => Number(r.id) === Number(id));
      if (!record) return { ok: false, error: `No service record with id ${id}. Use listServices first.` };

      // Escaped, unlike the version this replaces. The type is free text the
      // rider typed, and it is now going into a dialog as markup.
      const confirmed = await askToConfirm(
        `The ${docsEscapeHtml(record.type)} on ${docsEscapeHtml(record.date)} `
        + `at ${docsEscapeHtml(String(record.odo))} km.<br><b>This cannot be undone.</b>`,
        'Sage wants to delete a service record'
      );
      if (!confirmed) return { ok: false, error: 'He did not confirm it, so nothing was deleted.' };

      const { error } = await supabase.from('maintenance_records').delete().eq('id', record.id);
      if (error) return { ok: false, error: `The database refused it: ${error.message}` };
      if (record.bill) await supabase.storage.from('service-bills').remove([record.bill]);

      serviceEntries = serviceEntries.filter(r => Number(r.id) !== Number(record.id));
      await renderServiceTable();
      if (window.sageRefreshHealthCard) window.sageRefreshHealthCard();
      return { ok: true, deleted: { id: record.id, date: record.date, type: record.type } };
    },

    async deleteMedia({ id }) {
      await ensureDocsLoaded();
      const row = window._historicMediaRows?.get(Number(id));
      if (!row) return { ok: false, error: `No upload with id ${id}. Use listMedia first.` };

      const confirmed = await askToConfirm(
        `“${docsEscapeHtml(row.original_name)}”<br><b>This cannot be undone.</b>`,
        'Sage wants to delete an upload'
      );
      if (!confirmed) return { ok: false, error: 'He did not confirm it, so nothing was deleted.' };

      const { error } = await supabase.from('media_files').delete().eq('id', row.id);
      if (error) return { ok: false, error: `The database refused it: ${error.message}` };
      await supabase.storage.from('historic-media').remove([row.file_name]);
      await loadHistoricUploads();
      return { ok: true, deleted: { id: row.id, fileName: row.original_name } };
    },

    async deleteDocument({ document: type }) {
      await ensureDocsLoaded();
      const latest = await getLatestVehicleDoc(type);
      if (!latest) return { ok: false, error: `Nothing on file for "${type}".` };

      const confirmed = await askToConfirm(
        `Your ${docsEscapeHtml(type)} comes off the vault.<br><b>This cannot be undone.</b>`,
        'Sage wants to delete a document'
      );
      if (!confirmed) return { ok: false, error: 'He did not confirm it, so nothing was deleted.' };

      await supabase.from('vehicle_documents').delete()
        .eq('file_name', latest.file_name).eq('document_type', type);
      await supabase.storage.from('vehicle-documents').remove([latest.file_name]);
      await loadVehicleDocsFast(docsFixedCards);
      return { ok: true, deleted: { document: type, fileName: latest.original_name } };
    },

    /* ── Getting around, and settings ─────────────────────────────── */

    /**
     * OFFER a page rather than jumping to one.
     *
     * This used to call setActiveSection() and the screen changed underneath him
     * mid-conversation — he asks her something, and the chat he was reading is
     * replaced by the service form. Being moved somewhere you did not ask to go is
     * the most annoying thing a chat assistant can do, and she reached for it
     * readily: "add as a reminder" opened the service page.
     *
     * So the tool now returns an offer, the reply carries a button, and he decides.
     * She is told in the result that nothing has happened yet, because otherwise
     * she reports it as done.
     */
    async openSection({ section, highlight = null }) {
      const known = ['home', 'service', 'docs', 'sage'];
      if (!known.includes(section)) return { ok: false, error: `section must be one of ${known.join(', ')}.` };
      return {
        ok: true,
        offered: section,
        highlight: highlight || null,
        note: 'Nothing has opened. He has been given a button and may or may not press it.',
      };
    },

    /** Take the offer. Called by the button in the chat, not by her. */
    async goToSection({ section, highlight = null }) {
      const known = ['home', 'service', 'docs', 'sage'];
      if (!known.includes(section)) return { ok: false, error: 'unknown section' };
      setActiveSection(section);
      if (highlight) {
        const target = document.querySelector(highlight);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return { ok: true, opened: section };
    },

    async saveParkLocation() {
      if (typeof window.dkSaveParkLocation !== 'function') {
        return { ok: false, error: 'Parking is not available on this device.' };
      }
      return window.dkSaveParkLocation();
    },

    async getNotificationSettings() {
      const S = window.SageScheduler;
      if (!S) return { ok: false, error: 'The scheduler is not loaded.' };
      const limits = await S.getLimits();
      return {
        ok: true,
        quietFrom: limits.quietStart, quietUntil: limits.quietEnd,
        mostPerDay: limits.dailyCap,
        leastHoursBetween: Math.round(limits.minGapMs / 3600000),
        urgentThroughQuietHours: limits.criticalInQuietHours !== false,
        mutedCategories: Object.keys(limits.categories || {}).filter(k => limits.categories[k] === false),
      };
    },

    async updateNotificationSettings(changes = {}) {
      const S = window.SageScheduler;
      if (!S) return { ok: false, error: 'The scheduler is not loaded.' };
      const limits = await S.getLimits();
      const next = { ...limits };

      const hour = v => (Number.isInteger(v) && v >= 0 && v <= 23 ? v : null);
      if (changes.quietFrom !== undefined) {
        const h = hour(Number(changes.quietFrom));
        if (h === null) return { ok: false, error: 'quietFrom must be an hour from 0 to 23.' };
        next.quietStart = h;
      }
      if (changes.quietUntil !== undefined) {
        const h = hour(Number(changes.quietUntil));
        if (h === null) return { ok: false, error: 'quietUntil must be an hour from 0 to 23.' };
        next.quietEnd = h;
      }
      if (changes.mostPerDay !== undefined) {
        const n = Number(changes.mostPerDay);
        if (!Number.isInteger(n) || n < 1 || n > 8) return { ok: false, error: 'mostPerDay must be 1 to 8.' };
        next.dailyCap = n;
      }
      if (changes.leastHoursBetween !== undefined) {
        const n = Number(changes.leastHoursBetween);
        if (!Number.isInteger(n) || n < 1 || n > 12) return { ok: false, error: 'leastHoursBetween must be 1 to 12.' };
        next.minGapMs = n * 3600000;
      }
      if (changes.urgentThroughQuietHours !== undefined) {
        next.criticalInQuietHours = !!changes.urgentThroughQuietHours;
      }

      await S.setLimits(next);
      return { ok: true, ...(await window.dkApp.getNotificationSettings()) };
    },

    async muteCategory({ category, muted }) {
      const S = window.SageScheduler;
      if (!S) return { ok: false, error: 'The scheduler is not loaded.' };
      const known = Object.keys(S.CATEGORY_META || {});
      if (!known.includes(category)) {
        return { ok: false, error: `category must be one of: ${known.join(', ')}.` };
      }
      const limits = await S.getLimits();
      const categories = { ...(limits.categories || {}) };
      if (muted) categories[category] = false; else delete categories[category];
      await S.setLimits({ ...limits, categories });
      return { ok: true, category, muted: !!muted };
    },

    async sendTestNotification() {
      if (typeof window.sendSageTestNotif !== 'function') {
        return { ok: false, error: 'Notifications are not available here.' };
      }
      const granted = window.requestNotifPermission ? await window.requestNotifPermission() : false;
      if (!granted) return { ok: false, error: 'He has not allowed notifications for this site.' };
      const S = window.SageScheduler;
      const mood = S ? S.moodAt(Date.now(), await S.getLimits()) : null;
      const sent = await window.sendSageTestNotif(mood);
      return sent ? { ok: true, sent: true, mood } : { ok: false, error: 'The notification would not send.' };
    },

    async deleteParkEntry({ index = 0 } = {}) {
      const store = cloudStore();
      if (!store) return { ok: false, error: 'The park history is not loaded yet.' };
      const before = store.parkHistory();
      const i = Number(index);
      if (!before.length) return { ok: false, error: 'There are no saved parking spots.' };
      if (!Number.isInteger(i) || i < 0 || i >= before.length) {
        return { ok: false, error: `index must be between 0 and ${before.length - 1}.` };
      }
      // Deletes the row, rather than rewriting a list with one item missing.
      const removed = await store.removePark(i);
      if (!removed) return { ok: false, error: 'That spot could not be removed.' };

      const left = store.parkHistory();
      if (window.sageSyncParkSession) {
        window.sageSyncParkSession(left[0] ? new Date(left[0].at).toISOString() : null);
      }
      if (typeof window.dkRefreshParkUI === 'function') window.dkRefreshParkUI();
      return {
        ok: true,
        removed: { when: new Date(removed.at).toISOString(), address: removed.address || null },
        left: left.length,
      };
    },

    async refreshEverything() {
      await loadServiceEntries();
      if (spinlogLazyState.docsLoaded) await ensureDocsLoaded();
      await window.dkCoverStore.hydrate();
      // Park history, the conversation, upload notes and the purchase-date
      // override all come from the cloud store, so "refresh everything" has to
      // include it or it is refreshing most things.
      await cloudStore()?.load();
      if (window.sageRefreshHealthCard) window.sageRefreshHealthCard();
      return {
        ok: true,
        reloaded: 'service records, documents, cover dates, park history and your conversation',
      };
    },
  };

  function ensureSectionData(section) {
    if (section === 'docs') {
      ensureDocsLoaded();
      return;
    }
    if (section === 'sage') {
      // Repaint the conversation and re-read her mood on every visit.
      if (window.sageOnSectionOpen) window.sageOnSectionOpen();
      return;
    }
    if (section === 'service' && !spinlogLazyState.serviceLoaded) {
      spinlogLazyState.serviceLoaded = true;
      loadServiceEntries();
    }
  }

  // Initialize app. Heavy section data is lazy-loaded when that section is opened.
  function initApp() {
    setupDateUI();
    setupServiceEntryTypeDropdown();
    setupFileInput();
    setupServiceHistoryFilters();
    setupHistoricDropzones();
    initDbStatusMonitor();
    setupParkFeature();

    // ── Sage notification system boot ──
    if (window.checkReEngagementNotif) window.checkReEngagementNotif();
    if (window.checkAnniversaryNotif) window.checkAnniversaryNotif(window.dkVehicle.purchaseDate);
    document.querySelectorAll('.dk-cover-card .dk-cover-status[data-due]').forEach(el => {
      const label = el.closest('.dk-cover-card')?.querySelector('.dk-cover-label')?.textContent?.trim() || 'Cover';
      if (window.checkInsuranceNotif) window.checkInsuranceNotif(el.getAttribute('data-due'));
      if (window.checkDocNotif) window.checkDocNotif(el.getAttribute('data-due'), label);
    });

    // Sunday morning: queue the weekly read on herself.
    if (window.SageScheduler?.checkWeeklyInsight) {
      window.SageScheduler.checkWeeklyInsight().catch(() => {});
    }

    // Anything the scheduler deferred earlier (quiet hours, daily cap, min gap)
    // gets another chance now that the app is open.
    if (window.sagePump) window.sagePump();

    // Top up Sage's written-ahead lines while we have a network. This is what
    // lets background notifications sound like her without the service worker
    // ever calling Gemini. Unawaited — nothing waits on her prose.
    //
    // Held back a few seconds so it does not share the opening moments with the
    // health insight. Requests are serialized anyway, but keeping them out of the
    // same minute is what actually keeps us under the free-tier ceiling.
    if (window.SageAI?.refreshPools) {
      setTimeout(() => window.SageAI.refreshPools().catch(() => {}), 8000);
    }

    // ── Sync notification data to service worker for background checks ──
    syncNotifDataToSW();

    // ── Register periodic background sync for Sage notifications ──
    registerPeriodicSync();

    // Load only service records on startup because Home needs ODO / last service / next service.
    spinlogLazyState.serviceLoaded = true;
    loadServiceEntries();

    // Go back to whatever page you were last on. Deliberately last in initApp:
    // the service lazy-load above has already run and set its flag, so
    // restoring "service" here re-uses it instead of fetching twice.
    restoreSection();
  }

  /**
   * Reopen the last-used section after a refresh.
   * The URL hash wins when present, so a shared or bookmarked link still works;
   * otherwise fall back to what was stored on the previous visit.
   */
  function restoreSection() {
    const fromHash = (location.hash || '').replace(/^#/, '');
    let stored = null;
    try { stored = localStorage.getItem(SECTION_KEY); } catch { stored = null; }

    const target = isKnownSection(fromHash) ? fromHash
      : (isKnownSection(stored) ? stored : null);
    // Home is already the markup default, so there is nothing to switch to.
    if (!target || target === 'home') return;
    setActiveSection(target);
  }

  // Browser back and forward move between sections rather than leaving the page.
  window.addEventListener('hashchange', () => {
    const name = (location.hash || '').replace(/^#/, '');
    if (isKnownSection(name)) setActiveSection(name);
  });

  // ── Service worker messaging ────────────────────────────────────────
  // navigator.serviceWorker.controller is null on the very first page load
  // (nothing controls the page until the worker activates and claims it), so
  // the old guard meant a fresh install never handed its notification data
  // over. Going through the registration works on first load too.
  async function postToSW(message) {
    try {
      if (!navigator.serviceWorker) return false;
      const reg = await navigator.serviceWorker.ready;
      const target = reg.active || navigator.serviceWorker.controller;
      if (!target) return false;
      target.postMessage(message);
      return true;
    } catch {
      return false;
    }
  }
  window.dkPostToSW = postToSW;

  // ── Sync notification-relevant data to service worker for background checks ──
  function syncNotifDataToSW() {
    // Gather insurance expiry dates from the cover cards
    const coverCards = document.querySelectorAll('.dk-cover-card .dk-cover-status[data-due]');
    let earliestInsurance = null;
    coverCards.forEach(el => {
      const due = el.getAttribute('data-due');
      if (due && (!earliestInsurance || due < earliestInsurance)) earliestInsurance = due;
    });

    // nextServiceDate is deliberately omitted rather than sent as null: the
    // worker merges and skips null values, so omitting it leaves whatever
    // updateHomeServiceInfo() already stored intact.
    const payload = {
      insuranceExpiry: earliestInsurance || null,
      lastAppOpen: Date.now(),
    };

    return postToSW({ type: 'SPINLOG_SYNC_NOTIF_DATA', payload });
  }
  window.dkSyncNotifData = syncNotifDataToSW;

  // ── Register periodic background sync ──
  /**
   * Periodic background sync — the ONLY way a notification can arrive while the
   * app is closed. There is no push backend, so if this does not register,
   * nothing is delivered until you next open the app.
   *
   * Two things were wrong here. It only called register() when
   * permissions.query already reported 'granted' — but `periodic-background-sync`
   * is not a promptable permission: Chrome grants it silently to installed PWAs
   * once site engagement is high enough, so early in a install's life the query
   * says 'prompt' and registration was skipped. And it ran once at startup with
   * no listener, so becoming eligible later changed nothing until a cold start.
   *
   * Now it just tries. register() is the real authority and throws when it is
   * not allowed, which is cheaper and more accurate than asking first.
   */
  async function registerPeriodicSync() {
    let reg = null;
    try {
      reg = await navigator.serviceWorker.ready;
    } catch {
      return false;
    }
    if (!reg || !('periodicSync' in reg)) {
      console.log('[SpinLog] No periodic background sync here — notifications arrive when the app is open.');
      return false;
    }

    const attempt = async () => {
      try {
        // minInterval is a floor, not a schedule — the browser decides the real
        // cadence from engagement. Asking for 2 hours instead of 12 gives park
        // reminders a chance to land while the app is closed; the scheduler's
        // own cooldowns and daily cap stop that turning into spam.
        await reg.periodicSync.register('spinlog-sage-notifs', {
          minInterval: 2 * 60 * 60 * 1000,
        });
        const tags = await reg.periodicSync.getTags?.().catch(() => []) || [];
        window.dkBackgroundSync = tags.includes('spinlog-sage-notifs');
        console.log('[SpinLog] ✅ Background notification checks registered.');
        return true;
      } catch (err) {
        window.dkBackgroundSync = false;
        console.log('[SpinLog] Background sync refused — install the app and use it a few times, '
          + 'or notifications will only arrive while it is open.', err?.name || err);
        return false;
      }
    };

    if (await attempt()) return true;

    // Eligibility can arrive later in the same session, so watch for it instead
    // of waiting for the next cold start.
    try {
      const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
      status.onchange = () => { if (status.state === 'granted') attempt(); };
    } catch {
      // Firefox and Safari throw on an unknown permission name. Nothing to watch.
    }
    return false;
  }

  initApp();
});

// ════════════════════════════════════════════════════════════
// LAST PARKED LOCATION
// ════════════════════════════════════════════════════════════
(function() {
  const PARK_MAX = 5;

  // In the cloud: where you left the bike is exactly the thing you want to look up
  // on the phone after saving it on the laptop.
  //
  // The shape below keeps `timestamp` as an ISO string, because a dozen lines in
  // this section compare and render it. The store works in epoch milliseconds, so
  // this is the only place the two meet.
  function getParkHistory() {
    const store = cloudStore();
    if (!store) return [];
    return store.parkHistory().map(p => ({
      timestamp: new Date(p.at).toISOString(),
      lat: p.lat,
      lng: p.lng,
      accuracy: p.accuracy,
      address: p.address || undefined,
    }));
  }

  /** Save one spot. Adds a row rather than rewriting the list. */
  function savePark(entry) {
    cloudStore()?.addPark(entry);
  }

  /** Fill in the address once reverse geocoding answers. */
  function saveParkAddress(timestamp, address) {
    cloudStore()?.setParkAddress(timestamp, address);
  }

  /** Forget one spot, by its position in the list. */
  function dropPark(index) {
    cloudStore()?.removePark(index);
  }

  function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (m < 1) return 'Just now';
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    return `${d}d ago`;
  }

  async function reverseGeocode(lat, lng) {
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await r.json();
      const a = data.address || {};
      const parts = [
        a.road || a.pedestrian || a.footway || a.path,
        a.suburb || a.neighbourhood || a.quarter,
        a.city || a.town || a.village
      ].filter(Boolean);
      return parts.slice(0, 2).join(', ') || data.display_name?.split(',').slice(0, 2).join(',').trim() || null;
    } catch { return null; }
  }

  function updateParkUI() {
    const history = getParkHistory();
    const latest  = history[0];
    const mobileEl= document.getElementById('parkValueMobile');

    if (latest) {
      const ago = timeAgo(latest.timestamp);
      if (mobileEl) mobileEl.textContent = ago;
    } else {
      if (mobileEl) mobileEl.textContent = 'Tap to save';
    }
  }

  function showAppPopup(type, msg) {
    // Use the main popup system (customPopup element)
    if (typeof showPopup === 'function') {
      showPopup(type, msg);
      return;
    }
    const popup = document.getElementById('customPopup');
    const msgEl   = document.getElementById('popupMessage');
    const spinner = document.getElementById('popupSpinner');
    const success = document.getElementById('popupSuccess');
    const error   = document.getElementById('popupError');
    if (!popup) return;
    if (spinner) spinner.style.display = type === 'loading' ? 'block' : 'none';
    if (success) success.style.display = type === 'success' ? 'block' : 'none';
    if (error)   error.style.display   = type === 'error'   ? 'block' : 'none';
    if (msgEl) msgEl.textContent = msg;
    popup.classList.add('show');
    if (type !== 'loading') setTimeout(() => { popup.classList.remove('show'); }, 2200);
  }

  async function saveCurrentParkLocation() {
    if (!navigator.geolocation) { showAppPopup('error', 'Geolocation not supported.'); return; }
    showAppPopup('loading', 'Getting accurate location…');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        const entry = { lat, lng, accuracy: Math.round(accuracy), timestamp: new Date().toISOString(), address: null };
        // One row. The store keeps the list trimmed, in the cloud as well as here.
        savePark(entry);
        updateParkUI();
        showAppPopup('success', `Saved! ±${Math.round(accuracy)}m`);
        // The timestamp is what starts the reminder clock, so hand it over.
        if (window.triggerParkingNotif) window.triggerParkingNotif(entry.timestamp);
        const addr = await reverseGeocode(lat, lng);
        // Only if it is still the newest — he may have parked again while the
        // geocoder was thinking.
        if (addr && getParkHistory()[0]?.timestamp === entry.timestamp) {
          saveParkAddress(entry.timestamp, addr);
          updateParkUI();
        }
      },
      (err) => {
        const msgs = { 1: 'Location permission denied.', 2: 'Location unavailable.', 3: 'Request timed out.' };
        showAppPopup('error', msgs[err.code] || 'Could not get location.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  function renderParkHistory() {
    const modal   = document.getElementById('parkHistoryModal');
    const list    = document.getElementById('parkHistoryList');
    const history = getParkHistory();
    if (!modal || !list) return;

    list.innerHTML = history.length ? history.map((e, i) => {
      const display = e.address || `${parseFloat(e.lat).toFixed(5)}, ${parseFloat(e.lng).toFixed(5)}`;
      const maps    = `https://www.google.com/maps?q=${e.lat},${e.lng}`;
      const date    = new Date(e.timestamp).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      const acc     = e.accuracy ? ` · ±${e.accuracy}m` : '';
      return `<div class="park-history-item">
        <span class="park-history-dot"></span>
        <div class="park-history-info">
          <span class="park-history-addr">${display}</span>
          <span class="park-history-time">${date}${acc} · ${timeAgo(e.timestamp)}</span>
        </div>
        <div class="park-history-btns">
          <a href="${maps}" target="_blank" rel="noopener" class="park-map-btn" title="Open in Maps"><i class="fas fa-map-location-dot"></i></a>
          <button type="button" class="park-del-btn" data-idx="${i}" title="Delete"><i class="fas fa-trash"></i></button>
        </div>
      </div>`;
    }).join('') : `<div class="park-history-empty"><i class="fas fa-location-dot"></i><p>No saved locations yet.<br>Tap to save your parking spot.</p></div>`;

    list.querySelectorAll('.park-del-btn').forEach(btn => btn.addEventListener('click', async () => {
      await dropPark(parseInt(btn.dataset.idx, 10));
      updateParkUI();
      renderParkHistory();
      // Reminders follow the newest entry, so deleting it ends the session.
      const left = getParkHistory();
      if (window.sageSyncParkSession) window.sageSyncParkSession(left[0]?.timestamp || null);
    }));
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('sl-modal--open');
  }

  function closeParkModal() {
    const m = document.getElementById('parkHistoryModal');
    m?.classList.remove('sl-modal--open'); m?.setAttribute('aria-hidden', 'true');
  }

  function makeLongPress(el, onTap, onLong, ms = 650) {
    let timer = null, fired = false, startX = 0, startY = 0;
    const MOVE_THRESHOLD = 10;
    const cancel = () => { clearTimeout(timer); timer = null; };
    el.addEventListener('pointerdown', (e) => { fired = false; startX = e.clientX; startY = e.clientY; timer = setTimeout(() => { fired = true; onLong(); }, ms); });
    el.addEventListener('pointerup',   () => { cancel(); if (!fired) onTap(); });
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('pointermove',  (e) => { if (timer && (Math.abs(e.clientX - startX) > MOVE_THRESHOLD || Math.abs(e.clientY - startY) > MOVE_THRESHOLD)) cancel(); });
  }

  /**
   * Save the current spot and resolve with what happened, so Sage can report a
   * real outcome instead of assuming it worked. The tap-driven path above stays
   * exactly as it was.
   */
  window.dkSaveParkLocation = function() {
    return new Promise(resolve => {
      if (!navigator.geolocation) { resolve({ ok: false, error: 'This device has no location access.' }); return; }
      showAppPopup('loading', 'Getting accurate location…');
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude: lat, longitude: lng, accuracy } = pos.coords;
          const entry = { lat, lng, accuracy: Math.round(accuracy), timestamp: new Date().toISOString(), address: null };
          savePark(entry);
          updateParkUI();
          showAppPopup('success', `Saved! ±${Math.round(accuracy)}m`);
          if (window.triggerParkingNotif) window.triggerParkingNotif(entry.timestamp);

          const address = await reverseGeocode(lat, lng);
          if (address && getParkHistory()[0]?.timestamp === entry.timestamp) {
            saveParkAddress(entry.timestamp, address);
            updateParkUI();
          }
          resolve({ ok: true, saved: { ...entry, address: address || null } });
        },
        (err) => {
          const msgs = { 1: 'He has not allowed location access.', 2: 'Location is unavailable right now.', 3: 'The location request timed out.' };
          resolve({ ok: false, error: msgs[err.code] || 'Could not get a location.' });
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  };

  // So a park entry removed through the chat repaints the home card too.
  window.dkRefreshParkUI = updateParkUI;

  window.setupParkFeature = function() {
    updateParkUI();
    // Re-point the reminder session at the newest entry on every open, so a
    // cleared IndexedDB or a fresh install picks the session back up. Idempotent:
    // the same timestamp does not restart the 2-hour clock.
    if (window.sageSyncParkSession) {
      window.sageSyncParkSession(getParkHistory()[0]?.timestamp || null);
    }
    const mobileCard = document.getElementById('parkCardMobile');
    if (mobileCard) makeLongPress(mobileCard, saveCurrentParkLocation, renderParkHistory);
    document.getElementById('parkHistoryClose')?.addEventListener('click', closeParkModal);
    document.getElementById('parkHistoryModal')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeParkModal(); });
  };
})();

// ════════════════════════════════════════════════════════════
// COVER STORE — expiry dates backed by Supabase
//
// Cover expiry used to live only in the data-due attributes in index.html,
// with edits saved to localStorage. That made the dates invisible to anything
// server-side and lost them on a browser data wipe. They now live in the
// vehicle_cover table (see supabase/vehicle_cover.sql).
//
// Read precedence, highest first:
//   1. vehicle_cover row      — source of truth when the DB is reachable
//   2. localStorage           — offline fallback, written on every edit
//   3. data-due in index.html — the original seed values
//
// Everything degrades quietly: if the table hasn't been created yet the app
// behaves exactly as it did before.
// ════════════════════════════════════════════════════════════
window.dkCoverStore = (function() {
  const COVER_KEY = 'spinlogCoverDates';
  const TABLE = 'vehicle_cover';

  /** Stable machine key for a cover, so relabelling a card keeps its row. */
  function slug(label) {
    return String(label || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(COVER_KEY) || '{}'); } catch { return {}; }
  }

  function writeLocal(label, date) {
    const dates = readLocal();
    dates[label] = date;
    try { localStorage.setItem(COVER_KEY, JSON.stringify(dates)); } catch { /* quota — DB still has it */ }
  }

  /** Every cover card on the page, paired with its label and status element. */
  function cards() {
    return Array.from(document.querySelectorAll('.dk-cover-card')).map(card => ({
      label: card.querySelector('.dk-cover-label')?.textContent?.trim() || '',
      statusEl: card.querySelector('.dk-cover-status[data-due]'),
    })).filter(c => c.label && c.statusEl);
  }

  /** True when the failure is "table not created yet" rather than a real fault. */
  function isMissingTable(error) {
    if (!error) return false;
    return error.code === '42P01' || /does not exist|schema cache|not find the table/i.test(error.message || '');
  }

  async function loadFromDb() {
    const supabase = window.supabaseClient;
    if (!supabase) return null;
    try {
      const { data, error } = await supabase.from(TABLE).select('cover_type, label, expiry_date');
      if (error) {
        if (isMissingTable(error)) {
          console.warn(`[SpinLog] ${TABLE} table not found — run supabase/vehicle_cover.sql. Using local dates.`);
        } else {
          console.warn('[SpinLog] Could not load cover dates:', error.message);
        }
        return null;
      }
      return data || [];
    } catch {
      return null;
    }
  }

  /**
   * Write one cover date. Selects then updates or inserts rather than using
   * upsert, so it works whether or not cover_type carries a unique constraint.
   */
  async function saveToDb(label, date) {
    const supabase = window.supabaseClient;
    if (!supabase) return false;
    const coverType = slug(label);
    try {
      const { data: existing, error: readErr } = await supabase
        .from(TABLE).select('id').eq('cover_type', coverType).limit(1);
      if (readErr) {
        if (!isMissingTable(readErr)) console.warn('[SpinLog] Cover lookup failed:', readErr.message);
        return false;
      }

      const row = { cover_type: coverType, label, expiry_date: date };
      const { error } = existing && existing.length
        ? await supabase.from(TABLE).update(row).eq('id', existing[0].id)
        : await supabase.from(TABLE).insert([row]);

      if (error) {
        console.warn('[SpinLog] ❌ Cover date not saved to DB:', error.message);
        return false;
      }
      console.log(`[SpinLog] ✅ Cover date saved: ${label} → ${date}`);
      return true;
    } catch {
      return false;
    }
  }

  /** Give any cover with no DB row one, using whatever the card currently shows. */
  async function seedMissing(rows) {
    const known = new Set((rows || []).map(r => r.cover_type));
    for (const { label, statusEl } of cards()) {
      if (known.has(slug(label))) continue;
      const due = statusEl.getAttribute('data-due');
      if (due) await saveToDb(label, due);
    }
  }

  /**
   * Pull the authoritative dates in and repaint. Safe to call before or after
   * setupCoverDateEditing() — it only ever moves dates forward in precedence.
   */
  async function hydrate() {
    const rows = await loadFromDb();
    if (!rows) return false;

    const byType = new Map(rows.map(r => [r.cover_type, r.expiry_date]));
    let changed = false;

    cards().forEach(({ label, statusEl }) => {
      const dbDate = byType.get(slug(label));
      if (!dbDate) return;
      // Supabase date columns can come back as a full timestamp; keep YYYY-MM-DD.
      const date = String(dbDate).slice(0, 10);
      if (statusEl.getAttribute('data-due') !== date) {
        statusEl.setAttribute('data-due', date);
        changed = true;
      }
      writeLocal(label, date);
      if (typeof window.updateCoverBadge === 'function') window.updateCoverBadge(statusEl);
      if (window.checkInsuranceNotif) window.checkInsuranceNotif(date);
      if (window.checkDocNotif) window.checkDocNotif(date, label);
    });

    await seedMissing(rows);

    // The worker's stored insuranceExpiry was based on the pre-hydrate dates.
    if (changed && window.dkSyncNotifData) window.dkSyncNotifData();
    // A date that arrived from the database rather than from an edit still moves
    // what her summary should say.
    if (changed && window.sageRefreshHealthCard) window.sageRefreshHealthCard();
    return changed;
  }

  return { slug, readLocal, writeLocal, loadFromDb, saveToDb, hydrate };
})();

// ════════════════════════════════════════════════════════════
// COVER DATE EDITING — long-press cover cards
// ════════════════════════════════════════════════════════════
window.setupCoverDateEditing = function() {
  // Local dates are applied synchronously for a correct first paint; the
  // authoritative DB values arrive shortly after via dkCoverStore.hydrate().
  const saved = window.dkCoverStore.readLocal();

  document.querySelectorAll('.dk-cover-card').forEach(card => {
    const label    = card.querySelector('.dk-cover-label')?.textContent?.trim();
    const statusEl = card.querySelector('.dk-cover-status[data-due]');
    if (label && saved[label] && statusEl) statusEl.setAttribute('data-due', saved[label]);
  });

  const modal    = document.getElementById('coverEditModal');
  const input    = document.getElementById('coverEditInput');
  const saveBtn  = document.getElementById('coverEditSave');
  const closeBtn = document.getElementById('coverEditClose');
  const titleEl  = document.getElementById('coverEditTitle');
  let editTarget = null;

  const openModal  = () => { modal?.setAttribute('aria-hidden', 'false'); modal?.classList.add('sl-modal--open'); };
  const closeModal = () => { modal?.classList.remove('sl-modal--open'); modal?.setAttribute('aria-hidden', 'true'); };

  /** Open the editor for a given cover card. */
  function openCoverEditor(card) {
    const statusEl = card.querySelector('.dk-cover-status[data-due]');
    const label    = card.querySelector('.dk-cover-label')?.textContent?.trim();
    if (!statusEl || !label) return;
    editTarget = { statusEl, label };
    // calendar-days, not calendar-pen: the pen variant is Font Awesome Pro, so
    // it was rendering as an empty box every time this modal opened.
    if (titleEl) titleEl.innerHTML = `<i class="fas fa-calendar-days"></i> ${label}`;
    if (input) input.value = statusEl.getAttribute('data-due') || '';
    openModal();
    setTimeout(() => input?.focus({ preventScroll: true }), 60);
  }

  document.querySelectorAll('.dk-cover-card').forEach(card => {
    // The whole card is the target now that the pencil is gone, so a plain
    // click or keyboard activation opens the editor.
    card.addEventListener('click', () => openCoverEditor(card));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCoverEditor(card); }
    });
  });

  saveBtn?.addEventListener('click', async () => {
    if (!editTarget || !input?.value) return;
    const { statusEl, label } = editTarget;
    const date = input.value;

    // Paint and store locally first so the edit feels instant and survives a
    // failed write, then persist to the DB.
    statusEl.setAttribute('data-due', date);
    window.dkCoverStore.writeLocal(label, date);
    if (typeof window.updateCoverBadge === 'function') window.updateCoverBadge(statusEl);
    closeModal();

    // These checks used to run only once, during initApp(), so a date edited
    // into the warning window stayed silent until the next full reload. Re-run
    // them here and push the new date to the worker for background checks.
    if (window.checkInsuranceNotif) window.checkInsuranceNotif(date);
    if (window.checkDocNotif) window.checkDocNotif(date, label);
    if (window.dkSyncNotifData) window.dkSyncNotifData();
    // "How Sage is doing" reads cover dates, so a lapsed policy fixed here has
    // to reach her summary too — otherwise she keeps saying it lapsed.
    if (window.sageRefreshHealthCard) window.sageRefreshHealthCard();

    const stored = await window.dkCoverStore.saveToDb(label, date);
    if (typeof showPopup === 'function') {
      showPopup('success', stored ? 'Cover date updated!' : 'Cover date saved on this device.');
    }
  });

  closeBtn?.addEventListener('click', closeModal);
  modal?.addEventListener('click', e => { if (e.target === modal) closeModal(); });
};

// ════════════════════════════════════════════════════════════
// DOCS MEDIA HISTORY FILTERS
// ════════════════════════════════════════════════════════════
(function() {
  function setupDocsFilters() {
    const search = document.getElementById('docsHistorySearch');
    const typeFilter = document.getElementById('docsHistoryTypeFilter');
    const fromDate = document.getElementById('docsHistoryFromDate');
    const toDate = document.getElementById('docsHistoryToDate');
    const toggle = document.getElementById('docsHistoryFilterToggle');
    const filterPanel = document.getElementById('docsHistoryFilters');
    const clearBtn = document.getElementById('docsHistoryClearFilters');
    const typeButton = document.getElementById('docsHistoryTypeButton');
    const typeMenu = document.getElementById('docsHistoryTypeMenu');
    const typeValueEl = document.getElementById('docsHistoryTypeValue');
    const typeWrapper = document.querySelector('[data-docs-type-filter]');
    const table = document.querySelector('#mediaRecordTable tbody');
    if (!search || !table) return;

    // Toggle filter panel on mobile
    toggle?.addEventListener('click', () => {
      const isOpen = filterPanel?.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    // Custom type dropdown
    typeButton?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isOpen = typeWrapper?.classList.toggle('is-open');
      typeButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    typeMenu?.querySelectorAll('.history-select-option').forEach(option => {
      option.addEventListener('click', (e) => {
        e.preventDefault();
        const value = option.dataset.value || '';
        typeFilter.value = value;
        if (typeValueEl) typeValueEl.textContent = option.textContent;
        typeWrapper?.classList.remove('is-open');
        typeButton?.setAttribute('aria-expanded', 'false');
        typeMenu.querySelectorAll('.history-select-option').forEach(o => o.setAttribute('aria-selected', 'false'));
        option.setAttribute('aria-selected', 'true');
        filterDocsTable();
      });
    });

    document.addEventListener('click', (e) => {
      if (typeWrapper && !typeWrapper.contains(e.target)) {
        typeWrapper.classList.remove('is-open');
        typeButton?.setAttribute('aria-expanded', 'false');
      }
    });

    // Clear button
    clearBtn?.addEventListener('click', () => {
      search.value = '';
      typeFilter.value = '';
      if (typeValueEl) typeValueEl.textContent = 'All types';
      fromDate.value = '';
      toDate.value = '';
      typeMenu?.querySelectorAll('.history-select-option').forEach((o, i) => o.setAttribute('aria-selected', i === 0 ? 'true' : 'false'));
      filterDocsTable();
    });

    function filterDocsTable() {
      const query = search.value.toLowerCase().trim();
      const type = typeFilter?.value || '';
      const from = fromDate?.value || '';
      const to = toDate?.value || '';
      const rows = table.querySelectorAll('tr');

      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (!cells.length) return;
        const fileName = cells[0]?.textContent?.trim()?.toLowerCase() || '';
        const notes = cells[1]?.textContent?.trim()?.toLowerCase() || '';
        const text = fileName + ' ' + notes;

        let show = true;
        if (query && !text.includes(query)) show = false;

        if (type) {
          const metaText = cells[0]?.querySelector('.docs-file-meta span:last-child')?.textContent?.toLowerCase() || '';
          let mediaType = '';
          if (metaText.includes('image')) mediaType = 'image';
          else if (metaText.includes('audio')) mediaType = 'audio';
          else if (metaText.includes('video')) mediaType = 'video';
          if (mediaType !== type) show = false;
        }

        if (from || to) {
          const dateEl = cells[3]?.querySelector('.docs-date-cell span');
          const dateText = dateEl?.textContent?.trim() || '';
          const parsed = new Date(dateText);
          if (!isNaN(parsed.getTime())) {
            // Local, not toISOString(): the text was parsed as a local date, and
            // converting it to UTC here shifted rows a day out of the filter.
            const rowDate = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
            if (from && rowDate < from) show = false;
            if (to && rowDate > to) show = false;
          }
        }

        row.style.display = show ? '' : 'none';
      });
    }

    let docsFilterTimer;
    search.addEventListener('input', () => { clearTimeout(docsFilterTimer); docsFilterTimer = setTimeout(filterDocsTable, 150); });
    fromDate?.addEventListener('change', filterDocsTable);
    toDate?.addEventListener('change', filterDocsTable);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupDocsFilters);
  } else {
    setupDocsFilters();
  }
})();

// ════════════════════════════════════════════════════════════════════════
// SpinLog v1.7 | COMMAND CENTER UI
//   Auto-hiding top bar, global search, and the derived home widgets
//   (odometer context, maintenance timeline, next-service projection).
//
//   Service data arrives through the window.dkHomeInsights(payload) hook,
//   which updateHomeServiceInfo() calls after every service-table render.
//   Everything degrades quietly if an element is missing.
//
//   Dark theme only. The odometer is read-only: it reflects the highest
//   odometer logged against a service record, never a manual entry.
// ════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const nf = (n) => Number(n || 0).toLocaleString('en-IN');
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  /** Duke 250 service interval. Deliberately a stated constant rather than
      something inferred from history: this owner services far more often than
      required, so the median observed gap came out near 1,000 km and badly
      under-reported when the next service is actually due. */
  const SERVICE_INTERVAL = { min: 3500, max: 5000 };

  /** "3.5k–5k km" */
  const intervalLabel = () =>
    `${String(SERVICE_INTERVAL.min / 1000).replace(/\.0$/, '')}k–${SERVICE_INTERVAL.max / 1000}k km`;

  /** Past services shown on the rail before the projected node. */
  const RAIL_LENGTH = 3;

  let snapshot = { all: [], services: [], maxOdo: 0, latest: null };

  /* ── date + format helpers ───────────────────────────────────────────── */

  const midnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const dayDiff = (from, to) => Math.round((midnight(to) - midnight(from)) / 86400000);

  function parseDate(value) {
    if (!value) return null;
    const d = new Date(`${value}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const fmtDate = (d) =>
    d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

  /** Days offset relative to today, phrased for a human. */
  function relDays(n) {
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    return n > 0 ? `in ${n} days` : `${Math.abs(n)} days ago`;
  }

  /** Compact duration: 9 d / 3 wk / 7 mo / 1 yr 2 mo. */
  function fmtSpan(days) {
    const d = Math.abs(Math.round(days));
    if (d < 14) return `${d} d`;
    if (d < 60) return `${Math.round(d / 7)} wk`;
    if (d < 365) return `${Math.round(d / 30)} mo`;
    const yr = Math.floor(d / 365);
    const mo = Math.round((d % 365) / 30);
    return mo ? `${yr} yr ${mo} mo` : `${yr} yr`;
  }

  function ordinal(n) {
    const teens = n % 100;
    if (teens >= 11 && teens <= 13) return `${n}th`;
    switch (n % 10) {
      case 1: return `${n}st`;
      case 2: return `${n}nd`;
      case 3: return `${n}rd`;
      default: return `${n}th`;
    }
  }

  function typeIcon(type) {
    const t = String(type || '').toLowerCase();
    if (t.includes('mods')) return 'fa-bolt';
    if (t.includes('showroom')) return 'fa-shop';
    if (t.includes('3rd')) return 'fa-toolbox';
    return 'fa-screwdriver-wrench';
  }

  /* ── 1. Chrome ───────────────────────────────────────────────────────── */

  /* The status chip and search sit inside the hero card now, so they scroll
     away with it and are home-only by construction. That removed the whole
     sticky bar, scroll-direction and per-section visibility layer this file
     used to carry. */
  function revealChrome() {
    const input = $('dkSearchInput');
    if (!input) return;
    // keep the field on screen when "/" focuses it from further down the page
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ── 2. Renderers ────────────────────────────────────────────────────── */

  function renderStatFeet(asc, latest) {
    const odoFoot = $('dkOdoFoot');
    if (odoFoot) {
      odoFoot.classList.remove('is-good', 'is-warn', 'is-bad');
      if (asc.length >= 2) {
        const prev = asc[asc.length - 2];
        const gapKm = (Number(latest.odo) || 0) - (Number(prev.odo) || 0);
        const gapDays = dayDiff(parseDate(prev.date), parseDate(latest.date));
        odoFoot.innerHTML = `<i class="fas fa-arrow-trend-up" aria-hidden="true"></i> `
          + `+${nf(gapKm)} km in ${esc(fmtSpan(gapDays))} since previous service`;
      } else if (latest) {
        odoFoot.textContent = 'Recorded at last service';
      } else {
        odoFoot.textContent = 'Awaiting service data';
      }
    }

    const lastFoot = $('dkLastFoot');
    if (lastFoot) {
      const d = latest ? parseDate(latest.date) : null;
      lastFoot.textContent = d
        ? `${latest.type || 'Service'} · ${relDays(dayDiff(new Date(), d))}`
        : 'No records yet';
    }

    // The "Next Service" stat card was removed as a duplicate of the Next
    // Service In panel, so this foot may legitimately be absent.
    const nextFoot = $('dkNextFoot');
    if (nextFoot) {
      nextFoot.classList.remove('is-good', 'is-warn', 'is-bad');
      const due = latest ? parseDate(latest.next_due) : null;
      if (!due) {
        nextFoot.textContent = 'Not scheduled';
      } else {
        const n = dayDiff(new Date(), due);
        nextFoot.textContent = n < 0 ? `overdue by ${Math.abs(n)} days` : relDays(n);
        nextFoot.classList.add(n < 0 ? 'is-bad' : n <= 14 ? 'is-warn' : 'is-good');
      }
    }
  }

  function renderTimeline(asc) {
    const host = $('dkTimeline');
    if (!host) return;

    if (!asc.length) {
      host.innerHTML = '<p class="dk-timeline-empty">'
        + '<i class="fas fa-circle-info" aria-hidden="true"></i>'
        + ' No service records yet — log your first one to build the timeline.</p>';
      return;
    }

    const latest = asc[asc.length - 1];
    const shown = asc.slice(-RAIL_LENGTH);
    const firstShown = asc.length - shown.length;
    const hidden = firstShown;

    const targetOdo = (Number(latest.odo) || 0) + SERVICE_INTERVAL.max;
    const due = parseDate(latest.next_due);
    const daysLeft = due ? dayDiff(new Date(), due) : null;
    const overdue = daysLeft !== null && daysLeft < 0;

    // An empty slot keeps every column the same height. It must be
    // visibility:hidden rather than absent, otherwise the chip's background
    // shows up as a stray dot under nodes with nothing to report.
    const blankGap = '<span class="dk-tl-gap dk-tl-gap--blank" aria-hidden="true">&nbsp;</span>';

    const nodes = shown.map((s, i) => {
      const date = parseDate(s.date);
      // What actually helps when scanning history is what the visit cost —
      // the old "+720 km in 7 wk" tag restated odometer deltas the reader can
      // already see from the row above.
      const cost = Number(s.cost) || 0;
      const gap = cost > 0
        ? `<span class="dk-tl-gap" title="Spent on this service">`
          + `<i class="fas fa-indian-rupee-sign" aria-hidden="true"></i>`
          + `${nf(cost)}</span>`
        : blankGap;
      return `
        <li class="dk-tl-node is-done" style="--i:${i}">
          <span class="dk-tl-dot"><i class="fas fa-check" aria-hidden="true"></i></span>
          <span class="dk-tl-body">
            <span class="dk-tl-kicker">${esc(ordinal(firstShown + i + 1))} Service</span>
            <span class="dk-tl-odo">${nf(s.odo)} km</span>
            <span class="dk-tl-meta">${esc(fmtDate(date))} · ${esc(s.type || 'Service')}</span>
            ${gap}
          </span>
        </li>`;
    });

    nodes.push(`
      <li class="dk-tl-node ${overdue ? 'is-overdue' : 'is-next'}" style="--i:${shown.length}">
        <span class="dk-tl-dot"><i class="fas ${overdue ? 'fa-triangle-exclamation' : 'fa-screwdriver-wrench'}" aria-hidden="true"></i></span>
        <span class="dk-tl-body">
          <span class="dk-tl-kicker">Next Service</span>
          <span class="dk-tl-odo">~${nf(targetOdo)} km</span>
          <span class="dk-tl-meta">${due ? esc(fmtDate(due)) : 'Not scheduled'} · every ${intervalLabel()}</span>
          ${blankGap}
        </span>
        <span class="dk-tl-flag">${
          daysLeft === null ? 'No date set'
            : overdue ? `${Math.abs(daysLeft)} days overdue`
            : `${daysLeft} days to go`
        }</span>
      </li>`);

    // Segment-aware fill. Every segment joining two completed services is
    // full; only the final segment fills partially, by elapsed time toward the
    // due date. A single percentage across the whole rail (the previous
    // approach) made the fill stop at an arbitrary-looking point.
    const segments = Math.max(1, nodes.length - 1);
    const doneSegments = Math.max(0, nodes.length - 2);
    let currentFrac = 0;
    const lastDate = parseDate(latest.date);
    if (due && lastDate) {
      const total = Math.max(1, dayDiff(lastDate, due));
      currentFrac = Math.max(0, Math.min(1, dayDiff(lastDate, new Date()) / total));
    }
    const pct = Math.max(0, Math.min(100, ((doneSegments + currentFrac) / segments) * 100));

    const more = hidden > 0
      ? `<button type="button" class="dk-tl-more">
           <i class="fas fa-clock-rotate-left" aria-hidden="true"></i>
           ${hidden} earlier service${hidden === 1 ? '' : 's'} in history
         </button>`
      : '';

    host.innerHTML = `
      <div class="dk-tl-inner dk-tl-inview" style="--tl-n:${nodes.length}">
        <span class="dk-tl-track" aria-hidden="true"><span style="--tl-p:${pct.toFixed(1)}%"></span></span>
        <ol class="dk-tl-nodes">${nodes.join('')}</ol>
      </div>${more}`;

    armTimelineReveal(host.querySelector('.dk-tl-inview'));

    host.querySelector('.dk-tl-more')?.addEventListener('click',
      () => go('service', '#service .service-history-panel'));
  }

  /* Timeline reveal.
     The panel is well below the fold, so its rail draw-in and node stagger fire
     on scroll rather than at load. rootMargin extends the root 14% past the
     bottom edge so the class lands just BEFORE the panel is on screen — without
     that lead-in the first animated frame can appear after the panel is already
     visible, which reads as a flicker.
     renderTimeline() replaces the whole subtree, so this re-observes the fresh
     node on every data refresh. */
  const tlRevealObserver = ('IntersectionObserver' in window)
    ? new IntersectionObserver((entries, obs) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-inview');
          obs.unobserve(entry.target);   // one-shot
        }
      }, { threshold: 0, rootMargin: '0px 0px 14% 0px' })
    : null;

  function armTimelineReveal(inner) {
    if (!inner) return;
    // No observer support: the CSS base state is already the finished state, so
    // adding the class immediately just means no entrance animation.
    if (!tlRevealObserver) { inner.classList.add('is-inview'); return; }
    tlRevealObserver.observe(inner);
  }

  function renderNextService(latest) {
    const daysEl = $('dkNextDays');
    const kmEl = $('dkNextKm');
    const daysCell = daysEl?.parentElement;
    const bar = $('dkNextBar');
    const fill = $('dkNextBarFill');
    const note = $('dkNextNote');
    if (!daysEl || !kmEl) return;

    daysCell?.classList.remove('is-overdue');
    bar?.classList.remove('is-overdue');

    if (!latest) {
      daysEl.textContent = '--';
      kmEl.textContent = '--';
      fill?.style.setProperty('--p', '0%');
      bar?.setAttribute('aria-valuenow', '0');
      if (note) note.textContent = 'Log a service to start tracking the interval.';
      return;
    }

    const lastDate = parseDate(latest.date);
    const due = parseDate(latest.next_due);
    const days = due ? dayDiff(new Date(), due) : null;
    const overdue = days !== null && days < 0;

    daysEl.textContent = days === null ? '--' : String(Math.abs(days));
    kmEl.textContent = nf(SERVICE_INTERVAL.max);

    // Progress is time-based: without a live odometer reading, distance
    // covered since the last service is simply not knowable.
    let pct = 0;
    if (due && lastDate) {
      const total = Math.max(1, dayDiff(lastDate, due));
      pct = Math.max(0, Math.min(100, (dayDiff(lastDate, new Date()) / total) * 100));
    }
    fill?.style.setProperty('--p', `${pct.toFixed(1)}%`);
    bar?.setAttribute('aria-valuenow', String(Math.round(pct)));

    if (overdue) {
      daysCell?.classList.add('is-overdue');
      bar?.classList.add('is-overdue');
    }

    if (note) {
      const basis = `service every ${intervalLabel()}`;
      if (days === null) note.textContent = `No date scheduled · ${basis}`;
      else if (overdue) note.textContent = `Was due ${fmtDate(due)} · ${basis}`;
      else note.textContent = `Due ${fmtDate(due)} · ${Math.round(pct)}% elapsed · ${basis}`;
    }
  }

  /**
   * How old she is, in the Vehicle Overview grid. Owned by window.dkVehicle
   * rather than by service data, so this renders correctly on the very first
   * paint — before any Supabase query has come back.
   */
  function renderVehicleAge() {
    const cell = $('dkFactAge');
    if (!cell) return;
    const age = window.dkVehicle?.age?.();
    if (!age) { cell.textContent = '—'; return; }
    cell.textContent = age.label;
    cell.setAttribute('title', `Registered ${age.since} · ${nf(age.totalDays)} days old`);
  }

  /**
   * Age is the one figure on this page that changes without any data changing,
   * so it is refreshed when the app returns to the foreground and again at
   * midnight. Without this an installed PWA left open for a week keeps showing
   * the age it had on the day it was opened.
   */
  function watchVehicleAge() {
    let timer = null;
    const schedule = () => {
      clearTimeout(timer);
      const next = new Date();
      // A few seconds past midnight, so it never fires a moment early and
      // recomputes the same day it just showed.
      next.setHours(24, 0, 30, 0);
      timer = setTimeout(() => { renderVehicleAge(); schedule(); }, Math.max(1000, next - Date.now()));
    };
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) renderVehicleAge();
    });
    schedule();
  }

  /** Re-render every derived home widget from the current snapshot. */
  function render() {
    const services = snapshot.services || [];
    const asc = services.slice().sort((a, b) => parseDate(a.date) - parseDate(b.date));
    const latest = asc.length ? asc[asc.length - 1] : null;

    renderVehicleAge();
    renderStatFeet(asc, latest);
    renderTimeline(asc);
    renderNextService(latest);
    searchIndex = null; // service data changed, rebuild lazily
  }

  /** Hook called by updateHomeServiceInfo() after each service-table render. */
  window.dkHomeInsights = function (payload) {
    snapshot = payload || { all: [], services: [], maxOdo: 0, latest: null };
    render();
  };

  /**
   * Read-only view of the same snapshot, so Sage's AI context builder can see
   * the service data without another Supabase round trip. serviceEntries itself
   * is closure-private and stays that way.
   */
  window.dkGetSnapshot = function () {
    return snapshot || { all: [], services: [], maxOdo: 0, latest: null };
  };

  /* ── 4. Global search ────────────────────────────────────────────────── */

  const SECTIONS = [
    { id: 'home', title: 'Command Center', sub: 'Bike status, timeline and specs', icon: 'fa-house' },
    { id: 'service', title: 'Service Records', sub: 'Log and review maintenance', icon: 'fa-screwdriver-wrench' },
    { id: 'docs', title: 'Documents', sub: 'RC, insurance, PUC and media', icon: 'fa-folder-open' },
    { id: 'sage', title: 'Sage', sub: 'Chat with your bike', icon: 'fa-comment-dots' },
  ];

  let searchIndex = null;
  let activeResult = -1;

  function flash(el) {
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('dk-flash');
    void el.offsetWidth; // reflow so the animation restarts on repeat hits
    el.classList.add('dk-flash');
    setTimeout(() => el.classList.remove('dk-flash'), 1700);
  }

  /**
   * Highlight a target that may not exist yet. Sections lazy-load their data,
   * so a service row can appear well after the navigation — a fixed delay
   * missed it and the highlight silently never happened.
   */
  function flashWhenReady(selector, tries = 24) {
    let n = 0;
    const tick = () => {
      const el = document.querySelector(selector);
      if (el) { flash(el); return; }
      if (++n < tries) setTimeout(tick, 120);
    };
    tick();
  }

  function go(sectionId, flashSelector) {
    if (typeof window.dkNavigate === 'function') window.dkNavigate(sectionId);
    if (flashSelector) flashWhenReady(flashSelector);
  }

  /** Any [data-home-section] control may name a target to highlight on arrival. */
  function initNavHighlights() {
    document.querySelectorAll('[data-home-section][data-flash]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sel = btn.getAttribute('data-flash');
        if (sel) flashWhenReady(sel);
      });
    });
  }

  function buildIndex() {
    const items = [];

    SECTIONS.forEach((s) => items.push({
      group: 'Sections', icon: s.icon, title: s.title, sub: s.sub, meta: '',
      hay: `${s.title} ${s.sub} ${s.id}`,
      run: () => go(s.id),
    }));

    (snapshot.all || []).forEach((r) => {
      const d = parseDate(r.date);
      items.push({
        group: 'Service Records',
        icon: typeIcon(r.type),
        // The note is what identifies a record to a human, so it leads; the
        // type and odometer become the supporting line.
        title: r.notes || `${r.type || 'Service'} · ${nf(r.odo)} km`,
        sub: `${r.type || 'Service'} · ${nf(r.odo)} km`,
        meta: d ? fmtDate(d) : '',
        hay: `${r.type || ''} ${r.notes || ''} ${r.odo || ''} ${r.cost || ''} ${r.date || ''} ${r.next_due || ''}`,
        run: () => go('service', `.service-record-row[data-record-id="${CSS.escape(String(r.id))}"]`),
      });
    });

    // Fact and spec rows are static markup — index them live so the two can
    // never drift apart.
    document.querySelectorAll('#home .dk-fact, #home .dk-spec-list > div').forEach((row) => {
      const label = row.querySelector('dt')?.textContent?.trim();
      const value = row.querySelector('dd')?.textContent?.trim();
      if (!label || !value) return;
      const group = row.classList.contains('dk-fact') ? 'Bike Details' : 'Specifications';
      items.push({
        group,
        icon: group === 'Bike Details' ? 'fa-id-card' : 'fa-gear',
        title: label, sub: value, meta: '',
        hay: `${label} ${value}`,
        run: () => { go('home'); setTimeout(() => flash(row), 240); },
      });
    });

    items.forEach((it) => { it.hay = it.hay.toLowerCase(); });
    return items;
  }

  function highlight(text, query) {
    const safe = esc(text);
    if (!query) return safe;
    const i = safe.toLowerCase().indexOf(query.toLowerCase());
    if (i === -1) return safe;
    return safe.slice(0, i) + '<mark>' + safe.slice(i, i + query.length) + '</mark>' + safe.slice(i + query.length);
  }

  function initSearch() {
    const input = $('dkSearchInput');
    const panel = $('dkSearchPanel');
    const clear = $('dkSearchClear');
    if (!input || !panel) return;

    // The full prompt is cut off mid-word once the field shares a row with the
    // status pill on a phone, so trade it for something that fits.
    const FULL_PROMPT = input.getAttribute('placeholder');
    const fitPlaceholder = () => {
      input.setAttribute('placeholder', window.innerWidth < 560 ? 'Search…' : FULL_PROMPT);
    };
    fitPlaceholder();
    window.addEventListener('resize', fitPlaceholder, { passive: true });

    const results = () => Array.from(panel.querySelectorAll('.dk-search-item'));

    function closePanel() {
      panel.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      activeResult = -1;
    }

    function setActive(i) {
      const list = results();
      if (!list.length) return;
      activeResult = (i + list.length) % list.length;
      list.forEach((el, n) => el.classList.toggle('is-active', n === activeResult));
      list[activeResult].scrollIntoView({ block: 'nearest' });
    }

    function run(query) {
      const q = query.trim().toLowerCase();
      if (clear) clear.hidden = !query;
      if (!q) { closePanel(); return; }
      if (!searchIndex) searchIndex = buildIndex();

      const hits = searchIndex.filter((it) => it.hay.includes(q)).slice(0, 24);

      if (!hits.length) {
        panel.innerHTML = `<p class="dk-search-empty">Nothing matches “${esc(query)}”.</p>`;
      } else {
        const groups = new Map();
        hits.forEach((h) => {
          if (!groups.has(h.group)) groups.set(h.group, []);
          groups.get(h.group).push(h);
        });

        let html = '';
        groups.forEach((list, name) => {
          html += `<div class="dk-search-group"><p class="dk-search-group-title">${esc(name)}</p>`;
          list.forEach((h) => {
            html += `<button type="button" class="dk-search-item" role="option" aria-selected="false">
              <i class="fas ${h.icon}" aria-hidden="true"></i>
              <span class="dk-search-main">
                <strong>${highlight(h.title, query.trim())}</strong>
                <small>${highlight(h.sub, query.trim())}</small>
              </span>
              ${h.meta ? `<span class="dk-search-meta">${esc(h.meta)}</span>` : ''}
            </button>`;
          });
          html += '</div>';
        });
        panel.innerHTML = html;

        // render order is flat group order, so indexes map straight through
        const ordered = [];
        groups.forEach((list) => list.forEach((h) => ordered.push(h)));
        results().forEach((btn, i) => {
          btn.addEventListener('click', () => {
            closePanel();
            input.value = '';
            if (clear) clear.hidden = true;
            ordered[i].run();
          });
        });
      }

      panel.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      activeResult = -1;
    }

    let debounce = 0;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => run(input.value), 110);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeResult + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeResult - 1); }
      else if (e.key === 'Enter') {
        const list = results();
        if (activeResult >= 0 && list[activeResult]) { e.preventDefault(); list[activeResult].click(); }
      } else if (e.key === 'Escape') {
        if (!panel.hidden) { e.preventDefault(); closePanel(); }
        else { input.value = ''; if (clear) clear.hidden = true; input.blur(); }
      }
    });

    input.addEventListener('focus', () => { if (input.value.trim()) run(input.value); });

    clear?.addEventListener('click', () => {
      input.value = '';
      clear.hidden = true;
      closePanel();
      input.focus();
    });

    document.addEventListener('click', (e) => {
      if (!panel.hidden && !panel.contains(e.target) && e.target !== input) closePanel();
    });

    // "/" focuses search, the way most dashboards behave
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      e.preventDefault();
      revealChrome();
      input.focus();
      input.select();
    });
  }

  /* ── 5. Boot ─────────────────────────────────────────────────────────── */

  function boot() {
    initSearch();
    initNavHighlights();
    render(); // paint empty states now; real data arrives via dkHomeInsights
    watchVehicleAge();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
