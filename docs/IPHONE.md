# iPhone companion

The iPhone app pairs with the JichoBot desktop app. It can show agent status, approval and question requests, widgets, and supported Live Activities. Pairing and local status work over the local network. Remote Live Activity delivery requires Apple signing, a CloudKit container, APNs setup, and a deployed relay.

## Generate and build

1. Install Xcode and XcodeGen on macOS.
2. Set `bundleIdPrefix` in `JichoBot/project.yml` to an identifier owned by your developer account.
3. Set `DEVELOPMENT_TEAM` and configure the iCloud container in the project and entitlements.
4. Run `cd JichoBot && xcodegen`.
5. Build the `JichoBotPhone` scheme for a simulator or signed device.

The repository intentionally leaves `APPLE_TEAM_ID` and `RELAY_URL` unconfigured. The remaining account setup and manual device steps are listed in `STATUS.md`.

## Pairing

Open the phone pairing screen in the desktop app and scan its displayed QR code. The link uses `jichobot://pair`. Local discovery uses `_jichobot._tcp`. Keep the pairing token private and remove it before sharing diagnostic output.
