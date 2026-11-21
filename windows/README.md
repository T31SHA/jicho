# JichoBot desktop for Windows and Linux

This folder contains the Tauri desktop app and its TypeScript UI. The app surfaces agent activity, approval and question prompts, integrations, local history, update notices, and pairing with the phone apps. Feature availability depends on the operating system and each integration's own setup.

## Development

Install Node.js, Rust, and the Tauri prerequisites for your operating system, then run:

```sh
npm install
npm test
npm run tauri dev
```

For a production bundle, use `npm run pack` on a supported build host. Linux AppImage, deb, and rpm packaging require the Linux build dependencies described in the workflow. Windows packaging runs in GitHub Actions on a Windows runner.

## Hook and configuration safety

JichoBot installs hooks only after the user chooses an installer action in the app. It backs up existing configuration, shows the planned changes, and waits for explicit confirmation before writing. The hook relay exits if the desktop app does not answer; it does not wait indefinitely on an agent.

Secrets are stored in the operating system credential store. Keep credentials, signing keys, and relay keys out of the repository. No telemetry is included.

Pairing uses `jichobot://pair`, service discovery uses `_jichobot._tcp`, and optional environment overrides use the `JICHOBOT_` prefix. See `../docs/ANDROID_LINK.md`, `../docs/REMOTE.md`, and `../docs/INTEGRATIONS.md` for protocol and integration details.

## Build verification

See [`../STATUS.md`](../STATUS.md) for commands run and platform checks that still need a native machine.
