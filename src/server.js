const http = require('http');
const crypto = require('crypto');
const { Core, isValidSessionId } = require('./core');
const PORT = Number(process.env.JICHO_PORT || 47821);
const TOKEN = process.env.JICHO_TOKEN || '';
const MAX_BODY_BYTES = 1024 * 1024;

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

function hasValidBearer(header, token) {
  if (!token) return true;
  const prefix = 'Bearer ';
  if (typeof header !== 'string' || !header.startsWith(prefix)) return false;
  const actual = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(token);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function createServer(core, options = {}) {
  const token = options.token === undefined ? TOKEN : String(options.token || '');
  const maxBodyBytes = Number.isInteger(options.maxBodyBytes) && options.maxBodyBytes > 0
    ? options.maxBodyBytes
    : MAX_BODY_BYTES;
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/') { res.writeHead(404); return res.end(); }
    if (!hasValidBearer(req.headers.authorization, token)) {
      req.resume();
      return sendJson(res, 401, { error: 'unauthorized' });
    }

    let totalBytes = 0;
    let rejected = false;
    const chunks = [];
    const contentLength = req.headers['content-length'];
    if (contentLength && Number(contentLength) > maxBodyBytes) {
      rejected = true;
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
    req.on('error', (error) => {
      report(core, 'request-read-failed', error.message);
      sendJson(res, 400, { error: 'request_read_failed' });
    });
    req.on('end', async () => {
      if (rejected) return;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
      catch (error) {
        report(core, 'invalid-json', error.message);
        return sendJson(res, 400, { error: 'invalid_json' });
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        report(core, 'invalid-event', 'Hook body must be a JSON object.');
        return sendJson(res, 400, { error: 'invalid_event' });
      }
      const ev = body.hook_event_name;
      if (ev === 'PermissionRequest') {
        if (!isValidSessionId(body.session_id)) {
          report(core, 'invalid-session-id', 'PermissionRequest did not contain a valid session_id.');
          return sendJson(res, 200, {});
        }
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
        } catch (error) {
          report(core, 'approval-processing-failed', error.message);
          return sendJson(res, 200, {});
        }
      }
      if (ev && !isValidSessionId(body.session_id)) {
        report(core, 'invalid-session-id', 'Hook event did not contain a valid session_id.');
        return sendJson(res, 200, {});
      }
      if (ev) {
        try { core.observeEvent(body); }
        catch (error) {
          report(core, 'event-processing-failed', error.message);
        }
      }
      return sendJson(res, 200, {});
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  return server;
}
module.exports = { createServer, MAX_BODY_BYTES, hasValidBearer };

if (require.main === module) {
  const core = new Core();
  core.on('pending', (l) => l.length && console.log('PENDING', l.map((x) => x.sid.slice(0, 6) + ':' + x.tool).join(', ')));
  createServer(core).listen(PORT, '127.0.0.1', () => console.log('Jicho core on http://127.0.0.1:' + PORT));
  process.stdin.setEncoding('utf8'); // dev-only: type "a" or "d" to answer the oldest request
  process.stdin.on('data', (k) => { const f = core.list()[0]; if (f) core.settle(f.id, k.trim() === 'd' ? 'deny' : 'allow', 'cli'); });
}
