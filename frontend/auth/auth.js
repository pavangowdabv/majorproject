/* ===== AUTH.JS — frontend auth client (talks to real backend) ===== */

// Change this to your deployed backend URL when hosting online
// e.g. 'https://your-backend.onrender.com/api/auth'
const API = (window.BACKEND_URL || 'http://localhost:4000') + '/api/auth';

/* ================================================================
   API CALLS
   ================================================================ */

/** POST /api/auth/signup — registers user, returns token immediately */
async function apiSignup({ firstName, lastName, email, phone, password }) {
  const res = await fetch(`${API}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName, lastName, email, phone, password }),
  });
  return res.json().then(data => ({ ok: res.ok, status: res.status, ...data }));
}

/** POST /api/auth/login — email/password login, returns token */
async function apiLoginPassword(identifier, password) {
  const res = await fetch(`${API}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  return res.json().then(data => ({ ok: res.ok, status: res.status, ...data }));
}

/* ================================================================
   SESSION  (JWT stored in localStorage)
   ================================================================ */
function saveSession(user, token) {
  localStorage.setItem('auth_user', JSON.stringify(user));
  localStorage.setItem('auth_token', token);
}
function getSession() { try { return JSON.parse(localStorage.getItem('auth_user')); } catch { return null; } }
function getToken() { return localStorage.getItem('auth_token'); }
function clearSession() { localStorage.removeItem('auth_user'); localStorage.removeItem('auth_token'); }
function setAuthState(state) {
  document.body?.setAttribute('data-auth-state', state);
  window.__forecastiqAuthState = state;
}

/* ================================================================
   NAVIGATION
   ================================================================ */
function redirectToDashboard() { window.location.href = '../index.html'; }
function redirectToLogin() { window.location.href = 'login.html'; }

async function guardAuth() {
  setAuthState('loading');
  const user = getSession();
  const token = getToken();

  if (!user || !token) {
    clearSession();
    setAuthState('unauthenticated');
    return;
  }

  try {
    const res = await fetch(`${API}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      setAuthState('authenticated');
      redirectToDashboard();
      return;
    }

    clearSession();
    setAuthState('unauthenticated');
  } catch {
    clearSession();
    setAuthState('unauthenticated');
  }
}

/* ================================================================
   VALIDATION HELPERS
   ================================================================ */
function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || '').trim()); }
function isPhone(v) { return /^\+?[\d\s\-()]{7,15}$/.test((v || '').trim()); }

function maskIdentifier(val) {
  if (!val) return '—';
  const v = val.trim();
  if (isEmail(v)) {
    const [user, domain] = v.split('@');
    return user.slice(0, Math.min(2, user.length)) + '****@' + domain;
  }
  const digits = v.replace(/\D/g, '');
  return '+** *****' + digits.slice(-4);
}

/* ================================================================
   UI UTILITIES
   ================================================================ */
function showAlert(id, type, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `alert-msg ${type} show`;
  el.innerHTML = `<i class="fa-solid ${alertIcon(type)}"></i><span>${msg}</span>`;
}
function hideAlert(id) {
  const el = document.getElementById(id);
  if (el) el.className = 'alert-msg';
}
function alertIcon(type) {
  return { info: 'fa-circle-info', success: 'fa-circle-check', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation' }[type] || 'fa-circle-info';
}

function setBtnLoading(btnId, loading, label = '') {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  // support both old (.btn-spinner/.btn-text) and new (.ap-spinner/.ap-btn-text) class names
  const spinner = btn.querySelector('.ap-spinner, .btn-spinner');
  const text = btn.querySelector('.ap-btn-text, .btn-text');
  btn.disabled = loading;
  if (spinner) spinner.classList.toggle('show', loading);
  if (text) {
    if (!text.dataset.original) text.dataset.original = text.textContent;
    text.textContent = loading ? label : text.dataset.original;
  }
}

/* ================================================================
   DARK MODE
   ================================================================ */
function initTheme() {
  const saved = localStorage.getItem('darkMode');
  if (saved === '1') document.documentElement.setAttribute('data-theme', 'dark');
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  btn.innerHTML = saved === '1' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
  btn.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem('darkMode', isDark ? '0' : '1');
    btn.innerHTML = isDark ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun"></i>';
  });
}

document.addEventListener('DOMContentLoaded', initTheme);
