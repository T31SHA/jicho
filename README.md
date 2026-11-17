# Jicho

![Jicho mascot](docs/mascot.png)

Jicho (Swahili for “eye”) is a free, MIT-licensed desktop companion for coding agents. Claude Code can send permission requests for approval; Codex CLI has an implemented but unverified hook path; Cursor currently provides authenticated activity observations only.

Jicho does not call AI models and has no telemetry. Optional ntfy alerts contain only a generic notice and no approval actions; enabling them sends that notice to the configured ntfy service.

## Verification snapshot

The authenticated Claude Code allow/deny flow passed on Linux x86_64 with Claude Code `2.1.325`. Codex CLI `0.169.0` is installed, but its real-agent smoke timed out before hooks ran. Cursor `3.17.19` is installed, but no live Cursor agent session has been verified. The current host reports kernel `7.0.0-43-generic`, Node.js `v22.23.2`, and Electron `45.3.3`. Windows/macOS CI and native phone apps have not been built.

## 60-second quickstart

Prerequisites: Node.js/npm and the Claude Code CLI. Start from a checkout of this repository.

In a terminal at the project root:

```sh
npm install
npm run jicho -- install
npm start
```

Review the installer diff and confirm it before it changes `~/.claude/settings.json`. It saves a timestamped backup, provisions one installation credential, and installs a small credential-aware hook helper under `~/.jicho/hooks/`. Jicho opens its compact top-edge mascot island; hover, click, or observed agent activity expands it. The initial run also offers optional generic ntfy alerts. Alerts are off until you enable them.

In another terminal, start a **fresh** Claude Code session with `claude`, either directly or in your IDE’s integrated terminal. Ask Claude to do something that requires permission. Jicho shows the session folder, tool, and raw command with Allow, Deny, and Always buttons.

The default installer uses your user settings at `~/.claude/settings.json`. To scope the hooks to this project only, use `npm run jicho -- install --project-local`; it writes `.claude/settings.local.json` in the current directory. Because Jicho creates that file by hand, ensure Git ignores it. For an intentional shared project configuration, use `--project-shared`; review the displayed scope warning before accepting because the file can be committed for collaborators. `--user` selects the default explicitly. Use the same flag with `status` and `uninstall` to inspect or remove that scope. Claude Code honors `CLAUDE_CONFIG_DIR` for user settings.

To remove the user-level hooks later, run `npm run jicho -- uninstall`. To check installation and credential status, run `npm run jicho -- status`.

## What works

- Claude Code running in a terminal or IDE terminal, through authenticated command hooks.
- A local desktop approval card, exact-response routing, a request queue, and timeout fall-through to Claude’s own dialog.
- A separate command centre with persisted session history, observed Claude hook events, risk-labeled approval cards, and a source-labeled activity timeline.
- Optional generic ntfy alerts with no project details, request IDs, credentials, or Allow/Deny actions.
- Optional start-at-login, a tray menu, and a deterministic safe-command allowlist that is off by default.
- `npm run jicho -- doctor` checks the loopback port, Claude Code version, credential store read/write, signed wrapper acceptance, held-and-settled fake permission request, and installed hooks. It also prints cold wrapper timings per configured event.
- Only `PermissionRequest` runs synchronously. The other installed command hooks use Claude Code's `async: true` support and record observations without blocking the agent.
- The desktop mascot reflects pending, working, recently stopped, offline, and idle states. Sessions idle for more than 30 minutes expire from the active session list.
- The island shows actual observed Claude hook events, the current observed tool, and file paths from supported write-tool payloads. It retains hook provenance and does not store prompt text or infer task progress.
- Codex CLI hooks report authenticated session, prompt-submission, tool, subagent, interrupt, turn, and session-end events. Its synchronous `PermissionRequest` hook is implemented for Bash and `apply_patch` using the existing Claude approval core; live Codex hook and decision behavior remain unverified.
- Cursor's documented non-gating hooks can be installed with `npm run jicho -- cursor install`; they report session lifecycle, tool success/failure, file edits, subagent completion, and turn completion. Jicho strips prompts, transcripts, user email, tool inputs/outputs, shell output, and edit contents before forwarding. Cursor permission interception and questions are unsupported; no permission-affecting Cursor hook is installed.
- Top-edge placement, display selection, drag placement, and manual horizontal/top offsets are implemented. Jicho never uses the camera to locate hardware. Native macOS notch integration and Linux Wayland placement have not been verified.
- Local reminders can flag pending approvals, reported tool failures, no later test command after an observed edit, and stale sessions. Each reminder includes evidence and confidence; none is generated by an external AI service.
- The desktop hides **Always** when the request is outside the safe allowlist. Risk-flagged commands require a 700 ms hold to allow; Escape denies, and Ctrl/Cmd+Enter allows only unflagged requests.

The Claude installer configures command hooks for SessionStart, PermissionRequest, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Stop, StopFailure, Notification, SubagentStart, SubagentStop, and SessionEnd. Claude sends command-hook JSON on stdin and reads the same JSON decision schema used by HTTP hooks from stdout. The wrapper signs the original bytes and relays the server's response unchanged. SessionStart is non-blocking; only PermissionRequest carries a Jicho approval card.

Cursor's separate user-level integration is observation-only. Install, inspect, or remove it with:

```sh
npm run jicho -- cursor install
npm run jicho -- cursor status
npm run jicho -- cursor uninstall
```

The installer shows the `~/.cursor/hooks.json` changes and asks before writing a backup and updating the file. It installs only hooks that report after an action or at session/turn boundaries. Cursor hook events use `conversation_id` as their session identity and are authenticated with the same HMAC, freshness, nonce, and session-binding checks as Claude. Permission interception, remote decisions, and interactive questions are not supported for Cursor.

Codex has a separate `~/.codex/hooks.json` integration:

```sh
npm run jicho -- codex install
npm run jicho -- codex status
npm run jicho -- codex uninstall
```

The installer shows a diff, makes a timestamped backup, and preserves unrelated hook groups. Codex may ask you to review and trust new hooks. Only `PermissionRequest` for Bash and `apply_patch` is synchronous; session and activity hooks are observational. The helper removes prompts, transcripts, model names, and tool outputs before forwarding. If Jicho is unavailable, it returns no decision so Codex can continue with its native permission prompt. Decisions are Allow or Deny; Codex “Always” behavior is not enabled.

Jicho can decide requests only when an installed adapter sends a supported synchronous `PermissionRequest`: Claude Code's hook or the unverified Codex CLI hook for Bash/`apply_patch`. Claude Auto mode or an existing allow rule can run a tool without that request; Jicho's `PreToolUse` hook observes the call but currently does not block it. Choose Claude's permission mode with that boundary in mind.

The verified live permission integration is Linux x86_64 with Claude Code `2.1.325`. Codex CLI `0.169.0` is installed and its adapter/hook path is implemented, but its live smoke could not reach the Codex service (`chatgpt.com/backend-api/ps/mcp` timed out) before hook events arrived. Cursor activity still needs a real Cursor session test. See [DEMO.md](DEMO.md) for the stage flow and recovery plan. Island visual behavior, GNOME Wayland positioning, Codex desktop loading, and actual Electron approval-card delivery remain unverified.

## What does not work

- Claude Desktop’s Code tab.
- Cursor permission interception and question answering.
- Codex desktop behavior, question answering, and remote decisions.
- Other agent integrations.
- Native mobile apps or other agent integrations.

Cursor activity observation and Codex CLI hooks are implemented but remain unverified against a live agent turn. Codex desktop behavior and the remaining adapters are also unverified.

Windows and macOS builds, native credential stores on those systems, and delivery to a real phone have not been verified. The GitHub Actions matrix is present but has not run.

## Phone alerts

Jicho can publish a generic alert to ntfy. Scan the QR code with ntfy on Android, or subscribe to the displayed topic in ntfy on iPhone. Enable **Generic phone alerts** to publish. The notification contains only “An agent is waiting. Review it in Jicho on your computer.” It does not include a project, command, request ID, or action button. Set `JICHO_NTFY_URL` before starting Jicho to use a self-hosted HTTP or HTTPS ntfy server.

This is a notification bridge, not device pairing or remote approval. The ntfy topic is a bearer subscription identifier; anyone with it can see generic notices. Do not treat it as an authentication credential. Android/iOS apps, device identity, pinned TLS, revocation, and request-bound remote decisions are not implemented.

## Hook authentication and recovery

The installer generates a 256-bit credential once per Jicho installation. It prefers Linux Secret Service through `secret-tool`, macOS Keychain through `security`, or Windows Credential Manager through the Windows credential API. Linux and macOS can use an owner-only credential file if their native store is unavailable. Windows stays fail-closed by default; `npm run jicho -- doctor --allow-file-credential` explicitly opts into a Windows file protected by a verified owner-only ACL. File fallback is weaker because other processes running as your account can read the credential. Windows and macOS native-store behavior and Windows ACLs have not been tested on those operating systems.

Claude, Cursor, and Codex settings contain only commands pointing at local helpers; they never contain the credential. Shared Claude project settings use the current user's home directory, so each collaborator must install Jicho locally to provision their own credential and helper. Cursor and Codex helpers forward only allowlisted event subsets. The generated hook commands are machine-portable and do not share authentication material.

Each hook request is authenticated with HMAC-SHA256 over a fixed canonical form: protocol version, method, path, installation ID, Unix-millisecond timestamp, random nonce, SHA-256 of the exact request bytes, and a SHA-256 binding to the session ID. The server checks the timestamp within 30 seconds, compares the MAC in constant time, validates the event/session schema, and records each nonce once in SQLite before handling the event. The SQLite history and nonce table are not encrypted.

Check and manage the credential with:

```sh
npm run jicho -- credential status
npm run jicho -- credential rotate
npm run jicho -- credential revoke
```

Rotation takes effect on the next hook request; the installation identity stays stable while the key changes. Revocation rejects new hook requests and leaves Claude's native permission flow in place. It does not cancel an approval already received by Jicho. To recover a missing or inaccessible credential, restore access to the selected OS store and run `credential rotate`; reinstall hooks with `npm run jicho -- install` if needed. Uninstalling hooks does not revoke the credential, so rotate or revoke it separately if you want to invalidate it.

## Security model

- The hook server listens only on `127.0.0.1:47821`; it is not exposed on your network. It requires the signed request protocol above, accepts only the exact loopback Host header, and rejects browser Origin/Referer and cross-site Fetch Metadata. The legacy `JICHO_TOKEN` bearer setting is no longer used.
- Authentication proves possession of the Jicho installation key through the local helper; it does not prove that the operating-system process is Claude Code. A same-user native process can invoke the helper or access a same-user credential store, and the private-file fallback is directly readable by that account. This milestone rejects unsigned, stale, replayed, modified, and incorrectly scoped requests, but it does not stop a compromised user account.
- Hook requests over 1 MiB, malformed JSON, and requests without a valid session ID are rejected or returned without a decision. Safe auto-allow applies only after Jicho has observed a user prompt in that session during the current process lifetime.
- Each PermissionRequest holds one HTTP response. Allow or Deny settles that exact response. A stale or unrelated answer cannot approve another request. If a request times out, Jicho sends no decision and Claude can show its own dialog.
- The desktop card displays the raw command without summarizing or redacting it. Keep the screen private if commands may contain secrets.
- The command centre shows bounded command/path evidence in local history. It identifies Claude hook observations separately from Jicho decision records and does not create synthetic progress events.
- ntfy receives only a generic attention notice, with no command, project, request ID, or decision action. The topic identifies the subscription but is not device authentication.
- Session, event, approval, decision, and audit history is stored in a versioned SQLite database in Jicho’s local application-data directory. Commands and relevant paths from tool and permission events can be persisted there; prompt text and tool output are omitted. The database is not encrypted, so protect the OS account and local data directory. POSIX database files are restricted to owner access; Windows uses the application-data directory’s OS ACLs.
- The separate JSONL audit log stores decision metadata and risk flags, not raw command text.
- The auto-allow policy is off by default. When enabled, it allows exact read-only `Read`, `Glob`, and `Grep` requests within the session folder, plus a small set of exact `git status`, `git diff`, and `git log` commands. Chaining, redirection, and flagged commands require review. “Always” enables only this built-in safe policy; it does not remember an arbitrary command.
- Jicho uses deterministic rules only. It does not judge commands with a model, phone home, or collect telemetry.

## Demo and verification

With the desktop app running, open another terminal and run:

```sh
npm run demo
```

Three fake sessions send permission requests at once. Answer the cards in the overlay; each fake session prints the reply it received. The demo does not execute the displayed commands. See [DEMO.md](DEMO.md) for the 90-second stage script and recovery steps.

To check a real Claude Code installation, stop the desktop app first, then run:

```sh
npm run verify
```

The guided verifier prints the installed Claude Code version and tells you to start a manual-mode Claude session using only the selected settings scope. It asks you to make real allow and deny requests, confirms that Claude honored each answer, and waits for the session-end hook before shutting down. It removes its temporary test files. Jicho itself does not invoke an AI model; the real prompts are issued by the Claude Code CLI you start.

For a project-local setup, run `npm run verify -- --project-local`. The verifier checks that project's `.claude/settings.local.json` and prints the matching install command if needed. Run it from the project directory where you start Claude Code.

Run the local automated harness with `npm test` (30 test groups pass on the current Linux host). It includes simulated Cursor/Codex hook payloads and authenticated relay checks. `npm run test:claude-auth` runs the real Claude command-hook path; `npm run test:codex-auth` runs a small real Codex task with isolated temporary settings and marker files. Both may use your signed-in agent account. Cursor has no live agent-session result. The GitHub Actions workflow and its Windows/macOS packaging jobs remain unverified until CI runs.

## Packaging

Build on the matching operating system:

```sh
npm run dist:linux  # AppImage and deb
npm run dist:win    # NSIS installer
npm run dist:mac    # DMG
```

Packages are unsigned. Windows may show a SmartScreen warning, and macOS may show a Gatekeeper warning because the builds are not signed or notarized. Review the source and obtain builds from a trusted release location before installing.

## License

[MIT](LICENSE)
