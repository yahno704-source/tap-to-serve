const socket = io();
const app = document.getElementById('app');

const CHECKIN_KEY = 'tts_checkin_id';
let state = null;
let guestCount = 2;
// In-memory copy so check-in still works when localStorage is blocked
// (e.g. private browsing); storage just lets it survive a reload.
let memCheckinId = null;

// Pre-order while waiting for a table
let uiView = 'wait'; // 'wait' | 'menu' | 'review'
let preCart = {}; // menu item id -> quantity
let preorderDeclined = false;

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

const esc = (s) => CustomerAuth.escapeHtml(String(s));
const money = (n) => `$${(n || 0).toFixed(2)}`;
const clock = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const MENU_EMOJI = {
  water: '💧', soda: '🥤', tea: '🧊', coffee: '☕', beer: '🍺', wine: '🍷', cocktail: '🍸',
  fries: '🍟', wings: '🍗', nachos: '🧀', salad: '🥗', burger: '🍔', pasta: '🍝', dessert: '🍰',
};

// Keeps every "about N min" countdown on screen ticking without redrawing the page.
function minutesLabel(ts) {
  const ms = ts - Date.now();
  if (ms <= 30000) return 'any moment now';
  return `about ${Math.ceil(ms / 60000)} min`;
}
setInterval(() => {
  document.querySelectorAll('[data-eta]').forEach((el) => { el.textContent = minutesLabel(Number(el.dataset.eta)); });
}, 1000);

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
    if (myEntry.preorder) uiView = 'wait';
    // While choosing food, don't redraw on every live update — it would reset the screen.
    if (uiView === 'menu' && document.getElementById('preMenu')) return;
    if (uiView === 'review' && document.getElementById('preReview')) return;
    if (uiView === 'menu') return renderPreorderMenu(myEntry);
    if (uiView === 'review') return renderPreorderReview(myEntry);
    renderWaiting(myEntry);
    return;
  }

  uiView = 'wait';
  preCart = {};
  preorderDeclined = false;
  renderSeatPicker();
}

// ---------------------------------------------------------------- waiting
function renderWaiting(entry) {
  const meta = state.seatTypes[entry.seatType];
  const size = entry.partySize || 1;
  const q = entry.queue;
  const openMatch = Object.values(state.tables).find(
    (t) => t.status === 'empty' && t.seatType === entry.seatType
  );
  const hasWait = !!(q && q.estSeatAt !== null && !q.tableAvailableNow);

  let queueHtml;
  if (hasWait) {
    queueHtml = `
      <div class="queue-card">
        <div class="queue-pos">You're #${q.position} in line</div>
        <div class="queue-eta">Estimated wait: <b data-eta="${q.estSeatAt}">${minutesLabel(q.estSeatAt)}</b></div>
        <div class="queue-sub">Your ${esc(meta.label.toLowerCase())} should be ready around ${clock(q.estSeatAt)}</div>
      </div>`;
  } else if (q && q.estSeatAt === null) {
    queueHtml = `<div class="queue-card"><div class="queue-pos">You're #${q.position} in line</div><div class="queue-sub">Ask your host for an estimated wait.</div></div>`;
  } else {
    queueHtml = `<div class="queue-card ready"><div class="queue-pos">A table is ready for you</div><div class="queue-sub">A host will seat you shortly.</div></div>`;
  }

  let preorderHtml = '';
  const po = entry.preorder;
  if (po) {
    const items = [...po.foodItems, ...po.drinkItems];
    let status;
    if (!po.foodItems.length) status = 'Your drinks will come out as soon as you are seated.';
    else if (po.foodStatus === 'held') status = q && q.releaseAt ? `Your food starts cooking around ${clock(q.releaseAt)}, just before your table is ready.` : 'Your food starts cooking just before your table is ready.';
    else if (po.foodStatus === 'ready') status = '✅ Your food is ready and will be brought to your table.';
    else status = '👨‍🍳 The kitchen is cooking your food now.';
    preorderHtml = `
      <div class="preorder-card done">
        <div class="preorder-title">✓ Pre-order placed</div>
        <div class="preorder-items">${items.map((i) => `${i.qty}× ${esc(i.name)}`).join(' · ')}</div>
        <div class="preorder-line"><span>Paid up front (half)</span><b>${money(po.deposit)}</b></div>
        <div class="preorder-line"><span>Rest is added to your bill</span><b>${money(po.subtotal - po.deposit)}</b></div>
        <div class="preorder-status">${status}</div>
      </div>`;
  } else if (hasWait && !preorderDeclined) {
    preorderHtml = `
      <div class="preorder-card">
        <div class="preorder-title">🍽️ Hungry while you wait?</div>
        <p>Look at the menu and order now. You pay <b>half up front</b> and the rest with your bill. We start your food about <b>3 minutes before</b> your table is ready, so it arrives hot.</p>
        <button class="send-order-btn" id="preStart" style="width:100%;">Look at the menu &amp; order</button>
        <button class="bill-btn" id="preSkip" style="width:100%; margin-top:8px;">No thanks, I'll wait</button>
      </div>`;
  }

  app.innerHTML = `
    <div class="waiting-block" style="flex:none; min-height:0; padding:22px 0 4px;">
      <div class="big-emoji">${meta.icon}</div>
      <h1>You're checked in!</h1>
      <p>Party of ${size}, waiting for a ${esc(meta.label.toLowerCase())}.</p>
    </div>
    ${queueHtml}
    ${preorderHtml}
    <div style="border-top:1px solid var(--border); margin-top:8px; padding-top:16px; text-align:center;">
      <p style="color:var(--muted); font-size:12px; margin-bottom:10px;">TESTING ONLY — in the real app, a host does this step for you.</p>
      <button class="bill-btn" id="selfSeatBtn">
        ${openMatch ? `Skip the wait — seat myself at Table ${openMatch.number}` : 'Skip the wait — seat me now (test mode)'}
      </button>
    </div>`;

  const start = document.getElementById('preStart');
  if (start) start.addEventListener('click', () => { uiView = 'menu'; render(); });
  const skip = document.getElementById('preSkip');
  if (skip) skip.addEventListener('click', () => { preorderDeclined = true; render(); });

  const btn = document.getElementById('selfSeatBtn');
  btn.addEventListener('click', () => {
    btn.disabled = true;
    if (openMatch) {
      socket.emit('waiter:seat_from_waitlist', { waitlistId: entry.id, tableId: openMatch.id });
    } else {
      // Every table of this type is taken: test mode clears the longest-occupied one for you.
      socket.emit('customer:demo_seat', { checkinId: entry.id, customerToken: CustomerAuth.getToken() });
    }
  });
}

// ---------------------------------------------------------------- pre-order menu
function cartTotals() {
  let count = 0;
  let subtotal = 0;
  Object.entries(preCart).forEach(([id, qty]) => {
    const item = state.menu.find((m) => m.id === id);
    if (item && qty > 0) { count += qty; subtotal += item.price * qty; }
  });
  return { count, subtotal, deposit: Math.round(subtotal * 50) / 100 };
}

function renderPreorderMenu(entry) {
  const q = entry.queue;
  app.innerHTML = `
    <div class="section-title" style="text-align:center;">Order while you wait</div>
    <p style="text-align:center; color:var(--muted); font-size:13px; margin:0 8px 12px;">
      Pay half now, the rest with your bill. Food starts cooking about 3 minutes before your table is ready${q && q.estSeatAt ? ` (around ${clock(q.estSeatAt)})` : ''}.
    </p>
    <div id="preMenu"></div>
    <div class="pre-bar" id="preBar">
      <div><b id="preCount">0 items</b><span id="preTotal"></span></div>
      <div style="display:flex; gap:8px;">
        <button class="bill-btn" id="preBack">Back</button>
        <button class="send-order-btn" id="preReviewBtn" disabled>Review &amp; pay half</button>
      </div>
    </div>`;

  const host = document.getElementById('preMenu');
  [['drink', 'Drinks'], ['food', 'Food']].forEach(([cat, heading]) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="section-title">${heading}</div>`;
    const grid = document.createElement('div');
    grid.className = 'menu-grid';
    state.menu.filter((m) => m.category === cat).forEach((item) => {
      const photo = item.photo
        ? `<img class="menu-photo" src="${esc(item.photo)}" alt="${esc(item.name)}" loading="lazy" />`
        : `<div class="menu-photo placeholder" role="img" aria-label="${esc(item.name)}">${MENU_EMOJI[item.id] || '🍽️'}</div>`;
      const card = document.createElement('div');
      card.className = 'menu-item';
      card.innerHTML = `
        <div class="menu-photo-wrap" style="cursor:default;">${photo}</div>
        <div class="name">${esc(item.name)}</div>
        <div class="price">${item.price === 0 ? 'Free' : money(item.price)}</div>
        <div class="qty-row">
          <button data-act="dec" data-id="${item.id}">−</button>
          <div class="qty" data-qty="${item.id}">${preCart[item.id] || 0}</div>
          <button data-act="inc" data-id="${item.id}">+</button>
        </div>`;
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    host.appendChild(wrap);
  });

  host.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    const next = Math.max(0, Math.min(20, (preCart[id] || 0) + (b.dataset.act === 'inc' ? 1 : -1)));
    if (next === 0) delete preCart[id]; else preCart[id] = next;
    host.querySelector(`[data-qty="${id}"]`).textContent = next;
    refreshBar();
  });

  function refreshBar() {
    const { count, subtotal } = cartTotals();
    document.getElementById('preCount').textContent = `${count} item${count === 1 ? '' : 's'}`;
    document.getElementById('preTotal').textContent = count ? ` · ${money(subtotal)}` : '';
    document.getElementById('preReviewBtn').disabled = count === 0;
  }
  refreshBar();

  document.getElementById('preBack').addEventListener('click', () => { uiView = 'wait'; render(); });
  document.getElementById('preReviewBtn').addEventListener('click', () => { uiView = 'review'; render(); });
  window.scrollTo(0, 0);
}

function renderPreorderReview(entry) {
  const { subtotal, deposit } = cartTotals();
  const lines = Object.entries(preCart)
    .map(([id, qty]) => {
      const item = state.menu.find((m) => m.id === id);
      return item ? `<div class="preorder-line"><span>${qty}× ${esc(item.name)}</span><b>${money(item.price * qty)}</b></div>` : '';
    })
    .join('');
  app.innerHTML = `
    <div id="preReview">
      <div class="section-title" style="text-align:center;">Review your pre-order</div>
      <div class="preorder-card">
        ${lines}
        <div class="preorder-line total"><span>Order total</span><b>${money(subtotal)}</b></div>
        <div class="preorder-line"><span>Pay now (half)</span><b style="color:var(--good);">${money(deposit)}</b></div>
        <div class="preorder-line"><span>Added to your bill later</span><b>${money(subtotal - deposit)}</b></div>
        <p style="color:var(--muted); font-size:12px; margin:10px 0 0;">
          Your food starts cooking about 3 minutes before your table is ready. Drinks come as soon as you sit.
          <br><b>Demo only — no real card is charged.</b>
        </p>
      </div>
      <button class="send-order-btn" id="payHalf" style="width:100%; margin-top:12px;">Pay ${money(deposit)} now</button>
      <button class="bill-btn" id="backToMenu" style="width:100%; margin-top:8px;">Back to the menu</button>
    </div>`;
  document.getElementById('backToMenu').addEventListener('click', () => { uiView = 'menu'; render(); });
  document.getElementById('payHalf').addEventListener('click', (ev) => {
    ev.target.disabled = true;
    socket.emit('customer:preorder', {
      checkinId: entry.id,
      items: Object.entries(preCart).map(([id, qty]) => ({ id, qty })),
      customerToken: CustomerAuth.getToken(),
    });
    preCart = {};
    uiView = 'wait';
    // The next state update shows the "Pre-order placed" card.
  });
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- seat picker
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
