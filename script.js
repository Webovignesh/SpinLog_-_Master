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

function confirmDeleteWithHold(message, onConfirm) {
  showPopup('error', `
    <div style="font-size:1rem;">${message}</div>
    <button id="confirmDeleteBtn" style="
      margin-top:12px;padding:10px 36px 10px 30px;
      background:#e74c3c;color:#fff;border:none;
      border-radius:5px;cursor:pointer;font-size:1.05em;font-family:inherit;
      position:relative;overflow:hidden;
    ">Hold 2s to Delete</button>
    <div id="holdTimer" style="font-size:0.96em;color:#aaa;margin-top:8px;letter-spacing:1px;"></div>
  `);

  // Add click-outside-to-close functionality
  const popup = document.getElementById('customPopup');
  const popupContent = popup.querySelector('#popupMessage');
  
  // Close popup when clicking outside (on the overlay)
  popup.onclick = function(e) {
    if (e.target === popup) {
      hidePopup();
    }
  };
  
  // Prevent closing when clicking inside the popup content
  popupContent.onclick = function(e) {
    e.stopPropagation();
  };

  let timer = null, held = 0, done = false;
  setTimeout(() => {
    const btn = document.getElementById('confirmDeleteBtn');
    if (!btn) return;

    btn.addEventListener('mousedown', startHold);
    btn.addEventListener('touchstart', startHold);
    btn.addEventListener('mouseup', stopHold);
    btn.addEventListener('mouseleave', stopHold);
    btn.addEventListener('touchend', stopHold);

    function startHold(e) {
      e.preventDefault();
      held = 0; done = false;
      timer = setInterval(() => {
        held += 100;
        const timerEl = document.getElementById('holdTimer');
        if (timerEl) {
          timerEl.textContent = `Holding... ${Math.ceil((2000-held)/1000)}s`;
        }
        if (held >= 2000 && !done) {
          done = true;
          clearInterval(timer);
          onConfirm();
          hidePopup();
        }
      }, 100);
    }
    function stopHold() {
      clearInterval(timer);
      const timerEl = document.getElementById('holdTimer');
      if (timerEl) {
        timerEl.textContent = "Cancelled. Hold for 2s.";
      }
    }
  }, 100);
}

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
  if ((type === 'success' || type === 'error') && 
      typeof message === 'string' && 
      !message.includes('Hold')) {
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
    const [serviceRecords, vehicleDocs, historicUploads, emiRecords] = await Promise.all([
      getDbTableCount('maintenance_records'),
      getDbTableCount('vehicle_documents'),
      getDbTableCount('media_files'),
      getDbTableCount('emi_record_table')
    ]);

    return {
      serviceRecords,
      vehicleDocs,
      historicUploads,
      emiRecords
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
    showPopup(isOnline ? 'success' : 'error', `
      <div class="db-status-popup">
        <strong>${isOnline ? 'Database is working' : 'Database is not responding'}</strong>
        <span>Status: ${isOnline ? 'Online' : 'Offline / Paused'}</span>
        <span>Last checked: ${formatDbStatusTime(status.checkedAt)}</span>
        <span>Health check: ${status.table || 'maintenance_records'}</span>
        ${isOnline ? `
          <div class="db-status-data-grid" aria-label="Database table counts">
            <div class="db-status-data-card"><small>Service</small><b>${formatDbCount(data.serviceRecords)}</b></div>
            <div class="db-status-data-card"><small>Docs</small><b>${formatDbCount(data.vehicleDocs)}</b></div>
            <div class="db-status-data-card"><small>Media</small><b>${formatDbCount(data.historicUploads)}</b></div>
            <div class="db-status-data-card"><small>EMI</small><b>${formatDbCount(data.emiRecords)}</b></div>
          </div>
        ` : ''}
      </div>
    `);
  }

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

const VEHICLE_TYPES = [
  'Driving License',
  'Registration Certificate',
  'Pollution Certificate',
  'Insurance Policy',
  'Other Document'
];

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

function getHistoricNotesStore() {
  try { return JSON.parse(localStorage.getItem('spinlogHistoricNotes') || '{}'); }
  catch { return {}; }
}

function setHistoricLocalNote(id, notes) {
  const store = getHistoricNotesStore();
  store[String(id)] = notes;
  localStorage.setItem('spinlogHistoricNotes', JSON.stringify(store));
}

function getHistoricLocalNote(id) {
  return getHistoricNotesStore()[String(id)] || '';
}

function getHistoricDateStore() {
  try { return JSON.parse(localStorage.getItem('spinlogHistoricDates') || '{}'); }
  catch { return {}; }
}

function setHistoricLocalDate(id, isoDate) {
  const store = getHistoricDateStore();
  store[String(id)] = isoDate;
  localStorage.setItem('spinlogHistoricDates', JSON.stringify(store));
}

function getHistoricLocalDate(id) {
  return getHistoricDateStore()[String(id)] || '';
}

function showHistoricNotesModal({ title = 'Add upload notes', help = 'Write what this file is about. Notes are required.', initial = '', required = true } = {}) {
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
    input.value = initial || '';
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => input.focus(), 50);

    const clean = () => {
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
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
    `Are you sure you want to delete this ${type}?<br><b>This cannot be undone.</b>`,
    async () => {
      showPopup('loading', 'Deleting...');
      await supabase.from('vehicle_documents').delete().eq('file_name', fileRow.file_name).eq('document_type', type);
      await supabase.storage.from('vehicle-documents').remove([fileRow.file_name]);
      previewEl.innerHTML = '<span class="doc-empty-state"><i class="fas fa-cloud-arrow-up"></i><strong>No document uploaded</strong><small>Upload once to store this file in the vault.</small></span>';
      uploadBtn.style.display = 'inline-flex';
      uploadBtn.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Upload document';
      deleteBtn.style.display = 'none';
      updatePopup('success', 'Deleted!');
    }
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

  cards.forEach(({ type, fileInput, uploadBtn, previewEl, headerDeleteBtn }) => {
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
  });

  await loadVehicleDocsFast(cards);
}

async function loadVehicleDocsFast(cards) {
  if (!cards?.length) return;
  const types = cards.map(c => c.type);
  const { data, error } = await supabase
    .from('vehicle_documents')
    .select('file_name,original_name,document_type,upload_date')
    .in('document_type', types)
    .order('upload_date', { ascending: false });

  const latestByType = new Map();
  if (!error && data) {
    for (const row of data) {
      if (!latestByType.has(row.document_type)) latestByType.set(row.document_type, row);
    }
  }

  cards.forEach(({ type, previewEl, uploadBtn, headerDeleteBtn }) => {
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
}

async function ensureDocsLoaded() {
  if (spinlogLazyState.docsLoaded) return;
  spinlogLazyState.docsLoaded = true;
  await initDocsUpload();
  await loadHistoricUploads();
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
    required: true
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

window._historicMediaRows = new Map();
window._emiRows = new Map();
const spinlogLazyState = { docsSetup: false, docsLoaded: false, emiLoaded: false, serviceLoaded: false };


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
window._emiRows = new Map();
const spinlogLazyState = { docsSetup: false, docsLoaded: false, emiLoaded: false, serviceLoaded: false };

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
  const notes = await showHistoricNotesModal({
    title: 'Edit upload notes',
    help: 'Update the context for this historic upload.',
    initial: current === 'No notes saved' ? '' : current,
    required: true
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
  const currentIso = currentDate ? String(currentDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
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
    'Are you sure you want to delete this file?<br><b>This cannot be undone.</b>',
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
      const store = getHistoricNotesStore();
      delete store[String(id)];
      localStorage.setItem('spinlogHistoricNotes', JSON.stringify(store));
      const dateStore = getHistoricDateStore();
      delete dateStore[String(id)];
      localStorage.setItem('spinlogHistoricDates', JSON.stringify(dateStore));
      btn.closest('tr')?.remove();
      updatePopup('success', 'Deleted!');
      setTimeout(() => { hidePopup(); }, 1200);
    }
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

  function setActiveSection(section) {
    navItems.forEach(nav => nav.classList.remove('active'));
    navButtons.forEach(btn => btn.removeAttribute('aria-current'));
    document.querySelectorAll(`[data-section="${section}"]`).forEach(nav => {
      nav.classList.add('active');
      const btn = nav.querySelector('button');
      if (btn) btn.setAttribute('aria-current', 'page');
    });
    sections.forEach(sec => sec.classList.remove('active'));
    document.getElementById(section).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    closeMobileMenu();
    ensureSectionData(section);
  }
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
    if (diff < 0) {
      el.textContent = 'Expired on ' + formatted; el.classList.add('expired');
    } else if (diff <= 30) {
      el.textContent = `Expiring in ${diff} day${diff === 1 ? '' : 's'} (${formatted})`; el.classList.add('expiring');
    } else {
      el.textContent = 'Active until ' + formatted;
    }
  }
  window.updateCoverBadge = updateCoverBadge;
  setupCoverDateEditing();
  document.querySelectorAll('.status[data-due]').forEach(updateCoverBadge);

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

    // ── Sage notification triggers ──
    if (window.checkServiceNotif)  window.checkServiceNotif(maxOdo, latest.next_due || null);

    // Sync next service date to service worker for background notifications
    if (latest.next_due && navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SPINLOG_SYNC_NOTIF_DATA',
        payload: { nextServiceDate: latest.next_due, lastAppOpen: Date.now() }
      });
    }
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
        <tr class="service-record-row" data-record-id="${escapeAttr(entry.id)}">
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
    "Are you sure you want to delete this service record?<br><b>This cannot be undone.</b>",
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
    }
  );
};


// ========================================
// COMPLETE EMI MANAGEMENT SYSTEM
// ========================================

// EMI Configuration - Update these values as needed
const EMI_CONFIG = {
  loanAmount: 199704,
  emiAmount: 5788,
  totalEMIs: 48,
  startDate: '2025-08-03', // First EMI date (3rd August 2025)
  interestRate: 17.04
};

// ========================================
// 1. INITIALIZE EMI SYSTEM
// ========================================
function initEMISystem() {
  if (spinlogLazyState.emiLoaded) return;
  spinlogLazyState.emiLoaded = true;
 
  // Setup tab switching
  setupEMITabs();
  
  // Setup file uploads
  setupEMIFileUploads();
  
  // Calculate and display due dates
  calculateEMIDueDates();
  
  // Load EMI history
  loadEMIHistory();
  
  // Setup dynamic EMI counter
  updateEMIProgress();
}

// ========================================
// 2. TAB SWITCHING FUNCTIONALITY
// ========================================
function setupEMITabs() {
  const tabButtons = document.querySelectorAll('.emi-tab-btn');
  const tabContents = document.querySelectorAll('.emi-tab-content');
  
  tabButtons.forEach((button, index) => {
    button.addEventListener('click', () => {
      // Remove active class from all tabs and contents
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));
      
      // Add active class to clicked tab and corresponding content
      button.classList.add('active');
      tabContents[index].classList.add('active');
    });
  });
}

// ========================================
// 3. DUE DATE CALCULATION
// ========================================
function calculateEMIDueDates() {
  const startDate = new Date(EMI_CONFIG.startDate);
  const currentDate = new Date();
  
  // Calculate next EMI due date
  const nextEMIDate = new Date(startDate);
  let monthsElapsed = 0;
  
  // Find how many months have passed since start date
  while (nextEMIDate <= currentDate) {
    monthsElapsed++;
    nextEMIDate.setMonth(startDate.getMonth() + monthsElapsed);
    nextEMIDate.setFullYear(startDate.getFullYear() + Math.floor((startDate.getMonth() + monthsElapsed) / 12));
  }
  
  // Update due date in UI
  const dueDateElements = document.querySelectorAll('.emi-due-date');
  dueDateElements.forEach(el => {
    el.textContent = nextEMIDate.toLocaleDateString('en-GB');
  });

  // ── Sage EMI notification ──
  if (window.checkEMINotif) window.checkEMINotif(nextEMIDate);
}

// ========================================
// 4. FILE UPLOAD SYSTEM
// ========================================
function setupEMIFileUploads() {
  // Setup file input change listeners
  const fileInputs = document.querySelectorAll('input[type="file"]');
  fileInputs.forEach(input => {
    input.addEventListener('change', handleFileSelection);
  });
  
  // Setup upload button listeners
  const uploadButtons = document.querySelectorAll('.emi-confirm-btn');
  uploadButtons.forEach(button => {
    button.addEventListener('click', handleEMIUpload);
  });
}

function handleFileSelection(event) {
  const input = event.target;
  const file = input.files[0];
  const wrapper = input.closest('.upload-wrapper');
  const filenameDisplay = wrapper.querySelector('.filename-display');
  
  if (file) {
    // Validate file
    if (!validateEMIFile(file)) {
      input.value = '';
      filenameDisplay.textContent = 'Choose file';
      filenameDisplay.classList.remove('selected');
      return;
    }
    
    // Show selected filename
    filenameDisplay.textContent = file.name;
    filenameDisplay.classList.add('selected');
  } else {
    filenameDisplay.textContent = 'Choose file';
    filenameDisplay.classList.remove('selected');
  }
}

function validateEMIFile(file) {
  const maxSize = 5 * 1024 * 1024; // 5MB
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf', 'image/webp'];
  
  if (file.size > maxSize) {
    showPopup('error', 'File size must be less than 5MB');
    return false;
  }
  
  if (!allowedTypes.includes(file.type)) {
    showPopup('error', 'Only JPG, PNG, PDF, and WebP files are allowed');
    return false;
  }
  
  return true;
}

// ========================================
// 5. UPLOAD HANDLER
// ========================================
async function handleEMIUpload(event) {
  const button = event.target;
  const type = button.dataset.type; // 'Monthly' or 'Part'
  const inputId = button.dataset.inputId;
  const input = document.getElementById(inputId);
  const file = input.files[0];
  
  if (!file) {
    showPopup('error', 'Please select a file first');
    return;
  }
  
  // Get amount based on type
  let amount = EMI_CONFIG.emiAmount; // Default monthly amount
  
  if (type === 'Part') {
    const customAmountInput = document.getElementById('customPartAmount');
    const customAmount = parseFloat(customAmountInput.value);
    
    if (!customAmount || customAmount <= 0) {
      showPopup('error', 'Please enter a valid part payment amount');
      return;
    }
    amount = customAmount;
  }

  // Disable button during upload
  const originalText = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
  
  try {
    await uploadEMIReceipt(file, type, amount);
    
    // Clear form
    input.value = '';
    const filenameDisplay = input.closest('.upload-wrapper').querySelector('.filename-display');
    filenameDisplay.textContent = 'Choose file';
    filenameDisplay.classList.remove('selected');
    
    if (type === 'Part') {
      document.getElementById('customPartAmount').value = '';
    }
    
  } catch (error) {
    console.error('Upload failed:', error);
    showPopup('error', 'Upload failed: ' + error.message);
  } finally {
    // Re-enable button
    button.disabled = false;
    button.innerHTML = originalText;
  }
}

// ========================================
// 6. SUPABASE UPLOAD FUNCTION
// ========================================
async function uploadEMIReceipt(file, type, amount) {
  
  // Generate unique filename
  const timestamp = Date.now();
  const cleanName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const fileName = `${timestamp}-${cleanName}`;
  
  // Start upload progress
  startUploadPercent();
  
  try {
    // 1. Upload file to Supabase Storage
    const { error: uploadError } = await supabase
      .storage
      .from('emi-files')
      .upload(fileName, file, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false
      });
    
    if (uploadError) {
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }
    
    // 2. Insert record into database
    const { data, error: dbError } = await supabase
      .from('emi_record_table')
      .insert([{
        date_paid: new Date().toISOString().split('T')[0],
        amount: amount,
        type: type,
        file_name: fileName,
        original_name: file.name,
        upload_date: new Date().toISOString()
      }])
      .select();
    
    if (dbError) {
      // If database insert fails, clean up the uploaded file
      await supabase.storage.from('emi-files').remove([fileName]);
      throw new Error(`Database insert failed: ${dbError.message}`);
    }
    
    // 3. Success actions
    finishUploadPercent();
    showPopup('success', `${type} payment receipt uploaded successfully!`);
    
    // Reload the history table
    await loadEMIHistory();
    
    // Update EMI progress
    updateEMIProgress();
    
  } catch (error) {
    errorUploadPercent();
    throw error;
  }
}

// ========================================
// 7. LOAD EMI HISTORY
// ========================================
async function loadEMIHistory() {
  const tbody = document.querySelector('#emiRecordTable tbody');
  if (!tbody) {
    console.warn('⚠️ EMI table not found');
    return;
  }
  
  // Show loading state
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#888;">Loading records...</td></tr>';
  
  try {
    const { data, error } = await supabase
      .from('emi_record_table')
      .select('*')
      .order('upload_date', { ascending: false });
    
    if (error) {
      throw new Error(error.message);
    }
    
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#666;">No EMI records found</td></tr>';
      return;
    }
    
    // Clear loading state
    tbody.innerHTML = '';
    
    // Render each record
    window._emiRows = new Map();
    for (const record of data) {
      renderEMIRecord(record, tbody);
    }
    
  } catch (error) {
    console.error('Failed to load EMI history:', error);
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#b44;">Failed to load records</td></tr>';
  }
}

function renderEMIRecord(record, tbody) {
  try {
    window._emiRows.set(Number(record.id), record);

    const truncateFilename = (filename, maxLength = 25) => {
      if (!filename) return 'Receipt';
      if (filename.length <= maxLength) return filename;
      const ext = filename.split('.').pop();
      const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.')) || filename;
      return nameWithoutExt.substring(0, Math.max(8, maxLength - ext.length - 5)) + '.....' + ext;
    };

    const displayName = truncateFilename(record.original_name);
    const preview = `<button class="docs-preview-pill emi-preview-pill" type="button" onclick="window._openEMIReceipt && window._openEMIReceipt(${Number(record.id)})" title="Open receipt: ${docsEscapeAttr(record.original_name || '')}"><i class="fas fa-arrow-up-right-from-square"></i> ${docsEscapeHtml(displayName)}</button>`;
    const deleteBtn = `<button class="delete-btn" title="Delete record" onclick="deleteEMIRecord(${Number(record.id)}, '${docsEscapeAttr(record.file_name)}', this)">×</button>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Date Paid">${new Date(record.date_paid).toLocaleDateString('en-GB')}</td>
      <td data-label="Amount (₹)">₹${Number(record.amount || 0).toLocaleString('en-IN')}</td>
      <td data-label="Type">${docsEscapeHtml(record.type || '-')}</td>
      <td data-label="Preview">${preview}</td>
      <td data-label="Action">${deleteBtn}</td>
    `;

    tbody.appendChild(tr);
  } catch (error) {
    console.error('Failed to render EMI record:', error);
  }
}

window._openEMIReceipt = async function(id) {
  const record = window._emiRows?.get(Number(id));
  if (!record?.file_name) {
    updatePopup('error', 'Could not find this receipt. Refresh and try again.');
    return;
  }
  showPopup('loading', 'Opening receipt...');
  const signedUrl = await getEMIFileUrl(record.file_name);
  hidePopup();
  if (!signedUrl) {
    updatePopup('error', 'Could not create receipt link.');
    return;
  }
  window.open(signedUrl, '_blank', 'noopener');
};

// ========================================
// 8. GET SIGNED URL FOR FILES
// ========================================
async function getEMIFileUrl(fileName) {
  try {
    const { data, error } = await supabase
      .storage
      .from('emi-files')
      .createSignedUrl(fileName, 3600); // Valid for 1 hour
    
    if (error || !data) {
      console.warn(`Failed to get signed URL for ${fileName}:`, error);
      return null;
    }
    
    return data.signedUrl;
  } catch (error) {
    console.error('Error getting signed URL:', error);
    return null;
  }
}

// ========================================
// 9. DELETE EMI RECORD
// ========================================
async function deleteEMIRecord(id, fileName, buttonElement) {
  confirmDeleteWithHold(
    "Are you sure you want to delete this EMI record?<br><b>This action cannot be undone.</b>",
    async () => {
      showPopup('loading', 'Deleting EMI record...');
      
      try {
        // Delete from database
        const { error: dbError } = await supabase
          .from('emi_record_table')
          .delete()
          .eq('id', id);
        
        if (dbError) {
          throw new Error(`Database delete failed: ${dbError.message}`);
        }
        
        // Delete from storage
        const { error: storageError } = await supabase
          .storage
          .from('emi-files')
          .remove([fileName]);
        
        if (storageError) {
          // Don't throw error for storage delete failures
        }
        
        // Remove row from table
        buttonElement.closest('tr').remove();
        
        // Update progress
        updateEMIProgress();
        
        updatePopup('success', 'EMI record deleted successfully!');
        
      } catch (error) {
        updatePopup('error', 'Failed to delete record: ' + error.message);
      }
    }
  );
}

// Make delete function globally available
window.deleteEMIRecord = deleteEMIRecord;

// ========================================
// 10. UPDATE EMI PROGRESS & COUNTERS (FIXED)
// ========================================
async function updateEMIProgress() {
  try {
    // Get all monthly EMI payments
    const { data, error } = await supabase
      .from('emi_record_table')
      .select('*')
      .eq('type', 'Monthly')
      .order('date_paid', { ascending: true });
    
    if (error) {
      console.warn('Failed to fetch EMI progress:', error);
      return;
    }
    
    const paidEMIs = data ? data.length : 0;
    const remainingEMIs = Math.max(0, EMI_CONFIG.totalEMIs - paidEMIs);
    
    // Update remaining EMIs display - FIXED TO USE CORRECT ID
    const remainingElement = document.getElementById('remainingEMIs');
    if (remainingElement) {
      remainingElement.textContent = remainingEMIs.toString();
    } else {
      console.warn('⚠️ Remaining EMIs element not found!');
    }
    
    // Update part payment status
    await updatePartPaymentStatus();
    
  } catch (error) {
    console.error('Failed to update EMI progress:', error);
  }
}

async function updatePartPaymentStatus() {
  try {
    // Get all part payments
    const { data, error } = await supabase
      .from('emi_record_table')
      .select('*')
      .eq('type', 'Part')
      .order('date_paid', { ascending: true });
    
    if (error) {
      console.warn('Failed to fetch part payments:', error);
      return;
    }
    
    const partPayments = data || [];
    
    // Update part payment status displays
    for (let i = 1; i <= 3; i++) {
      const statusElement = document.getElementById(`part${i}Status`);
      if (statusElement) {
        if (partPayments[i - 1]) {
          const payment = partPayments[i - 1];
          statusElement.textContent = `Paid ₹${payment.amount.toLocaleString('en-IN')} on ${new Date(payment.date_paid).toLocaleDateString('en-GB')}`;
          statusElement.style.color = '#28a745';
        } else {
          statusElement.textContent = 'Pending';
          statusElement.style.color = '#ffc107';
        }
      }
    }
    
  } catch (error) {
    console.error('Failed to update part payment status:', error);
  }
}

// ========================================
// 11. INITIALIZE EVERYTHING
// ========================================

// EMI data is loaded lazily when the EMI section is opened.

  function ensureSectionData(section) {
    if (section === 'docs') {
      ensureDocsLoaded();
      return;
    }
    if (section === 'emi') {
      initEMISystem();
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
    if (window.checkAnniversaryNotif) window.checkAnniversaryNotif('2025-06-27');
    document.querySelectorAll('.home-cover-card .status[data-due]').forEach(el => {
      const label = el.closest('.home-stat-card')?.querySelector('.home-stat-label')?.textContent?.trim() || 'Cover';
      if (window.checkInsuranceNotif) window.checkInsuranceNotif(el.getAttribute('data-due'));
      if (window.checkDocNotif) window.checkDocNotif(el.getAttribute('data-due'), label);
    });

    // ── Sync notification data to service worker for background checks ──
    syncNotifDataToSW();

    // ── Register periodic background sync for Sage notifications ──
    registerPeriodicSync();

    // Load only service records on startup because Home needs ODO / last service / next service.
    spinlogLazyState.serviceLoaded = true;
    loadServiceEntries();
  }

  // ── Sync notification-relevant data to service worker for background checks ──
  function syncNotifDataToSW() {
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return;
    // Gather insurance expiry dates from the cover cards
    const coverCards = document.querySelectorAll('.home-cover-card .status[data-due]');
    let earliestInsurance = null;
    coverCards.forEach(el => {
      const due = el.getAttribute('data-due');
      if (due && (!earliestInsurance || due < earliestInsurance)) earliestInsurance = due;
    });

    // EMI next due date (3rd of each month, starting Aug 2025)
    const emiStart = new Date(2025, 7, 3); // Aug 3, 2025
    const now = new Date();
    let nextEMI = new Date(now.getFullYear(), now.getMonth(), 3);
    if (nextEMI <= now) nextEMI.setMonth(nextEMI.getMonth() + 1);
    if (nextEMI < emiStart) nextEMI = emiStart;

    const payload = {
      insuranceExpiry: earliestInsurance || null,
      nextEMIDate: nextEMI.toISOString(),
      nextServiceDate: null, // Will be updated after service records load
      lastAppOpen: Date.now(),
    };

    navigator.serviceWorker.controller.postMessage({
      type: 'SPINLOG_SYNC_NOTIF_DATA',
      payload
    });
  }

  // ── Register periodic background sync ──
  async function registerPeriodicSync() {
    try {
      const reg = await navigator.serviceWorker.ready;
      if ('periodicSync' in reg) {
        const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
        if (status.state === 'granted') {
          await reg.periodicSync.register('spinlog-sage-notifs', {
            minInterval: 12 * 60 * 60 * 1000, // 12 hours
          });
        }
      }
    } catch (e) {
      // Periodic sync not supported — fallback is SW activation check
      console.log('[SpinLog] Periodic sync not available, using activation fallback');
    }
  }

  initApp();
});

// ════════════════════════════════════════════════════════════
// LAST PARKED LOCATION
// ════════════════════════════════════════════════════════════
(function() {
  const PARK_KEY = 'spinlogParkHistory';
  const PARK_MAX = 5;

  function getParkHistory() {
    try { return JSON.parse(localStorage.getItem(PARK_KEY) || '[]'); } catch { return []; }
  }
  function saveParkHistory(h) { localStorage.setItem(PARK_KEY, JSON.stringify(h)); }

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
        const history = getParkHistory();
        history.unshift(entry);
        if (history.length > PARK_MAX) history.pop();
        saveParkHistory(history);
        updateParkUI();
        showAppPopup('success', `Saved! ±${Math.round(accuracy)}m`);
        if (window.triggerParkingNotif) window.triggerParkingNotif();
        const addr = await reverseGeocode(lat, lng);
        if (addr) {
          const h = getParkHistory();
          if (h[0]?.timestamp === entry.timestamp) { h[0].address = addr; saveParkHistory(h); updateParkUI(); }
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

    list.querySelectorAll('.park-del-btn').forEach(btn => btn.addEventListener('click', () => {
      const h = getParkHistory(); h.splice(parseInt(btn.dataset.idx), 1); saveParkHistory(h); updateParkUI(); renderParkHistory();
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

  window.setupParkFeature = function() {
    updateParkUI();
    const mobileCard = document.getElementById('parkCardMobile');
    if (mobileCard) makeLongPress(mobileCard, saveCurrentParkLocation, renderParkHistory);
    document.getElementById('parkHistoryClose')?.addEventListener('click', closeParkModal);
    document.getElementById('parkHistoryModal')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeParkModal(); });
  };
})();

// ════════════════════════════════════════════════════════════
// COVER DATE EDITING — long-press cover cards
// ════════════════════════════════════════════════════════════
window.setupCoverDateEditing = function() {
  const COVER_KEY = 'spinlogCoverDates';
  const saved = (() => { try { return JSON.parse(localStorage.getItem(COVER_KEY) || '{}'); } catch { return {}; } })();

  document.querySelectorAll('.home-cover-card').forEach(card => {
    const label    = card.querySelector('.home-stat-label')?.textContent?.trim();
    const statusEl = card.querySelector('.status[data-due]');
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

  function makeLongPressCard(el, onLong, ms = 650) {
    let timer = null, fired = false, startX = 0, startY = 0;
    const MOVE_THRESHOLD = 10;
    const cancel = () => { clearTimeout(timer); timer = null; };
    el.addEventListener('pointerdown', (e) => { fired = false; startX = e.clientX; startY = e.clientY; timer = setTimeout(() => { fired = true; onLong(); }, ms); });
    el.addEventListener('pointerup',   cancel);
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('pointermove',  (e) => { if (timer && (Math.abs(e.clientX - startX) > MOVE_THRESHOLD || Math.abs(e.clientY - startY) > MOVE_THRESHOLD)) cancel(); });
  }

  document.querySelectorAll('.home-cover-card').forEach(card => {
    makeLongPressCard(card, () => {
      const statusEl = card.querySelector('.status[data-due]');
      const label    = card.querySelector('.home-stat-label')?.textContent?.trim();
      editTarget = { statusEl, label };
      if (titleEl) titleEl.innerHTML = `<i class="fas fa-calendar-pen"></i> ${label}`;
      if (input && statusEl) input.value = statusEl.getAttribute('data-due') || '';
      openModal();
    });
  });

  saveBtn?.addEventListener('click', () => {
    if (!editTarget || !input?.value) return;
    const { statusEl, label } = editTarget;
    statusEl.setAttribute('data-due', input.value);
    const dates = (() => { try { return JSON.parse(localStorage.getItem(COVER_KEY) || '{}'); } catch { return {}; } })();
    dates[label] = input.value;
    localStorage.setItem(COVER_KEY, JSON.stringify(dates));
    if (typeof window.updateCoverBadge === 'function') window.updateCoverBadge(statusEl);
    closeModal();
    if (typeof showPopup === 'function') {
      showPopup('success', 'Cover date updated!');
    }
  });

  closeBtn?.addEventListener('click', closeModal);
  modal?.addEventListener('click', e => { if (e.target === modal) closeModal(); });
};

// ════════════════════════════════════════════════════════════
// EMI HISTORY FILTERS
// ════════════════════════════════════════════════════════════
(function() {
  function setupEMIFilters() {
    const search = document.getElementById('emiHistorySearch');
    const typeFilter = document.getElementById('emiHistoryTypeFilter');
    const fromDate = document.getElementById('emiHistoryFromDate');
    const toDate = document.getElementById('emiHistoryToDate');
    const toggle = document.getElementById('emiHistoryFilterToggle');
    const filterPanel = document.getElementById('emiHistoryFilters');
    const clearBtn = document.getElementById('emiHistoryClearFilters');
    const typeButton = document.getElementById('emiHistoryTypeButton');
    const typeMenu = document.getElementById('emiHistoryTypeMenu');
    const typeValueEl = document.getElementById('emiHistoryTypeValue');
    const typeWrapper = document.querySelector('[data-emi-type-filter]');
    const table = document.querySelector('#emiRecordTable tbody');
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
        filterEMITable();
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
      filterEMITable();
    });

    function filterEMITable() {
      const query = search.value.toLowerCase().trim();
      const type = typeFilter?.value || '';
      const from = fromDate?.value || '';
      const to = toDate?.value || '';
      const rows = table.querySelectorAll('tr');

      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (!cells.length) return;
        const datePaid = cells[0]?.textContent?.trim() || '';
        const amount = cells[1]?.textContent?.trim() || '';
        const rowType = cells[2]?.textContent?.trim() || '';
        const text = (datePaid + ' ' + amount + ' ' + rowType).toLowerCase();

        let show = true;
        if (query && !text.includes(query)) show = false;
        if (type && rowType !== type) show = false;

        if (from || to) {
          const parts = datePaid.split('/');
          if (parts.length === 3) {
            const rowDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            if (from && rowDate < from) show = false;
            if (to && rowDate > to) show = false;
          }
        }

        row.style.display = show ? '' : 'none';
      });
    }

    let emiFilterTimer;
    search.addEventListener('input', () => { clearTimeout(emiFilterTimer); emiFilterTimer = setTimeout(filterEMITable, 150); });
    fromDate?.addEventListener('change', filterEMITable);
    toDate?.addEventListener('change', filterEMITable);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupEMIFilters);
  } else {
    setupEMIFilters();
  }
})();

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
            const rowDate = parsed.toISOString().slice(0, 10);
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
