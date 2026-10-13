// Shared live "time since order placed" clock. Any element tagged
// data-order-ts="<ms timestamp>" gets its text kept in sync every second,
// without touching the rest of the DOM (so it doesn't disrupt open selects,
// text inputs, or scroll position on pages that re-render on state updates).
function elapsedLabel(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function clockTimeLabel(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// For a span that's already over (e.g. "delivered in 3m 12s") — a fixed
// duration, not a live-ticking one. Takes milliseconds.
function durationLabel(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// How long a waiting item can sit before it's "overdue". Set by the manager
// (10 min normally, 1-2 min for a live demo) and refreshed every few seconds.
let overdueMs = 10 * 60 * 1000;
function refreshAlarmSetting() {
  fetch('/api/settings', { cache: 'no-store' })
    .then((r) => r.json())
    .then((s) => {
      if (s && s.alarmMinutes) overdueMs = s.alarmMinutes * 60 * 1000;
    })
    .catch(() => {});
}
refreshAlarmSetting();
setInterval(refreshAlarmSetting, 5000);

function overdueLabel() {
  const m = Math.round(overdueMs / 60000);
  return `${m} minute${m === 1 ? '' : 's'}`;
}

function tickOrderClocks() {
  document.querySelectorAll('[data-order-ts]').forEach((el) => {
    const ts = Number(el.dataset.orderTs);
    if (!ts) return;
    // The clock-time part only needs computing once per element (it never
    // changes); the elapsed part updates every tick.
    if (!el.dataset.clockTimeSet) {
      el.textContent = `${clockTimeLabel(ts)} · `;
      const span = document.createElement('span');
      span.className = 'order-clock-elapsed';
      el.appendChild(span);
      el.dataset.clockTimeSet = '1';
    }
    const elapsedEl = el.querySelector('.order-clock-elapsed');
    if (elapsedEl) elapsedEl.textContent = `${elapsedLabel(ts)} ago`;
    // Traffic light: green while fresh, yellow once it's been sitting a
    // little, red (and pulsing) at the alarm threshold so a stalled item stands
    // out. Normally 2 min / 10 min; scales down when the demo timer is set short.
    const ageMs = Date.now() - ts;
    const mediumAt = overdueMs * 0.2;
    el.classList.toggle('order-clock-new', ageMs < mediumAt);
    el.classList.toggle('order-clock-medium', ageMs >= mediumAt && ageMs < overdueMs);
    el.classList.toggle('order-clock-late', ageMs >= overdueMs);
  });
}

// ---------------------------------------------------------------------------
// Overdue alarm. Any clock tagged data-alarm (a customer genuinely waiting on
// something — NOT informational clocks like "seated 2h ago") that passes 10
// minutes makes its card flash red, pins a flashing beacon bar to the top of
// the screen, and sounds a siren every few seconds until it's dealt with
// (or silenced for 2 minutes).
// ---------------------------------------------------------------------------
const SILENCE_MS = 2 * 60 * 1000;
let overduePrev = 0;
let silencedUntil = 0;
let overdueBeacon = null;

function soundOverdueAlarm() {
  if (Date.now() < silencedUntil) return;
  if (typeof Alerts !== 'undefined' && Alerts.alarm) Alerts.alarm();
}

function setOverdueBeacon(n) {
  if (!n) {
    if (overdueBeacon) {
      overdueBeacon.remove();
      overdueBeacon = null;
      document.body.classList.remove('has-beacon');
    }
    return;
  }
  if (!overdueBeacon) {
    overdueBeacon = document.createElement('div');
    overdueBeacon.className = 'overdue-beacon';
    overdueBeacon.innerHTML = '<span class="overdue-beacon-text"></span><button class="overdue-beacon-btn">Silence 2 min</button>';
    overdueBeacon.querySelector('button').addEventListener('click', () => {
      silencedUntil = Date.now() + SILENCE_MS;
      updateOverdue();
    });
    document.body.appendChild(overdueBeacon);
    document.body.classList.add('has-beacon');
  }
  const silenced = Date.now() < silencedUntil;
  overdueBeacon.querySelector('.overdue-beacon-text').textContent =
    `🚨 ${n} item${n > 1 ? 's' : ''} waiting over ${overdueLabel()}${silenced ? ' — siren silenced' : ''}`;
  overdueBeacon.querySelector('button').style.display = silenced ? 'none' : 'inline-block';
}

function updateOverdue() {
  const overdue = [];
  document.querySelectorAll('[data-order-ts][data-alarm]').forEach((el) => {
    const ts = Number(el.dataset.orderTs);
    if (ts && Date.now() - ts >= overdueMs) overdue.push(el);
  });
  const cards = new Set(
    overdue.map((el) => el.closest('.w-task, .table-card, .waitlist-card, .mini-order, .w-table') || el)
  );
  document.querySelectorAll('.overdue-flash').forEach((c) => { if (!cards.has(c)) c.classList.remove('overdue-flash'); });
  cards.forEach((c) => c.classList.add('overdue-flash'));
  setOverdueBeacon(overdue.length);
  if (overdue.length > overduePrev) soundOverdueAlarm(); // a new item just crossed 10 minutes
  overduePrev = overdue.length;
}
setInterval(() => { if (overduePrev > 0) soundOverdueAlarm(); }, 6000);

function tickAll() {
  tickOrderClocks();
  updateOverdue();
}
tickAll();
setInterval(tickAll, 1000);

// Shared across customer/waiter/manager: every stage of a table's visit,
// each with its own live clock. Reuses the exact same data-order-ts ticker
// above, so "time waiter saw it", "time accepted", "time bill arrived" etc.
// all behave identically to the order-placed clocks already on screen.
const VISIT_EVENT_META = {
  seated: { icon: '🪑', label: 'Seated' },
  greeted: { icon: '👋', label: 'Greeted by waiter' },
  pickup_coming: { icon: '🏃', label: 'Waiter coming to get it' },
  drinks_ordered: { icon: '🥤', label: 'Drinks ordered' },
  food_ordered: { icon: '🍔', label: 'Food ordered' },
  drink_order_seen: { icon: '🍸', label: 'Bar saw it' },
  drink_order_delivered: { icon: '✅', label: 'Drinks delivered' },
  food_order_seen: { icon: '👨‍🍳', label: 'Kitchen saw it' },
  food_order_delivered: { icon: '✅', label: 'Food delivered' },
  bill_requested: { icon: '🧾', label: 'Bill requested' },
  bill_delivered: { icon: '📋', label: 'Bill delivered' },
  bill_paid: { icon: '💳', label: 'Bill paid' },
  visit_ended: { icon: '👋', label: 'Checked out' },
  request_sent: { icon: '🙋', label: 'Requested' },
  request_accepted: { icon: '👀', label: 'Waiter saw it' },
  request_completed: { icon: '✅', label: 'Request completed' },
  waiter_message: { icon: '💬', label: 'Waiter' },
  complaint_sent: { icon: '🚩', label: 'Sent to manager' },
  complaint_resolved: { icon: '✅', label: 'Manager resolved it' },
};

function renderVisitTimeline(events) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
  (events || []).forEach((ev) => {
    const meta = VISIT_EVENT_META[ev.event] || { icon: '•', label: ev.event };
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; justify-content:space-between; align-items:baseline; gap:8px; font-size:11px; padding:3px 0; border-bottom:1px dashed var(--border);';
    const left = document.createElement('span');
    left.textContent = `${meta.icon} ${meta.label}${ev.detail ? ` — ${ev.detail}` : ''}`;
    const clock = document.createElement('span');
    clock.className = 'order-clock';
    clock.dataset.orderTs = ev.ts;
    row.appendChild(left);
    row.appendChild(clock);
    wrap.appendChild(row);
  });
  return wrap;
}
