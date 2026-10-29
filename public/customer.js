const params = new URLSearchParams(window.location.search);
const tableId = params.get('table') || 'T1';
const socket = io();

const app = document.getElementById('app');
const tableLabel = document.getElementById('tableLabel');
const statusPill = document.getElementById('statusPill');

let state = null;
let cart = {}; // itemId -> { qty, note }

// Fallback only — every current menu item has its own list below, tailored
// to what actually makes sense to customize on that item.
const PREP_OPTIONS = {
  food: ['No onions', 'No tomatoes'],
  drink: ['No ice', 'Light ice', 'Extra ice'],
};

// Per-item "how I want it" options, specific to each menu item.
const ITEM_PREP_OVERRIDES = {
  // Drinks
  water: ['No ice', 'Extra ice', 'With lemon'],
  soda: ['No ice', 'Light ice', 'Extra ice'],
  tea: ['No ice', 'Extra ice', 'Unsweetened', 'With lemon'],
  coffee: ['Light cream', 'Hot', 'No sugar'],
  beer: ['Extra cold', 'With a lime wedge'],
  wine: ['Chilled', 'Room temperature'],
  cocktail: ['No ice', 'Extra ice', 'Extra strong', 'Virgin (no alcohol)'],

  // Food
  fries: ['Extra ketchup', 'Browned', 'No salt', 'Different topping', 'Other'],
  wings: ['Extra spicy', 'Mild', 'Sauce on the side', 'Extra sauce'],
  nachos: ['No jalapeños', 'Extra cheese', 'No sour cream', 'Extra spicy'],
  salad: ['No onions', 'No tomatoes', 'Dressing on the side', 'No croutons'],
  burger: ['No onions', 'No tomatoes', 'No pickles', 'Well done', 'Medium'],
  pasta: ['Extra sauce', 'No cheese', 'Extra spicy'],
  dessert: ['No nuts', 'Extra whipped cream', 'Sauce on the side'],
};

function prepOptionsFor(item) {
  return ITEM_PREP_OVERRIDES[item.id] || PREP_OPTIONS[item.category] || [];
}

const STATUS_LABEL = {
  empty: 'Unoccupied',
  needs_greeting: 'Waiting for host',
  seated: 'Seated',
};

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

socket.on('customer:auth_required', () => {
  CustomerAuth.clearToken();
  customer = false;
  render();
});

// ---------------------------------------------------------------------------
// End-of-visit survey. Remembered locally, because the table resets a few
// seconds after payment and the page would otherwise lose track of the visit.
// ---------------------------------------------------------------------------
const AFTER_VISIT_KEY = 'tts_after_visit';
const FEEDBACK_DONE_KEY = 'tts_feedback_done';
let surveyDone = false;
const survey = { service: 0, food: 0, back: null, comment: '' };

function getAfterVisit() {
  try {
    const v = JSON.parse(localStorage.getItem(AFTER_VISIT_KEY) || 'null');
    if (!v || v.tableId !== tableId || Date.now() - (v.ts || 0) > 2 * 60 * 60 * 1000) return null;
    return v;
  } catch { return null; }
}
function setAfterVisit(v) {
  try {
    const done = JSON.parse(localStorage.getItem(FEEDBACK_DONE_KEY) || '[]');
    if (done.includes(v.feedbackId)) return;
    const cur = getAfterVisit();
    if (cur && cur.feedbackId === v.feedbackId) return;
    localStorage.setItem(AFTER_VISIT_KEY, JSON.stringify({ ...v, ts: Date.now() }));
  } catch {}
}
function finishAfterVisit(feedbackId) {
  try {
    const done = JSON.parse(localStorage.getItem(FEEDBACK_DONE_KEY) || '[]');
    done.push(feedbackId);
    localStorage.setItem(FEEDBACK_DONE_KEY, JSON.stringify(done.slice(-20)));
    localStorage.removeItem(AFTER_VISIT_KEY);
  } catch {}
}

function starRow(current, onPick) {
  const row = document.createElement('div');
  row.className = 'star-row';
  [1, 2, 3, 4, 5].forEach((n) => {
    const b = document.createElement('button');
    b.className = 'star-btn' + (n <= current ? ' on' : '');
    b.textContent = '★';
    b.setAttribute('aria-label', `${n} stars`);
    b.addEventListener('click', () => onPick(n));
    row.appendChild(b);
  });
  return row;
}

function renderSurvey(fb) {
  app.innerHTML = '';
  const intro = document.createElement('div');
  intro.className = 'waiting-block';
  intro.style.cssText = 'flex:none; min-height:0; padding:18px 0 4px;';
  intro.innerHTML = `<div class="big-emoji">🙏</div><h1>Thanks — you're all paid!</h1><p>Two quick questions about your visit. It takes 20 seconds.</p>`;
  app.appendChild(intro);

  const card = document.createElement('div');
  card.className = 'complaint-card';
  const q = (text) => { const t = document.createElement('div'); t.className = 'section-title'; t.style.margin = '10px 0 4px'; t.textContent = text; return t; };

  card.appendChild(q('How was our service?'));
  card.appendChild(starRow(survey.service, (n) => { survey.service = n; renderSurvey(fb); }));
  card.appendChild(q('How were the food and drinks?'));
  card.appendChild(starRow(survey.food, (n) => { survey.food = n; renderSurvey(fb); }));

  card.appendChild(q('Would you come back?'));
  const chips = document.createElement('div');
  chips.className = 'chip-row';
  [['yes', '👍 Yes'], ['maybe', '🤔 Maybe'], ['no', '👎 No']].forEach(([val, label]) => {
    const b = document.createElement('button');
    b.className = 'chip' + (survey.back === val ? ' selected' : '');
    b.textContent = label;
    b.addEventListener('click', () => { survey.back = val; renderSurvey(fb); });
    chips.appendChild(b);
  });
  card.appendChild(chips);

  card.appendChild(q('Anything we could do better? (optional)'));
  const input = document.createElement('textarea');
  input.className = 'pin-input';
  input.rows = 3;
  input.maxLength = 300;
  input.placeholder = 'Tell us what went well or what to fix…';
  input.style.cssText = 'letter-spacing:normal; font-size:14px; text-align:left; padding:10px 12px; width:100%; box-sizing:border-box; resize:vertical;';
  input.value = survey.comment;
  input.addEventListener('input', () => { survey.comment = input.value; });
  card.appendChild(input);

  const send_ = document.createElement('button');
  send_.className = 'send-order-btn';
  send_.style.cssText = 'width:100%; margin-top:12px;';
  send_.disabled = survey.service === 0;
  send_.textContent = survey.service === 0 ? 'Pick a service rating to send' : 'Send feedback';
  send_.addEventListener('click', () => {
    socket.emit('customer:feedback', { feedbackId: fb.feedbackId, service: survey.service, food: survey.food, wouldReturn: survey.back, comment: survey.comment });
    finishAfterVisit(fb.feedbackId);
    Object.assign(survey, { service: 0, food: 0, back: null, comment: '' });
    surveyDone = true;
    render();
  });
  card.appendChild(send_);

  const skip = document.createElement('button');
  skip.className = 'bill-btn';
  skip.style.cssText = 'width:100%; margin-top:8px;';
  skip.textContent = 'Skip';
  skip.addEventListener('click', () => {
    finishAfterVisit(fb.feedbackId);
    surveyDone = true;
    render();
  });
  card.appendChild(skip);
  app.appendChild(card);
}

function renderSurveyThanks() {
  app.innerHTML = `
    <div class="thankyou">
      <div class="big-emoji">🎉</div>
      <h1>Thank you!</h1>
      <p>We appreciate you. See you again soon!</p>
    </div>
    <button class="bill-btn" id="surveyDoneBtn" style="width:100%; margin-top:14px;">Done</button>`;
  document.getElementById('surveyDoneBtn').addEventListener('click', () => { surveyDone = false; render(); });
}

function send(event, payload) {
  socket.emit(event, { tableId, ...payload });
}

function render() {
  if (!state) return;
  const table = state.tables[tableId];
  if (!table) {
    app.innerHTML = `<p>Unknown table.</p>`;
    return;
  }
  const section = state.sections.find((s) => s.id === table.sectionId);
  tableLabel.textContent = `Table ${table.number}`;
  statusPill.textContent = STATUS_LABEL[table.status] || table.status;
  statusPill.style.background = section.color + '33';
  statusPill.style.color = section.color;

  // End-of-visit survey: shown as soon as the bill is paid, and kept after the table resets.
  if (surveyDone) {
    if (table.status === 'empty' || (table.bill && table.bill.paid)) { renderSurveyThanks(); return; }
    surveyDone = false;
  }
  if (table.bill && table.bill.paid && table.bill.feedbackId && !table.bill.alreadyRated) {
    setAfterVisit({ feedbackId: table.bill.feedbackId, tableId, tableNumber: table.number });
  }
  const pendingSurvey = getAfterVisit();
  if (pendingSurvey && (table.status === 'empty' || (table.bill && table.bill.paid))) {
    renderSurvey(pendingSurvey);
    return;
  }

  if (table.status === 'empty') {
    // An account is required to claim a table.
    if (customer === null) return; // still checking saved session
    if (!customer) {
      CustomerAuth.renderLogin(app, (c) => {
        customer = c;
        render();
      });
      return;
    }
    app.innerHTML = `
      <div class="waiting-block">
        <div class="big-emoji">🍽️</div>
        <h1>Welcome!</h1>
        <p>Tap below when your party is ready to be seated. Your host will come right over.</p>
        <button class="big-btn" id="arriveBtn">We're here — seat us</button>
      </div>`;
    document.getElementById('arriveBtn').addEventListener('click', () =>
      send('customer:arrive', { customerToken: CustomerAuth.getToken() })
    );
    app.prepend(
      CustomerAuth.greetingBar(() => {
        customer = false;
        render();
      })
    );
    return;
  }

  if (table.status === 'needs_greeting') {
    app.innerHTML = `
      <div class="waiting-block">
        <div class="big-emoji">👋</div>
        <h1>You're on the list!</h1>
        <p>Your waiter has been notified and is on the way to seat you.</p>
      </div>
      <div style="border-top:1px solid var(--border); margin-top:-8px; padding-top:16px; text-align:center;">
        <p style="color:var(--muted); font-size:12px; margin-bottom:10px;">TESTING ONLY — in the real app, a waiter does this step for you.</p>
        <button class="bill-btn" id="selfGreetBtn">Skip the wait — seat myself</button>
      </div>`;
    document.getElementById('selfGreetBtn').addEventListener('click', () => send('waiter:greet'));
    return;
  }

  // Seated: full app
  // One call only: Alerts.process remembers just the last set of keys it saw.
  Alerts.process([
    ...(table.messages || []).map((m) => ({ key: `msg:${m.id}`, text: `💬 ${m.from === 'manager' ? 'Manager' : 'Waiter'}: ${m.text}` })),
    ...table.requests
      .filter((r) => r.status === 'done')
      .map((r) => ({
        key: `done:${r.id}`,
        text: `✅ Done: ${r.type === 'special' ? r.message : (state.requestTypes[r.type] || {}).label || 'Your request'}`,
      })),
  ]);
  app.innerHTML = '';
  app.appendChild(renderWaiterMessagesSection(table));
  app.appendChild(renderBillOrThankYou(table));
  if (!table.bill) {
    app.appendChild(renderMenuSection('drink', 'Order Drinks'));
    app.appendChild(renderMenuSection('food', 'Order Food'));
    app.appendChild(renderSpecialRequestBox(table));
    app.appendChild(renderSendOrderButton());
    app.appendChild(renderOrderStatus(table));
    app.appendChild(renderRequests(table));
    app.appendChild(renderServiceReviewBox(table));
    app.appendChild(renderVisitTimelineSection(table));
    app.appendChild(renderComplaintBox(table));
    app.appendChild(renderSuggestionBox());
  } else if (!table.bill.paid) {
    app.appendChild(renderServiceReviewBox(table));
    app.appendChild(renderSuggestionBox());
  }
}

// ---------------------------------------------------------------------------
// Menu pictures. A real photo is used when one has been added for the item
// (public/images/menu/<id>.jpg); otherwise a clear illustration tile stands in.
// Tapping either opens a full-size viewer with the description.
// ---------------------------------------------------------------------------
const MENU_EMOJI = {
  water: '💧', soda: '🥤', tea: '🧊', coffee: '☕', beer: '🍺', wine: '🍷', cocktail: '🍸',
  fries: '🍟', wings: '🍗', nachos: '🧀', salad: '🥗', burger: '🍔', pasta: '🍝', dessert: '🍰',
};

function itemPhotoHtml(item, cls) {
  if (item.photo) {
    return `<img class="${cls}" src="${item.photo}" alt="${item.name}" loading="lazy" />`;
  }
  return `<div class="${cls} placeholder" role="img" aria-label="${item.name}">${MENU_EMOJI[item.id] || '🍽️'}</div>`;
}

let itemViewer = null;

function ensureItemViewer() {
  if (itemViewer) return itemViewer;
  itemViewer = document.createElement('div');
  itemViewer.className = 'item-viewer';
  itemViewer.style.display = 'none';
  itemViewer.innerHTML = `
    <div class="item-viewer-card" role="dialog" aria-modal="true">
      <button class="item-viewer-close" aria-label="Close">✕</button>
      <div class="item-viewer-media"></div>
      <div class="item-viewer-body">
        <div class="item-viewer-name"></div>
        <div class="item-viewer-price"></div>
        <div class="item-viewer-desc"></div>
        <div class="item-viewer-actions">
          <button class="item-viewer-add">Add to order</button>
          <span class="item-viewer-count"></span>
        </div>
      </div>
    </div>`;
  document.body.appendChild(itemViewer);
  itemViewer.addEventListener('click', (e) => {
    if (e.target === itemViewer || e.target.closest('.item-viewer-close')) closeItemViewer();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeItemViewer();
  });
  return itemViewer;
}

function closeItemViewer() {
  if (itemViewer) itemViewer.style.display = 'none';
}

function openItemViewer(itemId) {
  const item = state.menu.find((m) => m.id === itemId);
  if (!item) return;
  const v = ensureItemViewer();
  v.querySelector('.item-viewer-media').innerHTML = itemPhotoHtml(item, 'item-viewer-photo');
  v.querySelector('.item-viewer-name').textContent = item.name;
  v.querySelector('.item-viewer-price').textContent = item.price === 0 ? 'Free' : `$${item.price.toFixed(2)}`;
  v.querySelector('.item-viewer-desc').textContent = item.desc || '';
  const count = v.querySelector('.item-viewer-count');
  const updateCount = () => {
    const n = cart[item.id] ? cart[item.id].qty : 0;
    count.textContent = n ? `${n} in your order` : '';
  };
  updateCount();
  const add = v.querySelector('.item-viewer-add');
  add.onclick = () => {
    const current = cart[item.id] || { qty: 0, note: '' };
    current.qty += 1;
    cart[item.id] = current;
    render();
    updateCount();
  };
  v.style.display = 'flex';
}

function renderMenuSection(category, heading) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="section-title">${heading}</div>`;
  const grid = document.createElement('div');
  grid.className = 'menu-grid';

  state.menu
    .filter((item) => item.category === category)
    .forEach((item) => {
      const entry = cart[item.id];
      const qty = entry ? entry.qty : 0;
      const options = prepOptionsFor(item);
      const hasOther = options.includes('Other');
      const currentNote = entry?.note || '';
      const isOther = hasOther && currentNote !== '' && !options.includes(currentNote);

      const card = document.createElement('div');
      card.className = 'menu-item';
      card.innerHTML = `
        <div class="menu-photo-wrap" data-view="${item.id}">${itemPhotoHtml(item, 'menu-photo')}<span class="menu-photo-badge">🔍</span></div>
        <div class="name" data-view="${item.id}">${item.name}</div>
        <div class="price">${item.price === 0 ? 'Free' : '$' + item.price.toFixed(2)}</div>
        <div class="qty-row">
          <button data-action="dec" data-id="${item.id}">−</button>
          <div class="qty">${qty}</div>
          <button data-action="inc" data-id="${item.id}">+</button>
        </div>
        ${qty > 0 ? `<select class="prep-select" data-note-id="${item.id}">
          <option value="">How I want it…</option>
          ${options.map((opt) => `<option value="${opt}">${opt}</option>`).join('')}
        </select>
        ${hasOther ? `<input class="prep-select" data-other-id="${item.id}" placeholder="Please specify…" style="margin-top:6px; display:${isOther ? 'block' : 'none'};" />` : ''}` : ''}`;
      grid.appendChild(card);

      const select = card.querySelector('.prep-select[data-note-id]');
      const otherInput = card.querySelector('input[data-other-id]');
      if (select) {
        select.value = isOther ? 'Other' : currentNote;
        if (otherInput && isOther) otherInput.value = currentNote;

        select.addEventListener('change', (e) => {
          const val = e.target.value;
          if (val === 'Other') {
            if (cart[item.id]) cart[item.id].note = otherInput ? otherInput.value : '';
            if (otherInput) {
              otherInput.style.display = 'block';
              otherInput.focus();
            }
          } else {
            if (cart[item.id]) cart[item.id].note = val;
            if (otherInput) otherInput.style.display = 'none';
          }
        });

        if (otherInput) {
          otherInput.addEventListener('input', (e) => {
            if (cart[item.id]) cart[item.id].note = e.target.value;
          });
        }
      }
    });

  wrap.appendChild(grid);

  wrap.addEventListener('click', (e) => {
    const view = e.target.closest('[data-view]');
    if (view) {
      openItemViewer(view.dataset.view);
      return;
    }
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const delta = btn.dataset.action === 'inc' ? 1 : -1;
    const current = cart[id] || { qty: 0, note: '' };
    current.qty = Math.max(0, current.qty + delta);
    if (current.qty === 0) delete cart[id];
    else cart[id] = current;
    render();
  });

  return wrap;
}

function renderSendOrderButton() {
  const wrap = document.createElement('div');
  wrap.className = 'order-bar';
  const totalQty = Object.values(cart).reduce((a, c) => a + c.qty, 0);
  const cartTotal = Object.entries(cart).reduce((sum, [id, c]) => {
    const item = state.menu.find((m) => m.id === id);
    return sum + (item ? item.price * c.qty : 0);
  }, 0);

  if (totalQty > 0) {
    wrap.classList.add('has-items'); // floats at the bottom of the screen while choosing
    const totalLine = document.createElement('div');
    totalLine.className = 'bill-line';
    totalLine.style.cssText = 'padding: 0 2px 10px;';
    totalLine.innerHTML = `<span>Estimated Total</span><span style="font-weight:800; color:var(--text);">$${cartTotal.toFixed(2)}</span>`;
    wrap.appendChild(totalLine);
  }

  const sendBtn = document.createElement('button');
  sendBtn.className = 'send-order-btn';
  sendBtn.style.width = '100%';
  sendBtn.disabled = totalQty === 0;
  sendBtn.textContent = totalQty === 0 ? 'Select items to order' : `Send Order (${totalQty})`;
  sendBtn.addEventListener('click', () => {
    const items = Object.entries(cart).map(([id, c]) => {
      const menuItem = state.menu.find((m) => m.id === id);
      return { id, name: menuItem.name, qty: c.qty, note: c.note || undefined };
    });
    if (items.length === 0) return;
    send('customer:order_items', { items });
    cart = {};
  });
  wrap.appendChild(sendBtn);
  return wrap;
}

function renderOrderStatus(table) {
  const wrap = document.createElement('div');
  const allOrders = [...table.drinkOrders, ...table.foodOrders];
  if (allOrders.length === 0) return wrap;
  wrap.innerHTML = `<div class="section-title">Your Orders</div>`;
  const list = document.createElement('div');
  list.className = 'order-list';
  allOrders
    .slice()
    .sort((a, b) => b.ts - a.ts)
    .forEach((order) => {
      const row = document.createElement('div');
      row.className = 'order-row';
      const itemsText = order.items.map(formatItemLine).join(', ');
      const clock =
        order.status === 'delivered' && order.deliveredAt
          ? `<span class="order-clock">Took ${durationLabel(order.deliveredAt - order.ts)}</span>`
          : `<span class="order-clock" data-order-ts="${order.ts}"></span>`;
      row.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; min-width:0;">
          <div class="items">${itemsText}</div>
          ${clock}
        </div>
        <div class="status-tag ${order.status}">${order.status}</div>`;
      list.appendChild(row);
    });
  wrap.appendChild(list);
  return wrap;
}

function formatItemLine(i) {
  return `${i.qty}× ${i.name}${i.note ? ` (${i.note})` : ''}`;
}

function renderWaiterMessagesSection(table) {
  const wrap = document.createElement('div');
  if (!table.messages || !table.messages.length) return wrap;
  const fromManager = table.messages.some((m) => m.from === 'manager');
  wrap.innerHTML = `<div class="section-title">💬 ${fromManager ? 'From Your Team' : 'From Your Waiter'}</div>`;
  const list = document.createElement('div');
  list.className = 'order-list';
  table.messages
    .slice()
    .reverse()
    .forEach((m) => {
      const row = document.createElement('div');
      row.className = 'order-row' + (m.from === 'manager' ? ' manager-msg' : '');
      row.innerHTML = `
        <div class="items">${m.from === 'manager' ? '<b>📣 Manager:</b> ' : ''}${CustomerAuth.escapeHtml(m.text)}</div>
        <span class="order-clock" data-order-ts="${m.ts}"></span>`;
      list.appendChild(row);
    });
  wrap.appendChild(list);
  return wrap;
}

function renderVisitTimelineSection(table) {
  const wrap = document.createElement('div');
  if (!table.timeline || !table.timeline.length) return wrap;
  wrap.innerHTML = `<div class="section-title">Your Visit So Far</div>`;
  wrap.appendChild(renderVisitTimeline(table.timeline));
  return wrap;
}

const REQUEST_ORDER = ['service', 'utensils', 'ketchup', 'napkins', 'clean', 'bathroom'];

function renderRequests(table) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="section-title">Need Something?</div>`;
  const grid = document.createElement('div');
  grid.className = 'requests-grid';

  REQUEST_ORDER.forEach((type) => {
    const meta = state.requestTypes[type];
    const pending = table.requests.find((r) => r.type === type && (r.status === 'open' || r.status === 'accepted'));
    // Most recent finished one, shown only when nothing of this type is still open.
    const finished = pending
      ? null
      : table.requests
          .filter((r) => r.type === type && r.status === 'done')
          .sort((a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0))[0];
    const btn = document.createElement('button');
    btn.className = 'request-btn' + (pending ? ' active' : finished ? ' finished' : '');
    btn.innerHTML = `
      <div class="emoji">${meta.icon}</div>
      <div>${meta.label}</div>
      ${!pending && !finished && meta.hint ? `<div class="request-hint">${meta.hint}</div>` : ''}
      ${pending ? `
        <div class="status-label">${pending.status === 'accepted' ? 'Being handled' : 'Sent — waiting'}</div>
        <span class="order-clock" data-order-ts="${pending.ts}"></span>
      ` : finished ? `
        <div class="status-label done-label">✓ Done</div>
        <span class="order-clock">Took ${durationLabel((finished.resolvedAt || finished.acceptedAt || finished.ts) - finished.ts)}</span>
      ` : ''}`;
    btn.disabled = !!pending;
    btn.addEventListener('click', () => send('customer:request', { type }));
    grid.appendChild(btn);
  });

  wrap.appendChild(grid);

  const billPending = table.requests.find((r) => r.type === 'bill' && (r.status === 'open' || r.status === 'accepted'));
  const billBtn = document.createElement('button');
  billBtn.className = 'bill-btn' + (billPending ? ' active' : '');
  billBtn.style.marginTop = '14px';
  billBtn.style.width = '100%';
  billBtn.disabled = !!billPending;
  billBtn.innerHTML = billPending
    ? `🧾 ${billPending.status === 'accepted' ? 'Bill is being handled' : 'Bill requested — sent'} <span class="order-clock" data-order-ts="${billPending.ts}"></span>`
    : '🧾 Request the Bill';
  billBtn.addEventListener('click', () => send('customer:request_bill'));
  wrap.appendChild(billBtn);

  return wrap;
}

let selectedTip = null;
let selectedStars = 0;
let ratingComment = '';

function renderBillOrThankYou(table) {
  const wrap = document.createElement('div');
  if (!table.bill) return wrap;

  if (table.bill.paid) {
    wrap.innerHTML = `
      <div class="thankyou">
        <div class="big-emoji">🎉</div>
        <h1>Thank you!</h1>
        <p>Your bill has been paid. See you again soon!</p>
      </div>`;
    return wrap;
  }

  const tipOptions = [15, 18, 20, 25];
  const subtotal = table.bill.subtotal;
  const deposit = table.bill.deposit || 0;
  const tipAmount = selectedTip === null ? 0 : selectedTip === 'custom' ? 0 : Math.round(subtotal * (selectedTip / 100) * 100) / 100;

  wrap.innerHTML = `<div class="section-title" style="display:flex; align-items:center; justify-content:space-between;">Your Bill — Table ${table.number} <span class="order-clock" data-order-ts="${table.bill.deliveredAt}" style="text-transform:none; letter-spacing:normal;"></span></div>`;
  const card = document.createElement('div');
  card.className = 'bill-card';
  card.innerHTML = `
    <div class="bill-line"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
    <div class="bill-line"><span>Tip</span><span id="tipAmountLabel">$${tipAmount.toFixed(2)}</span></div>
    <div class="bill-line total"><span>Total</span><span id="totalLabel">$${(subtotal + tipAmount).toFixed(2)}</span></div>
    ${deposit > 0 ? `<div class="bill-line"><span>Paid up front (pre-order)</span><span style="color:var(--good);">−$${deposit.toFixed(2)}</span></div>
    <div class="bill-line total"><span>Due now</span><span id="dueLabel">$${Math.max(0, subtotal + tipAmount - deposit).toFixed(2)}</span></div>` : ''}
    <div class="section-title" style="margin-top:4px;">Add a Tip</div>
    <div class="tip-row" id="tipRow">
      ${tipOptions.map((p) => `<button class="tip-btn" data-pct="${p}">${p}%</button>`).join('')}
    </div>
    <button class="pay-btn" id="payBtn">Pay &amp; Close Bill</button>
  `;
  wrap.appendChild(card);

  card.querySelectorAll('.tip-btn').forEach((b) => {
    if (String(selectedTip) === b.dataset.pct) b.classList.add('selected');
    b.addEventListener('click', () => {
      selectedTip = Number(b.dataset.pct);
      render();
    });
  });

  card.querySelector('#payBtn').addEventListener('click', () => {
    const tip = selectedTip === null ? 0 : Math.round(subtotal * (selectedTip / 100) * 100) / 100;
    send('customer:pay', { tip });
  });

  return wrap;
}

// Available the whole time they're seated — not held back until the bill —
// so feedback can be left the moment it happens, not forced to wait.
function renderServiceReviewBox(table) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="section-title">Rate Your Service</div>`;
  const card = document.createElement('div');
  card.className = 'complaint-card';

  if (table.rated) {
    card.innerHTML = `<div style="text-align:center; color:var(--good); font-size:14px; padding:4px 0;">✅ Thanks — your review has been sent to the manager.</div>`;
    wrap.appendChild(card);
    return wrap;
  }

  card.innerHTML = `
    <div class="star-row" id="liveStarRow">
      ${[1, 2, 3, 4, 5].map((n) => `<button class="star-btn ${n <= selectedStars ? 'on' : ''}" data-star="${n}" aria-label="${n} stars">★</button>`).join('')}
    </div>
    <input class="pin-input" id="liveRatingComment" maxlength="200" placeholder="How's it going so far? (optional)" style="letter-spacing:normal; font-size:14px; text-align:left; padding:10px 12px;" />
    <button class="bill-btn" id="liveReviewSubmit" style="width:100%;" ${selectedStars === 0 ? 'disabled' : ''}>⭐ ${selectedStars === 0 ? 'Pick a star rating first' : 'Submit Review'}</button>
  `;
  wrap.appendChild(card);

  const commentInput = card.querySelector('#liveRatingComment');
  commentInput.value = ratingComment;
  commentInput.addEventListener('input', (e) => { ratingComment = e.target.value; });

  card.querySelectorAll('.star-btn').forEach((b) => {
    b.addEventListener('click', () => {
      selectedStars = Number(b.dataset.star);
      render();
    });
  });

  card.querySelector('#liveReviewSubmit').addEventListener('click', () => {
    if (selectedStars === 0) return;
    send('customer:rate', { stars: selectedStars, comment: ratingComment });
    selectedStars = 0;
    ratingComment = '';
  });

  return wrap;
}

function renderSuggestionBox() {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="section-title">Anonymous Suggestion Box</div>`;
  const card = document.createElement('div');
  card.className = 'complaint-card';
  card.innerHTML = `
    <textarea id="suggestText" class="complaint-input" maxlength="500" placeholder="Ideas or feedback for the restaurant. This is anonymous — we don't record your table or name."></textarea>
    <button class="bill-btn" id="suggestSubmit" style="width:100%;">💡 Drop it in the box</button>
    <div id="suggestThanks" style="display:none; color:var(--good); font-size:13px; text-align:center;">Thank you — sent anonymously.</div>
  `;
  wrap.appendChild(card);
  card.querySelector('#suggestSubmit').addEventListener('click', () => {
    const ta = card.querySelector('#suggestText');
    const message = ta.value.trim();
    if (!message) return;
    // Intentionally no tableId: the server never learns where this came from.
    socket.emit('customer:suggest', { message });
    ta.value = '';
    const thanks = card.querySelector('#suggestThanks');
    thanks.style.display = 'block';
    setTimeout(() => { thanks.style.display = 'none'; }, 4000);
  });
  return wrap;
}

function renderSpecialRequestBox(table) {
  const wrap = document.createElement('div');
  const mySpecials = table.requests.filter((r) => r.type === 'special');

  wrap.innerHTML = `<div class="section-title">Special Request</div>`;
  const card = document.createElement('div');
  card.className = 'complaint-card';
  card.innerHTML = `
    <input id="specialText" class="pin-input" style="letter-spacing:normal; font-size:15px; text-align:left; padding:12px 14px;" maxlength="200" placeholder="Allergy, high chair, birthday candle…" />
    <button class="bill-btn" id="specialSubmit" style="width:100%;">⭐ Send to Waiter</button>
  `;
  wrap.appendChild(card);

  card.querySelector('#specialSubmit').addEventListener('click', () => {
    const input = card.querySelector('#specialText');
    const message = input.value.trim();
    if (!message) return;
    send('customer:special_request', { message });
    input.value = '';
  });

  if (mySpecials.length) {
    const list = document.createElement('div');
    list.className = 'order-list';
    list.style.marginTop = '10px';
    mySpecials
      .slice()
      .reverse()
      .forEach((r) => {
        const row = document.createElement('div');
        row.className = 'order-row';
        const label = r.status === 'open' ? 'Sent' : r.status === 'accepted' ? 'Being handled' : '✓ Done';
        const tag = r.status === 'open' ? 'new' : r.status === 'accepted' ? 'preparing' : 'delivered';
        const clock =
          r.status === 'done'
            ? `<span class="order-clock">Took ${durationLabel((r.resolvedAt || r.acceptedAt || r.ts) - r.ts)}</span>`
            : `<span class="order-clock" data-order-ts="${r.ts}"></span>`;
        row.innerHTML = `
          <div style="display:flex; align-items:center; gap:8px; min-width:0;">
            <div class="items">${CustomerAuth.escapeHtml(r.message)}</div>
            ${clock}
          </div>
          <div class="status-tag ${tag}">${label}</div>`;
        list.appendChild(row);
      });
    wrap.appendChild(list);
  }

  return wrap;
}

function renderComplaintBox(table) {
  const wrap = document.createElement('div');
  const myComplaints = (state.complaints || []).filter((c) => c.tableId === tableId);

  wrap.innerHTML = `<div class="section-title">Something Not Right?</div>`;
  const card = document.createElement('div');
  card.className = 'complaint-card';
  card.innerHTML = `
    <textarea id="complaintText" class="complaint-input" maxlength="300" placeholder="Tell us what happened — a manager will see this right away."></textarea>
    <button class="bill-btn" id="complaintSubmit" style="width:100%;">🚩 Send to Manager</button>
  `;
  wrap.appendChild(card);

  card.querySelector('#complaintSubmit').addEventListener('click', () => {
    const textarea = card.querySelector('#complaintText');
    const message = textarea.value.trim();
    if (!message) return;
    send('customer:complaint', { message });
    textarea.value = '';
  });

  if (myComplaints.length) {
    const list = document.createElement('div');
    list.className = 'order-list';
    list.style.marginTop = '10px';
    myComplaints
      .slice()
      .reverse()
      .forEach((c) => {
        const row = document.createElement('div');
        row.className = 'order-row';
        const complaintClock =
          c.status === 'open'
            ? `<span class="order-clock" data-order-ts="${c.ts}"></span>`
            : `<span class="order-clock">Took ${durationLabel((c.resolvedAt || c.ts) - c.ts)}</span>`;
        row.innerHTML = `
          <div style="display:flex; align-items:center; gap:8px; min-width:0;">
            <div class="items">${CustomerAuth.escapeHtml(c.message)}</div>
            ${complaintClock}
          </div>
          <div class="status-tag ${c.status === 'open' ? 'new' : 'delivered'}">${c.status === 'open' ? 'Sent' : 'Handled'}</div>`;
        list.appendChild(row);
      });
    wrap.appendChild(list);
  }

  return wrap;
}
