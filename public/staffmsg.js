// Private manager -> staff inbox, shared by the waiter, kitchen and bar pages.
// Messages arrive over a dedicated socket channel that only logged-in staff can
// subscribe to (the server checks the session token), so customers never see
// them. Unread ones sit in a pinned box under the top bar until acknowledged.
const StaffMessages = (() => {
  let socket = null;
  let getToken = () => null;
  let onAuthFail = () => {};
  let active = false;
  let subscribedToken = null;
  let list = [];
  let seen = null; // ids already on screen, so only genuinely new ones chime
  let box = null;

  function ensureBox() {
    if (box && document.body.contains(box)) return box;
    box = document.createElement('div');
    box.id = 'staffMsgBox';
    box.className = 'staff-msg-box';
    const top = document.querySelector('.topbar');
    if (top && top.parentNode) top.parentNode.insertBefore(box, top.nextSibling);
    else document.body.prepend(box);
    return box;
  }

  function clockRow(ts) {
    const c = document.createElement('span');
    c.className = 'order-clock';
    c.dataset.orderTs = ts;
    return c;
  }

  function render() {
    const el = ensureBox();
    el.innerHTML = '';
    if (!active || !list.length) {
      el.style.display = 'none';
      return;
    }
    const unread = list.filter((m) => !m.acked);
    const earlier = list.filter((m) => m.acked);
    el.style.display = unread.length || earlier.length ? 'block' : 'none';

    unread.forEach((m) => {
      const card = document.createElement('div');
      card.className = 'staff-msg unread';
      const head = document.createElement('div');
      head.className = 'staff-msg-head';
      head.textContent = `📢 Manager → ${m.toLabel}`;
      head.appendChild(clockRow(m.ts));
      const text = document.createElement('div');
      text.className = 'staff-msg-text';
      text.textContent = m.text;
      const btn = document.createElement('button');
      btn.className = 'staff-msg-btn';
      btn.textContent = 'Got it';
      btn.addEventListener('click', () => {
        btn.disabled = true;
        socket.emit('staff:ack_message', { token: getToken(), messageId: m.id });
      });
      card.append(head, text, btn);
      el.appendChild(card);
    });

    if (earlier.length) {
      const d = document.createElement('details');
      d.className = 'staff-msg-earlier';
      const s = document.createElement('summary');
      s.textContent = `Earlier messages from the manager (${earlier.length})`;
      d.appendChild(s);
      earlier.forEach((m) => {
        const row = document.createElement('div');
        row.className = 'staff-msg read';
        const head = document.createElement('div');
        head.className = 'staff-msg-head';
        head.textContent = m.toLabel;
        head.appendChild(clockRow(m.ts));
        const text = document.createElement('div');
        text.className = 'staff-msg-text';
        text.textContent = m.text;
        row.append(head, text);
        d.appendChild(row);
      });
      el.appendChild(d);
    }
  }

  function handle(msgs) {
    if (!active) return;
    const ids = new Set(msgs.map((m) => m.id));
    const fresh = seen === null ? [] : msgs.filter((m) => !m.acked && !seen.has(m.id));
    seen = ids;
    list = msgs;
    render();
    if (fresh.length) {
      Alerts.ring();
      fresh.slice(0, 2).forEach((m) => Alerts.toast(`📢 Manager: ${m.text}`));
    }
  }

  function subscribe() {
    const token = getToken();
    if (!token) return;
    subscribedToken = token;
    socket.emit('staff:subscribe', { token });
  }

  return {
    init(opts) {
      socket = opts.socket;
      getToken = opts.getToken;
      onAuthFail = opts.onAuthFail || (() => {});
      socket.on('staff:messages', handle);
      socket.on('connect', () => { if (active) subscribe(); });
      socket.on('staff:auth_required', () => { if (active) onAuthFail(); });
    },
    // Safe to call on every render: only re-subscribes when the token changes.
    start() {
      const token = getToken();
      if (active && token === subscribedToken) return;
      active = true;
      subscribe();
    },
    stop() {
      if (!active) return;
      active = false;
      subscribedToken = null;
      list = [];
      seen = null;
      socket.emit('staff:unsubscribe');
      render();
    },
  };
})();
