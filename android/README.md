# JichoBot for Android

The Android app pairs with the desktop app over the local network and can display agent activity, approval requests, questions, and widgets. Remote delivery can use the optional relay when one has been deployed and configured.

## Build

Open this folder in Android Studio or run the Gradle wrapper with a configured SDK:

```sh
./gradlew assembleDebug
./gradlew testDebugUnitTest
```

The app targets the package `org.jichobot.android`. The generated Android string resources are checked with:

```sh
node scripts/gen-strings.mjs --check
```

The home-screen widgets are **Kito at a glance**, **All your agents**, **Kito, big**, **One-line status**, **Approvals waiting**, **Plan usage**, **Finished today**, **Kito's mood**, and **Agents summary**.

Pairing links use the `jichobot://` scheme and desktop discovery uses `_jichobot._tcp`. The Android companion retains its separate `LICENSE`; third-party licenses are listed under `app/src/main/assets/licenses/`.

Build and device verification results are in [`../STATUS.md`](../STATUS.md). Relay deployment requires the account and secrets listed there.
