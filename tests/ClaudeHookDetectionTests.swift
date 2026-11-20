import Foundation

@main
enum ClaudeHookDetectionTests {
    static func settings(_ json: String) -> [String: Any] {
        let object = try? JSONSerialization.jsonObject(with: Data(json.utf8))
        return (object as? [String: Any]) ?? [:]
    }

    static func main() {
        // Installed: the hook JichoBot writes, GitHub build
        precondition(jichobotHooksPresent(inSettings: settings("""
        {"hooks":{"SessionStart":[{"hooks":[
          {"type":"command","command":"$HOME/.claude/jichobot/jichobot-hook"}]}]}}
        """)))

        // Installed: App Store build names JichoBot
        precondition(jichobotHooksPresent(inSettings: settings("""
        {"hooks":{"SessionStart":[{"hooks":[
          {"type":"command","command":"/Applications/JichoBot.app/.../jichobot-hook"}]}]}}
        """)))

        // Installed: our hook sits alongside somebody else's
        precondition(jichobotHooksPresent(inSettings: settings("""
        {"hooks":{"SessionStart":[
          {"hooks":[{"type":"command","command":"/usr/local/bin/other-tool"}]},
          {"hooks":[{"type":"command","command":"$HOME/.claude/jichobot/jichobot-hook"}]}]}}
        """)))

        // Not installed: other tools only — the case that showed "Key not configured"
        precondition(!jichobotHooksPresent(inSettings: settings("""
        {"hooks":{"SessionStart":[{"hooks":[
          {"type":"command","command":"$HOME/.vibe-island/bin/vibe-island-bridge"},
          {"type":"command","command":"python3 /Users/me/.claude/skills/harness/hook.py"}]}]}}
        """)))

        // Not installed: hooks for other events do not count
        precondition(!jichobotHooksPresent(inSettings: settings("""
        {"hooks":{"PreToolUse":[{"hooks":[
          {"type":"command","command":"$HOME/.claude/jichobot/jichobot-hook"}]}]}}
        """)))

        // Malformed or empty settings never crash, and never read as installed
        precondition(!jichobotHooksPresent(inSettings: settings("{}")))
        precondition(!jichobotHooksPresent(inSettings: settings("""
        {"hooks":{"SessionStart":[]}}
        """)))
        precondition(!jichobotHooksPresent(inSettings: settings("""
        {"hooks":{"SessionStart":[{"hooks":[{"type":"command"}]}]}}
        """)))
        precondition(!jichobotHooksPresent(inSettings: settings("""
        {"hooks":{"SessionStart":"not-an-array"}}
        """)))
        precondition(!jichobotHooksPresent(inSettings: settings("""
        {"hooks":"not-an-object"}
        """)))

        print("Claude hook detection: 10 cases passed")
    }
}
