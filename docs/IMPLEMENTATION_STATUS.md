# JICHO Implementation Status

**Updated:** 2026-11-17

**Implementation base:** Through authenticated Claude command-hook verification (2026-11-17)

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

## Real Claude integration verification

- The guided verifier now starts Claude in explicit `manual` permission mode and limits settings to the selected scope (`user`, `local`, or `project`). This avoids a false “permission request missing” result when Claude is in Auto mode.
- After allow and deny are confirmed, the verifier waits for the verified session's `SessionEnd` event before closing its HTTP server. It reports and times out clearly if Claude is not exited.
- Verified a real Claude Code 2.1.325 CLI session using a temporary `.claude/settings.local.json`, Bash only, and JICHO's loopback verifier: a genuine `PermissionRequest` arrived; Allow created the exact marker; Deny prevented the second marker; Claude emitted `SessionEnd` before the verifier exited successfully.
- A first isolated run in Auto mode showed `PreToolUse` but no `PermissionRequest`; Claude ran the marker command without an approval. That marker was removed. This confirms JICHO only decides requests Claude surfaces and does not block Auto-mode actions.
- The temporary project and hook config were removed; user-level JICHO status remains uninstalled. Claude Code's built-in updater moved the CLI from 2.1.319 to 2.1.325 during the first test session; the CLI also wrote its normal local transcript/debug records.

## Linux Wayland GUI smoke

- Launched the real Electron app in the current GNOME Wayland session with isolated `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` under `/tmp`.
- The companion renderer loaded, its `openCommandCentre` IPC returned true, and the command-centre window loaded the live SQLite/server snapshot. A local DevTools screenshot captured the command-centre viewport.
- The host's bundled Electron `chrome-sandbox` is not root-owned/setuid and unprivileged user namespaces are unavailable, so the GUI smoke required Electron's testing-only `--no-sandbox` flag. The app's BrowserWindows still declare renderer `sandbox: true` and context isolation, but this run does not validate Chromium OS sandboxing.
- Electron emitted a Wayland/Vulkan incompatibility warning but rendered both windows. The app process, temporary data, and screenshots were removed afterward; no user-level Claude settings were changed.

## Local hook ingress hardening (2026-11-16; superseded by the authentication milestone below)

- The loopback server now requires the exact `127.0.0.1:<listening-port>` Host header and rejects requests with browser Origin/Referer metadata or cross-site Fetch Metadata before parsing or storing the body.
- Added live HTTP regression checks for a hostile Origin, a DNS-rebinding Host, and cross-site Fetch Metadata. All are rejected before creating a session or recording an event.
- At that point the ingress still allowed unsigned native callers unless `JICHO_TOKEN` was configured. The 2026-11-17 milestone below replaces that protocol.

## Secure Claude hook authentication milestone (2026-11-17)

- Replaced JICHO's Claude HTTP hook entries with synchronous command hooks. The helper reads Claude's JSON from stdin, signs the exact original bytes, calls the loopback server, and writes the server's existing hook-response JSON back unchanged. `PermissionRequest` response correlation and decision semantics are unchanged.
- Added a one-time 256-bit credential and stable random installation identity. Linux uses Secret Service through `secret-tool` when available, macOS uses Keychain through `security`, and Windows uses the Windows Credential Manager API. The verified Linux host has no `secret-tool`, so this run used an owner-only file fallback under the Jicho config directory. macOS and Windows native-store behavior remains unverified; Windows setup fails closed if Credential Manager is unavailable.
- The installer places the helper under `~/.jicho/hooks/`. Claude settings refer to it through `$HOME` and contain no personal key or token. User, project-local, and shared-project settings remain supported. Collaborators using shared settings must install their own helper and credential.
- The signed canonical form includes protocol version, method/path, installation ID, millisecond timestamp, 24-byte nonce, SHA-256 of the exact body bytes, and a session-ID SHA-256 binding. The server checks a 30-second time window, validates event/session shape and body size, compares HMAC-SHA256 in constant time, and records each nonce once in SQLite before handling the event. SQLite schema v2 preserves replay rejection across app restarts.
- Added credential status, rotation, and revocation commands. Startup does not silently create or replace a missing credential. Rotation changes the active key on the next request; revocation rejects later hook requests. Already received pending approvals retain their existing lifecycle.
- Same-user native processes remain in scope as a residual risk: a process running as the Jicho user's account can invoke the installed helper or access a same-user credential store. The MAC authenticates possession of the installation key, not Claude Code's OS process identity. SQLite remains unencrypted.
- Verified actual Claude Code `2.1.325` with isolated project-local settings, the command wrapper, and a local authenticated server. Allow created its marker, Deny left its marker absent, and SessionEnd was received. This bounded smoke test does not establish universal interception or production readiness.
- Added coverage for missing credentials, signature/body tampering, expiry, replay, wrong installation/session scope, durable replay across restart, credential restart/rotation/revocation, concurrent signed approvals, wrapper response relay, shared-settings secrecy, and installer idempotency.

## Verification

Environment: Linux x64, Node.js `v22.23.2`, npm `10.9.8`, Electron `45.3.3`, better-sqlite3 `13.2.0`, Claude Code `2.1.325` after its built-in update.

| Check | Result | Limits |
| --- | --- | --- |
| Original repository baseline | PASS, 9 checks | Baseline predates the ingress hardening and SQLite work. |
| Current `npm test` | PASS, 23 checks | Local loopback and SQLite harness; not an external integration test. Covers authenticated 20-way routing, bad/stale/replayed requests, durable replay, credential lifecycle, wrapper response relay, approval integrity, installer scopes, expiry, restart recovery, persistence failure, IPC sender checks, and browser-origin/Host rejection. |
| Claude settings-scope install/uninstall | PASS | Automated isolated temporary-project check verifies local-scope write, backup, preservation, and removal. It does not edit the user's Claude configuration or prove Claude loaded the file. |
| Claude Code live hook, earlier baseline | PASS, Claude Code 2.1.325 | Earlier real CLI HTTP-hook test confirmed PermissionRequest Allow/Deny and SessionEnd; Auto mode separately executed without PermissionRequest. |
| Authenticated command-hook smoke | PASS, Claude Code 2.1.325 | `npm run test:claude-auth` used temporary settings and marker files, confirmed the signed wrapper reached the server, Allow created its marker, Deny left its marker absent, and SessionEnd arrived. It does not test Electron desktop-card delivery or OS keychain ACL prompts. |
| Linux Wayland GUI smoke | PASS, partial | Real Electron app launched; companion page rendered; command-centre IPC opened a second window; live empty-state dashboard rendered. Run used `--no-sandbox` because the host sandbox prerequisites are unavailable. Window geometry/dragging, native approval cards, tray, shortcut, and X11 remain unverified. |
| Command-centre Electron smoke | PASS | Headless Electron 45 loaded the local page and sandboxed preload; a simulated IPC snapshot rendered session/approval data and the Approve button reached the mocked IPC handler. This is UI-only evidence, not an agent integration test. |
| `npm run dist:linux` | PASS | Built Linux x64 AppImage and Debian package with the command-centre assets, Electron 45, and rebuilt SQLite native module. Artifacts were not installed or launched. |
| Full `npm audit` after Electron upgrade | 6 moderate, 0 high, 0 critical | Remaining findings are development/package-build dependencies (`electron-builder` / `minimatch`); no production dependency findings. |
| `npm audit --omit=dev` | 0 findings | Runtime dependency tree only. |
| Claude Code | Verified for request decisions and SessionEnd | Claude Code `2.1.325` sent a real PermissionRequest in a temporary project; allow/deny outcomes and SessionEnd were confirmed. User-level hooks remain uninstalled. Timeout, crash, and desktop-card behavior remain unverified. |
| Electron GUI / display behavior | Partial | Real GNOME Wayland launch, companion renderer, command-centre IPC, and dashboard render passed with `--no-sandbox`; native window positioning, X11, and tray interactions remain unverified. |
| Windows / macOS / Android / iOS | Unverified or not implemented | No builds or device tests were performed. |

## Current capability matrix

| Area | Status |
| --- | --- |
| Approval routing | Implemented in the Node core; each decision remains bound to its original held hook response. |
| Local persistence | Implemented for sessions, hook observations, approval states, decisions, audit metadata, and replay nonces; SQLite schema is v2. |
| Restart behavior | Pending requests are durably marked failed and never re-presented as approvable; a fresh hook event is needed before safe auto-allow is eligible. |
| Claude Code | Authenticated command hooks and scope-aware installer. Allow, deny, and SessionEnd verified against Claude Code 2.1.325 through the signed wrapper. Timeout, crash, other hook schemas, and desktop-card delivery remain unverified. |
| Desktop | Electron companion and initial command centre are implemented. Renderer and IPC smoke passed with both a simulated snapshot and a real Wayland Electron launch. Native Wayland positioning/resize, tray, shortcut, real approval-card delivery, and X11 remain unverified. |
| Linux packaging | x64 AppImage and Debian package build passed with Electron 45 / SQLite 13.2; artifacts were not installed or launched. |
| Phone | Optional ntfy bridge only; no first-party paired device protocol. |
| Codex / Cursor | Not implemented. |
| Native Android / iOS, relay, push services | Not implemented. |
| CI/CD, signing, retention controls | Not implemented. |

## Known security and product limitations

- The loopback ingress requires per-installation HMAC authentication, freshness, session binding, and one-use nonces. A malicious process running as the same OS user can invoke the installed helper or access that user's credential store, so this does not establish Claude process identity.
- Linux Secret Service and macOS Keychain integrations, Windows Credential Manager integration, Windows permissions, and macOS credential prompts are unverified on this Linux host. The active Linux test used the documented owner-only file fallback because `secret-tool` was unavailable.
- SQLite is not encrypted. Permission action details and bounded command/path observations can include sensitive information; database backup, retention, and secure deletion controls are not implemented. Failure events retain only an error-present flag and an exit code when parseable, not raw error output.
- No first-party remote approval protocol exists. ntfy remains a third-party shared-topic path whose service can read notification content and signed action values.
- `PermissionRequest` input has no `tool_use_id` in the current Claude reference. Some same-session terminal/tool completion events therefore cannot be correlated more finely than the session.
- Claude Auto mode can run a tool without emitting `PermissionRequest`. The `PreToolUse` command hook is currently observation-only, so JICHO does not block those Auto-mode actions; approval control applies only when Claude asks for a permission decision.
- Native Wayland has not been verified for companion positioning or resizing. Electron documents restrictions on programmatic window placement, resizing, and focus under Wayland; Jicho's `placeWindow()` depends on `setBounds()`, so those behaviors need compositor testing or a platform-specific fallback.
- `PostToolUse`, `Stop`, and `SessionEnd` resolve outstanding same-session requests as superseded; adapters with concurrent requests within one session need richer source correlation before generalization.
- The command centre currently has overview/session/activity/approval views; no task verification, independent diff/test verification, full settings center, or Codex/Cursor view is implemented. Stored source events are evidence records, not generated progress summaries.
- Full `npm audit` still reports six moderate findings in Electron packaging dependencies; they are development-only and should be revisited before release.
- There has been no independent security review, real-device approval test, Windows/macOS build, X11 GUI test, or native Wayland geometry/tray verification.

## Next implementation units

1. Verify native credential-store behavior, permissions, rotation, and recovery on macOS and Windows, exercise Linux with an unlocked Secret Service, and test packaged-helper installation on each desktop OS.
2. Verify command-hook timeout, connection failure, duplicate/out-of-order events, and native permission fallback against a real CLI; test Electron desktop-card delivery separately.
3. Add retention and export/backup policy for local SQLite history and controls for keeping or removing sensitive history.
4. Review Codex App Server and Cursor Hooks official protocols before implementing their adapter contracts.
5. Design first-party device identity, pairing, relay, push, and replay-safe remote approvals before building mobile clients.
6. Test the floating companion and packaging separately on Windows, macOS, Android, and iOS where the required hosts/devices exist.

## Commands

- Core and store harness: `npm test`
- Live Claude command-hook authentication smoke: `npm run test:claude-auth` (uses the configured Claude CLI account and temporary marker files)
- Desktop app: `npm start`
- Local core: `npm run core`
- Fake concurrent demo: `npm run demo`
- Real Claude allow/deny verifier: `npm run verify`
- Claude user settings: `npm run jicho -- install|status|uninstall --user` (default)
- Claude project-local settings: `npm run jicho -- install|status|uninstall --project-local`
- Claude shared project settings: `npm run jicho -- install|status|uninstall --project-shared`
- Hook credential status, rotation, and revocation: `npm run jicho -- credential status|rotate|revoke`
- Real verifier scope: `npm run verify -- --project-local` (also accepts `--user` or `--project-shared`)
- Linux package build: `npm run dist:linux`
