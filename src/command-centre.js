'use strict';

const pageTitle = document.getElementById('page-title');
const views = new Map(['overview', 'sessions', 'activity', 'approvals'].map((name) => [name, document.getElementById('view-' + name)]));
let snapshot = { sessions: [], activity: [], pending: [], connection: {} };
let selectedSession = null;

function text(value) {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try { return JSON.stringify(value, null, 2); }
  catch (error) { return '[unavailable]'; }
}

function projectName(cwd) {
  if (!cwd) return 'Unknown project';
  const parts = String(cwd).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

function formatTime(timestamp) {
  const date = new Date(Number(timestamp));
  if (!Number.isFinite(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }).format(date);
}

function relativeTime(timestamp) {
  const delta = Math.max(0, Date.now() - Number(timestamp || 0));
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return Math.floor(delta / 60_000) + 'm ago';
  if (delta < 86_400_000) return Math.floor(delta / 3_600_000) + 'h ago';
  return formatTime(timestamp);
}

function stateLabel(value, last) {
  if (value === 'working' || value === 'needs-you') {
    if (Date.now() - Number(last || 0) > 5 * 60_000) return 'stale';
    return value === 'needs-you' ? 'needs attention' : 'working';
  }
  if (value === 'ended') return 'ended';
  if (value === 'disconnected') return 'disconnected';
  return value || 'idle';
}

function stateClass(value, last) {
  const label = stateLabel(value, last).replace(/\s+/g, '-');
  return ['working', 'needs-attention', 'disconnected', 'ended'].includes(label) ? label.replace('needs-attention', 'needs-you') : '';
}

function eventTitle(event) {
  const titles = {
    PermissionRequest: 'Permission requested',
    UserPromptSubmit: 'Prompt submitted',
    PreToolUse: 'Tool started',
    PostToolUse: 'Tool finished',
    PostToolUseFailure: 'Tool failed',
    Stop: 'Agent turn stopped',
    Notification: 'Agent notification',
    SubagentStart: 'Subagent started',
    SubagentStop: 'Subagent stopped',
    SessionEnd: 'Session ended',
    'approval-resolved': 'Jicho decision recorded',
    'approval-interrupted': 'Approval interrupted on restart'
  };
  return titles[event.type] || String(event.type || 'Observed event').replace(/[-_]/g, ' ');
}

function eventEvidence(details) {
  const values = [];
  if (details.toolName) values.push(String(details.toolName));
  if (details.filePath) values.push(String(details.filePath));
  if (details.path && !details.filePath) values.push(String(details.path));
  if (details.exitCode !== undefined) values.push('exit ' + details.exitCode);
  if (details.errorPresent && details.exitCode === undefined) values.push('failure reported');
  if (details.notificationType) values.push(String(details.notificationType));
  if (details.subagentType) values.push('agent ' + String(details.subagentType));
  return values.join(' · ');
}

function createTimelineRow(event) {
  const row = document.createElement('article');
  const isJicho = event.source !== 'claude-hook';
  row.className = 'timeline-row' + (isJicho ? ' jicho' : '');
  const symbol = document.createElement('span');
  symbol.className = 'timeline-symbol';
  symbol.textContent = isJicho ? 'J' : event.type === 'PostToolUseFailure' ? '!' : '·';
  row.appendChild(symbol);

  const copy = document.createElement('div');
  copy.className = 'timeline-copy';
  const titleRow = document.createElement('div');
  titleRow.className = 'timeline-title-row';
  const title = document.createElement('span');
  title.className = 'timeline-title';
  title.textContent = eventTitle(event);
  const time = document.createElement('time');
  time.className = 'timeline-time';
  time.dateTime = new Date(Number(event.at)).toISOString();
  time.textContent = relativeTime(event.at);
  titleRow.append(title, time);
  copy.appendChild(titleRow);

  const details = event.details || {};
  const metaParts = [projectName(snapshot.sessions.find((session) => session.id === event.sessionId)?.cwd), eventEvidence(details)].filter(Boolean);
  if (event.sessionId) metaParts.push('session ' + String(event.sessionId).slice(0, 10));
  if (metaParts.length) {
    const meta = document.createElement('div');
    meta.className = 'timeline-meta';
    meta.textContent = metaParts.join(' · ');
    copy.appendChild(meta);
  }
  if (details.command) {
    const evidence = document.createElement('pre');
    evidence.className = 'timeline-evidence';
    evidence.textContent = details.command;
    copy.appendChild(evidence);
  }
  const source = document.createElement('span');
  source.className = 'source-label';
  source.textContent = isJicho ? 'JICHO LOCAL ACTION' : 'CLAUDE CODE HOOK';
  copy.appendChild(source);

  if (event.sessionId && snapshot.sessions.some((session) => session.id === event.sessionId)) {
    const sessionLink = document.createElement('button');
    sessionLink.className = 'text-button session-link';
    sessionLink.textContent = 'Open session →';
    sessionLink.addEventListener('click', () => showSession(event.sessionId));
    copy.appendChild(sessionLink);
  }
  row.appendChild(copy);
  return row;
}

function renderTimeline(target, events, emptyMessage, maxRows) {
  target.replaceChildren();
  const selected = (events || []).slice(0, maxRows || 100);
  if (!selected.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-inline';
    empty.textContent = emptyMessage;
    target.appendChild(empty);
    return;
  }
  for (const event of selected) target.appendChild(createTimelineRow(event));
}

function createSessionTile(session, compact = false) {
  const tile = document.createElement('button');
  tile.className = compact ? 'session-tile' : 'session-row';
  tile.title = session.id;
  const title = document.createElement('div');
  title.className = 'session-title';
  title.textContent = projectName(session.cwd);
  const subtitle = document.createElement('div');
  subtitle.className = 'session-subtitle';
  subtitle.textContent = 'Claude Code · ' + (session.cwd || 'working directory unavailable');
  const bottom = document.createElement('div');
  bottom.className = 'session-bottom';
  const status = document.createElement('span');
  status.className = 'state-chip ' + stateClass(session.state, session.last);
  status.textContent = stateLabel(session.state, session.last);
  const activity = document.createElement('span');
  activity.textContent = relativeTime(session.last);
  bottom.append(status, activity);
  tile.append(title, subtitle, bottom);
  tile.addEventListener('click', () => showSession(session.id));
  return tile;
}

function renderSessions() {
  const recent = snapshot.sessions.slice(0, 6);
  const overview = document.getElementById('overview-sessions-list');
  overview.replaceChildren();
  if (!recent.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-inline';
    empty.textContent = 'No observed sessions yet. Start a fresh Claude Code session after installing Jicho hooks.';
    overview.appendChild(empty);
  } else for (const session of recent) overview.appendChild(createSessionTile(session, true));

  const list = document.getElementById('session-list');
  list.replaceChildren();
  if (!snapshot.sessions.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-inline';
    empty.textContent = 'No sessions have sent a supported hook event yet.';
    list.appendChild(empty);
  } else {
    for (const session of snapshot.sessions) {
      const row = createSessionTile(session, false);
      if (session.id === selectedSession) row.classList.add('selected');
      list.appendChild(row);
    }
  }
  document.getElementById('session-nav-count').textContent = String(snapshot.sessions.length);
  document.getElementById('session-total').textContent = snapshot.sessions.length + (snapshot.sessions.length === 1 ? ' session' : ' sessions');
  renderSessionDetail();
}

function renderSessionDetail() {
  const host = document.getElementById('session-detail');
  const session = snapshot.sessions.find((item) => item.id === selectedSession);
  if (!session) {
    host.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const icon = document.createElement('span');
    icon.className = 'empty-icon';
    icon.textContent = '▤';
    const title = document.createElement('strong');
    title.textContent = 'Select a session';
    const description = document.createElement('p');
    description.textContent = 'Choose a session to inspect its observed event history.';
    empty.append(icon, title, description);
    host.appendChild(empty);
    return;
  }
  host.replaceChildren();
  const header = document.createElement('header');
  header.className = 'detail-header';
  const heading = document.createElement('h3');
  heading.textContent = projectName(session.cwd);
  const cwd = document.createElement('p');
  cwd.textContent = session.cwd || 'Working directory unavailable';
  cwd.title = session.cwd || '';
  header.append(heading, cwd);
  const facts = document.createElement('div');
  facts.className = 'detail-facts';
  facts.append(
    fact('Agent', 'Claude Code'),
    fact('Session ID', session.id),
    fact('Status', stateLabel(session.state, session.last)),
    fact('Started', formatTime(session.startedAt)),
    fact('Last event', relativeTime(session.last))
  );
  header.appendChild(facts);
  host.appendChild(header);
  const timelineTitle = document.createElement('div');
  timelineTitle.className = 'detail-timeline-title';
  timelineTitle.textContent = 'SESSION EVIDENCE';
  host.appendChild(timelineTitle);
  const timeline = document.createElement('div');
  timeline.className = 'timeline';
  const related = snapshot.activity.filter((event) => event.sessionId === session.id);
  renderTimeline(timeline, related, 'No events were recorded for this session yet.', 100);
  host.appendChild(timeline);
}

function fact(labelText, valueText) {
  const item = document.createElement('span');
  const label = document.createElement('strong');
  label.textContent = labelText + ': ';
  item.append(label, document.createTextNode(valueText || 'Unavailable'));
  return item;
}

function showSession(id) {
  selectedSession = id;
  showView('sessions');
  renderSessions();
}

function createApprovalCard(request) {
  const level = String(request.riskLevel || 'LOW').toLowerCase();
  const card = document.createElement('article');
  card.className = 'approval-card ' + level;
  const top = document.createElement('div');
  top.className = 'approval-top';
  const identity = document.createElement('div');
  const agent = document.createElement('div');
  agent.className = 'approval-agent';
  agent.textContent = 'Claude Code · ' + String(request.tool || 'Tool');
  const project = document.createElement('div');
  project.className = 'approval-project';
  project.textContent = projectName(request.cwd) + ' · session ' + String(request.sid || '').slice(0, 10);
  identity.append(agent, project);
  const risk = document.createElement('span');
  risk.className = 'risk-pill ' + level;
  risk.textContent = level.toUpperCase() + ' RISK';
  top.append(identity, risk);
  card.appendChild(top);

  const command = request.input && Object.prototype.hasOwnProperty.call(request.input, 'command') ? request.input.command : request.input;
  const tool = document.createElement('div');
  tool.className = 'approval-tool';
  tool.textContent = 'Requested operation';
  const commandBlock = document.createElement('pre');
  commandBlock.className = 'approval-command';
  commandBlock.textContent = text(command) || 'The agent did not provide displayable tool input.';
  const cwd = document.createElement('div');
  cwd.className = 'approval-path';
  cwd.textContent = 'Working directory · ' + (request.cwd || 'unavailable');
  const expiry = document.createElement('div');
  expiry.className = 'approval-path';
  expiry.textContent = 'Request expires · ' + (request.expiresAt ? formatTime(request.expiresAt) : 'time unavailable');
  card.append(tool, commandBlock, cwd, expiry);
  if (request.riskFlags && request.riskFlags.length) {
    const flags = document.createElement('div');
    flags.className = 'approval-path';
    flags.textContent = 'Risk signals · ' + request.riskFlags.map((flag) => flag.label).join(' · ');
    card.appendChild(flags);
  }
  const actions = document.createElement('div');
  actions.className = 'approval-actions';
  const error = document.createElement('div');
  error.className = 'inline-error';
  const deny = document.createElement('button');
  deny.className = 'action-button deny';
  deny.textContent = 'Deny';
  const approve = document.createElement('button');
  approve.className = 'action-button approve';
  approve.textContent = 'Approve once';
  const decide = async (decision, button) => {
    button.disabled = true;
    error.textContent = '';
    try {
      const accepted = await window.jichoCentre.answer(request.id, decision);
      if (!accepted) error.textContent = 'This request has expired or has already closed.';
    } catch (failure) {
      error.textContent = 'Jicho could not record this decision.';
    } finally { button.disabled = false; }
  };
  deny.addEventListener('click', () => decide('deny', deny));
  approve.addEventListener('click', () => decide('allow', approve));
  actions.append(deny, approve);
  card.append(actions, error);
  return card;
}

function renderApprovals() {
  document.getElementById('approval-nav-count').textContent = String(snapshot.pending.length);
  document.getElementById('approval-total').textContent = snapshot.pending.length + ' pending';
  for (const target of [document.getElementById('overview-approvals'), document.getElementById('approval-list')]) {
    target.replaceChildren();
    if (!snapshot.pending.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-inline';
      empty.textContent = 'No permission requests are waiting. Completed and expired decisions appear in the activity timeline.';
      target.appendChild(empty);
    } else for (const request of snapshot.pending) target.appendChild(createApprovalCard(request));
  }
}

function showView(name) {
  if (!views.has(name)) return;
  for (const [key, view] of views) {
    const active = key === name;
    view.hidden = !active;
    view.classList.toggle('active', active);
  }
  for (const button of document.querySelectorAll('.nav-item')) button.classList.toggle('selected', button.dataset.view === name);
  pageTitle.textContent = name.charAt(0).toUpperCase() + name.slice(1);
}

function update(snapshotValue) {
  snapshot = {
    sessions: Array.isArray(snapshotValue.sessions) ? snapshotValue.sessions : [],
    activity: Array.isArray(snapshotValue.activity) ? snapshotValue.activity : [],
    pending: Array.isArray(snapshotValue.pending) ? snapshotValue.pending : [],
    connection: snapshotValue.connection || {},
    generatedAt: snapshotValue.generatedAt
  };
  const status = document.getElementById('connection-label');
  const dot = document.getElementById('connection-dot');
  const online = Boolean(snapshot.connection.storeAvailable && snapshot.connection.serverListening);
  status.textContent = online ? 'Local hook server online' : snapshot.connection.message || 'Local service unavailable';
  dot.classList.toggle('online', online);
  dot.classList.toggle('offline', !online);
  document.getElementById('centre-error').textContent = snapshot.connection.error || '';
  document.getElementById('generated-at').textContent = snapshot.generatedAt ? 'Updated ' + formatTime(snapshot.generatedAt) : '';
  const activeSessions = snapshot.sessions.filter((session) => ['working', 'needs-you'].includes(session.state) && Date.now() - Number(session.last || 0) <= 5 * 60_000).length;
  document.getElementById('metric-active').textContent = String(activeSessions);
  document.getElementById('metric-pending').textContent = String(snapshot.pending.length);
  document.getElementById('metric-events').textContent = String(snapshot.activity.filter((event) => event.source === 'claude-hook').length);
  document.getElementById('metric-failures').textContent = String(snapshot.activity.filter((event) => event.type === 'PostToolUseFailure').length);
  renderApprovals();
  renderSessions();
  renderTimeline(document.getElementById('overview-activity'), snapshot.activity, 'No hook activity has been recorded yet.', 6);
  renderTimeline(document.getElementById('activity-list'), snapshot.activity, 'No hook activity has been recorded yet.', 100);
}

for (const button of document.querySelectorAll('.nav-item')) button.addEventListener('click', () => showView(button.dataset.view));
for (const button of document.querySelectorAll('[data-go]')) button.addEventListener('click', () => showView(button.dataset.go));
document.getElementById('refresh').addEventListener('click', async () => {
  try { update(await window.jichoCentre.getSnapshot()); }
  catch (error) { document.getElementById('centre-error').textContent = 'Could not refresh local history.'; }
});
window.jichoCentre.onSnapshot(update);
window.jichoCentre.getSnapshot().then(update).catch((error) => {
  document.getElementById('connection-label').textContent = 'Local service unavailable';
  document.getElementById('centre-error').textContent = 'Could not read Jicho local history.';
});
