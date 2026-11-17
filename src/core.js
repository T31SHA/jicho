// Each permission request remains attached to its original hook response.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { evaluate } = require('./policy');
const { safeEventDetails } = require('./store');

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

const OBSERVED_HOOKS = new Set([
  'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'Notification', 'SubagentStart', 'SubagentStop', 'SessionEnd'
]);

class Core extends EventEmitter {
  constructor(options = {}) {
    super();
    this.pending = new Map();
    this.sessions = new Map();
    this.policyEnabled = Boolean(options.policyEnabled);
    this.auditFile = options.auditFile || null;
    this.store = options.store || null;
    if (this.store) {
      const recovered = this.store.recoverInterrupted();
      for (const session of this.store.listSessions()) {
        this.sessions.set(session.id, { ...session, state: 'disconnected', knownForPolicy: false });
      }
      if (recovered) this.emit('recovered', { interruptedRequests: recovered });
    }
  }

  setPolicyEnabled(enabled) { this.policyEnabled = Boolean(enabled); }

  touch(sid, patch = {}, options = {}) {
    if (!isValidSessionId(sid)) {
      this.emit('request-rejected', { reason: 'invalid-session-id', event: 'session-update' });
      return null;
    }
    const now = Date.now();
    const previous = this.sessions.get(sid);
    const observedForPolicy = options.policyEligible !== false;
    const s = Object.assign({ id: sid, agentId: 'claude-code', state: 'idle', cwd: '', last: now, startedAt: now }, previous, patch, {
      id: sid,
      agentId: 'claude-code',
      last: now,
      startedAt: previous && previous.startedAt || now,
      knownForPolicy: Boolean((previous && previous.knownForPolicy) || observedForPolicy)
    });
    if (this.store) this.store.upsertSession(s);
    this.sessions.set(sid, s);
    this.emit('sessions', [...this.sessions.values()]);
    return s;
  }

  observeEvent(body) {
    const type = body && body.hook_event_name;
    const sid = body && body.session_id;
    if (!OBSERVED_HOOKS.has(type) || !isValidSessionId(sid)) return false;
    const policyEligible = type === 'UserPromptSubmit';
    let state = 'working';
    if (type === 'Stop') state = 'idle';
    if (type === 'SessionEnd') state = 'ended';
    if (type === 'Notification') state = 'needs-you';
    this.touch(sid, { state, cwd: typeof body.cwd === 'string' ? body.cwd : '' }, { policyEligible });
    const event = {
      id: crypto.randomUUID(), agentId: 'claude-code', sessionId: sid,
      source: 'claude-hook', type, at: Date.now(), details: safeEventDetails(body)
    };
    if (this.store) this.store.appendEvent(event);
    this.emit('activity', event);
    if (type === 'PostToolUse' || type === 'Stop' || type === 'SessionEnd') this.dropBySession(sid);
    return true;
  }

  request(body, onRegistered) {
    const configuredHold = Number(process.env.JICHO_HOLD_MS || 110000); // below the installed hook timeout
    const holdMs = Number.isFinite(configuredHold) ? Math.max(1, Math.min(configuredHold, 110000)) : 110000;
    const sid = body && body.session_id;
    if (!isValidSessionId(sid)) {
      this.emit('request-rejected', { reason: 'invalid-session-id', event: 'PermissionRequest' });
      return Promise.resolve({});
    }

    const session = this.sessions.get(sid);
    const policy = evaluate(body, this.policyEnabled && Boolean(session && session.knownForPolicy));
    const now = Date.now();
    const item = {
      id: crypto.randomUUID(), sid, agentId: 'claude-code', tool: body.tool_name,
      input: body.tool_input, cwd: body.cwd, at: now, expiresAt: now + holdMs,
      riskFlags: policy.riskFlags, riskLevel: riskLevel(policy.riskFlags)
    };

    try {
      this.touch(sid, { state: 'needs-you', cwd: typeof body.cwd === 'string' ? body.cwd : '' }, { policyEligible: false });
      if (this.store) this.store.createApproval(item);
    } catch (error) {
      this.emit('store-error', error);
      return Promise.resolve({});
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
      try { this.touch(sid, { state: 'working', cwd: body.cwd || '' }, { policyEligible: false }); }
      catch (error) { this.emit('store-error', error); }
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
    if (!item) return false;
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

  // decision: 'allow' | 'deny' | null (null returns control to Claude's native prompt)
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
    try { this.touch(item.sid, { state: actualDecision ? 'working' : 'idle' }, { policyEligible: false }); }
    catch (error) { this.emit('store-error', error); }
    this.emit('settled', { id, decision: actualDecision, why, state: resolution.state });
    this.emit('pending', this.list());
    return decision === null ? Boolean(resolution.changed) : accepted;
  }

  dropBySession(sid) {
    if (!isValidSessionId(sid)) return false;
    for (const it of [...this.pending.values()]) if (it.sid === sid) this.settle(it.id, null, 'resolved-elsewhere');
    return true;
  }

  list() {
    return [...this.pending.values()].map(({ id, sid, tool, input, cwd, at, expiresAt, riskFlags, riskLevel }) => ({
      id, sid, tool, input, cwd, at, expiresAt, riskFlags, riskLevel,
      canAlways: evaluate({ session_id: sid, tool_name: tool, tool_input: input, cwd }, true).autoAllow
    }));
  }

  expireIdleSessions(now = Date.now(), idleMs = 30 * 60 * 1000) {
    const activeSessions = new Set([...this.pending.values()].map((item) => item.sid));
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
