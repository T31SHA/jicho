'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const SCHEMA_VERSION = 2;
const APPROVAL_STATES = ['CREATED', 'PENDING', 'DELIVERED', 'VIEWED', 'APPROVED', 'DENIED', 'CANCELLED', 'EXPIRED', 'FAILED', 'SUPERSEDED'];
const TERMINAL_REASONS = new Set(['timeout', 'resolved-elsewhere', 'connection-close', 'app-shutdown', 'process-restart']);
const MAX_JSON_BYTES = 32 * 1024;

function jsonBounded(value, maxBytes = MAX_JSON_BYTES) {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, 'utf8') <= maxBytes) return encoded;
  return JSON.stringify({ truncated: true, originalBytes: Buffer.byteLength(encoded, 'utf8') });
}

function compactAction(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result = {};
  let budget = 0;
  for (const [key, value] of Object.entries(input)) {
    const safeKey = String(key).slice(0, 128);
    if (/^(content|contents|old_string|new_string|edits|cell_content|tool_response|stdout|stderr|output|prompt)$/i.test(key)) {
      if (typeof value === 'string') result[safeKey + 'Length'] = value.length;
      continue;
    }
    if (typeof value === 'string') {
      const limit = key === 'command' ? 4000 : 1200;
      result[safeKey] = value.slice(0, limit);
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      result[safeKey] = value;
    } else if (Array.isArray(value)) {
      result[safeKey] = value.slice(0, 30).map((item) => {
        if (typeof item === 'string') return item.slice(0, 500);
        if (typeof item === 'number' || typeof item === 'boolean' || item === null) return item;
        return '[non-scalar omitted]';
      });
    } else if (typeof value === 'object') {
      result[safeKey] = '[object omitted]';
    }
    budget += Buffer.byteLength(JSON.stringify(result), 'utf8');
    if (budget > MAX_JSON_BYTES / 2) break;
  }
  return result;
}

function lineDiffCounts(oldText, newText) {
  if (typeof oldText !== 'string' || typeof newText !== 'string') return null;
  const splitLines = (text) => {
    if (!text) return [];
    const lines = text.split(/\r\n|\n|\r/);
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
  };
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  if (oldLines.length > 400 || newLines.length > 400) return null;

  let previous = new Uint16Array(newLines.length + 1);
  for (const oldLine of oldLines) {
    const current = new Uint16Array(newLines.length + 1);
    for (let index = 1; index <= newLines.length; index += 1) {
      current[index] = oldLine === newLines[index - 1]
        ? previous[index - 1] + 1
        : Math.max(previous[index], current[index - 1]);
    }
    previous = current;
  }
  const common = previous[newLines.length];
  return { additions: newLines.length - common, deletions: oldLines.length - common };
}

function safeEventDetails(body) {
  const input = body.tool_input && typeof body.tool_input === 'object' && !Array.isArray(body.tool_input) ? body.tool_input : {};
  const details = {};
  if (typeof body.tool_name === 'string') details.toolName = body.tool_name.slice(0, 128);
  if (typeof body.tool_use_id === 'string') details.toolUseId = body.tool_use_id.slice(0, 256);
  if (typeof body.turn_id === 'string') details.turnId = body.turn_id.slice(0, 256);
  if (typeof body.permission_mode === 'string') details.permissionMode = body.permission_mode.slice(0, 64);
  if (typeof body.source === 'string') details.sessionStartSource = body.source.slice(0, 64);
  if (typeof body.reason === 'string') details.reason = body.reason.slice(0, 128);
  if (typeof body.cwd === 'string') details.cwd = body.cwd.slice(0, 2048);
  if (typeof body.cursor_version === 'string') details.cursorVersion = body.cursor_version.slice(0, 64);
  if (Array.isArray(body.workspace_roots)) details.workspaceRoots = body.workspace_roots.slice(0, 16)
    .filter((root) => typeof root === 'string').map((root) => root.slice(0, 2048));
  if (typeof body.duration_ms === 'number' && Number.isFinite(body.duration_ms)) details.durationMs = body.duration_ms;
  if (typeof body.duration === 'number' && Number.isFinite(body.duration)) details.durationMs = body.duration;
  if (typeof body.is_interrupt === 'boolean') details.interrupted = body.is_interrupt;
  if (typeof body.error === 'string') {
    details.errorPresent = true;
    const exitCode = /^Exit code (-?\d+)\b/.exec(body.error);
    if (exitCode) details.exitCode = Number(exitCode[1]);
  }
  if (typeof body.notification_type === 'string') details.notificationType = body.notification_type.slice(0, 128);
  if (typeof body.agent_id === 'string') details.subagentId = body.agent_id.slice(0, 256);
  if (typeof body.agent_type === 'string') details.subagentType = body.agent_type.slice(0, 128);
  if (typeof body.tool_name === 'string') details.toolName = body.tool_name.slice(0, 128);
  if (typeof body.tool_use_id === 'string') details.toolUseId = body.tool_use_id.slice(0, 256);
  if (typeof body.failure_type === 'string') details.failureType = body.failure_type.slice(0, 128);
  if (typeof body.status === 'string') details.status = body.status.slice(0, 64);
  if (typeof body.subagent_type === 'string') details.subagentType = body.subagent_type.slice(0, 128);
  if (Array.isArray(body.modified_files)) details.modifiedFiles = body.modified_files.slice(0, 64)
    .filter((file) => typeof file === 'string').map((file) => file.slice(0, 2048));
  if (typeof body.file_path === 'string') details.filePath = body.file_path.slice(0, 2048);
  if (typeof input.command === 'string') details.command = input.command.slice(0, 2000);
  if (typeof input.file_path === 'string') details.filePath = input.file_path.slice(0, 2048);
  if (typeof input.path === 'string') details.path = input.path.slice(0, 2048);
  if (body.hook_event_name === 'PostToolUse' && body.tool_name === 'Edit' &&
      typeof input.old_string === 'string' && typeof input.new_string === 'string') {
    const counts = lineDiffCounts(input.old_string, input.new_string);
    if (counts) Object.assign(details, counts);
  }
  return details;
}

class Store {
  constructor(filename) {
    if (typeof filename !== 'string' || !filename) throw new TypeError('A SQLite database path is required.');
    this.filename = filename;
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new Database(filename);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.pragma('busy_timeout = 5000');
    this.migrate();
    this.restrictFilePermissions();
  }

  restrictFilePermissions() {
    if (this.filename === ':memory:' || process.platform === 'win32') return;
    for (const suffix of ['', '-wal', '-shm']) {
      const file = this.filename + suffix;
      try { if (fs.existsSync(file)) fs.chmodSync(file, 0o600); }
      catch (error) { throw new Error('Could not restrict Jicho database permissions: ' + error.message); }
    }
  }

  migrate() {
    let version = this.db.pragma('user_version', { simple: true });
    if (version > SCHEMA_VERSION) throw new Error('Jicho database is newer than this application supports.');
    if (version === 0) {
      const migrateV1 = this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE workspaces (
            id TEXT PRIMARY KEY,
            root TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL,
            created_at INTEGER NOT NULL
          );
          CREATE TABLE sessions (
            agent_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
            cwd TEXT NOT NULL DEFAULT '',
            state TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            last_activity_at INTEGER NOT NULL,
            PRIMARY KEY (agent_id, session_id)
          );
          CREATE INDEX sessions_last_activity_idx ON sessions(last_activity_at DESC);
          CREATE TABLE events (
            id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            source TEXT NOT NULL,
            event_type TEXT NOT NULL,
            observed_at INTEGER NOT NULL,
            details_json TEXT NOT NULL,
            FOREIGN KEY (agent_id, session_id) REFERENCES sessions(agent_id, session_id) ON DELETE CASCADE
          );
          CREATE INDEX events_session_time_idx ON events(agent_id, session_id, observed_at DESC);
          CREATE INDEX events_recent_time_idx ON events(observed_at DESC);
          CREATE TABLE approval_requests (
            id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            request_type TEXT NOT NULL,
            tool_name TEXT NOT NULL DEFAULT '',
            action_json TEXT NOT NULL,
            risk_level TEXT NOT NULL,
            risk_flags_json TEXT NOT NULL,
            context_json TEXT NOT NULL,
            decision_options_json TEXT NOT NULL,
            state TEXT NOT NULL CHECK (state IN ('CREATED','PENDING','DELIVERED','VIEWED','APPROVED','DENIED','CANCELLED','EXPIRED','FAILED','SUPERSEDED')),
            delivery_status TEXT NOT NULL DEFAULT 'local-pending',
            decision_source TEXT,
            resolution_reason TEXT,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (agent_id, session_id) REFERENCES sessions(agent_id, session_id) ON DELETE RESTRICT
          );
          CREATE INDEX approval_requests_session_time_idx ON approval_requests(agent_id, session_id, created_at DESC);
          CREATE INDEX approval_requests_state_expiry_idx ON approval_requests(state, expires_at);
          CREATE TABLE approval_decisions (
            request_id TEXT PRIMARY KEY REFERENCES approval_requests(id) ON DELETE RESTRICT,
            decision TEXT NOT NULL CHECK (decision IN ('allow','deny')),
            source TEXT NOT NULL,
            decided_at INTEGER NOT NULL,
            details_json TEXT NOT NULL
          );
          CREATE TABLE audit_records (
            id TEXT PRIMARY KEY,
            request_id TEXT REFERENCES approval_requests(id) ON DELETE SET NULL,
            agent_id TEXT,
            session_id TEXT,
            record_type TEXT NOT NULL,
            decision TEXT,
            source TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            details_json TEXT NOT NULL
          );
          CREATE INDEX audit_records_request_time_idx ON audit_records(request_id, created_at DESC);
          CREATE INDEX audit_records_recent_time_idx ON audit_records(created_at DESC);
        `);
        this.db.pragma('user_version = 1');
      });
      migrateV1();
      version = 1;
    }
    if (version === 1) {
      const migrateV2 = this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE hook_auth_nonces (
            installation_id TEXT NOT NULL,
            nonce TEXT NOT NULL,
            signed_at INTEGER NOT NULL,
            consumed_at INTEGER NOT NULL,
            PRIMARY KEY (installation_id, nonce)
          );
          CREATE INDEX hook_auth_nonces_time_idx ON hook_auth_nonces(consumed_at);
        `);
        this.db.pragma('user_version = 2');
      });
      migrateV2();
    }
  }

  consumeHookNonce(installationId, nonce, signedAt, now = Date.now()) {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM hook_auth_nonces WHERE consumed_at < ?').run(now - 5 * 60_000);
      const result = this.db.prepare(`INSERT OR IGNORE INTO hook_auth_nonces
        (installation_id, nonce, signed_at, consumed_at) VALUES (?, ?, ?, ?)`).run(installationId, nonce, signedAt, now);
      return result.changes === 1;
    });
    const consumed = tx();
    this.restrictFilePermissions();
    return consumed;
  }

  ensureWorkspace(cwd, now) {
    if (typeof cwd !== 'string' || !cwd) return null;
    let row = this.db.prepare('SELECT id FROM workspaces WHERE root = ?').get(cwd);
    if (!row) {
      const id = crypto.randomUUID();
      this.db.prepare('INSERT INTO workspaces (id, root, label, created_at) VALUES (?, ?, ?, ?)')
        .run(id, cwd, path.basename(cwd) || cwd, now);
      row = { id };
    }
    return row.id;
  }

  upsertSession(session) {
    const now = Number(session.last || Date.now());
    const workspaceId = this.ensureWorkspace(session.cwd || '', now);
    this.db.prepare(`INSERT INTO sessions (agent_id, session_id, workspace_id, cwd, state, started_at, last_activity_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id, session_id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        cwd = CASE WHEN excluded.cwd <> '' THEN excluded.cwd ELSE sessions.cwd END,
        state = excluded.state,
        last_activity_at = excluded.last_activity_at`)
      .run(session.agentId || 'claude-code', session.id, workspaceId, session.cwd || '', session.state || 'idle', Number(session.startedAt || now), now);
    this.restrictFilePermissions();
  }

  listSessions(agentId = 'claude-code') {
    return this.db.prepare(`SELECT session_id AS id, agent_id AS agentId, cwd, state, started_at AS startedAt,
      last_activity_at AS last FROM sessions WHERE agent_id = ? AND last_activity_at >= ? ORDER BY last_activity_at DESC`)
      .all(agentId, Date.now() - 30 * 60 * 1000);
  }

  listAllSessions() {
    return this.db.prepare(`SELECT session_id AS id, agent_id AS agentId, cwd, state, started_at AS startedAt,
      last_activity_at AS last FROM sessions WHERE last_activity_at >= ? ORDER BY last_activity_at DESC`)
      .all(Date.now() - 30 * 60 * 1000);
  }

  appendEvent(event) {
    this.db.prepare(`INSERT INTO events (id, agent_id, session_id, source, event_type, observed_at, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(event.id || crypto.randomUUID(), event.agentId || 'claude-code', event.sessionId,
        event.source || 'claude-hook', event.type, event.at || Date.now(), jsonBounded(event.details || {}));
    this.restrictFilePermissions();
  }

  createApproval(item) {
    const tx = this.db.transaction(() => {
      const workspaceId = this.ensureWorkspace(item.cwd || '', item.at);
      this.db.prepare(`INSERT INTO approval_requests
        (id, agent_id, session_id, workspace_id, created_at, expires_at, request_type, tool_name, action_json,
         risk_level, risk_flags_json, context_json, decision_options_json, state, delivery_status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 'local-pending', ?)`)
        .run(item.id, item.agentId || 'claude-code', item.sid, workspaceId, item.at, item.expiresAt,
          'tool-permission', String(item.tool || '').slice(0, 128), jsonBounded(compactAction(item.input)), item.riskLevel,
          jsonBounded(item.riskFlags || []), jsonBounded({ cwd: String(item.cwd || '').slice(0, 2048) }),
          jsonBounded(['allow', 'deny']), item.at);
      this.appendEvent({
        id: crypto.randomUUID(), agentId: item.agentId, sessionId: item.sid, source: item.agentId + '-hook',
        type: 'PermissionRequest', at: item.at,
        details: {
          toolName: String(item.tool || '').slice(0, 128), cwd: String(item.cwd || '').slice(0, 2048), riskLevel: item.riskLevel,
          canonicalType: item.canonical && item.canonical.type || 'PermissionRequested',
          protocolVersion: item.canonical && item.canonical.protocolVersion || 1,
          provenance: item.canonical && item.canonical.provenance || { adapterId: item.agentId || 'claude-code', interface: 'authenticated-command-hook', sourceEventName: 'PermissionRequest' }
        }
      });
    });
    tx();
    this.restrictFilePermissions();
  }

  addAudit(record) {
    this.db.prepare(`INSERT INTO audit_records
      (id, request_id, agent_id, session_id, record_type, decision, source, created_at, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(crypto.randomUUID(), record.requestId || null, record.agentId || null, record.sessionId || null,
        record.type, record.decision || null, record.source || 'jicho', record.at || Date.now(), jsonBounded(record.details || {}));
  }

  resolveApproval(id, decision, reason, source, now = Date.now()) {
    if (decision !== null && decision !== 'allow' && decision !== 'deny') throw new TypeError('Invalid approval decision.');
    if (reason && !TERMINAL_REASONS.has(reason) && decision === null) reason = 'failed';
    const tx = this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(id);
      if (!row || row.state !== 'PENDING') return { changed: false, state: row ? row.state : null, accepted: false };
      let finalDecision = decision;
      let state;
      let finalReason = reason || null;
      if (row.expires_at <= now) {
        state = 'EXPIRED'; finalDecision = null; finalReason = 'timeout';
      } else if (decision === 'allow') state = 'APPROVED';
      else if (decision === 'deny') state = 'DENIED';
      else if (reason === 'timeout') state = 'EXPIRED';
      else if (reason === 'resolved-elsewhere') state = 'SUPERSEDED';
      else if (reason === 'connection-close') state = 'CANCELLED';
      else state = 'FAILED';

      const updated = this.db.prepare(`UPDATE approval_requests SET state = ?, decision_source = ?, resolution_reason = ?,
        delivery_status = ?, updated_at = ? WHERE id = ? AND state = 'PENDING'`).run(
        state, finalDecision ? source : null, finalReason, finalDecision ? 'decision-recorded' : 'not-delivered', now, id);
      if (updated.changes !== 1) return { changed: false, state: 'PENDING', accepted: false };
      if (finalDecision) {
        this.db.prepare(`INSERT INTO approval_decisions (request_id, decision, source, decided_at, details_json)
          VALUES (?, ?, ?, ?, ?)`)
          .run(id, finalDecision, source, now, jsonBounded({ reason: reason || null }));
      }
      this.addAudit({ requestId: id, agentId: row.agent_id, sessionId: row.session_id,
        type: 'approval-resolved', decision: finalDecision, source: source || 'jicho', at: now,
        details: { state, reason: finalReason } });
      return { changed: true, state, accepted: finalDecision === decision, decision: finalDecision };
    });
    const result = tx();
    this.restrictFilePermissions();
    return result;
  }

  recoverInterrupted(now = Date.now()) {
    const tx = this.db.transaction(() => {
      const pending = this.db.prepare("SELECT id, agent_id, session_id FROM approval_requests WHERE state IN ('CREATED','PENDING','DELIVERED','VIEWED')").all();
      const update = this.db.prepare(`UPDATE approval_requests SET state = 'FAILED', delivery_status = 'not-delivered',
        resolution_reason = 'process-restart', updated_at = ? WHERE id = ? AND state IN ('CREATED','PENDING','DELIVERED','VIEWED')`);
      for (const item of pending) {
        update.run(now, item.id);
        this.addAudit({ requestId: item.id, agentId: item.agent_id, sessionId: item.session_id,
          type: 'approval-interrupted', source: 'jicho-recovery', at: now,
          details: { reason: 'Original hook response no longer exists after process restart.' } });
      }
      this.db.prepare("UPDATE sessions SET state = 'disconnected', last_activity_at = ? WHERE state <> 'disconnected'").run(now);
      return pending.length;
    });
    const result = tx();
    this.restrictFilePermissions();
    return result;
  }

  listEvents(agentId = 'claude-code', sessionId, limit = 500) {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 500)));
    return this.db.prepare(`SELECT id, agent_id AS agentId, session_id AS sessionId, source,
      event_type AS type, observed_at AS at, details_json AS detailsJson FROM events
      WHERE agent_id = ? AND session_id = ? ORDER BY observed_at DESC LIMIT ?`).all(agentId, sessionId, safeLimit)
      .map((row) => ({ ...row, details: JSON.parse(row.detailsJson) }));
  }

  listRecentActivity(limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    return this.db.prepare(`SELECT id, agent_id AS agentId, session_id AS sessionId, source,
      event_type AS type, observed_at AS at, details_json AS detailsJson FROM events
      UNION ALL
      SELECT id, agent_id AS agentId, session_id AS sessionId, source,
      record_type AS type, created_at AS at, details_json AS detailsJson FROM audit_records
      WHERE record_type IN ('approval-resolved', 'approval-interrupted')
      ORDER BY at DESC LIMIT ?`).all(safeLimit)
      .map((row) => ({ ...row, details: JSON.parse(row.detailsJson) }));
  }

  close() { this.db.close(); }
}

module.exports = { Store, SCHEMA_VERSION, APPROVAL_STATES, compactAction, safeEventDetails, lineDiffCounts };
