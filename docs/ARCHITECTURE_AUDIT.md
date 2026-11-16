# JICHO Architecture Audit

**Audit date:** 2026-11-16  
**Repository revision:** `2d35970` (`master`, `origin/master`)  
**Working tree at audit start:** clean

## Executive summary

JICHO is currently a compact Electron application with a Node.js hook server and an in-memory approval coordinator. It has one real agent integration: Claude Code HTTP hooks. The central routing design is valuable and tested: each `PermissionRequest` stays attached to one held HTTP response, so settling one request cannot answer another request. The repository also includes an optional ntfy notification bridge, deterministic local auto-allow rules, a local JSONL decision log, a hook installer, and a guided real-Claude verification script.

This is a useful desktop prototype with real Claude Code integration, not yet a universal supervisor or a production mobile/remote-control product. There is no React, Tauri, Rust, Flutter, relay service, SQLite store, adapter SDK, or native mobile app. Codex and Cursor are explicitly out of scope in the current README.

## Repository and dependency inventory

At audit start, tracked project files were `package.json`, `package-lock.json`, `.gitignore`, `LICENSE`, `README.md`, `MASTER_PROMPT.md`, `bin/jicho.js`, the nine JavaScript modules under `src/`, three files under `src/ui/`, and `test/harness.js`. The four audit/product documents were added during this increment.

Direct runtime dependencies are `qrcode`; development dependencies are Electron `^33.0.0` and electron-builder `^26.18.0`. The lockfile is npm lockfile v3. The package scripts cover the Electron app, local core, CLI installer, real-hook verifier, fake concurrency demo, packaging targets, and one Node test harness. There is no TypeScript compiler, frontend framework, Rust workspace, Flutter project, database driver, CI workflow, or separate integration-test configuration.

## Existing modules

| File | Current responsibility | Audit finding |
| --- | --- | --- |
| `src/core.js` | Pending requests, sessions, safe auto-allow, audit metadata, and settle operations | Approval state and sessions are in memory. The held-response routing is correct and covered by tests. This increment rejects invalid session IDs and permits safe auto-allow only after a session has already been observed. |
| `src/server.js` | Loopback HTTP receiver for Claude hooks | Binds to `127.0.0.1`; bearer auth remains optional and is read once at module load. This increment adds a 1 MiB body limit, JSON-object validation, exact root-path routing, constant-time bearer comparison when configured, and observable ingress diagnostics. |
| `src/policy.js` | Deterministic risk flags and exact safe allowlist | Disabled by default. Exact command and path checks are conservative, but flags only label requests and are not a general policy engine. |
| `src/phone.js` | ntfy publish/subscribe, QR code, redaction, HMAC decision check | This is an ntfy client workflow, not a JICHO Android/iOS app or a private relay. The random topic plus signed reply prevents guessing decisions, but a subscriber who can read a pending notification can also see its signed action values. The relay can read notification content and action values. This increment prevents malformed existing phone settings from being silently replaced. |
| `src/main.js` | Electron lifecycle, floating window, tray, startup integration, preferences, IPC wiring | Secure renderer defaults are enabled (`contextIsolation`, sandbox, no Node integration). The window and tray have not been verified across OSes, displays, X11, or Wayland. There is no command centre. |
| `src/preload.js` | Narrow context-bridge API for renderer IPC | API surface is small. IPC handlers do not explicitly validate the sender frame; this should be added before richer windows or navigation are introduced. |
| `src/ui/index.html`, `renderer.js`, `style.css` | One compact mascot/approval/settings window | Actual approval cards render the raw request details with `textContent`. The UI is a single floating window, not a session dashboard or timeline. Dragging and a multi-session detail view are absent. |
| `src/tray-icon.js` | Generated tray icon | No separate platform-specific tray implementation or platform verification. |
| `src/demo.js` | Three fake concurrent HTTP requests | Explicitly simulated. It tests the local app path only and does not execute agent commands. |
| `src/verify.js` | Interactive live Claude Code allow/deny check | Intended for real verification, but requires an installed Claude CLI, installed hook, and a human to confirm the agent's observed behavior. It has not been run in this audit. |
| `bin/jicho.js` | Claude settings merge, backup, uninstall, and status CLI | Preserves unrelated hooks and is idempotent under the unit harness. This increment removes the unsupported HTTP `SessionStart` entry; uninstall still removes old marked entries by scanning every configured event. |
| `test/harness.js` | Loopback server, approval routing, timeout, disconnect, HMAC, installer, policy, and concurrency checks | Thirteen checks pass. It does not validate an installed Claude Code version, UI behavior, real ntfy delivery, or any other agent. |

`README.md` accurately identifies the limited supported integration and unsigned packages. `MASTER_PROMPT.md` is a prior project prompt and is not an implementation contract for the current product brief.

## Git history and working tree

The recent history shows deliberate incremental work on the Electron overlay, installer, verifier, ntfy pairing, deterministic policy, tray/startup, concurrency demo, security tests, and packaging. The starting revision is `2d35970` (“Document Jicho setup, behavior, security, and packaging”). No user changes were present at audit start.

## Baseline

Environment: Linux container, Node.js `v22.23.2`, npm `10.9.8`. The first `npm test` attempt failed before test execution because sandbox networking denied binding to loopback (`listen EPERM`). The same unmodified test command was rerun with local-network permission and passed all nine checks:

1. Correct answers for three distinct sessions.
2. Native terminal resolution clears the corresponding card without sending a decision.
3. Timeout returns an empty response so Claude's original permission flow can continue.
4. Duplicate/stale decisions do not affect another request.
5. A disconnected HTTP client clears its pending request.
6. Safe auto-allow rejects shell chaining and redirection.
7. ntfy HMAC accepts only the signed request ID and decision.
8. Installer merge is idempotent and preserves unrelated hooks.
9. Twenty concurrent requests receive their individual answers.

The host also has Claude Code `2.1.319`, but `npm run jicho -- status` reports that JICHO hooks are not installed. The guided live verifier was not run because it requires changing the user's Claude settings and then performing interactive allow/deny prompts. The current desktop session advertises Wayland and X display variables, but the Electron GUI was not launched or exercised.

## What is real, simulated, and unverified

| Capability | Current status |
| --- | --- |
| Claude Code hook protocol | Real HTTP hook implementation; a real installed-version allow/deny verification has not been run in this audit. |
| Desktop approval routing | Real local request/response path; routing and failure behavior pass the Node harness. GUI behavior was not exercised. |
| ntfy phone alerts/actions | Real external-service code path, disabled by default; delivery and action workflow were not exercised against ntfy in this audit. It uses the ntfy app, not a JICHO mobile app. |
| Concurrent demo | Simulated requests only; does not establish an external integration. |
| Cursor, Codex, other agents | Not implemented. |
| Desktop builds | Linux x64 AppImage and Debian package builds passed after this increment. The artifacts were not installed or launched. Windows/macOS were not built. |
| SQLite, cloud relay, push notifications | Not implemented. |

## Architecture decisions

1. Preserve Electron and the Node.js control core while they provide the working local Claude approval path. A framework migration would add risk without improving this first vertical slice.
2. Keep a permission request attached to its originating hook response. Do not replace it with a global “current request” or route by arrival order.
3. Reject missing or malformed session identity before policy evaluation. Do not manufacture a common `unknown` session. Implemented in this increment.
4. Bound and validate hook ingress; report malformed requests instead of silently ignoring them. Implemented in this increment.
5. Stop installing unsupported HTTP hooks. Use documented Claude hook types and events only. Implemented for `SessionStart` in this increment.
6. Treat the current in-memory request queue as process-lifetime state. On process loss, the HTTP connection closes and the agent retains its native permission flow; no pending permission may be restored as an approvable request after restart.
7. Keep ntfy explicitly classified as an optional third-party notification/action bridge until a first-party mobile client and stronger device pairing exist.

## Changes made after the baseline

- Missing, blank, overlong, whitespace-padded, or control-character session IDs are rejected; no shared `unknown` session is created.
- Auto-allow requires both the opt-in rule and a session already observed by JICHO; first-seen sessions require review.
- Hook JSON bodies are capped at 1 MiB. Malformed JSON is a reported 400, oversized input is a reported 413, and invalid session identities receive a neutral 200 response with no decision.
- Header and request receive timeouts are bounded to 10 and 15 seconds; keep-alive idle time is bounded to 5 seconds.
- The server accepts only `POST /`, marks responses `no-store`, and compares configured bearer values with a timing-safe comparison.
- Invalid existing `phone.json` data is left untouched and phone actions remain disabled until the file is repaired.
- Installer and README no longer claim HTTP `SessionStart` support.
- Graceful Electron shutdown settles each pending hook with no decision, allowing Claude's native permission flow to continue.
- Regression coverage grew from nine to fifteen checks; all pass in the loopback-enabled run.
- `npm run dist:linux` built `dist/Jicho-0.0.1.AppImage` and `dist/jicho_0.0.1_amd64.deb`; the default Electron icon warning remains, and the built app was not launched.

## Current Claude Code source checked

The official Hooks reference was checked on the audit date: <https://code.claude.com/docs/en/hooks>. It documents HTTP hooks as POST requests whose response body follows the hook JSON output schema; a 2xx empty body is success with no decision, while a non-2xx response is a non-blocking error by default. `PermissionRequest` accepts `hookSpecificOutput.decision.behavior` values `allow` and `deny`; the documented `PermissionRequest` payload has no `tool_use_id`. `SessionStart` explicitly supports only `command` and `mcp_tool` hook types. These facts inform the ingress and installer changes and limit what the current adapter can correlate within one Claude session.

The current ntfy publish/action reference was also checked: <https://docs.ntfy.sh/publish/>. ntfy documents HTTP action buttons and warns that an unreserved public topic name functions as a password. JICHO's current ntfy action values are therefore bearer-like secrets visible to anyone able to read the pending notification.

## Incremental implementation after the audit

On 2026-11-16, the Node core gained `src/store.js`, backed by SQLite schema version 1. The store persists workspaces, sessions, bounded source-event details, approval requests, one-use decisions, and audit records. Foreign keys bind events and approvals to `(agent_id, session_id)`. Approval resolution is transactional and checks both the pending state and expiry before recording an allow or deny.

The desktop opens `jicho.sqlite3` in Electron's user-data directory and does not start the hook server if the store cannot be opened. On startup, the store changes any persisted `PENDING` approval to `FAILED` with a recovery audit entry because its held HTTP response cannot be resumed. Restored sessions are disconnected and cannot satisfy the current-process safe auto-allow check. The existing per-request resolver map remains the component that delivers decisions to the original HTTP response.

The Claude installer now adds documented HTTP hooks for prompt submission, tool start/finish/failure, notifications, subagent lifecycle, stop, and session end, in addition to `PermissionRequest`. It still excludes HTTP `SessionStart`. Hook event schemas and `PreToolUse` / `PostToolUseFailure` fields were checked against the [current official Hooks reference](https://code.claude.com/docs/en/hooks); the installed Claude CLI has not been exercised in this increment.

Electron was updated to 45.3.3 after the dependency audit reported high-severity advisories in 33.4.11. better-sqlite3 was updated from 11.10.0 to 13.2.0 after the older version failed to compile against Electron 45 headers. `npm test` passes 19 local checks. `npm run dist:linux` builds x64 AppImage and Debian packages and rebuilds the SQLite native module for Electron, but the artifacts were not installed or launched. A headless Electron 45.3.3 smoke check loaded SQLite and executed an in-memory query.

The store omits prompt text and tool output, but retains bounded command/path details needed for approvals and observations. It is not encrypted and does not yet have retention or secure-deletion controls. Full `npm audit` reports six moderate findings in the development packaging dependency tree and no high or critical findings; `npm audit --omit=dev` reports none.
