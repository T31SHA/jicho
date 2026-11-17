# Jicho 90-second demo

## Before the stage

- Use a machine with Claude Code installed and logged in, Jicho's desktop app available, and the phone paired to the configured ntfy server.
- In a terminal at the repository root, run `npm run jicho -- install` and accept the reviewed settings change. Then run `npm run jicho -- doctor`; resolve any FAIL before presenting.
- Start the app with `npm start`. In Phone and safety settings, enable phone alerts and keep Content-free alerts off for this demo. Use manual permission mode in any real Claude sessions.

## Stage script

| Time | Action |
| --- | --- |
| 0:00–0:12 | Show `npm run jicho -- doctor` and its PASS checks. Explain that the helper signs local hook requests and that Jicho does not call an AI model or collect telemetry. |
| 0:12–0:25 | Run `npm run demo`. Three fake sessions send permission requests concurrently; the demo does not execute their displayed commands. |
| 0:25–0:43 | Allow one request from the desktop card. Point out the matching session reply in the terminal. |
| 0:43–1:00 | Approve a second request from the phone notification. Show its matching reply in the terminal. |
| 1:00–1:12 | Deny the remaining request from the desktop and show its `DENY` reply. |
| 1:12–1:30 | Open the command centre Activity timeline and show the decisions. If useful, open `audit.jsonl` from Electron's user-data directory. |

The audit file is `audit.jsonl` under Electron's `app.getPath('userData')`; common defaults are `~/.config/jicho/audit.jsonl` on Linux, `~/Library/Application Support/jicho/audit.jsonl` on macOS, and `%APPDATA%\jicho\audit.jsonl` on Windows.

## Recovery if phone or network fails

- If the phone notification does not arrive, answer that request on its desktop card. Phone delivery is optional; desktop approval uses the local loopback server.
- If ntfy is unreachable, continue the demo from the desktop and show the connection status in Phone and safety settings. Reconnect later or set `JICHO_NTFY_URL` to a reachable self-hosted ntfy server.
- If a request expires before it is answered, Jicho returns control to Claude Code's native permission prompt. For the fake demo, rerun `npm run demo` after restoring the desktop app.
- If the desktop app or local server fails, stop the stage flow and use Claude Code's native prompt; do not ask the phone to approve a request that is no longer pending.
