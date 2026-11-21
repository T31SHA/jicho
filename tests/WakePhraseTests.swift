import Foundation

// MARK: - WakePhrase tests (pure functions, no concurrency)

@main
enum WakePhraseTests {

    static var failures = 0

    static func main() {
        // MARK: split — should match

        // Basic wake phrases (no command)
        checkMatch("ok jichobot",              WakePhrase.split("ok jichobot"),              cmd: "")
        checkMatch("OK JICHOBOT",              WakePhrase.split("OK JICHOBOT"),              cmd: "")
        checkMatch("okay jichobot",            WakePhrase.split("okay jichobot"),            cmd: "")
        checkMatch("ok kuku",                WakePhrase.split("ok kuku"),                cmd: "")
        checkMatch("ok cou cou",             WakePhrase.split("ok cou cou"),             cmd: "")
        checkMatch("hey jichobot",             WakePhrase.split("hey jichobot"),             cmd: "")
        checkMatch("Hey JichoBot",             WakePhrase.split("Hey JichoBot"),             cmd: "")

        // Command extracted from original text (casing/punctuation preserved)
        checkMatch("Okay, JichoBot, ajoute GitHub",
                   WakePhrase.split("Okay, JichoBot, ajoute GitHub"),             cmd: "ajoute GitHub")
        checkMatch("ok cuckoo add github",
                   WakePhrase.split("ok cuckoo add github"),                    cmd: "add github")
        checkMatch("ok jichobot ouvre figma",
                   WakePhrase.split("ok jichobot ouvre figma"),                   cmd: "ouvre figma")

        // Apostrophes, hyphens and accents preserved in command
        checkMatch("OK JichoBot, mets l'album de Daft Punk",
                   WakePhrase.split("OK JichoBot, mets l'album de Daft Punk"),   cmd: "mets l'album de Daft Punk")
        checkMatch("ok jichobot qu'est-ce que fait Claude ?",
                   WakePhrase.split("ok jichobot qu'est-ce que fait Claude ?"),  cmd: "qu'est-ce que fait Claude ?")

        // Wake anywhere in transcript (word-boundary search)
        checkMatch("euh ok jichobot mets de la musique",
                   WakePhrase.split("euh ok jichobot mets de la musique"),        cmd: "mets de la musique")
        checkMatch("la chanson dit ok jichobot",
                   WakePhrase.split("la chanson dit ok jichobot"),                cmd: "") // accepted false positive

        // LAST occurrence wins
        checkMatch("ok jichobot search ok jichobot play music",
                   WakePhrase.split("ok jichobot search ok jichobot play music"),   cmd: "play music")

        // Partial word-by-word delivery
        checkNoMatch("ok alone",             WakePhrase.split("ok"))
        checkMatch("ok jichobot partial",      WakePhrase.split("ok jichobot"),              cmd: "")
        checkMatch("ok jichobot with more",    WakePhrase.split("ok jichobot mets"),         cmd: "mets")

        // MARK: split — should NOT match
        checkNoMatch("standalone jichobot",    WakePhrase.split("jichobot"))
        checkNoMatch("standalone JICHOBOT",    WakePhrase.split("JICHOBOT"))
        checkNoMatch("partial jichobot ça va", WakePhrase.split("jichobot ça va"))
        checkNoMatch("jichobot comment",       WakePhrase.split("jichobot comment tu vas"))
        checkNoMatch("ok google",            WakePhrase.split("ok google"))
        checkNoMatch("hey siri",             WakePhrase.split("hey siri"))
        checkNoMatch("okkkk jichobot",         WakePhrase.split("okkkk jichobot"))
        checkNoMatch("empty",                WakePhrase.split(""))

        // Summary
        if failures == 0 { print("\n\(total)/\(total) tests passed.") }
        else { print("\n\(failures) test(s) FAILED."); exit(1) }
    }

    static var total = 0

    static func checkMatch(_ label: String, _ r: WakePhrase.SplitResult, cmd: String) {
        total += 1
        if !r.matched {
            print("✗  \(label) — expected match, got no match"); failures += 1; return
        }
        if r.command != cmd {
            print("✗  \(label) — matched ✓ but command \"\(r.command)\" ≠ \"\(cmd)\""); failures += 1; return
        }
        print("✓  \(label)")
    }

    static func checkNoMatch(_ label: String, _ r: WakePhrase.SplitResult) {
        total += 1
        if r.matched { print("✗  \(label) — expected no match, got matched (cmd: \"\(r.command)\")"); failures += 1 }
        else         { print("✓  \(label)") }
    }
}
