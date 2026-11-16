# JICHO Implementation Status

**Updated:** 2026-11-16  
**Repository revision at start:** `2d35970`

Host check: Claude Code `2.1.319` is installed, but `npm run jicho -- status` reports that JICHO hooks are not installed. The current session exposes Wayland and X display variables; the Electron app was not launched.

## Delivered in the repository before this work

- Electron floating mascot and approval card.
- Node HTTP hook server and in-memory per-request approval routing.
- Claude Code hook installer with merge, timestamped backup, uninstall, and status commands.
- Optional ntfy notifications and HMAC-checked reply actions.
- Deterministic exact safe allowlist and risk labels, disabled by default.
- Tray, single-instance lock, start-at-login preferences, and unsigned electron-builder configuration.
- Fake three-session demo and interactive real-Claude allow/deny verifier.
- Fifteen checks in `test/harness.js` after this increment.

## Baseline verification

Command: `npm test`  
Baseline result: **PASS**, nine checks, including twenty concurrent approvals.  
Updated result: **PASS**, fifteen checks, including twenty concurrent approvals.  
Environment: Linux, Node.js `v22.23.2`, npm `10.9.8`.  
The initial sandboxed run could not bind loopback (`EPERM`); the requested harness passed when rerun with local-network permission.

The harness is local and partly simulated. It does not prove Claude Code, ntfy, Electron GUI behavior, Windows/macOS, X11/Wayland, mobile apps, Codex, or Cursor.

## Work completed in this increment

- Repository inventory, source/config review, Git history and working-tree review.
- Architecture audit, product specification, and initial threat model.
- Current official Claude Code Hooks and ntfy publishing references reviewed. Claude `SessionStart` does not support HTTP hooks in the current documentation.
- Hook ingress now has a 1 MiB body cap, JSON validation, exact `POST /` handling, no-store responses, optional timing-safe bearer validation, and observable rejection diagnostics.
- Invalid session identities cannot create an `unknown` session or pass the safe auto-allow policy. Safe auto-allow also requires a previously observed session.
- Existing unreadable or malformed `phone.json` settings are preserved; the optional phone feature fails closed until repaired.
- Claude installer no longer registers HTTP `SessionStart`.
- Graceful app shutdown resolves pending hook responses without a decision, returning the agent to its native permission flow.
- `npm run dist:linux` successfully produced Linux x64 AppImage and Debian artifacts. The packages were not installed or launched; Windows/macOS builds remain unverified.

## Current capability matrix

| Area | Status |
| --- | --- |
| Core response routing | Implemented and locally tested; request/session metadata remains in memory. Unknown and first-seen sessions require review. |
| Claude Code | Real HTTP hook integration; installed-version behavior has not been verified in this work session. |
| Desktop GUI | Electron source exists; GUI and platform window behavior not tested in this session. |
| Linux packaging | AppImage and Debian x64 package builds passed; artifacts were not installed or launched. |
| Phone | Optional ntfy bridge; external delivery/action was not exercised in this session. |
| Codex / Cursor | Not implemented. |
| Native Android / iOS | Not implemented. |
| Relay, pairing service, push service | Not implemented. |
| SQLite and durable event store | Not implemented. |
| CI/CD and release signing | Not implemented. |

## Known security and product gaps

- `JICHO_TOKEN` is optional; loopback limits exposure but does not authenticate local processes.
- Session/request state is memory-only; exact pending approvals cannot be restored after process death.
- `PostToolUse`/`Stop`/`SessionEnd` cleanup is session-scoped. Current documented `PermissionRequest` input has no `tool_use_id`, limiting finer correlation for concurrent operations inside one Claude session.
- ntfy is a third-party shared-topic alert/action path, not a paired JICHO device protocol; the service can read published content and signed action payloads.
- UI is a single floating window, without the required full command centre, timeline, or detailed session view.
- No actual platform GUI, Windows/macOS package, native mobile, or remote relay was verified in this session.

## Next implementation units

1. Add versioned domain/event contracts and a durable local event store, deciding safe recovery semantics before persisting requests.
2. Expand Claude monitoring to documented events with explicit capabilities and a real installed-CLI verification run.
3. Build the command centre and session detail while retaining held-response decision ownership.
4. Implement and verify desktop window interactions and platform behavior.
5. Review current Codex and Cursor protocols, then build only supported approval features.
6. Design relay/device authentication before writing a JICHO mobile app.

## Commands

- Baseline/core tests: `npm test`
- Desktop app: `npm start`
- Local core: `npm run core`
- Fake concurrent demo: `npm run demo`
- Real Claude allow/deny verifier: `npm run verify`
- Claude hook setup/status/removal: `npm run jicho -- install|status|uninstall`
- Linux package build: `npm run dist:linux`
