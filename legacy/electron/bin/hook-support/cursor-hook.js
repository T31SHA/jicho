#!/usr/bin/env node
'use strict';

const { forwardHook, parseHookInput, MAX_BODY_BYTES } = require('./hook');

const OBSERVATION_EVENTS = new Set([
  'sessionStart', 'sessionEnd', 'postToolUse', 'postToolUseFailure',
  'afterShellExecution', 'afterMCPExecution', 'afterFileEdit', 'subagentStop', 'stop'
]);

function sanitizeCursorHook(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      !OBSERVATION_EVENTS.has(input.hook_event_name) ||
      typeof input.conversation_id !== 'string' || input.conversation_id.length > 256 ||
      typeof input.cursor_version !== 'string' || input.cursor_version.length > 64 ||
      !Array.isArray(input.workspace_roots) || input.workspace_roots.length < 1 || input.workspace_roots.length > 64 ||
      input.workspace_roots.some((root) => typeof root !== 'string' || !root || root.length > 4096)) return null;

  const event = {
    hook_event_name: input.hook_event_name,
    conversation_id: input.conversation_id,
    cursor_version: input.cursor_version,
    workspace_roots: input.workspace_roots.slice(0, 16)
  };
  if (typeof input.cwd === 'string' && input.cwd.length <= 4096) event.cwd = input.cwd;
  if (typeof input.duration === 'number' && Number.isFinite(input.duration)) event.duration = input.duration;
  if (typeof input.is_interrupt === 'boolean') event.is_interrupt = input.is_interrupt;
  if (typeof input.failure_type === 'string') event.failure_type = input.failure_type.slice(0, 128);
  if (typeof input.status === 'string') event.status = input.status.slice(0, 64);
  if (typeof input.tool_name === 'string') event.tool_name = input.tool_name.slice(0, 128);
  else if (input.hook_event_name === 'afterShellExecution') event.tool_name = 'Shell';
  if (typeof input.tool_use_id === 'string') event.tool_use_id = input.tool_use_id.slice(0, 256);
  if (typeof input.file_path === 'string') event.file_path = input.file_path.slice(0, 2048);
  if (typeof input.subagent_type === 'string') event.subagent_type = input.subagent_type.slice(0, 128);
  if (Array.isArray(input.modified_files)) {
    event.modified_files = input.modified_files.slice(0, 64)
      .filter((file) => typeof file === 'string').map((file) => file.slice(0, 2048));
  }
  return event;
}

async function main() {
  let response = Buffer.from('{}');
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) return process.stdout.write('{}\n');
      chunks.push(chunk);
    }
    const input = parseHookInput(Buffer.concat(chunks));
    const safeEvent = sanitizeCursorHook(input);
    if (safeEvent) {
      const forwarded = await forwardHook(Buffer.from(JSON.stringify(safeEvent)));
      if (forwarded.length) response = forwarded;
    }
  } catch (_) {
    // Cursor's native action remains authoritative; this hook never returns a permission decision.
  }
  process.stdout.write(response.toString('utf8') + '\n');
}

if (require.main === module) main();

module.exports = { OBSERVATION_EVENTS, sanitizeCursorHook };
