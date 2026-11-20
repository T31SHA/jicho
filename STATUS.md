# JichoBot implementation status

## Source baseline

- Imported source commit: `fe643c8d33d2ad4ad9e52c6c7958e24f61557119` (also recorded in `UPSTREAM_SHA`).
- Source remote is configured as `upstream`; no push was performed.
- Product version is `0.1.0` in the desktop, phone, Android, and package manifests.
- `NOTICE` records the derivation and source commit. Existing MIT notices and `android/LICENSE` remain.

## Platform verification

### macOS

- **Verified by running:** localization validation for the 16-language macOS catalogs; generated icon and sound asset checks.
- **Built but not exercised:** none.
- **Not built:** macOS app and both Xcode schemes. `xcodebuild`, XcodeGen, and Swift are unavailable in this environment.

### iPhone

- **Verified by running:** phone URL and relay source checks are covered by the shared source review; localization and generated asset checks passed.
- **Built but not exercised:** none.
- **Not built:** iPhone app and device interop. Xcode and an iPhone are unavailable.

### Windows

- **Verified by running:** `npx tsc --noEmit`; focused what's-new test; Windows/Linux localization and what's-new checks; string-generation check. The full `npm test` run reported all 43 test files as `ok`, but its runner did not exit after the last test and was interrupted (exit 130), so this is not a clean full-suite pass.
- **Built but not exercised:** none.
- **Not built:** Windows desktop executable and installer. No Windows host is available; CI workflow was updated for JichoBot.

### Linux

- **Verified by running:** shared TypeScript typecheck and focused what's-new test; fake hook event, socket override, approval/answer round trip, and prompt exit when the app is absent; session-title and Codex auto-review tests; relay typecheck. The hook and socket tests used isolated temporary paths.
- **Built but not exercised:** `cargo build` in `windows/` built both workspace members (`jichobot-hook` and `jichobot`) successfully on Linux. It emitted four dead-code warnings for Windows Spotify helpers; there were no compile errors or source fixes needed.
- **Not yet exercised or packaged:** launching the Tauri app, generating AppImage/deb/rpm bundles, full Rust tests, and the hook/install round trip. These are the remaining Linux checks for this build session.

### Android

- **Verified by running:** `node android/scripts/gen-strings.mjs --check` (459 strings, 6 plurals, 16 translations); generated icon and sound asset checks.
- **Built but not exercised:** none.
- **Not built:** debug APK and desktop-to-phone interop. Android SDK/JDK tooling is unavailable.

### Relay

- **Verified by running:** `npm install` and `npm run typecheck` in `relay/`.
- **Built but not exercised:** none.
- **Not built:** deployed relay. `RELAY_URL` is empty and no deployment was attempted.

## Commands run and results

Successful checks:

- `python3 scripts/rebrand.py` twice: both runs completed; second run reported no content or path changes.
- `python3 scripts/check-brand-gate.py`: passed.
- `python3 scripts/test-localization.py`: passed (1,101 Traditional Chinese entries and catalog consistency checks).
- `python3 scripts/test-whats-new.py`: passed for 16 macOS and 14 Windows/Linux languages at version 0.1.0.
- `python3 scripts/gen-icons.py` and `python3 scripts/gen-icons.py --check`: generation and 34-asset verification passed.
- `python3 scripts/gen-sounds.py` and `python3 scripts/gen-sounds.py --check`: generation and deterministic checks for 29 sound keys passed.
- `node android/scripts/gen-strings.mjs --check`: passed.
- `node windows/scripts/gen-strings.mjs --check`: passed.
- `npx tsc --noEmit` in `windows/`: passed.
- `node --import ./tests/setup.mjs --test tests/whats-new.test.mjs` in `windows/`: passed.
- `python3 scripts/test-jichobot-hook.py`: passed fake event, socket override, approval round trip, and non-blocking missing-app checks.
- `python3 scripts/test-session-title.py`: passed both package variants.
- `python3 tests/test_codex_auto_review.py`: 30 tests passed using temporary test paths.
- `bash -n scripts/cloud-test-build.sh scripts/release.sh`: passed.
- `npm install` in `windows/`: completed; npm reported one high-severity advisory. Dependencies were not upgraded.
- `npm install` in `relay/`: completed; npm reported four high-severity advisories. Dependencies were not upgraded.
- `npm run typecheck` in `relay/`: passed.
- `git diff --check`: passed.
- Recursive brand grep, excluding `.git`, dependency directories, and local build output: four permitted matches only — `android/LICENSE:23`, `windows/src-tauri/src/phone_link/mod.rs:1`, and `NOTICE:1-2`. The matches are required license/copyright/attribution text.

Checks that did not complete:

- `npm test` in `windows/`: all 43 test files reported `ok`; runner hung after the last subtest and was interrupted (exit 130).
- `bash scripts/test-claude-hooks.sh`: could not run because `swiftc` is unavailable.
- `cargo test` and `cargo test phone_link`: could not run because `cargo` is unavailable.
- `npm run tauri dev`, `npm run build`, and `npm run pack` in `windows/`: could not run because Tauri's Cargo metadata/build step requires the missing Cargo toolchain.
- Android Gradle build and Xcode builds: not run because the required SDK/toolchains are unavailable.
- Linux apt dependencies listed in `.github/workflows/linux.yml`: `apt-get update` failed with permission denied opening `/var/lib/apt/lists/lock`; retry with `sudo apt-get update` failed because sudo requires terminal authentication. Packages remain uninstalled.

## Remaining manual steps

- **Linux:** install Rust/Cargo and the apt packages listed in `.github/workflows/linux.yml`; run `npm run tauri dev`, the full `npm test`, `cargo test` (including `cargo test phone_link`), and `npm run pack` for AppImage, deb, and rpm. Exercise an approval flow and the Claude Code installer using a temporary `HOME`.
- **Windows:** run the Windows CI build and test workflow on a Windows host; inspect and exercise the packaged installer and hook relay.
- **Android:** install JDK and Android SDK, build the debug APK, then run phone-link interop against a development desktop build and device.
- **macOS/iPhone:** install Xcode and XcodeGen, regenerate the project from `JichoBot/project.yml`, build both macOS schemes unsigned and build the iPhone app. Set `APPLE_TEAM_ID` only for signing; create/configure the `iCloud.org.jichobot.JichoBot` CloudKit container and matching APNs topic before a signed phone/relay release.
- **Relay:** install/deploy using the relay's Wrangler configuration, configure required secrets in the OS/service secret store, and set `RELAY_URL` to the deployed endpoint before enabling pairing outside local development.
- **Legal/site:** replace the maintainer entity, mailing address, and support contact placeholders in the legal pages once those facts are known.
- **Release:** verify GitHub release workflows and package artifacts on their native runners; no release or deployment was performed.

## Behavior and known limits

- Application state names, state-machine flow, platform interfaces, hook/relay contract, and feature code were retained while identifiers and branding were changed.
- The mascot, icons, and sounds are original replacements. Promotional donation/Botan links and TestFlight references were removed; relay and signing values remain unset until configured. These are intentional branding/account changes.
- No native platform build was available to establish end-to-end behavioral parity. The Windows/Linux full test runner also did not exit cleanly; those checks remain open above.
- The checked-in generated Xcode project file from the imported source was removed in favor of `JichoBot/project.yml`; local regeneration could not be tested without XcodeGen. CI regenerates the project before its unsigned scheme builds.
