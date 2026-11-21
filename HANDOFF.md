# JichoBot handoff

## Current state

- **Windows desktop:** the TypeScript renderer has Kito's eye-robot hood, visor, proportions, palette, expressions, emotes, staged greeting, and outfits. `npm test` passes (44 test files). The 60-second Tauri smoke run was performed on this Linux host; Windows packaging and installation still need a Windows host.
- **Linux desktop:** uses the same Tauri and TypeScript renderer as Windows. `cargo test` passes (632 library tests and 39 hook tests; 8 ignored), and `npm test` passes. `npm run tauri dev` ran for the requested 60-second interval. Packaging was not rerun after the character redraw.
- **macOS:** the Swift renderer and greeting canvas were updated to the new Kito design. No fresh Apple build was run here because Xcode, XcodeGen, and Swift are unavailable.
- **iPhone:** the Swift character renderer source is shared with the Apple app. No iOS build, signing, installation, or device check was run here.
- **Android:** the Kotlin renderer, outfits, icons, and widget preview vectors were updated. The current redraw has not been built or unit-tested: Gradle reports no Android SDK at `$HOME/Android/Sdk`, in `ANDROID_HOME`/`ANDROID_SDK_ROOT`, or in `android/local.properties`.
- **Phone-link interop:** the gated test command did not start because the Android SDK is missing. It did not launch the Rust test server.
- **Relay:** source checks are available, but no relay was deployed and no `RELAY_URL` is configured.
- **Character screenshots:** no per-state desktop screenshots were captured. The existing Linux island image is a single earlier capture, not a set of the 11 states.

## Build and test commands

Run shared repository checks from the repository root:

```sh
python3 scripts/check-brand-gate.py
python3 scripts/test-localization.py
python3 scripts/test-whats-new.py
python3 scripts/gen-icons.py --check
node android/scripts/gen-strings.mjs --check
node windows/scripts/gen-strings.mjs --check
node android/relay/tools/gen-vectors.mjs --check
```

### Windows desktop

On a Windows host with Node 22+ and Rust installed, from `windows/`:

```sh
npm ci
npx tsc --noEmit
npm test
cargo test --workspace --locked
npm run tauri dev
npm run pack
```

`npm run pack` creates the Windows installers and portable binaries. Install and exercise the package on a Windows machine after building.

### Linux desktop

On a Linux host with the system libraries listed in `.github/workflows/linux.yml`, from `windows/`:

```sh
npm ci
cargo build --release -p jichobot-hook
cargo test --workspace --locked
npm test
npx tsc --noEmit
npm run tauri dev
npm run pack
```

### Android

Install JDK 17 and Android SDK platform 35/build tools 35.0.0. If `$HOME/Android/Sdk` exists, set `ANDROID_HOME="$HOME/Android/Sdk"`. From `android/`:

```sh
node scripts/gen-strings.mjs --check
./gradlew test assembleDebug
```

To run the Android client against the real Rust desktop server (requires Rust/Cargo as well), from `android/`:

```sh
JICHOBOT_RUST_INTEROP=1 ./gradlew testDebugUnitTest --tests '*RustDesktopInteropTest' --console=plain
```

### macOS desktop

Install Xcode and XcodeGen. From the repository root:

```sh
brew install xcodegen
(cd JichoBot && xcodegen)
xcodebuild -project JichoBot/JichoBot.xcodeproj -scheme JichoBot -configuration Release build CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO
xcodebuild -project JichoBot/JichoBot.xcodeproj -scheme JichoBotAppStore -configuration Debug build CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO
xcodebuild -project JichoBot/JichoBot.xcodeproj -scheme JichoBotCloud -configuration DebugCloud build CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO
xcodebuild -project JichoBot/JichoBot.xcodeproj -scheme JichoBot -configuration ReleaseCloud build CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO
python3 scripts/test-localization.py
python3 scripts/test-whats-new.py mac
bash scripts/test-desktop-kito.sh
```

The full macOS source-test list is in `.github/workflows/build.yml`; `bash scripts/test-claude-hooks.sh` additionally requires `swiftc`.

### iPhone

With Xcode installed and the generated project available, from the repository root:

```sh
(cd JichoBot && xcodegen)
xcodebuild -project JichoBot/JichoBot.xcodeproj -scheme JichoBotPhone -destination 'generic/platform=iOS' build CODE_SIGNING_ALLOWED=NO
```

The unsigned build does not install on a phone. Select a real signing team and provisioning profile to install it on an iPhone; then verify launch, local-network permission, and pairing with a desktop. The phone link also needs the APNs topic and CloudKit container configured for signed releases.

### Android relay package

From `android/relay/`:

```sh
npm ci
npm run typecheck
npm test
npm run vectors
npx wrangler deploy --dry-run
```

The dry run builds only; it does not deploy the relay.

## Remaining manual steps

- **Windows:** run the Windows CI checks and `npm run pack` on a Windows host; install the installer, verify Defender/SmartScreen behavior, and exercise hook installation, approvals, and phone pairing.
- **macOS:** install Xcode and XcodeGen, generate the project, build the macOS schemes, run the workflow tests, and inspect the updated Kito on a Mac. Configure signing/notarization only with the owner's Apple team and credentials.
- **iPhone:** build and install on a physical iPhone with an approved team/profile; confirm local-network permission and pairing against a desktop. Configure the CloudKit container, APNs topic, and relay before a signed phone-link release.
- **Android:** install SDK platform/build tools 35, rerun Gradle tests and the Rust interop test, then inspect the renderer and pairing on a connected phone.
- **Legal pages:** supply the real legal entity, postal address, and governing jurisdiction. No values have been invented.
- **State images:** capture and save desktop screenshots for each of the 11 states when a desktop screenshot facility is available.
