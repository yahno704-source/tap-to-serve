// Shows the restaurant's own name (and logo, if one was uploaded) on the
// guest-facing screens: the landing page, door check-in and the table screen.
(function () {
  const DEFAULT_NAME = 'Tap to Serve';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function logoImg(url, cls) {
    return `<img class="${cls}" src="${esc(url)}" alt="" />`;
  }

  function apply(s) {
    const name = s.restaurantName || DEFAULT_NAME;
    const custom = name !== DEFAULT_NAME || !!s.logo;
    if (!custom) return;

    const page = location.pathname.split('/').pop() || 'index.html';

    if (page === 'index.html' || page === '') {
      const logo = document.querySelector('.logo');
      if (logo) logo.innerHTML = (s.logo ? logoImg(s.logo, 'brand-logo-large') : '') + `<div>${esc(name)}</div>`;
    } else if (page === 'checkin.html') {
      const title = document.querySelector('.topbar .title');
      if (title) title.innerHTML = (s.logo ? logoImg(s.logo, 'brand-logo-small') : '') + esc(name);
    } else if (page === 'customer.html') {
      const top = document.querySelector('.topbar');
      if (top && !document.getElementById('brandStrip')) {
        const strip = document.createElement('div');
        strip.id = 'brandStrip';
        strip.className = 'brand-strip';
        strip.innerHTML = (s.logo ? logoImg(s.logo, 'brand-logo-small') : '') + `<span>Welcome to ${esc(name)}</span>`;
        top.parentNode.insertBefore(strip, top.nextSibling);
      }
    }
    if (page === 'customer.html' || page === 'checkin.html' || page === 'index.html') {
      document.title = name;
    }
  }

  fetch('/api/settings', { cache: 'no-store' })
    .then((r) => r.json())
    .then(apply)
    .catch(() => {});
})();
