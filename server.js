const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const app = express();
app.set('trust proxy', true); // behind a hosting provider's proxy, req.protocol/host are the public ones
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '3mb' })); // big enough for a logo upload (sent as a data URL)
// no-store: this app's static files change constantly during development,
// and a stale cached copy is indistinguishable from "the feature isn't there".
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));

// The machine's LAN IPv4 address, so a QR code printed here resolves to
// something a phone on the same WiFi can actually reach (not "localhost").
// Virtual adapters (WSL, Hyper-V, VirtualBox, VMware, Docker) also have IPv4
// addresses, and Windows' interface order shifts when they start/stop — so
// picking "the first one" made QR codes intermittently point at an address
// no phone can reach. Rank real Wi-Fi/Ethernet on home-router ranges first.
const VIRTUAL_ADAPTER = /vethernet|wsl|hyper-v|virtualbox|vmware|docker|vbox|loopback|tailscale|zerotier/i;

function getLanAddress() {
  if (process.env.LAN_HOST) return process.env.LAN_HOST; // manual override
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family !== 'IPv4' && net.family !== 4) continue;
      if (net.internal) continue;
      let score = 0;
      if (!VIRTUAL_ADAPTER.test(name)) score += 4;
      if (/wi-?fi|wlan|wireless|ethernet|^en|^eth/i.test(name)) score += 2;
      if (/^192\.168\./.test(net.address)) score += 2;
      else if (/^10\./.test(net.address)) score += 1;
      if (/^169\.254\./.test(net.address)) score -= 10; // no-DHCP self-assigned
      candidates.push({ address: net.address, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.length ? candidates[0].address : 'localhost';
}

// The address a phone should use to reach this server:
//  - hosted online (Render, Railway, ...): the public https address the request came in on
//  - opened as localhost on the PC: this PC's Wi-Fi/hotspot address, so a phone can reach it
//  - PUBLIC_URL env var: always wins (handy behind a custom domain)
function publicBase(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const first = (v) => String(v || '').split(',')[0].trim();
  const host = first(req.headers['x-forwarded-host']) || first(req.headers.host);
  const proto = first(req.headers['x-forwarded-proto']) || 'http';
  const hostname = host.replace(/:\d+$/, '');
  if (!host || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
    return `http://${getLanAddress()}:${PORT}`;
  }
  return `${proto}://${host}`;
}

function lanUrl(req, relativePath) {
  return publicBase(req) + relativePath;
}

app.get('/api/qr', async (req, res) => {
  const targetPath = req.query.path;
  if (!targetPath || !targetPath.startsWith('/')) {
    return res.status(400).json({ ok: false, error: 'path must start with /' });
  }
  try {
    const url = lanUrl(req, targetPath);
    // margin 4 = the spec's quiet zone; phone cameras struggle to lock on with less.
    const png = await QRCode.toBuffer(url, { width: 800, margin: 4 });
    res.type('png').send(png);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Hosting providers ping this to know the app is alive.
app.get('/healthz', (req, res) => res.json({ ok: true }));

app.get('/api/settings', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(publicSettings());
});

app.get('/api/lan-url', (req, res) => {
  res.json({ url: lanUrl(req, req.query.path || '/') });
});

// ---------------------------------------------------------------------------
// Static restaurant layout: color-coded sections, waiters, tables, menu
// ---------------------------------------------------------------------------

const SECTIONS = [
  { id: 'A', name: 'Section A', color: '#e63946' },
  { id: 'B', name: 'Section B', color: '#2a9d8f' },
  { id: 'C', name: 'Section C', color: '#f4a261' },
  { id: 'D', name: 'Section D', color: '#457b9d' },
];

// PINs are a lightweight demo gate, not production-grade auth (no hashing,
// no rate limiting). Good enough to keep the wrong staff off the wrong
// dashboard; swap for real accounts before this ever touches a real POS.
const WAITERS = [
  { id: 'w1', name: 'Alex', sectionId: 'A', pin: '1111' },
  { id: 'w2', name: 'Sam', sectionId: 'B', pin: '2222' },
  { id: 'w3', name: 'Jordan', sectionId: 'C', pin: '3333' },
  { id: 'w4', name: 'Taylor', sectionId: 'D', pin: '4444' },
];

const MANAGER_PIN = process.env.MANAGER_PIN || '9999';
const KITCHEN_PIN = process.env.KITCHEN_PIN || '5555';
const BARTENDER_PIN = process.env.BARTENDER_PIN || '6666';
// One PIN that opens every role (any waiter, manager, kitchen, bar) — for
// live restaurant demos where re-explaining five different PINs is friction.
// The per-role PINs above still work too; this is an override, not a replacement.
// Works for every staff role (demo convenience). Set MASTER_PIN=off to disable it, or to another number to change it.
const MASTER_PIN = process.env.MASTER_PIN === 'off' ? null : process.env.MASTER_PIN || '0000';

const MENU = [
  { id: 'water', name: 'Water', price: 0, category: 'drink', desc: 'Ice-cold filtered water, served with a slice of lemon.' },
  { id: 'soda', name: 'Soft Drink', price: 3, category: 'drink', desc: 'Your choice of cola, lemon-lime or ginger ale, over ice.' },
  { id: 'tea', name: 'Iced Tea', price: 3.5, category: 'drink', desc: 'Fresh-brewed black tea, chilled and served over ice.' },
  { id: 'coffee', name: 'Coffee', price: 3.5, category: 'drink', desc: 'Hot, freshly brewed house coffee.' },
  { id: 'beer', name: 'Beer', price: 6, category: 'drink', desc: 'Cold draft beer, served in a frosted glass.' },
  { id: 'wine', name: 'Glass of Wine', price: 9, category: 'drink', desc: 'A generous pour of red, white or rosé.' },
  { id: 'cocktail', name: 'Cocktail', price: 11, category: 'drink', desc: "The bartender's signature cocktail, shaken to order." },
  { id: 'fries', name: 'French Fries', price: 5, category: 'food', desc: 'Crispy golden fries, lightly salted.' },
  { id: 'wings', name: 'Chicken Wings', price: 9.5, category: 'food', desc: 'Crispy chicken wings tossed in your choice of sauce.' },
  { id: 'nachos', name: 'Loaded Nachos', price: 8.5, category: 'food', desc: 'Tortilla chips piled with melted cheese, jalapeños, salsa and sour cream.' },
  { id: 'salad', name: 'House Salad', price: 7.5, category: 'food', desc: 'Crisp greens, tomato, cucumber and red onion with house dressing.' },
  { id: 'burger', name: 'Burger & Fries', price: 13.5, category: 'food', desc: 'Grilled beef patty with lettuce, tomato and cheese on a toasted bun, with fries.' },
  { id: 'pasta', name: 'Pasta of the Day', price: 14.5, category: 'food', desc: "Fresh pasta in the chef's sauce of the day." },
  { id: 'dessert', name: "Chef's Dessert", price: 6.5, category: 'food', desc: "The chef's dessert of the day." },
];

// Menu photos are plain files: drop public/images/menu/<item id>.jpg (or .jpeg
// / .png / .webp) and it appears on the customer screen — no code change.
const PHOTO_DIR = path.join(__dirname, 'public', 'images', 'menu');
const photoCache = new Map(); // id -> { url|null, checkedAt }
function photoFor(id) {
  const hit = photoCache.get(id);
  if (hit && Date.now() - hit.checkedAt < 5000) return hit.url;
  let url = null;
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    try {
      const stat = fs.statSync(path.join(PHOTO_DIR, `${id}.${ext}`));
      url = `/images/menu/${id}.${ext}?v=${Math.floor(stat.mtimeMs)}`;
      break;
    } catch {}
  }
  photoCache.set(id, { url, checkedAt: Date.now() });
  return url;
}
function menuWithPhotos() {
  return MENU.map((m) => ({ ...m, photo: photoFor(m.id) }));
}

const REQUEST_TYPES = {
  utensils: { label: 'Utensils', icon: '🍴' },
  ketchup: { label: 'Ketchup', icon: '🍅' },
  napkins: { label: 'Napkins', icon: '🧻' },
  service: { label: 'Service', icon: '🔧' },
  bill: { label: 'Bill', icon: '🧾' },
  special: { label: 'Special Request', icon: '⭐' },
};

// Physical seating type, independent of which waiter's section a table is
// in. A customer picks one of these at the door, before any table exists.
const SEAT_TYPES = {
  table: { label: 'Table', icon: '🍽️' },
  booth: { label: 'Booth', icon: '🛋️' },
  bar: { label: 'Bar Seat', icon: '🍸' },
};

const TABLES_PER_SECTION = 4;
const SEAT_TYPE_PATTERN = ['table', 'booth', 'bar', 'table']; // per section, by index

function freshTable(id, number, sectionId, seatType) {
  return {
    id,
    number,
    sectionId,
    seatType,
    status: 'empty', // empty -> needs_greeting -> seated
    seatedAt: null,
    greetedAt: null, // set when a waiter actually greets the table; a seated table with this null still needs a greeting
    arrivedAt: null, // when the party showed up (door check-in / tapped "I'm here"), so wait-to-be-seated is measurable
    customerId: null, // logged-in customer account at this table
    guestName: null,
    drinkOrders: [], // { id, items:[{id,name,price,qty}], status: new|preparing|delivered, ts }
    foodOrders: [], // { id, items:[{id,name,price,qty}], status: new|cooking|ready|delivered, ts }
    requests: [], // { id, type, status: open|done, ts }
    messages: [], // { id, text, ts } — waiter -> customer, one-way
    bill: null, // { subtotal, tip, total, paid, deliveredAt }
    timeline: [], // { event, detail, ts } — the full visit journey, archived to visitLog on close-out
  };
}

// Same "2m 5s" style the clients use for durations.
function waitLabel(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function logEvent(t, event, detail) {
  if (!t.timeline) t.timeline = [];
  t.timeline.push({ event, detail: detail || null, ts: Date.now() });
}

function buildTables() {
  const tables = {};
  let n = 1;
  SECTIONS.forEach((sec) => {
    for (let i = 0; i < TABLES_PER_SECTION; i++) {
      const id = `T${n}`;
      tables[id] = freshTable(id, n, sec.id, SEAT_TYPE_PATTERN[i % SEAT_TYPE_PATTERN.length]);
      n++;
    }
  });
  return tables;
}

// ---------------------------------------------------------------------------
// Persistence: plain JSON file, reloaded on boot so a server restart doesn't
// lose an in-progress service or the day's closed-bill history.
// ---------------------------------------------------------------------------

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

let tables;
let completedBills; // closed-out bills, newest last: { tableNumber, sectionId, subtotal, tip, total, closedAt }
let complaints; // { id, tableId, tableNumber, sectionId, message, status: open|resolved, ts }
let waitlist; // door check-ins: { id, seatType, status: waiting|seated, tableId, ts }
let requestLog; // resolved requests, for response-time analytics: { label, tableNumber, sectionId, ts, acceptedAt, resolvedAt }
let prepLog; // finished kitchen/bar orders: { kind: food|drink, createdAt, readyAt }
let ratings; // service ratings: { id, tableNumber, sectionId, stars, comment, ts }
let suggestions; // anonymous by design — no table, section, or device info: { id, message, ts, archived }
let visitLog; // archived per-table journeys, newest last: { id, tableNumber, sectionId, guestName, seatedAt, closedAt, timeline }
let staffMessages; // manager -> staff, private: { id, to, text, ts, ackedBy: [staffKey] }. Never part of the state customers receive.

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    tables = parsed.tables || buildTables();
    // Backfill fields for state files saved before these features existed.
    Object.values(tables).forEach((t, i) => {
      if (!t.seatType) t.seatType = SEAT_TYPE_PATTERN[i % SEAT_TYPE_PATTERN.length];
      if (!t.foodOrders) t.foodOrders = [];
      if (!t.messages) t.messages = [];
      if (!t.timeline) t.timeline = [];
      // Tables from before greeting-tracking: empty ones start un-greeted, anyone
      // already seated is treated as greeted so old data doesn't raise false alarms.
      if (t.greetedAt === undefined) t.greetedAt = t.status === 'seated' ? t.seatedAt || Date.now() : null;
      if (t.arrivedAt === undefined) t.arrivedAt = null;
    });
    completedBills = parsed.completedBills || [];
    complaints = parsed.complaints || [];
    waitlist = parsed.waitlist || [];
    requestLog = parsed.requestLog || [];
    prepLog = parsed.prepLog || [];
    ratings = parsed.ratings || [];
    suggestions = parsed.suggestions || [];
    visitLog = parsed.visitLog || [];
    staffMessages = parsed.staffMessages || [];
  } catch {
    tables = buildTables();
    completedBills = [];
    complaints = [];
    waitlist = [];
    requestLog = [];
    prepLog = [];
    ratings = [];
    suggestions = [];
    visitLog = [];
    staffMessages = [];
  }
}

function saveState() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ tables, completedBills, complaints, waitlist, requestLog, prepLog, ratings, suggestions, visitLog, staffMessages }, null, 2));
  } catch (err) {
    console.error('Failed to persist state:', err.message);
  }
}

loadState();

// ---------------------------------------------------------------------------
// Restaurant settings: name, logo and how long before a waiting item sets off
// the alarm. Kept in their own file so "Reset demo" never wipes them.
// ---------------------------------------------------------------------------
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const LOGO_DIR = path.join(__dirname, 'public', 'images');
const ALARM_CHOICES = [1, 2, 5, 10, 15]; // minutes; 1-2 are for live demos
const settings = { restaurantName: 'Tap to Serve', alarmMinutes: 10 };
try {
  Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')));
} catch {}

function saveSettings() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Could not save settings:', err.message);
  }
}

function logoUrl() {
  for (const ext of ['png', 'jpg', 'webp']) {
    try {
      const stat = fs.statSync(path.join(LOGO_DIR, `logo.${ext}`));
      return `/images/logo.${ext}?v=${Math.floor(stat.mtimeMs)}`;
    } catch {}
  }
  return null;
}

function publicSettings() {
  return { restaurantName: settings.restaurantName, alarmMinutes: settings.alarmMinutes, logo: logoUrl() };
}

function menuItem(itemId) {
  return MENU.find((d) => d.id === itemId);
}

function priceFor(itemId) {
  const m = menuItem(itemId);
  return m ? m.price : 0;
}

function computeSubtotal(table) {
  const ordersTotal = (orders) =>
    orders.reduce((sum, order) => sum + order.items.reduce((s, it) => s + priceFor(it.id) * it.qty, 0), 0);
  return ordersTotal(table.drinkOrders) + ordersTotal(table.foodOrders);
}

function todaysBills() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  return completedBills.filter((b) => b.closedAt >= todayStart.getTime());
}

// A waiter's shift recap, per section (one waiter per section): every visit
// they finished today plus the averages that matter to them. Always current,
// so a waiter can pull it up at any point in the shift.
function recapBySection() {
  const since = startOfToday();
  const avg = (arr) => (arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : null);
  const recap = {};
  SECTIONS.forEach((sec) => {
    const visits = visitLog
      .filter((v) => v.sectionId === sec.id && v.closedAt >= since)
      .map((v) => ({
        id: v.id,
        tableNumber: v.tableNumber,
        guestName: v.guestName,
        arrivedAt: v.arrivedAt || null,
        seatedAt: v.seatedAt,
        closedAt: v.closedAt,
        waitedMs: v.arrivedAt && v.seatedAt ? v.seatedAt - v.arrivedAt : null,
        greetedAfterMs: v.greetedAt && v.seatedAt ? v.greetedAt - v.seatedAt : null,
        tip: v.tip || 0,
        total: v.total || 0,
        timeline: v.timeline || [],
      }))
      .sort((a, b) => b.closedAt - a.closedAt);
    const reqs = requestLog.filter((r) => r.sectionId === sec.id && r.resolvedAt >= since);
    recap[sec.id] = {
      served: visits.length,
      tips: visits.reduce((s, v) => s + v.tip, 0),
      sales: visits.reduce((s, v) => s + v.total - v.tip, 0),
      avgTableMs: avg(visits.filter((v) => v.seatedAt).map((v) => v.closedAt - v.seatedAt)),
      avgWaitMs: avg(visits.filter((v) => v.waitedMs !== null).map((v) => v.waitedMs)),
      avgGreetMs: avg(visits.filter((v) => v.greetedAfterMs !== null).map((v) => v.greetedAfterMs)),
      requestsHandled: reqs.length,
      avgResponseMs: avg(reqs.map((r) => r.acceptedAt - r.ts)),
      avgCompletionMs: avg(reqs.map((r) => r.resolvedAt - r.ts)),
      visits,
    };
  });
  return recap;
}

function buildFullState() {
  const bills = todaysBills();
  // Tips are the waiter's own earnings, scoped to their section only — never
  // rolled into what the manager dashboard sees (see broadcastManagerState).
  const tipsTodayBySection = {};
  SECTIONS.forEach((sec) => {
    tipsTodayBySection[sec.id] = bills
      .filter((b) => b.sectionId === sec.id)
      .reduce((s, b) => s + b.tip, 0);
  });

  return {
    sections: SECTIONS,
    waiters: WAITERS.map((w) => ({ id: w.id, name: w.name, sectionId: w.sectionId })), // never leak pins
    menu: menuWithPhotos(),
    requestTypes: REQUEST_TYPES,
    seatTypes: SEAT_TYPES,
    tables,
    complaints,
    waitlist,
    tipsTodayBySection,
    recapBySection: recapBySection(),
    ratingsBySection: ratingsBySection(),
  };
}

function broadcastState() {
  saveState();
  io.emit('state:full', buildFullState());
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const avg = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);

// Tips are deliberately absent from everything computed here.
function computeAnalytics() {
  const since = startOfToday();
  const bills = completedBills.filter((b) => b.closedAt >= since);
  const reqs = requestLog.filter((r) => r.resolvedAt >= since);
  const preps = prepLog.filter((p) => p.readyAt >= since);

  const itemTotals = {};
  bills.forEach((b) =>
    (b.items || []).forEach((it) => {
      const row = (itemTotals[it.name] = itemTotals[it.name] || { name: it.name, qty: 0, revenue: 0 });
      row.qty += it.qty;
      row.revenue += it.price * it.qty;
    })
  );

  const revenueByHour = Array(24).fill(0);
  bills.forEach((b) => {
    revenueByHour[new Date(b.closedAt).getHours()] += b.subtotal;
  });

  const revenueBySection = {};
  SECTIONS.forEach((s) => {
    revenueBySection[s.id] = bills.filter((b) => b.sectionId === s.id).reduce((sum, b) => sum + b.subtotal, 0);
  });

  const requestsByType = {};
  reqs.forEach((r) => {
    requestsByType[r.type] = (requestsByType[r.type] || 0) + 1;
  });

  return {
    avgTicket: avg(bills.map((b) => b.subtotal)),
    avgTurnMins: avg(bills.filter((b) => b.seatedAt).map((b) => (b.closedAt - b.seatedAt) / 60000)),
    // Response = time to first acknowledge (accept). Completion = time to fully resolve.
    avgResponseSecs: avg(reqs.map((r) => ((r.acceptedAt || r.resolvedAt) - r.ts) / 1000)),
    avgCompletionSecs: avg(reqs.map((r) => (r.resolvedAt - r.ts) / 1000)),
    avgFoodPrepMins: avg(preps.filter((p) => p.kind === 'food').map((p) => (p.readyAt - p.createdAt) / 60000)),
    avgDrinkPrepMins: avg(preps.filter((p) => p.kind === 'drink').map((p) => (p.readyAt - p.createdAt) / 60000)),
    topItems: Object.values(itemTotals).sort((a, b) => b.qty - a.qty).slice(0, 5),
    revenueByHour,
    revenueBySection,
    requestsByType,
    requestsHandled: reqs.length,
    recentRequests: reqs
      .slice(-10)
      .reverse()
      .map((r) => ({
        label: r.label,
        tableNumber: r.tableNumber,
        sectionId: r.sectionId,
        responseSecs: ((r.acceptedAt || r.resolvedAt) - r.ts) / 1000,
        completionSecs: (r.resolvedAt - r.ts) / 1000,
      })),
    avgRating: avg(ratings.filter((r) => r.ts >= since).map((r) => r.stars)),
    ratingCount: ratings.filter((r) => r.ts >= since).length,
    recentRatings: ratings.filter((r) => r.ts >= since).slice(-8).reverse(),
  };
}

function ratingsBySection() {
  const since = startOfToday();
  const out = {};
  SECTIONS.forEach((s) => {
    const mine = ratings.filter((r) => r.sectionId === s.id && r.ts >= since);
    out[s.id] = { avg: avg(mine.map((r) => r.stars)), count: mine.length };
  });
  return out;
}

function broadcastManagerState() {
  const bills = todaysBills();
  const since = startOfToday();
  io.emit('manager:state', {
    analytics: computeAnalytics(),
    suggestions: suggestions.slice().reverse(),
    recentVisits: visitLog
      .filter((v) => v.closedAt >= since)
      .slice(-15)
      .reverse(),
    sections: SECTIONS,
    waiters: WAITERS.map((w) => ({ id: w.id, name: w.name, sectionId: w.sectionId })), // never leak pins
    settings: publicSettings(),
    tables,
    requestTypes: REQUEST_TYPES,
    seatTypes: SEAT_TYPES,
    complaints,
    waitlist,
    stats: {
      // Subtotal only — tips are staff earnings, not restaurant revenue, and
      // are intentionally excluded from what the manager view can see.
      revenueToday: bills.reduce((s, b) => s + b.subtotal, 0),
      billsClosedToday: bills.length,
    },
  });
}

// ---------------------------------------------------------------------------
// Auth: PIN login issues an opaque session token kept server-side in memory.
// ---------------------------------------------------------------------------

const sessions = new Map(); // token -> { role: 'waiter'|'manager'|'kitchen', waiterId? }

app.post('/api/waiter-login', (req, res) => {
  const { waiterId, pin } = req.body || {};
  const waiter = WAITERS.find((w) => w.id === waiterId);
  if (!waiter || (waiter.pin !== pin && pin !== MASTER_PIN)) {
    return res.status(401).json({ ok: false, error: 'Incorrect PIN' });
  }
  const token = crypto.randomUUID();
  sessions.set(token, { role: 'waiter', waiterId });
  res.json({ ok: true, token, waiterName: waiter.name });
});

app.post('/api/manager-login', (req, res) => {
  const { pin } = req.body || {};
  if (pin !== MANAGER_PIN && pin !== MASTER_PIN) {
    return res.status(401).json({ ok: false, error: 'Incorrect PIN' });
  }
  const token = crypto.randomUUID();
  sessions.set(token, { role: 'manager' });
  res.json({ ok: true, token });
});

// Manager uploads the restaurant's logo (data URL, png/jpg/webp, up to ~2 MB).
app.post('/api/logo', (req, res) => {
  const session = sessions.get((req.body || {}).token);
  if (!session || session.role !== 'manager') return res.status(401).json({ ok: false, error: 'Manager login required' });
  const remove = () => ['png', 'jpg', 'webp'].forEach((e) => { try { fs.unlinkSync(path.join(LOGO_DIR, `logo.${e}`)); } catch {} });
  if (req.body.remove) {
    remove();
    broadcastManagerState();
    return res.json({ ok: true, logo: null });
  }
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.dataUrl || ''));
  if (!m) return res.status(400).json({ ok: false, error: 'Use a PNG, JPG or WebP image' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2 * 1024 * 1024) return res.status(413).json({ ok: false, error: 'Image is over 2 MB' });
  remove();
  if (!fs.existsSync(LOGO_DIR)) fs.mkdirSync(LOGO_DIR, { recursive: true });
  fs.writeFileSync(path.join(LOGO_DIR, `logo.${m[1] === 'jpeg' ? 'jpg' : m[1]}`), buf);
  broadcastManagerState();
  res.json({ ok: true, logo: logoUrl() });
});

app.post('/api/bartender-login', (req, res) => {
  const { pin } = req.body || {};
  if (pin !== BARTENDER_PIN && pin !== MASTER_PIN) {
    return res.status(401).json({ ok: false, error: 'Incorrect PIN' });
  }
  const token = crypto.randomUUID();
  sessions.set(token, { role: 'bartender' });
  res.json({ ok: true, token });
});

app.post('/api/kitchen-login', (req, res) => {
  const { pin } = req.body || {};
  if (pin !== KITCHEN_PIN && pin !== MASTER_PIN) {
    return res.status(401).json({ ok: false, error: 'Incorrect PIN' });
  }
  const token = crypto.randomUUID();
  sessions.set(token, { role: 'kitchen' });
  res.json({ ok: true, token });
});

// ---------------------------------------------------------------------------
// Private staff messages (manager -> staff). These travel only to sockets that
// proved they hold a valid staff session token — they are deliberately NOT in
// buildFullState(), which is broadcast to customers too.
// ---------------------------------------------------------------------------

const STAFF_KEYS = [...WAITERS.map((w) => `waiter:${w.id}`), 'kitchen', 'bartender'];

function staffKeyOf(session) {
  return session.role === 'waiter' ? `waiter:${session.waiterId}` : session.role;
}

function staffLabel(key) {
  if (key === 'kitchen') return 'Kitchen';
  if (key === 'bartender') return 'Bar';
  const w = WAITERS.find((x) => `waiter:${x.id}` === key);
  return w ? w.name : key;
}

// Who a message addressed to `to` reaches.
function audienceKeys(to) {
  if (to === 'all') return STAFF_KEYS;
  if (to === 'waiters') return STAFF_KEYS.filter((k) => k.startsWith('waiter:'));
  return STAFF_KEYS.includes(to) ? [to] : [];
}

function audienceLabel(to) {
  if (to === 'all') return 'Everyone';
  if (to === 'waiters') return 'All waiters';
  return staffLabel(to);
}

function messagesFor(session) {
  if (session.role === 'manager') {
    return staffMessages.slice(-50).reverse().map((m) => ({
      id: m.id,
      to: m.to,
      toLabel: audienceLabel(m.to),
      text: m.text,
      ts: m.ts,
      audience: audienceKeys(m.to).length,
      ackedBy: m.ackedBy.map(staffLabel),
    }));
  }
  const key = staffKeyOf(session);
  return staffMessages
    .filter((m) => audienceKeys(m.to).includes(key))
    .slice(-30)
    .reverse()
    .map((m) => ({ id: m.id, toLabel: audienceLabel(m.to), text: m.text, ts: m.ts, acked: m.ackedBy.includes(key) }));
}

function pushStaffMessages() {
  for (const s of io.sockets.sockets.values()) {
    if (s.data && s.data.staff) s.emit('staff:messages', messagesFor(s.data.staff));
  }
}

// ---------------------------------------------------------------------------
// Customer accounts: name + phone + self-chosen 4-digit PIN. Kept in their own
// file so resetting the floor (state.json) never wipes anyone's account.
// PINs are scrypt-hashed; sessions persist so a server restart doesn't log
// every guest out mid-meal.
// ---------------------------------------------------------------------------

const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');
let customers = {}; // id -> { id, name, phone, salt, pinHash, createdAt, visits }
let customerSessions = {}; // token -> customerId

try {
  const parsed = JSON.parse(fs.readFileSync(CUSTOMERS_FILE, 'utf8'));
  customers = parsed.customers || {};
  customerSessions = parsed.sessions || {};
} catch {}

function saveCustomers() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify({ customers, sessions: customerSessions }, null, 2));
  } catch (err) {
    console.error('Failed to persist customers:', err.message);
  }
}

const normalizePhone = (p) => String(p || '').replace(/\D/g, '');
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
const findCustomerByPhone = (phone) => Object.values(customers).find((c) => c.phone === phone);
const publicCustomer = (c) => ({ id: c.id, name: c.name, visits: c.visits || 0 });

function customerFromToken(token) {
  const id = token && customerSessions[token];
  return id ? customers[id] || null : null;
}

// A 4-digit PIN is only 10,000 guesses — lock a phone number out for a while
// after repeated misses so it can't be brute-forced from the WiFi.
const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;
const loginAttempts = new Map(); // phone -> { count, lockedUntil }

function issueCustomerToken(customer) {
  const token = crypto.randomBytes(24).toString('hex');
  customerSessions[token] = customer.id;
  saveCustomers();
  return token;
}

app.post('/api/customer/register', (req, res) => {
  const { name, phone, pin } = req.body || {};
  const cleanName = String(name || '').trim().slice(0, 40);
  const cleanPhone = normalizePhone(phone);
  if (!cleanName) return res.status(400).json({ ok: false, error: 'Enter your name.' });
  if (cleanPhone.length < 7 || cleanPhone.length > 15) {
    return res.status(400).json({ ok: false, error: 'Enter a valid phone number.' });
  }
  if (!/^\d{4}$/.test(String(pin || ''))) {
    return res.status(400).json({ ok: false, error: 'PIN must be 4 digits.' });
  }
  if (findCustomerByPhone(cleanPhone)) {
    return res.status(409).json({ ok: false, error: 'That phone number already has an account — log in instead.' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const customer = {
    id: crypto.randomBytes(8).toString('hex'),
    name: cleanName,
    phone: cleanPhone,
    salt,
    pinHash: hashPin(pin, salt),
    createdAt: Date.now(),
    visits: 0,
  };
  customers[customer.id] = customer;
  const token = issueCustomerToken(customer);
  res.json({ ok: true, token, customer: publicCustomer(customer) });
});

app.post('/api/customer/login', (req, res) => {
  const { phone, pin } = req.body || {};
  const cleanPhone = normalizePhone(phone);
  const attempt = loginAttempts.get(cleanPhone) || { count: 0, lockedUntil: 0 };
  if (attempt.lockedUntil > Date.now()) {
    const mins = Math.ceil((attempt.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({ ok: false, error: `Too many tries. Try again in ${mins} min or ask your host.` });
  }
  const customer = findCustomerByPhone(cleanPhone);
  if (!customer) {
    // Distinct from "wrong PIN" — this is almost always a first-time guest who
    // hasn't signed up yet, landing on the login tab by default. No lockout
    // bookkeeping either: there's no real account here to brute-force.
    return res.status(404).json({ ok: false, error: "No account found for that number — you'll need to create one.", noAccount: true });
  }
  const ok = crypto.timingSafeEqual(Buffer.from(hashPin(pin, customer.salt), 'hex'), Buffer.from(customer.pinHash, 'hex'));
  if (!ok) {
    attempt.count += 1;
    if (attempt.count >= MAX_PIN_ATTEMPTS) {
      attempt.count = 0;
      attempt.lockedUntil = Date.now() + LOCKOUT_MS;
    }
    loginAttempts.set(cleanPhone, attempt);
    return res.status(401).json({ ok: false, error: 'Incorrect PIN for that number.' });
  }
  loginAttempts.delete(cleanPhone);
  const token = issueCustomerToken(customer);
  res.json({ ok: true, token, customer: publicCustomer(customer) });
});

app.get('/api/customer/me', (req, res) => {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const customer = customerFromToken(token);
  if (!customer) return res.status(401).json({ ok: false, error: 'Not logged in' });
  res.json({ ok: true, customer: publicCustomer(customer) });
});

app.post('/api/customer/logout', (req, res) => {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (customerSessions[token]) {
    delete customerSessions[token];
    saveCustomers();
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Realtime events
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {
  socket.emit('state:full', buildFullState());

  socket.on('manager:subscribe', () => broadcastManagerState());

  // --- Manager settings + demo reset -----------------------------------
  socket.on('manager:update_settings', ({ token, restaurantName, alarmMinutes } = {}) => {
    const session = sessions.get(token);
    if (!session || session.role !== 'manager') return socket.emit('staff:auth_required');
    const name = String(restaurantName || '').trim().slice(0, 40);
    if (name) settings.restaurantName = name;
    const mins = Number(alarmMinutes);
    if (ALARM_CHOICES.includes(mins)) settings.alarmMinutes = mins;
    saveSettings();
    broadcastManagerState();
  });

  // Wipes the floor back to a clean slate between demos. Staff logins, the
  // restaurant's settings and customer accounts are kept.
  socket.on('manager:reset_demo', ({ token } = {}) => {
    const session = sessions.get(token);
    if (!session || session.role !== 'manager') return socket.emit('staff:auth_required');
    tables = buildTables();
    completedBills = [];
    complaints = [];
    waitlist = [];
    requestLog = [];
    prepLog = [];
    ratings = [];
    suggestions = [];
    visitLog = [];
    staffMessages = [];
    broadcastState();
    broadcastManagerState();
    pushStaffMessages();
    socket.emit('manager:reset_done');
  });

  // --- Private staff messaging -----------------------------------------
  socket.on('staff:subscribe', ({ token } = {}) => {
    const session = sessions.get(token);
    if (!session) return socket.emit('staff:auth_required');
    socket.data.staff = session;
    socket.emit('staff:messages', messagesFor(session));
  });

  socket.on('staff:unsubscribe', () => {
    if (socket.data) delete socket.data.staff;
  });

  socket.on('manager:send_staff_message', ({ token, to, text } = {}) => {
    const session = sessions.get(token);
    if (!session || session.role !== 'manager') return socket.emit('staff:auth_required');
    const clean = String(text || '').trim().slice(0, 300);
    if (!clean || !audienceKeys(to).length) return;
    staffMessages.push({ id: crypto.randomUUID(), to, text: clean, ts: Date.now(), ackedBy: [] });
    if (staffMessages.length > 200) staffMessages = staffMessages.slice(-200);
    saveState();
    pushStaffMessages();
  });

  // Staff tap "Got it" — lets the manager see who has actually read it.
  socket.on('staff:ack_message', ({ token, messageId } = {}) => {
    const session = sessions.get(token);
    if (!session) return socket.emit('staff:auth_required');
    const key = staffKeyOf(session);
    const m = staffMessages.find((x) => x.id === messageId);
    if (!m || !audienceKeys(m.to).includes(key) || m.ackedBy.includes(key)) return;
    m.ackedBy.push(key);
    saveState();
    pushStaffMessages();
  });

  // --- Door check-in (before any table is assigned) ----------------------
  socket.on('customer:checkin', ({ checkinId, seatType, partySize, customerToken }) => {
    const customer = customerFromToken(customerToken);
    if (!customer) return socket.emit('customer:auth_required');
    if (!checkinId || !SEAT_TYPES[seatType]) return;
    if (waitlist.some((w) => w.id === checkinId)) return; // already checked in
    const size = Math.min(20, Math.max(1, Math.round(Number(partySize)) || 1));
    waitlist.push({
      id: checkinId,
      seatType,
      partySize: size,
      status: 'waiting',
      tableId: null,
      ts: Date.now(),
      customerId: customer.id,
      guestName: customer.name,
    });
    customer.visits = (customer.visits || 0) + 1;
    saveCustomers();
    broadcastState();
    broadcastManagerState();
  });

  socket.on('waiter:seat_from_waitlist', ({ waitlistId, tableId }) => {
    const entry = waitlist.find((w) => w.id === waitlistId && w.status === 'waiting');
    const t = tables[tableId];
    if (!entry || !t || t.status !== 'empty' || t.seatType !== entry.seatType) return;
    t.status = 'seated';
    t.seatedAt = Date.now();
    t.arrivedAt = entry.ts;
    t.customerId = entry.customerId || null;
    t.guestName = entry.guestName || null;
    logEvent(t, 'seated', `Party of ${entry.partySize || 1} · waited ${waitLabel(t.seatedAt - t.arrivedAt)}`);
    entry.status = 'seated';
    entry.tableId = tableId;
    broadcastState();
    broadcastManagerState();
    setTimeout(() => {
      waitlist = waitlist.filter((w) => w.id !== waitlistId);
      broadcastState();
    }, 6000);
  });

  // --- Customer actions -----------------------------------------------
  socket.on('customer:arrive', ({ tableId, customerToken }) => {
    const customer = customerFromToken(customerToken);
    if (!customer) return socket.emit('customer:auth_required');
    const t = tables[tableId];
    if (!t || t.status !== 'empty') return;
    t.status = 'needs_greeting';
    t.arrivedAt = Date.now();
    t.customerId = customer.id;
    t.guestName = customer.name;
    customer.visits = (customer.visits || 0) + 1;
    saveCustomers();
    broadcastState();
    broadcastManagerState();
  });

  socket.on('customer:order_items', ({ tableId, items }) => {
    const t = tables[tableId];
    if (!t || t.status === 'empty' || t.status === 'needs_greeting') return;
    if (!Array.isArray(items) || items.length === 0) return;
    const drinkItems = items.filter((it) => menuItem(it.id)?.category === 'drink');
    const foodItems = items.filter((it) => menuItem(it.id)?.category === 'food');
    if (drinkItems.length) {
      t.drinkOrders.push({ id: crypto.randomUUID(), items: drinkItems, status: 'new', ts: Date.now() });
      logEvent(t, 'drinks_ordered', drinkItems.map((i) => `${i.qty}× ${i.name}`).join(', '));
    }
    if (foodItems.length) {
      t.foodOrders.push({ id: crypto.randomUUID(), items: foodItems, status: 'new', ts: Date.now() });
      logEvent(t, 'food_ordered', foodItems.map((i) => `${i.qty}× ${i.name}`).join(', '));
    }
    broadcastState();
    broadcastManagerState();
  });

  socket.on('customer:request', ({ tableId, type }) => {
    const t = tables[tableId];
    if (!t || t.status === 'empty' || t.status === 'needs_greeting') return;
    if (!REQUEST_TYPES[type]) return;
    if (t.requests.some((r) => r.type === type && r.status === 'open')) return;
    t.requests.push({ id: crypto.randomUUID(), type, status: 'open', ts: Date.now() });
    logEvent(t, 'request_sent', REQUEST_TYPES[type].label);
    broadcastState();
    broadcastManagerState();
  });

  socket.on('customer:request_bill', ({ tableId }) => {
    const t = tables[tableId];
    if (!t || t.status === 'empty' || t.status === 'needs_greeting') return;
    if (t.requests.some((r) => r.type === 'bill' && r.status === 'open')) return;
    t.requests.push({ id: crypto.randomUUID(), type: 'bill', status: 'open', ts: Date.now() });
    logEvent(t, 'bill_requested');
    broadcastState();
    broadcastManagerState();
  });

  socket.on('customer:special_request', ({ tableId, message }) => {
    const t = tables[tableId];
    if (!t || t.status === 'empty' || t.status === 'needs_greeting') return;
    const text = String(message || '').trim().slice(0, 200);
    if (!text) return;
    t.requests.push({ id: crypto.randomUUID(), type: 'special', message: text, status: 'open', ts: Date.now() });
    logEvent(t, 'request_sent', text);
    broadcastState();
    broadcastManagerState();
  });

  socket.on('customer:complaint', ({ tableId, message }) => {
    const t = tables[tableId];
    if (!t || t.status === 'empty' || t.status === 'needs_greeting') return;
    const text = String(message || '').trim().slice(0, 300);
    if (!text) return;
    complaints.push({
      id: crypto.randomUUID(),
      tableId,
      tableNumber: t.number,
      sectionId: t.sectionId,
      message: text,
      status: 'open',
      ts: Date.now(),
    });
    logEvent(t, 'complaint_sent', text);
    broadcastState();
    broadcastManagerState();
  });

  // Deliberately takes no tableId: nothing about who or where is recorded.
  socket.on('customer:suggest', ({ message }) => {
    const text = String(message || '').trim().slice(0, 500);
    if (!text) return;
    suggestions.push({ id: crypto.randomUUID(), message: text, ts: Date.now(), archived: false });
    saveState();
    broadcastManagerState();
  });

  socket.on('suggestion:archive', ({ suggestionId }) => {
    const s = suggestions.find((x) => x.id === suggestionId);
    if (!s) return;
    s.archived = true;
    saveState();
    broadcastManagerState();
  });

  socket.on('customer:rate', ({ tableId, stars, comment }) => {
    const t = tables[tableId];
    if (!t || t.status !== 'seated' || t.rated) return;
    const n = Math.round(Number(stars));
    if (!(n >= 1 && n <= 5)) return;
    t.rated = true;
    ratings.push({
      id: crypto.randomUUID(),
      tableNumber: t.number,
      sectionId: t.sectionId,
      stars: n,
      comment: String(comment || '').trim().slice(0, 200),
      ts: Date.now(),
    });
    broadcastState();
    broadcastManagerState();
  });

  socket.on('complaint:resolve', ({ complaintId }) => {
    const c = complaints.find((x) => x.id === complaintId);
    if (!c || c.status !== 'open') return;
    c.status = 'resolved';
    c.resolvedAt = Date.now();
    const t = tables[c.tableId];
    if (t) logEvent(t, 'complaint_resolved', c.message);
    broadcastState();
    broadcastManagerState();
  });

  socket.on('customer:pay', ({ tableId, tip }) => {
    const t = tables[tableId];
    if (!t || !t.bill || t.bill.paid) return;
    const safeTip = Math.max(0, Number(tip) || 0);
    t.bill.tip = safeTip;
    t.bill.total = t.bill.subtotal + safeTip;
    t.bill.paid = true;
    logEvent(t, 'bill_paid', `Total $${t.bill.total.toFixed(2)}` + (safeTip ? ` (tip $${safeTip.toFixed(2)})` : ''));
    const soldItems = [...t.drinkOrders, ...t.foodOrders].flatMap((o) =>
      o.items.map((it) => ({ name: it.name, qty: it.qty, price: priceFor(it.id) }))
    );
    completedBills.push({
      tableNumber: t.number,
      sectionId: t.sectionId,
      seatedAt: t.seatedAt,
      items: soldItems,
      subtotal: t.bill.subtotal,
      tip: safeTip,
      total: t.bill.total,
      closedAt: Date.now(),
    });
    broadcastState();
    broadcastManagerState();
    setTimeout(() => {
      logEvent(t, 'visit_ended');
      visitLog.push({
        id: crypto.randomUUID(),
        tableNumber: t.number,
        sectionId: t.sectionId,
        guestName: t.guestName,
        arrivedAt: t.arrivedAt || null,
        seatedAt: t.seatedAt,
        greetedAt: t.greetedAt || null,
        closedAt: Date.now(),
        subtotal: t.bill.subtotal,
        tip: safeTip,
        total: t.bill.total,
        timeline: t.timeline,
      });
      tables[tableId] = freshTable(t.id, t.number, t.sectionId, t.seatType);
      broadcastState();
      broadcastManagerState();
    }, 3500);
  });

  // --- Waiter actions ----------------------------------------------------
  socket.on('waiter:greet', ({ tableId }) => {
    const t = tables[tableId];
    if (!t || t.status !== 'needs_greeting') return;
    t.status = 'seated';
    t.seatedAt = Date.now();
    t.greetedAt = t.seatedAt; // greeting them is what moved them to seated
    logEvent(t, 'seated', t.arrivedAt ? `Waited ${waitLabel(t.seatedAt - t.arrivedAt)}` : null);
    broadcastState();
    broadcastManagerState();
  });

  // Waiter tells the kitchen/bar (and everyone watching) they're on their way
  // to pick up a finished order. Identity comes from the session token.
  socket.on('waiter:coming_to_get', ({ tableId, orderId, kind, token } = {}) => {
    const session = sessions.get(token);
    if (!session || session.role !== 'waiter') return socket.emit('staff:auth_required');
    const t = tables[tableId];
    if (!t) return;
    const order = (kind === 'drink' ? t.drinkOrders : t.foodOrders).find((o) => o.id === orderId);
    if (!order || order.status !== 'ready' || order.comingAt) return;
    const w = WAITERS.find((x) => x.id === session.waiterId);
    order.comingAt = Date.now();
    order.comingBy = w ? w.name : 'Waiter';
    logEvent(t, 'pickup_coming', `${order.comingBy} is picking up the ${kind === 'drink' ? 'drinks' : 'food'}`);
    broadcastState();
    broadcastManagerState();
  });

  // A party seated from the door list hasn't been greeted yet — the waiter
  // confirms once they've actually been to the table.
  socket.on('waiter:mark_greeted', ({ tableId }) => {
    const t = tables[tableId];
    if (!t || t.status !== 'seated' || t.greetedAt !== null) return;
    t.greetedAt = Date.now();
    logEvent(t, 'greeted', t.seatedAt ? `After ${waitLabel(t.greetedAt - t.seatedAt)}` : null);
    broadcastState();
    broadcastManagerState();
  });

  // Bartender makes drinks (new -> preparing -> ready); the waiter carries them out.
  socket.on('bartender:advance_order', ({ tableId, orderId }) => {
    const t = tables[tableId];
    if (!t) return;
    const order = t.drinkOrders.find((o) => o.id === orderId);
    if (!order) return;
    if (order.status === 'new') {
      order.status = 'preparing';
      logEvent(t, 'drink_order_seen', order.items.map((i) => `${i.qty}× ${i.name}`).join(', '));
    } else if (order.status === 'preparing') {
      order.status = 'ready';
      order.readyAt = Date.now();
      prepLog.push({ kind: 'drink', createdAt: order.ts, readyAt: order.readyAt });
    }
    broadcastState();
    broadcastManagerState();
  });

  socket.on('waiter:deliver_drink_order', ({ tableId, orderId }) => {
    const t = tables[tableId];
    if (!t) return;
    const order = t.drinkOrders.find((o) => o.id === orderId);
    // Any undelivered order can be closed out by the waiter (e.g. they
    // grabbed it themselves, or no bartender screen is open).
    if (!order || order.status === 'delivered') return;
    order.status = 'delivered';
    order.deliveredAt = Date.now();
    logEvent(t, 'drink_order_delivered', order.items.map((i) => `${i.qty}× ${i.name}`).join(', '));
    broadcastState();
    broadcastManagerState();
  });

  // Waiter marks a kitchen-prepped food order as delivered once it's carried to the table.
  socket.on('waiter:deliver_food_order', ({ tableId, orderId }) => {
    const t = tables[tableId];
    if (!t) return;
    const order = t.foodOrders.find((o) => o.id === orderId);
    if (!order || order.status === 'delivered') return;
    order.status = 'delivered';
    order.deliveredAt = Date.now();
    logEvent(t, 'food_order_delivered', order.items.map((i) => `${i.qty}× ${i.name}`).join(', '));
    broadcastState();
    broadcastManagerState();
  });

  // Waiter -> customer, one-way. Covers both the one-tap "on my way!" nudge
  // and free-form messages, shown live on the customer's own screen.
  socket.on('waiter:send_message', ({ tableId, text }) => {
    const t = tables[tableId];
    if (!t || t.status !== 'seated') return;
    const clean = String(text || '').trim().slice(0, 200);
    if (!clean) return;
    t.messages.push({ id: crypto.randomUUID(), text: clean, ts: Date.now() });
    logEvent(t, 'waiter_message', clean);
    broadcastState();
    broadcastManagerState();
  });

  // Waiter acknowledges a request — the customer sees "being handled" from here.
  socket.on('waiter:accept_request', ({ tableId, requestId }) => {
    const t = tables[tableId];
    if (!t) return;
    const r = t.requests.find((x) => x.id === requestId);
    if (!r || r.status !== 'open') return;
    r.status = 'accepted';
    r.acceptedAt = Date.now();
    if (r.type !== 'bill') logEvent(t, 'request_accepted', r.type === 'special' ? r.message : REQUEST_TYPES[r.type].label);
    broadcastState();
    broadcastManagerState();
  });

  socket.on('waiter:resolve_request', ({ tableId, requestId }) => {
    const t = tables[tableId];
    if (!t) return;
    const r = t.requests.find((x) => x.id === requestId);
    if (!r || (r.status !== 'open' && r.status !== 'accepted')) return;

    if (r.type === 'bill') {
      // Deliver the bill: compute the total and let the customer take it from here.
      const subtotal = computeSubtotal(t);
      t.bill = { subtotal, tip: 0, total: subtotal, paid: false, deliveredAt: Date.now() };
      logEvent(t, 'bill_delivered', `$${subtotal.toFixed(2)}`);
    } else {
      logEvent(t, 'request_completed', r.type === 'special' ? r.message : REQUEST_TYPES[r.type].label);
    }
    const now = Date.now();
    if (!r.acceptedAt) r.acceptedAt = now; // skipped straight to done — still gives valid analytics
    r.status = 'done';
    r.resolvedAt = now;
    const meta = REQUEST_TYPES[r.type];
    requestLog.push({
      type: r.type,
      label: r.type === 'bill' ? 'Bill' : r.type === 'special' ? r.message : meta.label,
      tableNumber: t.number,
      sectionId: t.sectionId,
      ts: r.ts,
      acceptedAt: r.acceptedAt,
      resolvedAt: now,
    });
    broadcastState();
    broadcastManagerState();
    // Keep the finished request around long enough for the customer to actually
    // see "Done" (and its frozen time) before it clears.
    setTimeout(() => {
      t.requests = t.requests.filter((x) => x.id !== requestId);
      broadcastState();
    }, 30000);
  });

  // --- Kitchen actions -----------------------------------------------------
  socket.on('kitchen:advance_order', ({ tableId, orderId }) => {
    const t = tables[tableId];
    if (!t) return;
    const order = t.foodOrders.find((o) => o.id === orderId);
    if (!order) return;
    if (order.status === 'new') {
      order.status = 'cooking';
      logEvent(t, 'food_order_seen', order.items.map((i) => `${i.qty}× ${i.name}`).join(', '));
    } else if (order.status === 'cooking') {
      order.status = 'ready';
      order.readyAt = Date.now();
      prepLog.push({ kind: 'food', createdAt: order.ts, readyAt: order.readyAt });
    }
    broadcastState();
    broadcastManagerState();
  });
});

server.listen(PORT, () => {
  console.log(`Tap to Serve running on http://localhost:${PORT}`);
  console.log(`Phones on the same Wi-Fi / hotspot: http://${getLanAddress()}:${PORT}/`);
});
