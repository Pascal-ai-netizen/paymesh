import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  doc, setDoc, updateDoc, getDoc,
  collection, addDoc, query, where,
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

function getLocalToken()        { return localStorage.getItem('pm_device_token') || null; }
function setLocalToken(token)   { localStorage.setItem('pm_device_token', token); }
function clearLocalToken()      { localStorage.removeItem('pm_device_token'); }

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
    const stored  = getCachedPinHash();
    const entered = await hashPin(_pinBuffer);
    if (entered === stored) {
      document.getElementById('pin-overlay').classList.add('hidden');
      _pinBuffer = ''; _pinMode = null;
      if (_pinCallback) { _pinCallback(); _pinCallback = null; }
    } else {
      showMsg(document.getElementById('pin-msg'), 'error', 'Incorrect PIN. Try again.');
      flashPinError();
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
  document.getElementById('overlay-title').textContent = title;
  document.getElementById('overlay-sub').textContent   = sub;
  document.getElementById('success-overlay').classList.remove('hidden');
}

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
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  target.classList.add('active');
  target.scrollTop = 0;

  if (id === 'screen-home')    loadHomeData();
  if (id === 'screen-receive') generateReceiveQR();
  if (id === 'screen-pin')     refreshPinSettingsUI();
  if (id === 'screen-load') {
    document.getElementById('display-upi').textContent = PAYMESH_UPI;
    buildUPILink();
  }
  if (id === 'screen-voucher') {
    const m = document.getElementById('voucher-msg');
    if (m) { m.className = 'msg'; m.textContent = ''; }
    loadVouchersFromFirestore();
  }
  if (id === 'screen-send') {
    const m = document.getElementById('send-msg');
    if (m) { m.className = 'msg'; m.textContent = ''; }
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
    const amt = parseFloat(amtInput.value) || '';
    btn.href = `upi://pay?pa=${PAYMESH_UPI}&pn=PayMesh&am=${amt}&cu=INR&tn=PayMeshLoad`;
  }
  amtInput._upiLinkListener = updateLink;
  amtInput.addEventListener('input', updateLink);
  updateLink();
  const upiBox = document.getElementById('display-upi');
  upiBox.parentNode.insertBefore(btn, upiBox.nextSibling);
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

    // Reuse token if same device already has valid one (prevents self-kickout on re-login)
    const existingLocal = getLocalToken();
    const firestoreToken = userSnap.exists() ? (userSnap.data().deviceToken || null) : null;
    let deviceToken;
    if (existingLocal && existingLocal === firestoreToken) {
      deviceToken = existingLocal;
    } else {
      deviceToken = generateDeviceToken();
      await updateDoc(userRef, { deviceToken });
      setLocalToken(deviceToken);
    }

    addKnownPhone(phone);

    localStorage.setItem('pm_name', finalName);
    localStorage.setItem('pm_phone', phone);
    localStorage.setItem('pm_upi',   finalUpi);

    // Always remember user on this device
    localStorage.setItem('pm_logged_in', '1');
    sessionStorage.removeItem('pm_session_phone');

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
  clearLocalToken();
  ['pm_name','pm_phone','pm_upi','pm_logged_in','pm_balance'].forEach(k => localStorage.removeItem(k));
  sessionStorage.removeItem('pm_session_phone');
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
  if (unsubBalance) { unsubBalance(); unsubBalance = null; }
  if (unsubTxns)    { unsubTxns();    unsubTxns    = null; }
}

// ═══════════════════════════════════════════
// FORCE RE-LOGIN (device kicked or account deleted)
// ═══════════════════════════════════════════

function forceRelogin(reason) {
  teardownListeners();
  clearLocalToken();
  ['pm_name','pm_phone','pm_upi','pm_logged_in','pm_balance'].forEach(k => localStorage.removeItem(k));
  sessionStorage.removeItem('pm_session_phone');
  CURRENT_USER.name = ''; CURRENT_USER.phone = ''; CURRENT_USER.upi = '';
  if (reason) alert(reason);
  showScreen('screen-login');
}

// ═══════════════════════════════════════════
// HOME DATA — real-time listeners
// ═══════════════════════════════════════════

async function loadHomeData() {
  if (!CURRENT_USER.phone) { showScreen('screen-login'); return; }

  const displayName = CURRENT_USER.name ? `Hi, ${CURRENT_USER.name} 👋` : 'Welcome 👋';
  document.getElementById('display-name').textContent = displayName;
  const cached = parseFloat(localStorage.getItem('pm_balance') || '0');
  document.getElementById('wallet-balance').textContent = cached.toFixed(2);

  teardownListeners();

  unsubBalance = onSnapshot(
    doc(db, "users", CURRENT_USER.phone),
    (snap) => {
      if (!snap.exists()) { forceRelogin(); return; }
      const data = snap.data();

      // ── SINGLE-DEVICE CHECK: if server token differs, this device was kicked ──
      const localToken = getLocalToken();
      if (localToken && data.deviceToken && data.deviceToken !== localToken) {
        forceRelogin('Your account was logged in on another device. You have been signed out.');
        return;
      }

      const bal = data.balance || 0;
      if (data.name && data.name !== CURRENT_USER.name) {
        CURRENT_USER.name = data.name;
        localStorage.setItem('pm_name', data.name);
      }
      if (data.upi && data.upi !== CURRENT_USER.upi) {
        CURRENT_USER.upi = data.upi;
        localStorage.setItem('pm_upi', data.upi);
      }
      // Sync PIN cache live — if PIN was set/removed on another login it reflects here
      syncPinCache(data);
      refreshPinSettingsUI();

      document.getElementById('display-name').textContent = `Hi, ${CURRENT_USER.name} 👋`;
      animateBalance(bal);
      localStorage.setItem('pm_balance', bal.toFixed(2));
    },
    (err) => console.warn('Balance listener error:', err.message)
  );

  const txQuery = query(collection(db,"transactions"), where("phone","==",CURRENT_USER.phone));
  unsubTxns = onSnapshot(
    txQuery,
    (snap) => renderTransactions(snap),
    (err)  => console.warn('Tx listener error:', err.message)
  );
}

function renderTransactions(snap) {
  const list = document.getElementById('tx-list');
  if (snap.empty) { list.innerHTML = '<div class="tx-empty">No transactions yet</div>'; return; }
  const txs = [];
  snap.forEach(d => txs.push(d.data()));
  txs.sort((a,b) => (b.time||'').localeCompare(a.time||''));
  list.innerHTML = txs.slice(0,20).map((tx, i) => {
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
// SEND MONEY
// ═══════════════════════════════════════════

window.sendMoney = async function() {
  const phone  = document.getElementById('send-phone').value.trim();
  const amount = parseFloat(document.getElementById('send-amount').value);
  const msg    = document.getElementById('send-msg');

  if (!/^\d{10}$/.test(phone)) { showMsg(msg,'error','Valid 10-digit phone needed'); return; }
  if (!amount || amount <= 0)  { showMsg(msg,'error','Enter a valid amount'); return; }
  if (!CURRENT_USER.phone)     { showMsg(msg,'error','Session error — please log out and log in again.'); return; }
  if (phone === CURRENT_USER.phone) { showMsg(msg,'error','Cannot send to yourself'); return; }

  try { await requirePin('Confirm Send', `Enter PIN to send ₹${amount.toFixed(2)}`); }
  catch(e) { return; }

  showMsg(msg,'success','Processing...');

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
      addDoc(collection(db,"transactions"), { phone: CURRENT_USER.phone, label:`Sent to ${receiverName}`,   amount, type:"debit",  time }),
      addDoc(collection(db,"transactions"), { phone,                     label:`From ${CURRENT_USER.name}`, amount, type:"credit", time })
    ]);

    const newBal = parseFloat(localStorage.getItem('pm_balance')||'0') - amount;
    localStorage.setItem('pm_balance', Math.max(0,newBal).toFixed(2));
    document.getElementById('send-phone').value  = '';
    document.getElementById('send-amount').value = '';
    if (navigator.vibrate) navigator.vibrate(200);
    showOverlay('', 'Sent!', `₹${amount.toFixed(2)} sent to ${receiverName}`);
  } catch(e) {
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

  try { await requirePin('Confirm Voucher', `Enter PIN to create ₹${amount.toFixed(2)} voucher`); }
  catch(e) { return; }

  showMsg(msg,'success','Creating voucher...');

  try {
    const userRef = doc(db,"users",CURRENT_USER.phone);
    const code    = 'PM' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2,6).toUpperCase();

    await runTransaction(db, async (tx) => {
      const snap    = await tx.get(userRef);
      if (!snap.exists()) throw new Error('Account not found');
      const balance = snap.data().balance || 0;
      if (balance < amount) throw new Error(`Insufficient balance. You have ₹${balance.toFixed(2)}`);
      tx.update(userRef, { balance: balance - amount });
    });

    await Promise.all([
      setDoc(doc(db,"vouchers",code), {
        code, amount: Number(amount),
        createdBy: CURRENT_USER.phone, createdByName: CURRENT_USER.name,
        status: "UNUSED", createdAt: new Date().toISOString()
      }),
      addDoc(collection(db,"transactions"), {
        phone: CURRENT_USER.phone, label:`Voucher Created · ₹${amount.toFixed(2)}`,
        amount: Number(amount), type:"debit", time: new Date().toISOString()
      })
    ]);

    const newBal = parseFloat(localStorage.getItem('pm_balance')||'0') - amount;
    localStorage.setItem('pm_balance', Math.max(0,newBal).toFixed(2));

    document.getElementById('voucher-amount').value = '';
    showMsg(msg,'success',`Voucher for ₹${amount.toFixed(2)} created!`);
    if (navigator.vibrate) navigator.vibrate([100,50,200]);

    // Render the new voucher immediately without reloading all
    renderSingleVoucher(code, amount, 'UNUSED');

  } catch(e) {
    showMsg(msg,'error', e.message || 'Error. Check internet.');
    console.error(e);
  }
}

// Load all UNUSED vouchers created by this user from Firestore
async function loadVouchersFromFirestore() {
  if (!CURRENT_USER.phone) return;
  const display = document.getElementById('voucher-display');
  display.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px;font-size:13px">Loading vouchers…</div>';
  try {
    const q    = query(collection(db,"vouchers"), where("createdBy","==",CURRENT_USER.phone), where("status","==","UNUSED"));
    const snap = await getDoc(doc(db,"_dummy_","_dummy_")).then(() => null).catch(() => null);
    // Use getDocs for one-shot read
    const { getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const vSnap = await getDocs(q);
    display.innerHTML = '';
    if (vSnap.empty) {
      display.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px;font-size:13px">No active vouchers</div>';
      return;
    }
    // Sort newest first
    const vouchers = [];
    vSnap.forEach(d => vouchers.push(d.data()));
    vouchers.sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
    vouchers.forEach(v => renderSingleVoucher(v.code, v.amount, v.status));
  } catch(e) {
    display.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px;font-size:13px">Could not load vouchers</div>';
    console.error('Voucher load error:', e);
  }
}

window.restoreVoucher = loadVouchersFromFirestore;

function renderSingleVoucher(code, amount, status) {
  if (status === 'USED') return;
  const display = document.getElementById('voucher-display');
  // Remove loading placeholder if present
  const placeholder = display.querySelector('[data-placeholder]');
  if (placeholder) placeholder.remove();

  const wrapper = document.createElement('div');
  wrapper.className = 'voucher-entry';
  wrapper.dataset.voucherCode = code;
  wrapper.style.cssText = 'animation:slideUp .35s var(--ease) both;';
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
}

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
      await runTransaction(db, async (tx) => {
        const vSnap = await tx.get(vRef);
        const rSnap = await tx.get(receiverRef);
        if (!vSnap.exists() || vSnap.data().status === 'USED') return;
        if (!rSnap.exists()) throw new Error('Account not found');
        createdBy = vSnap.data().createdBy;
        tx.update(vRef, { status:'USED', redeemedBy:CURRENT_USER.phone, redeemedByName:CURRENT_USER.name, redeemedAt:new Date().toISOString() });
        tx.update(receiverRef, { balance:(rSnap.data().balance||0) + amount });
      });
      if (createdBy) {
        const time = new Date().toISOString();
        await Promise.all([
          addDoc(collection(db,"transactions"), { phone:CURRENT_USER.phone, label:`Voucher from ${v.from}`, amount, type:"credit", time }),
          addDoc(collection(db,"transactions"), { phone:createdBy, label:`Voucher redeemed by ${CURRENT_USER.name}`, amount, type:"debit", time })
        ]);
      }
      console.log('Replayed offline voucher:', v.code);
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
              detectedQR = { kind:'person', ...data };
              showPersonResult(data); return;
            }
            if (data.code && data.amount && data.from) {
              clearInterval(scannerInterval); scannerInterval = null;
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
  detectedQR = null;
  showScreen('screen-send');
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
  catch(e) { msg.className = 'msg'; msg.textContent = ''; return; }

  showMsg(msg,'success','Verifying...');

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

    const newBal = parseFloat(localStorage.getItem('pm_balance')||'0') + amount;
    localStorage.setItem('pm_balance', newBal.toFixed(2));
    stopScan();
    launchConfetti(80);
    if (navigator.vibrate) navigator.vibrate([200,100,200,100,400]);
    showOverlay('', 'Received!', `₹${amount.toFixed(2)} from ${fromName} added to wallet`);

  } catch(e) {
    if (e.message === 'Failed to get document because the client is offline.') {
      const pending = JSON.parse(localStorage.getItem('pending_vouchers') || '[]');
      pending.push({ ...voucher, amount, redeemedBy:CURRENT_USER.phone, time:new Date().toISOString() });
      localStorage.setItem('pending_vouchers', JSON.stringify(pending));
      const lb = parseFloat(localStorage.getItem('pm_balance') || '0');
      localStorage.setItem('pm_balance', (lb + amount).toFixed(2));
      stopScan();
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
  const run = async () => {
    const loggedIn    = localStorage.getItem('pm_logged_in');
    const sessionPhone = sessionStorage.getItem('pm_session_phone');
    const phone       = localStorage.getItem('pm_phone') || sessionPhone;
    const name        = localStorage.getItem('pm_name');
    const upi         = localStorage.getItem('pm_upi');
    const localToken  = getLocalToken();

    // Gate: must have pm_logged_in='1' and a stored phone number
    const hasSession = (loggedIn === '1' && phone) || (sessionPhone && phone);
    if (!hasSession) {
      if (phone) {
        const phoneEl = document.getElementById('login-phone');
        if (phoneEl) { phoneEl.value = phone; detectExistingUser(phone); }
      }
      showScreen('screen-login');
      return;
    }

    CURRENT_USER.phone = phone;
    CURRENT_USER.name  = name  || '';
    CURRENT_USER.upi   = upi   || '';

    try {
      const snap = await getDocFromServer(doc(db, "users", phone));
      if (!snap.exists()) { forceRelogin(); return; }
      const data = snap.data();

      // Single-device check: only kick out if BOTH tokens exist AND they differ.
      // If localToken is missing (e.g. fresh PWA install), skip the check and
      // just write the Firestore token locally so next launch passes fine.
      if (localToken && data.deviceToken && data.deviceToken !== localToken) {
        forceRelogin('Your account was signed in on another device.');
        return;
      }
      // If we have no local token, adopt the Firestore one (covers PWA reinstall)
      if (!localToken && data.deviceToken) {
        setLocalToken(data.deviceToken);
      }

      // Sync all server data into memory
      CURRENT_USER.name = data.name || name  || '';
      CURRENT_USER.upi  = data.upi  || upi   || '';
      localStorage.setItem('pm_name',    CURRENT_USER.name);
      localStorage.setItem('pm_upi',     CURRENT_USER.upi);
      localStorage.setItem('pm_balance', (data.balance||0).toFixed(2));
      syncPinCache(data);

      refreshPinSettingsUI();
      showScreen('screen-home');

      const nameEl = document.getElementById('display-name');
      if (nameEl) nameEl.textContent = `Hi, ${CURRENT_USER.name} 👋`;

      replayPendingVouchers().catch(e => console.warn('Offline replay error:', e));

    } catch(e) {
      // Offline — proceed with cached data, onSnapshot will verify on reconnect
      console.warn('Init server check failed (offline?):', e.message);
      refreshPinSettingsUI();
      showScreen('screen-home');
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
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
});