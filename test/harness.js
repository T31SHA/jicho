// The demo-proof: concurrent sessions, each answer must land on the right one.
const assert = require('assert');
const http = require('http');
process.env.JICHO_HOLD_MS = '600';
const { Core } = require('../src/core');
const { createServer } = require('../src/server');

const post = (port, body) => new Promise((resolve, reject) => {
  const r = http.request({ port, host: '127.0.0.1', method: 'POST' }, (res) => {
    let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(JSON.parse(d || '{}')));
  }); r.on('error', reject); r.end(JSON.stringify(body));
});
const req = (sid, cmd) => ({ hook_event_name: 'PermissionRequest', session_id: sid, cwd: '/p/' + sid, tool_name: 'Bash', tool_input: { command: cmd } });
const behavior = (o) => o.hookSpecificOutput && o.hookSpecificOutput.decision.behavior;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const core = new Core(); const srv = createServer(core);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port;

  const A = post(port, req('A', 'ls')), B = post(port, req('B', 'rm -rf x')), C = post(port, req('C', 'npm i'));
  await wait(100);
  const byS = Object.fromEntries(core.list().map((x) => [x.sid, x.id]));
  core.settle(byS.C, 'allow'); core.settle(byS.A, 'deny'); core.settle(byS.B, 'allow');
  const [a, b, c] = await Promise.all([A, B, C]);
  assert.strictEqual(behavior(a), 'deny'); assert.strictEqual(behavior(b), 'allow'); assert.strictEqual(behavior(c), 'allow');
  console.log('PASS 1: answers routed to the correct sessions');

  const D = post(port, req('D', 'git push')); await wait(80);
  await post(port, { hook_event_name: 'PostToolUse', session_id: 'D' });
  assert.deepStrictEqual(await D, {}); assert.strictEqual(core.list().length, 0);
  console.log('PASS 2: answered in terminal -> card vanishes, no decision sent');

  assert.deepStrictEqual(await post(port, req('E', 'x')), {});
  console.log('PASS 3: timeout falls through to the terminal dialog');

  const F = post(port, req('F', 'a')), G = post(port, req('G', 'b')); await wait(80);
  const [f, g] = core.list(); core.settle(f.id, 'allow');
  assert.strictEqual(core.settle(f.id, 'deny'), false); assert.strictEqual(core.list().length, 1);
  core.settle(g.id, 'deny'); await Promise.all([F, G]);
  console.log('PASS 4: stale answers ignored, no cross-session muting');

  srv.close(); console.log('ALL PASS');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
