#!/usr/bin/env node
'use strict';

const { forwardHook, parseHookInput, MAX_BODY_BYTES } = require('./hook');

const CODEX_OBSERVATION_EVENTS = new Set([
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PostToolUseFailure', 'Stop', 'SubagentStart', 'SubagentStop', 'Interrupt'
]);
const CODEX_EVENTS = new Set([...CODEX_OBSERVATION_EVENTS, 'PermissionRequest']);

function safeToolInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = {};
  for (const key of ['command', 'file_path', 'path', 'description']) {
    if (typeof value[key] === 'string') result[key] = value[key].slice(0, key === 'command' ? 4000 : 2048);
  }
  return Object.keys(result).length ? result : undefined;
}

function sanitizeCodexHook(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      !CODEX_EVENTS.has(input.hook_event_name) || typeof input.session_id !== 'string' || input.session_id.length > 256 ||
      typeof input.cwd !== 'string' || input.cwd.length > 4096) return null;
  const event = {
    jicho_agent_id: 'codex',
    hook_event_name: input.hook_event_name,
    session_id: input.session_id,
    cwd: input.cwd
  };
  for (const key of ['permission_mode', 'turn_id', 'tool_name', 'tool_use_id', 'source', 'reason', 'agent_id', 'agent_type']) {
    if (typeof input[key] === 'string') event[key] = input[key].slice(0, key === 'tool_use_id' || key === 'turn_id' ? 256 : 128);
  }
  if (['PermissionRequest', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure'].includes(input.hook_event_name)) {
    const toolInput = safeToolInput(input.tool_input);
    if (toolInput && input.hook_event_name !== 'PermissionRequest') {
      delete toolInput.description;
      if (input.tool_name === 'apply_patch') delete toolInput.command;
    }
    if (toolInput) event.tool_input = toolInput;
  }
  if (input.hook_event_name === 'PermissionRequest' &&
      (typeof event.tool_name !== 'string' || !event.tool_name || !event.tool_input)) return null;
  return event;
}

async function main() {
  let response = Buffer.alloc(0);
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) return;
      chunks.push(chunk);
    }
    const input = parseHookInput(Buffer.concat(chunks));
    const event = sanitizeCodexHook(input);
    if (event) response = await forwardHook(Buffer.from(JSON.stringify(event)));
  } catch (_) {
    // No output preserves Codex's built-in permission prompt and hook failure behavior.
  }
  if (response.length) process.stdout.write(response.toString('utf8'));
}

if (require.main === module) main();

module.exports = { CODEX_EVENTS, CODEX_OBSERVATION_EVENTS, sanitizeCodexHook };
