import Foundation

// Stand-ins for Mac-only pieces that JichoBotKit's BotEngine calls.
// The Mac app has the real ones (SoundEngine.swift, IslandWindowController.swift).

/// Kito is silent on the iPhone.
@MainActor
final class SoundEngine {
    static let shared = SoundEngine()
    func play(_ name: String) {}
}

extension Notification.Name {
    static let botDizzy = Notification.Name("jichoBot.botDizzy")
}
