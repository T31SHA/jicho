'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Core } = require('../src/core');
const { Store } = require('../src/store');
const { createServer } = require('../src/server');
const { CredentialManager } = require('../bin/hook-support/credentials');

const WAIT_MS = 90_000;

function runClaude(project, environment, allowFile, denyFile) {
  const prompt = [
    'Use the Bash tool to run exactly these two commands, one at a time and in this order:',
    '1. touch ' + allowFile,
    '2. touch ' + denyFile,
    'Do not run any other commands, do not combine the commands, and do not retry a denied command. Then report whether each command ran.'
  ].join('\n');
  const args = [
    '--print', prompt,
    '--permission-mode', 'manual',
    '--setting-sources', 'local',
    '--tools', 'Bash',
    '--no-session-persistence'
  ];
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd: project, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdoutBytes = 0;
    let stderrBytes = 0;
    child.stdout.on('data', (chunk) => { stdoutBytes += chunk.length; });
    child.stderr.on('data', (chunk) => { stderrBytes += chunk.length; });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Claude Code did not finish the authenticated hook smoke within 90 seconds.'));
    }, WAIT_MS);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdoutBytes, stderrBytes });
    });
  });
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jicho-claude-auth-'));
  const project = path.join(root, 'project');
  const credentialsPath = path.join(root, 'credentials');
  const statePath = path.join(project, '.claude', 'settings.local.json');
  const allowFile = path.join(root, 'allowed-marker');
  const denyFile = path.join(root, 'denied-marker');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const manager = new CredentialManager({ directory: credentialsPath, platform: 'test', forceFileStore: true });
  manager.ensureCredential();

  const hookCommand = {
    type: 'command', command: 'node',
    args: [path.resolve(__dirname, '../bin/hook-support/hook.js')],
    timeout: 120
  };
  fs.writeFileSync(statePath, JSON.stringify({ hooks: {
    PermissionRequest: [{ hooks: [hookCommand] }],
    SessionEnd: [{ hooks: [hookCommand] }]
  } }, null, 2) + '\n', { mode: 0o600 });

  const store = new Store(path.join(root, 'events.sqlite3'));
  const core = new Core({ store });
  const decisions = [];
  let sessionEndCount = 0;
  core.on('pending', (items) => {
    for (const item of items) {
      const command = item.input && item.input.command;
      const decision = command === 'touch ' + allowFile ? 'allow' : 'deny';
      if (command === 'touch ' + allowFile || command === 'touch ' + denyFile) decisions.push({ command, decision });
      core.settle(item.id, decision, 'claude-auth-smoke');
    }
  });
  core.on('activity', (event) => {
    if (event.type === 'SessionEnd') sessionEndCount += 1;
  });
  const server = createServer(core, { credentialProvider: () => manager.getCredential() });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const environment = {
      ...process.env,
      JICHO_PORT: String(server.address().port),
      JICHO_CREDENTIAL_DIR: credentialsPath,
      JICHO_HOLD_MS: '15000'
    };
    const result = await runClaude(project, environment, allowFile, denyFile);
    assert.strictEqual(result.signal, null, 'Claude Code was terminated before completing the hook test.');
    assert.strictEqual(result.code, 0, 'Claude Code exited unsuccessfully.');
    assert(decisions.some((item) => item.command === 'touch ' + allowFile && item.decision === 'allow'), 'no authenticated allow PermissionRequest was observed');
    assert(decisions.some((item) => item.command === 'touch ' + denyFile && item.decision === 'deny'), 'no authenticated deny PermissionRequest was observed');
    assert(fs.existsSync(allowFile), 'Claude did not execute the allowed marker command.');
    assert(!fs.existsSync(denyFile), 'Claude executed the denied marker command.');
    assert(sessionEndCount > 0, 'Claude Code did not emit the configured SessionEnd command hook.');
    console.log('PASS: Claude Code 2.1.325 command hooks authenticated through the local wrapper; allow, deny, and SessionEnd were observed.');
  } finally {
    core.list().forEach((item) => core.settle(item.id, null, 'app-shutdown'));
    await new Promise((resolve) => server.listening ? server.close(resolve) : resolve());
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('FAIL: ' + error.message);
  process.exitCode = 1;
});
