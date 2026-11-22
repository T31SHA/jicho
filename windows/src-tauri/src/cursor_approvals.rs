// Approve Cursor commands from the island (Settings → Agents → Cursor, off by default).
//
// Cursor has no permission-request event either: its preToolUse hook runs before
// tool execution and reads one line back (cursor.com/docs/hooks):
//   * `permission: "ask"` — this module found no reason for a card, the setting
//     is off, or nobody clicked; Cursor currently treats ask as a no-op and its
//     configured permission mode decides;
//   * or `pending` once the card is up, then `allow` or `deny` (pipe.rs).
// Only a click on Allow ever lets a command run from here. No click, Reply in
// terminal, JichoBot closed or slow: Cursor's configured mode decides, same as
// if JichoBot were not installed.
//
// Unlike Antigravity, Cursor's own allow/deny rules are not a format JichoBot
// can read reliably yet, so there is no "ours to skip" case: every Shell
// command is offered a card while this is on.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::{Emitter, State, WebviewWindow};

use crate::{log, platform, settings, Shared};

/// The preToolUse hook needs this long (seconds) for a card to wait for a click.
/// The app replies before the hook timeout; on no answer it sends `ask` so Cursor's
/// configured permission mode remains in charge (cursor.com/docs/hooks).
pub const HOOK_TIMEOUT: u64 = 120;

/// What the relay tags the PreToolUse events it waits on with.
pub const KIND: &str = "cursor_pre_tool";

/// A command to put on the card, and how long it may wait there.
#[derive(Debug, PartialEq)]
pub struct Gate {
    pub command: String,
    pub wait: Duration,
}

/// The card to show when Cursor is about to run a shell command, None when
/// Cursor decides on its own. `enabled` is the setting, `home` holds Cursor's
/// `.cursor` folder.
pub fn gate(payload: &Value, enabled: bool, home: &Path) -> Option<Gate> {
    if !enabled || payload.get("jichobot_agent").and_then(Value::as_str) != Some("cursor") {
        return None;
    }
    // The hook is installed with `"matcher": "Shell"`, but a hook from an older
    // JichoBot (or a user's own config) may not filter — check again here.
    if payload.get("tool_name").and_then(Value::as_str) != Some("Shell") {
        return None;
    }
    // The relay shortens long strings: a command that was cut is not one to
    // approve without seeing it whole.
    if payload.get("jichobot_command_cut").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let command = payload
        .get("tool_input")
        .and_then(|i| i.get("command"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if command.is_empty() {
        return None;
    }
    // JichoBot gives up 10 s before Cursor stops waiting for the hook.
    let timeout = pre_tool_timeout(home).filter(|t| *t >= HOOK_TIMEOUT)?;
    Some(Gate {
        command,
        wait: Duration::from_secs((timeout - 10).min(110)),
    })
}

/// Timeout (seconds) of JichoBot's preToolUse hook in ~/.cursor/hooks.json, None
/// if it is not there or was not written with ours.
pub fn pre_tool_timeout(home: &Path) -> Option<u64> {
    let bytes = std::fs::read(home.join(".cursor").join("hooks.json")).ok()?;
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    let root: Value = serde_json::from_slice(bytes).ok()?;
    let hooks = root.get("hooks")?.get("preToolUse")?.as_array()?;
    hooks
        .iter()
        .find(|h| {
            h.get("command")
                .and_then(Value::as_str)
                .is_some_and(|c| c.contains("jichobot-hook"))
        })
        .and_then(|h| h.get("timeout").and_then(Value::as_u64))
}

// ── Settings → Agents → Cursor ─────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorApprovalsStatus {
    pub enabled: bool,
    /// JichoBot's preToolUse hook gives Cursor time to wait for a click: hooks
    /// installed before this feature, or with too short a timeout, are not ready.
    pub hooks_ready: bool,
}

fn status(enabled: bool) -> CursorApprovalsStatus {
    let ready = pre_tool_timeout(&platform::home_dir()).is_some_and(|t| t >= HOOK_TIMEOUT);
    CursorApprovalsStatus {
        enabled,
        hooks_ready: ready,
    }
}

#[tauri::command]
pub fn cursor_approvals_status(shared: State<Shared>) -> CursorApprovalsStatus {
    status(shared.settings.lock().unwrap().cursor_approvals_enabled)
}

/// "Approve commands from the notch". Off by default; only the switch in the
/// JichoBot window turns it on, and save_settings keeps what it says.
#[tauri::command]
pub fn cursor_approvals_set_enabled(
    app: tauri::AppHandle,
    window: WebviewWindow,
    shared: State<Shared>,
    enabled: bool,
) -> Result<CursorApprovalsStatus, String> {
    if window.label() != crate::HUB_LABEL {
        return Err("only the JichoBot window may change this".into());
    }
    let updated = {
        let mut current = shared.settings.lock().unwrap();
        current.cursor_approvals_enabled = enabled;
        if let Err(err) = settings::save(&current) {
            log::line(format!("could not save settings: {err}"));
        }
        current.clone()
    };
    log::line(format!(
        "Cursor approvals from the island {}",
        if enabled { "on" } else { "off" }
    ));
    let _ = app.emit("settings-changed", updated);
    Ok(status(enabled))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn home(name: &str, hooks: Option<&str>) -> std::path::PathBuf {
        let home = std::env::temp_dir().join(format!(
            "jichobot-cursor-gate-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(home.join(".cursor")).unwrap();
        if let Some(hooks) = hooks {
            std::fs::write(home.join(".cursor").join("hooks.json"), hooks).unwrap();
        }
        home
    }

    fn hooks(timeout: Option<u64>) -> String {
        let t = timeout
            .map(|t| format!(r#","timeout":{t}"#))
            .unwrap_or_default();
        format!(
            r#"{{"version":1,"hooks":{{"preToolUse":[{{"command":"/x/jichobot-hook --agent cursor","matcher":"Shell"{t}}}]}}}}"#
        )
    }

    fn run(tool_name: &str, command: &str) -> Value {
        json!({ "jichobot_agent": "cursor", "jichobot_kind": KIND, "tool_name": tool_name,
                "tool_input": { "command": command }, "cwd": "/work" })
    }

    #[test]
    fn a_shell_command_waits_on_the_card_when_enabled_and_ready() {
        let h = home("ready", Some(&hooks(Some(120))));
        let gate = gate(&run("Shell", "npm install"), true, &h).expect("card");
        assert_eq!(
            gate,
            Gate {
                command: "npm install".into(),
                wait: Duration::from_secs(110)
            }
        );
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn nothing_waits_when_it_is_off_not_shell_or_empty() {
        let h = home("off", Some(&hooks(Some(120))));
        assert_eq!(gate(&run("Shell", "npm install"), false, &h), None);
        for (key, value) in [
            ("jichobot_agent", json!("antigravity")),
            ("tool_name", json!("Read")),
            ("tool_input", json!({ "command": "   " })),
            ("tool_input", json!({})),
            ("jichobot_command_cut", json!(true)),
        ] {
            let mut p = run("Shell", "npm install");
            p[key] = value;
            assert_eq!(gate(&p, true, &h), None, "{key}");
        }
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn hooks_not_ready_never_wait() {
        for (name, hooks_json) in [
            ("short", Some(hooks(Some(10)))),
            ("no_timeout", Some(hooks(None))),
            ("none", None),
        ] {
            let h = home(name, hooks_json.as_deref());
            assert_eq!(gate(&run("Shell", "npm install"), true, &h), None, "{name}");
            let _ = std::fs::remove_dir_all(&h);
        }
        // A longer hook still gives up 10 s before it, and never after 110 s.
        let h = home("long", Some(&hooks(Some(600))));
        assert_eq!(
            gate(&run("Shell", "npm install"), true, &h).unwrap().wait,
            Duration::from_secs(110)
        );
        let _ = std::fs::remove_dir_all(&h);
    }
}
