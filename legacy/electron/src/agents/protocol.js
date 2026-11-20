'use strict';

const crypto = require('crypto');

const EVENT_PROTOCOL_VERSION = 1;
const CANONICAL_EVENT_TYPES = Object.freeze([
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequested', 'PermissionResolved', 'AskUserQuestion', 'FileRead', 'FileChanged',
  'DiffAvailable', 'SubagentStart', 'SubagentStop', 'TurnCompleted', 'SessionEnd', 'Notification', 'AgentError'
]);

const CLAUDE_EVENT_MAP = Object.freeze({
  SessionStart: 'SessionStart',
  UserPromptSubmit: 'UserPromptSubmit',
  PreToolUse: 'PreToolUse',
  PostToolUse: 'PostToolUse',
  PostToolUseFailure: 'PostToolUseFailure',
  PermissionRequest: 'PermissionRequested',
  StopFailure: 'AgentError',
  Notification: 'Notification',
  SubagentStart: 'SubagentStart',
  SubagentStop: 'SubagentStop',
  Stop: 'TurnCompleted',
  SessionEnd: 'SessionEnd'
});

const CURSOR_EVENT_MAP = Object.freeze({
  sessionStart: 'SessionStart',
  sessionEnd: 'SessionEnd',
  postToolUse: 'PostToolUse',
  postToolUseFailure: 'PostToolUseFailure',
  afterShellExecution: 'PostToolUse',
  afterMCPExecution: 'PostToolUse',
  afterFileEdit: 'FileChanged',
  subagentStop: 'SubagentStop',
  stop: 'TurnCompleted'
});

const CODEX_EVENT_MAP = Object.freeze({
  SessionStart: 'SessionStart',
  UserPromptSubmit: 'UserPromptSubmit',
  PreToolUse: 'PreToolUse',
  PostToolUse: 'PostToolUse',
  PostToolUseFailure: 'PostToolUseFailure',
  PermissionRequest: 'PermissionRequested',
  Stop: 'TurnCompleted',
  SessionEnd: 'SessionEnd',
  SubagentStart: 'SubagentStart',
  SubagentStop: 'SubagentStop',
  Interrupt: 'AgentError'
});

function validIdentity(value, maxLength = 256) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function normalizeClaudeEvent(payload, options = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const sourceEventName = payload.hook_event_name;
  const type = CLAUDE_EVENT_MAP[sourceEventName];
  if (!type || !validIdentity(payload.session_id)) return null;
  const evidence = typeof options.evidenceBuilder === 'function' ? options.evidenceBuilder(payload) : {};
  return {
    protocol: 'jicho.agent-event',
    protocolVersion: EVENT_PROTOCOL_VERSION,
    eventId: options.eventId || crypto.randomUUID(),
    agentId: 'claude-code',
    sessionId: payload.session_id,
    projectRoot: typeof payload.cwd === 'string' ? payload.cwd.slice(0, 4096) : '',
    type,
    observedAt: Number.isFinite(options.observedAt) ? options.observedAt : Date.now(),
    provenance: {
      adapterId: 'claude-code',
      interface: 'authenticated-command-hook',
      sourceEventName
    },
    evidence: evidence && typeof evidence === 'object' && !Array.isArray(evidence) ? evidence : {}
  };
}

function normalizeCursorEvent(payload, options = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const sourceEventName = payload.hook_event_name;
  const type = CURSOR_EVENT_MAP[sourceEventName];
  const roots = payload.workspace_roots;
  if (!type || !validIdentity(payload.conversation_id) || !validIdentity(payload.cursor_version, 64) ||
      !Array.isArray(roots) || roots.length < 1 || roots.length > 64 ||
      roots.some((root) => typeof root !== 'string' || !root || root.length > 4096)) return null;
  const cwd = typeof payload.cwd === 'string' && payload.cwd.length <= 4096 ? payload.cwd : '';
  const projectRoot = cwd || roots[0];
  const evidence = {
    cursorVersion: payload.cursor_version,
    workspaceRoots: roots.slice(0, 16).map((root) => root.slice(0, 4096))
  };
  for (const key of ['tool_name', 'tool_use_id', 'file_path', 'failure_type', 'subagent_type', 'status']) {
    if (typeof payload[key] === 'string') evidence[key] = payload[key].slice(0, key === 'file_path' ? 2048 : 256);
  }
  if (typeof payload.duration === 'number' && Number.isFinite(payload.duration)) evidence.durationMs = payload.duration;
  if (typeof payload.is_interrupt === 'boolean') evidence.interrupted = payload.is_interrupt;
  if (Array.isArray(payload.modified_files)) {
    evidence.modifiedFiles = payload.modified_files.slice(0, 64)
      .filter((file) => typeof file === 'string').map((file) => file.slice(0, 2048));
  }
  return {
    protocol: 'jicho.agent-event',
    protocolVersion: EVENT_PROTOCOL_VERSION,
    eventId: options.eventId || crypto.randomUUID(),
    agentId: 'cursor',
    sessionId: payload.conversation_id,
    projectRoot: projectRoot.slice(0, 4096),
    type,
    observedAt: Number.isFinite(options.observedAt) ? options.observedAt : Date.now(),
    provenance: { adapterId: 'cursor', interface: 'authenticated-command-hook', sourceEventName },
    evidence
  };
}

function normalizeCodexEvent(payload, options = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const sourceEventName = payload.hook_event_name;
  const type = CODEX_EVENT_MAP[sourceEventName];
  if (!type || !validIdentity(payload.session_id)) return null;
  const evidence = {};
  if (typeof payload.cwd === 'string') evidence.cwd = payload.cwd.slice(0, 4096);
  if (typeof payload.tool_name === 'string') evidence.toolName = payload.tool_name.slice(0, 128);
  if (typeof payload.tool_use_id === 'string') evidence.toolUseId = payload.tool_use_id.slice(0, 256);
  if (typeof payload.turn_id === 'string') evidence.turnId = payload.turn_id.slice(0, 256);
  if (typeof payload.permission_mode === 'string') evidence.permissionMode = payload.permission_mode.slice(0, 64);
  if (typeof payload.source === 'string') evidence.sessionStartSource = payload.source.slice(0, 64);
  if (typeof payload.reason === 'string') evidence.reason = payload.reason.slice(0, 128);
  if (typeof payload.agent_id === 'string') evidence.subagentId = payload.agent_id.slice(0, 256);
  if (typeof payload.agent_type === 'string') evidence.subagentType = payload.agent_type.slice(0, 128);
  if (payload.tool_input && typeof payload.tool_input === 'object' && !Array.isArray(payload.tool_input)) {
    for (const key of ['command', 'file_path', 'path', 'description']) {
      if (typeof payload.tool_input[key] === 'string') evidence[key === 'file_path' ? 'filePath' : key] = payload.tool_input[key].slice(0, key === 'command' ? 4000 : 2048);
    }
  }
  return {
    protocol: 'jicho.agent-event',
    protocolVersion: EVENT_PROTOCOL_VERSION,
    eventId: options.eventId || crypto.randomUUID(),
    agentId: 'codex',
    sessionId: payload.session_id,
    projectRoot: typeof payload.cwd === 'string' ? payload.cwd.slice(0, 4096) : '',
    type,
    observedAt: Number.isFinite(options.observedAt) ? options.observedAt : Date.now(),
    provenance: { adapterId: 'codex', interface: 'authenticated-command-hook', sourceEventName },
    evidence
  };
}

function validateCanonicalEvent(event) {
  return Boolean(event && event.protocol === 'jicho.agent-event' &&
    event.protocolVersion === EVENT_PROTOCOL_VERSION && validIdentity(event.eventId) &&
    validIdentity(event.agentId, 64) && validIdentity(event.sessionId) &&
    CANONICAL_EVENT_TYPES.includes(event.type) && Number.isFinite(event.observedAt) &&
    event.provenance && validIdentity(event.provenance.adapterId, 64) &&
    validIdentity(event.provenance.sourceEventName, 128) &&
    event.evidence && typeof event.evidence === 'object' && !Array.isArray(event.evidence));
}

const ADAPTER_METHODS = Object.freeze([
  'discover', 'identify', 'connect', 'subscribe', 'normalize', 'healthCheck', 'getCapabilities', 'handleDecision'
]);

function validateAdapter(adapter) {
  if (!adapter || !validIdentity(adapter.id, 64) || !validIdentity(adapter.name, 128)) return false;
  return ADAPTER_METHODS.every((method) => typeof adapter[method] === 'function');
}

class AdapterRegistry {
  constructor() { this.adapters = new Map(); }

  register(adapter) {
    if (!validateAdapter(adapter)) throw new TypeError('Agent adapter does not implement the JICHO adapter contract.');
    if (this.adapters.has(adapter.id)) throw new Error('An agent adapter is already registered: ' + adapter.id);
    this.adapters.set(adapter.id, adapter);
    return adapter;
  }

  get(id) { return this.adapters.get(id) || null; }
  list() { return [...this.adapters.values()]; }
}

module.exports = {
  EVENT_PROTOCOL_VERSION,
  CANONICAL_EVENT_TYPES,
  CLAUDE_EVENT_MAP,
  CURSOR_EVENT_MAP,
  CODEX_EVENT_MAP,
  ADAPTER_METHODS,
  normalizeClaudeEvent,
  normalizeCursorEvent,
  normalizeCodexEvent,
  validateCanonicalEvent,
  validateAdapter,
  AdapterRegistry
};
