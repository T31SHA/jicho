// The demo-proof: concurrent sessions, each answer must land on the right one.
const assert = require('assert');
const { spawnSync } = require('child_process');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
process.env.JICHO_HOLD_MS = '600';
const { Core } = require('../src/core');
const { Store, compactAction, safeEventDetails } = require('../src/store');
const { createServer } = require('../src/server');
const { evaluate } = require('../src/policy');
const { macFor, verifyMac, PhoneBridge, phonePreview, notificationFor, ntfyBaseUrl, ntfyPairingUrl } = require('../src/phone');
const { EVENTS, settingsPath, projectSettingsPath, selectSettingsTarget, atomicWrite, makeHook, isJichoHook, mergeHooks, removeHooks } = require('../bin/jicho');
const { CredentialManager } = require('../bin/hook-support/credentials');
const { signRequest, sessionBinding, MAX_CLOCK_SKEW_MS } = require('../bin/hook-support/protocol');
const { forwardHook } = require('../bin/hook-support/hook');
const { isTrustedMainFrame } = require('../src/ipc-security');
const { checkPort, settingsHooks, wrapperRoundTrip } = require('../src/doctor');
const { selectMascotMood } = require('../src/mascot-state');

const credentialDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jicho-auth-harness-'));
const credentialManager = new CredentialManager({ directory: credentialDirectory, forceFileStore: true, platform: 'test' });
credentialManager.ensureCredential();
let activeCredential = credentialManager.getCredential();

function signedHeaders(body, options = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  let sessionId = '';
  try { sessionId = JSON.parse(bytes.toString('utf8')).session_id || ''; } catch (_) {}
  const credential = options.credential || activeCredential;
  return {
    ...signRequest(credential, {
      body: bytes,
      timestamp: options.timestamp === undefined ? Date.now() : options.timestamp,
      nonce: options.nonce,
      sessionHash: options.sessionHash || sessionBinding(sessionId)
    }),
    'content-type': 'application/json',
    'content-length': bytes.length,
    ...(options.headers || {})
  };
}

const post = (port, body, authOptions = {}) => new Promise((resolve, reject) => {
  const raw = Buffer.from(JSON.stringify(body));
  const r = http.request({ port, host: '127.0.0.1', method: 'POST', headers: signedHeaders(raw, authOptions) }, (res) => {
    let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(JSON.parse(d || '{}')));
  }); r.on('error', reject); r.end(raw);
});
const postRaw = (port, body, headers = {}, authOptions = {}) => new Promise((resolve, reject) => {
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const requestHeaders = authOptions.unsigned ? { 'content-type': 'application/json', 'content-length': raw.length, ...headers } : signedHeaders(raw, { ...authOptions, headers });
  const r = http.request({ port, host: '127.0.0.1', method: 'POST', headers: requestHeaders }, (res) => {
    let data = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
  }); r.on('error', reject); r.end(raw);
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
  const core = new Core(); const srv = createServer(core, { credential: activeCredential });
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
  const missingSession = await postRaw(port, JSON.stringify({
    hook_event_name: 'PermissionRequest', cwd: '/p/no-session', tool_name: 'Bash', tool_input: { command: 'git status' }
  }));
  assert.strictEqual(missingSession.statusCode, 400);
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

  const droppedBody = Buffer.from(JSON.stringify(req('H', 'connection-close-check')));
  const dropped = http.request({ port, host: '127.0.0.1', method: 'POST', headers: signedHeaders(droppedBody) });
  dropped.on('error', () => {});
  dropped.end(droppedBody);
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

  const safePhoneItem = { id: 'phone-safe', cwd: '/work/repo', tool: 'Bash', input: { command: 'git status' }, riskFlags: [] };
  const phoneConfig = { topic: 'a'.repeat(32), replyTopic: 'a'.repeat(32) + '-reply', secret: 'b'.repeat(64), contentFree: false };
  const safeNotification = notificationFor(safePhoneItem, phoneConfig, 'https://ntfy.example.test/base');
  assert.deepStrictEqual(safeNotification.actions.map((entry) => entry.label), ['Approve', 'Deny']);
  const longPhoneItem = { ...safePhoneItem, id: 'phone-long', input: { command: 'HEAD_MARK ' + 'x'.repeat(150) + ' TAIL_MARK' } };
  const longPreview = phonePreview(longPhoneItem, false);
  assert.strictEqual(longPreview.truncated, true);
  assert.strictEqual(longPreview.allow, false);
  assert(longPreview.message.includes('HEAD_MARK'));
  assert(longPreview.message.includes('…'));
  assert(longPreview.message.includes('TAIL_MARK'));
  assert(longPreview.message.includes('Review on desktop'));
  assert.deepStrictEqual(notificationFor(longPhoneItem, phoneConfig).actions.map((entry) => entry.label), ['Deny']);
  const flaggedPhoneItem = { ...safePhoneItem, id: 'phone-risk', riskFlags: [{ code: 'sudo' }] };
  const flaggedNotification = notificationFor(flaggedPhoneItem, phoneConfig);
  assert.strictEqual(flaggedNotification.message, 'Review on desktop');
  assert.deepStrictEqual(flaggedNotification.actions.map((entry) => entry.label), ['Deny']);
  const contentFreeNotification = notificationFor(safePhoneItem, { ...phoneConfig, contentFree: true });
  assert.strictEqual(contentFreeNotification.message, 'Review on desktop');
  assert.deepStrictEqual(contentFreeNotification.actions.map((entry) => entry.label), ['Deny']);
  assert.strictEqual(ntfyBaseUrl('http://localhost:1234/selfhost/'), 'http://localhost:1234/selfhost');
  assert.strictEqual(ntfyPairingUrl('https://ntfy.example.test/base', 'topic'), 'ntfy://ntfy.example.test/base/topic');
  assert.throws(() => ntfyBaseUrl('file:///tmp/ntfy'), /HTTP or HTTPS/);
  console.log('PASS 12A: phone previews show both ends and truncation, risk, and content-free mode are Deny-only');

  const ntfyRequests = [];
  const localNtfy = http.createServer((request, response) => {
    if (request.method === 'GET') {
      ntfyRequests.push({ method: 'GET', url: request.url });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"event":"open"}\n');
      return;
    }
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      ntfyRequests.push({ method: 'POST', url: request.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      response.writeHead(200);
      response.end();
    });
  });
  await new Promise((resolve) => localNtfy.listen(0, '127.0.0.1', resolve));
  const oldNtfyUrl = process.env.JICHO_NTFY_URL;
  process.env.JICHO_NTFY_URL = 'http://127.0.0.1:' + localNtfy.address().port + '/selfhost';
  const selfHostedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jicho-phone-selfhost-'));
  fs.writeFileSync(path.join(selfHostedDirectory, 'phone.json'), JSON.stringify({ ...phoneConfig, enabled: false, contentFree: false }));
  const selfHostedBridge = new PhoneBridge(new Core(), selfHostedDirectory);
  selfHostedBridge.setEnabled(true);
  assert.strictEqual(await selfHostedBridge.publishRequest(safePhoneItem), true);
  const notificationDeadline = Date.now() + 1500;
  while (!ntfyRequests.some((entry) => entry.method === 'POST') && Date.now() < notificationDeadline) await wait(10);
  const postNotification = ntfyRequests.find((entry) => entry.method === 'POST');
  assert(postNotification);
  assert.strictEqual(postNotification.url, '/selfhost/');
  assert.strictEqual(postNotification.body.actions[0].url, 'http://127.0.0.1:' + localNtfy.address().port + '/selfhost/' + phoneConfig.replyTopic);
  assert(ntfyRequests.some((entry) => entry.method === 'GET' && entry.url === '/selfhost/' + phoneConfig.replyTopic + '/json'));
  selfHostedBridge.close();
  await new Promise((resolve) => localNtfy.close(resolve));
  fs.rmSync(selfHostedDirectory, { recursive: true, force: true });
  if (oldNtfyUrl === undefined) delete process.env.JICHO_NTFY_URL;
  else process.env.JICHO_NTFY_URL = oldNtfyUrl;
  console.log('PASS 12B: JICHO_NTFY_URL routes publish, reply subscription, and actions to self-hosted ntfy');

  const initial = { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'keep-me' }] }] } };
  const firstInstall = mergeHooks(initial);
  const secondInstall = mergeHooks(firstInstall.settings);
  assert.strictEqual(firstInstall.added, EVENTS.length);
  assert.strictEqual(secondInstall.added, 0);
  assert.deepStrictEqual(secondInstall.settings, firstInstall.settings);
  for (const event of EVENTS) {
    const hooks = (secondInstall.settings.hooks[event] || []).flatMap((group) => group.hooks || []);
    assert.strictEqual(hooks.filter(isJichoHook).length, 1, 'one Jicho hook for ' + event);
    assert.strictEqual(hooks.find(isJichoHook).async, event === 'PermissionRequest' ? undefined : true, 'only PermissionRequest is synchronous');
  }
  const uninstalled = removeHooks(secondInstall.settings);
  assert.strictEqual(uninstalled.removed, EVENTS.length);
  assert.strictEqual(uninstalled.settings.hooks.PreToolUse[0].hooks[0].command, 'keep-me');
  assert.strictEqual(EVENTS.includes('SessionStart'), false);
  const configHome = path.join(os.tmpdir(), 'jicho-config-home');
  assert.strictEqual(settingsPath('/home/tester', { CLAUDE_CONFIG_DIR: '~/.claude-custom' }), path.join('/home/tester', '.claude-custom', 'settings.json'));
  assert.strictEqual(settingsPath('/home/tester', { CLAUDE_CONFIG_DIR: configHome }), path.join(configHome, 'settings.json'));
  const projectRoot = path.join(os.tmpdir(), 'jicho-project-scope');
  assert.strictEqual(projectSettingsPath(projectRoot, 'project-local'), path.join(projectRoot, '.claude', 'settings.local.json'));
  assert.strictEqual(projectSettingsPath(projectRoot, 'project-shared'), path.join(projectRoot, '.claude', 'settings.json'));
  assert.deepStrictEqual(selectSettingsTarget(['--project-local'], { cwd: projectRoot }), {
    scope: 'project-local', file: path.join(projectRoot, '.claude', 'settings.local.json')
  });
  assert.throws(() => selectSettingsTarget(['--user', '--project-local']), /only one/);
  assert.throws(() => selectSettingsTarget(['--something']), /Unknown option/);
  assert.throws(() => selectSettingsTarget(['extra']), /Unexpected argument/);
  const atomicDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jicho-atomic-config-'));
  const atomicFile = path.join(atomicDirectory, 'settings.json');
  fs.writeFileSync(atomicFile, 'before', { mode: 0o640 });
  if (process.platform !== 'win32') fs.chmodSync(atomicFile, 0o640);
  const originalRename = fs.renameSync;
  fs.renameSync = () => { const failure = new Error('simulated atomic rename failure'); failure.code = 'EIO'; throw failure; };
  try { assert.throws(() => atomicWrite(atomicFile, 'after'), /simulated atomic rename failure/); }
  finally { fs.renameSync = originalRename; }
  assert.strictEqual(fs.readFileSync(atomicFile, 'utf8'), 'before');
  assert.deepStrictEqual(fs.readdirSync(atomicDirectory), ['settings.json']);
  atomicWrite(atomicFile, 'after');
  assert.strictEqual(fs.readFileSync(atomicFile, 'utf8'), 'after');
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(atomicFile).mode & 0o777, 0o640);
  if (process.platform !== 'win32') {
    const linkedFile = path.join(atomicDirectory, 'settings-link.json');
    fs.symlinkSync(atomicFile, linkedFile);
    atomicWrite(linkedFile, 'through-link');
    assert(fs.lstatSync(linkedFile).isSymbolicLink());
    assert.strictEqual(fs.readFileSync(atomicFile, 'utf8'), 'through-link');
  }
  fs.rmSync(atomicDirectory, { recursive: true, force: true });
  const scopedProject = fs.mkdtempSync(path.join(os.tmpdir(), 'jicho-installer-scope-'));
  const scopedHome = path.join(scopedProject, '.test-home');
  fs.mkdirSync(scopedHome, { recursive: true });
  const isolatedEnv = { ...process.env, HOME: scopedHome, USERPROFILE: scopedHome, JICHO_CREDENTIAL_DIR: path.join(scopedHome, 'credential-state') };
  fs.mkdirSync(path.join(scopedProject, '.claude'));
  fs.writeFileSync(path.join(scopedProject, '.claude', 'settings.local.json'), JSON.stringify({
    model: 'keep-model', hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'keep-existing-hook' }] }] }
  }, null, 2));
  const installer = path.join(__dirname, '..', 'bin', 'jicho.js');
  const scopedInstall = spawnSync(process.execPath, [installer, 'install', '--project-local'], { cwd: scopedProject, env: isolatedEnv, input: 'y\n', encoding: 'utf8' });
  assert.strictEqual(scopedInstall.status, 0, scopedInstall.stderr);
  const scopedSettingsPath = path.join(scopedProject, '.claude', 'settings.local.json');
  let scopedSettings = JSON.parse(fs.readFileSync(scopedSettingsPath, 'utf8'));
  assert.strictEqual(scopedSettings.model, 'keep-model');
  assert(scopedSettings.hooks.PreToolUse.flatMap((group) => group.hooks || []).some((hook) => hook.command === 'keep-existing-hook'));
  assert(scopedSettings.hooks.PermissionRequest.flatMap((group) => group.hooks || []).some(isJichoHook));
  assert(fs.readdirSync(path.dirname(scopedSettingsPath)).some((name) => name.includes('.jicho-backup-')));
  const installedCredential = new CredentialManager({ directory: isolatedEnv.JICHO_CREDENTIAL_DIR, platform: 'test', forceFileStore: true }).getCredential();
  const scopedSettingsText = fs.readFileSync(scopedSettingsPath, 'utf8');
  assert(!scopedSettingsText.includes(installedCredential.key.toString('base64url')));
  assert(!scopedSettingsText.includes('Authorization'));
  const backupCount = fs.readdirSync(path.dirname(scopedSettingsPath)).filter((name) => name.includes('.jicho-backup-')).length;
  const repeatInstall = spawnSync(process.execPath, [installer, 'install', '--project-local'], { cwd: scopedProject, env: isolatedEnv, input: '', encoding: 'utf8' });
  assert.strictEqual(repeatInstall.status, 0, repeatInstall.stderr);
  assert.strictEqual(fs.readdirSync(path.dirname(scopedSettingsPath)).filter((name) => name.includes('.jicho-backup-')).length, backupCount);
  assert(fs.existsSync(path.join(scopedHome, '.jicho', 'hooks', 'hook.js')));
  if (process.platform !== 'win32') {
    const shellHook = spawnSync('sh', ['-c', makeHook().command], {
      cwd: scopedProject,
      env: { ...isolatedEnv, JICHO_CREDENTIAL_DIR: path.join(scopedHome, 'no-credential') },
      input: JSON.stringify({ hook_event_name: 'SessionEnd', session_id: 'shell-hook-check' }),
      encoding: 'utf8'
    });
    assert.strictEqual(shellHook.status, 0, shellHook.stderr);
    assert.strictEqual(shellHook.stdout, '');
  }
  const scopedUninstall = spawnSync(process.execPath, [installer, 'uninstall', '--project-local'], { cwd: scopedProject, env: isolatedEnv, input: 'y\n', encoding: 'utf8' });
  assert.strictEqual(scopedUninstall.status, 0, scopedUninstall.stderr);
  scopedSettings = JSON.parse(fs.readFileSync(scopedSettingsPath, 'utf8'));
  assert.strictEqual(scopedSettings.model, 'keep-model');
  assert(scopedSettings.hooks.PreToolUse.flatMap((group) => group.hooks || []).some((hook) => hook.command === 'keep-existing-hook'));
  assert(!Object.values(scopedSettings.hooks).flatMap((groups) => groups || []).flatMap((group) => group.hooks || []).some(isJichoHook));

  const sharedProject = fs.mkdtempSync(path.join(os.tmpdir(), 'jicho-installer-shared-'));
  const sharedHome = path.join(sharedProject, '.test-home');
  fs.mkdirSync(sharedHome, { recursive: true });
  const sharedEnv = { ...process.env, HOME: sharedHome, USERPROFILE: sharedHome, JICHO_CREDENTIAL_DIR: path.join(sharedHome, 'credential-state') };
  const sharedInstall = spawnSync(process.execPath, [installer, 'install', '--project-shared'], { cwd: sharedProject, env: sharedEnv, input: 'y\n', encoding: 'utf8' });
  assert.strictEqual(sharedInstall.status, 0, sharedInstall.stderr);
  const sharedSettingsPath = path.join(sharedProject, '.claude', 'settings.json');
  const sharedSettingsText = fs.readFileSync(sharedSettingsPath, 'utf8');
  const sharedCredential = new CredentialManager({ directory: sharedEnv.JICHO_CREDENTIAL_DIR, platform: 'test', forceFileStore: true }).getCredential();
  assert(!sharedSettingsText.includes(sharedCredential.key.toString('base64url')));
  assert(!sharedSettingsText.includes('Authorization'));
  assert(!sharedSettingsText.includes('JICHO_TOKEN'));
  assert(sharedSettingsText.includes('$HOME/.jicho/hooks/hook.js'));
  const sharedUninstall = spawnSync(process.execPath, [installer, 'uninstall', '--project-shared'], { cwd: sharedProject, env: sharedEnv, input: 'y\n', encoding: 'utf8' });
  assert.strictEqual(sharedUninstall.status, 0, sharedUninstall.stderr);
  fs.rmSync(sharedProject, { recursive: true, force: true });
  fs.rmSync(scopedProject, { recursive: true, force: true });
  console.log('PASS 13: installer is idempotent, preserves unrelated hooks, keeps shared credentials private, and supports all Claude settings scopes');

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
  console.log('PASS 14: 20 concurrent authenticated requests each receive their own answer');

  const authCore = new Core();
  const authServer = createServer(authCore, { credential: activeCredential });
  await new Promise((resolve) => authServer.listen(0, '127.0.0.1', resolve));
  const authPort = authServer.address().port;
  const authPayload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'auth-session', cwd: '/p/auth' });
  assert.strictEqual((await postRaw(authPort, authPayload, {}, { unsigned: true })).statusCode, 401);
  assert.strictEqual((await postRaw(authPort, authPayload, { authorization: 'Bearer legacy-token' }, { unsigned: true })).statusCode, 401);
  const authorized = await postRaw(authPort, authPayload);
  assert.strictEqual(authorized.statusCode, 200);
  assert.strictEqual(authCore.sessions.has('auth-session'), true);
  const unsignedCore = new Core();
  const unsignedServer = createServer(unsignedCore, { credentialProvider: () => null });
  await new Promise((resolve) => unsignedServer.listen(0, '127.0.0.1', resolve));
  const unsignedPort = unsignedServer.address().port;
  assert.strictEqual((await postRaw(unsignedPort, authPayload)).statusCode, 401);
  assert.strictEqual(unsignedCore.sessions.size, 0);
  await new Promise((resolve) => unsignedServer.close(resolve));

  const badSignatureHeaders = signedHeaders(authPayload);
  badSignatureHeaders['X-Jicho-Signature'] = '0'.repeat(64);
  assert.strictEqual((await postRaw(authPort, authPayload, badSignatureHeaders)).statusCode, 401);
  const originalForTamper = Buffer.from(authPayload);
  const tamperHeaders = signedHeaders(originalForTamper);
  assert.strictEqual((await postRaw(authPort, authPayload.replace('auth-session', 'evil-session'), tamperHeaders)).statusCode, 401);
  const expiredHeaders = signedHeaders(authPayload, { timestamp: Date.now() - MAX_CLOCK_SKEW_MS - 1 });
  assert.strictEqual((await postRaw(authPort, authPayload, expiredHeaders)).statusCode, 401);

  const otherInstall = { ...activeCredential, installationId: crypto.randomUUID() };
  const wrongInstallHeaders = signedHeaders(authPayload, { credential: otherInstall });
  assert.strictEqual((await postRaw(authPort, authPayload, wrongInstallHeaders)).statusCode, 401);
  const wrongSessionHeaders = signedHeaders(authPayload, { sessionHash: sessionBinding('another-session') });
  assert.strictEqual((await postRaw(authPort, authPayload, wrongSessionHeaders)).statusCode, 401);

  const replayPayload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'replay-session', cwd: '/p/replay' });
  const replayHeaders = signedHeaders(replayPayload, { nonce: crypto.randomBytes(24).toString('base64url') });
  assert.strictEqual((await postRaw(authPort, replayPayload, replayHeaders)).statusCode, 200);
  assert.strictEqual((await postRaw(authPort, replayPayload, replayHeaders)).statusCode, 401);
  assert.strictEqual(authCore.sessions.has('replay-session'), true);
  assert.strictEqual(authCore.sessions.size, 2);
  await new Promise((resolve) => authServer.close(resolve));

  const wrapperCore = new Core();
  const wrapperServer = createServer(wrapperCore, { credential: activeCredential });
  await new Promise((resolve) => wrapperServer.listen(0, '127.0.0.1', resolve));
  const wrapperBody = Buffer.from(JSON.stringify(req('wrapper-session', 'npm test')));
  const wrapperResponsePromise = forwardHook(wrapperBody, { credentialManager, port: wrapperServer.address().port });
  await waitForPendingCount(wrapperCore, 1);
  wrapperCore.settle(wrapperCore.list()[0].id, 'allow', 'wrapper-test');
  const wrapperResponse = await wrapperResponsePromise;
  assert.strictEqual(behavior(JSON.parse(wrapperResponse.toString('utf8'))), 'allow');
  assert.deepStrictEqual(await forwardHook(wrapperBody, {
    credentialManager: { getCredential: () => null }, port: wrapperServer.address().port
  }), Buffer.alloc(0));
  await new Promise((resolve) => wrapperServer.close(resolve));

  const protectedCore = new Core({ policyEnabled: true });
  protectedCore.touch('protected-session', { state: 'working', cwd: '/p/protected' });
  const protectedServer = createServer(protectedCore, { credential: activeCredential });
  await new Promise((resolve) => protectedServer.listen(0, '127.0.0.1', resolve));
  const protectedBody = JSON.stringify(req('protected-session', 'git status'));
  assert.strictEqual((await postRaw(protectedServer.address().port, protectedBody, {}, { unsigned: true })).statusCode, 401);
  assert.strictEqual(protectedCore.list().length, 0);
  await new Promise((resolve) => protectedServer.close(resolve));

  const persistentReplayDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jicho-replay-restart-'));
  let replayStore = new Store(path.join(persistentReplayDirectory, 'auth.sqlite3'));
  let replayCore = new Core({ store: replayStore });
  let replayServer = createServer(replayCore, { credential: activeCredential });
  await new Promise((resolve) => replayServer.listen(0, '127.0.0.1', resolve));
  const persistentReplayBody = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'persistent-replay', cwd: '/p/replay' });
  const persistentReplayHeaders = signedHeaders(persistentReplayBody, { nonce: crypto.randomBytes(24).toString('base64url') });
  assert.strictEqual((await postRaw(replayServer.address().port, persistentReplayBody, persistentReplayHeaders)).statusCode, 200);
  await new Promise((resolve) => replayServer.close(resolve));
  replayStore.close();
  replayStore = new Store(path.join(persistentReplayDirectory, 'auth.sqlite3'));
  replayCore = new Core({ store: replayStore });
  replayServer = createServer(replayCore, { credential: activeCredential });
  await new Promise((resolve) => replayServer.listen(0, '127.0.0.1', resolve));
  assert.strictEqual((await postRaw(replayServer.address().port, persistentReplayBody, persistentReplayHeaders)).statusCode, 401);
  assert.strictEqual(replayCore.sessions.size, 1);
  await new Promise((resolve) => replayServer.close(resolve));
  replayStore.close();
  fs.rmSync(persistentReplayDirectory, { recursive: true, force: true });
  console.log('PASS 15: authenticated command wrapper relays the original decision response and fails closed without credentials');
  console.log('PASS 16: invalid MACs, body changes, expiry, replay, installation/session mismatch, and auth failure never approve');

  const lifecycleDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jicho-credential-lifecycle-'));
  const lifecycle = new CredentialManager({ directory: lifecycleDirectory, platform: 'test', forceFileStore: true });
  const initialCredential = lifecycle.getCredential() || lifecycle.ensureCredential() && lifecycle.getCredential();
  const restartedLifecycle = new CredentialManager({ directory: lifecycleDirectory, platform: 'test', forceFileStore: true });
  const afterRestartCredential = restartedLifecycle.getCredential();
  assert.strictEqual(afterRestartCredential.installationId, initialCredential.installationId);
  assert(afterRestartCredential.key.equals(initialCredential.key));
  const rotationCore = new Core();
  const rotationServer = createServer(rotationCore, { credentialProvider: () => restartedLifecycle.getCredential() });
  await new Promise((resolve) => rotationServer.listen(0, '127.0.0.1', resolve));
  const rotationPort = rotationServer.address().port;
  const beforeRotate = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'before-rotate', cwd: '/p/rotate' });
  assert.strictEqual((await postRaw(rotationPort, beforeRotate, signedHeaders(beforeRotate, { credential: initialCredential }))).statusCode, 200);
  restartedLifecycle.rotate();
  const rotatedCredential = restartedLifecycle.getCredential();
  assert.strictEqual(rotatedCredential.installationId, initialCredential.installationId);
  assert(!rotatedCredential.key.equals(initialCredential.key));
  const afterRotate = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'after-rotate', cwd: '/p/rotate' });
  assert.strictEqual((await postRaw(rotationPort, afterRotate, signedHeaders(afterRotate, { credential: initialCredential }))).statusCode, 401);
  assert.strictEqual((await postRaw(rotationPort, afterRotate, signedHeaders(afterRotate, { credential: rotatedCredential }))).statusCode, 200);
  const afterRevoke = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'after-revoke', cwd: '/p/rotate' });
  restartedLifecycle.revoke();
  assert.strictEqual((await postRaw(rotationPort, afterRevoke, signedHeaders(afterRevoke, { credential: rotatedCredential }))).statusCode, 401);
  assert.strictEqual(new CredentialManager({ directory: lifecycleDirectory, platform: 'test', forceFileStore: true }).getCredential(), null);
  assert.strictEqual(restartedLifecycle.status().status, 'revoked');
  await new Promise((resolve) => rotationServer.close(resolve));
  assert.strictEqual(fs.statSync(path.join(lifecycleDirectory, 'hook-auth-state.json')).mode & 0o077, 0);
  fs.rmSync(lifecycleDirectory, { recursive: true, force: true });
  const windowsCredentialDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jicho-windows-credential-'));
  const deniedWindowsStore = new CredentialManager({ directory: path.join(windowsCredentialDirectory, 'denied'), platform: 'win32', forceFileStore: true });
  assert.throws(() => deniedWindowsStore.ensureCredential(), /doctor --allow-file-credential/);
  const securedPaths = [];
  const optedInWindowsStore = new CredentialManager({
    directory: path.join(windowsCredentialDirectory, 'opted-in'), platform: 'win32', forceFileStore: true,
    allowFileCredential: true, securePrivatePath: (target) => securedPaths.push(target)
  });
  assert.strictEqual(optedInWindowsStore.ensureCredential().storage, 'private-file');
  assert(optedInWindowsStore.getCredential());
  assert(securedPaths.includes(optedInWindowsStore.stateFile));
  assert(securedPaths.some((target) => target.endsWith('.json') && target !== optedInWindowsStore.stateFile));
  fs.rmSync(windowsCredentialDirectory, { recursive: true, force: true });
  console.log('PASS 17: credential lifecycle stays secure by default and Windows file fallback requires explicit ACL opt-in');

  const databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jicho-store-test-'));
  const databasePath = path.join(databaseDirectory, 'jicho.sqlite3');
  let store = new Store(databasePath);
  const durableCore = new Core({ store });
  durableCore.touch('durable-session', { state: 'working', cwd: '/p/durable' });
  const durableResponse = durableCore.request(req('durable-session', 'git status'));
  await waitForPendingCount(durableCore, 1);
  const durableRequest = durableCore.list()[0];
  assert.strictEqual(store.db.prepare('SELECT state FROM approval_requests WHERE id = ?').get(durableRequest.id).state, 'PENDING');
  assert.deepStrictEqual(JSON.parse(store.db.prepare('SELECT decision_options_json FROM approval_requests WHERE id = ?').get(durableRequest.id).decision_options_json), ['allow', 'deny']);
  assert.strictEqual(durableCore.settle(durableRequest.id, 'allow', 'desktop'), true);
  assert.strictEqual(behavior(await durableResponse), 'allow');
  assert.strictEqual(durableCore.settle(durableRequest.id, 'deny', 'duplicate'), false);
  assert.strictEqual(store.db.prepare('SELECT COUNT(*) AS count FROM approval_decisions WHERE request_id = ?').get(durableRequest.id).count, 1);
  const durableBulk = Array.from({ length: 10 }, (_, index) => {
    const sid = 'durable-bulk-' + index;
    durableCore.touch(sid, { state: 'working', cwd: '/p/' + sid });
    return { sid, response: durableCore.request(req(sid, 'printf ' + index)) };
  });
  await waitForPendingCount(durableCore, durableBulk.length);
  for (const item of [...durableCore.list()].reverse()) {
    const index = Number(item.sid.slice('durable-bulk-'.length));
    durableCore.settle(item.id, index % 2 === 0 ? 'allow' : 'deny', 'durable-concurrency-test');
  }
  for (const item of durableBulk) assert.strictEqual(behavior(await item.response), Number(item.sid.slice('durable-bulk-'.length)) % 2 === 0 ? 'allow' : 'deny');
  durableCore.observeEvent({ hook_event_name: 'PreToolUse', session_id: 'durable-session', cwd: '/p/durable', tool_name: 'Bash', tool_use_id: 'tu-1', tool_input: { command: 'npm test' } });
  assert.strictEqual(store.listEvents('claude-code', 'durable-session')[0].type, 'PreToolUse');
  assert(store.listRecentActivity(100).some((event) => event.type === 'approval-resolved' && event.source === 'desktop'));
  durableCore.observeEvent({ hook_event_name: 'SessionEnd', session_id: 'durable-session', cwd: '/p/durable' });
  assert.strictEqual(store.db.prepare("SELECT state FROM sessions WHERE session_id = 'durable-session'").get().state, 'ended');
  assert.deepStrictEqual(compactAction({ file_path: '/p/file', content: 'secret body', old_string: 'old', new_string: 'new' }), {
    file_path: '/p/file', contentLength: 11, old_stringLength: 3, new_stringLength: 3
  });
  const failureDetails = safeEventDetails({ error: 'Exit code 7\ncredential=secret' });
  assert.deepStrictEqual(failureDetails, { errorPresent: true, exitCode: 7 });
  store.close();
  assert.strictEqual(fs.statSync(databasePath).mode & 0o077, 0);
  console.log('PASS 18: SQLite migration, session/event history, bounded sensitive data, atomic decisions, durable concurrency, and local file permissions');

  store = new Store(databasePath);
  const expiringCore = new Core({ store });
  const expiringResponse = expiringCore.request(req('durable-session', 'npm test'));
  await waitForPendingCount(expiringCore, 1);
  const expiringId = expiringCore.list()[0].id;
  await wait(650);
  assert.deepStrictEqual(await expiringResponse, {});
  assert.strictEqual(expiringCore.settle(expiringId, 'allow', 'late-desktop'), false);
  assert.strictEqual(store.db.prepare('SELECT state FROM approval_requests WHERE id = ?').get(expiringId).state, 'EXPIRED');
  console.log('PASS 19: expired requests cannot be approved after their timeout');

  const interruptedResponse = expiringCore.request(req('durable-session', 'npm run deploy'));
  await waitForPendingCount(expiringCore, 1);
  const interruptedId = expiringCore.list()[0].id;
  clearTimeout(expiringCore.pending.get(interruptedId).timer); // emulate process death without resolving the original hook
  store.close();
  store = new Store(databasePath);
  const recoveredCore = new Core({ store });
  assert.strictEqual(recoveredCore.pending.size, 0);
  assert.strictEqual(store.db.prepare('SELECT state FROM approval_requests WHERE id = ?').get(interruptedId).state, 'FAILED');
  assert.strictEqual(store.db.prepare("SELECT COUNT(*) AS count FROM audit_records WHERE request_id = ? AND record_type = 'approval-interrupted'").get(interruptedId).count, 1);
  recoveredCore.setPolicyEnabled(true);
  const afterRestart = recoveredCore.request(req('durable-session', 'git status'));
  await waitForPendingCount(recoveredCore, 1);
  const afterRestartId = recoveredCore.list()[0].id;
  assert.strictEqual(recoveredCore.settle(afterRestartId, 'deny', 'test'), true);
  assert.strictEqual(behavior(await afterRestart), 'deny');
  store.close();
  fs.rmSync(databaseDirectory, { recursive: true, force: true });
  assert(interruptedResponse instanceof Promise);
  console.log('PASS 20: restart marks in-flight requests failed and requires fresh session observation');

  const closedStore = new Store(':memory:');
  const failClosedCore = new Core({ store: closedStore });
  const persistenceErrors = [];
  failClosedCore.on('store-error', (error) => persistenceErrors.push(error));
  closedStore.close();
  assert.deepStrictEqual(await failClosedCore.request(req('unavailable-store', 'git status')), {});
  assert.strictEqual(failClosedCore.pending.size, 0);
  assert.strictEqual(persistenceErrors.length, 1);
  console.log('PASS 21: persistence failure is visible and cannot deliver an approval');

  const dashboardPath = path.resolve(__dirname, '../src/command-centre.html');
  const mainFrame = { url: pathToFileURL(dashboardPath).href };
  const trustedEvent = { sender: { mainFrame }, senderFrame: mainFrame };
  assert.strictEqual(isTrustedMainFrame(trustedEvent, [dashboardPath]), true);
  assert.strictEqual(isTrustedMainFrame({ sender: { mainFrame }, senderFrame: { url: mainFrame.url } }, [dashboardPath]), false);
  assert.strictEqual(isTrustedMainFrame({ sender: { mainFrame }, senderFrame: { url: 'https://example.com' } }, [dashboardPath]), false);
  console.log('PASS 22: dashboard IPC accepts only its own trusted main frame');

  const webOriginAttack = await postRaw(port, JSON.stringify({
    hook_event_name: 'UserPromptSubmit', session_id: 'spoofed-by-web-origin', cwd: '/tmp'
  }), { origin: 'https://attacker.example', 'content-type': 'application/json' });
  assert.strictEqual(webOriginAttack.statusCode, 403);
  const reboundHostAttack = await postRaw(port, JSON.stringify({
    hook_event_name: 'UserPromptSubmit', session_id: 'spoofed-by-rebound-host', cwd: '/tmp'
  }), { host: 'attacker.example', 'content-type': 'application/json' });
  assert.strictEqual(reboundHostAttack.statusCode, 403);
  const fetchMetadataAttack = await postRaw(port, JSON.stringify({
    hook_event_name: 'UserPromptSubmit', session_id: 'spoofed-by-fetch-metadata', cwd: '/tmp'
  }), { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' });
  assert.strictEqual(fetchMetadataAttack.statusCode, 403);
  assert.strictEqual(core.sessions.has('spoofed-by-web-origin'), false);
  assert.strictEqual(core.sessions.has('spoofed-by-rebound-host'), false);
  assert.strictEqual(core.sessions.has('spoofed-by-fetch-metadata'), false);
  console.log('PASS 23: browser-origin, cross-site, and rebound-host hook requests are rejected before event handling');

  assert.strictEqual((await checkPort(port)).ok, true);
  const doctorSettings = path.join(credentialDirectory, 'doctor-settings.json');
  fs.writeFileSync(doctorSettings, JSON.stringify(mergeHooks({}).settings));
  assert.strictEqual(settingsHooks(doctorSettings), EVENTS.length);
  const doctorResult = await wrapperRoundTrip(credentialManager);
  assert.strictEqual(doctorResult.accepted, true);
  assert.strictEqual(doctorResult.held, true);
  assert.strictEqual(doctorResult.settled, true);
  assert.deepStrictEqual(Object.keys(doctorResult.eventTimings), EVENTS);
  assert(Object.values(doctorResult.eventTimings).every((milliseconds) => Number.isFinite(milliseconds) && milliseconds > 0));
  for (const [event, milliseconds] of Object.entries(doctorResult.eventTimings)) {
    console.log('LATENCY ' + event + ' cold wrapper: ' + milliseconds.toFixed(1) + ' ms');
  }
  console.log('PASS 24: doctor checks port, installed hooks, signed wrapper acceptance, and held request settlement');
  assert.strictEqual(selectMascotMood({ pendingCount: 1, working: true }), 'needs-you');
  assert.strictEqual(selectMascotMood({ error: 'Port occupied', working: true }), 'offline');
  assert.strictEqual(selectMascotMood({ working: true }), 'working');
  assert.strictEqual(selectMascotMood({ doneUntil: 14_000, now: 10_000 }), 'done');
  assert.strictEqual(selectMascotMood({ doneUntil: 14_000, now: 14_000 }), 'idle');
  console.log('PASS 25: mascot mood selection covers pending, error, working, timed done, and idle');

  await new Promise((resolve) => srv.close(resolve));
  fs.rmSync(credentialDirectory, { recursive: true, force: true });
  console.log('ALL PASS');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
