// Jicho core: each approval request IS one open HTTP response. No lookup, no misrouting.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { evaluate } = require('./policy');

function isValidSessionId(sid) {
  return typeof sid === 'string' && sid.length > 0 && sid.length <= 256 && sid.trim() === sid && !/[\u0000-\u001f\u007f]/.test(sid);
}

class Core extends EventEmitter {
  constructor(options = {}) {
    super();
    this.pending = new Map();
    this.sessions = new Map();
    this.policyEnabled = Boolean(options.policyEnabled);
    this.auditFile = options.auditFile || null;
  }

  setPolicyEnabled(enabled) { this.policyEnabled = Boolean(enabled); }

  touch(sid, patch) {
    if (!isValidSessionId(sid)) {
      this.emit('request-rejected', { reason: 'invalid-session-id', event: 'session-update' });
      return null;
    }
    const s = Object.assign({ id: sid, state: 'idle', cwd: '', last: Date.now() }, this.sessions.get(sid), patch, { id: sid, last: Date.now() });
    this.sessions.set(sid, s); this.emit('sessions', [...this.sessions.values()]); return s;
  }

  request(body, onRegistered) {
    const holdMs = Number(process.env.JICHO_HOLD_MS || 110000); // keep below the hook timeout we install (120s)
    const sid = body && body.session_id;
    if (!isValidSessionId(sid)) {
      this.emit('request-rejected', { reason: 'invalid-session-id', event: 'PermissionRequest' });
      return Promise.resolve({});
    }
    const id = crypto.randomUUID();
    const policy = evaluate(body, this.policyEnabled && this.sessions.has(sid));
    const item = {
      id, sid, tool: body.tool_name, input: body.tool_input, cwd: body.cwd,
      at: Date.now(), riskFlags: policy.riskFlags
    };
    if (policy.autoAllow) {
      this.recordDecision(item, 'allow', 'allowlist');
      this.touch(sid, { state: 'working', cwd: body.cwd || '' });
      this.emit('settled', { id, decision: 'allow', why: 'allowlist' });
      return Promise.resolve(this.reply('allow'));
    }
    this.touch(sid, { state: 'needs-you', cwd: body.cwd || '' });
    return new Promise((resolve) => {
      item.resolve = resolve;
      item.timer = setTimeout(() => this.settle(id, null, 'timeout'), holdMs);
      this.pending.set(id, item);
      if (typeof onRegistered === 'function') onRegistered(id);
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
    this.setPolicyEnabled(true);
    return this.settle(id, 'allow', 'always-allowlist');
  }

  recordDecision(item, decision, why) {
    if (!this.auditFile) return;
    const record = {
      time: new Date().toISOString(),
      id: item.id,
      sessionId: item.sid,
      cwd: item.cwd || '',
      tool: item.tool || '',
      decision: decision || 'none',
      reason: why || '',
      riskFlags: item.riskFlags || []
    };
    try {
      fs.mkdirSync(path.dirname(this.auditFile), { recursive: true, mode: 0o700 });
      fs.appendFileSync(this.auditFile, JSON.stringify(record) + '\n', { mode: 0o600 });
    } catch (error) {
      this.emit('audit-error', error);
    }
  }

  // decision: 'allow' | 'deny' | null (null = no decision, Claude shows its own dialog)
  settle(id, decision, why, message) {
    if (![null, 'allow', 'deny'].includes(decision)) return false;
    const item = this.pending.get(id);
    if (!item) return false; // already answered elsewhere: never touch other requests
    clearTimeout(item.timer); this.pending.delete(id);
    const out = decision ? this.reply(decision, message) : {};
    this.recordDecision(item, decision, why);
    item.resolve(out);
    this.touch(item.sid, { state: decision ? 'working' : 'idle' });
    this.emit('settled', { id, decision, why }); this.emit('pending', this.list());
    return true;
  }

  dropBySession(sid) {
    if (!isValidSessionId(sid)) return false;
    for (const it of [...this.pending.values()]) if (it.sid === sid) this.settle(it.id, null, 'resolved-elsewhere');
    return true;
  }

  list() { return [...this.pending.values()].map(({ id, sid, tool, input, cwd, at, riskFlags }) => ({ id, sid, tool, input, cwd, at, riskFlags })); }
}
module.exports = { Core, isValidSessionId };
