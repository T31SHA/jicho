#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const URL = 'http://127.0.0.1:47821';
const MARKER_HEADER = 'X-Jicho-Installer';
const MARKER_VALUE = 'jicho';
const EVENTS = ['PermissionRequest', 'PostToolUse', 'Stop', 'UserPromptSubmit', 'SessionStart', 'SessionEnd'];

function settingsPath(home = os.homedir()) {
  return path.join(home, '.claude', 'settings.json');
}

function makeHook() {
  return {
    type: 'http',
    url: URL,
    timeout: 120,
    headers: {
      [MARKER_HEADER]: MARKER_VALUE,
      Authorization: 'Bearer $JICHO_TOKEN'
    },
    allowedEnvVars: ['JICHO_TOKEN']
  };
}

function isJichoHook(hook) {
  return Boolean(hook && hook.type === 'http' && hook.headers && hook.headers[MARKER_HEADER] === MARKER_VALUE);
}

function mergeHooks(settings) {
  const next = JSON.parse(JSON.stringify(settings || {}));
  if (!next.hooks) next.hooks = {};
  if (typeof next.hooks !== 'object' || Array.isArray(next.hooks)) throw new Error('The hooks setting must be a JSON object.');
  let added = 0;
  for (const event of EVENTS) {
    if (next.hooks[event] === undefined) next.hooks[event] = [];
    if (!Array.isArray(next.hooks[event])) throw new Error('The hooks.' + event + ' setting must be an array.');
    const existing = next.hooks[event].flatMap((group) => group && Array.isArray(group.hooks) ? group.hooks : []).filter(isJichoHook);
    if (!existing.length) {
      next.hooks[event].push({ hooks: [makeHook()] });
      added += 1;
    } else {
      for (const hook of existing) {
        if (!hook.headers.Authorization) { hook.headers.Authorization = 'Bearer $JICHO_TOKEN'; added += 1; }
        if (!Array.isArray(hook.allowedEnvVars) || !hook.allowedEnvVars.includes('JICHO_TOKEN')) {
          hook.allowedEnvVars = [...new Set([...(Array.isArray(hook.allowedEnvVars) ? hook.allowedEnvVars : []), 'JICHO_TOKEN'])];
          added += 1;
        }
      }
    }
  }
  return { settings: next, added };
}

function removeHooks(settings) {
  const next = JSON.parse(JSON.stringify(settings || {}));
  let removed = 0;
  if (!next.hooks || typeof next.hooks !== 'object' || Array.isArray(next.hooks)) return { settings: next, removed };
  for (const [event, groups] of Object.entries(next.hooks)) {
    if (!Array.isArray(groups)) continue;
    const keptGroups = [];
    for (const group of groups) {
      if (!group || !Array.isArray(group.hooks)) { keptGroups.push(group); continue; }
      const keptHooks = group.hooks.filter((hook) => {
        if (isJichoHook(hook)) { removed += 1; return false; }
        return true;
      });
      if (keptHooks.length) keptGroups.push({ ...group, hooks: keptHooks });
      else if (!group.hooks.some(isJichoHook)) keptGroups.push(group);
    }
    if (keptGroups.length) next.hooks[event] = keptGroups;
    else delete next.hooks[event];
  }
  if (Object.keys(next.hooks).length === 0) delete next.hooks;
  return { settings: next, removed };
}

function makeDiff(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix += 1;
  const changedBefore = a.slice(prefix, a.length - suffix);
  const changedAfter = b.slice(prefix, b.length - suffix);
  const contextBefore = a.slice(Math.max(0, prefix - 2), prefix).map((line) => ' ' + line);
  const contextAfter = a.slice(a.length - suffix, Math.min(a.length, a.length - suffix + 2)).map((line) => ' ' + line);
  return [
    '--- settings.json',
    '+++ settings.json (Jicho change)',
    '@@ -' + (prefix + 1) + ',' + changedBefore.length + ' +' + (prefix + 1) + ',' + changedAfter.length + ' @@',
    ...contextBefore,
    ...changedBefore.map((line) => '-' + line),
    ...changedAfter.map((line) => '+' + line),
    ...contextAfter
  ].join('\n');
}

function readSettings(file) {
  if (!fs.existsSync(file)) return { settings: {}, original: '' };
  const original = fs.readFileSync(file, 'utf8');
  try { return { settings: JSON.parse(original), original }; }
  catch (error) { throw new Error('Could not parse ' + file + ': ' + error.message); }
}

function askToProceed() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;
    const finish = (answer) => {
      if (answered) return;
      answered = true;
      rl.close();
      resolve(/^y(?:es)?$/i.test((answer || '').trim()));
    };
    rl.question('Apply this change? [y/N] ', finish);
    rl.on('close', () => { if (!answered) { answered = true; resolve(false); } });
  });
}

function backup(file) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = file + '.jicho-backup-' + stamp;
  fs.copyFileSync(file, backupPath, fs.constants.COPYFILE_EXCL);
  return backupPath;
}

async function changeSettings(action, file = settingsPath()) {
  const { settings, original } = readSettings(file);
  const result = action === 'install' ? mergeHooks(settings) : removeHooks(settings);
  if (action === 'install' && result.added === 0) {
    console.log('Jicho hooks are already installed. No changes made.');
    return false;
  }
  if (action === 'uninstall' && result.removed === 0) {
    console.log('No Jicho hooks found. No changes made.');
    return false;
  }
  const before = original ? JSON.stringify(JSON.parse(original), null, 2) : '{}';
  const after = JSON.stringify(result.settings, null, 2);
  console.log(makeDiff(before, after));
  if (!(await askToProceed())) { console.log('Cancelled. No changes made.'); return false; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const backupPath = backup(file);
  fs.writeFileSync(file, after + '\n', { mode: 0o600 });
  console.log('Updated ' + file + (backupPath ? '\nBackup: ' + backupPath : ''));
  return true;
}

function status(file = settingsPath()) {
  if (!fs.existsSync(file)) { console.log('Claude settings not found: ' + file); return; }
  let settings;
  try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { console.error('Could not parse ' + file + ': ' + error.message); process.exitCode = 1; return; }
  const found = [];
  for (const [event, groups] of Object.entries(settings.hooks || {})) {
    if (Array.isArray(groups) && groups.some((group) => group && Array.isArray(group.hooks) && group.hooks.some(isJichoHook))) found.push(event);
  }
  if (found.length) console.log('Jicho hooks installed for: ' + found.join(', '));
  else console.log('Jicho hooks are not installed.');
}

async function main(args) {
  const command = args[0];
  if (command === 'install' || command === 'uninstall') await changeSettings(command);
  else if (command === 'status') status();
  else {
    console.log('Usage: jicho <install|uninstall|status>');
    if (command) process.exitCode = 2;
  }
}

if (require.main === module) main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

module.exports = { EVENTS, URL, settingsPath, makeHook, isJichoHook, mergeHooks, removeHooks, makeDiff };
