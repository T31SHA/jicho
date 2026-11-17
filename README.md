# Jicho

![Jicho mascot](docs/mascot.png)

Jicho (Swahili for “eye”) is a free, MIT-licensed desktop companion for Claude Code. It shows permission requests in a small on-screen window and can send approval alerts to your phone.

Jicho does not call AI models and has no telemetry. When phone approvals are enabled, its only runtime network connection is to [ntfy.sh](https://ntfy.sh).

## Verification snapshot

The last recorded live Claude Code approval test passed on Linux x86_64 with Claude Code `2.1.325`. The current host reports kernel `7.0.0-43-generic`, Node.js `v22.23.2`, and Electron `45.3.3`. The local automated harness passes; Windows/macOS CI and real phone delivery have not been run for this final polish.

## 60-second quickstart

Prerequisites: Node.js/npm and the Claude Code CLI. Start from a checkout of this repository.

In a terminal at the project root:

```sh
npm install
npm run jicho -- install
npm start
```

Review the installer diff and confirm it before it changes `~/.claude/settings.json`. It saves a timestamped backup, provisions one installation credential, and installs a small credential-aware hook helper under `~/.jicho/hooks/`. Jicho opens its small eye window; on first run it also shows phone pairing. Phone alerts are off until you enable them.

In another terminal, start a **fresh** Claude Code session with `claude`, either directly or in your IDE’s integrated terminal. Ask Claude to do something that requires permission. Jicho shows the session folder, tool, and raw command with Allow, Deny, and Always buttons.

The default installer uses your user settings at `~/.claude/settings.json`. To scope the hooks to this project only, use `npm run jicho -- install --project-local`; it writes `.claude/settings.local.json` in the current directory. Because Jicho creates that file by hand, ensure Git ignores it. For an intentional shared project configuration, use `--project-shared`; review the displayed scope warning before accepting because the file can be committed for collaborators. `--user` selects the default explicitly. Use the same flag with `status` and `uninstall` to inspect or remove that scope. Claude Code honors `CLAUDE_CONFIG_DIR` for user settings.

To remove the user-level hooks later, run `npm run jicho -- uninstall`. To check installation and credential status, run `npm run jicho -- status`.

## What works

- Claude Code running in a terminal or IDE terminal, through authenticated command hooks.
- A local desktop approval card, exact-response routing, a request queue, and timeout fall-through to Claude’s own dialog.
- A separate command centre with persisted session history, observed Claude hook events, risk-labeled approval cards, and a source-labeled activity timeline.
- Optional phone approvals through ntfy. The QR code pairs with the topic; Android can open it directly, while iPhone users can add the topic in ntfy.
- Optional start-at-login, a tray menu, and a deterministic safe-command allowlist that is off by default.
- `npm run jicho -- doctor` checks the loopback port, Claude Code version, credential store read/write, signed wrapper acceptance, held-and-settled fake permission request, and installed hooks. It also prints cold wrapper timings per configured event.
- Only `PermissionRequest` runs synchronously. The other installed command hooks use Claude Code's `async: true` support and record observations without blocking the agent.
- The desktop mascot reflects pending, working, recently stopped, offline, and idle states. Sessions idle for more than 30 minutes expire from the active session list.
- The desktop hides **Always** when the request is outside the safe allowlist. Risk-flagged commands require a 700 ms hold to allow; Escape denies, and Ctrl/Cmd+Enter allows only unflagged requests.

The installer configures command hooks for PermissionRequest, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Stop, Notification, SubagentStart, SubagentStop, and SessionEnd. Claude sends command-hook JSON on stdin and reads the same JSON decision schema used by HTTP hooks from stdout. The wrapper signs the original bytes and relays the server's response unchanged. The current [Claude Code hooks reference](https://code.claude.com/docs/en/hooks) supports only command and MCP hooks for SessionStart, so Jicho does not register that event. A session first appears when Jicho receives a supported event. Only PermissionRequest carries a Jicho approval card; the other configured hooks are recorded as observations.

Jicho can decide only requests Claude Code sends through `PermissionRequest`. Claude Auto mode or an existing allow rule can run a tool without that request; Jicho's `PreToolUse` hook observes the call but currently does not block it. Choose Claude's permission mode with that boundary in mind.

The tested live integration is limited to Linux x86_64 and Claude Code `2.1.325`; see [DEMO.md](DEMO.md) for the stage flow and recovery plan.

## What does not work

- Claude Desktop’s Code tab.
- Cursor.
- Codex.
- Native mobile apps or other agent integrations.

Those adapters are planned, not implemented.

Windows and macOS builds, native credential stores on those systems, and delivery to a real phone have not been verified. The GitHub Actions matrix is present but has not run.

## Phone pairing

Open the pairing panel from the mascot or tray. Scan the QR code with ntfy on Android, or subscribe to the displayed topic in ntfy on iPhone. Enable **Phone approvals** to start alerts. Content-free alerts hide the request details and provide a Deny-only **Review on desktop** notification. Set `JICHO_NTFY_URL` before starting Jicho to use a self-hosted HTTP or HTTPS ntfy server.

Phone notifications show command previews with both the head and tail when needed. Truncated, risk-flagged, and content-free requests never include an Allow action; review them on the desktop.

**The topic is the password.** Anyone who knows it can read its ntfy messages, so keep it private and do not post screenshots of the pairing panel. Phone actions send a signed reply to a separate reply topic; Jicho checks its local HMAC secret before applying an answer.

## Hook authentication and recovery

The installer generates a 256-bit credential once per Jicho installation. It prefers Linux Secret Service through `secret-tool`, macOS Keychain through `security`, or Windows Credential Manager through the Windows credential API. Linux and macOS can use an owner-only credential file if their native store is unavailable. Windows stays fail-closed by default; `npm run jicho -- doctor --allow-file-credential` explicitly opts into a Windows file protected by a verified owner-only ACL. File fallback is weaker because other processes running as your account can read the credential. Windows and macOS native-store behavior and Windows ACLs have not been tested on those operating systems.

Claude settings contain only `node "$HOME/.jicho/hooks/hook.js"`; they never contain the credential. Shared project settings use the current user's home directory, so each collaborator must install Jicho locally to provision their own credential and helper. The generated hook command is machine-portable and does not share authentication material.

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
- Phone alerts redact common token and key patterns and environment-style assignments. Truncated previews show the head and tail with a middle ellipsis; truncation, any risk flag, or Content-free mode removes Allow and directs the user to the desktop. Redaction is heuristic; use Content-free alerts when command text should not leave the computer.
- Session, event, approval, decision, and audit history is stored in a versioned SQLite database in Jicho’s local application-data directory. Commands and relevant paths from tool and permission events can be persisted there; prompt text and tool output are omitted. The database is not encrypted, so protect the OS account and local data directory. POSIX database files are restricted to owner access; Windows uses the application-data directory’s OS ACLs.
- The separate JSONL audit log stores decision metadata and risk flags, not raw command text.
- The auto-allow policy is off by default. When enabled, it allows exact read-only `Read`, `Glob`, and `Grep` requests within the session folder, plus a small set of exact `git status`, `git diff`, and `git log` commands. Chaining, redirection, and flagged commands require review. “Always” enables only this built-in safe policy; it does not remember an arbitrary command.
- Jicho uses deterministic rules only. It does not judge commands with a model, phone home, or collect telemetry.

## Demo and verification

With the desktop app running, open another terminal and run:

```sh
npm run demo
```

Three fake sessions send permission requests at once. Answer the cards in the overlay or on the phone; each fake session prints the reply it received. The demo does not execute the displayed commands. See [DEMO.md](DEMO.md) for the 90-second stage script and recovery steps.

To check a real Claude Code installation, stop the desktop app first, then run:

```sh
npm run verify
```

The guided verifier prints the installed Claude Code version and tells you to start a manual-mode Claude session using only the selected settings scope. It asks you to make real allow and deny requests, confirms that Claude honored each answer, and waits for the session-end hook before shutting down. It removes its temporary test files. Jicho itself does not invoke an AI model; the real prompts are issued by the Claude Code CLI you start.

For a project-local setup, run `npm run verify -- --project-local`. The verifier checks that project's `.claude/settings.local.json` and prints the matching install command if needed. Run it from the project directory where you start Claude Code.

Run the local automated harness with `npm test` (26 checks pass on the recorded Linux host). To exercise the actual Claude CLI command-hook path, run `npm run test:claude-auth`; it uses two prompts, creates one temporary allowed marker, verifies that a denied marker stays absent, and checks SessionEnd. It requires an authenticated Claude CLI and may use your Claude account. The GitHub Actions workflow and its Windows/macOS packaging jobs remain unverified until CI runs.

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
