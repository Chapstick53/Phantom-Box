const BACKEND = 'http://127.0.0.1:4000';
// change when deployed


// Elements
const generateBtn   = document.getElementById('generateBtn');
const copyAllBtn    = document.getElementById('copyAllBtn');
const downloadImgBtn= document.getElementById('downloadImgBtn');
const profileIntro  = document.getElementById('profileIntro');
const profileTable  = document.getElementById('profileTableWrap');
const profilePic    = document.getElementById('profilePic');
const phoneTopSpan  = document.getElementById('phoneNumberTop');
const phoneBox      = document.getElementById('phoneBox');
const toast         = document.getElementById('toast');

const fields = ['fullname','username','email','password','phone','dob','address'];

// Mailbox elements
const mailList   = document.getElementById('mailList');
const mailDetail = document.getElementById('mailDetail');
const backToList = document.getElementById('backToList');
const deleteMail = document.getElementById('deleteMail');
const viewSource = document.getElementById('viewSource');

const mdAvatar = document.getElementById('mdAvatar');
const mdSender = document.getElementById('mdSender');
const mdEmail  = document.getElementById('mdEmail');
const mdDate   = document.getElementById('mdDate');
const mdSubject= document.getElementById('mdSubject');
const mdBody   = document.getElementById('mdBody');

// Data cache (for Copy All)
const state = {
  fullname: '-', username: '-', email: '-', password: '-',
  phone: '-', dob: '-', address: '-',
  avatar: ''
};

document.addEventListener("DOMContentLoaded", () => {
  const backToList = document.getElementById("backToList");
  if (backToList) {
    backToList.addEventListener("click", () => {
      mailDetail.classList.add("hidden");
      mailList.classList.remove("hidden");
    });
  }
});

// Helpers
const showToast = (msg = '✅ Copied to clipboard') => {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add('hidden'), 1300);
};

const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    showToast();
  } catch {}
};

const downloadText = (filename, text) => {
  const blob = new Blob([text], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

// Field listeners (copy + individual download)
document.addEventListener('click', (e) => {
  // Copy on value cell click
  const valCell = e.target.closest('.val-cell');
  if (valCell) {
    copyText(valCell.textContent.trim());
    return;
  }

  // Download single field
  const dl = e.target.closest('.dl-btn');
  if (dl) {
    const id = dl.getAttribute('data-target');
    const el = document.getElementById(id);
    if (el) downloadText(`${id}.txt`, el.textContent.trim());
  }
});

async function refreshToken() {
  const res = await fetch("https://api.mail.tm/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: state.email, password: "TempPass123!" })
  });
  const tokenData = await res.json();
  state.mailToken = tokenData.token;
}


// Copy All button
copyAllBtn.addEventListener('click', () => {
  const lines = fields
    .map(f => `${f[0].toUpperCase()+f.slice(1)}: ${state[f]}`)
    .join('\n');
  copyText(lines);
});

// Download image
downloadImgBtn.addEventListener('click', () => {
  const link = document.createElement('a');
  link.href = state.avatar || profilePic.src;
  link.download = 'profile-picture.jpg';
  link.click();
});

// Generate credentials (RandomUser API)
// Generate credentials (RandomUser API)
// Generate credentials (RandomUser API) - CLEANED version
generateBtn.addEventListener('click', async () => {
  try {
    generateBtn.disabled = true;
    generateBtn.innerHTML = "⏳ Generating...";

    // 1. Get random user (profile details)
    const res = await fetch('https://randomuser.me/api/');
    const data = await res.json();
    const u = data.results[0];

    state.fullname = `${u.name.first} ${u.name.last}`;
    state.username = u.login.username;
    state.password = u.login.password;
    state.phone    = u.phone; // placeholder until we reserve a real temp number
    state.dob      = new Date(u.dob.date).toLocaleDateString();
    state.address  = `${u.location.street.number} ${u.location.street.name}, ${u.location.city}, ${u.location.country}`;
    state.avatar   = u.picture.large;

    // 2. Setup Mail.tm account (unchanged)
    const domRes = await fetch("https://api.mail.tm/domains");
    const domains = await domRes.json();
    const domain = domains["hydra:member"][0].domain;
    const address = `${state.username}@${domain}`;
    const password = "TempPass123!"; // can randomize if you like

    // Create account
    await fetch("https://api.mail.tm/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, password })
    });

    // Login to get token
    const tokenRes = await fetch("https://api.mail.tm/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, password })
    });
    const tokenData = await tokenRes.json();

    state.email = address;
    state.mailToken = tokenData.token;

    // 3. Update UI with profile info
    profileIntro.classList.add('hidden');
    profileTable.classList.remove('hidden');
    profilePic.src = state.avatar;

    fields.forEach(f => {
      const el = document.getElementById(f);
      if (el) el.textContent = state[f];
    });

    // 4. Phone panel provisional UI (shows RandomUser phone until we reserve)
    phoneTopSpan.textContent = state.phone;
    phoneBox.innerHTML = `
      <div class="p-3 rounded-lg bg-gradient-to-r from-yellow-500 to-orange-500 shadow-md text-center font-bold">
        Your OTP is ${Math.floor(100000 + Math.random()*900000)}
      </div>
    `;

    // 5. Start Mail polling (unchanged)
    async function pollInbox() {
      const r = await fetch("https://api.mail.tm/messages", {
        headers: { Authorization: "Bearer " + state.mailToken }
      });
      const mails = await r.json();
      const messages = mails["hydra:member"];
      // render same as before (omitted here for brevity)...
    }
    setInterval(pollInbox, 5000);
    pollInbox();

    // 6. Reserve a real temp SMS number and start polling it.NureserveTempNumber_Scrape will update state.phone and UI
    const chosen = await reserveTempNumber_Scrape();

    // optional: if you want to highlight the phone field in UI after reservation
    const phoneEl = document.getElementById('phone');
    if (phoneEl) phoneEl.textContent = state.phone;

    showToast('✅ Temp phone assigned');

  } catch (e) {
    console.error("Error generating credentials:", e);
    showToast("❌ Error generating credentials");
  } finally {
    generateBtn.disabled = false;
    generateBtn.innerHTML = "✨ Generate Credentials";
  }
  await reserveTempNumber_Scrape();

});

;
  
  // Helper to open a mail detail
// Helper to open a mail detail (global)
async function openMail(id) {
  try {
    const res = await fetch("https://api.mail.tm/messages/" + id, {
      headers: { Authorization: "Bearer " + state.mailToken }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }

    const mail = await res.json();
    console.log("Mail data:", mail);

    // Fill detail view
    mdAvatar.textContent = mail.from?.address[0]?.toUpperCase() || "M";
    mdSender.textContent = mail.from?.address;
    mdEmail.textContent  = mail.to[0]?.address;
    mdDate.textContent   = new Date(mail.createdAt).toLocaleString();
    mdSubject.textContent= mail.subject || "(No subject)";
    mdBody.textContent   = mail.text || "(No content)";

    // Show mail detail, hide list
    mailList.classList.add("hidden");
    mailDetail.classList.remove("hidden");

  } catch (e) {
    console.error("Error opening mail:", e);
    showToast("❌ Failed to load email");
  }


  
}

/* -------------------------
   SMS24 (free) integration
   -------------------------
   Notes:
   - sms24.me doesn't guarantee CORS; we try direct fetch first, then fallback to public CORS proxy (allorigins).
   - Free numbers are public/shared; we cannot force the provider to "keep" a number, but we will reserve it locally for 60s.
   - For production reliability use a paid SMS API or a server-side proxy.
*/

state.tempPhone = null;          // { number: "...", providerId: "...", reservedAt: ts }
let smsPollTimer = null;
const RESERVED_MS = 60_000; // 60 seconds

// helper: try fetch with direct, then fallback to AllOrigins raw proxy
// SMS24 integration via local backend proxy
async function reserveTempNumber_Scrape() {
  // fetch list from backend proxy
  const r = await fetch(`${BACKEND}/api/numbers`);
  const data = await r.json();
  if (!data.ok) throw new Error('Failed to load numbers');
  const list = data.numbers || [];
  if (!list.length) throw new Error('No numbers available right now');

  // pick a not-reserved number if possible
  const chosen = list.find(n => !n.reserved) || list[0];

  // reserve it server-side (this prevents quick collisions in your client)
  const rr = await fetch(`${BACKEND}/api/reserve?phone=${encodeURIComponent(chosen.encoded)}`);
  const rs = await rr.json();
  if (!rs.ok) throw new Error(rs.error || 'Reserve failed');

  // Update UI + app state
  const displayNumber = chosen.display || chosen.label || 'Temp Number';

// update header
phoneTopSpan.textContent = displayNumber;

// update profile table field
const phoneEl = document.getElementById('phone');
if (phoneEl) phoneEl.textContent = displayNumber;

// update app state
state.tempPhone = chosen.encoded;
state.phone = displayNumber;


  // Start polling this number for messages and supply an OTP handler
  if (window._stopSmsPolling) window._stopSmsPolling(); // clear any existing poll
  window._stopSmsPolling = startSmsPolling_Scrape(chosen.encoded, (otp, fullMsg) => {
    // OTP callback - auto-fill OTP input if present
    const otpInput = document.getElementById('otpInput'); // your OTP input id (create in HTML)
    if (otpInput) {
      otpInput.value = otp;
      showToast('🔐 OTP auto-filled');
    }
    // Optionally, store last OTP in state
    state.lastOtp = otp;
    // You can also log or display fullMsg somewhere if helpful
    console.log('Auto-extracted OTP:', otp, 'from', fullMsg);
  });

  return { chosen, displayNumber };
  
}


// startSmsPolling_Scrape(encoded, otpHandler)
function startSmsPolling_Scrape(encoded, otpHandler) {
  let killed = false;
  let lastSeenIds = new Set();

  async function poll() {
    if (killed) return;
    try {
      const r = await fetch(`${BACKEND}/api/messages?phone=${encodeURIComponent(encoded)}`);
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || 'No data');

      const msgs = data.messages || [];
      // normalize messages array items to {id, from, text, time}
      const norm = msgs.map(m => {
        return {
          id: m.id || m._id || m.message_id || (m.text && m.text.slice(0,20)) || Date.now().toString(),
          from: m.from || m.sender || (m.from && (m.from.address || m.from)) || 'unknown',
          text: (m.text || m.body || m.content || '').toString(),
          time: m.time || m.createdAt || m.date || new Date().toISOString()
        };
      });

      // Render messages into phoneBox (oldest -> newest)
      if (norm.length === 0) {
        // optional: show empty placeholder
        phoneBox.innerHTML = `<div class="text-sm text-gray-500 p-4">No messages yet</div>`;
      } else {
        phoneBox.innerHTML = norm.map(n => `
          <div class="sms-row px-4 py-3 border-b border-gray-800" data-id="${n.id}">
            <div class="text-sm font-semibold">${escapeHtml(n.from)}</div>
            <div class="text-xs text-gray-400 whitespace-pre-wrap">${escapeHtml(n.text)}</div>
            <div class="text-xs text-gray-400 mt-1">${new Date(n.time).toLocaleString()}</div>
          </div>
        `).join('');
      }

      // For OTP extraction: find new messages we haven't processed
      for (const m of norm) {
        if (lastSeenIds.has(m.id)) continue; // already processed
        lastSeenIds.add(m.id);

        // OTP patterns - common formats: 6 digits, 4 digits, "code is 123456"
        // You can expand regexes for provider-specific formats.
        const otpMatch = String(m.text).match(/(?:\b|[:\s])([0-9]{4,8})\b/);
        if (otpMatch) {
          const otp = otpMatch[1];
          // call the handler if provided
          try {
            if (typeof otpHandler === 'function') otpHandler(otp, m.text);
            else {
              // fallback: auto-fill OTP input if present
              const otpInput = document.getElementById('otpInput');
              if (otpInput) { otpInput.value = otp; showToast('🔐 OTP auto-filled'); }
            }
          } catch (e) {
            console.warn('OTP handler error', e);
          }
        }
      }

    } catch (e) {
      console.warn('SMS poll error:', e.message || e);
      // show a non-invasive toast once (optional)
    } finally {
      if (!killed) setTimeout(poll, 4000); // poll every 4s
    }
  }

  poll();

  // return function to stop polling
  return () => { killed = true; };
}




// simple escape to avoid inserting raw HTML in body
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, s => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[s]));
}


// Update UI + app state
const displayNumber = chosen.display || chosen.label || 'Temp Number';
phoneTopSpan.textContent = displayNumber;   // updates header
state.tempPhone = chosen.encoded;
state.phone = displayNumber;                // updates Copy All state

// also push into the phone field in your profile table
const phoneEl = document.getElementById('phone');
if (phoneEl) phoneEl.textContent = displayNumber;


