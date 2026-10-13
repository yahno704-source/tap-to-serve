const socket = io();
const app = document.getElementById('app');
const logoutBtn = document.getElementById('logoutBtn');

let state = null;
const AUTH_KEY = 'tts_kitchen_auth';

function getAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch { return null; }
}
function setAuth(a) {
  try { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); } catch {}
}
function clearAuth() {
  try { localStorage.removeItem(AUTH_KEY); } catch {}
}

const muteBtn = document.getElementById('muteBtn');
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

function send(event, payload) {
  socket.emit(event, payload);
}

StaffMessages.init({
  socket,
  getToken: () => (getAuth() || {}).token,
  onAuthFail: () => { clearAuth(); render(); },
});

const NEXT_LABEL = { new: 'Start Cooking', cooking: 'Mark Ready' };

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
    table.foodOrders
      .filter((o) => o.status !== 'delivered')
      .forEach((order) => queue.push({ order, table, section }));
  });
  queue.sort((a, b) => a.order.ts - b.order.ts);

  Alerts.process(
    queue.filter((q) => q.order.status === 'new').map((q) => ({
      key: `f:${q.order.id}`,
      text: `🍔 New food order — Table ${q.table.number}`,
    }))
  );

  app.innerHTML = '';
  if (queue.length === 0) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.style.gridColumn = '1 / -1';
    note.textContent = 'No food orders in the queue.';
    app.appendChild(note);
    return;
  }
  queue.forEach(({ order, table, section }) => app.appendChild(renderOrderCard(order, table, section)));
}

function renderOrderCard(order, table, section) {
  const card = document.createElement('div');
  card.className = 'table-card';
  card.style.borderLeftColor = section.color;

  const head = document.createElement('div');
  head.className = 'card-head';
  head.innerHTML = `
    <div class="table-number">Table ${table.number}</div>
    <div class="status-badge ${order.status}">${order.status}</div>`;
  card.appendChild(head);

  const sub = document.createElement('div');
  sub.className = 'card-section-label';
  sub.innerHTML = `${section.name} · placed <span class="order-clock" data-order-ts="${order.ts}"${order.status !== 'ready' ? ' data-alarm="1"' : ''}></span>`;
  card.appendChild(sub);

  const itemsBox = document.createElement('div');
  itemsBox.className = 'mini-order';
  itemsBox.style.flexDirection = 'column';
  itemsBox.style.alignItems = 'flex-start';
  itemsBox.style.gap = '4px';
  order.items.forEach((i) => {
    const line = document.createElement('div');
    line.className = 'items';
    line.textContent = `${i.qty}× ${i.name}${i.note ? ` (${i.note})` : ''}`;
    itemsBox.appendChild(line);
  });
  card.appendChild(itemsBox);

  const nextLabel = NEXT_LABEL[order.status];
  if (nextLabel) {
    const btn = document.createElement('button');
    btn.className = 'send-order-btn';
    btn.style.width = '100%';
    btn.style.marginTop = '4px';
    btn.textContent = nextLabel;
    btn.addEventListener('click', () => send('kitchen:advance_order', { tableId: table.id, orderId: order.id }));
    card.appendChild(btn);
  } else {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = order.comingBy ? `🏃 ${order.comingBy} is coming to get it` : 'Ready — waiting for pickup';
    if (order.comingBy) note.style.color = 'var(--good)';
    card.appendChild(note);
  }

  return card;
}

function renderLogin() {
  app.innerHTML = `
    <div class="waiting-block" style="max-width:340px; margin:40px auto; grid-column:1/-1;">
      <div class="big-emoji">🔒</div>
      <h1>Kitchen Login</h1>
      <p>Enter the kitchen PIN to see the order queue.</p>
      <input id="pinInput" class="pin-input" maxlength="4" inputmode="numeric" placeholder="••••" />
      <div id="pinError" style="color:var(--danger); font-size:13px; min-height:18px;"></div>
      <button class="big-btn" id="pinSubmit">Log In</button>
    </div>`;

  const input = document.getElementById('pinInput');
  const errorEl = document.getElementById('pinError');
  input.focus();

  async function attemptLogin() {
    const pin = input.value.trim();
    if (pin.length !== 4) {
      errorEl.textContent = 'Enter the 4-digit PIN.';
      return;
    }
    try {
      const res = await fetch('/api/kitchen-login', {
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
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') attemptLogin();
  });
}
