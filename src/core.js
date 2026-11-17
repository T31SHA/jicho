// Each permission request remains attached to its original hook response.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { evaluate } = require('./policy');
const { safeEventDetails } = require('./store');
const { AdapterRegistry } = require('./agents/protocol');
const { ClaudeCodeAdapter } = require('./agents/claude-code');
const { CursorAdapter } = require('./agents/cursor');
const { CodexAdapter } = require('./agents/codex');

function isValidSessionId(sid) {
  return typeof sid === 'string' && sid.length > 0 && sid.length <= 256 && sid.trim() === sid && !/[\u0000-\u001f\u007f]/.test(sid);
}

function riskLevel(flags) {
  const codes = new Set((flags || []).map((flag) => flag.code));
  if (codes.has('rm-rf')) return 'CRITICAL';
  if (['curl-shell', 'sudo', 'force-push'].some((code) => codes.has(code))) return 'HIGH';
  if (codes.has('env-file') || codes.has('shell-chain')) return 'MEDIUM';
  return 'LOW';
}

function sessionMapKey(agentId, sid) { return agentId === 'claude-code' ? sid : agentId + ':' + sid; }

const OBSERVED_HOOKS = new Set([
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'Notification', 'SubagentStart', 'SubagentStop', 'SessionEnd'
]);

class Core extends EventEmitter {
  constructor(options = {}) {
    super();
    this.pending = new Map();
    this.sessions = new Map();
    this.policyEnabled = Boolean(options.policyEnabled);
    this.auditFile = options.auditFile || null;
    this.store = options.store || null;
    this.adapters = new AdapterRegistry();
    this.claudeAdapter = this.adapters.register(new ClaudeCodeAdapter({ core: this }));
    this.cursorAdapter = this.adapters.register(new CursorAdapter());
    this.codexAdapter = this.adapters.register(new CodexAdapter({ core: this }));
    if (this.store) {
      const recovered = this.store.recoverInterrupted();
      const recoveredSessions = this.store.listAllSessions ? this.store.listAllSessions() : this.store.listSessions();
      for (const session of recoveredSessions) {
        this.sessions.set(sessionMapKey(session.agentId || 'claude-code', session.id), { ...session, state: 'disconnected', knownForPolicy: false });
      }
      if (recovered) this.emit('recovered', { interruptedRequests: recovered });
    }
  }

  setPolicyEnabled(enabled) { this.policyEnabled = Boolean(enabled); }

  handleDecision(agentId, requestId, decision, source = 'adapter') {
    const adapter = this.adapters.get(agentId);
    return adapter ? adapter.handleDecision(requestId, decision, source) : false;
  }

  handleRequestDecision(requestId, decision, source = 'desktop') {
    const item = this.pending.get(requestId);
    if (!item) return false;
    const adapter = this.adapters.get(item.agentId);
    return adapter ? adapter.handleDecision(requestId, decision, source) : false;
  }

  emitPermissionResolved(item, decision, source) {
    this.emit('canonical-activity', {
      protocol: 'jicho.agent-event',
      protocolVersion: 1,
      eventId: crypto.randomUUID(),
      agentId: item.agentId,
      sessionId: item.sid,
      projectRoot: item.cwd || '',
      type: 'PermissionResolved',
      observedAt: Date.now(),
      provenance: { adapterId: item.agentId, interface: 'jicho-approval-core', sourceEventName: 'decision' },
      evidence: { requestId: item.id, decision, decisionSource: source || 'desktop' }
    });
  }

  touch(sid, patch = {}, options = {}) {
    if (!isValidSessionId(sid)) {
      this.emit('request-rejected', { reason: 'invalid-session-id', event: 'session-update' });
      return null;
    }
    const now = Date.now();
    const agentId = options.agentId || patch.agentId || 'claude-code';
    const mapKey = sessionMapKey(agentId, sid);
    const previous = this.sessions.get(mapKey);
    const observedForPolicy = options.policyEligible !== false;
    const s = Object.assign({ id: sid, agentId: 'claude-code', state: 'idle', cwd: '', last: now, startedAt: now }, previous, patch, {
      id: sid,
      agentId,
      last: now,
      startedAt: previous && previous.startedAt || now,
      knownForPolicy: Boolean((previous && previous.knownForPolicy) || observedForPolicy)
    });
    if (this.store) this.store.upsertSession(s);
    this.sessions.set(mapKey, s);
    this.emit('sessions', [...this.sessions.values()]);
    return s;
  }

  observeEvent(body) {
    const type = body && body.hook_event_name;
    const sid = body && body.session_id;
    if (!OBSERVED_HOOKS.has(type) || !isValidSessionId(sid)) return false;
    const canonical = this.claudeAdapter.normalize(body);
    if (!canonical) return false;
    const policyEligible = type === 'UserPromptSubmit';
    let state = 'working';
    if (type === 'SessionStart') state = 'idle';
    if (type === 'Stop') state = 'idle';
    if (type === 'SessionEnd') state = 'ended';
    if (type === 'Notification') state = 'needs-you';
    if (type === 'StopFailure') state = 'error';
    this.touch(sid, { state, cwd: typeof body.cwd === 'string' ? body.cwd : '' }, { policyEligible });
    const event = {
      id: crypto.randomUUID(), agentId: 'claude-code', sessionId: sid,
      source: 'claude-hook', type, canonicalType: canonical.type, protocolVersion: canonical.protocolVersion,
      provenance: canonical.provenance, at: canonical.observedAt,
      details: { ...safeEventDetails(body), canonicalType: canonical.type, protocolVersion: canonical.protocolVersion, provenance: canonical.provenance }
    };
    if (this.store) this.store.appendEvent(event);
    this.claudeAdapter.record(canonical);
    this.emit('canonical-activity', canonical);
    this.emit('activity', event);
    if (type === 'PostToolUse' || type === 'Stop' || type === 'StopFailure' || type === 'SessionEnd') this.dropBySession(sid);
    return true;
  }

  observeCursorEvent(body) {
    const canonical = this.cursorAdapter.normalize(body);
    if (!canonical) return false;
    const rawType = body.hook_event_name;
    let state = 'working';
    if (rawType === 'sessionStart') state = 'working';
    if (rawType === 'stop') state = 'idle';
    if (rawType === 'sessionEnd') state = 'ended';
    if (rawType === 'postToolUseFailure') state = 'error';
    const sid = canonical.sessionId;
    this.touch(sid, { agentId: 'cursor', state, cwd: canonical.projectRoot }, { policyEligible: false, agentId: 'cursor' });
    const event = {
      id: canonical.eventId,
      agentId: 'cursor', sessionId: sid, source: 'cursor-hook', type: rawType,
      canonicalType: canonical.type, protocolVersion: canonical.protocolVersion,
      provenance: canonical.provenance, at: canonical.observedAt,
      details: { ...safeEventDetails(body), canonicalType: canonical.type, protocolVersion: canonical.protocolVersion, provenance: canonical.provenance }
    };
    if (this.store) this.store.appendEvent(event);
    this.cursorAdapter.record(canonical);
    this.emit('canonical-activity', canonical);
    this.emit('activity', event);
    return true;
  }

  observeCodexEvent(body) {
    const canonical = this.codexAdapter.normalize(body);
    if (!canonical) return false;
    const rawType = body.hook_event_name;
    let state = 'working';
    if (rawType === 'SessionStart') state = 'idle';
    if (rawType === 'Stop' || rawType === 'Interrupt') state = 'idle';
    if (rawType === 'SessionEnd') state = 'ended';
    if (rawType === 'PostToolUseFailure') state = 'error';
    this.touch(canonical.sessionId, { agentId: 'codex', state, cwd: canonical.projectRoot }, { policyEligible: rawType === 'UserPromptSubmit', agentId: 'codex' });
    const event = {
      id: canonical.eventId, agentId: 'codex', sessionId: canonical.sessionId,
      source: 'codex-hook', type: rawType, canonicalType: canonical.type,
      protocolVersion: canonical.protocolVersion, provenance: canonical.provenance,
      at: canonical.observedAt,
      details: { ...safeEventDetails(body), canonicalType: canonical.type, protocolVersion: canonical.protocolVersion, provenance: canonical.provenance }
    };
    if (this.store) this.store.appendEvent(event);
    this.codexAdapter.record(canonical);
    this.emit('canonical-activity', canonical);
    this.emit('activity', event);
    if (rawType === 'PostToolUse' || rawType === 'Stop' || rawType === 'SessionEnd' || rawType === 'Interrupt') this.dropBySession(canonical.sessionId, 'codex');
    return true;
  }

  request(body, onRegistered, options = {}) {
    const agentId = typeof options === 'string' ? options : options.agentId || 'claude-code';
    const adapter = this.adapters.get(agentId);
    if (!adapter) return Promise.resolve({});
    const configuredHold = Number(process.env.JICHO_HOLD_MS || 110000); // below the installed hook timeout
    const holdMs = Number.isFinite(configuredHold) ? Math.max(1, Math.min(configuredHold, 110000)) : 110000;
    const sid = body && body.session_id;
    if (!isValidSessionId(sid)) {
      this.emit('request-rejected', { reason: 'invalid-session-id', event: 'PermissionRequest' });
      return Promise.resolve({});
    }

    const session = this.sessions.get(sessionMapKey(agentId, sid));
    const policy = evaluate(body, this.policyEnabled && Boolean(session && session.knownForPolicy));
    const now = Date.now();
    const item = {
      id: crypto.randomUUID(), sid, agentId, tool: body.tool_name,
      input: body.tool_input, cwd: body.cwd, at: now, expiresAt: now + holdMs,
      riskFlags: policy.riskFlags, riskLevel: riskLevel(policy.riskFlags)
    };
    const canonical = adapter.normalize(body);

    try {
      this.touch(sid, { agentId, state: 'needs-you', cwd: typeof body.cwd === 'string' ? body.cwd : '' }, { policyEligible: false, agentId });
      if (this.store) this.store.createApproval({ ...item, canonical });
    } catch (error) {
      this.emit('store-error', error);
      return Promise.resolve({});
    }

    if (canonical) {
      adapter.record(canonical);
      this.emit('canonical-activity', canonical);
    }

    if (policy.autoAllow) {
      try {
        if (this.store) {
          const result = this.store.resolveApproval(item.id, 'allow', 'allowlist', 'allowlist');
          if (!result.accepted) return Promise.resolve({});
        }
      } catch (error) {
        this.emit('store-error', error);
        return Promise.resolve({});
      }
      this.recordDecision(item, 'allow', 'allowlist');
      try { this.touch(sid, { agentId, state: 'working', cwd: body.cwd || '' }, { policyEligible: false, agentId }); }
      catch (error) { this.emit('store-error', error); }
      this.emitPermissionResolved(item, 'allow', 'allowlist');
      this.emit('settled', { id: item.id, decision: 'allow', why: 'allowlist' });
      return Promise.resolve(this.reply('allow'));
    }

    return new Promise((resolve) => {
      item.resolve = resolve;
      item.timer = setTimeout(() => this.settle(item.id, null, 'timeout'), holdMs);
      this.pending.set(item.id, item);
      if (typeof onRegistered === 'function') {
        try { onRegistered(item.id); } catch (error) { this.emit('registration-error', error); }
      }
      this.emit('pending', this.list());
    });
  }

  reply(decision, message) {
    const d = { behavior: decision };
    if (decision === 'deny') d.message = message || 'Denied from Jicho';
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: d } };
  }

  allowAlways(id) {
    const item = this.pending.get(id);
    if (!item || item.agentId !== 'claude-code') return false;
    const policy = evaluate({ session_id: item.sid, tool_name: item.tool, tool_input: item.input, cwd: item.cwd }, true);
    if (!policy.autoAllow) return false;
    const wasEnabled = this.policyEnabled;
    this.setPolicyEnabled(true);
    const settled = this.settle(id, 'allow', 'always-allowlist');
    if (!settled) this.setPolicyEnabled(wasEnabled);
    return settled;
  }

  recordDecision(item, decision, why) {
    if (!this.auditFile) return;
    const record = {
      time: new Date().toISOString(), id: item.id, sessionId: item.sid,
      cwd: item.cwd || '', tool: item.tool || '', decision: decision || 'none',
      reason: why || '', riskFlags: item.riskFlags || []
    };
    try {
      fs.mkdirSync(path.dirname(this.auditFile), { recursive: true, mode: 0o700 });
      fs.appendFileSync(this.auditFile, JSON.stringify(record) + '\n', { mode: 0o600 });
    } catch (error) { this.emit('audit-error', error); }
  }

  // decision: 'allow' | 'deny' | null (null returns control to the agent's native permission flow)
  settle(id, decision, why, message) {
    if (![null, 'allow', 'deny'].includes(decision)) return false;
    const item = this.pending.get(id);
    if (!item) return false;

    let resolution = { changed: true, accepted: true, state: decision === 'allow' ? 'APPROVED' : decision === 'deny' ? 'DENIED' : 'FAILED' };
    if (this.store) {
      try {
        resolution = this.store.resolveApproval(id, decision, why, why || 'desktop');
      } catch (error) {
        this.emit('store-error', error);
        resolution = { changed: true, accepted: false, state: 'FAILED', decision: null };
      }
    }

    clearTimeout(item.timer);
    this.pending.delete(id);
    const accepted = Boolean(resolution.changed && resolution.accepted);
    const actualDecision = accepted ? decision : null;
    const out = actualDecision ? this.reply(actualDecision, message) : {};
    if (accepted) this.recordDecision(item, decision, why);
    item.resolve(out);
    try { this.touch(item.sid, { agentId: item.agentId, state: actualDecision ? 'working' : 'idle' }, { policyEligible: false, agentId: item.agentId }); }
    catch (error) { this.emit('store-error', error); }
    if (accepted && actualDecision) this.emitPermissionResolved(item, actualDecision, why);
    this.emit('settled', { id, decision: actualDecision, why, state: resolution.state });
    this.emit('pending', this.list());
    return decision === null ? Boolean(resolution.changed) : accepted;
  }

  dropBySession(sid, agentId = 'claude-code') {
    if (!isValidSessionId(sid)) return false;
    for (const it of [...this.pending.values()]) if (it.agentId === agentId && it.sid === sid) this.settle(it.id, null, 'resolved-elsewhere');
    return true;
  }

  list() {
    return [...this.pending.values()].map(({ id, sid, agentId, tool, input, cwd, at, expiresAt, riskFlags, riskLevel }) => ({
      id, sid, agentId, tool, input, cwd, at, expiresAt, riskFlags, riskLevel,
      canAlways: agentId === 'claude-code' && evaluate({ session_id: sid, tool_name: tool, tool_input: input, cwd }, true).autoAllow
    }));
  }

  expireIdleSessions(now = Date.now(), idleMs = 30 * 60 * 1000) {
    const activeSessions = new Set([...this.pending.values()].map((item) => sessionMapKey(item.agentId || 'claude-code', item.sid)));
    let expired = 0;
    for (const [id, session] of this.sessions) {
      if (activeSessions.has(id) || now - Number(session.last || 0) <= idleMs) continue;
      this.sessions.delete(id);
      expired += 1;
    }
    if (expired) this.emit('sessions', [...this.sessions.values()]);
    return expired;
  }
}

module.exports = { Core, isValidSessionId, riskLevel, OBSERVED_HOOKS };
