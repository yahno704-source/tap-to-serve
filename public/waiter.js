const params = new URLSearchParams(window.location.search);
const waiterId = params.get('waiter') || 'w1';
const socket = io();

const app = document.getElementById('app');
const waiterNameEl = document.getElementById('waiterName');
const waiterDot = document.getElementById('waiterDot');
const sectionPill = document.getElementById('sectionPill');
const tipsPill = document.getElementById('tipsPill');
const ratingPill = document.getElementById('ratingPill');
const logoutBtn = document.getElementById('logoutBtn');
const muteBtn = document.getElementById('muteBtn');

let state = null;

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Things that have to survive a re-render: which table rows are expanded
// and half-typed messages.
const ui = { open: new Set(), drafts: {}, view: 'todo' };

const tabBar = document.getElementById('tabBar');
const tabTodo = document.getElementById('tabTodo');
const tabRecap = document.getElementById('tabRecap');
[[tabTodo, 'todo'], [tabRecap, 'recap']].forEach(([btn, view]) =>
  btn.addEventListener('click', () => {
    ui.view = view;
    window.scrollTo(0, 0);
    render();
  })
);

const AUTH_KEY = 'tts_waiter_auth';
function getAuth() {
  try {
    const a = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    return a && a.waiterId === waiterId ? a : null;
  } catch {
    return null;
  }
}
function setAuth(a) { try { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); } catch {} }
function clearAuth() { try { localStorage.removeItem(AUTH_KEY); } catch {} }

muteBtn.textContent = Alerts.isMuted() ? '🔕' : '🔔';
muteBtn.addEventListener('click', () => {
  muteBtn.textContent = Alerts.toggleMute() ? '🔕' : '🔔';
});
logoutBtn.addEventListener('click', () => {
  clearAuth();
  render();
});

StaffMessages.init({
  socket,
  getToken: () => (getAuth() || {}).token,
  onAuthFail: () => { clearAuth(); render(); },
});

socket.on('state:full', (s) => {
  state = s;
  render();
});

function send(event, payload) {
  socket.emit(event, payload);
}

const itemsText = (items) => items.map((i) => `${i.qty}× ${i.name}`).join(', ');
const notesText = (items) => items.filter((i) => i.note).map((i) => `${i.name}: ${i.note}`).join('; ');

// ---------------------------------------------------------------------------
// The whole screen is one list: "do this now", oldest first. Each task has
// what it is, where, how long it's been waiting, and the button(s) to tap.
// ---------------------------------------------------------------------------
function buildTasks(section, myTables) {
  const tasks = [];

  (state.waitlist || [])
    .filter((w) => w.status === 'waiting')
    .forEach((w) => {
      const meta = state.seatTypes[w.seatType];
      const open = myTables.filter((t) => t.status === 'empty' && t.seatType === w.seatType);
      tasks.push({
        key: `wl:${w.id}`,
        ts: w.ts,
        where: 'At the door',
        icon: '🚪',
        title: `${w.guestName ? w.guestName + ' · ' : ''}Party of ${w.partySize || 1}`,
        sub: `Wants a ${meta.label.toLowerCase()}`,
        buttons: open.map((t) => ({
          label: `Seat at Table ${t.number}`,
          kind: 'go',
          run: () => send('waiter:seat_from_waitlist', { waitlistId: w.id, tableId: t.id }),
        })),
        note: open.length ? '' : `No open ${meta.label.toLowerCase()} in ${section.name}`,
      });
    });

  myTables.forEach((t) => {
    const where = `Table ${t.number}`;

    if (t.status === 'needs_greeting') {
      tasks.push({
        key: `greet:${t.id}`, ts: t.arrivedAt || 0, where, icon: '👋',
        title: `Greet ${t.guestName || 'new guests'}`,
        buttons: [{ label: 'Greet & seat', kind: 'go', run: () => send('waiter:greet', { tableId: t.id }) }],
      });
      return;
    }

    // Seated from the door list but nobody has been to the table yet.
    if (t.status === 'seated' && t.greetedAt === null) {
      tasks.push({
        key: `greet:${t.id}`, ts: t.seatedAt, where, icon: '👋', urgent: true,
        title: `Greet ${t.guestName || 'the table'}`,
        sub: 'Seated — not greeted yet',
        alertText: `${where} is seated but not greeted`,
        buttons: [{ label: '👋 I greeted them', kind: 'go', run: () => send('waiter:mark_greeted', { tableId: t.id }) }],
      });
    }

    (state.complaints || [])
      .filter((c) => c.tableId === t.id && c.status === 'open')
      .forEach((c) =>
        tasks.push({
          key: `cmp:${c.id}`, ts: c.ts, where, icon: '🚩', title: 'Complaint', sub: c.message, urgent: true,
          buttons: [{ label: '✓ Resolved', kind: 'done', run: () => send('complaint:resolve', { complaintId: c.id }) }],
        })
      );

    t.requests
      .filter((r) => r.status === 'open' || r.status === 'accepted')
      .forEach((r) => {
        const meta = state.requestTypes[r.type];
        const isBill = r.type === 'bill';
        const buttons = [];
        if (r.status === 'open') {
          buttons.push({ label: 'On my way', kind: 'go', run: () => send('waiter:accept_request', { tableId: t.id, requestId: r.id }) });
        }
        // Done is allowed straight from "open": the customer's wait clock
        // only stops when a waiter says it's finished.
        buttons.push({
          label: isBill ? '✓ Bill delivered' : '✓ Done',
          kind: 'done',
          run: () => send('waiter:resolve_request', { tableId: t.id, requestId: r.id }),
        });
        tasks.push({
          key: `req:${r.id}`, ts: r.ts, where, icon: meta.icon,
          title: r.type === 'special' ? 'Special request' : isBill ? 'Wants the bill' : meta.label,
          sub: r.type === 'special' ? r.message : '',
          accepted: r.acceptedAt || null,
          buttons,
        });
      });

    // Every undelivered order is a task: "ready" ones are the urgent ones,
    // the rest show what was ordered and where it is in the kitchen/bar.
    [['drink', t.drinkOrders, '🥤', 'Drinks', 'bar'], ['food', t.foodOrders, '🍔', 'Food', 'kitchen']].forEach(
      ([kind, orders, icon, noun, maker]) =>
        orders
          .filter((o) => o.status !== 'delivered')
          .forEach((o) => {
            const ready = o.status === 'ready';
            const buttons = [];
            // Ready orders: tell the cook/bartender you're coming, then deliver.
            if (ready && !o.comingAt) {
              buttons.push({
                label: '🏃 Coming to get it', kind: 'go',
                run: () => send('waiter:coming_to_get', { tableId: t.id, orderId: o.id, kind, token: (getAuth() || {}).token }),
              });
            }
            buttons.push({
              label: '✓ Delivered', kind: 'done',
              run: () => send(kind === 'drink' ? 'waiter:deliver_drink_order' : 'waiter:deliver_food_order', { tableId: t.id, orderId: o.id }),
            });
            tasks.push({
              // The key changes when the order turns ready, so the waiter gets a
              // fresh alert at that moment (not just when it was first placed).
              key: ready ? `${kind}:${o.id}:ready` : `${kind}:${o.id}`,
              group: ready ? 'ready' : 'kitchen',
              ts: ready ? o.readyAt || o.ts : o.ts, where, icon,
              title: ready ? `${noun} ready — ${maker === 'bar' ? 'at the bar' : 'in the kitchen'}` : `${noun} ${maker === 'bar' ? 'being made' : 'being cooked'}`,
              urgent: ready,
              sub: itemsText(o.items),
              note: [
                ready ? '' : `${maker === 'bar' ? 'Bar' : 'Kitchen'}: ${o.status}`,
                notesText(o.items) ? `Note: ${notesText(o.items)}` : '',
              ].filter(Boolean).join(' · '),
              coming: ready && o.comingAt ? { by: o.comingBy, ts: o.comingAt } : null,
              buttons,
            });
          })
    );
  });

  return tasks.sort((a, b) => a.ts - b.ts);
}

function taskCard(task) {
  const card = document.createElement('div');
  card.className = `w-task${task.urgent ? ' urgent' : ''}${task.group === 'ready' ? ' ready' : ''}${task.group === 'kitchen' ? ' in-progress' : ''}`;

  const head = document.createElement('div');
  head.className = 'w-task-head';
  head.innerHTML = `
    <div class="w-task-icon">${task.icon}</div>
    <div class="w-task-text">
      <div class="w-task-where">${escapeHtml(task.where)}</div>
      <div class="w-task-title">${escapeHtml(task.title)}</div>
    </div>`;
  if (task.ts) {
    const clock = document.createElement('span');
    clock.className = 'order-clock w-task-clock';
    clock.dataset.orderTs = task.ts;
    clock.dataset.alarm = '1'; // overdue (10+ min) triggers the flashing light + siren
    head.querySelector('.w-task-text').appendChild(clock);
  }
  card.appendChild(head);

  if (task.sub) {
    const sub = document.createElement('div');
    sub.className = 'w-task-sub';
    sub.textContent = task.sub;
    card.appendChild(sub);
  }
  if (task.note) {
    const note = document.createElement('div');
    note.className = 'w-task-note';
    note.textContent = task.note;
    card.appendChild(note);
  }
  if (task.coming) {
    const c = document.createElement('div');
    c.className = 'w-task-note';
    c.innerHTML = `🏃 ${escapeHtml(task.coming.by || 'Waiter')} is coming to get it — <span class="order-clock" data-order-ts="${task.coming.ts}"></span>`;
    card.appendChild(c);
  }
  if (task.accepted) {
    const acc = document.createElement('div');
    acc.className = 'w-task-note';
    acc.innerHTML = `On my way — <span class="order-clock" data-order-ts="${task.accepted}"></span>`;
    card.appendChild(acc);
  }

  if (task.buttons.length) {
    const row = document.createElement('div');
    row.className = 'w-task-btns';
    task.buttons.forEach((b) => {
      const btn = document.createElement('button');
      btn.className = `w-btn ${b.kind}`;
      btn.textContent = b.label;
      btn.addEventListener('click', () => {
        btn.disabled = true; // the next state broadcast redraws the card
        b.run();
      });
      row.appendChild(btn);
    });
    card.appendChild(row);
  }
  return card;
}

// ---------------------------------------------------------------------------
// "My tables": one quiet row per table. Tap to open messages / orders.
// ---------------------------------------------------------------------------
function tableRow(table, section) {
  const seat = state.seatTypes[table.seatType];
  const waiting = [
    ...table.requests.filter((r) => r.status === 'open' || r.status === 'accepted'),
    ...[...table.drinkOrders, ...table.foodOrders].filter((o) => o.status !== 'delivered'),
  ].length;

  const details = document.createElement('details');
  details.className = `w-table ${table.status}`;
  details.style.borderLeftColor = section.color;
  const key = `t:${table.id}`;
  if (ui.open.has(key)) details.open = true;
  details.addEventListener('toggle', () => {
    if (details.open) ui.open.add(key);
    else ui.open.delete(key);
  });

  const summary = document.createElement('summary');
  const notGreeted = table.status === 'seated' && table.greetedAt === null;
  const label = table.status === 'empty' ? 'Open' : table.status === 'needs_greeting' ? 'Needs greeting' : 'In service';
  if (notGreeted) details.classList.add('not-greeted');
  summary.innerHTML = `
    <span class="w-table-name">Table ${table.number}</span>
    <span class="w-table-meta">${seat.icon} ${escapeHtml(seat.label)}${table.guestName && table.status !== 'empty' ? ' · ' + escapeHtml(table.guestName) : ''}</span>
    <span class="w-table-state">${label}${notGreeted ? ' · <span class="w-ungreeted">NOT GREETED</span>' : ''}${waiting ? ` · <b>${waiting} waiting</b>` : ''}</span>`;
  // Seated time + how long they waited to get a table, visible without
  // opening the row.
  if (table.status === 'seated' && table.seatedAt) {
    const times = document.createElement('span');
    times.className = 'w-table-times';
    times.innerHTML =
      `Seated <span class="order-clock" data-order-ts="${table.seatedAt}"></span>` +
      (table.arrivedAt ? `<span class="w-waited">Waited ${durationLabel(table.seatedAt - table.arrivedAt)} for a table</span>` : '');
    summary.appendChild(times);
  }
  if (table.status === 'needs_greeting' && table.arrivedAt) {
    const times = document.createElement('span');
    times.className = 'w-table-times';
    times.innerHTML = `Arrived <span class="order-clock" data-order-ts="${table.arrivedAt}"></span>`;
    summary.appendChild(times);
  }
  details.appendChild(summary);

  if (table.status !== 'seated') {
    details.classList.add('no-body');
    return details;
  }

  const body = document.createElement('div');
  body.className = 'w-table-body';

  [['🥤', table.drinkOrders], ['🍔', table.foodOrders]].forEach(([icon, orders]) =>
    orders.forEach((o) => {
      const line = document.createElement('div');
      line.className = 'w-line';
      line.innerHTML = `${icon} ${escapeHtml(itemsText(o.items))} — <b>${o.status}</b>`;
      body.appendChild(line);
    })
  );

  if (table.bill && !table.bill.paid) {
    const bill = document.createElement('div');
    bill.className = 'w-line';
    bill.textContent = '🧾 Bill delivered — waiting for customer to pay';
    body.appendChild(bill);
  }

  const chips = document.createElement('div');
  chips.className = 'w-chips';
  ['On my way!', 'Be right there!', 'Got it, thanks!', 'One moment please'].forEach((text) => {
    const c = document.createElement('button');
    c.className = 'w-chip';
    c.textContent = text;
    c.addEventListener('click', () => send('waiter:send_message', { tableId: table.id, text }));
    chips.appendChild(c);
  });
  body.appendChild(chips);

  const msgRow = document.createElement('div');
  msgRow.className = 'w-msg-row';
  const input = document.createElement('input');
  input.className = 'w-input';
  input.maxLength = 200;
  input.placeholder = 'Type a message…';
  input.dataset.focuskey = `msg:${table.id}`;
  input.value = ui.drafts[table.id] || '';
  input.addEventListener('input', () => { ui.drafts[table.id] = input.value; });
  const sendBtn = document.createElement('button');
  sendBtn.className = 'w-btn go';
  sendBtn.textContent = 'Send';
  const sendCustom = () => {
    const text = input.value.trim();
    if (!text) return;
    send('waiter:send_message', { tableId: table.id, text });
    input.value = '';
    ui.drafts[table.id] = '';
  };
  sendBtn.addEventListener('click', sendCustom);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendCustom(); });
  msgRow.appendChild(input);
  msgRow.appendChild(sendBtn);
  body.appendChild(msgRow);

  const count = (table.messages || []).length;
  if (count) {
    const last = document.createElement('div');
    last.className = 'w-line muted';
    last.textContent = `Last sent: "${table.messages[count - 1].text}"`;
    body.appendChild(last);
  }

  if (table.timeline && table.timeline.length) {
    const tl = document.createElement('div');
    tl.className = 'w-line muted';
    tl.textContent = 'Timeline';
    body.appendChild(tl);
    body.appendChild(renderVisitTimeline(table.timeline));
  }

  details.appendChild(body);
  return details;
}

// ---------------------------------------------------------------------------
// Greeting alert: a table (or door party) waiting for a host is the one thing
// that must not be missed. A pinned red bar stays up until it's handled, with
// a loud chime + buzz when it appears, a repeat chime every 8s, and a
// flashing tab title for when the page is in the background.
// ---------------------------------------------------------------------------
const alertBar = document.getElementById('alertBar');
const BASE_TITLE = document.title;
const greetAlert = { keys: new Set(), ringTimer: null, flashTimer: null, label: '' };

function updateSoundHint() {
  const hint = document.getElementById('soundHint');
  if (hint) hint.style.display = Alerts.isReady() || Alerts.isMuted() ? 'none' : 'block';
}
document.addEventListener('click', () => setTimeout(updateSoundHint, 150));

function updateGreetAlert(tasks) {
  const pending = tasks.filter((t) => t.key.startsWith('greet:') || t.key.startsWith('wl:'));
  const keys = new Set(pending.map((t) => t.key));
  const hasNew = [...keys].some((k) => !greetAlert.keys.has(k));
  greetAlert.keys = keys;
  if (hasNew) Alerts.ring();

  alertBar.innerHTML = '';
  document.body.classList.toggle('has-alertbar', pending.length > 0);
  pending.slice(0, 3).forEach((t) => {
    const row = document.createElement('div');
    row.className = 'w-alert-row';
    const isGreet = t.key.startsWith('greet:');
    const text = document.createElement('div');
    text.className = 'w-alert-text';
    text.innerHTML = `<b>${t.icon} ${escapeHtml(isGreet ? (t.alertText || `${t.where} needs greeting`) : `${t.title} at the door`)}</b>`;
    if (t.ts) {
      const clock = document.createElement('span');
      clock.className = 'order-clock';
      clock.dataset.orderTs = t.ts;
      text.appendChild(clock);
    }
    row.appendChild(text);
    const btn = document.createElement('button');
    btn.className = 'w-alert-btn';
    if (isGreet) {
      btn.textContent = t.buttons[0].label;
      btn.addEventListener('click', () => { btn.disabled = true; t.buttons[0].run(); });
    } else {
      btn.textContent = 'Seat';
      btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }
    row.appendChild(btn);
    alertBar.appendChild(row);
  });
  if (pending.length > 3) {
    const more = document.createElement('div');
    more.className = 'w-alert-more';
    more.textContent = `+${pending.length - 3} more waiting`;
    alertBar.appendChild(more);
  }
  if (getAuth()) {
    const hint = document.createElement('div');
    hint.id = 'soundHint';
    hint.className = 'w-sound-hint';
    hint.textContent = '🔊 Tap anywhere to turn on alert sounds';
    alertBar.appendChild(hint);
    updateSoundHint();
  }

  // Repeat the chime until somebody deals with it.
  if (pending.length && !greetAlert.ringTimer) {
    greetAlert.ringTimer = setInterval(() => { if (greetAlert.keys.size) Alerts.ring(); }, 8000);
  } else if (!pending.length && greetAlert.ringTimer) {
    clearInterval(greetAlert.ringTimer);
    greetAlert.ringTimer = null;
  }

  // Flash the tab title so it's noticeable from another tab / app.
  greetAlert.label = pending.length ? `👋 GREET ${pending[0].where.replace('Table ', 'T')}${pending.length > 1 ? ` +${pending.length - 1}` : ''}` : '';
  if (pending.length && !greetAlert.flashTimer) {
    let on = false;
    greetAlert.flashTimer = setInterval(() => {
      on = !on;
      document.title = on && greetAlert.label ? greetAlert.label : BASE_TITLE;
    }, 1000);
  } else if (!pending.length && greetAlert.flashTimer) {
    clearInterval(greetAlert.flashTimer);
    greetAlert.flashTimer = null;
    document.title = BASE_TITLE;
  }
}

function clearGreetAlert() {
  updateGreetAlert([]);
}

// ---------------------------------------------------------------------------
// "My shift": everything this waiter has done today, available at any time.
// ---------------------------------------------------------------------------
const money = (n) => `$${(n || 0).toFixed(2)}`;
const dur = (ms) => (ms === null || ms === undefined ? '—' : durationLabel(ms));

function statTile(label, value) {
  const el = document.createElement('div');
  el.className = 'w-stat-tile';
  el.innerHTML = `<div class="w-stat-label">${label}</div><div class="w-stat-value">${value}</div>`;
  return el;
}

function renderRecap(section, myTables) {
  const recap = (state.recapBySection && state.recapBySection[section.id]) || { served: 0, visits: [] };
  const rating = state.ratingsBySection && state.ratingsBySection[section.id];
  const active = myTables.filter((t) => t.status !== 'empty').length;

  const head = document.createElement('h2');
  head.className = 'w-heading';
  head.textContent = 'Your shift so far';
  app.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'w-stat-grid';
  grid.appendChild(statTile('Customers served', recap.served));
  grid.appendChild(statTile('Tips', money(recap.tips)));
  grid.appendChild(statTile('Sales', money(recap.sales)));
  grid.appendChild(statTile('Rating', rating && rating.count ? `★ ${rating.avg.toFixed(1)} (${rating.count})` : '—'));
  grid.appendChild(statTile('Avg time at table', dur(recap.avgTableMs)));
  grid.appendChild(statTile('Avg wait for a table', dur(recap.avgWaitMs)));
  grid.appendChild(statTile('Avg time to greet', dur(recap.avgGreetMs)));
  grid.appendChild(statTile('Avg time to respond', dur(recap.avgResponseMs)));
  grid.appendChild(statTile('Avg time to finish a request', dur(recap.avgCompletionMs)));
  app.appendChild(grid);

  const now = document.createElement('div');
  now.className = 'w-line muted';
  now.textContent = `${active} table${active === 1 ? '' : 's'} being served right now · ${recap.requestsHandled || 0} requests handled`;
  app.appendChild(now);

  const listHead = document.createElement('h2');
  listHead.className = 'w-heading';
  listHead.textContent = `Customers served (${recap.served})`;
  app.appendChild(listHead);

  if (!recap.visits.length) {
    const empty = document.createElement('div');
    empty.className = 'w-clear';
    empty.innerHTML = '<div>🧾</div><p>No finished tables yet.<br>Each customer shows up here once they pay.</p>';
    app.appendChild(empty);
    return;
  }

  recap.visits.forEach((v) => {
    const d = document.createElement('details');
    d.className = 'w-table seated';
    d.style.borderLeftColor = section.color;
    const key = `visit:${v.id}`;
    if (ui.open.has(key)) d.open = true;
    d.addEventListener('toggle', () => {
      if (d.open) ui.open.add(key);
      else ui.open.delete(key);
    });

    const s = document.createElement('summary');
    s.innerHTML = `
      <span class="w-table-name">Table ${v.tableNumber}</span>
      <span class="w-table-meta">${v.guestName ? escapeHtml(v.guestName) + ' · ' : ''}Tip ${money(v.tip)}</span>
      <span class="w-table-times">
        <span>${clockTimeLabel(v.seatedAt)} → ${clockTimeLabel(v.closedAt)}</span>
        <span class="w-waited">${dur(v.closedAt - v.seatedAt)} at table</span>
        ${v.waitedMs !== null ? `<span>Waited ${dur(v.waitedMs)} for a table</span>` : ''}
      </span>`;
    d.appendChild(s);

    const body = document.createElement('div');
    body.className = 'w-table-body';
    body.appendChild(renderVisitTimeline(v.timeline));
    d.appendChild(body);
    app.appendChild(d);
  });
}

function captureFocus() {
  const el = document.activeElement;
  if (el && el.dataset && el.dataset.focuskey) {
    return { key: el.dataset.focuskey, start: el.selectionStart, end: el.selectionEnd };
  }
  return null;
}
function restoreFocus(f) {
  if (!f) return;
  const el = app.querySelector(`[data-focuskey="${f.key}"]`);
  if (!el) return;
  el.focus({ preventScroll: true });
  try { el.setSelectionRange(f.start, f.end); } catch {}
}

function render() {
  if (!state) return;
  const waiter = state.waiters.find((w) => w.id === waiterId);
  if (!waiter) {
    app.innerHTML = '<p>Unknown waiter.</p>';
    return;
  }
  const section = state.sections.find((s) => s.id === waiter.sectionId);
  waiterNameEl.textContent = waiter.name;
  waiterDot.style.background = section.color;
  sectionPill.textContent = section.name;
  sectionPill.style.background = section.color + '33';
  sectionPill.style.color = section.color;

  if (!getAuth()) {
    logoutBtn.style.display = 'none';
    tipsPill.style.display = 'none';
    ratingPill.style.display = 'none';
    sectionPill.style.visibility = 'hidden';
    tabBar.style.display = 'none';
    StaffMessages.stop();
    clearGreetAlert();
    renderLogin(waiter);
    return;
  }
  sectionPill.style.visibility = 'visible';
  logoutBtn.style.display = 'inline-block';
  tipsPill.style.display = 'inline';
  ratingPill.style.display = 'inline';
  const myTips = (state.tipsTodayBySection && state.tipsTodayBySection[section.id]) || 0;
  tipsPill.textContent = `Tips $${myTips.toFixed(2)}`;
  const myRating = state.ratingsBySection && state.ratingsBySection[section.id];
  ratingPill.textContent = myRating && myRating.count ? `★ ${myRating.avg.toFixed(1)}` : '★ —';

  const myTables = Object.values(state.tables)
    .filter((t) => t.sectionId === section.id)
    .sort((a, b) => a.number - b.number);
  const tasks = buildTasks(section, myTables);
  Alerts.process(tasks.map((t) => ({ key: t.key, text: `${t.icon} ${t.where}: ${t.title}` })));
  updateGreetAlert(tasks);

  StaffMessages.start();
  tabBar.style.display = 'flex';
  const needsYou = tasks.filter((t) => t.group !== 'kitchen').length;
  tabTodo.textContent = needsYou ? `To do (${needsYou})` : 'To do';
  tabTodo.classList.toggle('active', ui.view === 'todo');
  tabRecap.classList.toggle('active', ui.view === 'recap');

  const focus = captureFocus();
  const scrollY = window.scrollY;
  app.innerHTML = '';

  if (ui.view === 'recap') {
    renderRecap(section, myTables);
    if (Math.abs(window.scrollY - scrollY) > 2) window.scrollTo(0, scrollY);
    return;
  }

  // Three sections: finished food/drinks waiting to be picked up come first,
  // then everything else that needs a person, then orders still being made.
  const ready = tasks.filter((t) => t.group === 'ready');
  const todo = tasks.filter((t) => !t.group);
  const cooking = tasks.filter((t) => t.group === 'kitchen');
  const addGroup = (title, list, cls) => {
    if (!list.length) return;
    const h = document.createElement('h2');
    h.className = `w-heading ${cls || ''}`;
    h.textContent = `${title} (${list.length})`;
    app.appendChild(h);
    list.forEach((t) => app.appendChild(taskCard(t)));
  };
  addGroup('🔔 Ready to pick up', ready, 'ready');
  addGroup('To do', todo);
  if (!ready.length && !todo.length) {
    const h = document.createElement('h2');
    h.className = 'w-heading';
    h.textContent = 'To do';
    app.appendChild(h);
    const clear = document.createElement('div');
    clear.className = 'w-clear';
    clear.innerHTML = '<div>✅</div><p>All caught up.<br>New requests show up here.</p>';
    app.appendChild(clear);
  }
  addGroup('👨‍🍳 In the kitchen & bar', cooking);

  const tablesHead = document.createElement('h2');
  tablesHead.className = 'w-heading';
  tablesHead.textContent = 'My tables';
  app.appendChild(tablesHead);
  myTables.forEach((t) => app.appendChild(tableRow(t, section)));

  restoreFocus(focus);
  if (Math.abs(window.scrollY - scrollY) > 2) window.scrollTo(0, scrollY);
}

function renderLogin(waiter) {
  app.innerHTML = `
    <div class="waiting-block" style="max-width:340px; margin:40px auto;">
      <div class="big-emoji">🔒</div>
      <h1>Hi ${escapeHtml(waiter.name)}</h1>
      <p>Enter your 4-digit PIN.</p>
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
      errorEl.textContent = 'Enter your 4-digit PIN.';
      return;
    }
    try {
      const res = await fetch('/api/waiter-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waiterId, pin }),
      });
      const data = await res.json();
      if (!data.ok) {
        errorEl.textContent = data.error || 'Incorrect PIN.';
        input.value = '';
        input.focus();
        return;
      }
      setAuth({ waiterId, token: data.token });
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
