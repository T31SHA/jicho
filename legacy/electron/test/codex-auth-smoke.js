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

function runCodex(project, codexHome, environment, allowFile, denyFile) {
  const prompt = [
    'Use the shell tool to run exactly these two commands, one at a time and in this order:',
    '1. touch ' + allowFile,
    '2. touch ' + denyFile,
    'Do not run any other commands, do not combine these commands, and do not retry a denied command. Then say whether each command ran.'
  ].join('\n');
  const args = [
    '--config', 'approval_policy="on-request"', 'exec', '--json', '--ephemeral', '--skip-git-repo-check', '--dangerously-bypass-hook-trust',
    '--sandbox', 'workspace-write', '--cd', project, prompt
  ];
  return new Promise((resolve, reject) => {
    const child = spawn('codex', args, { cwd: project, env: { ...environment, CODEX_HOME: codexHome }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTail = '';
    let stderrTail = '';
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      stdoutTail = (stdoutTail + chunk.toString('utf8')).slice(-8192);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-8192);
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Codex did not finish the authenticated hook smoke within 90 seconds.'));
    }, WAIT_MS);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdoutBytes, stderrBytes, stdoutTail, stderrTail });
    });
  });
}

function safeDiagnostic(value) {
  return String(value || '')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/(?:access|refresh|id)_token["']?\s*[:=]\s*["']?[^"',\s]+/gi, 'token=[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[redacted-key]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .trim().slice(-2000);
}

function outputEventSummary(value) {
  const names = new Set();
  for (const line of String(value || '').split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (event && typeof event.type === 'string') names.add(event.type);
      else if (event && typeof event.method === 'string') names.add(event.method);
    } catch (_) {}
  }
  return [...names].slice(0, 30).join(', ') || 'none';
}

async function main() {
  const originalCodexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const authFile = path.join(originalCodexHome, 'auth.json');
  if (!fs.existsSync(authFile)) throw new Error('No Codex auth.json is available to run the optional real-agent smoke.');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jicho-codex-auth-'));
  const project = path.join(root, 'project');
  const credentialsPath = path.join(root, 'credentials');
  const cacheRoot = path.join(os.homedir(), '.cache');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(cacheRoot, { recursive: true });
  const codexHome = fs.mkdtempSync(path.join(cacheRoot, 'jicho-codex-home-'));
  const markers = fs.mkdtempSync(path.join(cacheRoot, 'jicho-codex-markers-'));
  const allowFile = path.join(markers, 'allowed-marker');
  const denyFile = path.join(markers, 'denied-marker');
  fs.symlinkSync(authFile, path.join(codexHome, 'auth.json'));

  const hook = path.resolve(__dirname, '../bin/hook-support/codex-hook.js');
  const hookCommand = process.execPath + ' "' + hook + '"';
  const hooks = {};
  const events = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Stop', 'SubagentStart', 'SubagentStop', 'Interrupt'];
  for (const event of events) {
    const handler = { type: 'command', command: hookCommand, timeout: event === 'PermissionRequest' ? 120 : 10 };
    if (event !== 'PermissionRequest' && event !== 'SessionEnd') handler.async = true;
    hooks[event] = [{ ...(event === 'PermissionRequest' ? { matcher: '^(Bash|apply_patch)$' } : {}), hooks: [handler] }];
  }
  fs.writeFileSync(path.join(codexHome, 'hooks.json'), JSON.stringify({ hooks }, null, 2) + '\n', { mode: 0o600 });
  const manager = new CredentialManager({ directory: credentialsPath, platform: 'test', forceFileStore: true });
  manager.ensureCredential();
  const store = new Store(path.join(root, 'events.sqlite3'));
  const core = new Core({ store });
  const decisions = [];
  const observedEvents = [];
  const ingressErrors = [];
  const pendingTools = new Set();
  let sessionStartCount = 0;
  let sessionEndCount = 0;
  core.on('pending', (items) => {
    for (const item of items) {
      pendingTools.add(item.tool || 'unknown-tool');
      const command = item.input && item.input.command;
      if (command !== 'touch ' + allowFile && command !== 'touch ' + denyFile) continue;
      const decision = command === 'touch ' + allowFile ? 'allow' : 'deny';
      decisions.push({ command, decision });
      core.settle(item.id, decision, 'codex-auth-smoke');
    }
  });
  core.on('activity', (event) => {
    if (event.agentId !== 'codex') return;
    observedEvents.push(event.type);
    if (event.type === 'SessionStart') sessionStartCount += 1;
    if (event.type === 'SessionEnd') sessionEndCount += 1;
  });
  core.on('canonical-activity', (event) => { if (event.agentId === 'codex') observedEvents.push(event.type); });
  core.on('ingress-error', (detail) => ingressErrors.push(detail.kind));
  const server = createServer(core, { credentialProvider: () => manager.getCredential() });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const environment = {
      ...process.env,
      CODEX_HOME: codexHome,
      JICHO_PORT: String(server.address().port),
      JICHO_CREDENTIAL_DIR: credentialsPath,
      JICHO_HOLD_MS: '30000'
    };
    const result = await runCodex(project, codexHome, environment, allowFile, denyFile);
    assert.strictEqual(result.signal, null, 'Codex was terminated before completing the hook test.');
    if (result.code !== 0) {
      throw new Error('Codex exited with status ' + result.code + '. Events: ' + outputEventSummary(result.stdoutTail) +
        '. Error output: ' + safeDiagnostic(result.stderrTail));
    }
    if (!decisions.some((item) => item.command === 'touch ' + allowFile && item.decision === 'allow') ||
        !decisions.some((item) => item.command === 'touch ' + denyFile && item.decision === 'deny')) {
      throw new Error('No complete Codex Allow/Deny round trip. Hook events: ' + ([...new Set(observedEvents)].join(', ') || 'none') +
        '; pending tools: ' + ([...pendingTools].join(', ') || 'none') +
        '; ingress errors: ' + ([...new Set(ingressErrors)].join(', ') || 'none') +
        '; markers created: allow=' + fs.existsSync(allowFile) + ', deny=' + fs.existsSync(denyFile) +
        '; Codex JSON events: ' + outputEventSummary(result.stdoutTail));
    }
    assert(fs.existsSync(allowFile), 'Codex did not execute the allowed marker command.');
    assert(!fs.existsSync(denyFile), 'Codex executed the denied marker command.');
    assert(sessionStartCount > 0, 'Codex did not emit SessionStart.');
    assert(sessionEndCount > 0, 'Codex did not emit SessionEnd.');
    console.log('PASS: Codex hooks authenticated through the local wrapper; SessionStart, Allow, Deny, and SessionEnd were observed.');
  } finally {
    core.list().forEach((item) => core.settle(item.id, null, 'app-shutdown'));
    await new Promise((resolve) => server.listening ? server.close(resolve) : resolve());
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(codexHome, { recursive: true, force: true });
    fs.rmSync(markers, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('FAIL: ' + error.message);
  process.exitCode = 1;
});
