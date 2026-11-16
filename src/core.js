// Jicho core: each approval request IS one open HTTP response. No lookup, no misrouting.
const crypto = require('crypto');
const { EventEmitter } = require('events');

class Core extends EventEmitter {
  constructor() { super(); this.pending = new Map(); this.sessions = new Map(); }

  touch(sid, patch) {
    const s = Object.assign({ id: sid, state: 'idle', cwd: '', last: Date.now() }, this.sessions.get(sid), patch, { last: Date.now() });
    this.sessions.set(sid, s); this.emit('sessions', [...this.sessions.values()]); return s;
  }

  request(body) {
    const holdMs = Number(process.env.JICHO_HOLD_MS || 110000); // keep below the hook timeout we install (120s)
    const sid = body.session_id || 'unknown';
    const id = crypto.randomUUID();
    this.touch(sid, { state: 'needs-you', cwd: body.cwd || '' });
    return new Promise((resolve) => {
      const item = { id, sid, tool: body.tool_name, input: body.tool_input, cwd: body.cwd, at: Date.now(), resolve };
      item.timer = setTimeout(() => this.settle(id, null, 'timeout'), holdMs);
      this.pending.set(id, item);
      this.emit('pending', this.list());
    });
  }

  // decision: 'allow' | 'deny' | null (null = no decision, Claude shows its own dialog)
  settle(id, decision, why, message) {
    const item = this.pending.get(id);
    if (!item) return false; // already answered elsewhere: never touch other requests
    clearTimeout(item.timer); this.pending.delete(id);
    let out = {};
    if (decision) {
      const d = { behavior: decision };
      if (decision === 'deny') d.message = message || 'Denied from Jicho';
      out = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: d } };
    }
    item.resolve(out);
    this.touch(item.sid, { state: decision ? 'working' : 'idle' });
    this.emit('settled', { id, decision, why }); this.emit('pending', this.list());
    return true;
  }

  dropBySession(sid) {
    for (const it of [...this.pending.values()]) if (it.sid === sid) this.settle(it.id, null, 'resolved-elsewhere');
  }

  list() { return [...this.pending.values()].map(({ id, sid, tool, input, cwd, at }) => ({ id, sid, tool, input, cwd, at })); }
}
module.exports = { Core };
