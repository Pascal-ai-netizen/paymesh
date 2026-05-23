import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  doc, getDoc, setDoc, updateDoc,
  collection, addDoc, query, where,
  runTransaction,
  onSnapshot,           // FIX: real-time listeners replace one-shot reads
  getDocFromServer, getDocsFromServer
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

let scannerStream   = null;
let scannerInterval = null;
let detectedQR      = null;

// FIX: track active real-time listeners so we can unsubscribe when user logs out
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
      el.style.cssText = `
        left:${Math.random()*100}vw;top:-10px;
        background:${colors[Math.floor(Math.random()*colors.length)]};
        width:${4+Math.random()*8}px;height:${4+Math.random()*8}px;
        border-radius:${Math.random()>0.5?'50%':'2px'};
        animation-duration:${1.5+Math.random()*2}s;
        animation-delay:${Math.random()*0.5}s;`;
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
  // FIX: Receive screen renamed to "My QR" — just shows static QR, no scanner needed
  if (id === 'screen-receive') generateReceiveQR();
  if (id === 'screen-load') {
    document.getElementById('display-upi').textContent = PAYMESH_UPI;
    buildUPILink();
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

  const btn = document.createElement('a');
  btn.id = 'upi-pay-btn';
  btn.style.cssText = `
    display:flex;align-items:center;justify-content:center;gap:10px;
    width:100%;padding:14px;margin:12px 0;
    background:linear-gradient(135deg,rgba(0,232,122,.12),rgba(0,232,122,.06));
    border:1px solid rgba(0,232,122,.25);border-radius:14px;
    color:var(--em);font:700 14px/1 var(--sans);
    text-decoration:none;cursor:pointer;transition:all .2s;
  `;
  btn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
    </svg>
    Open GPay / PhonePe to Pay
  `;

  function updateLink() {
    const amt = parseFloat(amtInput.value) || '';
    btn.href = `upi://pay?pa=${PAYMESH_UPI}&pn=PayMesh&am=${amt}&cu=INR&tn=PayMeshLoad`;
  }
  amtInput.addEventListener('input', updateLink);
  updateLink();

  const upiBox = document.getElementById('display-upi');
  upiBox.parentNode.insertBefore(btn, upiBox.nextSibling);
}

// ═══════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════

window.loginUser = async function() {
  const nameInput = document.getElementById('login-name').value.trim();
  const phone     = document.getElementById('login-phone').value.trim();
  const upiInput  = document.getElementById('login-upi').value.trim();
  const msg       = document.getElementById('login-msg');

  if (!nameInput)                         { showMsg(msg,'error','Enter your name'); return; }
  if (phone.length !== 10 || isNaN(phone)){ showMsg(msg,'error','Enter a valid 10-digit phone number'); return; }
  if (!upiInput)                          { showMsg(msg,'error','Enter your UPI ID'); return; }
  if (!UPI_REGEX.test(upiInput))          { showMsg(msg,'error','Invalid UPI ID. Use format like name@ybl'); return; }

  showMsg(msg,'success','Verifying account...');

  try {
    const userRef  = doc(db, "users", phone);
    const userSnap = await getDocFromServer(userRef);
    let finalName, finalUpi;

    if (userSnap.exists()) {
      finalName = userSnap.data().name;
      finalUpi  = userSnap.data().upi;
      showMsg(msg, 'success', `Welcome back, ${finalName}!`);
    } else {
      finalName = nameInput;
      finalUpi  = upiInput;
      await setDoc(userRef, {
        name: finalName, phone,
        upi: finalUpi, balance: 0,
        createdAt: new Date().toLocaleString()
      });
      showMsg(msg, 'success', `Account created! Welcome, ${finalName}!`);
    }

    localStorage.setItem('pm_name',      finalName);
    localStorage.setItem('pm_phone',     phone);
    localStorage.setItem('pm_upi',       finalUpi);
    localStorage.setItem('pm_logged_in', '1');

    CURRENT_USER.name  = finalName;
    CURRENT_USER.phone = phone;
    CURRENT_USER.upi   = finalUpi;

    setTimeout(() => showScreen('screen-home'), 800);

  } catch(e) {
    showMsg(msg, 'error', 'Error. Check internet and try again.');
    console.error(e);
  }
}

window.logoutUser = function() {
  if (!confirm('Log out of PayMesh?')) return;
  // FIX: unsubscribe real-time listeners before logout to prevent memory leaks and ghost updates
  teardownListeners();
  ['pm_name','pm_phone','pm_upi','pm_logged_in','pm_balance'].forEach(k => localStorage.removeItem(k));
  CURRENT_USER.name = ''; CURRENT_USER.phone = ''; CURRENT_USER.upi = '';
  showScreen('screen-login');
}

// ═══════════════════════════════════════════
// FIX: tear down listeners on logout
// ═══════════════════════════════════════════

function teardownListeners() {
  if (unsubBalance) { unsubBalance(); unsubBalance = null; }
  if (unsubTxns)    { unsubTxns();    unsubTxns    = null; }
}

// ═══════════════════════════════════════════
// HOME — FIX: onSnapshot replaces one-shot reads
// Balance and transactions now update in real-time
// ═══════════════════════════════════════════

async function loadHomeData() {
  // FIX: always show whatever name we have immediately, then confirm from server
  document.getElementById('display-name').textContent = `Hi, ${CURRENT_USER.name || '...'} 👋`;

  // Show cached balance immediately while listener connects
  const cached = parseFloat(localStorage.getItem('pm_balance') || '0');
  document.getElementById('wallet-balance').textContent = cached.toFixed(2);

  // FIX: tear down any existing listeners first (prevents duplicate listeners on repeated home visits)
  teardownListeners();

  // FIX: onSnapshot on user doc — handles balance AND self-heals name/upi from server
  // This means even if localStorage was stale/missing, the first snapshot corrects everything
  unsubBalance = onSnapshot(
    doc(db, "users", CURRENT_USER.phone),
    (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const bal  = data.balance || 0;

        // Self-heal: sync name and upi from server into memory and localStorage
        if (data.name && data.name !== CURRENT_USER.name) {
          CURRENT_USER.name = data.name;
          localStorage.setItem('pm_name', data.name);
        }
        if (data.upi && data.upi !== CURRENT_USER.upi) {
          CURRENT_USER.upi = data.upi;
          localStorage.setItem('pm_upi', data.upi);
        }

        // Always update the greeting from authoritative server data
        document.getElementById('display-name').textContent = `Hi, ${CURRENT_USER.name} 👋`;

        animateBalance(bal);
        localStorage.setItem('pm_balance', bal.toFixed(2));
      } else {
        // User doc deleted from Firestore (e.g. data cleared) — force clean re-login
        forceRelogin();
      }
    },
    (err) => console.warn('Balance listener error:', err.message)
  );

  // FIX: onSnapshot on transactions — list refreshes automatically when any tx is added/updated
  const txQuery = query(
    collection(db, "transactions"),
    where("phone", "==", CURRENT_USER.phone)
  );
  unsubTxns = onSnapshot(
    txQuery,
    (snap) => {
      renderTransactions(snap);
    },
    (err) => console.warn('Tx listener error:', err.message)
  );
}

// FIX: called when Firestore confirms user doc no longer exists
// Clears stale localStorage and sends user to login cleanly
function forceRelogin() {
  teardownListeners();
  ['pm_name','pm_phone','pm_upi','pm_logged_in','pm_balance'].forEach(k => localStorage.removeItem(k));
  CURRENT_USER.name = ''; CURRENT_USER.phone = ''; CURRENT_USER.upi = '';
  showScreen('screen-login');
}

function renderTransactions(snap) {
  const list = document.getElementById('tx-list');

  if (snap.empty) {
    list.innerHTML = '<div class="tx-empty">No transactions yet</div>';
    return;
  }

  const txs = [];
  snap.forEach(d => txs.push(d.data()));
  txs.sort((a,b) => new Date(b.time) - new Date(a.time));

  list.innerHTML = txs.slice(0,20).map((tx, i) => {
    const isDebit   = tx.type === 'debit';
    const isPending = tx.type === 'pending';
    const amtClass  = isPending ? 'tx-pending' : isDebit ? 'tx-debit' : 'tx-credit';
    const prefix    = isPending ? '⏳ ' : isDebit ? '−' : '+';
    return `<div class="tx-row" style="animation-delay:${i*0.05}s">
      <div class="tx-avatar">${(tx.label||'?')[0].toUpperCase()}</div>
      <div class="tx-middle">
        <div class="tx-name">${tx.label}</div>
        <div class="tx-time">${tx.time}</div>
      </div>
      <div class="tx-amount ${amtClass}">${prefix}₹${tx.amount}</div>
    </div>`;
  }).join('');
}

function animateBalance(target) {
  const el  = document.getElementById('wallet-balance');
  const cur = parseFloat(el.textContent.replace(/,/g,'')) || 0;
  if (cur === target) { el.textContent = target.toFixed(2); return; }
  const dur = 700;
  const st  = Date.now();
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

  if (!amount || amount <= 0)          { showMsg(msg,'error','Enter a valid amount'); return; }
  if (amount > 50000)                  { showMsg(msg,'error','Maximum load is ₹50,000'); return; }
  if (utr.length !== 12 || isNaN(utr)) { showMsg(msg,'error','UTR must be exactly 12 digits'); return; }

  showMsg(msg,'success','Submitting request...');

  try {
    const utrSnap = await getDocFromServer(doc(db,"utrs",utr));
    if (utrSnap.exists()) {
      showMsg(msg,'error','This UTR has already been submitted');
      return;
    }

    await setDoc(doc(db,"utrs",utr), {
      utr, amount,
      phone:    CURRENT_USER.phone,
      name:     CURRENT_USER.name,
      upi:      CURRENT_USER.upi,
      paidTo:   PAYMESH_UPI,
      time:     new Date().toLocaleString(),
      status:   "pending",
      reviewed: false
    });

    await addDoc(collection(db,"transactions"), {
      phone:  CURRENT_USER.phone,
      label:  "Load Request — Under Review",
      amount, type: "pending",
      time:   new Date().toLocaleString(),
      utr, status: "pending"
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

  if (phone.length !== 10 || isNaN(phone)) { showMsg(msg,'error','Valid 10-digit phone needed'); return; }
  if (!amount || amount <= 0)              { showMsg(msg,'error','Enter a valid amount'); return; }
  if (phone === CURRENT_USER.phone)        { showMsg(msg,'error','Cannot send to yourself'); return; }

  showMsg(msg,'success','Processing...');

  try {
    const senderRef   = doc(db,"users",CURRENT_USER.phone);
    const receiverRef = doc(db,"users",phone);

    let receiverName = '';
    await runTransaction(db, async (tx) => {
      const senderSnap   = await tx.get(senderRef);
      const receiverSnap = await tx.get(receiverRef);

      if (!senderSnap.exists())   throw new Error('Your account not found');
      if (!receiverSnap.exists()) throw new Error('Recipient not found on PayMesh');

      const senderBal   = senderSnap.data().balance   || 0;
      const receiverBal = receiverSnap.data().balance  || 0;

      if (senderBal < amount) throw new Error(`Insufficient balance. Available ₹${senderBal.toFixed(2)}`);

      receiverName = receiverSnap.data().name;
      tx.update(senderRef,   { balance: senderBal   - amount });
      tx.update(receiverRef, { balance: receiverBal + amount });
    });

    const time = new Date().toLocaleString();
    await Promise.all([
      addDoc(collection(db,"transactions"), {
        phone: CURRENT_USER.phone,
        label: `Sent to ${receiverName}`,
        amount, type:"debit", time
      }),
      addDoc(collection(db,"transactions"), {
        phone,
        label: `From ${CURRENT_USER.name}`,
        amount, type:"credit", time
      })
    ]);

    // FIX: localStorage balance is now secondary — onSnapshot will update it authoritatively
    // But update it immediately for instant local feedback
    const newBal = parseFloat(localStorage.getItem('pm_balance')||'0') - amount;
    localStorage.setItem('pm_balance', Math.max(0, newBal).toFixed(2));

    document.getElementById('send-phone').value  = '';
    document.getElementById('send-amount').value = '';

    if (navigator.vibrate) navigator.vibrate(200);
    showOverlay('', 'Sent!', `₹${amount} sent to ${receiverName}`);
    // FIX: no need for manual refreshBalance — onSnapshot handles it automatically

  } catch(e) {
    showMsg(msg,'error', e.message || 'Error. Try again.');
    console.error(e);
  }
}

// ═══════════════════════════════════════════
// GENERATE VOUCHER
// ═══════════════════════════════════════════

window.generateVoucher = async function() {
  const amount = parseFloat(document.getElementById('voucher-amount').value);
  const msg    = document.getElementById('voucher-msg');

  if (!amount || amount <= 0) { showMsg(msg,'error','Enter a valid amount'); return; }

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
        code, amount,
        createdBy:     CURRENT_USER.phone,
        createdByName: CURRENT_USER.name,
        status:        "UNUSED",
        createdAt:     new Date().toLocaleString()
      }),
      addDoc(collection(db,"transactions"), {
        phone: CURRENT_USER.phone,
        label: `Voucher Created · ₹${amount}`,
        amount, type: "debit",
        time: new Date().toLocaleString()
      })
    ]);

    // FIX: localStorage balance updated locally; onSnapshot will confirm authoritatively
    const newBal = parseFloat(localStorage.getItem('pm_balance')||'0') - amount;
    localStorage.setItem('pm_balance', Math.max(0, newBal).toFixed(2));

    const saved = JSON.parse(localStorage.getItem('my_vouchers') || '[]');
    saved.unshift({ code, amount, createdAt: new Date().toLocaleString(), status: 'UNUSED' });
    localStorage.setItem('my_vouchers', JSON.stringify(saved.slice(0, 20)));

    prependVoucher(code, amount);
    showMsg(msg,'success',`Voucher for ₹${amount} is ready!`);
    if (navigator.vibrate) navigator.vibrate([100,50,200]);

  } catch(e) {
    showMsg(msg,'error', e.message || 'Error. Check internet.');
    console.error(e);
  }
}

function prependVoucher(code, amount) {
  const display = document.getElementById('voucher-display');

  const wrapper = document.createElement('div');
  wrapper.className = 'voucher-entry';
  wrapper.style.cssText = 'animation:slideUp .35s var(--ease) both;';

  const qrId = 'vqr-' + code;
  wrapper.innerHTML = `
    <div class="voucher-card">
      <div class="voucher-label">Offline Voucher · PayMesh</div>
      <div class="voucher-code">${code}</div>
      <div class="voucher-sub">₹${amount} · by ${CURRENT_USER.name}</div>
    </div>
    <div class="card center-card">
      <p class="info-text">Show this QR to pay offline</p>
      <div id="${qrId}" class="qr-wrap"></div>
      <p class="hint">Recipient scans with PayMesh → Scan QR</p>
    </div>`;

  display.insertBefore(wrapper, display.firstChild);

  // FIX: guard QRCode call — if library not loaded yet, wait for it
  function makeQR() {
    if (typeof QRCode === 'undefined') {
      setTimeout(makeQR, 200);
      return;
    }
    try {
      new QRCode(document.getElementById(qrId), {
        text: JSON.stringify({ code, amount, from: CURRENT_USER.name }),
        width: 200, height: 200,
        colorDark: "#000000", colorLight: "#ffffff"
      });
    } catch(e) {
      console.warn('QR generation failed:', e);
    }
  }
  makeQR();
}

// FIX: restoreVoucher wrapped so any crash is fully contained and never blocks navigation
async function restoreVoucher() {
  try {
    const saved = JSON.parse(localStorage.getItem('my_vouchers') || '[]');
    if (!saved.length) return;
    const display = document.getElementById('voucher-display');
    display.innerHTML = '';

    for (const v of saved.slice(0, 5)) {
      if (v.status === 'USED') continue;
      try {
        const vSnap = await getDocFromServer(doc(db, "vouchers", v.code));
        if (vSnap.exists() && vSnap.data().status === 'UNUSED') {
          prependVoucher(v.code, v.amount);
        } else if (vSnap.exists()) {
          v.status = 'USED';
        }
      } catch(e) {
        // offline — show from local cache anyway
        prependVoucher(v.code, v.amount);
      }
    }
    localStorage.setItem('my_vouchers', JSON.stringify(saved));
  } catch(e) {
    // silent — NEVER block navigation
  }
}

// FIX: expose restoreVoucher to HTML onclick
window.restoreVoucher = restoreVoucher;

// ═══════════════════════════════════════════
// RECEIVE / MY QR SCREEN
// FIX: renamed conceptually to "My QR" — shows personal QR for others to scan
// No scanner is needed here. The scanner is on the Scan screen.
// ═══════════════════════════════════════════

function generateReceiveQR() {
  const c = document.getElementById('receive-qr');
  c.innerHTML = '';
  document.getElementById('receive-upi-display').textContent = CURRENT_USER.upi;

  function makeQR() {
    if (typeof QRCode === 'undefined') { setTimeout(makeQR, 200); return; }
    try {
      new QRCode(c, {
        text: JSON.stringify({ type:'person', phone: CURRENT_USER.phone, name: CURRENT_USER.name, upi: CURRENT_USER.upi }),
        width: 200, height: 200,
        colorDark: "#000000", colorLight: "#ffffff"
      });
    } catch(e) { console.warn('Receive QR failed:', e); }
  }
  makeQR();
}

// ═══════════════════════════════════════════
// QR SCANNER — handles voucher QR and person QR
// ═══════════════════════════════════════════

window.startScan = async function() {
  showScreen('screen-scan');
  document.getElementById('scan-result').classList.add('hidden');
  document.getElementById('scan-send-result').classList.add('hidden');
  const scanMsg = document.getElementById('scan-msg');
  scanMsg.className = 'msg';
  detectedQR = null;

  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video   = document.getElementById('scanner-video');
    video.srcObject = scannerStream;
    await video.play();

    await loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');

    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d');

    scannerInterval = setInterval(() => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width  = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img  = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height);
        if (code) {
          try {
            const data = JSON.parse(code.data);

            if (data.type === 'person' && data.phone && data.name) {
              clearInterval(scannerInterval); scannerInterval = null;
              detectedQR = { kind: 'person', ...data };
              showPersonResult(data);
              return;
            }

            if (data.code && data.amount && data.from) {
              clearInterval(scannerInterval); scannerInterval = null;
              detectedQR = { kind: 'voucher', ...data };
              showVoucherResult(data);
            }
          } catch(e) { /* not a PayMesh QR */ }
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
  document.getElementById('scan-person-name').textContent   = data.name;
  document.getElementById('scan-person-phone').textContent  = data.phone;
  document.getElementById('scan-person-upi').textContent    = data.upi || '';
  document.getElementById('send-phone').value  = data.phone;
  document.getElementById('send-amount').value = '';
  if (navigator.vibrate) navigator.vibrate([100,50,100]);
}

function showVoucherResult(data) {
  document.getElementById('scan-result').classList.remove('hidden');
  document.getElementById('scan-voucher-code').textContent   = data.code;
  document.getElementById('scan-voucher-amount').textContent = `₹${data.amount}`;
  document.getElementById('scan-voucher-from').textContent   = `From ${data.from}`;
  document.getElementById('scan-amount-btn').textContent     = data.amount;
  if (navigator.vibrate) navigator.vibrate([100,50,100]);
}

window.proceedToSend = function() {
  stopScan();
  showScreen('screen-send');
}

// ═══════════════════════════════════════════
// REDEEM VOUCHER
// ═══════════════════════════════════════════

window.redeemVoucher = async function() {
  const msg = document.getElementById('scan-msg');
  if (!detectedQR || detectedQR.kind !== 'voucher') { showMsg(msg,'error','No voucher detected'); return; }

  const voucher = detectedQR;
  showMsg(msg,'success','Verifying...');

  try {
    const vRef        = doc(db,"vouchers",voucher.code);
    const receiverRef = doc(db,"users",CURRENT_USER.phone);
    const amount      = voucher.amount;
    const fromName    = voucher.from;
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

      tx.update(vRef, {
        status:         'USED',
        redeemedBy:     CURRENT_USER.phone,
        redeemedByName: CURRENT_USER.name,
        redeemedAt:     new Date().toLocaleString()
      });
      tx.update(receiverRef, { balance: rBal + amount });
    });

    const time = new Date().toLocaleString();
    await Promise.all([
      addDoc(collection(db,"transactions"), {
        phone: CURRENT_USER.phone,
        label: `Voucher from ${fromName}`,
        amount, type:"credit", time
      }),
      addDoc(collection(db,"transactions"), {
        phone: createdBy,
        label: `Voucher redeemed by ${CURRENT_USER.name}`,
        amount, type:"debit", time
      })
    ]);

    // FIX: onSnapshot handles authoritative balance update — just update local cache optimistically
    const newBal = parseFloat(localStorage.getItem('pm_balance')||'0') + amount;
    localStorage.setItem('pm_balance', newBal.toFixed(2));

    stopScan();
    launchConfetti(80);
    if (navigator.vibrate) navigator.vibrate([200,100,200,100,400]);
    showOverlay('', 'Received!', `₹${amount} from ${fromName} added to wallet`);

  } catch(e) {
    if (e.message === 'Failed to get document because the client is offline.') {
      const pending = JSON.parse(localStorage.getItem('pending_vouchers') || '[]');
      pending.push({ ...voucher, redeemedBy: CURRENT_USER.phone, time: new Date().toLocaleString() });
      localStorage.setItem('pending_vouchers', JSON.stringify(pending));
      const lb = parseFloat(localStorage.getItem('pm_balance') || '0');
      localStorage.setItem('pm_balance', (lb + voucher.amount).toFixed(2));
      stopScan();
      showOverlay('', 'Saved Offline!', `₹${voucher.amount} saved — syncs when internet returns`);
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
// INIT — Persistent Login with server self-heal
// ═══════════════════════════════════════════

(function init() {
  const run = async () => {
    const loggedIn = localStorage.getItem('pm_logged_in');
    const phone    = localStorage.getItem('pm_phone');
    const name     = localStorage.getItem('pm_name');
    const upi      = localStorage.getItem('pm_upi');

    // No session at all — go to login
    if (loggedIn !== '1' || !phone) {
      showScreen('screen-login');
      return;
    }

    // Phone exists — set what we have immediately so UI isn't blank
    CURRENT_USER.phone = phone;
    CURRENT_USER.name  = name  || '';
    CURRENT_USER.upi   = upi   || '';

    // FIX: always verify against Firestore server on app start
    // This self-heals name/upi if localStorage was stale, partial, or cleared
    try {
      const snap = await getDocFromServer(doc(db, "users", phone));
      if (snap.exists()) {
        const data = snap.data();
        // Always trust server over localStorage
        CURRENT_USER.name = data.name  || name  || '';
        CURRENT_USER.upi  = data.upi   || upi   || '';
        // Re-sync localStorage from server
        localStorage.setItem('pm_name',  CURRENT_USER.name);
        localStorage.setItem('pm_upi',   CURRENT_USER.upi);
        localStorage.setItem('pm_balance', (data.balance || 0).toFixed(2));
      } else {
        // Account deleted from Firestore — clear and re-login
        ['pm_name','pm_phone','pm_upi','pm_logged_in','pm_balance'].forEach(k => localStorage.removeItem(k));
        showScreen('screen-login');
        return;
      }
    } catch(e) {
      // Offline — proceed with whatever localStorage has, onSnapshot will heal on reconnect
      console.warn('Init server check failed (offline?):', e.message);
    }

    showScreen('screen-home');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();

// ═══════════════════════════════════════════
// RIPPLE INIT
// ═══════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.btn-primary,.action-btn,.back-btn').forEach(btn => {
    btn.addEventListener('click', addRipple);
  });
});
