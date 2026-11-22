# iPhone companion

The iPhone companion syncs with JichoBot for macOS through the private CloudKit database. It shows agent sessions, approval and question requests, widgets, and supported Live Activities. It does not pair by scanning the Android QR code: use the same Apple Account on the Mac and iPhone, then open both apps. The iPhone app is not yet distributed through the App Store or TestFlight.

Approval and question notifications need notification permission on the iPhone. Notifications for finished or failed sessions are optional. Live Activities need the iOS setting enabled; remote Live Activity delivery also needs Apple signing, the configured CloudKit container and APNs, and a deployed relay.

## Generate and build

1. Install Xcode and XcodeGen on macOS.
2. Use an Apple Developer account and an app identifier you control.
3. Set `DEVELOPMENT_TEAM` and configure the `iCloud.org.jichobot.JichoBot` container in the project and entitlements.
4. Run `cd JichoBot && xcodegen`.
5. Build the `JichoBotPhone` scheme for a simulator or signed device.

The repository intentionally leaves `APPLE_TEAM_ID` and `RELAY_URL` unconfigured. The remaining account setup and manual device steps are listed in `STATUS.md`.

## Connect the iPhone

Sign in to the same Apple Account in iCloud on the Mac and iPhone. Open JichoBot on both devices and allow notifications on the iPhone. The Mac publishes session changes to its private CloudKit zone; the iPhone reads that zone and receives CloudKit notifications. There is no QR code or numeric passcode for iPhone pairing. Do not share iCloud diagnostic data that contains private record contents.
