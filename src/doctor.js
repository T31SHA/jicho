'use strict';

const fs = require('fs');
const net = require('net');
const { spawnSync } = require('child_process');
const { Core } = require('./core');
const { createServer } = require('./server');
const { CredentialManager } = require('../bin/hook-support/credentials');
const { forwardHook } = require('../bin/hook-support/hook');
const { EVENTS, settingsPath, isJichoHook } = require('../bin/jicho');

function checkPort(port) {
  return new Promise((resolve) => {
    const client = net.createConnection({ host: '127.0.0.1', port });
    let finished = false;
    const finish = (value) => { if (finished) return; finished = true; client.destroy(); resolve(value); };
    client.setTimeout(500);
    client.once('connect', () => finish({ ok: true, detail: 'Jicho is running' }));
    client.once('timeout', () => finish({ ok: false, detail: 'port probe timed out' }));
    client.once('error', (error) => {
      if (error.code !== 'ECONNREFUSED') return finish({ ok: false, detail: error.message });
      const probe = net.createServer();
      probe.once('error', (bindError) => finish({ ok: false, detail: bindError.code === 'EADDRINUSE' ? 'port is occupied by another process' : bindError.message }));
      probe.listen(port, '127.0.0.1', () => probe.close((closeError) => finish(closeError
        ? { ok: false, detail: closeError.message }
        : { ok: true, detail: 'port is free' })));
    });
  });
}

function claudeVersion() {
  const isWindows = process.platform === 'win32';
  const result = isWindows
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'claude --version'], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
    : spawnSync('claude', ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  if (result.error || result.status !== 0) throw new Error('Claude Code version could not be found on PATH.');
  const version = (result.stdout || result.stderr || '').trim().split(/\r?\n/)[0];
  if (!version) throw new Error('Claude Code returned no version string.');
  return version.slice(0, 160);
}

function settingsHooks(file = settingsPath()) {
  if (!fs.existsSync(file)) throw new Error('Claude settings file is missing: ' + file);
  let settings;
  try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error('Claude settings could not be parsed: ' + error.message); }
  const present = new Set();
  for (const [event, groups] of Object.entries(settings.hooks || {})) {
    if (Array.isArray(groups) && groups.some((group) => group && Array.isArray(group.hooks) && group.hooks.some(isJichoHook))) present.add(event);
  }
  const missing = EVENTS.filter((event) => !present.has(event));
  if (missing.length) throw new Error('Jicho settings hooks missing for: ' + missing.join(', '));
  return EVENTS.length;
}

async function wrapperRoundTrip(manager) {
  const core = new Core();
  const server = createServer(core, { credentialProvider: () => manager.getCredential() });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const sid = 'jicho-doctor-' + process.pid + '-' + Date.now();
    const body = Buffer.from(JSON.stringify({
      hook_event_name: 'PermissionRequest', session_id: sid, cwd: process.cwd(),
      tool_name: 'Bash', tool_input: { command: 'printf doctor-check' }
    }));
    const pending = forwardHook(body, { credentialManager: manager, port: server.address().port });
    const deadline = Date.now() + 3000;
    let item;
    while (Date.now() < deadline) {
      item = core.list().find((entry) => entry.sid === sid);
      if (item) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (!item) throw new Error('Signed wrapper request was not accepted as a pending PermissionRequest.');
    const held = core.list().some((entry) => entry.id === item.id);
    if (!held) throw new Error('Fake PermissionRequest was not held.');
    if (!core.settle(item.id, 'allow', 'doctor')) throw new Error('Fake PermissionRequest could not be settled.');
    const response = await pending;
    let parsed;
    try { parsed = JSON.parse(response.toString('utf8')); }
    catch (_) { throw new Error('Signed wrapper did not receive a valid decision response.'); }
    if (!parsed.hookSpecificOutput || parsed.hookSpecificOutput.decision.behavior !== 'allow') {
      throw new Error('Signed wrapper response did not contain the accepted decision.');
    }
    return { accepted: true, held, settled: core.list().every((entry) => entry.id !== item.id) };
  } finally {
    for (const item of core.list()) core.settle(item.id, null, 'doctor-cleanup');
    await new Promise((resolve) => server.close(resolve));
  }
}

async function runDoctor(options = {}) {
  const port = Number(process.env.JICHO_PORT || 47821);
  const results = [];
  const record = (name, operation) => Promise.resolve().then(operation).then(
    (detail) => results.push({ name, ok: true, detail: detail === undefined ? '' : String(detail) }),
    (error) => results.push({ name, ok: false, detail: error && error.message || String(error) })
  );
  await record('Port', async () => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('JICHO_PORT is invalid.');
    const result = await checkPort(port);
    if (!result.ok) throw new Error(result.detail);
    return result.detail;
  });
  await record('Claude Code', () => claudeVersion());

  let manager;
  let credential;
  await record('Credential store', () => {
    manager = new CredentialManager({ ...(options.credentialOptions || {}), allowFileCredential: options.allowFileCredential === true });
    const provisioned = manager.ensureCredential();
    credential = manager.getCredential();
    if (!credential) throw new Error('Credential store write/read round-trip failed.');
    if (provisioned.storage === 'private-file') {
      return 'private-file (write/read verified; owner-only permissions; weaker guarantee: other processes running as your account can read it)';
    }
    return provisioned.storage + ' (write/read verified)';
  });

  const credentialResult = results.find((result) => result.name === 'Credential store');
  if (!credentialResult.ok && process.platform === 'win32' && !options.allowFileCredential) {
    credentialResult.detail += ' Run `jicho doctor --allow-file-credential` to opt into the weaker owner-only ACL file fallback.';
  }

  let roundTrip;
  if (credential) {
    await record('Wrapper round-trip', async () => {
      roundTrip = await wrapperRoundTrip(manager);
      if (!roundTrip.accepted) throw new Error('Signed hook request was rejected.');
      return 'signed hook was accepted';
    });
    await record('PermissionRequest', () => {
      if (!roundTrip || !roundTrip.held || !roundTrip.settled) throw new Error('Fake PermissionRequest did not hold and settle.');
      return 'fake request held and settled';
    });
  } else {
    results.push({ name: 'Wrapper round-trip', ok: false, detail: 'credential unavailable' });
    results.push({ name: 'PermissionRequest', ok: false, detail: 'credential unavailable' });
  }
  await record('Settings hooks', () => settingsHooks());

  for (const result of results) {
    console.log((result.ok ? 'PASS' : 'FAIL') + '  ' + result.name + (result.detail ? ': ' + result.detail : ''));
  }
  const failed = results.some((result) => !result.ok);
  if (failed) process.exitCode = 1;
  return { ok: !failed, results };
}

module.exports = { checkPort, claudeVersion, settingsHooks, wrapperRoundTrip, runDoctor };
