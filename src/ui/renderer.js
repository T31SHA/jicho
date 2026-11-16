const app = document.getElementById('app');
const idle = document.getElementById('idle');
const card = document.getElementById('card');
const pupil = document.getElementById('pupil');
let current = null;
let state = { pending: [], sessions: [], working: false };
let audioContext;

function valueText(value) {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value, null, 2);
}

function draw() {
  const items = state.pending || [];
  current = items[0] || null;
  const layout = current ? 'card' : (state.layout || 'idle');
  idle.hidden = layout !== 'idle';
  card.hidden = layout !== 'card';
  document.getElementById('phone').hidden = layout !== 'phone';
  app.classList.toggle('working', layout === 'idle' && state.working);
  const phone = state.phone;
  if (phone) {
    document.getElementById('phone-topic').textContent = phone.topic || '';
    document.getElementById('phone-enabled').checked = Boolean(phone.enabled);
    document.getElementById('content-free').checked = Boolean(phone.contentFree);
    document.getElementById('phone-status').textContent = state.error || phone.status && phone.status.message || '';
    const qr = document.getElementById('phone-qr');
    if (phone.qrDataUrl && qr.src !== phone.qrDataUrl) qr.src = phone.qrDataUrl;
  }
  document.getElementById('allowlist-enabled').checked = Boolean(state.allowlistEnabled);
  document.getElementById('autostart-enabled').checked = Boolean(state.autostartEnabled);
  document.getElementById('error').textContent = state.error || '';
  document.getElementById('card-error').textContent = state.error || '';
  if (!current) return;
  document.getElementById('folder').textContent = current.cwd || 'Unknown folder';
  document.getElementById('folder').title = current.cwd || '';
  document.getElementById('tool').textContent = current.tool || 'Tool';
  document.getElementById('command').textContent = valueText(
    current.input && Object.prototype.hasOwnProperty.call(current.input, 'command')
      ? current.input.command
      : current.input
  );
  const flags = current.riskFlags || [];
  const riskBox = document.getElementById('risk-flags');
  riskBox.replaceChildren();
  riskBox.hidden = flags.length === 0;
  for (const flag of flags) {
    const badge = document.createElement('span');
    badge.className = 'risk-flag';
    badge.textContent = flag.label;
    riskBox.appendChild(badge);
  }
  const waiting = items.length - 1;
  const queue = document.getElementById('queue');
  queue.hidden = waiting < 1;
  queue.textContent = '+' + waiting + ' waiting';
}

function chime() {
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    audioContext = audioContext || new Audio();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(660, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(880, audioContext.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.32);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(); oscillator.stop(audioContext.currentTime + 0.34);
  } catch (_) { /* audio is optional */ }
}

window.jicho.onState((next) => {
  const previousId = current && current.id;
  state = next;
  draw();
  if (current && current.id !== previousId) chime();
});
window.jicho.onCursor((point) => {
  const x = Math.max(-9, Math.min(9, point.x / 12));
  const y = Math.max(-7, Math.min(7, point.y / 12));
  pupil.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
});
window.jicho.onError((message) => { document.getElementById('error').textContent = message; });

document.querySelectorAll('button[data-decision]').forEach((button) => {
  button.addEventListener('click', async () => {
    if (!current) return;
    button.disabled = true;
    document.getElementById('card-error').textContent = '';
    try {
      const answered = await window.jicho.answer(current.id, button.dataset.decision);
      if (!answered) {
        document.getElementById('card-error').textContent = button.dataset.decision === 'always'
          ? 'Always applies only to exact safe reads and Git status/diff/log.'
          : 'This request has already closed.';
      }
    } catch (_) {
      document.getElementById('card-error').textContent = 'Jicho could not send that answer.';
    } finally { button.disabled = false; }
  });
});

document.getElementById('phone-toggle').addEventListener('click', () => window.jicho.togglePhone(true));
document.getElementById('phone-close').addEventListener('click', () => window.jicho.togglePhone(false));
document.getElementById('phone-done').addEventListener('click', () => window.jicho.togglePhone(false));
document.getElementById('phone-enabled').addEventListener('change', (event) => window.jicho.setPhoneEnabled(event.target.checked));
document.getElementById('content-free').addEventListener('change', (event) => window.jicho.setPhoneContentFree(event.target.checked));
document.getElementById('allowlist-enabled').addEventListener('change', (event) => window.jicho.setAllowlistEnabled(event.target.checked));
document.getElementById('autostart-enabled').addEventListener('change', (event) => window.jicho.setAutostartEnabled(event.target.checked));

draw();
