// The demo-proof: concurrent sessions, each answer must land on the right one.
const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.JICHO_HOLD_MS = '600';
const { Core } = require('../src/core');
const { createServer } = require('../src/server');
const { evaluate } = require('../src/policy');
const { macFor, verifyMac, PhoneBridge } = require('../src/phone');
const { EVENTS, isJichoHook, mergeHooks, removeHooks } = require('../bin/jicho');

const post = (port, body) => new Promise((resolve, reject) => {
  const r = http.request({ port, host: '127.0.0.1', method: 'POST' }, (res) => {
    let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(JSON.parse(d || '{}')));
  }); r.on('error', reject); r.end(JSON.stringify(body));
});
const postRaw = (port, body, headers = {}) => new Promise((resolve, reject) => {
  const r = http.request({ port, host: '127.0.0.1', method: 'POST', headers }, (res) => {
    let data = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
  }); r.on('error', reject); r.end(body);
});
const req = (sid, cmd) => ({ hook_event_name: 'PermissionRequest', session_id: sid, cwd: '/p/' + sid, tool_name: 'Bash', tool_input: { command: cmd } });
const behavior = (o) => o.hookSpecificOutput && o.hookSpecificOutput.decision.behavior;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const waitForPendingCount = async (core, count) => {
  const deadline = Date.now() + 2000;
  while (core.list().length !== count && Date.now() < deadline) await wait(5);
  assert.strictEqual(core.list().length, count, 'expected ' + count + ' concurrent pending requests');
};

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

  core.setPolicyEnabled(true);
  const ingressErrors = [];
  core.on('ingress-error', (detail) => ingressErrors.push(detail));
  const missingSession = await post(port, {
    hook_event_name: 'PermissionRequest', cwd: '/p/no-session', tool_name: 'Bash', tool_input: { command: 'git status' }
  });
  assert.deepStrictEqual(missingSession, {});
  assert.strictEqual(core.list().length, 0);
  assert.strictEqual(core.sessions.has('unknown'), false);
  assert(ingressErrors.some((detail) => detail.kind === 'invalid-session-id'));
  console.log('PASS 5: missing session identity cannot match an auto-allow rule');

  const firstSeenSafe = post(port, req('first-seen', 'git status'));
  await waitForPendingCount(core, 1);
  const firstSeenItem = core.list()[0];
  assert.strictEqual(firstSeenItem.sid, 'first-seen');
  assert.strictEqual(core.settle(firstSeenItem.id, 'deny', 'test'), true);
  assert.strictEqual(behavior(await firstSeenSafe), 'deny');
  core.touch('known-session', { state: 'working', cwd: '/p/known-session' });
  const knownSafe = await post(port, req('known-session', 'git status'));
  assert.strictEqual(behavior(knownSafe), 'allow');
  console.log('PASS 6: first-seen sessions require review before safe auto-allow applies');

  const malformed = await postRaw(port, '{not-json');
  assert.strictEqual(malformed.statusCode, 400);
  assert(ingressErrors.some((detail) => detail.kind === 'invalid-json'));
  const oversized = await postRaw(port, JSON.stringify({ value: 'x'.repeat(1024 * 1024 + 10) }));
  assert.strictEqual(oversized.statusCode, 413);
  assert(ingressErrors.some((detail) => detail.kind === 'payload-too-large'));
  console.log('PASS 7: malformed and oversized hook requests are rejected and reported');

  const dropped = http.request({ port, host: '127.0.0.1', method: 'POST' });
  dropped.on('error', () => {});
  dropped.end(JSON.stringify(req('H', 'connection-close-check')));
  await wait(80);
  const H = core.list().find((item) => item.sid === 'H');
  assert(H); dropped.destroy(); await wait(80);
  assert.strictEqual(core.list().some((item) => item.sid === 'H'), false);
  console.log('PASS 8: client disconnect clears its pending approval');

  const beforeQuit = post(port, req('shutdown', 'npm run build'));
  await waitForPendingCount(core, 1);
  const shutdownRequest = core.list()[0];
  assert.strictEqual(core.settle(shutdownRequest.id, null, 'app-shutdown'), true);
  assert.deepStrictEqual(await beforeQuit, {});
  console.log('PASS 9: graceful shutdown returns pending requests to the native permission flow');

  const safe = (command) => evaluate({ tool_name: 'Bash', tool_input: { command } }, true);
  assert.strictEqual(safe('git status').autoAllow, true);
  for (const command of ['git status; git diff', 'git status && git diff', 'git status || true', 'git status | cat', 'git status $(whoami)', 'git status > out.txt', 'git status < in.txt', 'git status &']) {
    const result = safe(command);
    assert.strictEqual(result.autoAllow, false, 'must refuse chained command: ' + command);
    assert(result.riskFlags.some((flag) => flag.code === 'shell-chain'));
  }
  console.log('PASS 10: allowlist rejects shell chaining and redirection');

  const secret = crypto.randomBytes(32).toString('hex');
  const mac = macFor(secret, 'request-1', 'allow');
  assert.strictEqual(verifyMac(secret, 'request-1', 'allow', mac), true);
  assert.strictEqual(verifyMac(secret, 'request-2', 'allow', mac), false);
  assert.strictEqual(verifyMac(secret, 'request-1', 'deny', mac), false);
  assert.strictEqual(verifyMac(secret, 'request-1', 'allow', 'not-a-mac'), false);
  assert.strictEqual(verifyMac(crypto.randomBytes(32).toString('hex'), 'request-1', 'allow', mac), false);
  console.log('PASS 11: phone HMAC accepts only the signed request and decision');

  const phoneDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jicho-phone-test-'));
  const phoneConfigPath = path.join(phoneDirectory, 'phone.json');
  const corruptConfig = '{not-json\n';
  fs.writeFileSync(phoneConfigPath, corruptConfig, { mode: 0o600 });
  const bridge = new PhoneBridge(new Core(), phoneDirectory);
  assert.strictEqual(bridge.storageBlocked, true);
  assert.strictEqual(bridge.setEnabled(true), false);
  assert.strictEqual(bridge.viewState().topic, '');
  assert.strictEqual(fs.readFileSync(phoneConfigPath, 'utf8'), corruptConfig);
  bridge.close();
  fs.rmSync(phoneDirectory, { recursive: true, force: true });
  console.log('PASS 12: invalid phone settings remain untouched and phone actions fail closed');

  const initial = { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'keep-me' }] }] } };
  const firstInstall = mergeHooks(initial);
  const secondInstall = mergeHooks(firstInstall.settings);
  assert.strictEqual(firstInstall.added, EVENTS.length);
  assert.strictEqual(secondInstall.added, 0);
  assert.deepStrictEqual(secondInstall.settings, firstInstall.settings);
  for (const event of EVENTS) {
    const hooks = (secondInstall.settings.hooks[event] || []).flatMap((group) => group.hooks || []);
    assert.strictEqual(hooks.filter(isJichoHook).length, 1, 'one Jicho hook for ' + event);
  }
  const uninstalled = removeHooks(secondInstall.settings);
  assert.strictEqual(uninstalled.removed, EVENTS.length);
  assert.strictEqual(uninstalled.settings.hooks.PreToolUse[0].hooks[0].command, 'keep-me');
  assert.strictEqual(EVENTS.includes('SessionStart'), false);
  console.log('PASS 13: installer is idempotent, preserves unrelated hooks, and skips unsupported HTTP SessionStart');

  const bulk = Array.from({ length: 20 }, (_, index) => post(port, req('bulk-' + index, 'printf demo-' + index)));
  await waitForPendingCount(core, 20);
  const bulkItems = core.list();
  const expected = new Map(bulkItems.map((item) => {
    const index = Number(item.sid.slice('bulk-'.length));
    const decision = index % 3 === 0 ? 'allow' : 'deny';
    return [item.sid, decision];
  }));
  for (const item of [...bulkItems].reverse()) core.settle(item.id, expected.get(item.sid), 'concurrency-test');
  const bulkReplies = await Promise.all(bulk);
  bulkReplies.forEach((reply, index) => assert.strictEqual(behavior(reply), expected.get('bulk-' + index)));
  assert.strictEqual(core.list().length, 0);
  console.log('PASS 14: 20 concurrent requests each receive their own answer');

  const authCore = new Core();
  const authServer = createServer(authCore, { token: 'test-token' });
  await new Promise((resolve) => authServer.listen(0, '127.0.0.1', resolve));
  const authPort = authServer.address().port;
  const authPayload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'auth-session', cwd: '/p/auth' });
  assert.strictEqual((await postRaw(authPort, authPayload)).statusCode, 401);
  const authorized = await postRaw(authPort, authPayload, { authorization: 'Bearer test-token' });
  assert.strictEqual(authorized.statusCode, 200);
  assert.strictEqual(authCore.sessions.has('auth-session'), true);
  await new Promise((resolve) => authServer.close(resolve));
  console.log('PASS 15: configured loopback bearer tokens are enforced');

  await new Promise((resolve) => srv.close(resolve)); console.log('ALL PASS');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
