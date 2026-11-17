'use strict';

const http = require('http');
const path = require('path');
const { Core, isValidSessionId } = require('./core');
const { Store } = require('./store');
const { sessionBinding, verifyRequest } = require('../bin/hook-support/protocol');
const { CredentialManager } = require('../bin/hook-support/credentials');

const PORT = Number(process.env.JICHO_PORT || 47821);
const MAX_BODY_BYTES = 1024 * 1024;
const AUTHENTICATED_EVENTS = new Set([
  'PermissionRequest', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'Stop', 'Notification', 'SubagentStart', 'SubagentStop', 'SessionEnd'
]);

function sendJson(res, statusCode, body) {
  if (res.destroyed || res.writableEnded) return;
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': payload.length,
    'cache-control': 'no-store'
  });
  res.end(payload);
}

function report(core, kind, message) {
  core.emit('ingress-error', { kind, message });
}

function isTrustedHookRequest(req) {
  const expectedHost = '127.0.0.1:' + req.socket.localPort;
  if (typeof req.headers.host !== 'string' || req.headers.host.toLowerCase() !== expectedHost) return false;
  // Claude's hook client sends no browser navigation metadata. This check keeps
  // the browser boundary even though native requests also need cryptographic auth.
  if (req.headers.origin !== undefined || req.headers.referer !== undefined) return false;
  const fetchSite = req.headers['sec-fetch-site'];
  if (typeof fetchSite === 'string' && fetchSite.toLowerCase() !== 'none') return false;
  return true;
}

function validateHookBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'invalid-event';
  if (!AUTHENTICATED_EVENTS.has(body.hook_event_name)) return 'invalid-event';
  if (!isValidSessionId(body.session_id)) return 'invalid-session-id';
  if (body.cwd !== undefined && (typeof body.cwd !== 'string' || body.cwd.length > 4096)) return 'invalid-event';
  if (body.hook_event_name === 'PermissionRequest') {
    if (typeof body.tool_name !== 'string' || !body.tool_name || body.tool_name.length > 128) return 'invalid-event';
    if (!body.tool_input || typeof body.tool_input !== 'object' || Array.isArray(body.tool_input)) return 'invalid-event';
  }
  return null;
}

function createServer(core, options = {}) {
  const maxBodyBytes = Number.isInteger(options.maxBodyBytes) && options.maxBodyBytes > 0
    ? options.maxBodyBytes
    : MAX_BODY_BYTES;
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  const skewMs = Number.isInteger(options.maxClockSkewMs) && options.maxClockSkewMs > 0
    ? options.maxClockSkewMs
    : 30_000;
  const credentialProvider = typeof options.credentialProvider === 'function'
    ? options.credentialProvider
    : () => options.credential || null;
  const replayed = new Map();

  function consumeNonce(installationId, nonce, signedAt) {
    const now = clock();
    if (core.store && typeof core.store.consumeHookNonce === 'function') {
      return core.store.consumeHookNonce(installationId, nonce, signedAt, now);
    }
    for (const [key, expiresAt] of replayed) if (expiresAt < now) replayed.delete(key);
    const key = installationId + ':' + nonce;
    if (replayed.has(key)) return false;
    replayed.set(key, now + skewMs * 3);
    while (replayed.size > 10_000) replayed.delete(replayed.keys().next().value);
    return true;
  }

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/') { res.writeHead(404); return res.end(); }
    if (!isTrustedHookRequest(req)) {
      report(core, 'untrusted-request-context', 'Hook request did not use the expected loopback host or included browser-origin metadata.');
      req.resume();
      return sendJson(res, 403, { error: 'request_not_allowed' });
    }

    let credential;
    try { credential = credentialProvider(); }
    catch (_) { credential = null; }
    if (!credential) {
      report(core, 'credential-unavailable', 'The local hook credential is unavailable.');
      req.resume();
      return sendJson(res, 401, { error: 'unauthorized' });
    }

    if (req.headers['content-type'] !== 'application/json') {
      report(core, 'invalid-content-type', 'Hook request content type must be application/json.');
      req.resume();
      return sendJson(res, 400, { error: 'invalid_content_type' });
    }

    let totalBytes = 0;
    let rejected = false;
    const chunks = [];
    const contentLength = req.headers['content-length'];
    if (contentLength && Number(contentLength) > maxBodyBytes) {
      report(core, 'payload-too-large', 'Hook request exceeded the configured body limit.');
      sendJson(res, 413, { error: 'payload_too_large' });
      req.resume();
      return;
    }

    req.on('data', (chunk) => {
      if (rejected) return;
      totalBytes += chunk.length;
      if (totalBytes > maxBodyBytes) {
        rejected = true;
        chunks.length = 0;
        report(core, 'payload-too-large', 'Hook request exceeded the configured body limit.');
        sendJson(res, 413, { error: 'payload_too_large' });
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', () => {
      report(core, 'request-read-failed', 'Hook request body could not be read.');
      sendJson(res, 400, { error: 'request_read_failed' });
    });
    req.on('end', async () => {
      if (rejected) return;
      const rawBody = Buffer.concat(chunks);
      const verified = verifyRequest(credential, {
        installation: req.headers['x-jicho-installation'],
        timestamp: req.headers['x-jicho-timestamp'],
        nonce: req.headers['x-jicho-nonce'],
        session: req.headers['x-jicho-session'],
        signature: req.headers['x-jicho-signature']
      }, rawBody, clock());
      if (!verified.ok) {
        const kind = verified.reason === 'expired' ? 'expired-request' :
          verified.reason === 'installation-mismatch' ? 'incorrect-installation' :
            verified.reason === 'bad-signature' ? 'invalid-signature' : 'invalid-authentication';
        report(core, kind, 'Hook request authentication failed.');
        return sendJson(res, 401, { error: 'unauthorized' });
      }

      let body;
      try { body = JSON.parse(rawBody.toString('utf8') || '{}'); }
      catch (_) {
        report(core, 'invalid-json', 'Hook request body is not valid JSON.');
        return sendJson(res, 400, { error: 'invalid_json' });
      }
      const bodyError = validateHookBody(body);
      if (bodyError) {
        report(core, bodyError, bodyError === 'invalid-session-id'
          ? 'Hook request did not contain a valid session_id.'
          : 'Hook request did not match the required event schema.');
        return sendJson(res, 400, { error: bodyError.replace(/-/g, '_') });
      }
      if (verified.sessionHash !== sessionBinding(body.session_id)) {
        report(core, 'incorrect-session-binding', 'Hook request session binding did not match its body.');
        return sendJson(res, 401, { error: 'unauthorized' });
      }
      try {
        if (!consumeNonce(verified.installationId, verified.nonce, verified.timestamp)) {
          report(core, 'replayed-request', 'Hook request nonce has already been used.');
          return sendJson(res, 401, { error: 'unauthorized' });
        }
      } catch (_) {
        report(core, 'replay-store-unavailable', 'Hook request replay protection is unavailable.');
        return sendJson(res, 503, { error: 'request_unavailable' });
      }

      if (body.hook_event_name === 'PermissionRequest') {
        let closed = false;
        let requestId = null;
        const closePending = () => {
          if (closed) return;
          closed = true;
          if (requestId) core.settle(requestId, null, 'connection-close');
        };
        res.once('close', () => { if (!res.writableFinished) closePending(); });
        req.once('aborted', closePending);
        try {
          const out = await core.request(body, (id) => {
            requestId = id;
            if (closed) core.settle(id, null, 'connection-close');
          });
          if (closed || res.destroyed || res.writableEnded) return;
          return sendJson(res, 200, out);
        } catch (_) {
          report(core, 'approval-processing-failed', 'Permission request processing failed.');
          return sendJson(res, 200, {});
        }
      }
      try { core.observeEvent(body); }
      catch (_) { report(core, 'event-processing-failed', 'Hook event processing failed.'); }
      return sendJson(res, 200, {});
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

module.exports = { createServer, MAX_BODY_BYTES, AUTHENTICATED_EVENTS, validateHookBody, isTrustedHookRequest };

if (require.main === module) {
  const credentialManager = new CredentialManager();
  const store = new Store(path.join(credentialManager.directory, 'hook-events.sqlite3'));
  const core = new Core({ store });
  core.on('pending', (items) => items.length && console.log('PENDING', items.map((item) => item.sid.slice(0, 6) + ':' + item.tool).join(', ')));
  createServer(core, { credentialProvider: () => credentialManager.getCredential() })
    .listen(PORT, '127.0.0.1', () => console.log('Jicho authenticated core on http://127.0.0.1:' + PORT));
  process.stdin.setEncoding('utf8'); // dev-only: type "a" or "d" to answer the oldest request
  process.stdin.on('data', (key) => { const item = core.list()[0]; if (item) core.settle(item.id, key.trim() === 'd' ? 'deny' : 'allow', 'cli'); });
  process.on('exit', () => store.close());
}
