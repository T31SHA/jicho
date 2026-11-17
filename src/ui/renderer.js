const app = document.getElementById('app');
const idle = document.getElementById('idle');
const card = document.getElementById('card');
const idleBot = JichoBot.mount(document.getElementById('idle-bot'));
const cardBot = JichoBot.mount(document.getElementById('card-bot'));
let current = null;
let state = { pending: [], sessions: [], working: false };
let audioContext;
let holdTimer = null;
let heldRequestId = null;

function clearAllowHold() {
  if (holdTimer) clearTimeout(holdTimer);
  holdTimer = null;
  heldRequestId = null;
  const button = document.querySelector('button[data-decision="allow"]');
  if (button) button.classList.remove('holding');
}

function valueText(value) {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value, null, 2);
}

function draw() {
  const items = state.pending || [];
  const oldId = current && current.id;
  current = items[0] || null;
  if (oldId !== (current && current.id)) clearAllowHold();
  const layout = current ? 'card' : (state.layout || 'idle');
  idle.hidden = layout !== 'idle';
  card.hidden = layout !== 'card';
  document.getElementById('phone').hidden = layout !== 'phone';
  app.classList.toggle('working', layout === 'idle' && state.working);
  idleBot.setMood(state.mood || (state.working ? 'working' : 'idle'));
  cardBot.setMood(state.mood || (current ? 'needs-you' : 'idle'));
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
  const allowButton = document.querySelector('button[data-decision="allow"]');
  const alwaysButton = document.querySelector('button[data-decision="always"]');
  const flagged = Boolean(current && current.riskFlags && current.riskFlags.length);
  document.getElementById('allow-label').textContent = flagged ? 'Hold 700 ms to Allow' : 'Allow';
  allowButton.setAttribute('aria-label', flagged ? 'Press and hold for 700 milliseconds to allow this flagged command' : 'Allow');
  alwaysButton.hidden = !current || !current.canAlways;
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

async function submitDecision(button, decision) {
  if (!current) return;
  button.disabled = true;
  document.getElementById('card-error').textContent = '';
  try {
    const answered = await window.jicho.answer(current.id, decision);
    if (!answered) {
      document.getElementById('card-error').textContent = decision === 'always'
        ? 'Always applies only to exact safe reads and Git status/diff/log.'
        : 'This request has already closed.';
    }
  } catch (_) {
    document.getElementById('card-error').textContent = 'Jicho could not send that answer.';
  } finally { button.disabled = false; }
}

function beginAllowHold(event) {
  if (!current || !current.riskFlags || !current.riskFlags.length || event.currentTarget.disabled) return;
  if (event.type === 'keydown' && event.repeat) return;
  if (event.type === 'pointerdown' && event.button !== 0) return;
  event.preventDefault();
  clearAllowHold();
  const requestId = current.id;
  const button = event.currentTarget;
  heldRequestId = requestId;
  button.classList.add('holding');
  holdTimer = setTimeout(() => {
    const stillCurrent = current && current.id === requestId && heldRequestId === requestId;
    clearAllowHold();
    if (stillCurrent) submitDecision(button, 'allow');
  }, 700);
}

window.jicho.onState((next) => {
  const previousId = current && current.id;
  state = next;
  draw();
  if (current && current.id !== previousId) chime();
});
window.jicho.onCursor((point) => {
  idleBot.lookAt(point.x, point.y);
  cardBot.lookAt(point.x, point.y);
});
window.jicho.onError((message) => { document.getElementById('error').textContent = message; });

document.querySelectorAll('button[data-decision]').forEach((button) => {
  if (button.dataset.decision === 'allow') {
    button.addEventListener('pointerdown', beginAllowHold);
    button.addEventListener('pointerup', clearAllowHold);
    button.addEventListener('pointercancel', clearAllowHold);
    button.addEventListener('pointerleave', clearAllowHold);
    button.addEventListener('keydown', (event) => {
      if ((event.key === ' ' || event.key === 'Enter') && !event.ctrlKey && !event.metaKey) beginAllowHold(event);
    });
    button.addEventListener('keyup', (event) => {
      if (event.key === ' ' || event.key === 'Enter') clearAllowHold();
    });
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  }
  button.addEventListener('click', (event) => {
    if (!current) return;
    if (button.dataset.decision === 'allow' && current.riskFlags && current.riskFlags.length) {
      event.preventDefault();
      return;
    }
    submitDecision(button, button.dataset.decision);
  });
});

window.addEventListener('keydown', (event) => {
  if (!current || card.hidden) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    submitDecision(document.querySelector('button[data-decision="deny"]'), 'deny');
    return;
  }
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    if (!current.riskFlags || current.riskFlags.length === 0) {
      submitDecision(document.querySelector('button[data-decision="allow"]'), 'allow');
    }
  }
});

document.getElementById('phone-toggle').addEventListener('click', () => window.jicho.togglePhone(true));
document.getElementById('command-centre-open').addEventListener('click', () => window.jicho.openCommandCentre());
document.getElementById('phone-close').addEventListener('click', () => window.jicho.togglePhone(false));
document.getElementById('phone-done').addEventListener('click', () => window.jicho.togglePhone(false));
document.getElementById('phone-enabled').addEventListener('change', (event) => window.jicho.setPhoneEnabled(event.target.checked));
document.getElementById('content-free').addEventListener('change', (event) => window.jicho.setPhoneContentFree(event.target.checked));
document.getElementById('allowlist-enabled').addEventListener('change', (event) => window.jicho.setAllowlistEnabled(event.target.checked));
document.getElementById('autostart-enabled').addEventListener('change', (event) => window.jicho.setAutostartEnabled(event.target.checked));

draw();
