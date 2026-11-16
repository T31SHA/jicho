# JICHO Implementation Status

**Updated:** 2026-11-16  
**Implementation base:** Through the Claude settings-scope increment (2026-11-16)

## Delivered before this increment

- Electron floating companion and approval card.
- Node loopback server with one held hook response per approval, preserving concurrent request routing.
- Claude Code hook installer with merge, timestamped backup, uninstall, and status commands.
- Optional ntfy notification/action bridge, deterministic allowlist and risk flags, tray/startup settings, and real-Claude verifier.
- Repository audit, product specification, initial threat model, and ingress hardening.

## Implemented in this increment

- Added a bounded Electron command centre with overview metrics, sessions, session detail, source-labeled activity, and pending approval cards backed by actual SQLite/core data.
- Added a separate sandboxed preload for the command centre. IPC calls require the expected local main frame; both windows block popups and navigation away from their local page, and use a restrictive content security policy.
- Added companion, tray, and `CommandOrControl+Shift+J` entry points to open the command centre.
- The timeline labels Claude hook observations separately from Jicho audit decisions. It shows actual command/path evidence where retained, while continuing to omit prompt text, file contents, and raw tool failure output.
- The dashboard supports approval once or deny through the existing per-request core; it does not create a second approval state machine.
- Added IPC main-frame validation checks and recent-activity query coverage to the local harness.

## Claude settings-scope increment

- The installer can target Claude user settings (`--user`, still the default), project-local settings (`--project-local`), or shared project settings (`--project-shared`). Project settings are written under `.claude/` in the current working directory; run the command from the project root.
- User settings honor `CLAUDE_CONFIG_DIR`, including a leading `~/` path.
- Install, status, and uninstall accept the same scope flag. Installs retain timestamped backups, preserve unrelated keys/hooks, and show a scope-specific notice before asking to apply the diff. Shared scope warns that the file may affect collaborators; local scope warns about Git ignore.
- Accepted settings changes now write a same-directory temporary file, flush it, then atomically replace the target. Existing POSIX mode bits are preserved; symlink targets are updated without replacing the link. A failed replacement leaves the original file intact and removes the temporary file.
- The real-hook verifier accepts the same flags and reports/checks only that settings file. It still requires a user-started interactive Claude session and confirmation of the actual allow/deny outcome.
- Added tests that install and uninstall in a temporary project settings file, check backup creation and preservation of unrelated settings, and exercise failed atomic replacement, POSIX mode preservation, and symlink handling.

## Verification

Environment: Linux x64, Node.js `v22.23.2`, npm `10.9.8`, Electron `45.3.3`, better-sqlite3 `13.2.0`.

| Check | Result | Limits |
| --- | --- | --- |
| Original repository baseline | PASS, 9 checks | Baseline predates the ingress hardening and SQLite work. |
| Current `npm test` | PASS, 20 checks | Local loopback and SQLite harness; not an external integration test. Covers 20-way routing, durable concurrent decisions, expiry, one decision, restart recovery, unavailable-store failure, and trusted IPC sender checks. |
| Claude settings-scope install/uninstall | PASS | Automated isolated temporary-project check verifies local-scope write, backup, preservation, and removal. It does not edit the user's Claude configuration or prove Claude loaded the file. |
| Command-centre Electron smoke | PASS | Headless Electron 45 loaded the local page and sandboxed preload; a simulated IPC snapshot rendered session/approval data and the Approve button reached the mocked IPC handler. This is UI-only evidence, not an agent integration test. |
| `npm run dist:linux` | PASS | Built Linux x64 AppImage and Debian package with the command-centre assets, Electron 45, and rebuilt SQLite native module. Artifacts were not installed or launched. |
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
| Claude Code | Real HTTP hook integration and additional documented event hooks; installer supports user, project-local, and shared project scopes. Current installed-version hook behavior remains unverified. |
| Desktop | Electron companion and initial command centre are implemented. Headless renderer and IPC interaction passed with a simulated snapshot; native window, tray, shortcut, and platform behavior remain unverified. |
| Linux packaging | x64 AppImage and Debian package build passed with Electron 45 / SQLite 13.2; artifacts were not installed or launched. |
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
- The command centre currently has overview/session/activity/approval views; no task verification, independent diff/test verification, full settings center, or Codex/Cursor view is implemented. Stored source events are evidence records, not generated progress summaries.
- Full `npm audit` still reports six moderate findings in Electron packaging dependencies; they are development-only and should be revisited before release.
- There has been no independent security review, real-device approval test, Windows/macOS build, or X11/Wayland GUI test.

## Next implementation units

1. Verify the command-centre window, global shortcut, and approval delivery on X11 and Wayland.
2. Run Claude Code 2.1.319 against the installed HTTP hooks and verify real allow, deny, timeout, event, and failure behavior.
3. Add retention and export/backup policy for local SQLite history and controls for keeping or removing sensitive history.
4. Review Codex App Server and Cursor Hooks official protocols before implementing their adapter contracts.
5. Design first-party device identity, pairing, relay, push, and replay-safe remote approvals before building mobile clients.
6. Test the floating companion and packaging separately on Windows, macOS, Android, and iOS where the required hosts/devices exist.

## Commands

- Core and store harness: `npm test`
- Desktop app: `npm start`
- Local core: `npm run core`
- Fake concurrent demo: `npm run demo`
- Real Claude allow/deny verifier: `npm run verify`
- Claude user settings: `npm run jicho -- install|status|uninstall --user` (default)
- Claude project-local settings: `npm run jicho -- install|status|uninstall --project-local`
- Claude shared project settings: `npm run jicho -- install|status|uninstall --project-shared`
- Real verifier scope: `npm run verify -- --project-local` (also accepts `--user` or `--project-shared`)
- Linux package build: `npm run dist:linux`
