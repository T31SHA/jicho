# JichoBot — third-party agent integration

Any tool that can write to a Unix domain socket (macOS, Linux) or a named pipe (Windows) can send events to JichoBot and have its own pill next to Claude Code.

## The `jichobot_agent` field

Add the optional field `jichobot_agent` to any hook JSON payload. JichoBot will create a pill labelled with the agent name and route all events to it.

**Validation:** the name must match `^[a-z0-9-]{1,24}$` (lowercase letters, digits and hyphens, 1–24 characters). An absent or invalid name routes the event to the Claude Code pill instead.

## Hook command (macOS)

Configure your tool to call the JichoBot relay with `--agent <your-name>` after the hook executable:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "type": "command", "command": "/path/to/jichobot-hook --agent my-tool" }
    ]
  }
}
```

The shell wrapper passes `"$@"` to the Python relay, which extracts the agent name and injects it into the payload before forwarding to JichoBot.

## Hook command (Windows)

Same pattern with the Windows relay:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "type": "command", "command": "C:\\path\\to\\jichobot-hook.exe --agent my-tool" }
    ]
  }
}
```

## Hook command (Linux)

Same pattern with the Linux relay. JichoBot copies the relay to `~/.local/share/jichobot/bin/jichobot-hook` at startup.

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "type": "command", "command": "/path/to/jichobot-hook --agent my-tool" }
    ]
  }
}
```

## Payload format

The relay adds `jichobot_agent` to the JSON it forwards. You can also add it yourself if you talk to the socket directly:

```json
{
  "hook_event_name": "UserPromptSubmit",
  "session_id": "my-session-1",
  "jichobot_agent": "my-tool",
  "prompt": "Running task…"
}
```

Send newline-terminated JSON to the socket:
- **macOS (GitHub build):** `~/Library/Application Support/JichoBot/jichobot.sock`
- **macOS (App Store build):** `~/Library/Containers/org.jichobot.JichoBot/Data/jichobot.sock`
- **Windows:** `\\.\pipe\jichobot-<user-SID>`
- **Linux:** `$XDG_RUNTIME_DIR/jichobot.sock` (usually `/run/user/<uid>/jichobot.sock`). Only your own user account can connect.

The Mac relay, `jichobot-hook`, uses another socket when `JICHOBOT_SOCKET` is set. That is how an agent on a remote machine reaches the Mac through an SSH tunnel: see [`REMOTE.md`](REMOTE.md).

## Supported events

All standard Claude Code hook events are supported. `PermissionRequest` approval
cards work for Claude Code and for the agents listed as approval-capable below
(Codex, GitHub Copilot CLI, Muse Code, OpenCode, and Claude Desktop); see
`agents.rs::Agent::approvals()` and `island/agents.ts::APPROVAL_AGENTS` for the
exact, current list. A `PermissionRequest` from any other agent (including
Gemini CLI and Hermes today) is answered immediately with no decision, so the
relay writes nothing and the agent re-asks in its terminal. Antigravity and
Cursor have no `PermissionRequest` event of their own at all — see their own
sections below for how approving from the notch works for them instead.

The pill lifecycle:

| Event | Effect |
|---|---|
| `SessionStart` | Creates the pill (if absent), sets state to idle |
| `UserPromptSubmit` | State → thinking; prompt shown in ticker |
| `PreToolUse` | State → working; tool label shown in ticker |
| `PostToolUse` / `PostToolUseFailure` | State → working |
| `Notification` | Rate-limit or question state if applicable |
| `Stop` | State → finished for 5 s; active declared pills (catalog + checked in Settings) reset to idle — all others are removed |
| `StopFailure` | State → error |
| `SessionEnd` | Active declared pills (catalog + checked in Settings) reset to idle — all others are removed |
| `SubagentStart` / `SubagentStop` | Step added to ticker |

## Declared pills

A **declared pill** is a catalog entry (`PillCatalog.swift`) that has been enabled in **Settings → Active pills**. When a session ends for a declared pill, the pill stays visible and resets to idle instead of disappearing.

A catalog pill that is not checked in Settings behaves like any other agent: it gets an automatic pill when a session starts, and that pill is removed when the session ends.

The GitHub build exposes Gemini CLI (`agent_gemini`), Antigravity (`agent_antigravity`),
GitHub Copilot CLI (`agent_copilot`), Muse Code (`agent_muse`), OpenCode (`agent_opencode`),
Amp (`agent_amp`) and Hermes (`agent_hermes`) in Settings → Active pills. Codex
(`agent_codex`, GitHub build only) is there too, with real `PermissionRequest`
approval support (Allow/Deny/Always), the same as Claude Code. Cursor
(`agent_cursor`) can also be declared and set as the main pill, and on Windows
and Linux it has real approval support too (**Approve commands from the notch**,
off by default — see its own section below), the same `PreToolUse`-as-gate
mechanism as Antigravity. The macOS app does not have this for Cursor yet.

Claude Desktop (`agent_claude-desktop`, every build) is there as well. Claude Code sessions started from the Claude desktop app's Code tab carry `CLAUDE_CODE_ENTRYPOINT=claude-desktop`; the relay tags them `jichobot_agent: claude-desktop` on its own (an explicit `--agent` still wins), so nothing extra is installed. Declare the pill to keep it after the session ends; the ↗ button opens the Claude app.

## Real-world examples

### Gemini CLI (macOS)

JichoBot supports Gemini CLI out of the box via **Settings → Gemini CLI → Install hooks**.
The installer writes to `~/.gemini/settings.json` and uses `--agent gemini` so
Gemini sessions get their own pill. The relay translates Gemini event names to canonical
JichoBot events automatically.

| Gemini CLI event | Canonical event |
|---|---|
| `BeforeTool` | `PreToolUse` |
| `AfterTool` | `PostToolUse` |
| `BeforeAgent` | `UserPromptSubmit` |
| `AfterAgent` | `Stop` |

`AfterModel` is not installed — it fires on every response chunk and would flood the island.

### Antigravity — `agy` (macOS)

JichoBot supports Antigravity out of the box via **Settings → Antigravity → Install hooks**.
The installer writes to `~/.gemini/config/hooks.json` (timeouts in seconds) and uses
`--agent antigravity`. The relay translates `toolCall.name` / `conversationId` to the
island's `tool_name` / `session_id`.

| Antigravity event | Canonical event |
|---|---|
| `PreInvocation` | `UserPromptSubmit` |
| `PreToolUse` | `PreToolUse` |
| `PostToolUse` | `PostToolUse` |
| `PostInvocation` | `PostToolUse` |
| `Stop` | `Stop` |

Antigravity has no permission-request event: it runs `PreToolUse` before its own permission
check and waits for the hook's `decision` (`allow`, `deny`, `ask` or `force_ask`). By default
the relay answers `{"decision":"ask"}` at once, so Antigravity's own rules and prompt decide.

**Approve commands from the notch** (Settings → Antigravity, off by default). When it is on,
a `run_command` that none of Antigravity's `command(...)` rules covers waits for the approval
card instead. JichoBot reads those rules from `~/.gemini/antigravity-cli/settings.json`
(`permissions`), `~/.gemini/config/config.json` (`globalPermissionGrants`) and the project in
`~/.gemini/config/projects/` that holds the session's folder. A command those rules allow or
deny gets no card: Antigravity applies its rule.

| On the card | The hook prints |
|---|---|
| **Allow** | `{"decision":"allow"}` — this one command runs |
| **Deny** | `{"decision":"deny","reason":"Denied from JichoBot"}` |
| **Reply in terminal** | `{"decision":"ask"}` — Antigravity shows its own prompt (where *Always allow* lives) |
| No click in 110 s, JichoBot closed or hung, card full | `{"decision":"ask"}` |

The relay sends the payload tagged `jichobot_kind: agy_pre_tool` and reads one line back:
`{"permissionDecision":"ask"}` right away, or `{"pending":true}` once the card is up and then
the decision. It waits 3 s for the first line and 115 s for the decision; the `PreToolUse`
hook is installed with a 120 s timeout (hooks written by an older JichoBot have 10 s and must be
installed again before cards show). JichoBot cannot see Antigravity's mode (`--mode auto`,
Shift+Tab, *Always proceed*), so with the setting on, Auto mode also asks about commands
Antigravity would have run on its own. Other tools (file edits, URLs, MCP) are left to
Antigravity.

Windows and Linux do the same (Settings → Agents → Antigravity, same strings, same rule files
under `%USERPROFILE%\.gemini` or `~/.gemini`, same replies): the rules reader is
`windows/src-tauri/src/agy_rules.rs` (a port of `AgyPermissionRules.swift` with the same
tests), the gate `agy_approvals.rs`, and the relay `jichobot-hook` reads `ask`, or `pending`
then `allow` / `deny` / `ask`, from the app. A command longer than the 2,000 characters the
relay forwards gets no card.

### Cursor — `cursor` (Windows, Linux)

JichoBot supports Cursor out of the box via **Settings → Agents → Cursor → Install hooks**.
The installer writes to `~/.cursor/hooks.json` (`%USERPROFILE%\.cursor\hooks.json` on
Windows) and uses `--agent cursor`. Cursor's own hook payload field names
(`tool_name`, `tool_input.command`, `cwd`, `conversation_id`) already match the relay's,
so no event translation is needed; see [Cursor's hooks documentation](https://cursor.com/docs/hooks).

Cursor has no `PermissionRequest` event: it runs `preToolUse` before a tool and reads
JSON back. Its documented response schema accepts `allow`, `deny`, and `ask`; Cursor
currently treats `ask` as a no-op on `preToolUse`, leaving its configured permission
mode in charge. An empty `{}` is invalid and blocks the tool. See
[Cursor's hooks documentation](https://cursor.com/docs/hooks).

**Approve commands from the notch** (Settings → Agents → Cursor, off by default). Unlike
Antigravity, Cursor has no rules file JichoBot can read reliably yet, so when the setting
is on, *every* Shell command waits for the card — there is no "Cursor's own rules already
cover this one" shortcut.

| On the card | The hook prints |
|---|---|
| **Allow** | `{"permission":"allow"}` — this one command runs |
| **Deny** | `{"permission":"deny","user_message":"Denied from JichoBot"}` |
| **Use Cursor's permission mode** | `{"permission":"ask"}` — Cursor's configured permission mode decides |
| No click in 110 s, JichoBot closed or command too long for a card | `{"permission":"ask"}` |

The `preToolUse` hook is installed with `"matcher": "Shell"` (so only shell commands wait,
never file edits or MCP calls) and a 120 s timeout. When the setting is off, or the user
chooses **Use Cursor's permission mode**, JichoBot replies with the valid `ask` value rather
than an empty object. If no answer arrives in 110 s, Cursor's configured mode decides; in
an auto-approve mode that may run the command. The relay sends the payload tagged
`jichobot_kind: cursor_pre_tool` and reads one line back: `ask` right away, or `pending`
once the card is on screen followed by the click; it waits up to 110 s for the decision.
The hook keeps Cursor's default fail-open behavior on a relay failure, so its own
permission mode remains in charge if JichoBot is unavailable. A command longer than the
2,000 characters the relay forwards gets no card. The gate is
`windows/src-tauri/src/cursor_approvals.rs`; there is no macOS implementation yet.

### GitHub Copilot CLI (macOS)

JichoBot supports Copilot CLI out of the box via **Settings → GitHub Copilot CLI Hooks → Install hooks**.
The installer writes to `~/.copilot/hooks/jichobot.json` and uses `--agent copilot`.
Copilot CLI uses camelCase event names and `{"bash":"…","timeoutSec":N}` entries.
Copilot CLI is fail-closed on `permissionRequest`: the relay always outputs valid JSON
and returns `{"permissionDecision":"ask"}` on timeout so Copilot re-prompts in the terminal.
JichoBot shows a real Allow / Deny card for Copilot approval requests.

| Copilot CLI event | Canonical event |
|---|---|
| `sessionStart` | `SessionStart` |
| `userPromptSubmitted` | `UserPromptSubmit` |
| `preToolUse` | `PreToolUse` |
| `permissionRequest` | `PermissionRequest` |
| `postToolUse` | `PostToolUse` |
| `agentStop` | `Stop` |
| `sessionEnd` | `SessionEnd` |
| `notification` | `Notification` |

### Muse Code (macOS)

JichoBot supports Muse Code out of the box via **Settings → Muse Code Hooks → Install hooks**.
The installer merges into `~/.config/muse/settings.json` and uses `--agent muse`.
Muse uses PascalCase event names. JichoBot shows a real Allow / Deny card for Muse approval requests.

| Muse Code event | Canonical event |
|---|---|
| `SessionStart` | `SessionStart` |
| `UserPromptSubmit` | `UserPromptSubmit` |
| `PreToolUse` | `PreToolUse` |
| `PermissionRequest` | `PermissionRequest` |
| `PostToolUse` | `PostToolUse` |
| `Stop` | `Stop` |
| `SessionEnd` | `SessionEnd` |

### OpenCode (macOS)

JichoBot supports OpenCode via **Settings → OpenCode Plugin → Install plugin**.
The installer writes a JS plugin to `~/.config/opencode/plugins/jichobot.js`.
The plugin maps OpenCode event types to canonical JichoBot names and forwards them fire-and-forget; OpenCode is never blocked.

| OpenCode event | Canonical event |
|---|---|
| `session.created` | `SessionStart` |
| `session.idle` | `Stop` |
| `session.error` | `StopFailure` |
| `session.deleted` | `SessionEnd` |
| `tool.execute.before` | `PreToolUse` |
| `tool.execute.after` | `PostToolUse` |
| `permission.asked` | `PermissionRequest` |

### Amp (macOS)

JichoBot supports Amp via **Settings → Amp Plugin → Install plugin**.
The installer writes a TypeScript plugin to `~/.config/amp/plugins/jichobot.ts`.
The `tool.call` handler returns `{ action: 'allow' }` so Amp always proceeds; all events are forwarded display-only.

| Amp event | Canonical event |
|---|---|
| `session.start` | `SessionStart` |
| `agent.start` | `UserPromptSubmit` |
| `tool.call` | `PreToolUse` |
| `tool.result` | `PostToolUse` |
| `agent.end` | `Stop` |

### Hermes Agent (macOS)

JichoBot supports Hermes via **Settings → Agents → Hermes → Install plugin**.
The installer writes a Python plugin to `~/.hermes/plugins/jichobot/` and enables it in
`~/.hermes/config.yaml`. The plugin uses `on_session_start` (sends the platform when running
via the gateway), `post_llm_call` (sends the final response), and a `pre_approval_request`
observer hook that fires a `⏳ Approval pending in Hermes` step in the notch.
Approving from the notch requires `register_approval_transport`, which is not yet available
in Hermes 0.15.x; the Approvals toggle activates automatically once Hermes exposes it.
Every event is fire-and-forget: if the app is closed or unreachable, nothing is sent and Hermes carries on, handling approvals itself.

| Hermes event | Canonical event |
|---|---|
| `on_session_start` | `SessionStart` |
| `post_llm_call` | `Stop` |
| `pre_approval_request` | `PreToolUse` (observer only, shows "⏳ Approval pending in Hermes") |

### Any other tool

Follow the generic pattern: call `jichobot-hook --agent <your-name> <EventName>` (macOS),
`jichobot-hook.exe --agent <your-name> <EventName>` (Windows)
or `~/.local/share/jichobot/bin/jichobot-hook --agent <your-name> <EventName>` (Linux)
and let the relay forward the event.

## Quick test (Linux)

With JichoBot running:

```sh
echo '{"hook_event_name":"UserPromptSubmit","session_id":"t1","prompt":"hello","jichobot_agent":"demo"}' \
  | ~/.local/share/jichobot/bin/jichobot-hook --agent demo
```

A "demo" pill should appear in the island.

## Quick test (macOS)

With JichoBot running:

```sh
echo '{"hook_event_name":"UserPromptSubmit","session_id":"t1","prompt":"hello","jichobot_agent":"demo"}' \
  | /bin/sh ~/Library/Application\ Support/JichoBot/jichobot-hook --agent demo
```

A "demo" pill should appear in the island.
