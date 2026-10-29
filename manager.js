const socket = io();
const app = document.getElementById('app');
const logoutBtn = document.getElementById('logoutBtn');

let managerState = null;

const AUTH_KEY = 'tts_manager_auth';

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
  socket.emit('staff:unsubscribe');
  renderLogin();
});

socket.on('manager:state', (s) => {
  managerState = s;
  if (getAuth()) renderDashboard();
});

// --- Private messages to staff ---------------------------------------------
// The panel is built once and re-attached on every dashboard refresh, so a
// half-typed message survives the live updates.
let staffPanel = null;
let staffHistoryEl = null;
let staffHistory = [];

function subscribeStaffMessages() {
  const auth = getAuth();
  if (auth && auth.token) socket.emit('staff:subscribe', { token: auth.token });
}
socket.on('connect', subscribeStaffMessages);
socket.on('staff:messages', (msgs) => {
  staffHistory = msgs;
  renderStaffHistory();
});
socket.on('staff:auth_required', () => {
  clearAuth();
  renderLogin();
});

function renderStaffHistory() {
  if (!staffHistoryEl) return;
  staffHistoryEl.innerHTML = '';
  if (!staffHistory.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-note';
    empty.textContent = 'No messages sent yet.';
    staffHistoryEl.appendChild(empty);
    return;
  }
  staffHistory.slice(0, 8).forEach((m) => {
    const row = document.createElement('div');
    row.className = 'staff-hist-row';
    const head = document.createElement('div');
    head.className = 'staff-hist-head';
    const to = document.createElement('b');
    to.textContent = `To: ${m.toLabel}`;
    const clock = document.createElement('span');
    clock.className = 'order-clock';
    clock.dataset.orderTs = m.ts;
    head.append(to, clock);
    const text = document.createElement('div');
    text.textContent = m.text;
    const seen = document.createElement('div');
    seen.className = 'staff-hist-seen';
    seen.textContent = m.ackedBy.length
      ? `✓ Seen by ${m.ackedBy.join(', ')} (${m.ackedBy.length}/${m.audience})`
      : `Not seen yet (0/${m.audience})`;
    row.append(head, text, seen);
    staffHistoryEl.appendChild(row);
  });
}

// --- Restaurant settings + demo reset ----------------------------------------
// Built once and re-attached on refresh, like the messaging panel, so a name
// being typed isn't wiped by live updates.
let settingsPanel = null;
const settingsEls = {};

function postLogo(body) {
  const auth = getAuth();
  return fetch('/api/logo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: auth && auth.token, ...body }),
  }).then((r) => r.json());
}

// Shrink big photos/logos before upload so they're small and fast.
function logoFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That does not look like an image'));
      img.onload = () => {
        const scale = Math.min(1, 600 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function getSettingsPanel() {
  if (settingsPanel) return settingsPanel;
  const d = document.createElement('details');
  d.className = 'staff-panel';
  settingsPanel = d;

  const sum = document.createElement('summary');
  sum.className = 'staff-panel-title';
  sum.style.cursor = 'pointer';
  sum.innerHTML = '<span>⚙️ Demo &amp; Restaurant Settings</span><span class="pill" style="background:var(--panel-2); color:var(--muted);">Name · logo · alarm timer · reset</span>';
  d.appendChild(sum);

  const body = document.createElement('div');
  body.style.cssText = 'display:flex; flex-direction:column; gap:14px; margin-top:12px;';
  d.appendChild(body);

  const field = (label) => {
    const w = document.createElement('div');
    w.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
    const l = document.createElement('div');
    l.className = 'staff-hist-title';
    l.style.marginTop = '0';
    l.textContent = label;
    w.appendChild(l);
    body.appendChild(w);
    return w;
  };
  const note = (el) => { el.style.cssText = 'font-size:12px; color:var(--muted);'; return el; };

  // Name
  const nameWrap = field('Restaurant name (shown to guests)');
  const nameRow = document.createElement('div');
  nameRow.style.cssText = 'display:flex; gap:8px;';
  const nameInput = document.createElement('input');
  nameInput.className = 'staff-select';
  nameInput.maxLength = 40;
  nameInput.placeholder = 'e.g. Luigi’s Trattoria';
  const nameBtn = document.createElement('button');
  nameBtn.className = 'big-btn';
  nameBtn.style.cssText = 'width:auto; margin:0; padding:10px 20px;';
  nameBtn.textContent = 'Save';
  nameInput.addEventListener('input', () => { nameInput.dataset.dirty = '1'; });
  const saveName = () => {
    const auth = getAuth();
    if (!auth || !nameInput.value.trim()) return;
    socket.emit('manager:update_settings', { token: auth.token, restaurantName: nameInput.value });
    delete nameInput.dataset.dirty;
    nameBtn.textContent = '✓ Saved';
    setTimeout(() => { nameBtn.textContent = 'Save'; }, 1800);
  };
  nameBtn.addEventListener('click', saveName);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveName(); });
  nameRow.append(nameInput, nameBtn);
  nameWrap.appendChild(nameRow);
  settingsEls.name = nameInput;

  // Logo
  const logoWrap = field('Logo (shown on the guest screens)');
  const logoRow = document.createElement('div');
  logoRow.style.cssText = 'display:flex; align-items:center; gap:10px; flex-wrap:wrap;';
  const logoPrev = document.createElement('img');
  logoPrev.style.cssText = 'height:48px; max-width:120px; object-fit:contain; border-radius:6px; background:var(--panel-2); display:none;';
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/png,image/jpeg,image/webp';
  file.style.fontSize = '13px';
  const rm = document.createElement('button');
  rm.className = 'chip';
  rm.textContent = 'Remove logo';
  rm.style.display = 'none';
  const logoMsg = note(document.createElement('div'));
  file.addEventListener('change', async () => {
    if (!file.files[0]) return;
    logoMsg.textContent = 'Uploading…';
    try {
      const res = await postLogo({ dataUrl: await logoFileToDataUrl(file.files[0]) });
      logoMsg.textContent = res.ok ? '✓ Logo updated' : res.error || 'Upload failed';
    } catch (err) {
      logoMsg.textContent = err.message;
    }
    file.value = '';
  });
  rm.addEventListener('click', async () => {
    const res = await postLogo({ remove: true });
    logoMsg.textContent = res.ok ? 'Logo removed' : res.error || 'Could not remove';
  });
  logoRow.append(logoPrev, file, rm);
  logoWrap.append(logoRow, logoMsg);
  settingsEls.logoPrev = logoPrev;
  settingsEls.logoRm = rm;

  // Alarm timer
  const alarmWrap = field('Overdue alarm — flashing light & siren after');
  const alarm = document.createElement('select');
  alarm.className = 'staff-select';
  [[10, '10 minutes (normal)'], [15, '15 minutes'], [5, '5 minutes'], [2, '2 minutes'], [1, '1 minute (live demo)']].forEach(([v, t]) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = t;
    alarm.appendChild(o);
  });
  alarm.addEventListener('change', () => {
    const auth = getAuth();
    if (auth) socket.emit('manager:update_settings', { token: auth.token, alarmMinutes: Number(alarm.value) });
  });
  alarmWrap.append(alarm, note(Object.assign(document.createElement('div'), {
    textContent: 'Also speeds up the green → yellow → red clock colours. Use 1–2 minutes when showing a restaurant, 10 for real service.',
  })));
  settingsEls.alarm = alarm;

  // Demo scene: a full restaurant, so the next guest sees the waiting line + pre-order offer
  const fillWrap = field('Demo: show the waiting line');
  const fillRow = document.createElement('div');
  fillRow.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; align-items:center;';
  const fillSel = document.createElement('select');
  fillSel.className = 'staff-select';
  fillSel.style.width = 'auto';
  [[2, 'first table opens in ~2 min'], [5, 'first table opens in ~5 min'], [10, 'first table opens in ~10 min'], [20, 'first table opens in ~20 min']].forEach(([v, tx]) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = tx;
    fillSel.appendChild(o);
  });
  fillSel.value = '5';
  const fillBtn = document.createElement('button');
  fillBtn.className = 'big-btn';
  fillBtn.style.cssText = 'width:auto; margin:0; padding:12px 22px;';
  fillBtn.textContent = '🍽️ Fill the restaurant';
  const fillMsg = note(document.createElement('div'));
  fillBtn.addEventListener('click', () => {
    const auth = getAuth();
    if (auth) socket.emit('manager:demo_fill', { token: auth.token, openInMin: Number(fillSel.value) });
  });
  socket.on('manager:demo_done', ({ filled, first }) => {
    fillMsg.textContent = filled
      ? `✓ ${filled} tables now busy. A guest checking in will wait about ${first} min. Pre-ordered food reaches the kitchen ~3 min before that.`
      : 'Every table was already taken.';
    setTimeout(() => { fillMsg.textContent = ''; }, 9000);
  });
  fillRow.append(fillSel, fillBtn);
  fillWrap.append(fillRow, fillMsg, note(Object.assign(document.createElement('div'), {
    textContent: 'Pick 2 minutes to show the whole pre-order → kitchen flow live; pick 20 to show a long wait. Use "Reset demo" first for a clean start.',
  })));
  // Reset
  const resetWrap = field('Start fresh');
  const reset = document.createElement('button');
  reset.className = 'big-btn';
  reset.style.cssText = 'width:auto; margin:0; padding:12px 22px; background:#c62828; color:#fff;';
  reset.textContent = '🔄 Reset demo — clear all tables & history';
  const resetMsg = note(document.createElement('div'));
  reset.addEventListener('click', () => {
    if (!confirm('Clear every table, order, request, complaint, rating and message?\n\nStaff logins, customer accounts and these settings are kept.')) return;
    const auth = getAuth();
    if (auth) socket.emit('manager:reset_demo', { token: auth.token });
  });
  socket.on('manager:reset_done', () => {
    resetMsg.textContent = '✓ Everything cleared — ready for the next demo';
    setTimeout(() => { resetMsg.textContent = ''; }, 4000);
  });
  resetWrap.append(reset, resetMsg);

  return d;
}

function syncSettingsPanel(s) {
  if (!settingsPanel || !s) return;
  if (!settingsEls.name.dataset.dirty && document.activeElement !== settingsEls.name) settingsEls.name.value = s.restaurantName;
  if (document.activeElement !== settingsEls.alarm) settingsEls.alarm.value = String(s.alarmMinutes);
  settingsEls.logoPrev.style.display = s.logo ? 'block' : 'none';
  if (s.logo) settingsEls.logoPrev.src = s.logo;
  settingsEls.logoRm.style.display = s.logo ? 'inline-block' : 'none';
}

function getStaffPanel(waiters) {
  if (staffPanel) return staffPanel;
  staffPanel = document.createElement('div');
  staffPanel.className = 'staff-panel';

  const title = document.createElement('div');
  title.className = 'staff-panel-title';
  title.innerHTML = '<span>📢 Message Staff</span><span class="pill" style="background:var(--panel-2); color:var(--muted);">Private — customers never see this</span>';
  staffPanel.appendChild(title);

  const select = document.createElement('select');
  select.className = 'staff-select';
  const options = [
    ['all', 'Everyone (all staff)'],
    ['waiters', 'All waiters'],
    ['kitchen', 'Kitchen'],
    ['bartender', 'Bar'],
    ...waiters.map((w) => [`waiter:${w.id}`, `${w.name} (waiter)`]),
  ];
  options.forEach(([value, label]) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    select.appendChild(o);
  });
  staffPanel.appendChild(select);

  const input = document.createElement('textarea');
  input.className = 'staff-input';
  input.maxLength = 300;
  input.rows = 2;
  input.placeholder = 'Type a message to your team…';
  staffPanel.appendChild(input);

  const chips = document.createElement('div');
  chips.className = 'chip-row';
  ['Please check in on your tables', 'Quick huddle at the host stand', 'Great work, team! 👏'].forEach((text) => {
    const c = document.createElement('button');
    c.className = 'chip';
    c.textContent = text;
    c.addEventListener('click', () => { input.value = text; input.focus(); });
    chips.appendChild(c);
  });
  staffPanel.appendChild(chips);

  const sendRow = document.createElement('div');
  sendRow.style.cssText = 'display:flex; align-items:center; gap:10px;';
  const sendBtn = document.createElement('button');
  sendBtn.className = 'big-btn';
  sendBtn.style.cssText = 'width:auto; padding:12px 24px; margin:0;';
  sendBtn.textContent = 'Send message';
  const status = document.createElement('span');
  status.style.cssText = 'font-size:13px; color:var(--good);';
  sendBtn.addEventListener('click', () => {
    const text = input.value.trim();
    const auth = getAuth();
    if (!text || !auth) return;
    socket.emit('manager:send_staff_message', { token: auth.token, to: select.value, text });
    input.value = '';
    status.textContent = '✓ Sent';
    setTimeout(() => { status.textContent = ''; }, 2500);
  });
  sendRow.append(sendBtn, status);
  staffPanel.appendChild(sendRow);

  const histTitle = document.createElement('div');
  histTitle.className = 'staff-hist-title';
  histTitle.textContent = 'Recent messages';
  staffPanel.appendChild(histTitle);
  staffHistoryEl = document.createElement('div');
  staffPanel.appendChild(staffHistoryEl);
  renderStaffHistory();
  return staffPanel;
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUS_LABEL = {
  empty: 'Empty',
  needs_greeting: 'Needs Greeting',
  seated: 'Seated',
};

function init() {
  if (getAuth()) {
    socket.emit('manager:subscribe');
    subscribeStaffMessages();
    app.innerHTML = '<p class="empty-note">Loading…</p>';
  } else {
    renderLogin();
  }
}

function renderLogin() {
  logoutBtn.style.display = 'none';
  app.className = '';
  app.innerHTML = `
    <div class="waiting-block" style="max-width:340px; margin:40px auto;">
      <div class="big-emoji">🔒</div>
      <h1>Manager Login</h1>
      <p>Enter the manager PIN to view the floor.</p>
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
      const res = await fetch('/api/manager-login', {
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
      init();
    } catch {
      errorEl.textContent = 'Could not reach the server. Try again.';
    }
  }

  document.getElementById('pinSubmit').addEventListener('click', attemptLogin);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') attemptLogin();
  });
}

function renderDashboard() {
  logoutBtn.style.display = 'inline-block';
  const { sections, tables, requestTypes, seatTypes, complaints, waitlist, stats, analytics, suggestions, recentVisits } = managerState;

  Alerts.process([
    ...(complaints || []).filter((c) => c.status === 'open').map((c) => ({
      key: `cmp:${c.id}`,
      text: `🚩 Complaint at Table ${c.tableNumber}: ${c.message}`,
    })),
    ...(waitlist || []).filter((w) => w.status === 'waiting').map((w) => ({
      key: `wl:${w.id}`,
      text: `🚪 New party at the door (${w.partySize || 1})`,
    })),
    ...(suggestions || []).filter((s) => !s.archived).map((s) => ({
      key: `sg:${s.id}`,
      text: '💡 New anonymous suggestion',
    })),
    ...Object.values(tables).flatMap((t) =>
      t.requests
        .filter((r) => r.type === 'bathroom' && r.status !== 'done')
        .map((r) => ({ key: `bath:${r.id}`, text: `🚻 Bathroom maintenance needed — reported from Table ${t.number}` }))
    ),
  ]);

  // Keep the compose box usable across live refreshes (focus + caret).
  const typing = [staffPanel, settingsPanel].find((p) => p && p.contains(document.activeElement)) ? document.activeElement : null;
  const caret = typing && typing.selectionStart !== undefined ? [typing.selectionStart, typing.selectionEnd] : null;

  // Keep the cursor in a reply box while the screen refreshes live.
  const activeKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.focuskey : null;
  const activeSel = activeKey ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;

  app.innerHTML = '';
  app.className = '';
  app.style.padding = '20px';

  const allTables = Object.values(tables);
  const occupied = allTables.filter((t) => t.status !== 'empty').length;
  const openRequests = allTables.reduce(
    (sum, t) => sum + t.requests.filter((r) => r.status === 'open' || r.status === 'accepted').length,
    0
  );

  // Bathroom maintenance: a flashing red bar at the very top until someone handles it.
  const bathroomReqs = allTables.flatMap((t) =>
    t.requests.filter((r) => r.type === 'bathroom' && r.status !== 'done').map((r) => ({ t, r }))
  );
  bathroomReqs.forEach(({ t, r }) => {
    const section = sections.find((s) => s.id === t.sectionId);
    const bar = document.createElement('div');
    bar.className = 'bathroom-banner flash-red';
    const info = document.createElement('div');
    info.className = 'bathroom-banner-text';
    info.innerHTML = `<b>🚻 Bathroom maintenance needed</b> <span>reported from Table ${t.number}${section ? ' · ' + escapeHtml(section.name) : ''}${r.status === 'accepted' ? ' · someone is on it' : ''}</span>`;
    const clock = document.createElement('span');
    clock.className = 'order-clock';
    clock.dataset.orderTs = r.ts;
    clock.dataset.alarm = '1';
    info.appendChild(clock);
    const btn = document.createElement('button');
    btn.textContent = '✓ Handled';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      socket.emit('waiter:resolve_request', { tableId: t.id, requestId: r.id });
    });
    bar.append(info, btn);
    app.appendChild(bar);
  });

  const statRow = document.createElement('div');
  statRow.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:24px;';
  const stats_ = [
    { label: 'Tables Occupied', value: `${occupied}/${allTables.length}` },
    { label: 'Open Requests', value: openRequests },
    { label: "Today's Revenue", value: `$${stats.revenueToday.toFixed(2)}` },
    { label: 'Bills Closed Today', value: stats.billsClosedToday },
  ];
  stats_.forEach((s) => {
    const tile = document.createElement('div');
    tile.style.cssText = 'background:var(--panel); border:1px solid var(--border); border-radius:14px; padding:16px;';
    tile.innerHTML = `<div style="color:var(--muted); font-size:12px; text-transform:uppercase; font-weight:700; margin-bottom:6px;">${s.label}</div><div style="font-size:24px; font-weight:800;">${s.value}</div>`;
    statRow.appendChild(tile);
  });
  app.appendChild(statRow);

  app.appendChild(renderRequestsBoard(tables, sections, requestTypes));
  app.appendChild(renderSeatingPanel(waitlist || [], tables, sections, seatTypes, recentVisits || []));

  app.appendChild(getSettingsPanel());
  syncSettingsPanel(managerState.settings);
  app.appendChild(getStaffPanel(managerState.waiters || []));
  if (typing) {
    typing.focus({ preventScroll: true });
    if (caret) { try { typing.setSelectionRange(caret[0], caret[1]); } catch {} }
  }

  const mapTitle = document.createElement('div');
  mapTitle.style.cssText = 'font-weight:800; font-size:16px; margin-bottom:10px;';
  mapTitle.textContent = '🗺️ Floor Map';
  app.appendChild(mapTitle);
  const mapBox = document.createElement('div');
  FloorMap.render(mapBox, { tables, sections, seatTypes, complaints, requestTypes }, {});
  app.appendChild(mapBox);

  app.appendChild(renderAnalytics(analytics, sections));
  app.appendChild(renderFeedbackPanel(analytics, suggestions || []));
  app.appendChild(renderVisitLogPanel(recentVisits || [], sections));
  app.appendChild(renderWaitlistPanel(waitlist || [], seatTypes, tables, sections));
  app.appendChild(renderComplaintsPanel(complaints || [], sections, tables));

  sections.forEach((section) => {
    const block = document.createElement('div');
    block.style.marginBottom = '24px';

    const heading = document.createElement('div');
    heading.style.cssText = 'display:flex; align-items:center; gap:8px; margin-bottom:10px;';
    heading.innerHTML = `<span class="color-dot" style="background:${section.color}"></span><span style="font-weight:800; font-size:16px;">${section.name}</span>`;
    block.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'waiter-main';
    grid.style.padding = '0';

    Object.values(tables)
      .filter((t) => t.sectionId === section.id)
      .sort((a, b) => a.number - b.number)
      .forEach((table) => grid.appendChild(renderTableCard(table, section, requestTypes, seatTypes, complaints || [])));

    block.appendChild(grid);
    app.appendChild(block);
  });

  // Put the cursor back in the reply box the manager was typing in.
  if (activeKey) {
    const el = app.querySelector(`[data-focuskey="${activeKey}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (activeSel) { try { el.setSelectionRange(activeSel[0], activeSel[1]); } catch {} }
    }
  }
}

function fmtDuration(secs) {
  return durationLabel(Math.round(secs || 0) * 1000); // shared format from ordertimer.js
}

function renderAnalytics(a, sections) {
  const wrap = document.createElement('div');
  wrap.style.marginBottom = '24px';
  const fmt = (n) => (n < 10 ? n.toFixed(1) : Math.round(n));
  const money = (n) => `$${n.toFixed(2)}`;

  const tiles = [
    { label: 'Avg Ticket', value: money(a.avgTicket) },
    { label: 'Avg Table Time', value: fmtDuration(a.avgTurnMins * 60) },
    { label: 'Avg Request Response', value: fmtDuration(a.avgResponseSecs) },
    { label: 'Avg Request Completion', value: fmtDuration(a.avgCompletionSecs) },
    { label: 'Kitchen Prep Time', value: fmtDuration(a.avgFoodPrepMins * 60) },
    { label: 'Bar Prep Time', value: fmtDuration(a.avgDrinkPrepMins * 60) },
    { label: 'Requests Handled', value: a.requestsHandled },
  ];
  const tileRow = document.createElement('div');
  tileRow.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:16px;';
  tiles.forEach((t) => {
    const el = document.createElement('div');
    el.style.cssText = 'background:var(--panel); border:1px solid var(--border); border-radius:14px; padding:14px;';
    el.innerHTML = `<div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700; margin-bottom:4px;">${t.label}</div><div style="font-size:20px; font-weight:800;">${t.value}</div>`;
    tileRow.appendChild(el);
  });

  const heading = document.createElement('div');
  heading.style.cssText = 'font-weight:800; font-size:16px; margin-bottom:10px;';
  heading.textContent = '📊 Today\'s Analytics';
  wrap.appendChild(heading);
  wrap.appendChild(tileRow);

  const cols = document.createElement('div');
  cols.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:12px;';

  const panel = (title) => {
    const p = document.createElement('div');
    p.style.cssText = 'background:var(--panel); border:1px solid var(--border); border-radius:14px; padding:16px;';
    p.innerHTML = `<div class="section-title">${title}</div>`;
    return p;
  };
  const bars = (rows) => {
    const max = Math.max(...rows.map((r) => r.value), 1);
    return rows
      .map(
        (r) => `<div class="bar-row"><div class="bar-label">${r.label}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${(r.value / max) * 100}%; ${r.color ? `background:${r.color};` : ''}"></div></div>
          <div class="bar-val">${r.text}</div></div>`
      )
      .join('');
  };

  const top = panel('Top items');
  top.innerHTML += a.topItems.length
    ? bars(a.topItems.map((i) => ({ label: i.name, value: i.qty, text: `${i.qty} sold` })))
    : '<div class="empty-note" style="padding:8px 0;">No sales yet today.</div>';
  cols.appendChild(top);

  const sec = panel('Revenue by section');
  sec.innerHTML += bars(
    sections.map((s) => ({ label: s.name, value: a.revenueBySection[s.id] || 0, text: money(a.revenueBySection[s.id] || 0), color: s.color }))
  );
  cols.appendChild(sec);

  const hours = panel('Revenue by hour');
  const maxH = Math.max(...a.revenueByHour, 1);
  hours.innerHTML += `<div class="hour-chart">${a.revenueByHour
    .map((v, h) => `<div class="hour-col ${v ? '' : 'zero'}" style="height:${v ? Math.max(6, (v / maxH) * 100) : 3}%" title="${h}:00 — ${money(v)}"></div>`)
    .join('')}</div><div class="hour-axis"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>11p</span></div>`;
  cols.appendChild(hours);

  const reqTypes = Object.entries(a.requestsByType);
  const req = panel('Requests handled');
  req.innerHTML += reqTypes.length
    ? bars(reqTypes.map(([type, n]) => ({ label: type, value: n, text: String(n) })))
    : '<div class="empty-note" style="padding:8px 0;">No requests yet today.</div>';
  cols.appendChild(req);

  const recent = panel('Recent requests');
  if (!a.recentRequests || !a.recentRequests.length) {
    recent.innerHTML += '<div class="empty-note" style="padding:8px 0;">No requests completed yet today.</div>';
  } else {
    const list = document.createElement('div');
    list.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
    a.recentRequests.forEach((r) => {
      const section = sections.find((s) => s.id === r.sectionId);
      const row = document.createElement('div');
      row.style.cssText = `background:var(--panel-2); border-left:3px solid ${section ? section.color : 'var(--border)'}; border-radius:8px; padding:8px 10px; font-size:12px;`;
      row.innerHTML = `<div style="font-weight:700; margin-bottom:2px;">Table ${r.tableNumber} — ${r.label}</div>` +
        `<div style="color:var(--muted);">Response: ${fmtDuration(r.responseSecs)} · Completion: ${fmtDuration(r.completionSecs)}</div>`;
      list.appendChild(row);
    });
    recent.appendChild(list);
  }
  cols.appendChild(recent);

  wrap.appendChild(cols);
  return wrap;
}

// VISIT_EVENT_META comes from the shared ordertimer.js.
function renderVisitLogPanel(visits, sections) {
  const wrap = document.createElement('div');
  wrap.style.marginBottom = '24px';

  const heading = document.createElement('div');
  heading.style.cssText = 'display:flex; align-items:center; gap:8px; margin-bottom:10px;';
  heading.innerHTML = `<span style="font-weight:800; font-size:16px;">🕒 Visit Timelines</span>` +
    `<span class="pill" style="background:var(--panel-2); color:var(--muted);">${visits.length} today</span>`;
  wrap.appendChild(heading);

  if (!visits.length) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'No completed visits yet today — the full timeline appears here once a table pays and closes out.';
    wrap.appendChild(note);
    return wrap;
  }

  const timeOf = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  visits.forEach((v) => {
    const section = sections.find((s) => s.id === v.sectionId);
    const details = document.createElement('details');
    details.style.cssText = `background:var(--panel); border:1px solid var(--border); border-left:4px solid ${section ? section.color : 'var(--border)'}; border-radius:12px; padding:10px 14px; margin-bottom:8px;`;

    const totalLabel = v.seatedAt ? durationLabel(v.closedAt - v.seatedAt) : null;
    const summary = document.createElement('summary');
    summary.style.cssText = 'cursor:pointer; font-weight:700; font-size:13px; display:flex; justify-content:space-between; gap:10px;';
    summary.innerHTML = `<span>Table ${v.tableNumber}${v.guestName ? ' — ' + escapeHtmlLite(v.guestName) : ''} <span style="color:var(--muted); font-weight:400;">(${section ? section.name : ''})</span></span>` +
      `<span style="color:var(--muted); font-weight:400;">${timeOf(v.seatedAt)}–${timeOf(v.closedAt)}${totalLabel !== null ? ` · ${totalLabel}` : ''}</span>`;
    details.appendChild(summary);

    const list = document.createElement('div');
    list.style.cssText = 'margin-top:10px; display:flex; flex-direction:column; gap:6px;';
    let prevTs = v.seatedAt;
    (v.timeline || []).forEach((ev) => {
      const meta = VISIT_EVENT_META[ev.event] || { icon: '•', label: ev.event };
      const sincePrev = prevTs ? Math.max(0, Math.round((ev.ts - prevTs) / 1000)) : null;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; justify-content:space-between; gap:10px; font-size:12px; padding:4px 0; border-bottom:1px dashed var(--border);';
      row.innerHTML = `<span>${meta.icon} ${meta.label}${ev.detail ? ` — <span style="color:var(--muted);">${escapeHtmlLite(ev.detail)}</span>` : ''}</span>` +
        `<span style="color:var(--muted); white-space:nowrap;">${timeOf(ev.ts)}${sincePrev !== null ? ` (+${fmtDuration(sincePrev)})` : ''}</span>`;
      list.appendChild(row);
      prevTs = ev.ts;
    });
    details.appendChild(list);
    wrap.appendChild(details);
  });

  return wrap;
}

function escapeHtmlLite(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderFeedbackPanel(a, suggestions) {
  const wrap = document.createElement('div');
  wrap.style.marginBottom = '24px';
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
  const card = 'background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:12px 14px;';

  const open = suggestions.filter((s) => !s.archived);
  const heading = document.createElement('div');
  heading.style.cssText = 'display:flex; align-items:center; gap:8px; margin-bottom:10px;';
  heading.innerHTML = `<span style="font-weight:800; font-size:16px;">⭐ Service Ratings &amp; 💡 Suggestions</span>` +
    `<span class="pill" style="background:var(--panel-2); color:#f5c542;">${a.ratingCount ? `${a.avgRating.toFixed(1)} avg · ${a.ratingCount} today` : 'no ratings yet'}</span>` +
    `<span class="pill" style="background:${open.length ? 'rgba(244,162,97,0.2)' : 'var(--panel-2)'}; color:${open.length ? 'var(--warn)' : 'var(--muted)'};">${open.length} new</span>`;
  wrap.appendChild(heading);

  const cols = document.createElement('div');
  cols.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:12px;';

  const left = document.createElement('div');
  left.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
  left.innerHTML = '<div class="section-title" style="margin-bottom:0;">Recent ratings</div>';
  if (!a.recentRatings.length) left.innerHTML += '<div class="empty-note" style="padding:8px 0;">No ratings yet today.</div>';
  a.recentRatings.forEach((r) => {
    const row = document.createElement('div');
    row.style.cssText = card;
    row.innerHTML = `<div style="color:#f5c542; letter-spacing:2px;">${stars(r.stars)} <span style="color:var(--muted); font-size:12px; letter-spacing:0;">service · Table ${r.tableNumber}</span>${r.food ? ` <span style="color:var(--muted); font-size:12px; letter-spacing:0;">· food ${stars(r.food)}</span>` : ''}${r.wouldReturn ? ` <span style="font-size:12px; letter-spacing:0; color:${r.wouldReturn === 'yes' ? 'var(--good)' : r.wouldReturn === 'no' ? 'var(--danger)' : 'var(--warn)'};">· would ${r.wouldReturn === 'yes' ? 'return' : r.wouldReturn === 'no' ? 'NOT return' : 'maybe return'}</span>` : ''}</div>` +
      (r.comment ? `<div style="color:var(--muted); font-size:13px; margin-top:4px;"></div>` : '');
    if (r.comment) row.lastChild.textContent = r.comment;
    left.appendChild(row);
  });
  cols.appendChild(left);

  const right = document.createElement('div');
  right.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
  right.innerHTML = '<div class="section-title" style="margin-bottom:0;">Anonymous suggestion box</div>';
  if (!open.length) right.innerHTML += '<div class="empty-note" style="padding:8px 0;">No new suggestions.</div>';
  open.forEach((s) => {
    const row = document.createElement('div');
    row.style.cssText = card + ' display:flex; gap:12px; align-items:flex-start; justify-content:space-between;';
    const text = document.createElement('div');
    text.style.cssText = 'font-size:13px; color:var(--text);';
    text.textContent = s.message;
    const btn = document.createElement('button');
    btn.textContent = 'Archive';
    btn.style.cssText = 'background:var(--panel-2); border:1px solid var(--border); color:var(--text); padding:6px 10px; border-radius:8px; font-size:11px; font-weight:700;';
    btn.addEventListener('click', () => socket.emit('suggestion:archive', { suggestionId: s.id }));
    row.appendChild(text);
    row.appendChild(btn);
    right.appendChild(row);
  });
  cols.appendChild(right);

  wrap.appendChild(cols);
  return wrap;
}

function renderWaitlistPanel(waitlist, seatTypes, tables, sections) {
  const wrap = document.createElement('div');
  wrap.style.marginBottom = '24px';

  const waiting = waitlist.filter((w) => w.status === 'waiting');
  const heading = document.createElement('div');
  heading.style.cssText = 'display:flex; align-items:center; gap:8px; margin-bottom:10px;';
  heading.innerHTML = `<span style="font-weight:800; font-size:16px;">🚪 Waitlist</span><span class="pill" style="background:${waiting.length ? 'rgba(244,162,97,0.2)' : 'var(--panel-2)'}; color:${waiting.length ? 'var(--warn)' : 'var(--muted)'};">${waiting.length} waiting</span>`;
  wrap.appendChild(heading);

  if (waiting.length === 0) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'No one checked in at the door right now.';
    wrap.appendChild(note);
    return wrap;
  }

  waiting.forEach((entry) => {
    const meta = seatTypes[entry.seatType];
    const card = document.createElement('div');
    card.className = 'waitlist-card';

    const left = document.createElement('div');
    left.innerHTML = `<div class="who">${entry.guestName ? `<strong>${escapeHtml(entry.guestName)}</strong> · ` : ''}${meta.icon} ${meta.label} wanted — party of ${entry.partySize || 1}</div><div class="wait-time">Waiting <span class="order-clock" data-order-ts="${entry.ts}" data-alarm="1"></span>${entry.queue ? ` · #${entry.queue.position} in line` + (entry.queue.estSeatAt ? ` · table expected ${new Date(entry.queue.estSeatAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '') : ''}</div>${entry.preorder ? `<div class="wait-time" style="color:var(--good);">🥡 Pre-ordered · half paid ($${entry.preorder.deposit.toFixed(2)} of $${entry.preorder.subtotal.toFixed(2)}) · food ${entry.preorder.foodStatus === 'held' ? 'held until ~3 min before the table' : (entry.preorder.foodStatus || 'drinks only')}</div>` : ''}`;
    card.appendChild(left);

    const matches = Object.values(tables).filter((t) => t.status === 'empty' && t.seatType === entry.seatType);
    const actions = document.createElement('div');
    actions.className = 'seat-actions';
    if (matches.length === 0) {
      actions.innerHTML = `<span class="no-match">No open ${meta.label.toLowerCase()} anywhere</span>`;
    } else {
      matches.forEach((t) => {
        const section = sections.find((s) => s.id === t.sectionId);
        const btn = document.createElement('button');
        btn.textContent = `Seat at Table ${t.number} (${section.name})`;
        btn.addEventListener('click', () => socket.emit('waiter:seat_from_waitlist', { waitlistId: entry.id, tableId: t.id }));
        actions.appendChild(btn);
      });
    }
    card.appendChild(actions);
    wrap.appendChild(card);
  });

  return wrap;
}

function renderComplaintsPanel(complaints, sections, tables) {
  const wrap = document.createElement('div');
  wrap.style.marginBottom = '24px';

  const openOnes = complaints.filter((c) => c.status === 'open');
  const heading = document.createElement('div');
  heading.style.cssText = 'display:flex; align-items:center; gap:8px; margin-bottom:10px;';
  heading.innerHTML = `<span style="font-weight:800; font-size:16px;">🚩 Complaints</span><span class="pill" style="background:${openOnes.length ? 'rgba(230,57,70,0.2)' : 'var(--panel-2)'}; color:${openOnes.length ? 'var(--danger)' : 'var(--muted)'};">${openOnes.length} open</span>`;
  wrap.appendChild(heading);

  if (complaints.length === 0) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'No complaints reported.';
    wrap.appendChild(note);
    return wrap;
  }

  const list = document.createElement('div');
  list.style.cssText = 'display:flex; flex-direction:column; gap:8px;';

  complaints
    .slice()
    .sort((a, b) => (a.status === b.status ? b.ts - a.ts : a.status === 'open' ? -1 : 1))
    .forEach((c) => {
      const section = sections.find((s) => s.id === c.sectionId);
      const row = document.createElement('div');
      row.style.cssText = `background:var(--panel); border:1px solid var(--border); border-left:4px solid ${section ? section.color : 'var(--border)'}; border-radius:12px; padding:12px 14px; display:flex; align-items:center; justify-content:space-between; gap:12px;`;
      row.innerHTML = `
        <div>
          <div style="font-weight:700; font-size:13px; margin-bottom:2px; display:flex; align-items:center; gap:8px;">Table ${c.tableNumber} — ${section ? section.name : ''} <span class="order-clock" data-order-ts="${c.ts}"${c.status === 'open' ? ' data-alarm="1"' : ''}></span></div>
          <div style="color:var(--muted); font-size:13px;">${escapeHtml(c.message)}</div>
        </div>`;
      if (c.status === 'open') {
        const btn = document.createElement('button');
        btn.textContent = 'Mark Resolved';
        btn.style.cssText = 'background:var(--panel-2); border:1px solid var(--border); color:var(--text); padding:8px 12px; border-radius:8px; font-size:12px; font-weight:700; white-space:nowrap;';
        btn.addEventListener('click', () => socket.emit('complaint:resolve', { complaintId: c.id }));
        row.appendChild(btn);
      } else {
        const tag = document.createElement('div');
        tag.className = 'status-tag delivered';
        tag.textContent = 'resolved';
        row.appendChild(tag);
      }
      list.appendChild(row);

      // What the manager has already told this guest, and a box to write back
      if (c.replies && c.replies.length) {
        c.replies.forEach((r) => {
          const sent = document.createElement('div');
          sent.className = 'mgr-reply-sent';
          sent.innerHTML = `↩ You replied: <b>${escapeHtml(r.text)}</b> <span class="order-clock" data-order-ts="${r.ts}"></span>`;
          list.appendChild(sent);
        });
      }
      if (c.status === 'open') {
        const t = tables[c.tableId];
        if (t && t.status === 'seated') {
          list.appendChild(replyBox(c.tableId, c.id));
        } else {
          const gone = document.createElement('div');
          gone.className = 'mgr-reply-sent';
          gone.textContent = 'The guest has left the table, so a reply cannot be delivered.';
          list.appendChild(gone);
        }
      }
    });

  wrap.appendChild(list);
  return wrap;
}

const mgrOpen = new Set(); // which table timelines the manager has open (survives live refreshes)
const mgrDrafts = {}; // half-typed replies, kept across live refreshes

// Ready-made replies; tapping one fills the box so the manager can tweak it before sending.
const QUICK_REPLIES = [
  "I'm on my way to your table right now.",
  "I'm so sorry about that. I'm coming over to make it right.",
  'Thank you for telling us. We are fixing it right now.',
];

// A small compose box that sends a message to the guest at this table. Used on complaints and table cards.
function replyBox(tableId, complaintId) {
  const key = complaintId ? `c:${complaintId}` : `t:${tableId}`;
  const box = document.createElement('div');
  box.className = 'mgr-reply';

  const chips = document.createElement('div');
  chips.className = 'chip-row';
  const row = document.createElement('div');
  row.className = 'mgr-reply-row';
  const input = document.createElement('input');
  input.className = 'staff-select';
  input.maxLength = 300;
  input.placeholder = 'Write back to the guest…';
  input.dataset.focuskey = `reply:${key}`;
  input.value = mgrDrafts[key] || '';
  input.addEventListener('input', () => { mgrDrafts[key] = input.value; });

  QUICK_REPLIES.forEach((text) => {
    const c = document.createElement('button');
    c.className = 'chip';
    c.textContent = text;
    c.addEventListener('click', () => { input.value = text; mgrDrafts[key] = text; input.focus(); });
    chips.appendChild(c);
  });

  const send = document.createElement('button');
  send.className = 'big-btn';
  send.style.cssText = 'width:auto; margin:0; padding:10px 18px;';
  send.textContent = 'Send to guest';
  const status = document.createElement('span');
  status.className = 'mgr-reply-status';
  const go = () => {
    const text = input.value.trim();
    const auth = getAuth();
    if (!text || !auth) return;
    socket.emit('manager:message_guest', { token: auth.token, tableId, text, complaintId });
    input.value = '';
    mgrDrafts[key] = '';
    status.textContent = '✓ Sent';
  };
  send.addEventListener('click', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  row.append(input, send);
  box.append(chips, row, status);
  return box;
}

// Everything guests are asking for or waiting on right now, oldest first.
function renderRequestsBoard(tables, sections, requestTypes) {
  const wrap = document.createElement('div');
  wrap.className = 'mgr-panel';
  const reqs = [];
  const orders = [];
  Object.values(tables).forEach((t) => {
    t.requests.filter((r) => r.status === 'open' || r.status === 'accepted').forEach((r) => reqs.push({ t, r }));
    [...t.drinkOrders.map((o) => ({ o, icon: '🥤' })), ...t.foodOrders.map((o) => ({ o, icon: '🍔' }))]
      .filter(({ o }) => o.status !== 'delivered')
      .forEach(({ o, icon }) => orders.push({ t, o, icon }));
  });
  reqs.sort((a, b) => a.r.ts - b.r.ts);
  orders.sort((a, b) => a.o.ts - b.o.ts);

  const head = document.createElement('div');
  head.className = 'mgr-panel-head';
  head.innerHTML = `<b>📣 What guests are asking for</b><span class="pill" style="background:var(--panel-2); color:var(--muted);">${reqs.length} request${reqs.length === 1 ? '' : 's'} · ${orders.length} order${orders.length === 1 ? '' : 's'} open</span>`;
  wrap.appendChild(head);

  if (!reqs.length && !orders.length) {
    const n = document.createElement('div');
    n.className = 'empty-note';
    n.textContent = 'Nothing waiting. New requests and orders show up here the moment a guest sends them.';
    wrap.appendChild(n);
    return wrap;
  }

  const row = (t, icon, text, status, ts, extraClock) => {
    const section = sections.find((s) => s.id === t.sectionId);
    const r = document.createElement('div');
    r.className = 'mgr-row';
    r.style.borderLeftColor = section ? section.color : 'var(--border)';
    r.innerHTML = `<div class="mgr-row-main"><b>Table ${t.number}</b> <span class="mgr-sec">${section ? escapeHtml(section.name) : ''}${t.guestName ? ' · ' + escapeHtml(t.guestName) : ''}</span><div class="mgr-row-what">${icon} ${escapeHtml(text)}</div></div>` +
      `<div class="mgr-row-side"><span class="mgr-status">${status}</span><span class="order-clock" data-order-ts="${ts}" data-alarm="1"></span>${extraClock || ''}</div>`;
    return r;
  };

  reqs.forEach(({ t, r }) => {
    const meta = requestTypes[r.type] || { icon: '•', label: r.type };
    const text = r.type === 'special' ? `Special request: ${r.message}` : r.type === 'bill' ? 'Wants the bill' : meta.label + (meta.hint ? ` — ${meta.hint}` : '');
    wrap.appendChild(row(t, meta.icon, text, r.status === 'accepted' ? '👀 waiter is on it' : '⏳ not seen yet', r.ts,
      r.acceptedAt ? `<span class="mgr-sub">seen <span class="order-clock" data-order-ts="${r.acceptedAt}"></span></span>` : ''));
  });
  orders.forEach(({ t, o, icon }) => {
    const items = o.items.map((i) => `${i.qty}× ${i.name}${i.note ? ` (${i.note})` : ''}`).join(', ');
    const where = icon === '🥤' ? 'bar' : 'kitchen';
    wrap.appendChild(row(t, icon, items + (o.preorder ? ' (pre-order)' : ''), `${where}: ${o.status}`, o.ts));
  });
  return wrap;
}

// Who walked in, how long they waited for a table, and when they were seated.
function renderSeatingPanel(waitlist, tables, sections, seatTypes, recentVisits) {
  const wrap = document.createElement('div');
  wrap.className = 'mgr-panel';
  const waiting = waitlist.filter((w) => w.status === 'waiting');
  const seatedNow = Object.values(tables)
    .filter((t) => t.status === 'seated' || t.status === 'needs_greeting')
    .sort((a, b) => (b.seatedAt || b.arrivedAt || 0) - (a.seatedAt || a.arrivedAt || 0));
  const waits = [
    ...seatedNow.filter((t) => t.arrivedAt && t.seatedAt).map((t) => t.seatedAt - t.arrivedAt),
    ...recentVisits.filter((v) => v.arrivedAt && v.seatedAt).map((v) => v.seatedAt - v.arrivedAt),
  ];
  const avg = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null;

  const head = document.createElement('div');
  head.className = 'mgr-panel-head';
  head.innerHTML = `<b>🪑 Seating &amp; wait times</b><span class="pill" style="background:var(--panel-2); color:var(--muted);">${waiting.length} waiting · avg wait ${avg === null ? '—' : durationLabel(avg)}</span>`;
  wrap.appendChild(head);

  const line = (cls, html, color) => {
    const r = document.createElement('div');
    r.className = 'mgr-row ' + cls;
    if (color) r.style.borderLeftColor = color;
    r.innerHTML = html;
    wrap.appendChild(r);
  };
  const sub = (txt) => {
    const h = document.createElement('div');
    h.className = 'mgr-sub-head';
    h.textContent = txt;
    wrap.appendChild(h);
  };

  if (waiting.length) {
    sub('Waiting for a table now');
    waiting.forEach((w) => {
      const meta = seatTypes[w.seatType];
      const q = w.queue;
      line('waiting',
        `<div class="mgr-row-main"><b>${escapeHtml(w.guestName || 'Guest')}</b> · party of ${w.partySize || 1} · ${meta.icon} ${meta.label}` +
        `<div class="mgr-row-what">Arrived ${clockTimeLabel(w.ts)}${q ? ` · #${q.position} in line` : ''}${q && q.estSeatAt ? ` · table expected ${clockTimeLabel(q.estSeatAt)}` : ''}` +
        `${w.preorder ? ` · 🥡 pre-ordered, half paid ($${w.preorder.deposit.toFixed(2)})` : ''}</div></div>` +
        `<div class="mgr-row-side"><span class="mgr-status">waiting</span><span class="order-clock" data-order-ts="${w.ts}" data-alarm="1"></span></div>`);
    });
  }

  sub('Seated');
  if (!seatedNow.length) {
    const n = document.createElement('div');
    n.className = 'empty-note';
    n.textContent = 'Nobody is seated yet.';
    wrap.appendChild(n);
  }
  seatedNow.forEach((t) => {
    const section = sections.find((s) => s.id === t.sectionId);
    const waited = t.arrivedAt && t.seatedAt ? durationLabel(t.seatedAt - t.arrivedAt) : '—';
    line('seated',
      `<div class="mgr-row-main"><b>${escapeHtml(t.guestName || 'Guest')}</b> · Table ${t.number}${t.partySize ? ` · party of ${t.partySize}` : ''} <span class="mgr-sec">${section ? escapeHtml(section.name) : ''}</span>` +
      `<div class="mgr-row-what">${t.arrivedAt ? `Arrived ${clockTimeLabel(t.arrivedAt)} · ` : ''}${t.seatedAt ? `Seated ${clockTimeLabel(t.seatedAt)}` : 'not greeted yet'}</div></div>` +
      `<div class="mgr-row-side"><span class="mgr-status">${t.seatedAt ? `waited ${waited}` : 'at the door'}</span></div>`,
      section ? section.color : null);
  });

  if (recentVisits.length) {
    sub('Finished today');
    recentVisits.slice(0, 10).forEach((v) => {
      const section = sections.find((s) => s.id === v.sectionId);
      const waited = v.arrivedAt && v.seatedAt ? durationLabel(v.seatedAt - v.arrivedAt) : '—';
      line('done',
        `<div class="mgr-row-main"><b>${escapeHtml(v.guestName || 'Guest')}</b> · Table ${v.tableNumber}${v.partySize ? ` · party of ${v.partySize}` : ''} <span class="mgr-sec">${section ? escapeHtml(section.name) : ''}</span>` +
        `<div class="mgr-row-what">${v.arrivedAt ? `Arrived ${clockTimeLabel(v.arrivedAt)} · ` : ''}Seated ${clockTimeLabel(v.seatedAt)} · left ${clockTimeLabel(v.closedAt)} (${durationLabel(v.closedAt - v.seatedAt)} at table)</div></div>` +
        `<div class="mgr-row-side"><span class="mgr-status">waited ${waited}${v.unpaid ? ' · left without paying' : ''}</span></div>`,
        section ? section.color : null);
    });
  }
  return wrap;
}

function renderTableCard(table, section, requestTypes, seatTypes, complaints) {
  const card = document.createElement('div');
  card.className = 'table-card';
  card.style.borderLeftColor = section.color;

  const seatMeta = seatTypes[table.seatType];
  const head = document.createElement('div');
  head.className = 'card-head';
  head.innerHTML = `
    <div class="table-number">Table ${table.number} <span class="seat-type-pill">${seatMeta.icon} ${seatMeta.label}</span></div>
    <div class="status-badge ${table.status}">${STATUS_LABEL[table.status]}</div>`;
  card.appendChild(head);

  complaints
    .filter((c) => c.tableId === table.id && c.status === 'open')
    .forEach((c) => {
      const alert = document.createElement('div');
      alert.className = 'complaint-alert';
      alert.innerHTML = `<span>🚩 ${escapeHtml(c.message)}</span>`;
      card.appendChild(alert);
    });

  const openRequests = table.requests.filter((r) => r.status === 'open' || r.status === 'accepted');
  if (openRequests.length) {
    const chipRow = document.createElement('div');
    chipRow.className = 'chip-row';
    openRequests.forEach((r) => {
      const meta = requestTypes[r.type];
      const chip = document.createElement('div');
      chip.className = 'chip' + (r.type === 'bill' ? ' bill' : '') + (r.status === 'accepted' ? ' accepted' : '') + (r.type === 'bathroom' ? ' flash-red' : '');
      const what = r.type === 'special' ? r.message : meta.label;
      chip.textContent = `${meta.icon} ${what}${r.status === 'accepted' ? ' (in progress)' : ''} `;
      // Live wait clock; passes 10 minutes -> flashing light + siren.
      const wait = document.createElement('span');
      wait.className = 'order-clock';
      wait.dataset.orderTs = r.ts;
      wait.dataset.alarm = '1';
      chip.appendChild(wait);
      chipRow.appendChild(chip);
    });
    card.appendChild(chipRow);
  }

  // Who is at the table and how long they waited to be seated
  if (table.status !== 'empty') {
    const who = document.createElement('div');
    who.className = 'mgr-who';
    const waited = table.arrivedAt && table.seatedAt ? ` · waited <b>${durationLabel(table.seatedAt - table.arrivedAt)}</b> for a table` : '';
    who.innerHTML = `👤 <b>${escapeHtml(table.guestName || 'Guest')}</b>${table.partySize ? ` · party of ${table.partySize}` : ''}` +
      (table.seatedAt ? `<br><span>Seated ${clockTimeLabel(table.seatedAt)}${waited}</span>` : '<br><span>Waiting to be greeted</span>') +
      (table.deposit > 0 ? `<br><span style="color:var(--good);">🥡 Pre-order · $${table.deposit.toFixed(2)} paid up front</span>` : '');
    card.appendChild(who);
  }

  // Everything the table has ordered, newest first, with where each order is
  const orders = [
    ...table.drinkOrders.map((o) => ({ o, icon: '🥤' })),
    ...table.foodOrders.map((o) => ({ o, icon: '🍔' })),
  ].sort((a, b) => b.o.ts - a.o.ts);
  if (orders.length) {
    const list = document.createElement('div');
    list.className = 'mgr-orders';
    orders.forEach(({ o, icon }) => {
      const row = document.createElement('div');
      row.className = 'mgr-order-row';
      const items = o.items.map((i) => `${i.qty}× ${i.name}${i.note ? ` (${i.note})` : ''}`).join(', ');
      const done = o.status === 'delivered';
      row.innerHTML = `<span>${icon} ${escapeHtml(items)}${o.preorder ? ' <i>pre-order</i>' : ''}</span>` +
        `<span class="mgr-order-meta"><b class="st-${o.status}">${o.status}</b> ` +
        (done ? `· took ${durationLabel((o.deliveredAt || o.ts) - o.ts)}` : `<span class="order-clock" data-order-ts="${o.ts}" data-alarm="1"></span>`) + '</span>';
      list.appendChild(row);
    });
    card.appendChild(list);
  }

  // Write to the guest at this table (e.g. "I'm on my way"). Shows on their screen as coming from the manager.
  if (table.status === 'seated') {
    const key = `msg:${table.id}`;
    const d = document.createElement('details');
    d.className = 'mgr-timeline';
    if (mgrOpen.has(key)) d.open = true;
    d.addEventListener('toggle', () => { if (d.open) mgrOpen.add(key); else mgrOpen.delete(key); });
    const s = document.createElement('summary');
    const sentCount = (table.messages || []).filter((x) => x.from === 'manager').length;
    s.textContent = `💬 Message the guest${sentCount ? ` (${sentCount} sent)` : ''}`;
    d.appendChild(s);
    (table.messages || []).filter((x) => x.from === 'manager').slice(-3).forEach((x) => {
      const sent = document.createElement('div');
      sent.className = 'mgr-reply-sent';
      sent.innerHTML = `📣 <b>${escapeHtml(x.text)}</b> <span class="order-clock" data-order-ts="${x.ts}"></span>`;
      d.appendChild(sent);
    });
    d.appendChild(replyBox(table.id, null));
    card.appendChild(d);
  }

  // Full history of the visit: orders, requests, who saw them, when each was done
  if (table.timeline && table.timeline.length) {
    const key = `tl:${table.id}`;
    const d = document.createElement('details');
    d.className = 'mgr-timeline';
    if (mgrOpen.has(key)) d.open = true;
    d.addEventListener('toggle', () => { if (d.open) mgrOpen.add(key); else mgrOpen.delete(key); });
    const s = document.createElement('summary');
    s.textContent = `🕒 Everything that happened (${table.timeline.length})`;
    d.appendChild(s);
    d.appendChild(renderVisitTimeline(table.timeline));
    card.appendChild(d);
  }

  if (table.status !== 'empty') {
    const isPaid = !!(table.bill && table.bill.paid);
    const clear = document.createElement('button');
    clear.className = 'chip';
    clear.style.cssText = 'width:100%; margin-top:8px; justify-content:center; text-align:center;';
    clear.textContent = isPaid ? '✓ Guests left — clear table' : '🚪 Guests left — clear table';
    clear.addEventListener('click', () => {
      if (!isPaid && !confirm(`Clear Table ${table.number}? The guests will be recorded as having left without paying.`)) return;
      const auth = getAuth();
      if (auth) socket.emit('table:clear', { tableId: table.id, token: auth.token });
    });
    card.appendChild(clear);
  }

  if (table.status === 'empty' && !openRequests.length) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'Table is open';
    card.appendChild(note);
  }

  return card;
}

init();
