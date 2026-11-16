'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');
const { Core } = require('./core');
const { createServer } = require('./server');
const { isJichoHook, settingsPath } = require('../bin/jicho');

const PORT = Number(process.env.JICHO_PORT || 47821);
const core = new Core();
const server = createServer(core);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const seen = new Set();
const queue = [];
const results = { allow: null, deny: null };
let busy = false;
let done = false;

function claudeVersion() {
  const inheritedPath = (process.env.PATH || '').split(path.delimiter);
  // npm prepends every ancestor's node_modules/.bin while running a script.
  // Those local shims can shadow the Claude executable the user gets in a shell.
  const cliPath = inheritedPath.filter((entry) => !/(^|[\\/])node_modules[\\/]\.bin$/i.test(entry) && !/(^|[\\/])node-gyp-bin$/i.test(entry));
  const result = spawnSync('claude', ['--version'], {
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, PATH: cliPath.join(path.delimiter) }
  });
  if (result.error) return 'unavailable (' + result.error.message + ')';
  if (result.status !== 0) return 'command exited ' + result.status + (result.stderr ? ': ' + result.stderr.trim() : '');
  return (result.stdout || result.stderr || 'unknown').trim();
}

function makeVerifyFile(label) {
  let name;
  do {
    name = '.jicho-verify-' + label + '-' + crypto.randomBytes(4).toString('hex') + '.txt';
  } while (fs.existsSync(path.join(process.cwd(), name)));
  return name;
}

function permissionHookInstalled() {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    const groups = settings.hooks && settings.hooks.PermissionRequest;
    return Array.isArray(groups) && groups.some((group) => group && Array.isArray(group.hooks) && group.hooks.some(isJichoHook));
  } catch (_) { return false; }
}

const verifyFiles = { allow: makeVerifyFile('allow'), deny: makeVerifyFile('deny') };

function ask(prompt) {
  return new Promise((resolve) => rl.question(prompt, (answer) => resolve(answer.trim().toLowerCase())));
}

async function askDecision() {
  while (true) {
    const answer = await ask('Choose the decision to send [a=allow / d=deny]: ');
    if (answer === 'a' || answer === 'allow') return 'allow';
    if (answer === 'd' || answer === 'deny') return 'deny';
    console.log('Enter a or d.');
  }
}

async function askObserved(decision) {
  const expected = decision === 'allow' ? 'continue and create the file' : 'stop without creating the file';
  while (true) {
    const answer = await ask('Did Claude ' + expected + '? [y/n]: ');
    if (['y', 'yes', 'n', 'no'].includes(answer)) return answer === 'y' || answer === 'yes';
    console.log('Enter y or n.');
  }
}

function finish() {
  if (done) return;
  done = true;
  const passed = results.allow === true && results.deny === true;
  console.log('\nVerification summary:');
  console.log('  Allow honored: ' + (results.allow === true ? 'yes' : results.allow === false ? 'no' : 'not run'));
  console.log('  Deny honored:  ' + (results.deny === true ? 'yes' : results.deny === false ? 'no' : 'not run'));
  for (const file of Object.values(verifyFiles)) {
    const fullPath = path.join(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
      try { fs.unlinkSync(fullPath); console.log('Removed verification file ' + file); }
      catch (error) { console.log('Could not remove ' + file + ': ' + error.message); }
    }
  }
  core.list().forEach((item) => core.settle(item.id, null, 'verify-exit'));
  rl.close();
  server.close(() => { process.exitCode = passed ? 0 : 1; });
}

async function promptNext() {
  if (busy || done || queue.length === 0) return;
  busy = true;
  const item = queue.shift();
  const decision = await askDecision();
  const sent = core.settle(item.id, decision, 'verify');
  if (!sent) {
    console.log('That request already closed; no decision was sent.');
    busy = false;
    promptNext();
    return;
  }
  console.log('Sent ' + decision.toUpperCase() + ' for this request. Check the real Claude terminal.');
  results[decision] = await askObserved(decision);
  console.log((results[decision] ? 'PASS' : 'FAIL') + ': Claude ' + (results[decision] ? 'honored' : 'did not honor') + ' the ' + decision + ' response, as confirmed in its terminal.');
  busy = false;
  if (results.allow !== null && results.deny !== null) finish();
  else promptNext();
}

core.on('pending', (items) => {
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    queue.push(item);
    const raw = item.input && Object.prototype.hasOwnProperty.call(item.input, 'command')
      ? item.input.command
      : JSON.stringify(item.input, null, 2);
    console.log('\nPermissionRequest received:');
    console.log('  Session folder: ' + (item.cwd || 'unknown'));
    console.log('  Tool: ' + (item.tool || 'unknown'));
    console.log('  Raw input:\n' + String(raw === undefined ? '' : raw));
    console.log('For the allow check, use ' + verifyFiles.allow + '. For the deny check, use ' + verifyFiles.deny + '.');
  }
  promptNext();
});

function start() {
  server.once('error', (error) => {
    console.error('Could not start verification server on 127.0.0.1:' + PORT + ': ' + error.message);
    process.exitCode = 1;
    rl.close();
  });
  server.listen(PORT, '127.0.0.1', () => {
    const version = claudeVersion();
    console.log('Jicho real-hook verification');
    console.log('Claude Code version: ' + version);
    console.log('Jicho PermissionRequest hook: ' + (permissionHookInstalled() ? 'installed' : 'not installed'));
    console.log('Local Jicho core listening on http://127.0.0.1:' + PORT);
    console.log('\nIn another terminal at this project root:');
    if (!permissionHookInstalled()) console.log('  1. Run `npm run jicho -- install`, review the diff, accept it, then start a fresh Claude session.');
    else console.log('  1. Start a fresh real interactive Claude Code session with `claude`.');
    console.log('  2. Ask Claude to use Bash to run `touch ' + verifyFiles.allow + '` for the allow check.');
    console.log('  3. When Jicho asks, choose allow. Confirm here whether the file was created.');
    console.log('  4. Ask Claude to run `touch ' + verifyFiles.deny + '` for the deny check. Choose deny and confirm it stopped.');
    console.log('The verifier removes any test files it created. It does not call an AI model.');
    console.log('\nWaiting for the real PermissionRequest hook...');
  });
}

process.on('SIGINT', () => {
  console.log('\nVerification interrupted.');
  finish();
});

start();
