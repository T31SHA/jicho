'use strict';

const { generateRecommendations } = require('./recommendations');

const TITLES = Object.freeze({
  SessionStart: 'Session started',
  UserPromptSubmit: 'Prompt submitted',
  PreToolUse: 'Tool started',
  PostToolUse: 'Tool finished',
  PostToolUseFailure: 'Tool failed',
  FileChanged: 'File changed',
  StopFailure: 'Agent turn failed',
  PermissionRequest: 'Permission requested',
  PermissionRequested: 'Permission requested',
  Stop: 'Turn stopped',
  TurnCompleted: 'Turn completed',
  Notification: 'Agent notification',
  SubagentStart: 'Subagent started',
  SubagentStop: 'Subagent stopped',
  SessionEnd: 'Session ended',
  'approval-resolved': 'JICHO decision recorded',
  'approval-interrupted': 'Approval interrupted on restart'
});

function detailsOf(event) {
  if (event && event.details && typeof event.details === 'object') return event.details;
  if (event && typeof event.detailsJson === 'string') {
    try { return JSON.parse(event.detailsJson); } catch (_) { return {}; }
  }
  return {};
}

function projectName(cwd) {
  if (typeof cwd !== 'string' || !cwd) return 'Project unavailable';
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

function sessionKey(session) {
  return String(session && session.agentId || 'claude-code') + '\u001f' + String(session && session.id || '');
}

function agentName(agentId) {
  if (agentId === 'claude-code') return 'Claude Code';
  if (agentId === 'codex') return 'Codex';
  if (agentId === 'cursor') return 'Cursor';
  return String(agentId || 'JICHO');
}

function observedTitle(event) {
  const details = detailsOf(event);
  const type = details.canonicalType || event.type;
  const title = TITLES[type] || String(type || 'Observed event').replace(/[-_]/g, ' ');
  const toolName = details.toolName || details.tool_name;
  return toolName ? title + ' · ' + toolName : title;
}

function buildIslandModel({ sessions = [], events = [], pending = [], selectedSession = null, now = Date.now() } = {}) {
  const orderedSessions = sessions.slice().sort((a, b) => Number(b.last || 0) - Number(a.last || 0));
  const selectedKey = selectedSession && sessionKey(selectedSession);
  const session = (selectedKey && orderedSessions.find((item) => sessionKey(item) === selectedKey)) ||
    orderedSessions.find((item) => item.state !== 'ended' && item.state !== 'disconnected') || orderedSessions[0] || null;
  const sessionEvents = session
    ? events.filter((event) => event.agentId === session.agentId && event.sessionId === session.id)
      .sort((a, b) => Number(a.at || 0) - Number(b.at || 0))
    : [];
  const recentEvents = sessionEvents.slice(-8).map((event) => ({
    id: event.id,
    type: event.type,
    title: observedTitle(event),
    source: event.source || 'unknown-source',
    at: event.at,
    evidence: detailsOf(event)
  }));

  const modified = new Map();
  for (const event of sessionEvents) {
    const details = detailsOf(event);
    const file = details.filePath || details.path;
    const canonicalType = details.canonicalType || event.type;
    if (canonicalType === 'FileChanged' && typeof file === 'string' && file) {
      modified.set(file, {
        path: file, tool: 'File edit', state: 'updated', at: event.at,
        source: event.source || 'unknown-source', additions: validCount(details.additions), deletions: validCount(details.deletions)
      });
    } else if (['PreToolUse', 'PostToolUse'].includes(canonicalType) &&
        ['Write', 'Edit', 'NotebookEdit', 'MultiEdit', 'apply_patch'].includes(details.toolName) && typeof file === 'string' && file) {
      modified.set(file, {
        path: file, tool: details.toolName,
        state: canonicalType === 'PreToolUse' ? 'editing' : 'updated',
        at: event.at, source: event.source || 'unknown-source',
        additions: validCount(details.additions), deletions: validCount(details.deletions)
      });
    }
  }

  const currentEvent = sessionEvents[sessionEvents.length - 1] || null;
  const currentDetails = detailsOf(currentEvent);
  const agentId = session && session.agentId || '';
  const permissionRequestObserved = sessionEvents.some((event) => {
    const details = detailsOf(event);
    return (details.canonicalType || event.type) === 'PermissionRequested' || event.type === 'PermissionRequest';
  });
  const permissionHookStatus = agentId === 'claude-code'
    ? 'verified hook; ' + (permissionRequestObserved ? 'request observed' : 'no request observed')
    : agentId === 'codex'
      ? 'implemented for Bash/apply_patch; live verification pending'
      : agentId === 'cursor'
        ? 'unsupported'
        : 'unavailable';
  const currentActivity = currentEvent
    ? observedTitle(currentEvent)
    : session ? 'Waiting for an observed agent event' : 'No agent session observed';
  const recommendationInput = {
    pending,
    sessions,
    events: events.filter((event) => ['claude-hook', 'cursor-hook', 'codex-hook'].includes(event.source)),
    now
  };

  return {
    protocolVersion: 1,
    agent: session ? agentName(session.agentId) : '',
    project: session ? projectName(session.cwd) : '',
    projectRoot: session && typeof session.cwd === 'string' ? session.cwd : '',
    sessionId: session && session.id || '',
    selectedSessionKey: session ? sessionKey(session) : '',
    sessionIndicators: orderedSessions.map((item) => ({
      key: sessionKey(item),
      id: item.id,
      agentId: item.agentId || 'claude-code',
      agent: agentName(item.agentId || 'claude-code'),
      project: projectName(item.cwd),
      state: item.state || 'idle',
      last: Number(item.last || 0),
      selected: Boolean(session && sessionKey(item) === sessionKey(session))
    })),
    sessionState: session && session.state || 'idle',
    sessionLastEventAt: session && session.last || 0,
    currentActivity,
    currentTool: currentDetails.toolName || currentDetails.tool_name || '',
    currentSource: currentEvent && currentEvent.source || '',
    capabilities: {
      detected: Boolean(session && sessionEvents.length),
      hostApplicationDetection: false,
      connected: Boolean(session && !['ended', 'disconnected'].includes(session.state) &&
        (now - Number(session.last || 0) < 120_000 || pending.some((item) => item.sid === session.id && item.agentId === agentId))),
      sessionIdentified: Boolean(session && session.id),
      activityMonitored: Boolean(sessionEvents.length),
      permissionHookStatus,
      permissionRequestObserved,
      questionHandling: false,
      remoteDecisions: false
    },
    recentEvents,
    modifiedFiles: [...modified.values()].slice(-8).reverse().map((file) => ({
      ...file,
      displayPath: relativeToProject(file.path, session && session.cwd)
    })),
    recommendations: generateRecommendations(recommendationInput),
    limitations: {
      taskDescriptionAvailable: false,
      diffAvailable: false,
      lineCountsAvailable: false,
      questionsAvailable: false
    }
  };
}

function validCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function relativeToProject(file, cwd) {
  if (typeof file !== 'string' || typeof cwd !== 'string' || !cwd) return file;
  const root = cwd.replace(/[\\/]+$/, '');
  const prefix = root + (root.includes('\\') ? '\\' : '/');
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

module.exports = { buildIslandModel, detailsOf, projectName, observedTitle, sessionKey, agentName };
