const socket = io();
const app = document.getElementById('app');

socket.on('state:full', (state) => {
  if (app.dataset.filled) return; // build once; layout doesn't need to live-update
  app.dataset.filled = '1';
  render(state);
});

function qrCard(title, subtitle, path, sectionColor) {
  const card = document.createElement('div');
  card.className = 'qr-card';
  card.style.cssText = `background:var(--panel); border:1px solid var(--border); border-radius:14px; padding:16px; text-align:center; ${sectionColor ? `border-top:4px solid ${sectionColor};` : ''}`;
  card.innerHTML = `
    <div class="qr-label" style="font-weight:800; font-size:15px; margin-bottom:2px;">${title}</div>
    <div style="color:var(--muted); font-size:12px; margin-bottom:10px;">${subtitle}</div>
    <img src="/api/qr?path=${encodeURIComponent(path)}" alt="QR code for ${title}" style="width:100%; max-width:280px; aspect-ratio:1; border-radius:8px; background:white; cursor:zoom-in;" />
    <div class="url-text" style="color:var(--muted); font-size:10px; margin-top:8px; word-break:break-all;"></div>
    <div class="no-print" style="color:var(--muted); font-size:11px; margin-top:4px;">Tap code to enlarge</div>
  `;
  card.querySelector('img').addEventListener('click', () => showFullscreen(title, path));
  fetch(`/api/lan-url?path=${encodeURIComponent(path)}`)
    .then((r) => r.json())
    .then((d) => {
      card.querySelector('.url-text').textContent = d.url;
    })
    .catch(() => {});
  return card;
}

// Full-screen view for scanning straight off this screen: white background,
// code as large as the viewport allows. Tap anywhere or press Esc to close.
function showFullscreen(title, path) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed; inset:0; z-index:1000; background:white; color:black; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; cursor:zoom-out;';
  overlay.innerHTML = `
    <div style="font-weight:800; font-size:clamp(20px,4vmin,40px);">${title}</div>
    <img src="/api/qr?path=${encodeURIComponent(path)}" alt="QR code for ${title}" style="width:min(85vw,80vh); height:min(85vw,80vh);" />
    <div style="color:#666; font-size:14px;">Tap anywhere to close</div>
  `;
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
}

function render(state) {
  app.appendChild(qrCard('Front Door', 'Guests scan to check in', '/checkin.html', null));

  Object.values(state.tables)
    .sort((a, b) => a.number - b.number)
    .forEach((table) => {
      const section = state.sections.find((s) => s.id === table.sectionId);
      const seatMeta = state.seatTypes[table.seatType];
      app.appendChild(
        qrCard(
          `Table ${table.number}`,
          `${seatMeta.icon} ${seatMeta.label} · ${section.name}`,
          `/customer.html?table=${table.id}`,
          section.color
        )
      );
    });
}
