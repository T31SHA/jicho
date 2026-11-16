# JICHO Implementation Status

**Updated:** 2026-11-16  
**Implementation base:** `a7f84e5`

## Delivered before this increment

- Electron floating companion and approval card.
- Node loopback server with one held hook response per approval, preserving concurrent request routing.
- Claude Code hook installer with merge, timestamped backup, uninstall, and status commands.
- Optional ntfy notification/action bridge, deterministic allowlist and risk flags, tray/startup settings, and real-Claude verifier.
- Repository audit, product specification, initial threat model, and ingress hardening.

## Implemented in this increment

- Added `better-sqlite3` 13.2.0 with schema version 1 for workspaces, sessions, observed events, approval requests, decisions, and audit records.
- Added transactional approval resolution with one decision row per request, conditional state transitions, request expiry checks, and explicit states for approval, denial, timeout, failure, cancellation, and supersession.
- Added restart recovery: persisted pending requests become `FAILED` because their original HTTP response cannot survive process death. Persisted sessions are marked disconnected and are not trusted for current-process auto-allow.
- Desktop startup now requires the SQLite store before starting the hook server; database failure leaves approval routing disabled and reports an error.
- Hook observation covers documented Claude HTTP events: `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `Notification`, `SubagentStart`, `SubagentStop`, and `SessionEnd`. The installer still excludes `SessionStart`, whose current reference does not support HTTP hooks.
- Event persistence omits prompt text and tool output. Approval inputs and relevant command/path fields are bounded; local history is not encrypted and no retention control exists yet.
- POSIX database, WAL, and shared-memory files are restricted to owner permissions. Windows relies on the OS ACLs for the Electron application-data directory.
- Upgraded Electron from 33.4.11 to 45.3.3 after `npm audit` identified high-severity advisories in the old line. Upgraded SQLite from 11.10.0 after it failed to compile against Electron 45 headers.

## Verification

Environment: Linux x64, Node.js `v22.23.2`, npm `10.9.8`, Electron `45.3.3`, better-sqlite3 `13.1.0`.

| Check | Result | Limits |
| --- | --- | --- |
| Original repository baseline | PASS, 9 checks | Baseline predates the ingress hardening and SQLite work. |
| Current `npm test` | PASS, 19 checks | Local loopback and SQLite harness; not an external integration test. Covers 20-way routing, durable concurrent decisions, expiry, one decision, restart recovery, and unavailable-store failure. |
| `npm run dist:linux` | PASS | Built Linux x64 AppImage and Debian package with Electron 45 and rebuilt SQLite native module. Artifacts were not installed or launched. |
| Full `npm audit` after Electron upgrade | 6 moderate, 0 high, 0 critical | Remaining findings are development/package-build dependencies (`electron-builder` / `minimatch`); no production dependency findings. |
| `npm audit --omit=dev` | 0 findings | Runtime dependency tree only. |
| Claude Code | Unverified | Host has Claude Code `2.1.319`; Jicho hooks are not installed. Real allow/deny, current hook invocation, and action behavior have not been checked. |
| Electron GUI / display behavior | Unverified | GUI launch, Wayland/X11 behavior, window positioning, and tray interactions were not tested. |
| Windows / macOS / Android / iOS | Unverified or not implemented | No builds or device tests were performed. |

## Current capability matrix

| Area | Status |
| --- | --- |
| Approval routing | Implemented in the Node core; each decision remains bound to its original held hook response. |
| Local persistence | Implemented for sessions, hook observations, approval states, decisions, and audit metadata; SQLite migrations currently stop at schema v1. |
| Restart behavior | Pending requests are durably marked failed and never re-presented as approvable; a fresh hook event is needed before safe auto-allow is eligible. |
| Claude Code | Real HTTP hook integration and additional documented event hooks; current installed-version behavior remains unverified. |
| Desktop | Electron companion and tray source exist; command centre, persisted timeline UI, GUI behavior, and platform-specific window behavior are incomplete or unverified. |
| Linux packaging | x64 AppImage and Debian package build passed with Electron 45 / SQLite 13.1; artifacts not launched. |
| Phone | Optional ntfy bridge only; no first-party paired device protocol. |
| Codex / Cursor | Not implemented. |
| Native Android / iOS, relay, push services | Not implemented. |
| CI/CD, signing, retention controls | Not implemented. |

## Known security and product limitations

- `JICHO_TOKEN` remains optional. The service binds to loopback, but same-user local processes can spoof hook events when no token is configured.
- SQLite is not encrypted. Permission action details and bounded command/path observations can include sensitive information; database backup, retention, and secure deletion controls are not implemented. Failure events retain only an error-present flag and an exit code when parseable, not raw error output.
- No first-party remote approval protocol exists. ntfy remains a third-party shared-topic path whose service can read notification content and signed action values.
- `PermissionRequest` input has no `tool_use_id` in the current Claude reference. Some same-session terminal/tool completion events therefore cannot be correlated more finely than the session.
- `PostToolUse`, `Stop`, and `SessionEnd` resolve outstanding same-session requests as superseded; adapters with concurrent requests within one session need richer source correlation before generalization.
- The UI has no complete command centre or actual event timeline yet. Stored source events are evidence records, not generated progress summaries.
- Full `npm audit` still reports six moderate findings in Electron packaging dependencies; they are development-only and should be revisited before release.
- There has been no independent security review, real-device approval test, Windows/macOS build, or X11/Wayland GUI test.

## Next implementation units

1. Build a command-centre view backed by the persisted session and event queries, with explicit observed/inferred labels.
2. Run Claude Code 2.1.319 against the installed HTTP hooks and verify real allow, deny, timeout, and failure behavior.
3. Add retention and export/backup policy for local SQLite history, plus validation and sender-frame controls before expanding IPC.
4. Review Codex App Server and Cursor Hooks official protocols before implementing their adapter contracts.
5. Design first-party device identity, pairing, relay, push, and replay-safe remote approvals before building mobile clients.
6. Test the floating companion and packaging separately on X11, Wayland, Windows, macOS, Android, and iOS where the required hosts/devices exist.

## Commands

- Core and store harness: `npm test`
- Desktop app: `npm start`
- Local core: `npm run core`
- Fake concurrent demo: `npm run demo`
- Real Claude allow/deny verifier: `npm run verify`
- Claude hook setup/status/removal: `npm run jicho -- install|status|uninstall`
- Linux package build: `npm run dist:linux`
