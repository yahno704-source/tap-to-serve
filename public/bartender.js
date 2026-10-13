const socket = io();
const app = document.getElementById('app');
const logoutBtn = document.getElementById('logoutBtn');
const muteBtn = document.getElementById('muteBtn');

let state = null;
const AUTH_KEY = 'tts_bartender_auth';

function getAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch { return null; }
}
function setAuth(a) {
  try { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); } catch {}
}
function clearAuth() {
  try { localStorage.removeItem(AUTH_KEY); } catch {}
}

muteBtn.textContent = Alerts.isMuted() ? '🔕' : '🔔';
muteBtn.addEventListener('click', () => {
  muteBtn.textContent = Alerts.toggleMute() ? '🔕' : '🔔';
});
logoutBtn.addEventListener('click', () => {
  clearAuth();
  render();
});

socket.on('state:full', (s) => {
  state = s;
  render();
});

StaffMessages.init({
  socket,
  getToken: () => (getAuth() || {}).token,
  onAuthFail: () => { clearAuth(); render(); },
});

const NEXT_LABEL = { new: 'Start Making', preparing: 'Mark Ready' };

function formatItemLine(i) {
  return `${i.qty}× ${i.name}${i.note ? ` (${i.note})` : ''}`;
}

function render() {
  if (!state) return;
  if (!getAuth()) {
    StaffMessages.stop();
    logoutBtn.style.display = 'none';
    app.style.display = 'block';
    renderLogin();
    return;
  }
  StaffMessages.start();
  logoutBtn.style.display = 'inline-block';
  app.style.display = 'grid';

  const queue = [];
  Object.values(state.tables).forEach((table) => {
    const section = state.sections.find((s) => s.id === table.sectionId);
    table.drinkOrders
      .filter((o) => o.status !== 'delivered')
      .forEach((order) => queue.push({ order, table, section }));
  });
  queue.sort((a, b) => a.order.ts - b.order.ts);

  Alerts.process(
    queue.filter((q) => q.order.status === 'new').map((q) => ({
      key: `d:${q.order.id}`,
      text: `🍸 New drink order — Table ${q.table.number}`,
    }))
  );

  app.innerHTML = '';
  if (queue.length === 0) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.style.gridColumn = '1 / -1';
    note.textContent = 'No drink orders in the queue.';
    app.appendChild(note);
    return;
  }
  queue.forEach(({ order, table, section }) => app.appendChild(renderOrderCard(order, table, section)));
}

function renderOrderCard(order, table, section) {
  const card = document.createElement('div');
  card.className = 'table-card';
  card.style.borderLeftColor = section.color;

  const seatMeta = state.seatTypes[table.seatType];
  card.innerHTML = `
    <div class="card-head">
      <div class="table-number">Table ${table.number} <span class="seat-type-pill">${seatMeta.icon} ${seatMeta.label}</span></div>
      <div class="status-badge ${order.status}">${order.status}</div>
    </div>
    <div class="card-section-label">${section.name} · placed <span class="order-clock" data-order-ts="${order.ts}"${order.status !== 'ready' ? ' data-alarm="1"' : ''}></span></div>`;

  const itemsBox = document.createElement('div');
  itemsBox.className = 'mini-order';
  itemsBox.style.flexDirection = 'column';
  itemsBox.style.alignItems = 'flex-start';
  itemsBox.style.gap = '4px';
  order.items.forEach((i) => {
    const line = document.createElement('div');
    line.className = 'items';
    line.textContent = formatItemLine(i);
    itemsBox.appendChild(line);
  });
  card.appendChild(itemsBox);

  const nextLabel = NEXT_LABEL[order.status];
  if (nextLabel) {
    const btn = document.createElement('button');
    btn.className = 'send-order-btn';
    btn.style.width = '100%';
    btn.textContent = nextLabel;
    btn.addEventListener('click', () => socket.emit('bartender:advance_order', { tableId: table.id, orderId: order.id }));
    card.appendChild(btn);
  } else {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = order.comingBy ? `🏃 ${order.comingBy} is coming to get it` : 'Ready — waiting for a server to pick up';
    if (order.comingBy) note.style.color = 'var(--good)';
    card.appendChild(note);
  }
  return card;
}

function renderLogin() {
  app.innerHTML = `
    <div class="waiting-block" style="max-width:340px; margin:40px auto; grid-column:1/-1;">
      <div class="big-emoji">🔒</div>
      <h1>Bar Login</h1>
      <p>Enter the bartender PIN to see the drink queue.</p>
      <input id="pinInput" class="pin-input" maxlength="4" inputmode="numeric" placeholder="••••" />
      <div id="pinError" style="color:var(--danger); font-size:13px; min-height:18px;"></div>
      <button class="big-btn" id="pinSubmit">Log In</button>
    </div>`;
  const input = document.getElementById('pinInput');
  const errorEl = document.getElementById('pinError');
  input.focus();

  async function attemptLogin() {
    const pin = input.value.trim();
    if (pin.length !== 4) { errorEl.textContent = 'Enter the 4-digit PIN.'; return; }
    try {
      const res = await fetch('/api/bartender-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!data.ok) {
        errorEl.textContent = data.error || 'Incorrect PIN.';
        input.value = '';
        input.focus();
        return;
      }
      setAuth({ token: data.token });
      render();
    } catch {
      errorEl.textContent = 'Could not reach the server. Try again.';
    }
  }
  document.getElementById('pinSubmit').addEventListener('click', attemptLogin);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptLogin(); });
}
