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
  ]);

  // Keep the compose box usable across live refreshes (focus + caret).
  const typing = [staffPanel, settingsPanel].find((p) => p && p.contains(document.activeElement)) ? document.activeElement : null;
  const caret = typing && typing.selectionStart !== undefined ? [typing.selectionStart, typing.selectionEnd] : null;

  app.innerHTML = '';
  app.className = '';
  app.style.padding = '20px';

  const allTables = Object.values(tables);
  const occupied = allTables.filter((t) => t.status !== 'empty').length;
  const openRequests = allTables.reduce(
    (sum, t) => sum + t.requests.filter((r) => r.status === 'open' || r.status === 'accepted').length,
    0
  );

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
  app.appendChild(renderComplaintsPanel(complaints || [], sections));

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
    row.innerHTML = `<div style="color:#f5c542; letter-spacing:2px;">${stars(r.stars)} <span style="color:var(--muted); font-size:12px; letter-spacing:0;">Table ${r.tableNumber}</span></div>` +
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
    left.innerHTML = `<div class="who">${entry.guestName ? `<strong>${escapeHtml(entry.guestName)}</strong> · ` : ''}${meta.icon} ${meta.label} wanted — party of ${entry.partySize || 1}</div><div class="wait-time">Waiting <span class="order-clock" data-order-ts="${entry.ts}" data-alarm="1"></span></div>`;
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

function renderComplaintsPanel(complaints, sections) {
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
          <div style="color:var(--muted); font-size:13px;">${c.message}</div>
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
    });

  wrap.appendChild(list);
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
      alert.innerHTML = `<span>🚩 ${c.message}</span>`;
      card.appendChild(alert);
    });

  const openRequests = table.requests.filter((r) => r.status === 'open' || r.status === 'accepted');
  if (openRequests.length) {
    const chipRow = document.createElement('div');
    chipRow.className = 'chip-row';
    openRequests.forEach((r) => {
      const meta = requestTypes[r.type];
      const chip = document.createElement('div');
      chip.className = 'chip' + (r.type === 'bill' ? ' bill' : '') + (r.status === 'accepted' ? ' accepted' : '');
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

  const openOrders = [...table.drinkOrders, ...table.foodOrders].filter((o) => o.status !== 'delivered');
  if (openOrders.length) {
    const oldest = openOrders.reduce((a, b) => (a.ts < b.ts ? a : b));
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.style.cssText = 'padding:4px 0; display:flex; align-items:center; justify-content:center; gap:6px;';
    note.innerHTML = `${openOrders.length} order${openOrders.length > 1 ? 's' : ''} in progress — oldest <span class="order-clock" data-order-ts="${oldest.ts}" data-alarm="1"></span>`;
    card.appendChild(note);
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
