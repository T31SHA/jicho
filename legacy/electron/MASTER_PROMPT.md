# JICHO — MASTER BUILD PROMPT (paste into Codex or Claude Code, in the repo root)

You are building **Jicho** ("eye" in Swahili): a free, MIT-licensed desktop companion that watches coding agents and lets the user approve permission requests from a small on-screen bot or from their phone. Hackathon demo is Saturday 08:00. Reliability beats features. Work in the order below, run `npm test` after every step, and commit after every step.

## Hard constraints
- Zero paid APIs. Never call any AI model. No telemetry. Only outbound network allowed: the ntfy server.
- Windows, macOS, Linux. Develop on Linux; keep code portable (os.homedir, path.join, no shell-only tricks).
- Never block the agent: if Jicho is down or errors, the agent must behave as if Jicho is not installed.
- No transparent full-screen or click-through windows (setIgnoreMouseEvents is unreliable on Linux). The overlay is a small solid window.
- Do not claim a step is done until you ran it. If something is unverified, say so in the commit message.

## Already exists (do not regress)
`src/core.js`, `src/server.js`, `test/harness.js`. Design rule: each approval request is ONE open HTTP response; answering writes to that exact response, so a wrong-session answer is impossible. Resolve-elsewhere (PostToolUse/Stop/SessionEnd or connection close) clears the card and returns `{}`. Timeout returns `{}` so Claude shows its own dialog. Allow/deny reply shape: `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"|"deny","message":"..."}}}`. A wrong shape is silently ignored, so verify against the installed Claude Code (step 3).

## Steps
1. **Electron overlay** (`src/main.js`, `src/ui/`). Small frameless always-on-top window, bottom-center of the primary display workArea, `showInactive()`, never steals focus. Idle: a ~56px eye character (CSS/SVG, no image assets) that blinks. Working: calm pulse. Needs-you: turns amber and the window expands into the approval card. Pupil follows the cursor via `screen.getCursorScreenPoint()`; if it returns 0,0 (Wayland) disable tracking silently. Card shows session folder, tool name, and the **raw command in monospace, never summarized**, plus Allow / Deny / Always, a queue badge ("+2 waiting"), and a generated WebAudio chime (no audio files). One card per request; answering one never affects another.
2. **Installer CLI** (`bin/jicho.js`: install | uninstall | status). Back up `~/.claude/settings.json`, merge HTTP hooks (`type:"http"`, `url:"http://127.0.0.1:47821"`, `timeout:120`) for PermissionRequest, PostToolUse, Stop, UserPromptSubmit, SessionEnd. The current Claude Code reference does not support HTTP for SessionStart; do not register that event as HTTP. Print a diff and ask before writing. Idempotent. Uninstall removes only Jicho's entries. Test on a temp HOME.
3. **Real verification** (`npm run verify`): guided script that starts the core, tells the user to run a real Claude Code prompt that needs permission, and prints whether the allow/deny reply was honored. Report the Claude Code version.
4. **Phone via ntfy**. On first run generate a 128-bit random topic. Publish each request with Approve/Deny http-action buttons that POST `id:decision:hmac` to a reply topic; subscribe to the reply topic and verify the HMAC (secret kept locally) before settling. Redact secrets (tokens, keys, `.env` values) and truncate to 120 chars; setting "content-free alerts" sends only "approval needed". Show a QR code of the topic for pairing. The topic is the password, so say so in the UI and README. Check ntfy's current docs for action syntax and rate limits before coding.
5. **Allowlist and risk flags**, deterministic only. OFF by default. Auto-allow only anchored exact patterns for read-only tools and `git status|diff|log`, and refuse anything containing `; && || | $( ` > <` (no chaining). Red-flag `rm -rf`, `curl|sh`, `sudo`, `git push --force`, `.env`, `chmod 777`. Append every decision to a JSONL audit log in the app data dir.
6. **Polish**: tray icon with quit, single-instance lock, autostart toggle, port-conflict message, optional `JICHO_TOKEN`.
7. **Demo mode** (`npm run demo`): spawns 3 fake sessions that fire permission requests concurrently so the stage demo is repeatable. Each fake session reports what answer it received.
8. **Tests**: keep the 4 harness tests; add allowlist-chaining, HMAC, installer idempotence, and 20-concurrent-request tests.
9. **Packaging**: electron-builder for win (nsis), mac (dmg), linux (AppImage, deb). Unsigned; README explains SmartScreen/Gatekeeper warnings.
10. **README**: 60-second quickstart, what works (Claude Code in terminal/IDE terminal), what does not (Claude Desktop Code tab, Cursor, Codex: planned), security model, MIT license.

## Out of scope
Chat, integrations, mascots beyond the eye, native mobile app, Codex/Cursor adapters, LLM judging.
