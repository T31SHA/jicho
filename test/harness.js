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
const { PhoneBridge, notificationFor, ntfyBaseUrl, ntfyPairingUrl } = require('../src/phone');
const { EVENTS, CURSOR_EVENTS, CODEX_EVENTS, settingsPath, projectSettingsPath, cursorSettingsPath, codexSettingsPath, selectSettingsTarget, atomicWrite, makeHook, isJichoHook, mergeHooks, removeHooks, mergeCursorHooks, removeCursorHooks, isJichoCursorHook, mergeCodexHooks, removeCodexHooks, isJichoCodexHook, makeCodexHook } = require('../bin/jicho');
const { CredentialManager } = require('../bin/hook-support/credentials');
const { signRequest, sessionBinding, MAX_CLOCK_SKEW_MS } = require('../bin/hook-support/protocol');
const { forwardHook } = require('../bin/hook-support/hook');
const { isTrustedMainFrame } = require('../src/ipc-security');
const { checkPort, settingsHooks, wrapperRoundTrip } = require('../src/doctor');
const { selectMascotMood } = require('../src/mascot-state');
const { runDemo } = require('../src/demo');
const { EVENT_PROTOCOL_VERSION, normalizeClaudeEvent, normalizeCursorEvent, normalizeCodexEvent, validateCanonicalEvent, validateAdapter, AdapterRegistry } = require('../src/agents/protocol');
const { CursorAdapter } = require('../src/agents/cursor');
const { CodexAdapter } = require('../src/agents/codex');
const { sanitizeCursorHook } = require('../bin/hook-support/cursor-hook');
const { sanitizeCodexHook } = require('../bin/hook-support/codex-hook');
const { generateRecommendations } = require('../src/recommendations');
const { buildIslandModel } = require('../src/island-model');
const { selectIslandLayout, selectIslandBounds } = require('../src/island-layout');
const { electronArgs } = require('../bin/start');
const { AUTHENTICATED_EVENTS, ALL_AUTHENTICATED_EVENTS, validateHookBody } = require('../src/server');

const credentialDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jicho-auth-harness-'));
const credentialManager = new CredentialManager({ directory: credentialDirectory, forceFileStore: true, platform: 'test' });
credentialManager.ensureCredential();
let activeCredential = credentialManager.getCredential();

function signedHeaders(body, options = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  let sessionId = '';
  try { const input = JSON.parse(bytes.toString('utf8')); sessionId = input.session_id || input.conversation_id || ''; } catch (_) {}
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

  const permissionEvent = normalizeClaudeEvent({
    hook_event_name: 'PermissionRequest', session_id: 'adapter-session', cwd: '/p/shop', tool_name: 'Bash', tool_input: { command: 'npm test' }
  }, { eventId: 'adapter-event-1', observedAt: 1000, evidenceBuilder: () => ({ toolName: 'Bash' }) });
  assert.strictEqual(permissionEvent.protocolVersion, EVENT_PROTOCOL_VERSION);
  assert.strictEqual(permissionEvent.type, 'PermissionRequested');
  assert.strictEqual(permissionEvent.provenance.sourceEventName, 'PermissionRequest');
  assert.strictEqual(permissionEvent.evidence.toolName, 'Bash');
  assert.strictEqual(validateCanonicalEvent(permissionEvent), true);
  assert.strictEqual(normalizeClaudeEvent({ hook_event_name: 'UnknownEvent', session_id: 'adapter-session' }), null);
  assert.strictEqual(normalizeClaudeEvent({ hook_event_name: 'PreToolUse', session_id: '' }), null);
  const protocolCore = new Core();
  assert.strictEqual(validateAdapter(protocolCore.claudeAdapter), true);
  const registry = new AdapterRegistry();
  registry.register(protocolCore.claudeAdapter);
  assert.strictEqual(registry.get('claude-code'), protocolCore.claudeAdapter);
  assert.throws(() => registry.register(protocolCore.claudeAdapter), /already registered/);
  const observedCanonical = [];
  protocolCore.on('canonical-activity', (event) => observedCanonical.push(event));
  assert.strictEqual(protocolCore.observeEvent({ hook_event_name: 'SessionStart', session_id: 'adapter-session', cwd: '/p/shop' }), true);
  assert.strictEqual(observedCanonical[0].type, 'SessionStart');
  assert.strictEqual((await protocolCore.claudeAdapter.discover({ authenticatedHookEvent: true })).hostApplicationDetected, false);
  const adapterApproval = protocolCore.request(req('adapter-session', 'echo approved'));
  await waitForPendingCount(protocolCore, 1);
  assert.strictEqual(protocolCore.handleDecision('claude-code', protocolCore.list()[0].id, 'allow', 'contract-test'), true);
  await adapterApproval;
  assert.deepStrictEqual(observedCanonical.slice(-2).map((event) => event.type), ['PermissionRequested', 'PermissionResolved']);
  assert.strictEqual(observedCanonical.at(-1).evidence.decision, 'allow');
  assert.strictEqual(AUTHENTICATED_EVENTS.has('SessionStart'), true);
  assert.strictEqual(EVENTS.includes('SessionStart'), true);
  console.log('PASS 27: versioned event envelopes preserve Claude provenance and adapter capabilities');

  const editEvent = { id: 'edit-1', agentId: 'claude-code', sessionId: 'model-session', source: 'claude-hook', type: 'PostToolUse', at: 100, details: { toolName: 'Edit', filePath: '/p/shop/src/App.tsx' } };
  const testEvent = { id: 'test-1', agentId: 'claude-code', sessionId: 'model-session', source: 'claude-hook', type: 'PostToolUse', at: 200, details: { toolName: 'Bash', command: 'npm test' } };
  const failedEvent = { id: 'failure-1', agentId: 'claude-code', sessionId: 'model-session', source: 'claude-hook', type: 'PostToolUseFailure', at: 300, details: { toolName: 'Bash', exitCode: 1 } };
  const model = buildIslandModel({
    sessions: [{ agentId: 'claude-code', id: 'model-session', cwd: '/p/shop', state: 'working', last: 300 }],
    events: [editEvent, testEvent, failedEvent],
    pending: [{ id: 'pending-1', sid: 'model-session', tool: 'Bash', cwd: '/p/shop', at: 250 }],
    now: 500
  });
  assert.strictEqual(model.project, 'shop');
  assert.strictEqual(model.currentActivity, 'Tool failed · Bash');
  assert.deepStrictEqual(model.modifiedFiles.map((file) => file.path), ['/p/shop/src/App.tsx']);
  assert.strictEqual(model.modifiedFiles[0].state, 'updated');
  assert.strictEqual(model.modifiedFiles[0].additions, null);
  assert.strictEqual(model.modifiedFiles[0].deletions, null);
  assert.strictEqual(model.limitations.diffAvailable, false);
  assert.strictEqual(model.limitations.lineCountsAvailable, false);
  const observedEditCounts = safeEventDetails({
    hook_event_name: 'PostToolUse', tool_name: 'Edit',
    tool_input: { file_path: '/p/shop/src/App.tsx', old_string: 'keep\nremove\n', new_string: 'keep\nadd\nnew\n' }
  });
  assert.strictEqual(observedEditCounts.additions, 2);
  assert.strictEqual(observedEditCounts.deletions, 1);
  assert.strictEqual(Object.hasOwn(observedEditCounts, 'old_string'), false);
  assert.strictEqual(Object.hasOwn(observedEditCounts, 'new_string'), false);
  const uncompletedEditCounts = safeEventDetails({
    hook_event_name: 'PreToolUse', tool_name: 'Edit',
    tool_input: { file_path: '/p/shop/src/App.tsx', old_string: 'remove', new_string: 'add' }
  });
  assert.strictEqual(Object.hasOwn(uncompletedEditCounts, 'additions'), false);
  const countedEditModel = buildIslandModel({
    sessions: [{ agentId: 'claude-code', id: 'counted-edit', cwd: '/p/shop', state: 'working', last: 400 }],
    events: [{ id: 'counted-edit-event', agentId: 'claude-code', sessionId: 'counted-edit', source: 'claude-hook', type: 'PostToolUse', at: 400,
      details: { ...observedEditCounts, canonicalType: 'PostToolUse', toolName: 'Edit' } }], now: 500
  });
  assert.strictEqual(countedEditModel.modifiedFiles[0].additions, 2);
  assert.strictEqual(countedEditModel.modifiedFiles[0].deletions, 1);
  assert.deepStrictEqual(model.capabilities, {
    detected: true,
    hostApplicationDetection: false,
    connected: true,
    sessionIdentified: true,
    activityMonitored: true,
    permissionHookStatus: 'verified hook; no request observed',
    permissionRequestObserved: false,
    questionHandling: false,
    remoteDecisions: false
  });
  assert(model.recommendations.some((item) => item.id === 'approval:pending-1' && item.confidence === 'HIGH'));
  assert(model.recommendations.some((item) => item.id === 'tool-failure:failure-1' && item.confidence === 'HIGH'));
  assert.strictEqual(model.recommendations.some((item) => item.id === 'tests-after-change:edit-1'), false);
  const noTest = generateRecommendations({
    sessions: [{ agentId: 'claude-code', id: 'model-session', state: 'working', last: 100 }],
    events: [editEvent], now: 200
  });
  const testReminder = noTest.find((item) => item.id === 'tests-after-change:edit-1');
  assert(testReminder);
  assert.strictEqual(testReminder.confidence, 'MEDIUM');
  assert(testReminder.evidence.some((evidence) => evidence.includes('No later test command')));
  assert.strictEqual(selectIslandLayout({ pendingCount: 1, showSettings: true }), 'card');
  assert.strictEqual(selectIslandLayout({ showSettings: true }), 'phone');
  assert.strictEqual(selectIslandLayout({ expanded: true }), 'expanded');
  assert.strictEqual(selectIslandLayout({ activeUntil: 100, now: 99 }), 'expanded');
  assert.strictEqual(selectIslandLayout({ activeUntil: 100, now: 100 }), 'idle');
  console.log('PASS 28: island activity and recommendations use observed evidence and expose unavailable diffs');

  const selectedIsland = buildIslandModel({
    sessions: [
      { agentId: 'claude-code', id: 'other-session', cwd: '/p/other', state: 'working', last: 200 },
      { agentId: 'cursor', id: 'shared-session-id', cwd: '/p/cursor-project', state: 'working', last: 100 }
    ],
    events: [{
      id: 'cursor-edit-live', agentId: 'cursor', sessionId: 'shared-session-id', source: 'cursor-hook',
      type: 'afterFileEdit', at: 100, details: { canonicalType: 'FileChanged', filePath: '/p/cursor-project/src/App.tsx' }
    }],
    selectedSession: { agentId: 'cursor', id: 'shared-session-id' }, now: 150
  });
  assert.strictEqual(selectedIsland.project, 'cursor-project');
  assert.strictEqual(selectedIsland.agent, 'Cursor');
  assert.strictEqual(selectedIsland.sessionIndicators.length, 2);
  assert.strictEqual(selectedIsland.sessionIndicators.find((item) => item.agentId === 'cursor').selected, true);
  assert.strictEqual(selectedIsland.sessionIndicators.find((item) => item.agentId === 'claude-code').selected, false);
  assert.strictEqual(selectedIsland.modifiedFiles[0].displayPath, 'src/App.tsx');
  assert.strictEqual(selectedIsland.modifiedFiles[0].state, 'updated');
  assert.strictEqual(selectedIsland.modifiedFiles[0].additions, null);
  console.log('PASS 28B: line changes come from successful Edit input and source text stays out of SQLite event details');

  const uiMarkup = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'index.html'), 'utf8');
  const uiStyles = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'style.css'), 'utf8');
  for (const id of ['compact-project', 'compact-agent', 'compact-progress', 'compact-session-indicators', 'expanded-session-indicators', 'activity-steps', 'modified-files']) {
    assert(uiMarkup.includes('id="' + id + '"'), 'island view is missing ' + id);
  }
  assert(uiMarkup.includes('../../mascot/jicho-mascot.js'), 'island must use the existing JICHO mascot artwork');
  assert(uiStyles.includes('.compact-island.is-active') && uiStyles.includes('.expanded-island.is-active'), 'compact and expanded visual states must be defined');
  assert(uiStyles.includes('transition: opacity') && uiStyles.includes('@keyframes progress-spin'), 'island views and observed working state must animate');
  console.log('PASS 28A: visual state supports exact concurrent-session switching and evidence-only file activity');

  const cursorRaw = {
    hook_event_name: 'afterFileEdit', conversation_id: 'shared-session-id', cursor_version: '2.0.0',
    workspace_roots: ['/p/cursor-project'], cwd: '/p/cursor-project', file_path: '/p/cursor-project/src/App.tsx',
    edits: [{ old_string: 'private source', new_string: 'replacement source' }],
    transcript_path: '/private/transcript.json', user_email: 'private@example.invalid'
  };
  const safeCursor = sanitizeCursorHook(cursorRaw);
  assert(safeCursor);
  assert.strictEqual(Object.hasOwn(safeCursor, 'edits'), false);
  assert.strictEqual(Object.hasOwn(safeCursor, 'transcript_path'), false);
  assert.strictEqual(Object.hasOwn(safeCursor, 'user_email'), false);
  assert.strictEqual(validateHookBody(safeCursor), null);
  assert.strictEqual(validateHookBody({ ...safeCursor, edits: cursorRaw.edits }), 'invalid-event');
  assert.strictEqual(validateHookBody({ ...safeCursor, hook_event_name: 'preToolUse' }), 'invalid-event');
  assert.strictEqual(normalizeCursorEvent({ ...safeCursor, hook_event_name: 'workspaceOpen' }), null);
  const cursorCanonical = normalizeCursorEvent(safeCursor, { eventId: 'cursor-event-1', observedAt: 1234 });
  assert.strictEqual(cursorCanonical.type, 'FileChanged');
  assert.strictEqual(cursorCanonical.agentId, 'cursor');
  assert.strictEqual(cursorCanonical.provenance.sourceEventName, 'afterFileEdit');
  assert.strictEqual(validateCanonicalEvent(cursorCanonical), true);
  const cursorAdapter = new CursorAdapter();
  assert.strictEqual(validateAdapter(cursorAdapter), true);
  assert.strictEqual(cursorAdapter.getCapabilities({ detected: true }).permissionInterception, false);
  assert.strictEqual(cursorAdapter.handleDecision('request-id', 'allow'), false);
  assert.strictEqual(ALL_AUTHENTICATED_EVENTS.has('afterFileEdit'), true);
  assert.strictEqual(ALL_AUTHENTICATED_EVENTS.has('workspaceOpen'), false);
  core.touch('shared-session-id', { cwd: '/p/claude-project' });
  const activityEvents = [];
  core.on('activity', (event) => activityEvents.push(event));
  assert.deepStrictEqual(await post(port, safeCursor), {});
  assert.strictEqual(core.sessions.has('shared-session-id'), true);
  assert.strictEqual(core.sessions.has('cursor:shared-session-id'), true);
  assert.strictEqual(activityEvents.at(-1).source, 'cursor-hook');
  assert.strictEqual(activityEvents.at(-1).details.filePath, '/p/cursor-project/src/App.tsx');
  assert.strictEqual(core.list().length, 0);
  const cursorIsland = buildIslandModel({
    sessions: [core.sessions.get('cursor:shared-session-id')], events: activityEvents, now: Date.now()
  });
  assert.strictEqual(cursorIsland.agent, 'Cursor');
  assert.strictEqual(cursorIsland.recentEvents.at(-1).title, 'File changed');
  assert.deepStrictEqual(cursorIsland.modifiedFiles.map((file) => file.path), ['/p/cursor-project/src/App.tsx']);
  assert.strictEqual(cursorIsland.modifiedFiles[0].displayPath, 'src/App.tsx');
  assert.strictEqual(cursorIsland.modifiedFiles[0].state, 'updated');

  const cursorSettings = mergeCursorHooks({ hooks: { preToolUse: [{ command: 'keep-permission-hook' }], workspaceOpen: [{ command: 'keep-workspace-hook' }] } });
  assert.strictEqual(cursorSettings.added, CURSOR_EVENTS.length);
  assert.strictEqual(mergeCursorHooks(cursorSettings.settings).added, 0);
  assert.deepStrictEqual(cursorSettings.settings.hooks.preToolUse, [{ command: 'keep-permission-hook' }]);
  assert.deepStrictEqual(cursorSettings.settings.hooks.workspaceOpen, [{ command: 'keep-workspace-hook' }]);
  assert(cursorSettingsPath('/home/tester').endsWith(path.join('.cursor', 'hooks.json')));
  assert.strictEqual(Object.keys(cursorSettings.settings.hooks).some((event) => ['preToolUse', 'beforeShellExecution', 'beforeMCPExecution', 'beforeReadFile', 'subagentStart'].includes(event) && cursorSettings.settings.hooks[event].some(isJichoCursorHook)), false);
  const cursorUninstall = removeCursorHooks(cursorSettings.settings);
  assert.strictEqual(cursorUninstall.removed, CURSOR_EVENTS.length);
  assert.deepStrictEqual(cursorUninstall.settings.hooks.preToolUse, [{ command: 'keep-permission-hook' }]);

  const codexRaw = {
    hook_event_name: 'PermissionRequest', session_id: 'shared-session-id', cwd: '/p/codex-project',
    permission_mode: 'default', turn_id: 'codex-turn-1', tool_name: 'Bash', tool_use_id: 'codex-tool-1',
    tool_input: { command: 'git push --force', description: 'Push the current branch' },
    transcript_path: '/private/codex-transcript.json', prompt: 'private user instruction', model: 'private-model-name'
  };
  const safeCodex = sanitizeCodexHook(codexRaw);
  assert(safeCodex);
  assert.strictEqual(safeCodex.jicho_agent_id, 'codex');
  assert.strictEqual(Object.hasOwn(safeCodex, 'transcript_path'), false);
  assert.strictEqual(Object.hasOwn(safeCodex, 'prompt'), false);
  assert.strictEqual(Object.hasOwn(safeCodex, 'model'), false);
  assert.strictEqual(validateHookBody(safeCodex), null);
  assert.strictEqual(validateHookBody({ ...safeCodex, prompt: codexRaw.prompt }), 'invalid-event');
  assert.strictEqual(normalizeCodexEvent(safeCodex).type, 'PermissionRequested');
  assert.strictEqual(normalizeCodexEvent(safeCodex).agentId, 'codex');
  assert.strictEqual(validateCanonicalEvent(normalizeCodexEvent(safeCodex)), true);
  const codexAdapter = new CodexAdapter({ core });
  assert.strictEqual(validateAdapter(codexAdapter), true);
  assert.strictEqual(codexAdapter.getCapabilities({ detected: true }).permissionInterception, 'permission-request-hook-only');
  assert.strictEqual(ALL_AUTHENTICATED_EVENTS.has('Interrupt'), true);
  const codexDecisionResponse = post(port, safeCodex);
  const claudeDecisionResponse = post(port, req('shared-session-id', 'git push --force'));
  await waitForPendingCount(core, 2);
  const codexPending = core.list().find((item) => item.agentId === 'codex');
  const claudePending = core.list().find((item) => item.agentId === 'claude-code');
  assert(codexPending && claudePending);
  assert.strictEqual(codexPending.agentId, 'codex');
  assert.strictEqual(codexPending.sid, 'shared-session-id');
  assert.strictEqual(codexPending.input.command, 'git push --force');
  assert.strictEqual(core.handleRequestDecision(codexPending.id, 'deny', 'codex-contract-test'), true);
  assert.strictEqual(core.handleRequestDecision(claudePending.id, 'allow', 'claude-contract-test'), true);
  assert.strictEqual(behavior(await codexDecisionResponse), 'deny');
  assert.strictEqual(behavior(await claudeDecisionResponse), 'allow');
  const safeCodexDecision = core.request({
    jicho_agent_id: 'codex', hook_event_name: 'PermissionRequest', session_id: 'codex-safe',
    cwd: '/p/codex-project', tool_name: 'Bash', tool_input: { command: 'git status' }
  }, null, { agentId: 'codex' });
  await waitForPendingCount(core, 1);
  const safeCodexPending = core.list()[0];
  assert.strictEqual(safeCodexPending.canAlways, false);
  assert.strictEqual(core.allowAlways(safeCodexPending.id), false);
  core.settle(safeCodexPending.id, 'deny', 'codex-contract-test');
  await safeCodexDecision;

  const codexPost = sanitizeCodexHook({
    hook_event_name: 'PostToolUse', session_id: 'shared-session-id', cwd: '/p/codex-project',
    permission_mode: 'default', turn_id: 'codex-turn-1', tool_name: 'Bash', tool_use_id: 'codex-tool-2',
    tool_input: { command: 'npm test' }, tool_output: 'private output text', transcript_path: '/private/transcript'
  });
  assert.strictEqual(Object.hasOwn(codexPost, 'tool_output'), false);
  assert.strictEqual(validateHookBody(codexPost), null);
  assert.deepStrictEqual(await post(port, codexPost), {});
  assert.strictEqual(core.sessions.has('codex:shared-session-id'), true);
  assert.strictEqual(activityEvents.at(-1).source, 'codex-hook');
  assert.strictEqual(activityEvents.at(-1).details.command, 'npm test');

  const codexSettings = mergeCodexHooks({ hooks: {
    PermissionRequest: [{ matcher: '*', hooks: [{ type: 'command', command: 'keep-codex-policy' }] }],
    PostToolUse: [{ hooks: [{ type: 'command', command: 'keep-codex-audit' }] }]
  } });
  assert.strictEqual(codexSettings.added, CODEX_EVENTS.length);
  assert.strictEqual(mergeCodexHooks(codexSettings.settings).added, 0);
  const permissionGroup = codexSettings.settings.hooks.PermissionRequest.find((group) => group.hooks.some(isJichoCodexHook));
  assert.strictEqual(permissionGroup.matcher, '^(Bash|apply_patch)$');
  assert.strictEqual(permissionGroup.hooks.find(isJichoCodexHook).async, undefined);
  assert.strictEqual(codexSettings.settings.hooks.SessionStart.at(-1).hooks[0].async, true);
  assert.strictEqual(codexSettings.settings.hooks.SessionEnd.at(-1).hooks[0].async, undefined);
  assert(codexSettingsPath('/home/tester').endsWith(path.join('.codex', 'hooks.json')));
  const codexUninstall = removeCodexHooks(codexSettings.settings);
  assert.strictEqual(codexUninstall.removed, CODEX_EVENTS.length);
  assert.strictEqual(codexUninstall.settings.hooks.PermissionRequest[0].hooks[0].command, 'keep-codex-policy');

  const cursorStore = new Store(':memory:');
  const multiAgentCore = new Core({ store: cursorStore });
  multiAgentCore.touch('same-id', { cwd: '/p/claude' });
  multiAgentCore.observeCursorEvent({ ...safeCursor, conversation_id: 'same-id', cwd: '/p/cursor' });
  multiAgentCore.observeCodexEvent({ ...codexPost, session_id: 'same-id', cwd: '/p/codex' });
  assert.deepStrictEqual(multiAgentCore.sessions.has('same-id'), true);
  assert.deepStrictEqual(multiAgentCore.sessions.has('cursor:same-id'), true);
  assert.deepStrictEqual(multiAgentCore.sessions.has('codex:same-id'), true);
  assert.strictEqual(cursorStore.listAllSessions().filter((session) => session.id === 'same-id').length, 3);
  const storedCursorEvent = cursorStore.listEvents('cursor', 'same-id')[0];
  assert.strictEqual(storedCursorEvent.details.filePath, '/p/cursor-project/src/App.tsx');
  assert.strictEqual(JSON.stringify(storedCursorEvent.details).includes('private source'), false);
  const storedCodexEvent = cursorStore.listEvents('codex', 'same-id')[0];
  assert.strictEqual(storedCodexEvent.source, 'codex-hook');
  assert.strictEqual(storedCodexEvent.details.command, 'npm test');
  cursorStore.close();
  console.log('PASS 29: Cursor and Codex hooks are authenticated, privacy-filtered, provenance-preserving, and agent-isolated');
  console.log('PASS 30: Codex PermissionRequest decisions use the existing exact-request approval core');

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
  const secretRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jicho-secret-paths-'));
  for (const relative of ['id_rsa', '.npmrc', '.pypirc', '.netrc', '.aws/credentials', '.ssh/id_ed25519', 'tls/server.pem', 'keys/private.key', '.git/config']) {
    const file = path.join(secretRoot, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'test');
    const result = evaluate({ tool_name: 'Read', cwd: secretRoot, tool_input: { file_path: file } }, true);
    assert(result.riskFlags.some((flag) => flag.code === 'secret-file'), 'secret path flagged: ' + relative);
    assert.strictEqual(result.autoAllow, false, 'secret path never auto-allows: ' + relative);
  }
  fs.rmSync(secretRoot, { recursive: true, force: true });
  console.log('PASS 10: allowlist rejects shell chaining and redirection');
  const alwaysCore = new Core();
  const alwaysResponse = alwaysCore.request(req('always-safe', 'git status'));
  await waitForPendingCount(alwaysCore, 1);
  assert.strictEqual(alwaysCore.list()[0].canAlways, true);
  alwaysCore.settle(alwaysCore.list()[0].id, 'deny', 'test');
  await alwaysResponse;
  const flaggedAlwaysResponse = alwaysCore.request(req('always-risk', 'rm -rf /tmp/jicho-demo'));
  await waitForPendingCount(alwaysCore, 1);
  assert.strictEqual(alwaysCore.list()[0].canAlways, false);
  alwaysCore.settle(alwaysCore.list()[0].id, 'deny', 'test');
  await flaggedAlwaysResponse;
  console.log('PASS 10A: Always availability matches safe policy and secret-file risks block it');

  const safePhoneItem = { id: 'phone-safe', cwd: '/work/repo', tool: 'Bash', input: { command: 'git status' }, riskFlags: [] };
  const phoneConfig = { topic: 'a'.repeat(32) };
  const genericAlert = notificationFor(safePhoneItem, phoneConfig);
  assert.strictEqual(genericAlert.message, 'An agent is waiting. Review it in Jicho on your computer.');
  assert.strictEqual(Object.hasOwn(genericAlert, 'actions'), false);
  assert(!JSON.stringify(genericAlert).includes('/work/repo'));
  assert(!JSON.stringify(genericAlert).includes('git status'));
  console.log('PASS 11: phone alerts are content-free and contain no remote-decision capability');

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
  console.log('PASS 12: invalid phone settings remain untouched and alert publishing fails closed');

  assert.deepStrictEqual(Object.keys(genericAlert).sort(), ['message', 'priority', 'title', 'topic']);
  assert.strictEqual(ntfyBaseUrl('http://localhost:1234/selfhost/'), 'http://localhost:1234/selfhost');
  assert.strictEqual(ntfyPairingUrl('https://ntfy.example.test/base', 'topic'), 'ntfy://ntfy.example.test/base/topic');
  assert.throws(() => ntfyBaseUrl('file:///tmp/ntfy'), /HTTP or HTTPS/);
  console.log('PASS 12A: phone notification payloads include only a generic alert and topic');

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
  fs.writeFileSync(path.join(selfHostedDirectory, 'phone.json'), JSON.stringify({ ...phoneConfig, enabled: false }));
  const selfHostedBridge = new PhoneBridge(new Core(), selfHostedDirectory);
  selfHostedBridge.setEnabled(true);
  assert.strictEqual(await selfHostedBridge.publishRequest(safePhoneItem), true);
  const notificationDeadline = Date.now() + 1500;
  while (!ntfyRequests.some((entry) => entry.method === 'POST') && Date.now() < notificationDeadline) await wait(10);
  const postNotification = ntfyRequests.find((entry) => entry.method === 'POST');
  assert(postNotification);
  assert.strictEqual(postNotification.url, '/selfhost/');
  assert.strictEqual(postNotification.body.message, 'An agent is waiting. Review it in Jicho on your computer.');
  assert.deepStrictEqual(ntfyRequests.map((entry) => entry.method), ['POST']);
  const migratedPhoneConfig = JSON.parse(fs.readFileSync(path.join(selfHostedDirectory, 'phone.json'), 'utf8'));
  assert.strictEqual(Object.hasOwn(migratedPhoneConfig, 'secret'), false);
  assert.strictEqual(Object.hasOwn(migratedPhoneConfig, 'replyTopic'), false);
  selfHostedBridge.close();
  await new Promise((resolve) => localNtfy.close(resolve));
  fs.rmSync(selfHostedDirectory, { recursive: true, force: true });
  if (oldNtfyUrl === undefined) delete process.env.JICHO_NTFY_URL;
  else process.env.JICHO_NTFY_URL = oldNtfyUrl;
  console.log('PASS 12B: JICHO_NTFY_URL sends only generic alerts to the configured ntfy service');

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
  assert.strictEqual(EVENTS.includes('SessionStart'), true);
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
  store.upsertSession({ id: 'stale-store-session', state: 'idle', cwd: '/p/stale', last: Date.now() - 31 * 60 * 1000 });
  assert.strictEqual(store.listSessions().some((session) => session.id === 'stale-store-session'), false);
  assert.deepStrictEqual(compactAction({ file_path: '/p/file', content: 'secret body', old_string: 'old', new_string: 'new' }), {
    file_path: '/p/file', contentLength: 11, old_stringLength: 3, new_stringLength: 3
  });
  const failureDetails = safeEventDetails({ error: 'Exit code 7\ncredential=secret' });
  assert.deepStrictEqual(failureDetails, { errorPresent: true, exitCode: 7 });
  store.close();
  assert.strictEqual(fs.statSync(databasePath).mode & 0o077, 0);
  console.log('PASS 18: SQLite migration, session/event history, bounded sensitive data, atomic decisions, durable concurrency, and local file permissions');

  const expiringSessionsCore = new Core();
  expiringSessionsCore.sessions.set('old-session', { id: 'old-session', last: Date.now() - 31 * 60 * 1000 });
  const activeSessionResponse = expiringSessionsCore.request(req('active-session', 'run something'));
  await waitForPendingCount(expiringSessionsCore, 1);
  expiringSessionsCore.sessions.get('active-session').last = Date.now() - 31 * 60 * 1000;
  assert.strictEqual(expiringSessionsCore.expireIdleSessions(), 1);
  assert.strictEqual(expiringSessionsCore.sessions.has('old-session'), false);
  assert.strictEqual(expiringSessionsCore.sessions.has('active-session'), true);
  expiringSessionsCore.settle(expiringSessionsCore.list()[0].id, 'deny', 'test');
  await activeSessionResponse;
  console.log('PASS 18A: sessions idle over 30 minutes expire while sessions with pending approvals remain');

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

  const demoCore = new Core();
  const demoServer = createServer(demoCore, { credentialProvider: () => credentialManager.getCredential() });
  await new Promise((resolve) => demoServer.listen(0, '127.0.0.1', resolve));
  demoCore.on('pending', (items) => {
    if (items.length === 3) for (const item of items) demoCore.settle(item.id, 'allow', 'demo-test');
  });
  const demoOutput = [];
  assert.strictEqual(await runDemo({ port: demoServer.address().port, cwd: '/tmp', credentialManager, log: (line) => demoOutput.push(line) }), true);
  for (let index = 1; index <= 3; index += 1) assert(demoOutput.some((line) => line.includes('Fake session ' + index + ' received: ALLOW')));
  await new Promise((resolve) => demoServer.close(resolve));
  console.log('PASS 26: concurrent demo requests each print their own reply');

  const gnomeDisplay = {
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 32, width: 1920, height: 1048 }
  };
  assert.strictEqual(selectIslandLayout({ expanded: false, pointerInsideIsland: true, now: 100 }), 'idle');
  assert.strictEqual(selectIslandLayout({ expanded: true, now: 100 }), 'expanded');
  assert.strictEqual(selectIslandLayout({ activeUntil: 101, now: 100 }), 'expanded');
  assert.deepStrictEqual(electronArgs('linux', { XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0' }, '/app', ['--disable-gpu']), ['--ozone-platform=x11', '--disable-gpu', '/app']);
  assert.deepStrictEqual(electronArgs('linux', { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }, '/app', []), ['/app']);
  assert.deepStrictEqual(electronArgs('darwin', { XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0' }, '/app', []), ['/app']);
  assert.deepStrictEqual(selectIslandBounds(gnomeDisplay, 'idle'), { x: 736, y: 40, width: 448, height: 92 });
  assert.deepStrictEqual(selectIslandBounds(gnomeDisplay, 'expanded'), { x: 676, y: 40, width: 568, height: 560 });
  console.log('PASS 31: GNOME work-area placement and explicit click state keep the island top-centered and collapsible');

  await new Promise((resolve) => srv.close(resolve));
  fs.rmSync(credentialDirectory, { recursive: true, force: true });
  console.log('ALL PASS');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
