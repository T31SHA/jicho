# Android renderer audit

Audit date: 2026-11-20. This combines source inspection with the Android CI build. A device render could not be inspected: ADB started successfully outside the sandbox, but no Android devices were attached.

## Renderer paths

| Surface | Renderer | Update behavior |
|---|---|---|
| Home, session, pairing, chat, wardrobe preview, and approval/question sheets | `KitoEngine` + `KitoView` + `KitoPainter` on Compose Canvas | Advances on frame callbacks while the lifecycle is `STARTED`; the reduced-motion setting stops idle animation and lowers idle wakeups to 4 Hz. |
| Floating island | The same `KitoView` inside `IslandOverlay` | The overlay creates its window while visible and removes it when hidden; working, result, and approval states use small live Kito views. |
| Home-screen widgets | `KitoBitmap` drawn once with `KitoPainter`, then supplied through `RemoteViews`; static XML vectors serve launcher previews and the initial widget state | Settles a fixed-seed engine for 60 frames, caches up to 16 pictures, and redraws on data updates rather than on a timer. Static faces now include tone-colored eyes, radial glows, and state badges; they do not reproduce the full animated character pixel-for-pixel. |
| Wardrobe selection icons | `OutfitIcon` and `drawIconKito` through `Ctx2D` / `ComposeGfx` | Drawn as static Canvas content; the large preview uses the animated renderer and selected outfit. |

## Parity and findings

- `KitoConstTest` compares all 11 state colors, tints, eye shapes, and sound names with `windows/src/kito/engine.ts`. `KitoEngineTest` covers representative state transitions, animation, and particles.
- `OutfitParityTest` records and compares outfit drawing calls against the TypeScript implementation across 297 cases, including poses, fade states, and wardrobe icons. It does not compare the complete Kito painter pixel-for-pixel.
- The static widget vectors show the four representative states with state-colored eyes and glows; working, waiting, and finished also have their dots, bang, and check badges. They are a hand-authored snapshot, while `KitoBitmap` renders the engine for live widget updates.
- **Custom body color differs from the reference renderer.** In `KitoPainter.drawBody`, a non-null `bodyColor` is filled first, but the painter then applies state tint, shading, and highlight when there is no pumpkin outfit. The TypeScript renderer returns after the custom fill in that case (`windows/src/kito/engine.ts`, `drawBody`); the Swift renderer likewise skips its gradient and shading branch. Android uses custom body colors for selected agents as well as small agent Kitos, so the visual difference affects both. Whether the extra Android shading is intended is a design choice; matching the reference means returning after the custom fill unless a pumpkin overlay is active.
- **Stale engine comment.** `KitoEngine.kt` says outfits are not ported, although the engine, outfit renderer, and parity test are present. This does not change rendering behavior.
- The Android port does not implement the desktop renderer's music dance or update-hint arrow badge. Those behaviors are present in the Windows renderer; they were not found in the Android renderer or its call sites during this audit.

## Build and device verification

- `node scripts/gen-strings.mjs --check` passed.
- `./gradlew test assembleDebug lint --console=plain` passed. Each of the debug and release unit-test variants reported 1,041 tests, 0 failures, and 31 skipped. All 15 `DevDesktopInteropTest` cases passed in each variant. Lint reported 71 warnings and 2 informational findings, with no lint errors. The task also assembled the debug APK and unsigned minified release APK and passed `verifyReleaseNoLogs`.
- The workflow's grep guard for ads, billing, and analytics dependencies passed.
- The debug APK reports package `org.jichobot.android`, version `0.1.0`, min SDK 30, target SDK 35, and compile SDK 35. Its size is 29 MiB; the unsigned release APK is 4.6 MiB.
- ADB reported no attached devices. Device rendering and physical phone-to-desktop pairing were not exercised.

## Android CI workflow

| Stage | Workflow action | Result / purpose |
|---|---|---|
| Trigger | Pull requests changing Android sources, Android link docs, or this workflow; pushes to `main` changing Android sources | Limits the Android job to relevant changes. A standalone change to this renderer audit document does not trigger the job. |
| Toolchain | Ubuntu 24.04; Temurin JDK 17; Node 22; Gradle setup action | Provides the Android build environment. The hosted runner supplies the Android SDK. |
| Generated strings | `node scripts/gen-strings.mjs --check` | Fails if checked-in English Android strings are stale. |
| Tests, APK, lint | `./gradlew test assembleDebug lint --console=plain` | Runs JVM unit tests, builds the debug APK, and lints. `lint` also depends on `verifyReleaseNoLogs`, which builds the minified release APK and checks its dex files for debug log strings. |
| Permission condition | Grep the app Gradle file for ads, billing, or analytics SDK patterns | Fails if those SDKs are introduced. |
| Reports | Upload `android/app/build/reports` even after a failed job | Preserves available test and lint reports. |
