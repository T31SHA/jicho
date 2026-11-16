'use strict';

const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.JICHO_PORT || 47821);
const SESSION_COUNT = 3;

function permissionRequest(port, sessionId, cwd, command, token) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      hook_event_name: 'PermissionRequest',
      session_id: sessionId,
      cwd,
      tool_name: 'Bash',
      tool_input: { command }
    });
    const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) };
    if (token) headers.authorization = 'Bearer ' + token;
    const request = http.request({ host: '127.0.0.1', port, method: 'POST', headers }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error('Jicho returned HTTP ' + response.statusCode + (response.statusCode === 401 ? '; check JICHO_TOKEN' : '')));
          return;
        }
        try { resolve(JSON.parse(data || '{}')); }
        catch (error) { reject(new Error('Jicho returned invalid JSON: ' + error.message)); }
      });
    });
    request.setTimeout(125000, () => request.destroy(new Error('No answer arrived before the demo request timed out.')));
    request.on('error', reject);
    request.end(body);
  });
}

function replyLabel(reply) {
  const behavior = reply && reply.hookSpecificOutput && reply.hookSpecificOutput.decision && reply.hookSpecificOutput.decision.behavior;
  if (behavior === 'allow' || behavior === 'deny') return behavior.toUpperCase();
  return '{} (Jicho timed out or the request closed; the agent would show its own dialog)';
}

async function runDemo(options = {}) {
  const port = options.port || PORT;
  const cwd = options.cwd || process.cwd();
  const token = options.token === undefined ? process.env.JICHO_TOKEN || '' : options.token;
  const log = options.log || console.log;
  const runId = crypto.randomUUID().slice(0, 8);

  log('Sending 3 concurrent fake permission requests to Jicho at 127.0.0.1:' + port + '.');
  log('Answer each card in the desktop overlay; the fake sessions will report the replies.');

  const requests = Array.from({ length: SESSION_COUNT }, (_, index) => {
    const number = index + 1;
    const sessionId = 'jicho-demo-' + runId + '-' + number;
    const command = "printf 'Jicho demo request " + number + "\\n'";
    log('Fake session ' + number + ' is waiting for an answer.');
    return permissionRequest(port, sessionId, cwd, command, token)
      .then((reply) => {
        log('Fake session ' + number + ' received: ' + replyLabel(reply));
        return { sessionId, reply };
      })
      .catch((error) => {
        const hint = error.code === 'ECONNREFUSED' ? ' Start the desktop app with `npm start` first.' : '';
        log('Fake session ' + number + ' failed: ' + error.message + hint);
        return { sessionId, error };
      });
  });

  const results = await Promise.all(requests);
  return results.every((result) => !result.error);
}

if (require.main === module) {
  runDemo().then((ok) => { if (!ok) process.exitCode = 1; });
}

module.exports = { SESSION_COUNT, permissionRequest, replyLabel, runDemo };
