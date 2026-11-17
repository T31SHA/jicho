'use strict';

const fs = require('fs');
const path = require('path');

const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const GIT_READ_COMMANDS = new Set([
  'git status',
  'git status --short',
  'git status --branch',
  'git status --short --branch',
  'git diff',
  'git diff --stat',
  'git diff --name-only',
  'git diff --cached',
  'git diff --cached --stat',
  'git log',
  'git log --oneline'
]);

function hasChaining(command) {
  const value = String(command || '');
  return [';', '&&', '||', '|', '$(', '`', '>', '<', '&'].some((part) => value.includes(part));
}

function getRiskFlags(body) {
  const input = body && body.tool_input || {};
  const command = typeof input.command === 'string' ? input.command : '';
  const all = JSON.stringify({ tool: body && body.tool_name, input }).toLowerCase()
    .replace(/[\\/]/g, '/')
    .replace(/[\s"'=,:{}\[\]]/g, '/');
  const flags = [];
  const add = (code, label) => { if (!flags.some((flag) => flag.code === code)) flags.push({ code, label }); };
  if (/\brm\s+-rf[a-z]*\b|\brm\s+-fr[a-z]*\b/i.test(command)) add('rm-rf', 'Destructive: rm -rf');
  if (/\bcurl\b[^|\n]*\|\s*(?:sh|bash|zsh)\b/i.test(command)) add('curl-shell', 'Downloads piped to a shell');
  if (/\bsudo\b/i.test(command)) add('sudo', 'Uses sudo');
  if (/\bgit\s+push\b[\s\S]*--force(?:-with-lease)?\b/i.test(command)) add('force-push', 'Force-pushes Git history');
  if (/\.env(?:[a-z0-9._-]*)?/i.test(all)) add('env-file', 'References a .env file or value');
  if (/(?:^|\/)(?:id_rsa|\.npmrc|\.pypirc|\.netrc|\.aws|\.ssh)(?=\/|$)/i.test(all) ||
      /(?:^|\/)[^/]+\.(?:pem|key)(?=\/|$)/i.test(all) ||
      /(?:^|\/)\.git\/config(?=\/|$)/i.test(all)) add('secret-file', 'References a secret file');
  if (hasChaining(command)) add('shell-chain', 'Shell chaining or redirection blocks auto-allow');
  return flags;
}

function pathInside(root, candidate) {
  if (!root || typeof candidate !== 'string' || !candidate || candidate.includes('\0')) return false;
  const rootPath = path.resolve(root);
  const candidatePath = path.resolve(rootPath, candidate);
  const relative = path.relative(rootPath, candidatePath);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return false;
  try {
    const realRoot = fs.realpathSync(rootPath);
    const realCandidate = fs.realpathSync(candidatePath);
    const realRelative = path.relative(realRoot, realCandidate);
    return realRelative !== '..' && !realRelative.startsWith('..' + path.sep) && !path.isAbsolute(realRelative);
  } catch (_) { return false; }
}

function patternIsLocal(pattern) {
  if (typeof pattern !== 'string' || !pattern) return false;
  return !pattern.split(/[\\/]+/).includes('..');
}

function safeReadTool(body) {
  const name = body && body.tool_name;
  const input = body && body.tool_input || {};
  const cwd = body && body.cwd;
  if (!READ_ONLY_TOOLS.has(name) || !cwd || !input || typeof input !== 'object' || Array.isArray(input)) return false;
  const root = path.resolve(cwd);
  if (name === 'Read') {
    if (Object.keys(input).some((key) => !['file_path', 'offset', 'limit', 'pages'].includes(key))) return false;
    return pathInside(root, input.file_path);
  }
  if (name === 'Glob') {
    if (Object.keys(input).some((key) => !['pattern', 'path'].includes(key))) return false;
    const base = input.path || '.';
    return patternIsLocal(input.pattern) && pathInside(root, base);
  }
  if (Object.keys(input).some((key) => !['pattern', 'path', 'paths', 'glob', 'type', 'output_mode', 'head_limit', 'context', 'context_lines', '-n', '-i', '-A', '-B', '-C'].includes(key))) return false;
  if (!patternIsLocal(input.pattern)) return false;
  if (input.glob && !patternIsLocal(input.glob)) return false;
  const candidates = Array.isArray(input.paths) && input.paths.length ? input.paths : input.path || '.';
  return (Array.isArray(candidates) ? candidates : [candidates]).every((candidate) => pathInside(root, candidate));
}

function evaluate(body, enabled) {
  const riskFlags = getRiskFlags(body || {});
  if (!enabled || riskFlags.length) return { autoAllow: false, reason: null, riskFlags };
  if (READ_ONLY_TOOLS.has(body.tool_name) && safeReadTool(body)) {
    return { autoAllow: true, reason: 'exact read-only tool: ' + body.tool_name, riskFlags };
  }
  if (body.tool_name === 'Bash') {
    const command = body.tool_input && typeof body.tool_input.command === 'string' ? body.tool_input.command.trim() : '';
    if (GIT_READ_COMMANDS.has(command)) return { autoAllow: true, reason: 'exact read-only Git command', riskFlags };
  }
  return { autoAllow: false, reason: null, riskFlags };
}

module.exports = { READ_ONLY_TOOLS, GIT_READ_COMMANDS, hasChaining, getRiskFlags, pathInside, safeReadTool, evaluate };
