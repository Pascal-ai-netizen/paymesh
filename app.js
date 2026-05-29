// ═══════════════════════════════════════════
// PAYMESH SECURITY MODULE
// Runs immediately — before any Firebase or app logic.
// ═══════════════════════════════════════════

(function PM_SECURITY() {
  // ── 0. HTTPS ENFORCEMENT ──
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    location.replace('https:' + location.href.slice(5));
  }

  // ── 1. DEVTOOLS DETECTION (size-based, works on mobile Chrome/Firefox DevTools) ──
  const DT_THRESHOLD = 160; // px — DevTools panel is almost always >160px
  let _devToolsOpen  = false;

  function checkDevTools() {
    const widthDiff  = window.outerWidth  - window.innerWidth;
    const heightDiff = window.outerHeight - window.innerHeight;
    const open = widthDiff > DT_THRESHOLD || heightDiff > DT_THRESHOLD;
    if (open && !_devToolsOpen) {
      _devToolsOpen = true;
      _onDevToolsOpen();
    } else if (!open) {
      _devToolsOpen = false;
    }
  }

  function _onDevToolsOpen() {
    // Immediately wipe all sensitive DOM values
    try {
      const balEl = document.getElementById('wallet-balance');
      if (balEl) balEl.textContent = '••••••';
      const nameEl = document.getElementById('display-name');
      if (nameEl) nameEl.textContent = 'Hi 👋';
      // Wipe all form inputs that might contain sensitive data
      document.querySelectorAll('input').forEach(function(i) { i.value = ''; });
    } catch(e) {}
    // Clear session balance from storage
    try { sessionStorage.removeItem('pm_balance'); } catch(e) {}
    // Force back to login screen regardless of device
    try {
      document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
      const loginScreen = document.getElementById('screen-login');
      if (loginScreen) loginScreen.classList.add('active');
    } catch(e) {}
    // Also call showScreen if available
    if (typeof showScreen === 'function' && window.CURRENT_USER && window.CURRENT_USER.phone) {
      showScreen('screen-login');
    }
  }

  setInterval(checkDevTools, 1000);

  // ── 2. KEYBOARD SHORTCUTS — block F12, Ctrl+Shift+I/J/C/U, Ctrl+U ──
  document.addEventListener('keydown', function(e) {
    // F12
    if (e.key === 'F12') { e.preventDefault(); e.stopImmediatePropagation(); return false; }
    // Ctrl/Cmd + Shift + I, J, C
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i','I','j','J','c','C'].includes(e.key)) {
      e.preventDefault(); e.stopImmediatePropagation(); return false;
    }
    // Ctrl + U (view source)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'u' || e.key === 'U')) {
      e.preventDefault(); e.stopImmediatePropagation(); return false;
    }
    // Ctrl + S (save page)
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault(); e.stopImmediatePropagation(); return false;
    }
  }, true);

  // ── 3. RIGHT-CLICK DISABLE ──
  document.addEventListener('contextmenu', function(e) {
    e.preventDefault(); return false;
  }, true);

  // ── 4. PRINT / SCREENSHOT DETECTION — blank the page ──
  const _printStyle = document.createElement('style');
  _printStyle.textContent = '@media print { body * { visibility: hidden !important; } body::after { content: "PayMesh content cannot be printed."; visibility: visible !important; position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); font-size: 18px; color: #333; } }';
  document.head.appendChild(_printStyle);

  window.addEventListener('beforeprint', function() {
    document.body.style.filter = 'blur(20px)';
  });
  window.addEventListener('afterprint', function() {
    document.body.style.filter = '';
  });

  // ── 5. CONSOLE WIPE — clear any logged sensitive data ──
  // Override console methods to suppress accidental data leaks in prod
  const _noop = function() {};
  ['log','warn','info','debug','table','dir'].forEach(function(m) {
    try { console[m] = _noop; } catch(e) {}
  });
  // Keep console.error for critical crash visibility

  // ── 6. CLIPBOARD HIJACK PROTECTION ──
  // Intercept copy — if user somehow selects sensitive text, sanitize it
  document.addEventListener('copy', function(e) {
    const sel = window.getSelection ? window.getSelection().toString() : '';
    // Block copying of anything that looks like a UPI ID or balance amount
    if (/[@]\w+/.test(sel) || /₹[\d,]+/.test(sel)) {
      e.preventDefault();
      e.clipboardData && e.clipboardData.setData('text/plain', '');
    }
  }, true);

  // ── 7. IFRAME EMBEDDING BLOCK (Clickjacking) ──
  if (window.top !== window.self) {
    window.top.location = window.self.location;
  }

  // ── 8. SCREENSHOT API DETECTION (Visibility + focus loss) ──
  // When user switches away (possible screenshot tool), mask balance
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      const balEl = document.getElementById('wallet-balance');
      if (balEl) { balEl.dataset._pmBal = balEl.textContent; balEl.textContent = '••••'; }
    } else {
      const balEl = document.getElementById('wallet-balance');
      if (balEl && balEl.dataset._pmBal) { balEl.textContent = balEl.dataset._pmBal; }
    }
  });

})(); // END PM_SECURITY

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  doc, setDoc, updateDoc, getDoc, deleteDoc,
  collection, addDoc, query, where, orderBy, limit,
  runTransaction,
  onSnapshot,
  getDocFromServer
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDKs_5eQADpVoFgoRhTJea-SGW0205C9Wc",
  authDomain: "paymesh-7a190.firebaseapp.com",
  projectId: "paymesh-7a190",
  storageBucket: "paymesh-7a190.firebasestorage.app",
  messagingSenderId: "64830673482",
  appId: "1:64830673482:web:5722735cf616109b500cb3"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

const PAYMESH_UPI = "utkarshkk@yesfam";

const UPI_REGEX = /^[a-zA-Z0-9.\-_+]+@(ybl|oksbi|okaxis|okicici|okhdfcbank|paytm|apl|ibl|upi|axl|airtel|jio|fbl|barodampay|centralbank|cmsidfc|dbs|equitas|federal|hsbc|idbi|idfc|indus|kotak|lvb|mahb|nsdl|pnb|postbank|psb|rbl|sbi|sc|scmobile|shbk|syndicate|tjsb|uco|union|united|vijb|yesfam|yesbank|icici|hdfc|axis|sib|dcb|karb|kvb|lax|tmb|csb|dlb|apgvb|aubank|bdbl|bgvb|bkid|bocl|bsbl|cbin|ccl|cie|citibank|csbcoin|dlxb|esfbl|fino|gbcoin|hsbc|idfcfirst|ikwik|indbank|iob|jkb|jsbl|kbl|kmbl|kscb|kvgb|mahagramin|nainital|nkgsb|nmgb|obcfin|payzapp|pingpay|pkgb|psb|qfix|rajgovt|saraswat|sbm|scbl|shb|snapwork|spices|svcbank|tjsb|ubi|uboi|ucb|ucobank|unionbank|utbi|vardhman|vbhvn|vijayabank|vitp|wpay|yapl|yesb)$/i;

const CURRENT_USER = { phone: "", name: "", upi: "" };
window.CURRENT_USER = CURRENT_USER; // expose so inline scripts can check session

// ═══════════════════════════════════════════
// DEVICE TOKEN — single-device session lock
// A random token is generated on each login and stored BOTH in localStorage
// AND in Firestore on the user doc. On every init, we compare them.
// If another device logged in, their token overwrote Firestore → mismatch → kick out.
// ═══════════════════════════════════════════

function generateDeviceToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map(b => b.toString(16).padStart(2,'0')).join('');
}

function getLocalToken()        { return sessionStorage.getItem('pm_device_token') || null; }
function setLocalToken(token)   { sessionStorage.setItem('pm_device_token', token); }
function clearLocalToken()      { sessionStorage.removeItem('pm_device_token'); }

// ═══════════════════════════════════════════
// PIN BRUTE-FORCE LOCKOUT
// Max 5 attempts then 10-minute cooldown.
// State lives in sessionStorage so it resets on fresh browser session
// but persists across same-tab refreshes (harder to bypass than memory).
// ═══════════════════════════════════════════

const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MS   = 10 * 60 * 1000; // 10 minutes

function getPinAttempts()  { return parseInt(sessionStorage.getItem('pm_pin_attempts') || '0', 10); }
function setPinAttempts(n) { sessionStorage.setItem('pm_pin_attempts', String(n)); }
function getPinLockedUntil()  { return parseInt(sessionStorage.getItem('pm_pin_locked_until') || '0', 10); }
function setPinLockedUntil(t) { sessionStorage.setItem('pm_pin_locked_until', String(t)); }
function resetPinAttempts()   { sessionStorage.removeItem('pm_pin_attempts'); sessionStorage.removeItem('pm_pin_locked_until'); }

function isPinLocked() {
  const until = getPinLockedUntil();
  if (!until) return false;
  if (Date.now() < until) return true;
  resetPinAttempts(); // lockout expired — clear it
  return false;
}

function pinLockoutRemaining() {
  const ms = getPinLockedUntil() - Date.now();
  if (ms <= 0) return '';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ═══════════════════════════════════════════
// PIN STATE
// PIN hash is stored in FIRESTORE (users/<phone>.pinHash) so it follows the account,
// not the device. localStorage is used only as a fast cache — always verified against Firestore.
// ═══════════════════════════════════════════

let _pinBuffer   = '';
let _pinMode     = null;   // 'verify' | 'setup-new' | 'setup-confirm'
let _pinTemp     = '';
let _pinCallback = null;
let _pinReject   = null;

// Cache: written after Firestore save, read for quick local check
function getCachedPinHash()        { return localStorage.getItem('pm_pin_' + CURRENT_USER.phone) || null; }
function setCachedPinHash(hash)    { if (CURRENT_USER.phone) localStorage.setItem('pm_pin_' + CURRENT_USER.phone, hash); }
function clearCachedPinHash()      { if (CURRENT_USER.phone) localStorage.removeItem('pm_pin_' + CURRENT_USER.phone); }
function hasPinSet()               { return !!getCachedPinHash(); }

async function savePinToFirestore(hash) {
  await updateDoc(doc(db, "users", CURRENT_USER.phone), { pinHash: hash });
  setCachedPinHash(hash);
}
async function removePinFromFirestore() {
  await updateDoc(doc(db, "users", CURRENT_USER.phone), { pinHash: null });
  clearCachedPinHash();
}

// Called on login/init — syncs pinHash from Firestore into local cache
function syncPinCache(userData) {
  if (userData.pinHash) {
    setCachedPinHash(userData.pinHash);
  } else {
    clearCachedPinHash();
  }
}

async function hashPin(pin) {
  const buf  = new TextEncoder().encode(pin + ':paymesh:' + CURRENT_USER.phone);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ═══════════════════════════════════════════
// REMEMBER-ME TOGGLE STATE
// ═══════════════════════════════════════════

let _rememberMe = false;

// ═══════════════════════════════════════════
// PIN OVERLAY — promise-based API
// ═══════════════════════════════════════════

function requirePin(title = 'Enter PIN', sub = 'Required to complete this action') {
  return new Promise((resolve, reject) => {
    if (!hasPinSet()) { resolve(); return; }
    // Lockout check
    if (isPinLocked()) {
      reject(new Error(`PIN locked. Try again in ${pinLockoutRemaining()}.`));
      alert(`Too many wrong PINs. Try again in ${pinLockoutRemaining()}.`);
      return;
    }
    _pinMode     = 'verify';
    _pinBuffer   = '';
    _pinCallback = resolve;
    _pinReject   = reject;
    document.getElementById('pin-overlay-title').textContent  = title;
    document.getElementById('pin-overlay-sub').textContent    = sub;
    document.getElementById('pin-overlay-cancel').textContent = 'Cancel';
    const msg = document.getElementById('pin-msg');
    msg.className = 'msg'; msg.textContent = '';
    updatePinDots();
    document.getElementById('pin-overlay').classList.remove('hidden');
  });
}

// Expose PIN functions for QT module
window.requirePin = requirePin;
window.hasPinSet  = hasPinSet;

window.cancelPinOverlay = function() {
  document.getElementById('pin-overlay').classList.add('hidden');
  _pinBuffer = ''; _pinMode = null; _pinTemp = '';
  const rej = _pinReject;
  _pinReject   = null;
  _pinCallback = null;
  if (rej) rej(new Error('PIN cancelled'));
}

window.pinKey = function(digit) {
  if (_pinBuffer.length >= 6) return;
  _pinBuffer += digit;
  updatePinDots();
  if (_pinBuffer.length === 6) setTimeout(() => handlePinComplete(), 120);
}

window.pinBackspace = function() {
  if (_pinBuffer.length > 0) { _pinBuffer = _pinBuffer.slice(0,-1); updatePinDots(); }
}

function updatePinDots() {
  for (let i = 0; i < 6; i++) {
    const d = document.getElementById('pd' + i);
    if (!d) return;
    d.classList.toggle('filled', i < _pinBuffer.length);
    d.classList.remove('error');
  }
}

function flashPinError() {
  for (let i = 0; i < 6; i++) {
    const d = document.getElementById('pd' + i);
    if (d) d.classList.add('filled','error');
  }
  if (navigator.vibrate) navigator.vibrate([80,40,80]);
  setTimeout(() => { _pinBuffer = ''; updatePinDots(); }, 700);
}

async function handlePinComplete() {
  if (_pinMode === 'verify') {
    // Lockout check (re-check in case timer expired between overlay open and submit)
    if (isPinLocked()) {
      document.getElementById('pin-overlay').classList.add('hidden');
      _pinBuffer = ''; _pinMode = null;
      alert(`Too many wrong PINs. Try again in ${pinLockoutRemaining()}.`);
      const rej = _pinReject; _pinReject = null; _pinCallback = null;
      if (rej) rej(new Error('PIN locked'));
      return;
    }
    const stored  = getCachedPinHash();
    const entered = await hashPin(_pinBuffer);
    if (entered === stored) {
      resetPinAttempts(); // success — clear fail counter
      document.getElementById('pin-overlay').classList.add('hidden');
      _pinBuffer = ''; _pinMode = null;
      if (_pinCallback) { _pinCallback(); _pinCallback = null; }
    } else {
      const attempts = getPinAttempts() + 1;
      setPinAttempts(attempts);
      const remaining = PIN_MAX_ATTEMPTS - attempts;
      if (attempts >= PIN_MAX_ATTEMPTS) {
        setPinLockedUntil(Date.now() + PIN_LOCKOUT_MS);
        resetPinAttempts(); // clear counter now that lockout is set
        document.getElementById('pin-overlay').classList.add('hidden');
        _pinBuffer = ''; _pinMode = null;
        const rej = _pinReject; _pinReject = null; _pinCallback = null;
        alert('Too many wrong PINs. Locked for 10 minutes.');
        if (rej) rej(new Error('PIN locked'));
      } else {
        showMsg(document.getElementById('pin-msg'), 'error', `Incorrect PIN. ${remaining} attempt${remaining !== 1 ? 's' : ''} left.`);
        flashPinError();
      }
    }
  } else if (_pinMode === 'setup-new') {
    _pinTemp   = _pinBuffer;
    _pinBuffer = '';
    _pinMode   = 'setup-confirm';
    document.getElementById('pin-overlay-title').textContent = 'Confirm PIN';
    document.getElementById('pin-overlay-sub').textContent   = 'Enter your PIN again to confirm';
    updatePinDots();
  } else if (_pinMode === 'setup-confirm') {
    if (_pinBuffer === _pinTemp) {
      const hash = await hashPin(_pinBuffer);
      try {
        await savePinToFirestore(hash);   // saves to Firestore + local cache
        resetPinAttempts(); // new PIN set — clear any lingering fail count
        _pinBuffer = ''; _pinMode = null; _pinTemp = '';
        document.getElementById('pin-overlay').classList.add('hidden');
        refreshPinSettingsUI();
        if (_pinCallback) { _pinCallback(); _pinCallback = null; }
      } catch(e) {
        showMsg(document.getElementById('pin-msg'), 'error', 'Error saving PIN. Check internet.');
        _pinBuffer = ''; updatePinDots();
      }
    } else {
      showMsg(document.getElementById('pin-msg'), 'error', 'PINs don\'t match. Try again from the start.');
      flashPinError();
      setTimeout(() => {
        _pinMode = 'setup-new'; _pinTemp = ''; _pinBuffer = '';
        document.getElementById('pin-overlay-title').textContent = 'Set a 6-Digit PIN';
        document.getElementById('pin-overlay-sub').textContent   = 'Choose a PIN for transactions';
        document.getElementById('pin-msg').className = 'msg';
        document.getElementById('pin-msg').textContent = '';
        updatePinDots();
      }, 900);
    }
  }
}

// ═══════════════════════════════════════════
// PIN SETTINGS SCREEN
// ═══════════════════════════════════════════

function refreshPinSettingsUI() {
  const set        = hasPinSet();
  const dot        = document.getElementById('pin-status-dot');
  const text       = document.getElementById('pin-status-text');
  const btn        = document.getElementById('pin-action-btn');
  const rmBtn      = document.getElementById('pin-remove-btn');
  const homePinBtn = document.getElementById('home-pin-btn');
  if (dot)        dot.style.background = set ? 'var(--em)' : 'var(--text3)';
  if (text)       text.textContent     = set ? 'PIN is set ✓' : 'No PIN set';
  if (btn)        btn.textContent      = set ? 'Change PIN' : 'Set PIN';
  if (rmBtn)      rmBtn.style.display  = set ? 'block' : 'none';
  if (homePinBtn) homePinBtn.classList.toggle('pin-set', set);
}

window.startPinSetup = async function() {
  const msg = document.getElementById('pin-settings-msg');
  msg.className = 'msg'; msg.textContent = '';
  const isChanging = hasPinSet();

  if (isChanging) {
    try { await requirePin('Verify Current PIN', 'Enter your existing PIN to change it'); }
    catch(e) { return; }
  }

  _pinMode     = 'setup-new';
  _pinBuffer   = '';
  _pinTemp     = '';
  const successMsg = isChanging ? 'PIN updated!' : 'PIN set successfully!';
  _pinCallback = () => showMsg(document.getElementById('pin-settings-msg'), 'success', successMsg);
  _pinReject   = null;
  document.getElementById('pin-overlay-title').textContent  = isChanging ? 'Set New PIN' : 'Set a 6-Digit PIN';
  document.getElementById('pin-overlay-sub').textContent    = 'Choose a PIN for transactions';
  document.getElementById('pin-overlay-cancel').textContent = 'Cancel';
  const omsg = document.getElementById('pin-msg');
  omsg.className = 'msg'; omsg.textContent = '';
  updatePinDots();
  document.getElementById('pin-overlay').classList.remove('hidden');
}

window.removePin = async function() {
  try { await requirePin('Verify PIN', 'Enter your PIN to remove it'); }
  catch(e) { return; }
  try {
    await removePinFromFirestore();
    refreshPinSettingsUI();
    showMsg(document.getElementById('pin-settings-msg'), 'success', 'PIN removed.');
  } catch(e) {
    showMsg(document.getElementById('pin-settings-msg'), 'error', 'Error removing PIN. Check internet.');
  }
}

// ═══════════════════════════════════════════
// REMEMBER-ME TOGGLE
// ═══════════════════════════════════════════

window.toggleRemember = function() {
  _rememberMe = !_rememberMe;
  const track = document.getElementById('remember-track');
  if (track) track.classList.toggle('on', _rememberMe);
}

// ═══════════════════════════════════════════
// EXISTING-DEVICE DETECTION
// On a new device pm_known_phones will be empty, so new-user fields always show.
// BUT — if Firestore says the account exists we auto-switch to sign-in mode.
// ═══════════════════════════════════════════

function detectExistingUser(phone) {
  const knownPhones = JSON.parse(localStorage.getItem('pm_known_phones') || '[]');
  const isKnown = knownPhones.includes(phone);
  _applyLoginMode(isKnown);
}

function _applyLoginMode(isKnown) {
  const newFields = document.getElementById('login-new-fields');
  const remRow    = document.getElementById('login-remember-row');
  const btn       = document.getElementById('login-btn');
  if (isKnown) {
    if (newFields) newFields.style.display = 'none';
    if (remRow)    remRow.classList.remove('hidden');
    if (btn)       btn.querySelector('span').textContent = 'Sign In';
  } else {
    if (newFields) newFields.style.display = '';
    if (remRow)    remRow.classList.add('hidden');
    if (btn)       btn.querySelector('span').textContent = 'Get Started';
    _rememberMe = false;
    const track = document.getElementById('remember-track');
    if (track) track.classList.remove('on');
  }
}

function addKnownPhone(phone) {
  const known = JSON.parse(localStorage.getItem('pm_known_phones') || '[]');
  if (!known.includes(phone)) { known.push(phone); localStorage.setItem('pm_known_phones', JSON.stringify(known)); }
}

// ═══════════════════════════════════════════
// SCANNER / STREAM STATE
// ═══════════════════════════════════════════

let scannerStream   = null;
let scannerInterval = null;
let detectedQR      = null;

let unsubBalance = null;
let unsubTxns    = null;
let unsubLoadNotif = null; // watches pending UTR requests for admin approval

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

function showMsg(el, type, text) {
  el.className = `msg ${type}`;
  el.textContent = text;
}

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

// ═══════════════════════════════════════════
// CONFETTI
// ═══════════════════════════════════════════

function launchConfetti(count = 60) {
  const colors = ['#00E87A','#00FFA3','#FFB830','#FF4D6A','#4D9FFF','#ffffff'];
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      el.style.cssText = `left:${Math.random()*100}vw;top:-10px;background:${colors[Math.floor(Math.random()*colors.length)]};width:${4+Math.random()*8}px;height:${4+Math.random()*8}px;border-radius:${Math.random()>0.5?'50%':'2px'};animation-duration:${1.5+Math.random()*2}s;animation-delay:${Math.random()*0.5}s;`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 4000);
    }, i * 20);
  }
}

// ═══════════════════════════════════════════
// RIPPLE
// ═══════════════════════════════════════════

function addRipple(e) {
  const btn  = e.currentTarget;
  const r    = document.createElement('div');
  const rect = btn.getBoundingClientRect();
  const size = Math.max(btn.offsetWidth, btn.offsetHeight);
  r.className = 'ripple';
  r.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX-rect.left-size/2}px;top:${e.clientY-rect.top-size/2}px;`;
  btn.appendChild(r);
  setTimeout(() => r.remove(), 700);
}

// ═══════════════════════════════════════════
// OVERLAY
// ═══════════════════════════════════════════

function showOverlay(icon, title, sub) {
  if (typeof window.showPaymentSuccess === 'function') {
    // Payment animation morphs into success state — no need to also open success-overlay.
    // Just run confetti after the animation resolves.
    window.showPaymentSuccess(title, sub).then(function() {
      launchConfetti(70);
      showScreen('screen-home');
    });
    return;
  }
  // Fallback: no payment animation available — use plain success overlay
  document.getElementById('overlay-title').textContent = title;
  document.getElementById('overlay-sub').textContent   = sub;
  document.getElementById('success-overlay').classList.remove('hidden');
  launchConfetti(70);
}
window.showOverlay = showOverlay;

window.closeOverlay = function() {
  document.getElementById('success-overlay').classList.add('hidden');
  showScreen('screen-home');
}

// ═══════════════════════════════════════════
// SCREENS
// ═══════════════════════════════════════════

window.showScreen = function(id) {
  const target = document.getElementById(id);
  if (!target) { console.warn('Screen not found:', id); return; }
  // Hide splash and cancel safety timeout
  const splash = document.getElementById('splash-screen');
  if (splash) splash.style.display = 'none';
  if (window.__PM_SPLASH_TIMEOUT) { clearTimeout(window.__PM_SPLASH_TIMEOUT); window.__PM_SPLASH_TIMEOUT = null; }
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  target.classList.add('active');
  target.scrollTop = 0;

  if (id === 'screen-home')    loadHomeData();
  if (id !== 'screen-home')    _homeListenersActive = false;
  if (id === 'screen-receive') generateReceiveQR();
  if (id === 'screen-pin')     refreshPinSettingsUI();
  if (id === 'screen-copilot') ariaLoadDashboard();
  if (id === 'screen-load') {
    document.getElementById('display-upi').textContent = PAYMESH_UPI;
    buildUPILink();
  }
  if (id === 'screen-voucher') {
    const m = document.getElementById('voucher-msg');
    if (m) { m.className = 'msg'; m.textContent = ''; }
    _hideVoucherFraudPanel();
    _voucherFraudOverrideGranted = false;
    _voucherFraudLastAmount = 0; // reset so re-entering same amount fires a fresh analysis
    const vBtn = document.getElementById('voucher-submit-btn');
    if (vBtn) { vBtn.disabled = false; vBtn.style.opacity = '1'; vBtn.style.cursor = 'pointer'; vBtn.textContent = 'Generate Payment Link'; }
    loadVouchersFromFirestore();
    loadClaimedVouchers(); // Phase 1: show any vouchers awaiting your manual UPI send
  }
  if (id === 'screen-send') {
    const m = document.getElementById('send-msg');
    if (m) { m.className = 'msg'; m.textContent = ''; }
    _hideFraudPanel();
    _fraudOverrideGranted = false;
    const noteGroup = document.getElementById('send-note-group');
    if (noteGroup) noteGroup.style.display = 'none';
    const sendBtn = document.getElementById('send-submit-btn');
    if (sendBtn) { sendBtn.disabled = false; sendBtn.style.opacity = '1'; sendBtn.style.cursor = 'pointer'; sendBtn.textContent = 'Send Now'; }

    // §6: Proactive late-night advisory
    const sendAdvisory = document.getElementById('aria-send-advisory');
    if (sendAdvisory) {
      const hour = new Date().getHours();
      const isNightNow = hour >= 22 || hour < 5;
      const ariaData = ariaGetData();
      const recentRed = (ariaData.log || []).filter(e =>
        (e.tier === 'red' || e.tier === 'blocked') &&
        (Date.now() - new Date(e.time).getTime()) < 86400000
      ).length;
      if (isNightNow) {
        sendAdvisory.style.display = '';
        sendAdvisory.innerHTML = `<span>🌙</span> Late-night transactions are higher risk. Aria is watching closely.`;
        sendAdvisory.className = 'aria-send-advisory night';
      } else if (recentRed > 0) {
        sendAdvisory.style.display = '';
        sendAdvisory.innerHTML = `<span>⚠️</span> Aria flagged a transaction recently. Stay alert.`;
        sendAdvisory.className = 'aria-send-advisory warning';
      } else {
        sendAdvisory.style.display = 'none';
      }
    }
  }
}

function showScreen(id) { window.showScreen(id); }

// ═══════════════════════════════════════════
// UPI DEEPLINK (Load screen)
// ═══════════════════════════════════════════

function buildUPILink() {
  const amtInput = document.getElementById('load-amount');
  const existing = document.getElementById('upi-pay-btn');
  if (existing) existing.remove();
  if (amtInput._upiLinkListener) {
    amtInput.removeEventListener('input', amtInput._upiLinkListener);
    amtInput._upiLinkListener = null;
  }
  const btn = document.createElement('a');
  btn.id = 'upi-pay-btn';
  btn.style.cssText = `display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:14px;margin:12px 0;background:linear-gradient(135deg,rgba(0,232,122,.12),rgba(0,232,122,.06));border:1px solid rgba(0,232,122,.25);border-radius:14px;color:var(--em);font:700 14px/1 var(--sans);text-decoration:none;cursor:pointer;transition:all .2s;`;
  btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>Open GPay / PhonePe to Pay`;
  function updateLink() {
    const amt = parseFloat(amtInput.value);
    if (amt && amt > 0) {
      btn.href = `upi://pay?pa=${encodeURIComponent(PAYMESH_UPI)}&pn=${encodeURIComponent('PayMesh')}&am=${amt.toFixed(2)}&cu=INR&tn=${encodeURIComponent('PayMesh Wallet Load')}`;
      btn.style.opacity = '1';
      btn.style.pointerEvents = '';
    } else {
      // No valid amount — disable link so it doesn't fire with am=NaN or am=
      btn.removeAttribute('href');
      btn.style.opacity = '0.45';
      btn.style.pointerEvents = 'none';
    }
  }
  amtInput._upiLinkListener = updateLink;
  amtInput.addEventListener('input', updateLink);
  updateLink();
  const upiBox = document.getElementById('display-upi');
  if (upiBox && upiBox.parentNode) {
    upiBox.parentNode.insertBefore(btn, upiBox.nextSibling);
  } else {
    // Fallback: insert after amount input
    amtInput.parentNode && amtInput.parentNode.insertBefore(btn, amtInput.nextSibling);
  }
}

// ═══════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════

window.loginUser = async function() {
  const phone = document.getElementById('login-phone').value.trim();
  const msg   = document.getElementById('login-msg');
  const btn   = document.querySelector('#screen-login .btn-primary');

  if (!/^\d{10}$/.test(phone)) { showMsg(msg,'error','Enter a valid 10-digit phone number'); return; }

  const knownPhones   = JSON.parse(localStorage.getItem('pm_known_phones') || '[]');
  const isKnownDevice = knownPhones.includes(phone);

  let nameInput, upiInput;
  if (!isKnownDevice) {
    nameInput = document.getElementById('login-name').value.trim();
    upiInput  = document.getElementById('login-upi').value.trim();
    if (!nameInput)              { showMsg(msg,'error','Enter your name'); return; }
    if (!upiInput)               { showMsg(msg,'error','Enter your UPI ID'); return; }
    if (!UPI_REGEX.test(upiInput)){ showMsg(msg,'error','Invalid UPI ID. Use format like name@ybl'); return; }
  }

  if (btn) { btn.disabled = true; btn.querySelector('span').textContent = 'Please wait…'; }
  showMsg(msg,'success','Verifying account...');

  try {
    const userRef  = doc(db, "users", phone);
    const userSnap = await getDocFromServer(userRef);
    let finalName, finalUpi;

    if (userSnap.exists()) {
      const data = userSnap.data();
      finalName = data.name;
      finalUpi  = data.upi;
      // Sync PIN cache from Firestore
      syncPinCache(data);
      showMsg(msg, 'success', `Welcome back, ${finalName}!`);
    } else {
      // Brand new account — only allow creation from new-device form
      if (isKnownDevice) {
        // Edge case: account was deleted but phone is still in pm_known_phones
        // Remove stale entry and show full form
        const known = JSON.parse(localStorage.getItem('pm_known_phones') || '[]');
        localStorage.setItem('pm_known_phones', JSON.stringify(known.filter(p => p !== phone)));
        _applyLoginMode(false);
        if (btn) { btn.disabled = false; btn.querySelector('span').textContent = 'Get Started'; }
        showMsg(msg, 'error', 'Account not found. Please fill in all details to register.');
        return;
      }
      finalName = nameInput;
      finalUpi  = upiInput;
      await setDoc(userRef, {
        name: finalName, phone, upi: finalUpi, balance: 0,
        pinHash: null,
        createdAt: new Date().toISOString()
      });
      showMsg(msg, 'success', `Account created! Welcome, ${finalName}!`);
    }

    addKnownPhone(phone);
    // Write to localStorage so session survives tab close / app reopen (original behavior)
    localStorage.setItem('pm_name', finalName);
    localStorage.setItem('pm_phone', phone);
    localStorage.setItem('pm_upi', finalUpi);
    const _fp = generateDeviceToken();
    localStorage.setItem('pm_fp', _fp);
    // Mirror to sessionStorage for fast in-session reads
    sessionStorage.setItem('pm_name', finalName);
    sessionStorage.setItem('pm_phone', phone);
    sessionStorage.setItem('pm_upi', finalUpi);
    sessionStorage.setItem('pm_fp', _fp);


    CURRENT_USER.name  = finalName;
    CURRENT_USER.phone = phone;
    CURRENT_USER.upi   = finalUpi;

    if (btn) { btn.disabled = false; btn.querySelector('span').textContent = isKnownDevice ? 'Sign In' : 'Get Started'; }

    setTimeout(() => {
      refreshPinSettingsUI();
      showScreen('screen-home');
    }, 800);

  } catch(e) {
    if (btn) { btn.disabled = false; btn.querySelector('span').textContent = isKnownDevice ? 'Sign In' : 'Get Started'; }
    showMsg(msg, 'error', 'Error. Check internet and try again.');
    console.error(e);
  }
}

// ═══════════════════════════════════════════
// LOGOUT
// ═══════════════════════════════════════════

window.logoutUser = function() {
  if (!confirm('Log out of PayMesh?')) return;
  const lastPhone = CURRENT_USER.phone; // remember before clearing
  teardownListeners();
  ['pm_name','pm_phone','pm_upi','pm_logged_in','pm_balance','pm_fingerprint','pm_device_token','pm_fp'].forEach(k => {
    sessionStorage.removeItem(k);
    localStorage.removeItem(k);
  });
  sessionStorage.removeItem('pm_session_phone');
  // Clear PIN hash cache and lockout counter for this user
  if (CURRENT_USER.phone) localStorage.removeItem('pm_pin_' + CURRENT_USER.phone);
  resetPinAttempts();
  CURRENT_USER.name = ''; CURRENT_USER.phone = ''; CURRENT_USER.upi = '';
  _rememberMe = false;
  const track = document.getElementById('remember-track');
  if (track) track.classList.remove('on');
  const phoneEl = document.getElementById('login-phone');
  if (phoneEl) {
    // Pre-fill with last phone number for convenience — user just needs to tap Sign In
    phoneEl.value = lastPhone || '';
    detectExistingUser(lastPhone || '');
  }
  const msg = document.getElementById('login-msg');
  if (msg) { msg.className = 'msg'; msg.textContent = ''; }
  showScreen('screen-login');
}

// ═══════════════════════════════════════════
// TEARDOWN LISTENERS
// ═══════════════════════════════════════════

function teardownListeners() {
  if (unsubBalance)   { unsubBalance();   unsubBalance   = null; }
  if (unsubTxns)      { unsubTxns();      unsubTxns      = null; }
  if (unsubLoadNotif) { unsubLoadNotif(); unsubLoadNotif = null; }
  _homeListenersActive = false;
}

// ═══════════════════════════════════════════
// FORCE RE-LOGIN (device kicked or account deleted)
// ═══════════════════════════════════════════

function forceRelogin(reason) {
  teardownListeners();
  ['pm_name','pm_phone','pm_upi','pm_logged_in','pm_balance','pm_fingerprint','pm_device_token','pm_fp'].forEach(k => {
    sessionStorage.removeItem(k);
    localStorage.removeItem(k);
  });
  sessionStorage.removeItem('pm_session_phone');
  // Clear PIN hash cache for this user
  if (CURRENT_USER.phone) localStorage.removeItem('pm_pin_' + CURRENT_USER.phone);
  resetPinAttempts();
  CURRENT_USER.name = ''; CURRENT_USER.phone = ''; CURRENT_USER.upi = '';
  if (reason) alert(reason);
  showScreen('screen-login');
}

// ═══════════════════════════════════════════
// HOME DATA — real-time listeners
// ═══════════════════════════════════════════

let _homeListenersActive = false;
async function loadHomeData() {
  // Fallback: read from localStorage (persisted) or sessionStorage if CURRENT_USER not set yet
  if (!CURRENT_USER.phone) {
    const savedPhone = localStorage.getItem('pm_phone') || sessionStorage.getItem('pm_phone');
    if (savedPhone) {
      CURRENT_USER.phone = savedPhone;
      CURRENT_USER.name  = localStorage.getItem('pm_name')  || sessionStorage.getItem('pm_name')  || '';
      CURRENT_USER.upi   = localStorage.getItem('pm_upi')   || sessionStorage.getItem('pm_upi')   || '';
    } else {
      showScreen('screen-login');
      return;
    }
  }

  const displayName = CURRENT_USER.name ? `Hi, ${CURRENT_USER.name} 👋` : 'Welcome 👋';
  document.getElementById('display-name').textContent = displayName;
  const cached = parseFloat(sessionStorage.getItem('pm_balance') || '0');
  document.getElementById('wallet-balance').textContent = cached.toFixed(2);

  // Update Aria alert dot on home load
  try { if (CURRENT_USER.phone) _ariaUpdateAlertDot(ariaGetData()); } catch(e) {}

  // Only attach listeners once per session -- prevent stacking
  if (_homeListenersActive) return;
  teardownListeners();
  _homeListenersActive = true;

  // Replay any offline vouchers that were queued while network was down
  replayPendingVouchers().catch(() => {});

  // Phase 1: start hourly expiry sweep
  _scheduleExpirySweep();

  unsubBalance = onSnapshot(
    doc(db, "users", CURRENT_USER.phone),
    (snap) => {
      if (!snap.exists()) {
        // Don't forceRelogin on a single missing snapshot -- could be a network glitch.
        // Only logout if account is confirmed deleted via a direct server fetch.
        console.warn('[PM] Snapshot returned no document -- ignoring, may be transient');
        return;
      }
      const data = snap.data();

      const bal = data.balance || 0;
      if (data.name && data.name !== CURRENT_USER.name) {
        CURRENT_USER.name = data.name;
        sessionStorage.setItem('pm_name', data.name);
        localStorage.setItem('pm_name', data.name);
      }
      if (data.upi && data.upi !== CURRENT_USER.upi) {
        CURRENT_USER.upi = data.upi;
        sessionStorage.setItem('pm_upi', data.upi);
        localStorage.setItem('pm_upi', data.upi);
      }
      // Sync PIN cache live — if PIN was set/removed on another login it reflects here
      syncPinCache(data);
      refreshPinSettingsUI();

      document.getElementById('display-name').textContent = `Hi, ${CURRENT_USER.name} 👋`;
      animateBalance(bal);
      sessionStorage.setItem('pm_balance', bal.toFixed(2));
    },
    (err) => console.warn('Balance listener error:', err.message)
  );

  const txQuery = query(
    collection(db,"transactions"),
    where("phone","==",CURRENT_USER.phone),
    orderBy("time","desc"),
    limit(20)
  );
  unsubTxns = onSnapshot(
    txQuery,
    (snap) => renderTransactions(snap),
    (err)  => console.warn('Tx listener error:', err.message)
  );

  // ── LOAD APPROVAL NOTIFICATION ──
  // Watch user's pending UTR submissions. When admin approves one, notify the user immediately.
  const _notifiedUTRs = new Set(JSON.parse(sessionStorage.getItem('pm_notified_utrs') || '[]'));
  const utrQuery = query(
    collection(db, "utrs"),
    where("phone", "==", CURRENT_USER.phone),
    where("status", "==", "approved")
  );
  unsubLoadNotif = onSnapshot(utrQuery, (snap) => {
    snap.forEach(d => {
      const data = d.data();
      const utr  = data.utr;
      if (!utr || _notifiedUTRs.has(utr)) return;
      _notifiedUTRs.add(utr);
      sessionStorage.setItem('pm_notified_utrs', JSON.stringify([..._notifiedUTRs]));
      // Show an in-app toast notification
      _showLoadApprovedToast(data.amount, utr);
    });
  }, (err) => console.warn('Load notif listener error:', err.message));
}

function renderTransactions(snap) {
  const list = document.getElementById('tx-list');
  if (snap.empty) { list.innerHTML = '<div class="tx-empty">No transactions yet</div>'; return; }
  // Snapshot is already ordered by time desc, limited to 20 by the query
  const txs = [];
  snap.forEach(d => txs.push(d.data()));
  list.innerHTML = txs.map((tx, i) => {
    const isDebit   = tx.type === 'debit';
    const isPending = tx.type === 'pending';
    const amtClass  = isPending ? 'tx-pending' : isDebit ? 'tx-debit' : 'tx-credit';
    const prefix    = isPending ? '⏳ ' : isDebit ? '−' : '+';
    let displayTime = tx.time || '';
    try { const d = new Date(tx.time); if (!isNaN(d)) displayTime = d.toLocaleString(); } catch(e) {}
    return `<div class="tx-row" style="animation-delay:${i*0.05}s">
      <div class="tx-avatar">${(tx.label||'?')[0].toUpperCase()}</div>
      <div class="tx-middle"><div class="tx-name">${tx.label}</div><div class="tx-time">${displayTime}</div></div>
      <div class="tx-amount ${amtClass}">${prefix}₹${Number(tx.amount).toFixed(2)}</div>
    </div>`;
  }).join('');
}

function animateBalance(target) {
  const el  = document.getElementById('wallet-balance');
  // Guard: if balance is masked (e.g. devtools detection showed ••••), read from data attribute only
  const cur = parseFloat(el.dataset.value || '0') || 0;
  el.dataset.value = target;
  if (cur === target) { el.textContent = target.toFixed(2); return; }
  const dur = 700, st = Date.now();
  const tick = () => {
    const p = Math.min((Date.now()-st)/dur, 1);
    const e = p < 0.5 ? 2*p*p : -1+(4-2*p)*p;
    el.textContent = (cur+(target-cur)*e).toFixed(2);
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = target.toFixed(2);
  };
  requestAnimationFrame(tick);
}

// ── Load Approval Toast ──
// Shown when admin approves a UTR while the user is in-app.
function _showLoadApprovedToast(amount, utr) {
  try {
    const toast = document.createElement('div');
    toast.style.cssText = [
      'position:fixed','bottom:max(80px,env(safe-area-inset-bottom,80px))','left:50%',
      'transform:translateX(-50%) translateY(20px)',
      'background:linear-gradient(135deg,rgba(0,232,122,.18),rgba(0,232,122,.10))',
      'border:1px solid rgba(0,232,122,.35)','border-radius:16px',
      'padding:14px 22px','z-index:9999','min-width:260px','text-align:center',
      'box-shadow:0 12px 40px rgba(0,0,0,.6),0 0 40px rgba(0,232,122,.15)',
      'font-family:var(--sans)','color:var(--text)',
      'animation:fadeUp .4s var(--ease) both',
      'backdrop-filter:blur(24px)','-webkit-backdrop-filter:blur(24px)'
    ].join(';');
    toast.innerHTML =
      '<div style="font-size:11px;font-weight:800;letter-spacing:2px;color:var(--em);text-transform:uppercase;margin-bottom:6px;">✅ Balance Loaded!</div>' +
      '<div style="font-size:20px;font-weight:800;font-family:var(--mono);color:var(--text);">+₹' + Number(amount).toFixed(2) + '</div>' +
      '<div style="font-size:11px;color:var(--text3);margin-top:4px;">UTR ' + utr + ' approved</div>';
    document.body.appendChild(toast);
    if (navigator.vibrate) navigator.vibrate([100, 50, 200]);
    setTimeout(function() {
      toast.style.transition = 'opacity .4s ease, transform .4s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(10px)';
      setTimeout(function() { toast.remove(); }, 450);
    }, 4000);
  } catch(e) {}
}

// ═══════════════════════════════════════════
// LOAD MONEY
// ═══════════════════════════════════════════

window.submitLoad = async function() {
  const amount = parseFloat(document.getElementById('load-amount').value);
  const utr    = document.getElementById('load-utr').value.trim();
  const msg    = document.getElementById('load-msg');

  if (!amount || amount <= 0)   { showMsg(msg,'error','Enter a valid amount'); return; }
  if (amount > 50000)           { showMsg(msg,'error','Maximum load is ₹50,000'); return; }
  if (!/^\d{12}$/.test(utr))   { showMsg(msg,'error','UTR must be exactly 12 digits'); return; }
  if (!CURRENT_USER.phone)      { showMsg(msg,'error','Session error — please log out and log in again.'); return; }

  showMsg(msg,'success','Submitting request...');

  try {
    const utrSnap = await getDocFromServer(doc(db,"utrs",utr));
    if (utrSnap.exists()) { showMsg(msg,'error','This UTR has already been submitted'); return; }

    const time = new Date().toISOString();
    await setDoc(doc(db,"utrs",utr), {
      utr, amount, phone: CURRENT_USER.phone, name: CURRENT_USER.name,
      upi: CURRENT_USER.upi, paidTo: PAYMESH_UPI, time, status:"pending", reviewed: false
    });
    await addDoc(collection(db,"transactions"), {
      phone: CURRENT_USER.phone, label:"Load Request — Under Review",
      amount, type:"pending", time, utr, status:"pending"
    });
    document.getElementById('load-amount').value = '';
    document.getElementById('load-utr').value    = '';
    showMsg(msg,'success','Submitted! Balance updates the moment admin verifies your UTR.');
  } catch(e) {
    showMsg(msg,'error','Error submitting. Try again.');
    console.error(e);
  }
}

// ═══════════════════════════════════════════
// FRAUD COPILOT — Pattern-matching score engine
// 7 measurable fraud patterns. No AI — pure math.
// ═══════════════════════════════════════════

// Note-field keywords (Pattern 6)
const FRAUD_KEYWORDS_HIGH = ['refund','cashback','prize','won','lottery','verify','otp','registration fee','processing fee','delivery charge','customs'];
const FRAUD_KEYWORDS_MED  = ['urgent','emergency','help','stuck','stranded','hospital'];

// State: whether user has confirmed past fraud warning in this session
let _fraudOverrideGranted = false;
// Track last phone+amount to detect when they change vs just note changing
let _fraudLastPhone  = '';
let _fraudLastAmount = 0;
// Debounce timer for the async Firestore calls
let _fraudDebounceTimer = null;
// Sequence counter to discard stale async results
let _fraudSeq = 0;

// Called on every input change in send form
window.onSendFieldChange = function() {
  const phone  = (document.getElementById('send-phone').value  || '').trim();
  const amount = parseFloat(document.getElementById('send-amount').value) || 0;
  const note   = (document.getElementById('send-note')?.value  || '').toLowerCase();

  // Show note field once user has a phone and amount
  const noteGroup = document.getElementById('send-note-group');
  if (noteGroup) noteGroup.style.display = (phone.length >= 6 || amount > 0) ? '' : 'none';

  if (!phone || phone.length < 10 || !amount || amount <= 0) {
    _hideFraudPanel();
    // §4: Show prior warning banner even without amount if phone is 10 digits
    if (phone && phone.length === 10) {
      const priorEl = document.getElementById('aria-prior-warning');
      if (priorEl) {
        const aData = ariaGetData();
        const pw = (aData.log || []).filter(e => e.toPhone === phone && (e.tier === 'amber' || e.tier === 'red' || e.tier === 'blocked'));
        if (pw.length > 0) {
          priorEl.style.display = '';
          priorEl.textContent = `⚠ Aria warned you about this number ${pw.length} time${pw.length>1?'s':''} before.`;
        } else {
          priorEl.style.display = 'none';
        }
      }
    } else {
      const priorEl = document.getElementById('aria-prior-warning');
      if (priorEl) priorEl.style.display = 'none';
    }
    return;
  }

  // §4: Hide prior warning once fraud panel takes over
  const priorEl = document.getElementById('aria-prior-warning');
  if (priorEl) priorEl.style.display = 'none';

  // Only reset override when phone or amount changes — not on note edits
  const coreChanged = (phone !== _fraudLastPhone || amount !== _fraudLastAmount);
  if (coreChanged) {
    _fraudOverrideGranted = false;
    _fraudLastPhone  = phone;
    _fraudLastAmount = amount;
  }

  // Don't re-run the heavy async score if override already granted and core unchanged
  if (_fraudOverrideGranted && !coreChanged) return;

  // Debounce: wait 350ms after last keystroke before firing Firestore reads
  clearTimeout(_fraudDebounceTimer);
  _fraudDebounceTimer = setTimeout(() => _runFraudScore(phone, amount, note), 350);
}

// ── Fraud read-cache helpers (sessionStorage, TTL-based) ──
// Key: pm_fc_<userPhone>_<recipPhone>  → 'new' | 'known'  (no expiry needed, resets on logout)
// Key: pm_ud_<recipPhone>              → JSON {data, ts}   TTL 5 min
const _FC_PREFIX = 'pm_fc_';
const _UD_PREFIX = 'pm_ud_';
const _UD_TTL_MS = 5 * 60 * 1000; // 5 minutes

function _fcCacheKey(recipPhone)  { return _FC_PREFIX + (CURRENT_USER.phone||'') + '_' + recipPhone; }
function _udCacheKey(recipPhone)  { return _UD_PREFIX + recipPhone; }

function _getFcCache(recipPhone) {
  return sessionStorage.getItem(_fcCacheKey(recipPhone)); // 'new' | 'known' | null
}
function _setFcCache(recipPhone, val) {
  try { sessionStorage.setItem(_fcCacheKey(recipPhone), val); } catch(e) {}
}
function _getUdCache(recipPhone) {
  try {
    const raw = sessionStorage.getItem(_udCacheKey(recipPhone));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (Date.now() - obj.ts > _UD_TTL_MS) { sessionStorage.removeItem(_udCacheKey(recipPhone)); return null; }
    return obj.data; // the Firestore doc data object
  } catch(e) { return null; }
}
function _setUdCache(recipPhone, data) {
  try { sessionStorage.setItem(_udCacheKey(recipPhone), JSON.stringify({ data, ts: Date.now() })); } catch(e) {}
}

async function _runFraudScore(phone, amount, note) {
  // Stamp a sequence number; discard result if a newer call has started
  const seq = ++_fraudSeq;

  const signals = [];
  let score = 0;

  const currentBal = parseFloat(sessionStorage.getItem('pm_balance') || '0');
  const hour = new Date().getHours();
  const isNight = hour >= 20 || hour < 6;

  // §4: Per-contact prior warning check — check Aria log for past warnings about this phone
  try {
    const ariaData = ariaGetData();
    const priorWarnings = (ariaData.log || []).filter(e => e.toPhone === phone && (e.tier === 'amber' || e.tier === 'red' || e.tier === 'blocked'));
    if (priorWarnings.length > 0) {
      signals.push({ sev:'amber', icon:'📋', text:`Aria warned you about this number ${priorWarnings.length} time${priorWarnings.length>1?'s':''} before. Review carefully.` });
      score += 15;
    }
  } catch(e) {}

  // ── Pattern 1: First Contact High Value ──
  // Uses `toPhone` field written by sendMoney on each debit transaction.
  let isNewContact = true;
  const cachedFc = _getFcCache(phone);
  if (cachedFc !== null) {
    isNewContact = (cachedFc === 'new');
  } else {
    try {
      const { getDocs: gd, query: qr, collection: col, where: wh } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      const priorSnap = await gd(qr(col(db,'transactions'),
        wh('phone','==',CURRENT_USER.phone),
        wh('type','==','debit'),
        wh('toPhone','==',phone)
      ));
      isNewContact = priorSnap.empty;
      _setFcCache(phone, isNewContact ? 'new' : 'known');
    } catch(e) {
      isNewContact = true; // conservative default on network error
    }
  }

  if (seq !== _fraudSeq) return; // stale — a newer call is in flight

  // §2 Fix: weight by contact familiarity — known-contact non-drain cap
  const isKnownContact = !isNewContact;

  if (isNewContact && amount > 500 && isNight) {
    score += 40;
    signals.push({ sev:'red', icon:'🌙', text:`You've never paid this number before, the amount is large, and it's nighttime — a high-risk combination.` });
  } else if (isNewContact && amount > 500) {
    score += 25;
    signals.push({ sev:'amber', icon:'👤', text:`You've never sent money to this number before and the amount is above ₹500.` });
  }

  // §1: New pattern — known contact sudden spike (>3x their average receive amount)
  if (isKnownContact) {
    try {
      const { getDocs: gd2, query: qr2, collection: col2, where: wh2, limit: lim2, orderBy: ob2 } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      const recentSnap = await gd2(qr2(col2(db,'transactions'),
        wh2('phone','==',CURRENT_USER.phone),
        wh2('type','==','debit'),
        wh2('toPhone','==',phone),
        ob2('time','desc'), lim2(5)
      ));
      if (!recentSnap.empty) {
        const amounts = [];
        recentSnap.forEach(d => amounts.push(d.data().amount || 0));
        const avg = amounts.reduce((s,a) => s+a, 0) / amounts.length;
        if (avg > 0 && amount > avg * 3) {
          score += 30;
          signals.push({ sev:'red', icon:'📈', text:`This amount is ${Math.round(amount/avg)}× your usual send to this contact — possible account takeover scenario.` });
        }
      }
    } catch(e) {}
    if (seq !== _fraudSeq) return;
  }

  // §1: Velocity check — >3 sends in last 10 minutes (from Aria log)
  try {
    const vData = ariaGetData();
    const recentSends = (vData.log || []).filter(e =>
      e.context === 'send' &&
      Date.now() - new Date(e.time).getTime() < 10 * 60 * 1000
    );
    if (recentSends.length >= 3) {
      score += 35;
      signals.push({ sev:'red', icon:'⚡', text:`You've made ${recentSends.length} send attempts in the last 10 minutes — rapid drain is a scammer script pattern.` });
    }
  } catch(e) {}

  // ── Pattern 3: Round Number ──
  const isRound = amount > 0 && amount % 500 === 0;
  if (isRound && isNewContact) {
    score += 15;
    signals.push({ sev:'amber', icon:'🎯', text:`₹${amount.toFixed(0)} is a suspiciously round number — real transactions are rarely this exact.` });
  } else if (isRound && isNight) {
    score += 10;
    signals.push({ sev:'amber', icon:'🎯', text:`Round-number amounts at night are a common scam signal.` });
  }

  // §1 + §2 Fix: Synthesized stacked-signal row for new-contact + night + round
  const nightFlag  = isNight && signals.some(s => s.icon === '🌙');
  const roundFlag  = isRound && signals.some(s => s.icon === '🎯');
  if (isNewContact && nightFlag && roundFlag) {
    signals.push({ sev:'red', icon:'🚨', text:`Three risk factors detected simultaneously: new contact + nighttime + round amount.` });
    score += 10; // stacking bonus
  }

  // ── Pattern 4: Balance Drain ──
  // §2 Fix: don't fire drain if balance is under ₹200 (draining ₹190 of ₹190 isn't meaningful)
  if (currentBal >= 200) {
    const drainRatio = amount / currentBal;
    if (drainRatio > 0.95 && isNewContact) {
      score += 55;
      signals.push({ sev:'red', icon:'💸', text:`You're sending ${Math.round(drainRatio*100)}% of your entire wallet balance to someone you've never paid.` });
    } else if (drainRatio > 0.8 && isNewContact) {
      score += 35;
      signals.push({ sev:'red', icon:'💸', text:`This would drain ${Math.round(drainRatio*100)}% of your wallet in one transaction to a new contact.` });
    }
  }

  // §2 Fix: for known contacts cap non-drain pattern contribution at 20 to cut false positives
  if (isKnownContact) {
    const drainScore = signals.filter(s => s.icon === '💸').length > 0 ? score : 0;
    const nonDrainScore = score - drainScore;
    if (nonDrainScore > 20) score = drainScore + 20;
  }

  // ── Pattern 6: Note Field Keywords ──
  if (note) {
    const hitHigh = FRAUD_KEYWORDS_HIGH.find(k => note.includes(k));
    const hitMed  = !hitHigh && FRAUD_KEYWORDS_MED.find(k => note.includes(k));
    if (hitHigh) {
      score += 40;
      signals.push({ sev:'red', icon:'⚠️', text:`Your note contains "${hitHigh}" — legitimate companies never ask you to send money for a ${hitHigh}.` });
    } else if (hitMed) {
      score += 20;
      signals.push({ sev:'amber', icon:'⚠️', text:`Your note says "${hitMed}" — be cautious of urgency-based pressure to send money.` });
    }
  }

  // ── Pattern 7: Time-Since-Account + extended recipient intelligence ──
  try {
    let recipData = _getUdCache(phone);
    if (!recipData) {
      const rSnap = await getDoc(doc(db,'users',phone));
      if (seq !== _fraudSeq) return;
      if (rSnap.exists()) {
        recipData = rSnap.data();
        _setUdCache(phone, recipData);
      } else {
        // §1: Recipient has no PayMesh account at all — weak signal
        score += 8;
        signals.push({ sev:'amber', icon:'❓', text:`This phone number is not registered on PayMesh. Double-check who you're paying.` });
      }
    } else {
      if (seq !== _fraudSeq) return;
    }
    if (recipData) {
      const created = recipData.createdAt;
      if (created) {
        const ageHours = (Date.now() - new Date(created).getTime()) / 3600000;
        if (ageHours < 24 && amount >= 1000) {
          score += 45;
          signals.push({ sev:'red', icon:'🆕', text:`This PayMesh account was created less than 24 hours ago and you're sending ₹${amount.toFixed(0)} to it.` });
        } else if (ageHours < 168 && isNewContact) {
          score += 20;
          signals.push({ sev:'amber', icon:'🆕', text:`This account is less than 7 days old and you've never paid them before.` });
        }
      }
      // §3: Check if recipient's UPI looks synthetic (numeric-heavy)
      if (recipData.upi) {
        const upiHandle = recipData.upi.split('@')[0] || '';
        const numericRatio = (upiHandle.replace(/\D/g,'').length) / (upiHandle.length || 1);
        if (numericRatio > 0.7 && upiHandle.length > 6) {
          score += 12;
          signals.push({ sev:'amber', icon:'🔢', text:`Recipient's UPI handle is mostly numbers — mule accounts often have auto-generated numeric IDs.` });
        }
      }
      // §3: Check flagged field (admin-settable)
      if (recipData.flagged === true) {
        score += 60;
        signals.push({ sev:'red', icon:'🚩', text:`This account has been flagged by PayMesh. Do not proceed with this transfer.` });
      }
    }
  } catch(e) { /* ignore — network issue */ }

  if (seq !== _fraudSeq) return;
  _renderFraudPanel(score, signals, amount, phone);
}

function _renderFraudPanel(score, signals, amount, toPhone) {
  const badge    = document.getElementById('fraud-badge');
  const panel    = document.getElementById('fraud-panel');
  const fill     = document.getElementById('fraud-score-fill');
  const sigCont  = document.getElementById('fraud-signals');
  const actions  = document.getElementById('fraud-actions');
  const title    = document.getElementById('fraud-panel-title');
  const subtitle = document.getElementById('fraud-panel-subtitle');
  const panelIcon= document.getElementById('fraud-panel-icon');
  const badgeLbl = document.getElementById('fraud-badge-label');
  const badgeIco = document.getElementById('fraud-badge-icon');
  const sendBtn  = document.getElementById('send-submit-btn');

  // Determine tier
  let tier;
  if      (score >= 80) tier = 'blocked';
  else if (score >= 55) tier = 'red';
  else if (score >= 30) tier = 'amber';
  else                  tier = 'green';

  // Score bar width capped at 100%
  const pct = Math.min(Math.round(score / 100 * 100), 100);

  // ── Badge ──
  if (badge) {
    badge.className = `fraud-badge visible ${tier}`;
    if (badgeIco) { if      (tier === 'green')   badgeIco.textContent = '✓';  else if (tier === 'amber') badgeIco.textContent = '⚠'; else if (tier === 'red') badgeIco.textContent = '🛡'; else badgeIco.textContent = '🚫'; }
    if (badgeLbl) { if      (tier === 'green')   badgeLbl.textContent = 'SAFE'; else if (tier === 'amber') badgeLbl.textContent = 'CAUTION'; else if (tier === 'red') badgeLbl.textContent = 'WARNING'; else badgeLbl.textContent = 'HIGH RISK'; }
  }

  if (tier === 'green') {
    panel.className = 'fraud-panel'; // hide
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.style.opacity = '1';
      sendBtn.style.cursor  = 'pointer';
      sendBtn.textContent = 'Send Now';
    }
    // Log safe send to Aria
    if (typeof ariaLogEvent === 'function') ariaLogEvent('green', 'send', [], amount, toPhone);
    return;
  }

  // Log to Aria
  if (typeof ariaLogEvent === 'function') ariaLogEvent(tier, 'send', signals, amount, toPhone);

  // ── Panel ──
  if (panel) panel.className = `fraud-panel show ${tier}`;

  if (fill) { fill.style.width = pct + '%'; fill.className = `fraud-score-fill ${tier}`; }

  // Panel title + icon
  if (tier === 'amber') {
    if (panelIcon) panelIcon.textContent = '⚠️';
    if (title)    title.textContent = 'Fraud Copilot — Caution';
    if (subtitle) subtitle.textContent = 'Some risk signals detected. Review before sending.';
  } else if (tier === 'red') {
    if (panelIcon) panelIcon.textContent = '🛡️';
    if (title)    title.textContent = 'Fraud Copilot — Strong Warning';
    if (subtitle) subtitle.textContent = 'Multiple fraud patterns detected. Proceed carefully.';
  } else {
    if (panelIcon) panelIcon.textContent = '🚫';
    if (title)    title.textContent = 'Fraud Copilot — Transaction Blocked';
    if (subtitle) subtitle.textContent = 'This transaction matches high-risk scam patterns.';
  }

  // Signal rows
  if (sigCont) sigCont.innerHTML = signals.map(s => `
    <div class="fraud-signal ${s.sev}">
      <span class="fraud-signal-icon">${s.icon}</span>
      <span>${s.text}</span>
    </div>`).join('');

  // Action area
  if (!actions) return;
  actions.innerHTML = '';
  if (tier === 'blocked') {
    // No proceed option
    if (sendBtn) { sendBtn.disabled = true; sendBtn.style.opacity = '.4'; sendBtn.style.cursor = 'not-allowed'; }
    const msg = document.createElement('div');
    msg.className = 'fraud-blocked-msg';
    msg.textContent = 'This transaction has been frozen. Edit the details or return home.';
    actions.appendChild(msg);
  } else if (tier === 'red') {
    // Must type CONFIRM
    if (sendBtn) sendBtn.disabled = true;
    const row = document.createElement('div');
    row.className = 'fraud-confirm-row';
    row.innerHTML = `
      <input type="text" class="fraud-confirm-input" id="fraud-confirm-input"
        placeholder='Type "CONFIRM" to proceed' maxlength="10"
        oninput="_fraudCheckConfirm(this.value)">
      <button type="button" class="fraud-confirm-submit" id="fraud-confirm-submit"
        disabled onclick="_fraudUnlock()">Proceed</button>`;
    actions.appendChild(row);
    // Re-enable send btn via unlock
    if (sendBtn) { sendBtn.style.opacity = '.4'; sendBtn.style.cursor = 'not-allowed'; }
  } else {
    // Amber: one-tap proceed
    if (sendBtn) sendBtn.disabled = false;
    const proceedBtn = document.createElement('button');
    proceedBtn.type = 'button';
    proceedBtn.className = 'fraud-proceed-btn';
    proceedBtn.textContent = 'I understand the risks — proceed anyway';
    proceedBtn.onclick = () => {
      _fraudOverrideGranted = true;
      panel.className = 'fraud-panel'; // hide panel
      badge.className = 'fraud-badge visible amber';
      badgeLbl.textContent = 'OVERRIDDEN';
    };
    actions.appendChild(proceedBtn);
  }
}

window._fraudCheckConfirm = function(val) {
  const btn = document.getElementById('fraud-confirm-submit');
  if (btn) btn.disabled = val.toUpperCase() !== 'CONFIRM';
}

window._fraudUnlock = function() {
  _fraudOverrideGranted = true;
  const panel  = document.getElementById('fraud-panel');
  const sendBtn = document.getElementById('send-submit-btn');
  panel.className = 'fraud-panel';
  if (sendBtn) {
    sendBtn.disabled = false;
    sendBtn.style.opacity = '1';
    sendBtn.style.cursor  = 'pointer';
    sendBtn.textContent = 'Send Now';
  }
  const badge = document.getElementById('fraud-badge');
  if (badge) {
    badge.className = 'fraud-badge visible red';
    document.getElementById('fraud-badge-label').textContent = 'OVERRIDDEN';
  }
}

function _hideFraudPanel() {
  const badge = document.getElementById('fraud-badge');
  const panel = document.getElementById('fraud-panel');
  if (badge) badge.className = 'fraud-badge';
  if (panel) panel.className = 'fraud-panel';
  _fraudOverrideGranted = false;
}

// ═══════════════════════════════════════════
// ARIA — FRAUD COPILOT DATA & PERSISTENCE
// All data stored in localStorage under pm_aria_*
// ═══════════════════════════════════════════

const ARIA_TIPS = [
  "Never send money to someone claiming to be from a bank or government — they will never ask for wallet transfers.",
  "If someone says 'send ₹1 to verify your account', it's always a scam. No legitimate service does this.",
  "Be extra careful at night — most payment scams happen between 10 PM and 4 AM.",
  "Round numbers like ₹500, ₹1000 or ₹5000 from unknown contacts are a common fraud pattern.",
  "If someone is pressuring you urgently to send money, take a breath. Scammers rely on panic.",
  "Vouchers can only be redeemed once. If someone asks you to 'test' one, they're stealing from you.",
  "Never share your PayMesh PIN with anyone — not even someone claiming to be PayMesh support.",
  "A brand-new account sending or requesting large amounts is a serious red flag.",
  "Trust your gut. If something feels off, Aria's here to back you up — don't override warnings lightly.",
  "Check transaction history regularly. Early detection stops fraud before it escalates.",
  "QR codes can be tampered with in person. Always verify the recipient's name before paying.",
  "Using 'emergency' or 'stranded' language is a manipulation tactic. Call the person directly first."
];

function _ariaKey(k) { return 'pm_aria_' + (CURRENT_USER.phone || 'unknown') + '_' + k; }

function ariaGetData() {
  try {
    const raw = localStorage.getItem(_ariaKey('data'));
    if (!raw) return { safe: 0, warned: 0, blocked: 0, log: [], riskScore: 0 };
    return JSON.parse(raw);
  } catch(e) {
    return { safe: 0, warned: 0, blocked: 0, log: [], riskScore: 0 };
  }
}

function ariaSaveData(data) {
  try {
    // Keep log to last 50 entries
    if (data.log && data.log.length > 50) data.log = data.log.slice(-50);
    localStorage.setItem(_ariaKey('data'), JSON.stringify(data));
  } catch(e) {}
}

function ariaLogEvent(tier, context, signals, amount, toPhone) {
  const data = ariaGetData();
  if (tier === 'green') { data.safe = (data.safe || 0) + 1; }
  else if (tier === 'amber') { data.warned = (data.warned || 0) + 1; }
  else if (tier === 'red' || tier === 'blocked') { data.blocked = (data.blocked || 0) + 1; }

  // Recalculate rolling risk score (weighted average of last 10 events)
  const logEntry = {
    tier,
    context, // 'send' | 'voucher' | 'quick_transfer'
    amount,
    signals: signals.map(s => s.text),
    time: new Date().toISOString()
  };
  // Fix §8: store toPhone so per-contact history works
  if (toPhone) logEntry.toPhone = toPhone;
  data.log = data.log || [];
  data.log.push(logEntry);

  // Fix §8 (time-decay): events >7d contribute at 25%, events >30d contribute 0%
  const tierWeights = { blocked: 100, red: 70, amber: 30, green: 0 };
  const now = Date.now();
  const recent = data.log.slice(-10);
  let weightedSum = 0, weightTotal = 0;
  recent.forEach(e => {
    const ageMs = now - new Date(e.time).getTime();
    const ageDays = ageMs / 86400000;
    let w = ageDays > 30 ? 0 : ageDays > 7 ? 0.25 : 1;
    weightedSum += (tierWeights[e.tier] || 0) * w;
    weightTotal += w;
  });
  const avgRisk = weightTotal > 0 ? weightedSum / weightTotal : 0;
  data.riskScore = Math.round(avgRisk);

  ariaSaveData(data);
  _ariaUpdateAlertDot(data);
  return data;
}

function _ariaUpdateAlertDot(data) {
  const dot = document.getElementById('aria-alert-dot');
  if (!dot) return;
  const hasRisk = (data.blocked || 0) > 0 || (data.riskScore || 0) >= 30;
  dot.classList.toggle('show', hasRisk);
}

function ariaLoadDashboard() {
  const data = ariaGetData();
  if (!data) return;

  // Stats — only update if elements exist
  const safEl = document.getElementById('aria-stat-safe');
  const wrnEl = document.getElementById('aria-stat-warned');
  const blkEl = document.getElementById('aria-stat-blocked');
  if (safEl) safEl.textContent = data.safe || 0;
  if (wrnEl) wrnEl.textContent = data.warned || 0;
  if (blkEl) blkEl.textContent = data.blocked || 0;

  // Risk ring
  const ring      = document.getElementById('aria-risk-ring');
  const scoreVal  = document.getElementById('aria-risk-score-val');
  const riskDesc  = document.getElementById('aria-risk-desc');
  const riskScore = data.riskScore || 0;
  if (ring) {
    const circumference = 176;
    const offset = circumference - (riskScore / 100) * circumference;
    ring.style.strokeDashoffset = offset;
    ring.style.stroke = riskScore >= 70 ? 'var(--red)' : riskScore >= 40 ? 'var(--amber)' : 'var(--em)';
  }
  if (scoreVal) {
    scoreVal.textContent = riskScore;
    scoreVal.style.color = riskScore >= 70 ? 'var(--red)' : riskScore >= 40 ? 'var(--amber)' : 'var(--em)';
  }
  if (riskDesc) {
    if      (riskScore >= 70) riskDesc.textContent = 'High risk — review your recent transactions carefully.';
    else if (riskScore >= 40) riskDesc.textContent = 'Moderate risk — some suspicious patterns detected.';
    else if (riskScore >= 15) riskDesc.textContent = 'Low risk — minor signals in recent activity.';
    else                      riskDesc.textContent = 'All clear — your account looks healthy.';
  }

  // Greeting message
  const greeting = document.getElementById('aria-greeting-msg');
  if (greeting) {
    const name = CURRENT_USER.name ? CURRENT_USER.name.split(' ')[0] : 'there';
    if      (riskScore >= 70) greeting.textContent = `${name}, I need your attention — your recent activity shows high-risk patterns. Please review my detection log below and stay cautious.`;
    else if (riskScore >= 30) greeting.textContent = `Hey ${name}! I've spotted a few things worth watching. Nothing critical yet, but check my log below. I'll keep watching your back.`;
    else                      greeting.textContent = `Hey ${name}! All good here — your account is looking clean. I'm monitoring every transaction and voucher in real-time. Stay safe!`;
  }

  // §4: Aria Insights — dynamic sentences from log data
  const insightsEl = document.getElementById('aria-insights');
  if (insightsEl) {
    const log = data.log || [];
    const now = Date.now();
    const last7 = log.filter(e => (now - new Date(e.time).getTime()) < 7 * 86400000);
    const last24 = log.filter(e => (now - new Date(e.time).getTime()) < 86400000);
    const newContactSends = last7.filter(e => e.context === 'send' && e.tier !== 'green' && e.signals && e.signals.some(s => s.toLowerCase().includes("never")));
    const roundNightCount = log.slice(-10).filter(e => e.signals && e.signals.some(s => s.toLowerCase().includes("round"))).length;
    const noWarningsWeek = last7.filter(e => e.tier !== 'green').length === 0;
    const highRisk24 = last24.filter(e => e.tier === 'red' || e.tier === 'blocked').length;

    const insights = [];
    if (highRisk24 > 0) insights.push(`⚠️ Aria flagged ${highRisk24} high-risk transaction${highRisk24>1?'s':''} in the last 24 hours. Stay alert.`);
    if (newContactSends.length >= 4) insights.push(`🆕 You've sent money to ${newContactSends.length} new contacts this week. Consider verifying them before your next transfer.`);
    if (roundNightCount >= 3) insights.push(`🌙 Your last ${roundNightCount} flagged transactions were round amounts at night — a common scam pattern.`);
    if (noWarningsWeek) insights.push(`✅ No warnings in the last 7 days. Your account looks clean.`);
    if (!insights.length) insights.push(`🛡️ Aria is actively monitoring your transactions in real-time.`);

    insightsEl.innerHTML = insights.map(i => `<div class="aria-insight-row">${i}</div>`).join('');
  }

  // Tip of the day (rotates daily)
  const tipEl = document.getElementById('aria-tip-text');
  if (tipEl) {
    const dayIdx = Math.floor(Date.now() / 86400000) % ARIA_TIPS.length;
    tipEl.textContent = ARIA_TIPS[dayIdx];
  }

  // Log list
  _ariaRenderLog(data.log || []);
}

function _ariaRenderLog(log) {
  const listEl = document.getElementById('aria-log-list');
  if (!listEl) return;
  if (!log || !log.length) {
    listEl.innerHTML = '<div class="p-log-empty">No detections yet — Aria\'s watching 👀</div>';
    return;
  }
  const tierIcon  = { green: '✅', amber: '⚠️', red: '🚨', blocked: '🚫' };
  const tierLabel = { green: 'Safe', amber: 'Warning', red: 'High Risk', blocked: 'Blocked' };
  const ctxLabel  = { send: 'Send Money', voucher: 'Voucher', quick_transfer: 'Quick Transfer' };
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  listEl.innerHTML = [...log].reverse().map(e => {
    let displayTime = e.time || '';
    try { const d = new Date(e.time); if (!isNaN(d)) displayTime = d.toLocaleString(); } catch(ex) {}
    const topSignal = (e.signals && e.signals[0]) ? esc(e.signals[0]) : 'Analysed and cleared.';
    const tier = e.tier || 'green';
    return `<div class="p-log-item ${esc(tier)}">
      <div class="p-log-icon">${tierIcon[tier] || '🛡️'}</div>
      <div class="p-log-body">
        <div class="p-log-title">${tierLabel[tier] || 'Check'} · ${ctxLabel[e.context] || esc(e.context || '')} · ₹${Number(e.amount || 0).toFixed(2)}</div>
        <div class="p-log-sub">${topSignal}</div>
        <div class="p-log-time">${esc(displayTime)}</div>
      </div>
    </div>`;
  }).join('');
}

window.ariaClearLog = function() {
  if (!confirm('Clear Aria\'s detection log?')) return;
  const data = ariaGetData();
  data.log = [];
  data.safe = 0; data.warned = 0; data.blocked = 0; data.riskScore = 0;
  ariaSaveData(data);
  _ariaUpdateAlertDot(data);
  ariaLoadDashboard();
};

// ═══════════════════════════════════════════
// VOUCHER FRAUD COPILOT
// Extended fraud analysis for voucher creation
// ═══════════════════════════════════════════

let _voucherFraudOverrideGranted = false;
let _voucherFraudDebounceTimer = null;
let _voucherFraudSeq = 0;
let _voucherFraudLastAmount = 0;

window.onVoucherFieldChange = function() {
  const amount = parseFloat(document.getElementById('voucher-amount').value) || 0;

  if (!amount || amount <= 0) {
    _hideVoucherFraudPanel();
    return;
  }

  const amountChanged = (amount !== _voucherFraudLastAmount);
  if (amountChanged) {
    _voucherFraudOverrideGranted = false;
    _voucherFraudLastAmount = amount;
  }
  if (_voucherFraudOverrideGranted && !amountChanged) return;

  clearTimeout(_voucherFraudDebounceTimer);
  _voucherFraudDebounceTimer = setTimeout(() => _runVoucherFraudScore(amount), 350);
};

async function _runVoucherFraudScore(amount) {
  const seq = ++_voucherFraudSeq;
  const signals = [];
  let score = 0;

  const currentBal = parseFloat(sessionStorage.getItem('pm_balance') || '0');
  const hour = new Date().getHours();
  const isNight = hour >= 20 || hour < 6;

  // Pattern V1: Drains nearly all balance
  if (currentBal > 0) {
    const drainRatio = amount / currentBal;
    if (drainRatio > 0.95) {
      score += 50;
      signals.push({ sev:'red', icon:'💸', text:`This voucher uses ${Math.round(drainRatio*100)}% of your entire balance. Don't create it unless you're absolutely sure.` });
    } else if (drainRatio > 0.75) {
      score += 25;
      signals.push({ sev:'amber', icon:'💸', text:`This uses ${Math.round(drainRatio*100)}% of your wallet. That's a large voucher — are you sure?` });
    }
  }

  // Pattern V2: Very large voucher at night
  if (amount >= 2000 && isNight) {
    score += 30;
    signals.push({ sev:'red', icon:'🌙', text:`Creating a ₹${amount.toFixed(0)} voucher late at night is unusual. Scammers often pressure victims to create vouchers at odd hours.` });
  } else if (amount >= 5000) {
    score += 20;
    signals.push({ sev:'amber', icon:'💰', text:`₹${amount.toFixed(0)} is a large voucher. Make sure you personally know who will redeem this.` });
  }

  // Pattern V3: Rapid repeated voucher creation (check Aria log — non-green entries only)
  try {
    const data = ariaGetData();
    const recent = (data.log || []).filter(e =>
      e.context === 'voucher' &&
      e.tier !== 'green' &&
      Date.now() - new Date(e.time).getTime() < 10 * 60 * 1000 // last 10 minutes
    );
    if (recent.length >= 2) {
      score += 35;
      signals.push({ sev:'red', icon:'🔁', text:`You've created ${recent.length} warned vouchers in the last 10 minutes. This rapid pattern can indicate you're being pressured by a scammer.` });
    } else if (recent.length === 1) {
      score += 15;
      signals.push({ sev:'amber', icon:'🔁', text:`You recently created a flagged voucher. If someone is asking you to create multiple vouchers, that's a red flag.` });
    }
  } catch(e) {}

  if (seq !== _voucherFraudSeq) return;
  _renderVoucherFraudPanel(score, signals, amount);
}

function _renderVoucherFraudPanel(score, signals, amount) {
  const badge    = document.getElementById('voucher-fraud-badge');
  const panel    = document.getElementById('voucher-fraud-panel');
  const fill     = document.getElementById('voucher-fraud-score-fill');
  const sigCont  = document.getElementById('voucher-fraud-signals');
  const actions  = document.getElementById('voucher-fraud-actions');
  const title    = document.getElementById('voucher-fraud-panel-title');
  const subtitle = document.getElementById('voucher-fraud-panel-subtitle');
  const panelIcon= document.getElementById('voucher-fraud-panel-icon');
  const badgeLbl = document.getElementById('voucher-fraud-badge-label');
  const badgeIco = document.getElementById('voucher-fraud-badge-icon');
  const vBtn     = document.getElementById('voucher-submit-btn');

  let tier;
  if      (score >= 80) tier = 'blocked';
  else if (score >= 45) tier = 'red';
  else if (score >= 20) tier = 'amber';
  else                  tier = 'green';

  const pct = Math.min(Math.round(score / 100 * 100), 100);

  // Badge
  if (badge) {
    badge.className = `fraud-badge visible ${tier === 'green' ? 'green' : tier === 'amber' ? 'amber' : 'red'}`;
    if (badgeIco) badgeIco.textContent = tier === 'green' ? '✅' : tier === 'amber' ? '⚠️' : '🚫';
    if (badgeLbl) badgeLbl.textContent = tier === 'green' ? 'ARIA OK' : tier === 'amber' ? 'CAUTION' : tier === 'blocked' ? 'BLOCKED' : 'WARNING';
  }

  if (tier === 'green') {
    if (panel) panel.className = 'voucher-fraud-panel';
    if (vBtn) { vBtn.disabled = false; vBtn.style.opacity = '1'; vBtn.style.cursor = 'pointer'; }
    ariaLogEvent('green', 'voucher', [], amount);
    return;
  }

  // Log to Aria (non-green tiers only, after early return)
  ariaLogEvent(tier, 'voucher', signals, amount);

  if (panel) panel.className = `voucher-fraud-panel show ${tier === 'blocked' ? 'red' : tier}`;
  if (fill)  { fill.style.width = pct + '%'; fill.className = `fraud-score-fill ${tier === 'blocked' ? 'red' : tier}`; }

  if (tier === 'amber') {
    if (panelIcon) panelIcon.textContent = '⚠️';
    if (title)    title.textContent   = 'Aria · Heads Up';
    if (subtitle) subtitle.textContent = 'Some signals detected. Double-check before creating.';
  } else {
    if (panelIcon) panelIcon.textContent = '🚨';
    if (title)    title.textContent   = 'Aria · Strong Warning';
    if (subtitle) subtitle.textContent = 'This voucher shows high-risk patterns. Be very careful.';
  }

  if (sigCont) sigCont.innerHTML = signals.map(s => `
    <div class="fraud-signal ${s.sev}">
      <span class="fraud-signal-icon">${s.icon}</span>
      <span>${s.text}</span>
    </div>`).join('');

  if (actions) {
    actions.innerHTML = '';
    if (tier === 'blocked') {
      if (vBtn) { vBtn.disabled = true; vBtn.style.opacity = '.4'; vBtn.style.cursor = 'not-allowed'; }
      const msg = document.createElement('div');
      msg.className = 'fraud-blocked-msg';
      msg.textContent = 'Aria has frozen this voucher. Change the amount or go back home.';
      actions.appendChild(msg);
    } else if (tier === 'red') {
      if (vBtn) { vBtn.disabled = true; vBtn.style.opacity = '.4'; vBtn.style.cursor = 'not-allowed'; }
      const row = document.createElement('div');
      row.className = 'fraud-confirm-row';
      row.innerHTML = `
        <input type="text" class="fraud-confirm-input" id="voucher-fraud-confirm-input"
          placeholder='Type "CONFIRM" to proceed' maxlength="10"
          oninput="_voucherFraudCheckConfirm(this.value)">
        <button type="button" class="fraud-confirm-submit" id="voucher-fraud-confirm-submit"
          disabled onclick="_voucherFraudUnlock()">Create</button>`;
      actions.appendChild(row);
    } else {
      if (vBtn) vBtn.disabled = false;
      const proceedBtn = document.createElement('button');
      proceedBtn.type = 'button';
      proceedBtn.className = 'fraud-proceed-btn';
      proceedBtn.textContent = 'I understand the risks — create anyway';
      proceedBtn.onclick = () => {
        _voucherFraudOverrideGranted = true;
        if (panel) panel.className = 'voucher-fraud-panel';
        if (badge) { badge.className = 'fraud-badge visible amber'; if (badgeLbl) badgeLbl.textContent = 'OVERRIDDEN'; }
      };
      actions.appendChild(proceedBtn);
    }
  }
}

window._voucherFraudCheckConfirm = function(val) {
  const btn = document.getElementById('voucher-fraud-confirm-submit');
  if (btn) btn.disabled = val.toUpperCase() !== 'CONFIRM';
};

window._voucherFraudUnlock = function() {
  _voucherFraudOverrideGranted = true;
  const panel = document.getElementById('voucher-fraud-panel');
  const vBtn  = document.getElementById('voucher-submit-btn');
  if (panel) panel.className = 'voucher-fraud-panel';
  if (vBtn)  { vBtn.disabled = false; vBtn.style.opacity = '1'; vBtn.style.cursor = 'pointer'; }
  const badge = document.getElementById('voucher-fraud-badge');
  const badgeLbl = document.getElementById('voucher-fraud-badge-label');
  if (badge) { badge.className = 'fraud-badge visible red'; if (badgeLbl) badgeLbl.textContent = 'OVERRIDDEN'; }
};

function _hideVoucherFraudPanel() {
  const badge = document.getElementById('voucher-fraud-badge');
  const panel = document.getElementById('voucher-fraud-panel');
  if (badge) badge.className = 'fraud-badge';
  if (panel) panel.className = 'voucher-fraud-panel';
  _voucherFraudOverrideGranted = false; // always reset override when panel is hidden
}

// ═══════════════════════════════════════════
// SEND MONEY
// ═══════════════════════════════════════════

// ═══════════════════════════════════════════
// SEND RATE LIMIT
// One send per 30 seconds per session. Prevents scripted wallet drain.
// ═══════════════════════════════════════════

let _lastSendTime = 0;
const SEND_COOLDOWN_MS = 30 * 1000; // 30 seconds

window.sendMoney = async function() {
  const phone  = document.getElementById('send-phone').value.trim();
  const amount = parseFloat(document.getElementById('send-amount').value);
  const msg    = document.getElementById('send-msg');

  if (!/^\d{10}$/.test(phone)) { showMsg(msg,'error','Valid 10-digit phone needed'); return; }
  if (!amount || amount <= 0)  { showMsg(msg,'error','Enter a valid amount'); return; }
  if (!CURRENT_USER.phone)     { showMsg(msg,'error','Session error — please log out and log in again.'); return; }
  if (phone === CURRENT_USER.phone) { showMsg(msg,'error','Cannot send to yourself'); return; }

  // ── Fraud Copilot gate ──
  const sendBtn = document.getElementById('send-submit-btn');
  if (sendBtn && sendBtn.disabled) {
    showMsg(msg,'error','Fraud Copilot has flagged this transaction. Review the warning above.');
    return;
  }

  // Rate limit: enforce 30-second cooldown between sends
  const now = Date.now();
  if (now - _lastSendTime < SEND_COOLDOWN_MS) {
    const waitSec = Math.ceil((SEND_COOLDOWN_MS - (now - _lastSendTime)) / 1000);
    showMsg(msg, 'error', `Please wait ${waitSec}s before sending again.`);
    return;
  }

  try { await requirePin('Confirm Send', `Enter PIN to send ₹${amount.toFixed(2)}`); }
  catch(e) {
    if (e && e.message && e.message.startsWith('PIN locked')) {
      showMsg(msg, 'error', e.message);
    }
    return;
  }

  // ── PAYMENT ANIMATION START ──
  const _sendAmtVal = amount;
  const _sendPhoneVal = phone;
  if (typeof window.showPaymentAnim === 'function') {
    await window.showPaymentAnim(_sendAmtVal, _sendPhoneVal);
  } else {
    showMsg(msg,'success','Processing...');
  }

  try {
    const senderRef   = doc(db,"users",CURRENT_USER.phone);
    const receiverRef = doc(db,"users",phone);
    let receiverName  = '';

    await runTransaction(db, async (tx) => {
      const sSnap = await tx.get(senderRef);
      const rSnap = await tx.get(receiverRef);
      if (!sSnap.exists())   throw new Error('Your account not found');
      if (!rSnap.exists())   throw new Error('Recipient not found on PayMesh');
      const sBal = sSnap.data().balance || 0;
      const rBal = rSnap.data().balance || 0;
      if (sBal < amount)     throw new Error(`Insufficient balance. Available ₹${sBal.toFixed(2)}`);
      receiverName = rSnap.data().name;
      tx.update(senderRef,   { balance: sBal - amount });
      tx.update(receiverRef, { balance: rBal + amount });
    });

    const time = new Date().toISOString();
    await Promise.all([
      addDoc(collection(db,"transactions"), { phone: CURRENT_USER.phone, label:`Sent to ${receiverName}`,   amount, type:"debit",  time, toPhone: phone }),
      addDoc(collection(db,"transactions"), { phone,                     label:`From ${CURRENT_USER.name}`, amount, type:"credit", time })
    ]);

    const newBal = parseFloat(sessionStorage.getItem('pm_balance')||'0') - amount;
    sessionStorage.setItem('pm_balance', Math.max(0, newBal).toFixed(2));
    // Invalidate first-contact cache — this phone is now a known contact
    try { sessionStorage.removeItem(_FC_PREFIX + CURRENT_USER.phone + '_' + phone); } catch(e) {}
    _lastSendTime = Date.now(); // stamp cooldown on success only
    document.getElementById('send-phone').value  = '';
    document.getElementById('send-amount').value = '';
    if (navigator.vibrate) navigator.vibrate(200);
    if (typeof window.showPaymentSuccess === 'function') {
      await window.showPaymentSuccess('Payment Sent!', `₹${amount.toFixed(2)} sent to ${receiverName}`);
    }
    showOverlay('', 'Sent!', `₹${amount.toFixed(2)} sent to ${receiverName}`);
  } catch(e) {
    if (typeof window.hidePaymentAnim === 'function') window.hidePaymentAnim();
    showMsg(msg,'error', e.message || 'Error. Try again.');
    console.error(e);
  }
}

// ═══════════════════════════════════════════
// VOUCHERS — stored in FIRESTORE, not localStorage
// ═══════════════════════════════════════════

window.generateVoucher = async function() {
  const amount = parseFloat(document.getElementById('voucher-amount').value);
  const msg    = document.getElementById('voucher-msg');

  if (!amount || amount <= 0) { showMsg(msg,'error','Enter a valid amount'); return; }
  if (!CURRENT_USER.phone)    { showMsg(msg,'error','Session error — please log out and log in again.'); return; }

  // ── Aria Voucher Fraud gate ──
  const vBtn = document.getElementById('voucher-submit-btn');
  if (vBtn && vBtn.disabled) {
    showMsg(msg,'error','Aria has flagged this voucher. Review the warning above.');
    return;
  }

  try { await requirePin('Confirm Voucher', `Enter PIN to create ₹${amount.toFixed(2)} voucher`); }
  catch(e) {
    if (e && e.message && e.message.startsWith('PIN locked')) {
      showMsg(msg, 'error', e.message);
    }
    return;
  }

  showMsg(msg,'success','Creating voucher...');

  try {
    const userRef = doc(db,"users",CURRENT_USER.phone);
    // ── Phase 1: UUID token — short but URL-safe ──
    const token   = 'PM' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2,7).toUpperCase();
    const code    = token; // alias for legacy compat
    const now     = new Date();
    const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(); // 48hr TTL

    // ── Generate 6-digit OTP and hash it (SHA-256) ──
    const otpPlain = String(Math.floor(100000 + Math.random() * 900000));
    const otpBuf   = new TextEncoder().encode(otpPlain + ':paymesh:' + token);
    const otpHashBuf = await crypto.subtle.digest('SHA-256', otpBuf);
    const codeHash = Array.from(new Uint8Array(otpHashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');

    // ── ATOMIC: debit sender immediately on voucher creation ──
    await runTransaction(db, async (tx) => {
      const snap    = await tx.get(userRef);
      if (!snap.exists()) throw new Error('Account not found');
      const balance = snap.data().balance || 0;
      if (balance < amount) throw new Error(`Insufficient balance. You have ₹${balance.toFixed(2)}`);
      tx.update(userRef, { balance: balance - amount });
    });

    // Build the public claim URL for this voucher
    const claimUrl = _buildClaimUrl(token);

    await Promise.all([
      setDoc(doc(db,"vouchers",token), {
        code:          token,
        amount:        Number(amount),
        createdBy:     CURRENT_USER.phone,
        createdByName: CURRENT_USER.name,
        status:        'pending',
        expiresAt:     expiresAt,
        claimUrl:      claimUrl,
        createdAt:     now.toISOString(),
        codeHash:      codeHash,
        codeAttempts:  0
      }),
      addDoc(collection(db,"transactions"), {
        phone:  CURRENT_USER.phone,
        label:  `Voucher Created · ₹${amount.toFixed(2)}`,
        amount: Number(amount),
        type:   'debit',
        time:   now.toISOString()
      })
    ]);

    const newBal = parseFloat(sessionStorage.getItem('pm_balance')||'0') - amount;
    sessionStorage.setItem('pm_balance', Math.max(0, newBal).toFixed(2));
    try { sessionStorage.removeItem(_VOUCHER_CACHE_KEY()); } catch(e) {}

    document.getElementById('voucher-amount').value = '';
    showMsg(msg,'success','Voucher created! Note down the 6-digit code shown below.');
    if (navigator.vibrate) navigator.vibrate([100,50,200]);

    // ── Show one-time OTP modal — code never shown again ──
    _showOtpModal(otpPlain, amount, token, claimUrl, expiresAt);

    // Schedule a local expiry sweep (fires after 48h if tab is open)
    _scheduleExpirySweep();

  } catch(e) {
    showMsg(msg,'error', e.message || 'Error. Check internet.');
    console.error(e);
  }
}

// ── One-time OTP modal shown immediately after voucher creation ──
// Store OTP codes in localStorage so they can be shown again in the voucher card
function _storeVoucherOtp(token, otp) {
  try {
    const key = 'pm_votp_' + token;
    // Store encrypted simply with token as key (security-by-obscurity for UX, real security is the hash on server)
    localStorage.setItem(key, btoa(otp));
  } catch(e) {}
}
function _getVoucherOtp(token) {
  try {
    const v = localStorage.getItem('pm_votp_' + token);
    return v ? atob(v) : null;
  } catch(e) { return null; }
}
function _clearVoucherOtp(token) {
  try { localStorage.removeItem('pm_votp_' + token); } catch(e) {}
}

function _showOtpModal(otp, amount, token, claimUrl, expiresAt) {
  // Store so it can be shown again from the voucher card
  _storeVoucherOtp(token, otp);

  _renderOtpModal(otp, amount, token, claimUrl, expiresAt);
}

function _renderOtpModal(otp, amount, token, claimUrl, expiresAt) {
  // Remove any existing modal
  const existing = document.getElementById('otp-reveal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'otp-reveal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(3,5,10,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;padding:20px;animation:screenIn .3s var(--ease) both;';

  overlay.innerHTML = `
    <div style="width:100%;max-width:380px;background:linear-gradient(158deg,rgba(255,255,255,.07),rgba(255,255,255,.03));border:1px solid rgba(0,232,122,.3);border-radius:28px;padding:32px 24px 28px;box-shadow:0 32px 80px rgba(0,0,0,.7),0 0 80px rgba(0,232,122,.08);position:relative;overflow:hidden;">
      <div style="position:absolute;top:0;left:8%;right:8%;height:1.5px;border-radius:99px;background:linear-gradient(90deg,transparent,rgba(0,232,122,.8) 50%,transparent);"></div>
      <div style="text-align:center;margin-bottom:8px;">
        <div style="font-size:32px;margin-bottom:10px;">🔐</div>
        <div style="font-size:19px;font-weight:800;color:var(--text);letter-spacing:-.4px;margin-bottom:6px;">Your Secret Code</div>
        <div style="font-size:13px;color:var(--text2);font-weight:500;line-height:1.5;">Share this code with the receiver <strong style="color:var(--text);">separately</strong> from the link. You can view it again from the voucher card.</div>
      </div>
      <div style="margin:22px 0;background:rgba(0,0,0,.5);border:2px solid rgba(0,232,122,.35);border-radius:18px;padding:20px 16px;text-align:center;">
        <div style="font-size:10px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:var(--text3);margin-bottom:12px;">6-DIGIT CODE</div>
        <div id="otp-code-display" style="font-family:var(--mono);font-size:44px;font-weight:700;color:var(--em);letter-spacing:10px;text-shadow:0 0 32px rgba(0,232,122,.4);user-select:all;">${otp}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:10px;font-weight:500;">₹${Number(amount).toFixed(2)} · Expires in 48h · Max 3 attempts</div>
      </div>
      <button type="button" id="otp-copy-btn"
        style="width:100%;padding:12px;background:rgba(0,232,122,.12);border:1px solid rgba(0,232,122,.25);border-radius:var(--r);color:var(--em);font:700 13px/1 var(--sans);cursor:pointer;margin-bottom:10px;transition:background .2s;">
        📋 Copy Code
      </button>
      <div style="background:rgba(77,159,255,.08);border:1px solid rgba(77,159,255,.2);border-radius:12px;padding:11px 14px;font-size:12px;color:rgba(150,190,255,.9);font-weight:600;line-height:1.5;margin-bottom:20px;">
        💡 You can view this code again anytime by tapping <strong>Show Code</strong> on the voucher card.
      </div>
      <button type="button" id="otp-confirm-btn"
        style="width:100%;padding:16px;background:linear-gradient(135deg,var(--em),#00F5A8);border:none;border-radius:var(--r);color:#011A0A;font:800 15px/1 var(--sans);cursor:pointer;box-shadow:0 8px 28px rgba(0,232,122,.35);">
        ✅ Done — View Voucher
      </button>
    </div>`;

  document.body.appendChild(overlay);

  document.getElementById('otp-copy-btn').addEventListener('click', () => {
    navigator.clipboard && navigator.clipboard.writeText(otp).catch(() => {});
    const btn = document.getElementById('otp-copy-btn');
    if (btn) { btn.textContent = '✅ Copied!'; setTimeout(() => { if (btn) btn.textContent = '📋 Copy Code'; }, 2000); }
  });

  document.getElementById('otp-confirm-btn').addEventListener('click', () => {
    overlay.remove();
    // Now render the voucher card WITH the stored code accessible
    renderSingleVoucher(token, amount, 'pending', claimUrl, expiresAt);
  });
}

// Expose so voucher cards can call it
window._renderOtpModal = _renderOtpModal;
window._getVoucherOtp  = _getVoucherOtp;
window._clearVoucherOtp = _clearVoucherOtp;

// ── Build the public /claim/<token> URL ──
function _buildClaimUrl(token) {
  return window.location.origin + window.location.pathname.replace(/\/?$/, '') + '/claim.html?t=' + token;
}

// ═══════════════════════════════════════════
// PHASE 1 — EXPIRY SWEEP
// Runs hourly: finds pending vouchers past their expiresAt
// and refunds the sender. Safe to call multiple times.
// ═══════════════════════════════════════════

let _expirySweepTimer = null;

function _scheduleExpirySweep() {
  if (_expirySweepTimer) return; // already scheduled
  _expirySweepTimer = setInterval(runExpirySweep, 60 * 60 * 1000); // every hour
  // Also run once after a short delay in case app stays open
  setTimeout(runExpirySweep, 5 * 60 * 1000);
}

window.runExpirySweep = async function() {
  if (!CURRENT_USER.phone) return;
  try {
    const { getDocs, writeBatch } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const now = new Date().toISOString();
    // Fetch all pending vouchers by this user that have expired
    const q = query(
      collection(db,"vouchers"),
      where("createdBy","==", CURRENT_USER.phone),
      where("status","==","pending")
    );
    const snap = await getDocs(q);
    const expired = [];
    snap.forEach(d => {
      const v = d.data();
      if (v.expiresAt && v.expiresAt < now) expired.push({ ref: d.ref, data: v });
    });
    if (!expired.length) return;

    const batch = writeBatch(db);
    const userRef = doc(db,"users", CURRENT_USER.phone);

    // Read current balance once (not in transaction — acceptable for sweep)
    const { getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const userSnap = await getDoc(userRef);
    const curBal   = userSnap.exists() ? (userSnap.data().balance || 0) : 0;
    let refundTotal = 0;

    for (const { ref, data } of expired) {
      batch.update(ref, { status: 'expired', expiredAt: now });
      refundTotal += Number(data.amount || 0);
      batch.set(doc(collection(db,"transactions")), {
        phone:  CURRENT_USER.phone,
        label:  `Voucher Expired — ₹${Number(data.amount).toFixed(2)} refunded`,
        amount: Number(data.amount),
        type:   'credit',
        time:   now
      });
    }

    // Refund balance atomically in a single update
    if (refundTotal > 0) {
      batch.update(userRef, { balance: curBal + refundTotal });
      const newBal = parseFloat(sessionStorage.getItem('pm_balance')||'0') + refundTotal;
      sessionStorage.setItem('pm_balance', newBal.toFixed(2));
    }

    await batch.commit();
    console.info(`[PayMesh] Expired ${expired.length} voucher(s), refunded ₹${refundTotal.toFixed(2)}`);

    // Remove expired cards from UI
    expired.forEach(({ data }) => {
      const card = document.querySelector(`[data-voucher-code="${data.code}"]`);
      if (card) card.remove();
    });
    try { sessionStorage.removeItem(_VOUCHER_CACHE_KEY()); } catch(e) {}
  } catch(e) {
    console.error('[PayMesh] Expiry sweep failed:', e);
  }
}

// ═══════════════════════════════════════════
// PHASE 1 — MARK AS PAID (Admin action)
// You manually paid the UPI → flip status to paid
// ═══════════════════════════════════════════

// Show the stored secret code for a voucher at any time
window._showVoucherCode = function(token, amount, claimUrl, expiresAt) {
  const otp = _getVoucherOtp(token);
  if (!otp) {
    // Code not in local storage (older device / cleared) — show helpful message
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(3,5,10,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
      <div style="width:100%;max-width:340px;background:linear-gradient(158deg,rgba(255,255,255,.07),rgba(255,255,255,.03));border:1px solid rgba(255,184,48,.3);border-radius:24px;padding:28px 22px;text-align:center;box-shadow:0 32px 80px rgba(0,0,0,.7);">
        <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
        <div style="font-size:16px;font-weight:800;color:var(--text);margin-bottom:8px;">Code Not Available</div>
        <div style="font-size:13px;color:var(--text2);line-height:1.6;margin-bottom:20px;">The code was created on a different device or browser. The receiver still needs to use the claim link — they can request the code from you directly.</div>
        <button type="button" onclick="this.closest('[style*=fixed]').remove()" style="width:100%;padding:14px;background:rgba(255,184,48,.15);border:1px solid rgba(255,184,48,.3);border-radius:12px;color:var(--amber);font:700 14px/1 var(--sans);cursor:pointer;">OK</button>
      </div>`;
    document.body.appendChild(overlay);
    return;
  }
  _renderOtpModal(otp, amount, token, claimUrl, expiresAt);
};

window.markVoucherPaid = async function(token) {
  if (!CURRENT_USER.phone) return;
  if (!confirm(`Mark voucher ${token} as PAID? This confirms you sent the UPI payment.`)) return;
  try {
    await updateDoc(doc(db,"vouchers",token), {
      status: 'paid',
      paidAt: new Date().toISOString()
    });
    // Update UI card status badge
    const card = document.querySelector(`[data-voucher-code="${token}"]`);
    if (card) {
      const badge = card.querySelector('.voucher-status-badge');
      if (badge) { badge.textContent = '✅ PAID'; badge.style.background = 'rgba(0,232,122,.18)'; badge.style.color = 'var(--em)'; }
    }
    // Also remove from claimed-vouchers-list row if present
    const adminRow = document.querySelector(`[data-admin-voucher="${token}"]`);
    if (adminRow) adminRow.remove();
    // Re-check if section is now empty
    const list = document.getElementById('claimed-vouchers-list');
    const section = document.getElementById('claimed-vouchers-section');
    if (list && section && list.children.length === 0) section.style.display = 'none';
    alert('Marked as paid.');
  } catch(e) {
    alert('Error: ' + (e.message || 'Could not update. Check internet.'));
  }
}

// Load all UNUSED vouchers created by this user from Firestore
// Cached in sessionStorage for 2 minutes — screen re-opens don't cost a read.
const _VOUCHER_CACHE_KEY = () => 'pm_vcache_' + (CURRENT_USER.phone || '');
const _VOUCHER_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

async function loadVouchersFromFirestore() {
  if (!CURRENT_USER.phone) return;
  const display = document.getElementById('voucher-display');

  // Try cache first
  try {
    const raw = sessionStorage.getItem(_VOUCHER_CACHE_KEY());
    if (raw) {
      const cached = JSON.parse(raw);
      if (Date.now() - cached.ts < _VOUCHER_CACHE_TTL) {
        _renderVouchers(cached.vouchers);
        return;
      }
    }
  } catch(e) {}

  display.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px;font-size:13px">Loading vouchers…</div>';
  try {
    // Phase 1: show both legacy UNUSED and new 'pending'/'claimed' vouchers
    const q    = query(collection(db,"vouchers"), where("createdBy","==",CURRENT_USER.phone), where("status","in",["UNUSED","pending","claimed","needs_payout","completed"]));
    const { getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const vSnap = await getDocs(q);
    const vouchers = [];
    vSnap.forEach(d => vouchers.push(d.data()));
    vouchers.sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
    // Save to cache
    try { sessionStorage.setItem(_VOUCHER_CACHE_KEY(), JSON.stringify({ vouchers, ts: Date.now() })); } catch(e) {}
    _renderVouchers(vouchers);
  } catch(e) {
    display.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px;font-size:13px">Could not load vouchers</div>';
    console.error('Voucher load error:', e);
  }
}

function _renderVouchers(vouchers) {
  const display = document.getElementById('voucher-display');
  display.innerHTML = '';
  if (!vouchers.length) {
    display.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px;font-size:13px">No active vouchers</div>';
    return;
  }
  vouchers.forEach(v => renderSingleVoucher(v.code, v.amount, v.status, v.claimUrl, v.expiresAt));
}

window.restoreVoucher = loadVouchersFromFirestore;

// ═══════════════════════════════════════════
// PHASE 1 — CLAIMED VOUCHER ADMIN PANEL
// Shows vouchers where receiver submitted their UPI ID.
// Sender sees them here, pays via UPI app, marks as paid.
// ═══════════════════════════════════════════

async function loadClaimedVouchers() {
  if (!CURRENT_USER.phone) return;
  const section = document.getElementById('claimed-vouchers-section');
  const list    = document.getElementById('claimed-vouchers-list');
  if (!section || !list) return;

  try {
    const { getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const q    = query(collection(db,'vouchers'), where('createdBy','==',CURRENT_USER.phone), where('status','==','needs_payout'));
    const snap = await getDocs(q);
    if (snap.empty) { section.style.display = 'none'; return; }

    section.style.display = 'block';
    list.innerHTML = '';

    snap.forEach(d => {
      const v      = d.data();
      const amount = Number(v.amount || 0);
      const upi    = v.claimUpi || '—';
      const claimTime = v.claimedAt ? new Date(v.claimedAt).toLocaleString() : '';

      const row = document.createElement('div');
      row.dataset.adminVoucher = v.code || '';
      row.style.cssText = 'background:linear-gradient(158deg,rgba(77,159,255,.09),rgba(0,232,122,.06));border:1px solid rgba(77,159,255,.22);border-radius:16px;padding:16px 18px;margin-bottom:10px;';
      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px">
          <div>
            <div style="font-size:10px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:var(--blue);margin-bottom:4px">Claimed · ₹${amount.toFixed(2)}</div>
            <div style="font-size:12px;color:var(--text2);font-weight:500">${claimTime}</div>
          </div>
          <div style="font-size:9px;color:var(--text3);font-family:var(--mono);word-break:break-all;text-align:right;max-width:60%">${v.code || ''}</div>
        </div>
        <div style="background:rgba(0,0,0,.35);border:1px solid var(--border2);border-radius:10px;padding:10px 12px;margin-bottom:12px;">
          <div style="font-size:9px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:4px">Receiver's UPI ID</div>
          <div style="font-family:var(--mono);font-size:14px;color:var(--text);font-weight:700;word-break:break-all;user-select:all">${escHtml(upi)}</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button type="button"
            onclick="_openUpiApp('${escAttr(upi)}',${amount})"
            style="flex:1;padding:10px;background:rgba(0,232,122,.12);border:1px solid rgba(0,232,122,.25);border-radius:12px;color:var(--em);font:700 12px/1 var(--sans);cursor:pointer;">
            📲 Open UPI App
          </button>
          <button type="button"
            onclick="_copyUpi('${escAttr(upi)}')"
            style="padding:10px 14px;background:var(--surface);border:1px solid var(--border2);border-radius:12px;color:var(--text2);font:700 12px/1 var(--sans);cursor:pointer;">
            📋 Copy
          </button>
          <button type="button"
            onclick="markVoucherPaid('${escAttr(v.code || '')}')"
            style="padding:10px 14px;background:rgba(77,159,255,.14);border:1px solid rgba(77,159,255,.28);border-radius:12px;color:var(--blue);font:700 11px/1 var(--sans);cursor:pointer;">
            ✅ Paid
          </button>
        </div>`;
      list.appendChild(row);
    });
  } catch(e) {
    console.error('[PayMesh] loadClaimedVouchers error:', e);
    if (section) section.style.display = 'none';
  }
}

window._openUpiApp = function(upi, amount) {
  // Opens default UPI app deep link — works with GPay, PhonePe, Paytm
  // NOTE: window.open() is blocked for custom schemes on mobile browsers.
  // location.href is the correct way to trigger UPI deep links on Android/iOS.
  const link = `upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent('PayMesh Voucher')}&am=${Number(amount).toFixed(2)}&cu=INR&tn=${encodeURIComponent('PayMesh Voucher Payment')}`;
  location.href = link;
};

window._copyUpi = function(upi) {
  navigator.clipboard.writeText(upi).then(() => alert('UPI ID copied: ' + upi)).catch(() => alert('UPI ID: ' + upi));
};

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function escAttr(s) { return String(s).replace(/'/g,"\\'").replace(/"/g,'&quot;'); }

function renderSingleVoucher(code, amount, status, claimUrl, expiresAt) {
  // Hide consumed/legacy states
  if (status === 'USED' || status === 'expired' || status === 'paid') return;

  const display = document.getElementById('voucher-display');
  const placeholder = display.querySelector('[data-placeholder]');
  if (placeholder) placeholder.remove();

  // ── Determine display mode ──
  // Phase 1: new vouchers have status 'pending' or 'claimed' and a claimUrl
  // Legacy: status === 'UNUSED' — show old QR UI
  const isPhase1 = (status === 'pending' || status === 'claimed' || status === 'needs_payout' || status === 'completed') && claimUrl;

  const wrapper = document.createElement('div');
  wrapper.className = 'voucher-entry';
  wrapper.dataset.voucherCode = code;
  wrapper.style.cssText = 'animation:slideUp .35s var(--ease) both;';

  // ── Status badge text ──
  let badgeText = '⏳ PENDING';
  let badgeBg   = 'rgba(255,184,48,.18)';
  let badgeColor= 'var(--amber)';
  if (status === 'claimed')      { badgeText = '🔔 CLAIMED — PAY NOW';   badgeBg = 'rgba(77,159,255,.18)';  badgeColor = 'var(--blue)'; }
  if (status === 'needs_payout') { badgeText = '💸 NEEDS PAYOUT';        badgeBg = 'rgba(77,159,255,.18)';  badgeColor = 'var(--blue)'; }
  if (status === 'completed')    { badgeText = '✅ COMPLETED';            badgeBg = 'rgba(0,232,122,.18)';   badgeColor = 'var(--em)'; }

  // ── Expiry display ──
  let expiryText = '';
  if (expiresAt) {
    try {
      const exp = new Date(expiresAt);
      const diffMs = exp - Date.now();
      const diffH  = Math.floor(diffMs / 3600000);
      const diffM  = Math.floor((diffMs % 3600000) / 60000);
      expiryText = diffMs > 0
        ? `Expires in ${diffH}h ${diffM}m`
        : 'Expired — awaiting refund';
    } catch(e) {}
  }

  if (isPhase1) {
    // ── PHASE 1 — Open-loop claim link card ──
    const shortCode = code.length > 14 ? code.substring(0,14) + '…' : code;
    wrapper.innerHTML = `
      <div class="voucher-card" style="background:linear-gradient(158deg,rgba(255,184,48,.10),rgba(0,232,122,.07));border-color:rgba(255,184,48,.22);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div class="voucher-label" style="margin:0">PayMesh Voucher · Open Link</div>
          <span class="voucher-status-badge" style="font-size:9px;font-weight:800;letter-spacing:.8px;padding:4px 9px;border-radius:6px;background:${badgeBg};color:${badgeColor};">${badgeText}</span>
        </div>
        <div class="voucher-code" style="font-size:13px;word-break:break-all">${shortCode}</div>
        <div class="voucher-sub" style="margin-top:6px">₹${Number(amount).toFixed(2)} · by ${CURRENT_USER.name}${expiryText ? ' · ' + expiryText : ''}</div>
      </div>
      <div class="card" style="margin-top:0">
        <p class="info-text" style="margin-bottom:12px">Share this link — receiver enters their UPI ID to claim</p>
        <div style="background:rgba(0,0,0,.4);border:1.5px solid var(--border2);border-radius:var(--r);padding:12px 14px;font:600 11px/1.5 var(--mono);color:var(--text2);word-break:break-all;user-select:all;cursor:text;" onclick="this.focus()">${claimUrl}</div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button type="button" onclick="_copyClaimLink('${code}','${claimUrl.replace(/'/g,"&#39;")}')" style="flex:1;padding:11px;background:rgba(0,232,122,.12);border:1px solid rgba(0,232,122,.25);border-radius:var(--r);color:var(--em);font:700 12px/1 var(--sans);cursor:pointer;transition:background .2s;" onmouseover="this.style.background='rgba(0,232,122,.2)'" onmouseout="this.style.background='rgba(0,232,122,.12)'">📋 Copy Link</button>
          <button type="button" onclick="_shareClaimLink('${claimUrl.replace(/'/g,"&#39;")}',${amount})" style="flex:1;padding:11px;background:rgba(77,159,255,.12);border:1px solid rgba(77,159,255,.25);border-radius:var(--r);color:var(--blue);font:700 12px/1 var(--sans);cursor:pointer;transition:background .2s;" onmouseover="this.style.background='rgba(77,159,255,.2)'" onmouseout="this.style.background='rgba(77,159,255,.12)'">↗ Share</button>
        </div>
        <button type="button" id="show-code-btn-${code}" onclick="window._showVoucherCode('${code}',${amount},'${claimUrl.replace(/'/g,"&#39;")}','${expiresAt||''}')" style="width:100%;margin-top:8px;padding:11px;background:rgba(255,184,48,.1);border:1px solid rgba(255,184,48,.22);border-radius:var(--r);color:var(--amber);font:700 12px/1 var(--sans);cursor:pointer;transition:background .2s;" onmouseover="this.style.background='rgba(255,184,48,.18)'" onmouseout="this.style.background='rgba(255,184,48,.1)'">🔐 Show Secret Code</button>
        ${(status === 'claimed' || status === 'needs_payout') ? `
        <div style="margin-top:10px;padding:10px 12px;background:rgba(77,159,255,.10);border:1px solid rgba(77,159,255,.22);border-radius:var(--r);font-size:12px;color:var(--blue);font-weight:600;line-height:1.5;">
          🔔 Receiver has entered their UPI ID. Check the <strong>PayMesh Admin</strong> panel to view it, send payment manually, then mark as paid.
        </div>
        <button type="button" onclick="markVoucherPaid('${code}')" style="width:100%;margin-top:10px;padding:12px;background:linear-gradient(135deg,rgba(0,232,122,.18),rgba(0,232,122,.08));border:1px solid rgba(0,232,122,.28);border-radius:var(--r);color:var(--em);font:800 13px/1 var(--sans);cursor:pointer;">✅ I've Sent the UPI — Mark as Paid</button>
        ` : ''}
      </div>`;
  } else {
    // ── LEGACY — QR scan-based voucher ──
    const qrId = 'vqr-' + code;
    wrapper.innerHTML = `
      <div class="voucher-card">
        <div class="voucher-label">Offline Voucher · PayMesh</div>
        <div class="voucher-code">${code}</div>
        <div class="voucher-sub">₹${Number(amount).toFixed(2)} · by ${CURRENT_USER.name}</div>
      </div>
      <div class="card center-card">
        <p class="info-text">Show this QR to pay offline</p>
        <div id="${qrId}" class="qr-wrap"></div>
        <p class="hint">Recipient scans with PayMesh → Scan QR</p>
      </div>`;
    display.insertBefore(wrapper, display.firstChild);
    function makeQR() {
      if (typeof QRCode === 'undefined') { setTimeout(makeQR, 200); return; }
      try {
        new QRCode(document.getElementById(qrId), {
          text: JSON.stringify({ code, amount: Number(amount), from: CURRENT_USER.name }),
          width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff"
        });
      } catch(e) { console.warn('QR generation failed:', e); }
    }
    makeQR();
    return;
  }

  display.insertBefore(wrapper, display.firstChild);
}

// ── Claim link helpers ──
window._copyClaimLink = function(code, url) {
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.querySelector(`[data-voucher-code="${code}"] button`);
    if (btn) { const orig = btn.textContent; btn.textContent = '✓ Copied!'; setTimeout(() => btn.textContent = orig, 2000); }
  }).catch(() => { alert('Copy this link:\n' + url); });
};

window._shareClaimLink = function(url, amount) {
  if (navigator.share) {
    navigator.share({
      title: 'PayMesh Voucher',
      text: `I've sent you ₹${Number(amount).toFixed(2)} via PayMesh. Open this link to claim it — enter your UPI ID and I'll transfer it to you:`,
      url: url
    }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url).catch(() => {});
    alert('Link copied! Share it with the receiver.');
  }
};

// ═══════════════════════════════════════════
// OFFLINE VOUCHER SYNC
// ═══════════════════════════════════════════

async function replayPendingVouchers() {
  const pending = JSON.parse(localStorage.getItem('pending_vouchers') || '[]');
  if (!pending.length) return;
  const stillPending = [];
  for (const v of pending) {
    const amount = Number(v.amount);
    try {
      const vRef        = doc(db,"vouchers",v.code);
      const receiverRef = doc(db,"users",CURRENT_USER.phone);
      let createdBy = '';
      let didTransact = false;
      await runTransaction(db, async (tx) => {
        const vSnap = await tx.get(vRef);
        const rSnap = await tx.get(receiverRef);
        // Voucher already used or doesn't exist — skip silently
        if (!vSnap.exists() || vSnap.data().status === 'USED') return;
        if (!rSnap.exists()) throw new Error('Account not found');
        createdBy = vSnap.data().createdBy || '';
        didTransact = true;
        tx.update(vRef, { status:'USED', redeemedBy:CURRENT_USER.phone, redeemedByName:CURRENT_USER.name, redeemedAt:new Date().toISOString() });
        tx.update(receiverRef, { balance:(rSnap.data().balance||0) + amount });
      });
      // Only write transaction records if the Firestore transaction actually ran
      if (didTransact && createdBy) {
        const time = new Date().toISOString();
        await Promise.all([
          addDoc(collection(db,"transactions"), { phone:CURRENT_USER.phone, label:`Voucher from ${v.from}`, amount, type:"credit", time }),
          addDoc(collection(db,"transactions"), { phone:createdBy, label:`Voucher redeemed by ${CURRENT_USER.name}`, amount, type:"debit", time })
        ]);
      }
    } catch(e) {
      if (e.message !== 'Account not found') stillPending.push(v);
      console.warn('Voucher replay failed:', v.code, e.message);
    }
  }
  localStorage.setItem('pending_vouchers', JSON.stringify(stillPending));
}

// ═══════════════════════════════════════════
// RECEIVE / MY QR
// ═══════════════════════════════════════════

function generateReceiveQR() {
  const c = document.getElementById('receive-qr');
  c.innerHTML = '';
  document.getElementById('receive-upi-display').textContent = CURRENT_USER.upi;
  function makeQR() {
    if (typeof QRCode === 'undefined') { setTimeout(makeQR, 200); return; }
    try {
      new QRCode(c, {
        text: JSON.stringify({ type:'person', phone:CURRENT_USER.phone, name:CURRENT_USER.name, upi:CURRENT_USER.upi }),
        width:200, height:200, colorDark:"#000000", colorLight:"#ffffff"
      });
    } catch(e) { console.warn('Receive QR failed:', e); }
  }
  makeQR();
}

// ═══════════════════════════════════════════
// QR SCANNER
// ═══════════════════════════════════════════

window.startScan = async function() {
  showScreen('screen-scan');
  document.getElementById('scan-result').classList.add('hidden');
  document.getElementById('scan-send-result').classList.add('hidden');
  const scanMsg = document.getElementById('scan-msg');
  scanMsg.className = 'msg';
  detectedQR = null;
  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode:'environment' } });
    const video   = document.getElementById('scanner-video');
    video.srcObject = scannerStream;
    await video.play();
    await loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');
    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d');
    scannerInterval = setInterval(() => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img  = ctx.getImageData(0,0,canvas.width,canvas.height);
        const code = jsQR(img.data, img.width, img.height);
        if (code) {
          try {
            const data = JSON.parse(code.data);
            if (data.type === 'person' && data.phone && data.name) {
              clearInterval(scannerInterval); scannerInterval = null;
              if (scannerStream) { scannerStream.getTracks().forEach(t => t.stop()); scannerStream = null; }
              detectedQR = { kind:'person', ...data };
              showPersonResult(data); return;
            }
            if (data.code && data.amount && data.from) {
              clearInterval(scannerInterval); scannerInterval = null;
              if (scannerStream) { scannerStream.getTracks().forEach(t => t.stop()); scannerStream = null; }
              detectedQR = { kind:'voucher', ...data };
              showVoucherResult(data);
            }
          } catch(e) { /* not PayMesh QR */ }
        }
      }
    }, 300);
  } catch(e) {
    alert('Camera permission needed. Please allow camera access.');
    showScreen('screen-home');
  }
}

function showPersonResult(data) {
  const panel = document.getElementById('scan-send-result');
  panel.classList.remove('hidden');
  document.getElementById('scan-person-name').textContent  = data.name;
  document.getElementById('scan-person-phone').textContent = data.phone;
  document.getElementById('scan-person-upi').textContent   = data.upi || '';
  document.getElementById('send-phone').value  = data.phone;
  document.getElementById('send-amount').value = '';
  if (navigator.vibrate) navigator.vibrate([100,50,100]);
}

function showVoucherResult(data) {
  document.getElementById('scan-result').classList.remove('hidden');
  document.getElementById('scan-voucher-code').textContent   = data.code;
  document.getElementById('scan-voucher-amount').textContent = `₹${Number(data.amount).toFixed(2)}`;
  document.getElementById('scan-voucher-from').textContent   = `From ${data.from}`;
  document.getElementById('scan-amount-btn').textContent     = Number(data.amount).toFixed(2);
  if (navigator.vibrate) navigator.vibrate([100,50,100]);
}

window.proceedToSend = function() {
  if (scannerInterval) { clearInterval(scannerInterval); scannerInterval = null; }
  if (scannerStream)   { scannerStream.getTracks().forEach(t => t.stop()); scannerStream = null; }
  // Capture phone before detectedQR is cleared — showScreen resets the send form
  const prefilledPhone = detectedQR && detectedQR.kind === 'person' ? detectedQR.phone : null;
  detectedQR = null;
  showScreen('screen-send');
  // Re-fill the phone field (showScreen reset it) and trigger fraud analysis
  if (prefilledPhone) {
    const phoneEl = document.getElementById('send-phone');
    if (phoneEl) {
      phoneEl.value = prefilledPhone;
      // Manually trigger so fraud copilot runs on the pre-filled value
      if (window.onSendFieldChange) window.onSendFieldChange();
    }
  }
}

// ═══════════════════════════════════════════
// REDEEM VOUCHER
// ═══════════════════════════════════════════

window.redeemVoucher = async function() {
  const msg = document.getElementById('scan-msg');
  if (!detectedQR || detectedQR.kind !== 'voucher') { showMsg(msg,'error','No voucher detected'); return; }
  if (!CURRENT_USER.phone) { showMsg(msg,'error','Session error — please log out and log in again.'); return; }

  const voucher = detectedQR;
  const amount  = Number(voucher.amount);
  if (!amount || amount <= 0) { showMsg(msg,'error','Invalid voucher amount'); return; }

  const fromName = voucher.from;

  try { await requirePin('Confirm Redeem', `Enter PIN to redeem ₹${amount.toFixed(2)} voucher`); }
  catch(e) {
    if (e && e.message && e.message.startsWith('PIN locked')) {
      showMsg(msg, 'error', e.message);
    }
    msg.className = 'msg'; msg.textContent = ''; return;
  }

  showMsg(msg,'success','Verifying...');

  // §5: Voucher redeem-side Aria checks (runs before the Firestore transaction)
  try {
    const currentBal = parseFloat(sessionStorage.getItem('pm_balance') || '0');
    const redeemSignals = [];
    let redeemScore = 0;

    // V4: Large redeem vs redeemer's current balance
    if (currentBal > 0 && amount / currentBal > 0.5) {
      redeemScore += 30;
      redeemSignals.push({ sev:'amber', icon:'💸', text:`This voucher is worth ${Math.round(amount/currentBal*100)}% of your current balance — verify you recognise the sender.` });
    }

    // V5: Time-between-create-and-redeem (< 60 seconds = suspicious)
    if (voucher.createdAt) {
      const createAge = Date.now() - new Date(voucher.createdAt).getTime();
      if (createAge < 60 * 1000) {
        redeemScore += 40;
        redeemSignals.push({ sev:'red', icon:'⏱️', text:`This voucher was created less than 60 seconds ago — be very cautious, this could be a social engineering attack.` });
      }
    }

    if (redeemSignals.length > 0) {
      const redeemTier = redeemScore >= 55 ? 'red' : 'amber';
      ariaLogEvent(redeemTier, 'voucher', redeemSignals, amount);
      // For high-risk, require confirmation
      if (redeemTier === 'red') {
        const ok = confirm(`⚠️ Aria Warning: ${redeemSignals[0].text}\n\nDo you still want to redeem this voucher?`);
        if (!ok) { msg.className = 'msg'; msg.textContent = ''; return; }
      }
    }
  } catch(vErr) { /* non-blocking */ }

  try {
    const vRef        = doc(db,"vouchers",voucher.code);
    const receiverRef = doc(db,"users",CURRENT_USER.phone);
    let createdBy     = '';

    await runTransaction(db, async (tx) => {
      const vSnap = await tx.get(vRef);
      const rSnap = await tx.get(receiverRef);
      if (!vSnap.exists())                               throw new Error('Voucher not found');
      if (vSnap.data().status === 'USED')                throw new Error('Already redeemed');
      if (vSnap.data().createdBy === CURRENT_USER.phone) throw new Error('Cannot redeem your own voucher');
      if (!rSnap.exists())                               throw new Error('Your account not found');
      createdBy = vSnap.data().createdBy;
      const rBal = rSnap.data().balance || 0;
      tx.update(vRef,        { status:'USED', redeemedBy:CURRENT_USER.phone, redeemedByName:CURRENT_USER.name, redeemedAt:new Date().toISOString() });
      tx.update(receiverRef, { balance: rBal + amount });
    });

    const time = new Date().toISOString();
    await Promise.all([
      addDoc(collection(db,"transactions"), { phone:CURRENT_USER.phone, label:`Voucher from ${fromName}`,          amount, type:"credit", time }),
      addDoc(collection(db,"transactions"), { phone:createdBy,          label:`Voucher redeemed by ${CURRENT_USER.name}`, amount, type:"debit",  time })
    ]);
    // Delete voucher doc after successful redeem to save Firestore space
    deleteDoc(vRef).catch(() => {});

    const newBal = parseFloat(sessionStorage.getItem('pm_balance')||'0') + amount;
    sessionStorage.setItem('pm_balance', newBal.toFixed(2));
    window.stopScan();
    launchConfetti(80);
    if (navigator.vibrate) navigator.vibrate([200,100,200,100,400]);
    showOverlay('', 'Received!', `₹${amount.toFixed(2)} from ${fromName} added to wallet`);

  } catch(e) {
    if (e.message === 'Failed to get document because the client is offline.') {
      const pending = JSON.parse(localStorage.getItem('pending_vouchers') || '[]');
      pending.push({ ...voucher, amount, redeemedBy:CURRENT_USER.phone, time:new Date().toISOString() });
      localStorage.setItem('pending_vouchers', JSON.stringify(pending));
      const lb = parseFloat(sessionStorage.getItem('pm_balance') || '0');
      sessionStorage.setItem('pm_balance', (lb + amount).toFixed(2));
      window.stopScan();
      showOverlay('', 'Saved Offline!', `₹${amount.toFixed(2)} saved — syncs when internet returns`);
    } else {
      showMsg(msg,'error', e.message || 'Error. Try again.');
    }
    console.error(e);
  }
}

window.stopScan = function() {
  if (scannerInterval) { clearInterval(scannerInterval); scannerInterval = null; }
  if (scannerStream)   { scannerStream.getTracks().forEach(t => t.stop()); scannerStream = null; }
  detectedQR = null;
  showScreen('screen-home');
}

// ═══════════════════════════════════════════
// INIT — session restore + device token check
// ═══════════════════════════════════════════

(function init() {
  function run() {
    // Read from localStorage first (persists across tab close/app reopen),
    // fall back to sessionStorage for any legacy in-session-only writes.
    const phone = localStorage.getItem('pm_phone') || sessionStorage.getItem('pm_phone');
    const name  = localStorage.getItem('pm_name')  || sessionStorage.getItem('pm_name')  || '';
    const upi   = localStorage.getItem('pm_upi')   || sessionStorage.getItem('pm_upi')   || '';

    // Preload QRCode lib eagerly so "My QR" screen renders instantly
    loadScript('https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js').catch(() => {});

    if (!phone) {
      showScreen('screen-login');
      return;
    }

    CURRENT_USER.phone = phone;
    CURRENT_USER.name  = name;
    CURRENT_USER.upi   = upi;
    refreshPinSettingsUI();
    showScreen('screen-home');
  }

  // Small delay ensures sessionStorage is fully readable in PWA standalone mode
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(run, 100); });
  } else {
    setTimeout(run, 100);
  }
})();

// ═══════════════════════════════════════════
// RIPPLE + PHONE FIELD LISTENER INIT
// ═══════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.btn-primary,.action-btn,.back-btn').forEach(btn => {
    btn.addEventListener('click', addRipple);
  });

  const phoneEl = document.getElementById('login-phone');
  if (phoneEl) {
    const handler = () => detectExistingUser(phoneEl.value.trim());
    phoneEl.addEventListener('input',  handler);
    phoneEl.addEventListener('change', handler);
    phoneEl.addEventListener('paste',  () => setTimeout(handler, 0));
  }

  // Replay any pending offline vouchers when the device comes back online
  window.addEventListener('online', () => {
    if (CURRENT_USER.phone) replayPendingVouchers().catch(() => {});
  });
});
