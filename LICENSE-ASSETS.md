# JichoBot artwork and media

JichoBot's mascot Kito is an eye-based robot developed from the owner's earlier
mascot in `legacy/electron/mascot/` (`jicho-mascot.css`, `jicho-mascot.js`, and
the mascot icons). The current silhouette, visor, eye expressions, emotes,
greeting animation, and outfits are newly drawn for Kito and are not copied from
Coucou's Mochi artwork.

The Windows artwork is drawn in TypeScript under `windows/src/kito/`. Kotlin and
Swift contain matching renderer ports under
`android/app/src/main/kotlin/org/jichobot/android/kito/` and
`JichoBot/Sources/JichoBotKit/`. App icons are generated from the Kito source
art by `scripts/gen-icons.py`; Android widget preview faces and glows are vector
drawables under `android/app/src/main/res/drawable/`. The shipped sound effects
are synthesized by `scripts/gen-sounds.py`.

These Kito drawings, generated icons, preview vectors, and synthesized sounds
are JichoBot artwork and media. Source code and third-party components remain
under the licenses stated in `LICENSE`, `android/LICENSE`, and the relevant
notices.
