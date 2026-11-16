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

function folderName(cwd) {
  if (!cwd) return 'Unknown folder';
  const cleaned = cwd.replace(/[\\/]+$/, '');
  const bits = cleaned.split(/[\\/]/);
  return bits[bits.length - 1] || cwd;
}

function draw() {
  const items = state.pending || [];
  current = items[0] || null;
  const expanded = Boolean(current);
  idle.hidden = expanded;
  card.hidden = !expanded;
  app.classList.toggle('working', !expanded && state.working);
  if (!current) return;
  document.getElementById('folder').textContent = folderName(current.cwd);
  document.getElementById('tool').textContent = current.tool || 'Tool';
  document.getElementById('command').textContent = valueText(
    current.input && Object.prototype.hasOwnProperty.call(current.input, 'command')
      ? current.input.command
      : current.input
  );
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
window.jicho.onError((message) => {
  document.getElementById('error').textContent = message;
});

document.querySelectorAll('button[data-decision]').forEach((button) => {
  button.addEventListener('click', async () => {
    if (!current) return;
    button.disabled = true;
    document.getElementById('card-error').textContent = '';
    try {
      const answered = await window.jicho.answer(current.id, button.dataset.decision);
      if (!answered) document.getElementById('card-error').textContent = 'This request has already closed.';
    } catch (_) {
      document.getElementById('card-error').textContent = 'Jicho could not send that answer.';
    } finally { button.disabled = false; }
  });
});

draw();
