const socket = io();
const app = document.getElementById('app');

const CHECKIN_KEY = 'tts_checkin_id';
let state = null;
let guestCount = 2;
// In-memory copy so check-in still works when localStorage is blocked
// (e.g. private browsing); storage just lets it survive a reload.
let memCheckinId = null;

// crypto.randomUUID only exists on HTTPS/localhost — phones reach this page over
// plain http://<LAN IP>, where calling it throws and the tap silently does nothing.
function newId() {
  if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

function getCheckinId() {
  try { return localStorage.getItem(CHECKIN_KEY) || memCheckinId; } catch { return memCheckinId; }
}
function setCheckinId(id) {
  memCheckinId = id;
  try { localStorage.setItem(CHECKIN_KEY, id); } catch {}
}
function clearCheckinId() {
  memCheckinId = null;
  try { localStorage.removeItem(CHECKIN_KEY); } catch {}
}

// null = still checking the saved session, false = logged out, object = logged in
let customer = null;

CustomerAuth.verify().then((c) => {
  customer = c || false;
  render();
});

socket.on('state:full', (s) => {
  state = s;
  render();
});

// Server rejected a check-in because the session expired or was revoked.
socket.on('customer:auth_required', () => {
  CustomerAuth.clearToken();
  clearCheckinId();
  customer = false;
  render();
});

function render() {
  if (!state || customer === null) return;
  if (!customer) {
    CustomerAuth.renderLogin(app, (c) => {
      customer = c;
      render();
    });
    return;
  }
  const myId = getCheckinId();
  const myEntry = myId ? state.waitlist.find((w) => w.id === myId) : null;

  if (myEntry && myEntry.status === 'seated' && myEntry.tableId) {
    clearCheckinId();
    window.location.href = `/customer.html?table=${myEntry.tableId}`;
    return;
  }

  if (myEntry && myEntry.status === 'waiting') {
    renderWaiting(myEntry);
    return;
  }

  renderSeatPicker();
}

function renderWaiting(entry) {
  const meta = state.seatTypes[entry.seatType];
  const size = entry.partySize || 1;
  const openMatch = Object.values(state.tables).find(
    (t) => t.status === 'empty' && t.seatType === entry.seatType
  );

  app.innerHTML = `
    <div class="waiting-block">
      <div class="big-emoji">${meta.icon}</div>
      <h1>You're checked in!</h1>
      <p>Party of ${size}, waiting for a ${meta.label.toLowerCase()} — a host will come seat you shortly.</p>
    </div>
    <div style="border-top:1px solid var(--border); margin-top:8px; padding-top:16px; text-align:center;">
      <p style="color:var(--muted); font-size:12px; margin-bottom:10px;">TESTING ONLY — in the real app, a host does this step for you.</p>
      <button class="bill-btn" id="selfSeatBtn" ${openMatch ? '' : 'disabled'}>
        ${openMatch ? `Skip the wait — seat myself at Table ${openMatch.number}` : 'No open table to self-seat right now'}
      </button>
    </div>`;

  const btn = document.getElementById('selfSeatBtn');
  if (openMatch) {
    btn.addEventListener('click', () => {
      socket.emit('waiter:seat_from_waitlist', { waitlistId: entry.id, tableId: openMatch.id });
    });
  }
}

function renderSeatPicker() {
  app.innerHTML = `
    <div class="waiting-block">
      <div class="big-emoji">👋</div>
      <h1>Welcome, ${CustomerAuth.escapeHtml(customer.name)}!</h1>
      <p>How many guests?</p>
    </div>
    <div class="menu-item" style="max-width:220px; margin:-10px auto 4px;">
      <div class="qty-row">
        <button id="guestDec">−</button>
        <div class="qty" id="guestCountLabel" style="font-size:22px;">${guestCount}</div>
        <button id="guestInc">+</button>
      </div>
    </div>
    <div class="section-title" style="text-align:center;">Where would you like to sit?</div>
    <div class="requests-grid" id="seatGrid" style="grid-template-columns: repeat(3, 1fr);"></div>`;

  document.getElementById('guestDec').addEventListener('click', () => {
    guestCount = Math.max(1, guestCount - 1);
    document.getElementById('guestCountLabel').textContent = guestCount;
  });
  document.getElementById('guestInc').addEventListener('click', () => {
    guestCount = Math.min(20, guestCount + 1);
    document.getElementById('guestCountLabel').textContent = guestCount;
  });

  const grid = document.getElementById('seatGrid');
  Object.entries(state.seatTypes).forEach(([type, meta]) => {
    const btn = document.createElement('button');
    btn.className = 'request-btn';
    btn.innerHTML = `<div class="emoji">${meta.icon}</div><div>${meta.label}</div>`;
    btn.addEventListener('click', () => {
      const id = newId();
      setCheckinId(id);
      socket.emit('customer:checkin', {
        checkinId: id,
        seatType: type,
        partySize: guestCount,
        customerToken: CustomerAuth.getToken(),
      });
    });
    grid.appendChild(btn);
  });

  app.prepend(
    CustomerAuth.greetingBar(() => {
      customer = false;
      render();
    })
  );
}
