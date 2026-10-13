// Real-time alerts: each dashboard turns its state into a list of
// { key, text } events. Any key not seen last time triggers a chime + toast.
const Alerts = (() => {
  let ctx = null;
  let seen = null;
  let muted = false;
  try { muted = localStorage.getItem('tts_muted') === '1'; } catch {}

  function unlock() {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
    } catch {}
  }
  document.addEventListener('click', unlock);
  document.addEventListener('keydown', unlock);

  function beep() {
    if (muted || !ctx) return;
    try {
      [880, 1175].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        gain.gain.value = 0.07;
        osc.connect(gain);
        gain.connect(ctx.destination);
        const start = ctx.currentTime + i * 0.14;
        osc.start(start);
        osc.stop(start + 0.12);
      });
    } catch {}
  }

  // Louder, longer three-note chime plus a buzz (Android phones) — for things
  // that must not be missed, like a table waiting to be greeted.
  function ring() {
    try { if (navigator.vibrate && !muted) navigator.vibrate([300, 120, 300, 120, 300]); } catch {}
    if (muted || !ctx) return;
    try {
      [784, 988, 1319].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        const start = ctx.currentTime + i * 0.18;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.28, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.22);
      });
    } catch {}
  }

  // Siren for anything that has been waiting too long: four alternating
  // high/low tones, louder and harsher than the normal chime.
  function alarm() {
    try { if (navigator.vibrate && !muted) navigator.vibrate([500, 150, 500, 150, 500]); } catch {}
    if (muted || !ctx) return;
    try {
      for (let i = 0; i < 4; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = i % 2 === 0 ? 980 : 740;
        const start = ctx.currentTime + i * 0.26;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.26);
      }
    } catch {}
  }

  // Browsers keep audio locked until the first tap on the page.
  function isReady() {
    return !!ctx && ctx.state === 'running';
  }

  function toast(text) {
    let box = document.getElementById('toastBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toastBox';
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    box.appendChild(el);
    setTimeout(() => el.remove(), 7000);
  }

  function process(events) {
    const keys = new Set(events.map((e) => e.key));
    if (seen === null) { seen = keys; return; } // first load: don't alert on existing items
    const fresh = events.filter((e) => !seen.has(e.key));
    seen = keys;
    if (fresh.length) {
      beep();
      fresh.slice(0, 4).forEach((e) => toast(e.text));
    }
  }

  function toggleMute() {
    muted = !muted;
    try { localStorage.setItem('tts_muted', muted ? '1' : '0'); } catch {}
    return muted;
  }

  return { process, toast, ring, alarm, isReady, toggleMute, isMuted: () => muted };
})();
