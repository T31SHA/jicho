const http = require('http');
const { Core } = require('./core');
const PORT = Number(process.env.JICHO_PORT || 47821);
const TOKEN = process.env.JICHO_TOKEN || '';

function createServer(core) {
  return http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(404); return res.end(); }
    if (TOKEN && req.headers.authorization !== 'Bearer ' + TOKEN) { res.writeHead(401); return res.end(); }
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', async () => {
      let body = {}; try { body = JSON.parse(data || '{}'); } catch {}
      const ev = body.hook_event_name;
      if (ev === 'PermissionRequest') {
        let closed = false; res.on('close', () => { closed = true; });
        const out = await core.request(body);
        if (closed) return;
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(out));
      }
      if (ev === 'PostToolUse' || ev === 'Stop' || ev === 'SessionEnd') {
        core.dropBySession(body.session_id);
        core.touch(body.session_id, { state: ev === 'PostToolUse' ? 'working' : 'idle' });
      } else if (ev === 'UserPromptSubmit' || ev === 'PreToolUse' || ev === 'SessionStart') {
        core.touch(body.session_id, { state: 'working', cwd: body.cwd || '' });
      }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}');
    });
  });
}
module.exports = { createServer };

if (require.main === module) {
  const core = new Core();
  core.on('pending', (l) => l.length && console.log('PENDING', l.map((x) => x.sid.slice(0, 6) + ':' + x.tool).join(', ')));
  createServer(core).listen(PORT, '127.0.0.1', () => console.log('Jicho core on http://127.0.0.1:' + PORT));
  process.stdin.setEncoding('utf8'); // dev-only: type "a" or "d" to answer the oldest request
  process.stdin.on('data', (k) => { const f = core.list()[0]; if (f) core.settle(f.id, k.trim() === 'd' ? 'deny' : 'allow', 'cli'); });
}
