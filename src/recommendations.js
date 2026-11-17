'use strict';

const TEST_COMMAND = /(?:\bnpm\s+(?:run\s+)?test\b|\bpnpm\s+(?:run\s+)?test\b|\byarn\s+test\b|\bpytest\b|\bcargo\s+test\b|\bgo\s+test\b|\bmake\s+test\b)/i;
const FILE_WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit', 'MultiEdit', 'apply_patch']);

function eventDetails(event) {
  if (event && event.details && typeof event.details === 'object') return event.details;
  if (event && typeof event.detailsJson === 'string') {
    try { return JSON.parse(event.detailsJson); } catch (_) { return {}; }
  }
  return {};
}

function generateRecommendations({ pending = [], sessions = [], events = [], now = Date.now(), inactiveAfterMs = 10 * 60_000 } = {}) {
  const result = [];
  for (const item of pending) {
    result.push({
      id: 'approval:' + item.id,
      title: 'Permission is waiting',
      message: (item.tool || 'A tool') + ' is waiting for your decision.',
      confidence: 'HIGH',
      evidence: ['Pending request ' + String(item.id).slice(0, 12), item.cwd || 'Project path unavailable'],
      sessionId: item.sid,
      eventId: item.id,
      at: item.at || now
    });
  }

  const bySession = new Map();
  for (const event of events) {
    const key = String(event.agentId || 'claude-code') + '\u0000' + String(event.sessionId || '');
    if (!bySession.has(key)) bySession.set(key, []);
    bySession.get(key).push(event);
  }

  for (const session of sessions) {
    const key = String(session.agentId || 'claude-code') + '\u0000' + String(session.id || '');
    const history = (bySession.get(key) || []).slice().sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
    const latest = history[history.length - 1];

    const failed = [...history].reverse().find((event) => {
      const details = eventDetails(event);
      return (details.canonicalType || event.type) === 'PostToolUseFailure';
    });
    if (failed) {
      const details = eventDetails(failed);
      result.push({
        id: 'tool-failure:' + failed.id,
        title: 'Review a reported tool failure',
        message: 'The agent reported that a tool call failed.',
        confidence: 'HIGH',
        evidence: [details.toolName || 'Tool name unavailable', details.exitCode === undefined ? 'Failure event observed' : 'Exit code ' + details.exitCode],
        sessionId: session.id,
        eventId: failed.id,
        at: failed.at
      });
    }

    const lastWriteIndex = history.reduce((found, event, index) => {
      const details = eventDetails(event);
      const file = details.filePath || details.path;
      const type = details.canonicalType || event.type;
      const fileChanged = type === 'FileChanged' && file;
      const claudeFileWrite = ['PreToolUse', 'PostToolUse'].includes(type) && FILE_WRITE_TOOLS.has(details.toolName) && file;
      return fileChanged || claudeFileWrite ? index : found;
    }, -1);
    if (lastWriteIndex >= 0 && session.agentId !== 'cursor') {
      const write = history[lastWriteIndex];
      const details = eventDetails(write);
      const fileName = String(details.filePath || details.path).split(/[\\/]/).filter(Boolean).pop();
      const testObserved = history.slice(lastWriteIndex + 1).some((event) => {
        const eventData = eventDetails(event);
        const type = eventData.canonicalType || event.type;
        return ['PreToolUse', 'PostToolUse', 'PostToolUseFailure'].includes(type) &&
          eventData.toolName === 'Bash' && typeof eventData.command === 'string' && TEST_COMMAND.test(eventData.command);
      });
      if (!testObserved) {
        result.push({
          id: 'tests-after-change:' + write.id,
          title: 'Tests have not been observed after a file edit',
          message: 'Consider running the relevant tests after this observed edit.',
          confidence: 'MEDIUM',
          evidence: ['Observed ' + details.toolName + ' on ' + (fileName || 'a file'), 'No later test command event in this session'],
          sessionId: session.id,
          eventId: write.id,
          at: write.at
        });
      }
    }

    const lastAt = Number(latest && latest.at || session.last || 0);
    if (session.state === 'working' && lastAt > 0 && now - lastAt >= inactiveAfterMs) {
      const minutes = Math.max(1, Math.floor((now - lastAt) / 60_000));
      result.push({
        id: 'inactive:' + key,
        title: 'No recent agent activity observed',
        message: 'JICHO has not received an event from this session for about ' + minutes + ' minutes.',
        confidence: 'LOW',
        evidence: ['Last observed event at ' + new Date(lastAt).toISOString(), 'Session state may be stale'],
        sessionId: session.id,
        eventId: latest && latest.id || null,
        at: lastAt
      });
    }
  }

  const priority = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return result.sort((a, b) => priority[a.confidence] - priority[b.confidence] || Number(b.at || 0) - Number(a.at || 0)).slice(0, 8);
}

module.exports = { generateRecommendations, TEST_COMMAND, FILE_WRITE_TOOLS };
