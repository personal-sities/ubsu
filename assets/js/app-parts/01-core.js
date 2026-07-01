// ============================================================
//  CONFIG
// ============================================================
const ALOQA_CONFIG = window.ALOQA_CONFIG || {};
const SUPABASE_URL = (ALOQA_CONFIG.SUPABASE_URL || localStorage.getItem('supabase_url') || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = ALOQA_CONFIG.SUPABASE_ANON_KEY || localStorage.getItem('supabase_anon_key') || '';
const ENABLE_AMOCRM = ALOQA_CONFIG.ENABLE_AMOCRM === true || ALOQA_CONFIG.ENABLE_AMOCRM === 'true';
const ENABLE_ONLINEPBX = ALOQA_CONFIG.ENABLE_ONLINEPBX === true || ALOQA_CONFIG.ENABLE_ONLINEPBX === 'true';
const FUNCTIONS_BASE = (ALOQA_CONFIG.FUNCTIONS_BASE || (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : '')).replace(/\/$/, '');
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Supabase config topilmadi. .env ichida SUPABASE_URL va SUPABASE_ANON_KEY ni to'ldiring.");
}
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TASHKENT_TIMEZONE = 'Asia/Tashkent';
const WORKDAY_START_MINUTES = 9 * 60;
const WORKDAY_END_MINUTES = 18 * 60;
const FACE_CHECK_INTERVAL = 25000;
const FACE_FOUND_COOLDOWN_INTERVAL = 60000;
const FACE_SEARCH_INTERVAL = 1000;
const FACE_MONITOR_INTERVAL = FACE_FOUND_COOLDOWN_INTERVAL;
const FACE_RETRY_INTERVAL = FACE_SEARCH_INTERVAL;
const STABLE_HIT_REQUIRED = 3;
const FACE_MIN_VISIBLE_AREA = 0.015;
const FACE_MISS_REQUIRED = 3;
const FACE_LOSS_WARNING_DELAY_SEC = 120;
const AFK_GRACE_SEC       = 600;
const BREAK_LIMIT_SEC     = 1800;
const AUTO_END_HOUR       = 18;
const AUTO_END_MIN        = 0;
const AUTO_END_TASK_WARNING_INTERVAL_MS = 5 * 60 * 1000;
const LATE_AFTER_MINUTES  = WORKDAY_START_MINUTES;
const HALF_DAY_START_MINUTES = 11 * 60;
const HALF_DAY_END_MINUTES   = 15 * 60;
const TARGET_WORK_SEC_PER_DAY = (WORKDAY_END_MINUTES - WORKDAY_START_MINUTES) * 60;
const NOTIF_POLL_INTERVAL = 30000;
const REALTIME_SCHEMA = 'public';
const ABSENCE_START_KEY = 'aloqa_absence_start_date';

// ============================================================
//  THEME
// ============================================================
let currentTheme = localStorage.getItem('aloqa_theme') || 'light';
function applyTheme(th) {
  document.documentElement.setAttribute('data-theme', th);
  ['themeToggle','themeToggle2','themeToggle3','themeToggle4'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = th === 'light';
  });
  localStorage.setItem('aloqa_theme', th);
  currentTheme = th;
}
function toggleTheme() {
  applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
  ['themeToggle','themeToggle2','themeToggle3','themeToggle4'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = currentTheme === 'light';
  });
}
applyTheme(currentTheme);

// ============================================================
//  TOAST
// ============================================================
function toast(type, title, msg, duration = 3500) {
  const icons = { success:'✅', error:'❌', warn:'⚠️', info:'ℹ️' };
  const c = document.getElementById('toast-container');
  const d = document.createElement('div');
  d.className = `toast ${type}`;
  d.innerHTML = `<span class="toast-icon">${icons[type]||'ℹ️'}</span><div class="toast-body"><div class="toast-title">${title}</div><div class="toast-msg">${msg||''}</div></div>`;
  c.appendChild(d);
  setTimeout(() => {
    d.classList.add('removing');
    setTimeout(() => d.remove(), 320);
  }, duration);
}

// ============================================================
//  PWA
// ============================================================
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferredPrompt = e;
  const b = document.getElementById('installBanner');
  if (b && !localStorage.getItem('pwa_dismissed')) b.style.display = 'block';
});
function installPWA() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(() => { deferredPrompt = null; dismissInstall(); });
}
function dismissInstall() {
  localStorage.setItem('pwa_dismissed','1');
  const b = document.getElementById('installBanner');
  if (b) b.style.display = 'none';
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ============================================================
//  SIDEBAR
// ============================================================
function toggleSidebar(){document.getElementById('sidebar').classList.toggle('open');document.getElementById('sb_overlay').classList.toggle('open');}
function closeSidebar(){document.getElementById('sidebar').classList.remove('open');document.getElementById('sb_overlay').classList.remove('open');}
