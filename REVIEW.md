# Jicho audit (against the GitHub state, 10 commits)

Verified by running: 9/9 tests pass; Electron launches headless on Linux; mascot renders.
NOT verified: any real Claude Code run, macOS, Windows, ntfy delivery to a phone.

## Fix before Saturday (security)
1. Server accepted any POST on localhost: no Origin/Host check, no body limit. (Codex's newer commit "Reject browser-originated hook traffic" + HMAC addresses this. Confirm both are on master.)
2. Phone: commands over 120 chars are cut and the tail is hidden, yet Approve is offered. Padding + `&& rm -rf ~` slips through. Show head AND tail; no Approve button when truncated or risk-flagged.
3. Phone "content-free" mode offers Approve with no command shown = blind approval. Deny-only in that mode.
4. Allowlist auto-allows Read of secret-looking files inside the repo (id_rsa, .npmrc, .pem, .aws, .netrc, .git/config). Add a secret-file risk flag.

## Fix before Saturday (UX)
5. "Always" button is dead on most cards (works only for allowlistable reads). Hide it unless it can work.
6. One click approves a flagged `rm -rf`. Require press-and-hold for flagged commands.
7. No Content-Security-Policy in the renderer.
8. Character is a generic eyeball. Use the mascot pack.

## Design notes
- SessionStart HTTP hooks are documented command-only and reported to silently fail; the new command-wrapper design avoids that.
- PostToolUse clears ALL pending cards of a session (parallel tool calls): safe (falls back to Claude's own dialog) but the card can vanish early.
- Claude auto mode can skip PermissionRequest hooks: never demo in auto mode.
