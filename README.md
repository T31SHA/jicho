# Jicho

Jicho (Swahili for “eye”) is a free, MIT-licensed desktop companion for Claude Code. It shows permission requests in a small on-screen window and can send approval alerts to your phone.

Jicho does not call AI models and has no telemetry. When phone approvals are enabled, its only runtime network connection is to [ntfy.sh](https://ntfy.sh).

## 60-second quickstart

Prerequisites: Node.js/npm and the Claude Code CLI. Start from a checkout of this repository.

In a terminal at the project root:

```sh
npm install
npm run jicho -- install
npm start
```

Review the installer diff and confirm it before it changes `~/.claude/settings.json`. It saves a timestamped backup. Jicho opens its small eye window; on first run it also shows phone pairing. Phone alerts are off until you enable them.

In another terminal, start a **fresh** Claude Code session with `claude`, either directly or in your IDE’s integrated terminal. Ask Claude to do something that requires permission. Jicho shows the session folder, tool, and raw command with Allow, Deny, and Always buttons.

To remove the hooks later, run `npm run jicho -- uninstall`. To check installation, run `npm run jicho -- status`.

## What works

- Claude Code running in a terminal or IDE terminal, through its HTTP hooks.
- A local desktop approval card, exact-response routing, a request queue, and timeout fall-through to Claude’s own dialog.
- A separate command centre with persisted session history, observed Claude hook events, risk-labeled approval cards, and a source-labeled activity timeline.
- Optional phone approvals through ntfy. The QR code pairs with the topic; Android can open it directly, while iPhone users can add the topic in ntfy.
- Optional start-at-login, a tray menu, and a deterministic safe-command allowlist that is off by default.

The installer configures HTTP hooks for PermissionRequest, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Stop, Notification, SubagentStart, SubagentStop, and SessionEnd. The current [Claude Code hooks reference](https://code.claude.com/docs/en/hooks) supports only command and MCP hooks for SessionStart, so Jicho does not register an HTTP hook for that event. A session first appears when Jicho receives a supported event. Only PermissionRequest carries a Jicho approval card; the other configured hooks are recorded as observations.

## What does not work

- Claude Desktop’s Code tab.
- Cursor.
- Codex.
- Native mobile apps or other agent integrations.

Those adapters are planned, not implemented.

## Phone pairing

Open the pairing panel from the eye or tray. Scan the QR code with ntfy on Android, or subscribe to the displayed topic in ntfy on iPhone. Enable **Phone approvals** to start alerts. You can enable **Content-free alerts** to send only “Approval needed.”

**The topic is the password.** Anyone who knows it can read its ntfy messages, so keep it private and do not post screenshots of the pairing panel. Phone actions send a signed reply to a separate reply topic; Jicho checks its local HMAC secret before applying an answer.

## Security model

- The hook server listens only on `127.0.0.1:47821`; it is not exposed on your network. `JICHO_TOKEN` is optional. If set, give the same token to the environment that launches Jicho and Claude Code.
- Hook requests over 1 MiB, malformed JSON, and requests without a valid session ID are rejected or returned without a decision. Safe auto-allow applies only after Jicho has observed a user prompt in that session during the current process lifetime.
- Each PermissionRequest holds one HTTP response. Allow or Deny settles that exact response. A stale or unrelated answer cannot approve another request. If a request times out, Jicho sends no decision and Claude can show its own dialog.
- The desktop card displays the raw command without summarizing or redacting it. Keep the screen private if commands may contain secrets.
- The command centre shows bounded command/path evidence in local history. It identifies Claude hook observations separately from Jicho decision records and does not create synthetic progress events.
- Phone alerts redact common token and key patterns, redact environment-style assignments, and truncate command text to 120 characters. This is heuristic; use Content-free alerts when command text should not leave the computer.
- Session, event, approval, decision, and audit history is stored in a versioned SQLite database in Jicho’s local application-data directory. Commands and relevant paths from tool and permission events can be persisted there; prompt text and tool output are omitted. The database is not encrypted, so protect the OS account and local data directory. POSIX database files are restricted to owner access; Windows uses the application-data directory’s OS ACLs.
- The separate JSONL audit log stores decision metadata and risk flags, not raw command text.
- The auto-allow policy is off by default. When enabled, it allows exact read-only `Read`, `Glob`, and `Grep` requests within the session folder, plus a small set of exact `git status`, `git diff`, and `git log` commands. Chaining, redirection, and flagged commands require review. “Always” enables only this built-in safe policy; it does not remember an arbitrary command.
- Jicho uses deterministic rules only. It does not judge commands with a model, phone home, or collect telemetry.

## Demo and verification

With the desktop app running, open another terminal and run:

```sh
npm run demo
```

Three fake sessions send permission requests at once. Answer the cards in the overlay; each fake session prints the reply it received. The demo does not execute the displayed commands.

To check a real Claude Code installation, stop the desktop app first, then run:

```sh
npm run verify
```

The guided verifier prints the installed Claude Code version and asks you to make real allow and deny requests in another terminal. It reports whether Claude honored each answer and removes its temporary test files. Jicho itself does not invoke an AI model; the real prompts are issued by the Claude Code CLI you start.

Run the automated harness with `npm test`.

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
