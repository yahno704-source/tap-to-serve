// Customer account login/sign-up, shared by checkin.html and customer.html.
// Exposes window.CustomerAuth.
(function () {
  const TOKEN_KEY = 'tts_customer_token';
  let memToken = null; // fallback when localStorage is blocked (private browsing)
  let current = null; // { id, name, visits } once verified

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || memToken; } catch { return memToken; }
  }
  function setToken(t) {
    memToken = t;
    try { localStorage.setItem(TOKEN_KEY, t); } catch {}
  }
  function clearToken() {
    memToken = null;
    current = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
  }

  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Resolves to the logged-in customer, or null if there's no valid session.
  async function verify() {
    const token = getToken();
    if (!token) return null;
    try {
      const res = await fetch('/api/customer/me', { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) { clearToken(); return null; }
      const data = await res.json();
      current = data.ok ? data.customer : null;
      return current;
    } catch {
      return null; // network blip — don't wipe the token
    }
  }

  async function logout() {
    const token = getToken();
    clearToken();
    try {
      await fetch('/api/customer/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    } catch {}
  }

  // Renders a single phone+PIN form — no login/signup toggle. First-time
  // numbers are registered transparently in the same submit, since making a
  // guest guess whether they "have an account yet" is pure friction at a
  // table. A wrong PIN on a *known* number is the only case that still shows
  // an error, because that's a real credential mismatch, not a missing account.
  function renderLogin(container, onSuccess) {
    container.innerHTML = `
      <div class="waiting-block" style="max-width:340px; margin:24px auto;">
        <div class="big-emoji">👋</div>
        <h1>Welcome!</h1>
        <p>Enter your phone and a 4-digit PIN. First time here? We'll set you up automatically — no extra step.</p>
        <form id="custAuthForm" style="display:flex; flex-direction:column; gap:10px; width:100%;">
          <input id="custName" class="pin-input auth-field" autocomplete="name" maxlength="40" placeholder="Your name (first time only)" />
          <input id="custPhone" class="pin-input auth-field" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="Phone number" />
          <input id="custPin" class="pin-input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="current-password" placeholder="4-digit PIN" />
          <div id="custError" style="color:var(--danger); font-size:13px; min-height:18px;"></div>
          <button class="big-btn" type="submit" id="custSubmit">Continue</button>
        </form>
      </div>`;

    const form = container.querySelector('#custAuthForm');
    const errorEl = container.querySelector('#custError');
    const submitBtn = container.querySelector('#custSubmit');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = container.querySelector('#custName').value.trim();
      const phone = container.querySelector('#custPhone').value.trim();
      const pin = container.querySelector('#custPin').value.trim();
      if (phone.replace(/\D/g, '').length < 7) { errorEl.textContent = 'Enter your phone number.'; return; }
      if (!/^\d{4}$/.test(pin)) { errorEl.textContent = 'PIN must be 4 digits.'; return; }

      submitBtn.disabled = true;
      errorEl.textContent = '';
      try {
        let res = await fetch('/api/customer/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, pin }),
        });
        let data = await res.json();

        if (!data.ok && data.noAccount) {
          // First time at this number — register with the same tap, same PIN.
          res = await fetch('/api/customer/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name || 'Guest', phone, pin }),
          });
          data = await res.json();
        }

        if (!data.ok) {
          errorEl.textContent = data.error || 'Something went wrong.';
          submitBtn.disabled = false;
          return;
        }
        setToken(data.token);
        current = data.customer;
        onSuccess(current);
      } catch {
        errorEl.textContent = "Can't reach the restaurant server — check you're on the restaurant WiFi.";
        submitBtn.disabled = false;
      }
    });
  }

  // Small "Hi, Name · Log out" line for the top of a customer page.
  function greetingBar(onLogout) {
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex; justify-content:space-between; align-items:center; font-size:13px; color:var(--muted); margin-bottom:8px;';
    bar.innerHTML = `<span>Hi, <strong style="color:var(--text);">${escapeHtml(current ? current.name : '')}</strong></span>`;
    const btn = document.createElement('button');
    btn.textContent = 'Log out';
    btn.style.cssText = 'background:none; color:var(--muted); font-size:12px; text-decoration:underline;';
    btn.addEventListener('click', async () => {
      await logout();
      onLogout();
    });
    bar.appendChild(btn);
    return bar;
  }

  window.CustomerAuth = {
    getToken,
    getCustomer: () => current,
    verify,
    logout,
    clearToken,
    renderLogin,
    greetingBar,
    escapeHtml,
  };
})();
