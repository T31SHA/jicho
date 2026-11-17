const app = document.getElementById('app');
const idle = document.getElementById('idle');
const expanded = document.getElementById('expanded');
const card = document.getElementById('card');
const idleBot = JichoBot.mount(document.getElementById('idle-bot'));
const cardBot = JichoBot.mount(document.getElementById('card-bot'));
const expandedBot = JichoBot.mount(document.getElementById('expanded-bot'));
let current = null;
let state = { pending: [], sessions: [], working: false };
let audioContext;
let holdTimer = null;
let heldRequestId = null;
let dismissedRecommendations = new Set();
try { dismissedRecommendations = new Set(JSON.parse(localStorage.getItem('jicho.dismissedRecommendations') || '[]')); } catch (_) {}

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
  const compactActive = layout === 'idle';
  const expandedActive = layout === 'expanded';
  idle.classList.toggle('is-active', compactActive);
  expanded.classList.toggle('is-active', expandedActive);
  idle.setAttribute('aria-hidden', String(!compactActive));
  expanded.setAttribute('aria-hidden', String(!expandedActive));
  card.hidden = layout !== 'card';
  document.getElementById('phone').hidden = layout !== 'phone';
  app.dataset.layout = layout;
  app.classList.toggle('working', state.working);
  const expandLabel = layout === 'expanded' ? 'Collapse Jicho island' : 'Expand Jicho island';
  document.getElementById('expand-toggle').setAttribute('aria-label', expandLabel);
  document.getElementById('expanded-toggle').setAttribute('aria-label', expandLabel);
  document.getElementById('expand-toggle').setAttribute('aria-expanded', String(expandedActive));
  document.getElementById('expanded-toggle').setAttribute('aria-expanded', String(expandedActive));
  idleBot.setMood(state.mood || (state.working ? 'working' : 'idle'));
  cardBot.setMood(state.mood || (current ? 'needs-you' : 'idle'));
  expandedBot.setMood(state.mood || (state.working ? 'working' : 'idle'));
  renderIsland();
  renderPlacement();
  const phone = state.phone;
  if (phone) {
    document.getElementById('phone-topic').textContent = phone.topic || '';
    document.getElementById('phone-enabled').checked = Boolean(phone.enabled);
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

function renderIsland() {
  const model = state.island || {};
  const pending = state.pending || [];
  document.getElementById('compact-project').textContent = model.project || 'JICHO';
  document.getElementById('compact-agent').textContent = model.agent || 'Waiting';
  document.getElementById('compact-activity').textContent = model.currentActivity || 'Waiting for an observed agent event';
  document.getElementById('expanded-activity').textContent = model.currentActivity || 'Waiting for an observed agent event';
  renderSessionIndicators(model.sessionIndicators || []);
  const progressTitle = model.sessionState === 'working'
    ? 'Agent is working · live session state'
    : model.sessionState === 'needs-you' ? 'Agent is waiting for your attention'
      : model.sessionState === 'error' ? 'The latest observed agent event reported an error'
        : 'Waiting for agent activity';
  for (const indicator of [document.getElementById('compact-progress'), document.getElementById('expanded-progress')]) {
    indicator.classList.toggle('is-working', model.sessionState === 'working');
    indicator.classList.toggle('is-needs-you', model.sessionState === 'needs-you' || pending.length > 0);
    indicator.classList.toggle('is-error', model.sessionState === 'error');
    indicator.title = progressTitle;
    indicator.setAttribute('aria-label', progressTitle);
  }
  const attention = document.getElementById('attention-indicator');
  attention.hidden = pending.length === 0;
  attention.textContent = pending.length > 9 ? '9+' : String(pending.length);

  document.getElementById('expanded-project').textContent = model.project || 'No agent session observed';
  const sessionSuffix = model.sessionId ? ' · session ' + model.sessionId.slice(0, 10) : '';
  document.getElementById('expanded-agent').textContent = model.agent || 'JICHO · waiting for authenticated agent hooks';
  document.getElementById('expanded-agent').title = (model.agent || 'JICHO') + sessionSuffix;
  document.getElementById('activity-now').textContent = model.currentActivity || 'No agent session observed';
  const currentEvent = (model.recentEvents || []).slice(-1)[0];
  const command = currentEvent && currentEvent.evidence && currentEvent.evidence.command;
  const commandElement = document.getElementById('activity-command');
  commandElement.hidden = typeof command !== 'string' || command.length === 0;
  commandElement.textContent = command || '';

  const steps = document.getElementById('activity-steps');
  steps.replaceChildren();
  const sourceLabels = {
    'claude-hook': 'CLAUDE CODE HOOK',
    'cursor-hook': 'CURSOR HOOK',
    'codex-hook': 'CODEX CLI HOOK',
    jicho: 'JICHO LOCAL RECORD',
    unknown: 'SOURCE UNAVAILABLE'
  };
  for (const event of (model.recentEvents || []).slice().reverse()) {
    const row = document.createElement('li');
    const text = document.createElement('span');
    text.className = 'step-title';
    text.textContent = event.title || event.type;
    const source = document.createElement('span');
    source.className = 'step-source';
    source.textContent = sourceLabels[event.source] || sourceLabels.unknown;
    text.appendChild(source);
    row.appendChild(text);
    steps.appendChild(row);
  }
  if (!steps.children.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No activity events observed yet.';
    steps.appendChild(empty);
  }

  const files = document.getElementById('modified-files');
  files.replaceChildren();
  for (const file of model.modifiedFiles || []) {
    const row = document.createElement('li');
    row.className = 'file-row';
    row.dataset.state = file.state || 'updated';
    const main = document.createElement('span');
    main.className = 'file-main';
    const activity = document.createElement('span');
    activity.className = 'file-state-indicator';
    activity.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'file-path';
    name.textContent = file.displayPath || file.path;
    name.title = file.path;
    main.append(activity, name);
    row.appendChild(main);
    const status = document.createElement('span');
    status.className = 'file-status';
    status.textContent = file.state === 'editing' ? 'Editing' : 'Updated';
    row.appendChild(status);
    if (Number.isInteger(file.additions) || Number.isInteger(file.deletions)) {
      const counts = document.createElement('span');
      counts.className = 'file-diff-counts';
      counts.title = 'Minimal line changes measured from the observed Edit replacement';
      if (Number.isInteger(file.additions)) {
        const additions = document.createElement('span');
        additions.className = 'file-additions';
        additions.textContent = '+' + file.additions;
        counts.appendChild(additions);
      }
      if (Number.isInteger(file.deletions)) {
        const deletions = document.createElement('span');
        deletions.className = 'file-deletions';
        deletions.textContent = '−' + file.deletions;
        counts.appendChild(deletions);
      }
      row.appendChild(counts);
    }
    row.title = file.path;
    files.appendChild(row);
  }
  const hasMissingCounts = (model.modifiedFiles || []).some((file) => !Number.isInteger(file.additions) && !Number.isInteger(file.deletions));
  document.getElementById('files-empty').hidden = files.children.length > 0;
  document.getElementById('file-counts-note').hidden = files.children.length === 0 || !hasMissingCounts;

  const recommendationHost = document.getElementById('recommendations');
  recommendationHost.replaceChildren();
  const recommendations = (model.recommendations || []).filter((item) => !dismissedRecommendations.has(item.id));
  const section = document.getElementById('recommendations-section');
  section.hidden = recommendations.length === 0;
  for (const item of recommendations) {
    const row = document.createElement('article');
    row.className = 'recommendation';
    const title = document.createElement('strong');
    title.textContent = item.title + ' · ' + item.confidence;
    const message = document.createElement('p');
    message.textContent = item.message;
    const evidence = document.createElement('small');
    evidence.textContent = 'Evidence: ' + (item.evidence || []).join(' · ');
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.setAttribute('aria-label', 'Dismiss reminder');
    dismiss.title = 'Dismiss';
    dismiss.textContent = '×';
    dismiss.addEventListener('click', () => {
      dismissedRecommendations.add(item.id);
      try { localStorage.setItem('jicho.dismissedRecommendations', JSON.stringify([...dismissedRecommendations].slice(-100))); } catch (_) {}
      renderIsland();
    });
    row.append(title, message, evidence, dismiss);
    recommendationHost.appendChild(row);
  }
  const capabilities = model.capabilities || {};
  const yesNo = (value) => value ? 'yes' : 'no';
  document.getElementById('capability-note').textContent = model.agent
    ? 'Detected ' + yesNo(capabilities.detected) + ' · connected ' + yesNo(capabilities.connected) +
      ' · host-app detection unavailable · session identified ' + yesNo(capabilities.sessionIdentified) +
      ' · activity monitored ' + yesNo(capabilities.activityMonitored) +
      ' · permission hook: ' + (capabilities.permissionHookStatus || 'unavailable') +
      ' · questions unavailable · remote decisions unavailable'
    : 'Detected no agent session. A session appears after an authenticated agent hook event.';
  document.getElementById('expanded-error').textContent = model.historyError || '';
}

function renderSessionIndicators(indicators) {
  const compact = document.getElementById('compact-session-indicators');
  const expandedNav = document.getElementById('expanded-session-indicators');
  for (const nav of [compact, expandedNav]) {
    nav.replaceChildren();
    nav.hidden = indicators.length < 2;
    for (const item of indicators) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'session-indicator';
      button.setAttribute('role', 'tab');
      button.dataset.state = item.state || 'idle';
      button.setAttribute('aria-pressed', String(Boolean(item.selected)));
      button.setAttribute('aria-selected', String(Boolean(item.selected)));
      const sessionTail = String(item.id || '').slice(-4);
      const compactAgent = item.agent === 'Claude Code' ? 'Claude' : item.agent;
      const label = item.project + ' · ' + compactAgent + (sessionTail ? ' ' + sessionTail : '');
      button.title = item.project + ' · ' + item.agent + ' · session ' + item.id + ' · ' + (item.state || 'idle');
      const dot = document.createElement('span');
      dot.className = 'session-state-dot';
      dot.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.textContent = label;
      button.append(dot, text);
      button.addEventListener('click', () => window.jicho.selectSession(item.agentId, item.id));
      nav.appendChild(button);
    }
  }
}

function renderPlacement() {
  const select = document.getElementById('island-display');
  const displays = state.displays || [];
  const wanted = state.placement && state.placement.displayId || 'auto';
  const optionKey = JSON.stringify(displays.map((display) => display.id));
  if (select.dataset.options !== optionKey) {
    select.replaceChildren();
    const automatic = document.createElement('option');
    automatic.value = 'auto';
    automatic.textContent = 'Automatic (primary display)';
    select.appendChild(automatic);
    for (const display of displays) {
      const option = document.createElement('option');
      option.value = display.id;
      option.textContent = display.label + ' · ' + display.bounds.width + '×' + display.bounds.height;
      select.appendChild(option);
    }
    select.dataset.options = optionKey;
  }
  if (document.activeElement !== select) select.value = wanted;
  const x = document.getElementById('offset-x');
  const y = document.getElementById('offset-y');
  if (document.activeElement !== x) x.value = String(state.placement && state.placement.offsetX || 0);
  if (document.activeElement !== y) y.value = String(state.placement && state.placement.offsetY || 0);
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
document.getElementById('expanded-settings').addEventListener('click', () => window.jicho.togglePhone(true));
document.getElementById('expand-toggle').addEventListener('click', () => window.jicho.toggleExpanded());
document.getElementById('expanded-toggle').addEventListener('click', () => window.jicho.toggleExpanded());
document.getElementById('island-collapse').addEventListener('click', () => window.jicho.toggleExpanded());
document.getElementById('command-centre-open').addEventListener('click', () => window.jicho.openCommandCentre());
document.getElementById('phone-close').addEventListener('click', () => window.jicho.togglePhone(false));
document.getElementById('phone-done').addEventListener('click', () => window.jicho.togglePhone(false));
document.getElementById('phone-enabled').addEventListener('change', (event) => window.jicho.setPhoneEnabled(event.target.checked));
document.getElementById('allowlist-enabled').addEventListener('change', (event) => window.jicho.setAllowlistEnabled(event.target.checked));
document.getElementById('autostart-enabled').addEventListener('change', (event) => window.jicho.setAutostartEnabled(event.target.checked));
document.getElementById('island-display').addEventListener('change', (event) => window.jicho.setDisplay(event.target.value));
document.getElementById('save-placement').addEventListener('click', () => {
  const x = Number.parseInt(document.getElementById('offset-x').value, 10);
  const y = Number.parseInt(document.getElementById('offset-y').value, 10);
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    document.getElementById('phone-status').textContent = 'Enter whole-number offsets.';
    return;
  }
  window.jicho.setOffset({ x, y });
});

app.addEventListener('pointermove', (event) => {
  const bounds = app.getBoundingClientRect();
  const point = { x: event.clientX - bounds.width / 2, y: event.clientY - 27 };
  idleBot.lookAt(point.x, point.y);
  expandedBot.lookAt(point.x, point.y);
  cardBot.lookAt(point.x, point.y);
});

draw();
