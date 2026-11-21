cask "jichobot" do
  version "0.1.0"
  sha256 "8c2a1e87c967fea329eea2a49a16e52e855f06e09c344a6d069cb69ada4d883b"

  url "https://github.com/T31SHA/jicho/releases/download/v#{version}/JichoBot.zip"
  name "JichoBot"
  desc "Notch companion that keeps an eye on your AI coding agents"
  homepage "https://github.com/T31SHA/jicho"

  # Only the Mac's tags (vX.Y.Z): windows-v…, linux-v… and android-v… are other apps.
  livecheck do
    url :url
    regex(/^v?(\d+(?:\.\d+)+)$/i)
    strategy :github_releases
  end

  # JichoBot updates itself from the notch: brew leaves the installed app alone.
  auto_updates true
  depends_on macos: :sequoia

  app "JichoBot.app"

  uninstall quit: "org.jichobot.desktop"

  zap trash: [
    "~/Library/Application Support/JichoBot",
    "~/Library/Application Support/JichoBot",
    "~/Library/Preferences/org.jichobot.desktop.plist",
  ]
end
