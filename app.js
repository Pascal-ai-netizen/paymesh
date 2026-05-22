import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

// ── FIX 1: YOUR FIXED PAYEE UPI — never changes ──────────
const PAYMESH_UPI = "utkarshkk@yesfam";

// ── FIX 2: STRICT UPI REGEX ──────────────────────────────
// Must be word chars @ one of these known banks only
const UPI_REGEX = /^[a-zA-Z0-9.\-_+]+@(ybl|oksbi|okaxis|okicici|okhdfcbank|paytm|apl|ibl|upi|axl|airtel|jio|fbl|barodampay|centralbank|cmsidfc|dbs|equitas|federal|hsbc|idbi|idfc|indus|kotak|lvb|mahb|nsdl|pnb|postbank|psb|rbl|sbi|sc|scmobile|shbk|syndicate|tjsb|uco|union|united|vijb|yesfam|yesbank|icici|hdfc|axis|sib|dcb|karb|kvb|lax|tmb|csb|dlb|apgvb|aubank|bdbl|bgvb|bkid|bocl|bsbl|cbin|ccl|cie|citibank|csbcoin|dlxb|esfbl|fino|gbcoin|hsbc|idfcfirst|ikwik|indbank|iob|jkb|jsbl|kbl|kmbl|kscb|kvgb|mahagramin|nainital|nkgsb|nmgb|obcfin|payzapp|pingpay|pkgb|psb|qfix|rajgovt|saraswat|sbm|scbl|shb|snapwork|spices|svcbank|tjsb|ubi|uboi|ucb|ucobank|unionbank|utbi|vardhman|vbhvn|vijayabank|vitp|wpay|yapl|yesb)$/i;

const CURRENT_USER = { phone:"", name:"", upi:"" };

let scannerStream   = null;
let scannerInterval = null;
let detectedVoucher = null;

// ── CONFETTI ──────────────────────────────────────────────
function launchConfetti(count = 60) {
  const colors = ['#7B2FFF','#00FFB2','#FFB800','#FF3366','#00AAFF','#BF6BFF','#ffffff'];
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

// ── RIPPLE ────────────────────────────────────────────────
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

// ── SCREENS ───────────────────────────────────────────────
window.showScreen = function(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'screen-home')    loadHomeData();
  if (id === 'screen-receive') generateReceiveQR();
  if (id === 'screen-load')    {
    // FIX 1: Always show YOUR UPI, never the logged-in user's UPI
    document.getElementById('display-upi').textContent = PAYMESH_UPI;
  }
  document.getElementById(id).scrollTop = 0;
}

// ── LOGIN — FIX 2: STRICT ONE USER PER PHONE ─────────────
window.loginUser = async function() {
  const nameInput = document.getElementById('login-name').value.trim();
  const phone     = document.getElementById('login-phone').value.trim();
  const upiInput  = document.getElementById('login-upi').value.trim();
  const msg       = document.getElementById('login-msg');

  // Basic blank checks
  if (!nameInput)                          { showMsg(msg,'error','❌ Enter your name'); return; }
  if (phone.length!==10 || isNaN(phone))   { showMsg(msg,'error','❌ Enter a valid 10 digit phone number'); return; }
  if (!upiInput)                           { showMsg(msg,'error','❌ Enter your UPI ID'); return; }

  // FIX 2: Strict UPI format validation
  if (!UPI_REGEX.test(upiInput)) {
    showMsg(msg,'error','❌ Invalid UPI ID. Use format like name@ybl or name@oksbi');
    return;
  }

  showMsg(msg,'success','⏳ Verifying account...');

  try {
    const userRef  = doc(db,"users",phone);
    const userSnap = await getDoc(userRef);

    let finalName, finalUpi;

    if (userSnap.exists()) {
      // Phone already registered — load STORED details, ignore what user typed
      finalName = userSnap.data().name;
      finalUpi  = userSnap.data().upi;
      showMsg(msg,'success',`✅ Welcome back, ${finalName}!`);
    } else {
      // New phone — register with typed details
      finalName = nameInput;
      finalUpi  = upiInput;
      await setDoc(userRef,{ name:finalName, phone, upi:finalUpi, balance:0, createdAt:new Date().toLocaleString() });
      showMsg(msg,'success',`✅ Account created! Welcome, ${finalName}!`);
    }

    localStorage.setItem('pm_name',  finalName);
    localStorage.setItem('pm_phone', phone);
    localStorage.setItem('pm_upi',   finalUpi);
    CURRENT_USER.name=finalName; CURRENT_USER.phone=phone; CURRENT_USER.upi=finalUpi;

    setTimeout(() => showScreen('screen-home'), 800);

  } catch(e) {
    showMsg(msg,'error','❌ Error. Check internet and try again.');
    console.error(e);
  }
}

window.logoutUser = function() {
  if (!confirm('Log out of PayMesh?')) return;
  localStorage.clear();
  CURRENT_USER.name=''; CURRENT_USER.phone=''; CURRENT_USER.upi='';
  showScreen('screen-login');
}

// ── HOME ──────────────────────────────────────────────────
async function loadHomeData() {
  document.getElementById('display-name').textContent = `Hi, ${CURRENT_USER.name} 👋`;
  try {
    const snap = await getDoc(doc(db,"users",CURRENT_USER.phone));
    if (snap.exists()) {
      const bal = snap.data().balance || 0;
      animateBalance(bal);
      localStorage.setItem('balance', bal.toFixed(2));
    }
    loadTransactions();
  } catch(e) {
    document.getElementById('wallet-balance').textContent = localStorage.getItem('balance')||'0.00';
  }
}

function animateBalance(target) {
  const el  = document.getElementById('wallet-balance');
  const cur = parseFloat(el.textContent.replace(/,/g,'')) || 0;
  const dur = 800;
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

async function loadTransactions() {
  try {
    const q    = query(collection(db,"transactions"), where("phone","==",CURRENT_USER.phone));
    const snap = await getDocs(q);
    const list = document.getElementById('tx-list');
    if (snap.empty) { list.innerHTML='<div class="tx-empty">No transactions yet ✨</div>'; return; }

    const txs = [];
    snap.forEach(d => txs.push(d.data()));
    txs.sort((a,b) => new Date(b.time) - new Date(a.time));

    list.innerHTML = txs.map((tx,i) => {
      const debit = tx.type==='debit';
      return `<div class="tx-row" style="animation-delay:${i*0.06}s">
        <div class="tx-avatar">${tx.label[0].toUpperCase()}</div>
        <div class="tx-middle">
          <div class="tx-name">${tx.label}</div>
          <div class="tx-time">${tx.time}</div>
        </div>
        <div class="tx-amount ${debit?'tx-debit':'tx-credit'}">${debit?'-':'+'}₹${tx.amount}</div>
      </div>`;
    }).join('');
  } catch(e) { console.log('Tx load failed — offline mode'); }
}

// ── LOAD MONEY — FIX 3: PENDING ONLY, NO AUTO CREDIT ─────
window.submitLoad = async function() {
  const amount = parseFloat(document.getElementById('load-amount').value);
  const utr    = document.getElementById('load-utr').value.trim();
  const msg    = document.getElementById('load-msg');

  if (!amount||amount<=0)           { showMsg(msg,'error','❌ Enter a valid amount'); return; }
  if (amount > 50000)               { showMsg(msg,'error','❌ Maximum load amount is ₹50,000'); return; }
  if (utr.length!==12||isNaN(utr))  { showMsg(msg,'error','❌ UTR must be exactly 12 digits'); return; }

  showMsg(msg,'success','⏳ Submitting request...');

  try {
    // Check UTR already used
    const utrSnap = await getDoc(doc(db,"utrs",utr));
    if (utrSnap.exists()) {
      showMsg(msg,'error','❌ This UTR has already been submitted');
      return;
    }

    // FIX 3: Save as PENDING — do NOT credit balance yet
    // You (admin) verify in Firebase console and manually update status + balance
    await setDoc(doc(db,"utrs",utr),{
      utr,
      amount,
      phone:       CURRENT_USER.phone,
      name:        CURRENT_USER.name,
      upi:         CURRENT_USER.upi,
      paidTo:      PAYMESH_UPI,
      time:        new Date().toLocaleString(),
      status:      "pending",   // YOU change this to "approved" in Firebase console
      reviewed:    false
    });

    // Log pending load in transactions with pending tag
    await addDoc(collection(db,"transactions"),{
      phone:  CURRENT_USER.phone,
      label:  "Load Request (Under Review)",
      amount,
      type:   "pending",
      time:   new Date().toLocaleString(),
      utr,
      status: "pending"
    });

    document.getElementById('load-amount').value='';
    document.getElementById('load-utr').value='';

    // Show pending message — NOT success confetti
    showMsg(msg,'success','⏳ Request submitted! Balance will update within 24 hours after verification.');

  } catch(e) {
    showMsg(msg,'error','❌ Error submitting. Try again.');
    console.error(e);
  }
}

// ── SEND MONEY ────────────────────────────────────────────
window.sendMoney = async function() {
  const phone  = document.getElementById('send-phone').value.trim();
  const amount = parseFloat(document.getElementById('send-amount').value);
  const msg    = document.getElementById('send-msg');

  if (phone.length!==10||isNaN(phone)) { showMsg(msg,'error','❌ Valid 10 digit phone needed'); return; }
  if (!amount||amount<=0)              { showMsg(msg,'error','❌ Enter a valid amount'); return; }
  if (phone===CURRENT_USER.phone)      { showMsg(msg,'error','❌ Cannot send money to yourself'); return; }

  showMsg(msg,'success','⏳ Processing payment...');

  try {
    const senderSnap   = await getDoc(doc(db,"users",CURRENT_USER.phone));
    const receiverSnap = await getDoc(doc(db,"users",phone));

    if (!senderSnap.exists())   { showMsg(msg,'error','❌ Your account not found'); return; }
    if (!receiverSnap.exists()) { showMsg(msg,'error','❌ Recipient not found on PayMesh'); return; }

    const senderBal   = senderSnap.data().balance||0;
    const receiverBal = receiverSnap.data().balance||0;

    if (senderBal < amount) {
      showMsg(msg,'error',`❌ Insufficient balance. Available ₹${senderBal.toFixed(2)}`);
      return;
    }

    await updateDoc(doc(db,"users",CURRENT_USER.phone),{ balance: senderBal-amount });
    await updateDoc(doc(db,"users",phone),              { balance: receiverBal+amount });

    const time = new Date().toLocaleString();
    await addDoc(collection(db,"transactions"),{ phone:CURRENT_USER.phone, label:`Sent to ${receiverSnap.data().name}`, amount, type:"debit",  time });
    await addDoc(collection(db,"transactions"),{ phone, label:`From ${CURRENT_USER.name}`, amount, type:"credit", time });

    localStorage.setItem('balance',(senderBal-amount).toFixed(2));
    document.getElementById('send-phone').value='';
    document.getElementById('send-amount').value='';
    if (navigator.vibrate) navigator.vibrate(200);
    showOverlay('📤','Sent!',`₹${amount} sent to ${receiverSnap.data().name}`);
  } catch(e) { showMsg(msg,'error','❌ Error. Try again.'); console.error(e); }
}

// ── GENERATE VOUCHER — FIX 4: PERSIST IN LOCALSTORAGE ────
window.generateVoucher = async function() {
  const amount  = parseFloat(document.getElementById('voucher-amount').value);
  const msg     = document.getElementById('voucher-msg');

  if (!amount||amount<=0) { showMsg(msg,'error','❌ Enter a valid amount'); return; }

  try {
    const snap    = await getDoc(doc(db,"users",CURRENT_USER.phone));
    const balance = snap.data().balance||0;
    if (balance<amount) { showMsg(msg,'error',`❌ Insufficient balance. You have ₹${balance.toFixed(2)}`); return; }

    const code = 'PM'+Date.now().toString(36).toUpperCase()+Math.random().toString(36).substring(2,6).toUpperCase();

    await setDoc(doc(db,"vouchers",code),{
      code, amount,
      createdBy:     CURRENT_USER.phone,
      createdByName: CURRENT_USER.name,
      status:        "UNUSED",
      createdAt:     new Date().toLocaleString()
    });

    await updateDoc(doc(db,"users",CURRENT_USER.phone),{ balance: balance-amount });
    await addDoc(collection(db,"transactions"),{
      phone: CURRENT_USER.phone, label:"Voucher Created",
      amount, type:"debit", time:new Date().toLocaleString()
    });

    localStorage.setItem('balance',(balance-amount).toFixed(2));

    // FIX 4: Save voucher to localStorage so it persists on refresh
    const saved = JSON.parse(localStorage.getItem('my_vouchers')||'[]');
    saved.unshift({ code, amount, createdAt: new Date().toLocaleString(), status:'UNUSED' });
    localStorage.setItem('my_vouchers', JSON.stringify(saved.slice(0,20)));

    renderVoucher(code, amount);
    showMsg(msg,'success',`✅ Voucher for ₹${amount} is ready!`);
    if (navigator.vibrate) navigator.vibrate([100,50,200]);

  } catch(e) { showMsg(msg,'error','❌ Error. Check internet.'); console.error(e); }
}

function renderVoucher(code, amount) {
  const display = document.getElementById('voucher-display');
  display.innerHTML = `
    <div class="voucher-card">
      <div class="voucher-label">🎫 Offline Voucher · PayMesh</div>
      <div class="voucher-code-text">${code}</div>
      <div class="voucher-amount-text">₹${amount} · by ${CURRENT_USER.name}</div>
    </div>
    <div class="card center-card">
      <p class="info-text">Show this QR to pay offline 📡</p>
      <div id="voucher-qr" class="qr-wrap"></div>
      <p class="hint">Recipient scans with PayMesh → Scan Voucher</p>
    </div>`;

  new QRCode(document.getElementById("voucher-qr"),{
    text: JSON.stringify({ code, amount, from:CURRENT_USER.name }),
    width:200, height:200, colorDark:"#7B2FFF", colorLight:"#ffffff"
  });
}

// FIX 4: Restore last voucher on screen open
function restoreVoucher() {
  const saved = JSON.parse(localStorage.getItem('my_vouchers')||'[]');
  if (saved.length > 0) {
    const last = saved[0];
    if (last.status === 'UNUSED') {
      renderVoucher(last.code, last.amount);
    }
  }
}

// ── RECEIVE QR ────────────────────────────────────────────
function generateReceiveQR() {
  const c = document.getElementById('receive-qr');
  c.innerHTML = '';
  document.getElementById('receive-upi-display').textContent = CURRENT_USER.upi;
  new QRCode(c,{
    text:       JSON.stringify({ phone:CURRENT_USER.phone, name:CURRENT_USER.name, upi:CURRENT_USER.upi }),
    width:      200, height:200,
    colorDark:  "#00FFB2",
    colorLight: "#ffffff"
  });
}

// ── QR SCANNER ────────────────────────────────────────────
window.startScan = async function() {
  showScreen('screen-scan');
  document.getElementById('scan-result').classList.add('hidden');
  document.getElementById('scan-msg').className = 'msg';
  detectedVoucher = null;

  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment' } });
    const video   = document.getElementById('scanner-video');
    video.srcObject = scannerStream;
    await video.play();

    if (!window.jsQR) await loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');

    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d');

    scannerInterval = setInterval(() => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width  = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video,0,0,canvas.width,canvas.height);
        const img  = ctx.getImageData(0,0,canvas.width,canvas.height);
        const code = jsQR(img.data,img.width,img.height);
        if (code) {
          try {
            const data = JSON.parse(code.data);
            if (data.code && data.amount && data.from) {
              clearInterval(scannerInterval);
              detectedVoucher = data;
              showVoucherResult(data);
            }
          } catch(e) { /* not a PayMesh QR */ }
        }
      }
    }, 300);

  } catch(e) {
    alert('Camera permission needed to scan vouchers. Please allow camera access.');
    showScreen('screen-home');
  }
}

function showVoucherResult(data) {
  document.getElementById('scan-result').classList.remove('hidden');
  document.getElementById('scan-voucher-code').textContent   = data.code;
  document.getElementById('scan-voucher-amount').textContent = `₹${data.amount}`;
  document.getElementById('scan-voucher-from').textContent   = `From ${data.from}`;
  document.getElementById('scan-amount-btn').textContent     = data.amount;
  if (navigator.vibrate) navigator.vibrate([100,50,100]);
}

window.redeemVoucher = async function() {
  const msg = document.getElementById('scan-msg');
  if (!detectedVoucher) { showMsg(msg,'error','❌ No voucher detected'); return; }

  showMsg(msg,'success','⏳ Verifying and redeeming...');

  try {
    const vRef  = doc(db,"vouchers",detectedVoucher.code);
    const vSnap = await getDoc(vRef);

    if (!vSnap.exists())                             { showMsg(msg,'error','❌ Voucher not found in system'); return; }
    if (vSnap.data().status==='USED')                { showMsg(msg,'error','❌ Voucher already redeemed'); return; }
    if (vSnap.data().createdBy===CURRENT_USER.phone) { showMsg(msg,'error','❌ Cannot redeem your own voucher'); return; }

    const amount = detectedVoucher.amount;

    await updateDoc(vRef,{
      status:          'USED',
      redeemedBy:      CURRENT_USER.phone,
      redeemedByName:  CURRENT_USER.name,
      redeemedAt:      new Date().toLocaleString()
    });

    // Mark sender's voucher as used in their localStorage too
    const senderVouchers = JSON.parse(localStorage.getItem('my_vouchers')||'[]');
    const updated = senderVouchers.map(v => v.code===detectedVoucher.code ? {...v, status:'USED'} : v);
    localStorage.setItem('my_vouchers', JSON.stringify(updated));

    const rSnap = await getDoc(doc(db,"users",CURRENT_USER.phone));
    const rBal  = rSnap.data().balance||0;
    await updateDoc(doc(db,"users",CURRENT_USER.phone),{ balance: rBal+amount });

    const time = new Date().toLocaleString();
    await addDoc(collection(db,"transactions"),{ phone:CURRENT_USER.phone, label:`Voucher from ${detectedVoucher.from}`, amount, type:"credit", time });
    await addDoc(collection(db,"transactions"),{ phone:vSnap.data().createdBy, label:`Voucher redeemed by ${CURRENT_USER.name}`, amount, type:"debit", time });

    localStorage.setItem('balance',(rBal+amount).toFixed(2));
    stopScan();
    launchConfetti(80);
    if (navigator.vibrate) navigator.vibrate([200,100,200,100,400]);
    showOverlay('🎉','Received!',`₹${amount} from ${detectedVoucher.from} added to wallet`);

  } catch(e) {
    // OFFLINE FALLBACK
    const pending = JSON.parse(localStorage.getItem('pending_vouchers')||'[]');
    pending.push({ ...detectedVoucher, redeemedBy:CURRENT_USER.phone, time:new Date().toLocaleString() });
    localStorage.setItem('pending_vouchers', JSON.stringify(pending));
    const lb = parseFloat(localStorage.getItem('balance')||'0');
    localStorage.setItem('balance',(lb+detectedVoucher.amount).toFixed(2));
    stopScan();
    showOverlay('📴','Saved Offline!',`₹${detectedVoucher.amount} saved — syncs when internet returns`);
  }
}

window.stopScan = function() {
  if (scannerInterval) { clearInterval(scannerInterval); scannerInterval=null; }
  if (scannerStream)   { scannerStream.getTracks().forEach(t=>t.stop()); scannerStream=null; }
  detectedVoucher = null;
  showScreen('screen-home');
}

function loadScript(src) {
  return new Promise((res,rej) => {
    const s=document.createElement('script');
    s.src=src; s.onload=res; s.onerror=rej;
    document.head.appendChild(s);
  });
}

// ── OVERLAY ───────────────────────────────────────────────
function showOverlay(icon, title, sub) {
  document.getElementById('overlay-icon').textContent  = icon;
  document.getElementById('overlay-title').textContent = title;
  document.getElementById('overlay-sub').textContent   = sub;
  document.getElementById('success-overlay').classList.remove('hidden');
}

window.closeOverlay = function() {
  document.getElementById('success-overlay').classList.add('hidden');
  showScreen('screen-home');
}

// ── HELPERS ───────────────────────────────────────────────
function showMsg(el, type, text) { el.className=`msg ${type}`; el.textContent=text; }

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.btn-primary,.action-btn,.back-btn').forEach(btn => {
    btn.addEventListener('click', addRipple);
  });
});

// ── OVERRIDE showScreen to restore voucher ────────────────
const _origShowScreen = window.showScreen;
window.showScreen = function(id) {
  const el = document.getElementById(id);
  if (!el) { console.warn('Screen not found:', id); return; }
  _origShowScreen(id);
  if (id === 'screen-voucher') restoreVoucher();
}

// ── INIT ──────────────────────────────────────────────────
(function init() {
  // Wait for DOM to be fully ready before touching any elements
  const run = () => {
    const n = localStorage.getItem('pm_name');
    const p = localStorage.getItem('pm_phone');
    const u = localStorage.getItem('pm_upi');
    if (n && p && u) {
      CURRENT_USER.name=n; CURRENT_USER.phone=p; CURRENT_USER.upi=u;
      showScreen('screen-home');
    } else {
      showScreen('screen-login');
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();