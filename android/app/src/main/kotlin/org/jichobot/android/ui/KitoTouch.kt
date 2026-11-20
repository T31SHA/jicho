package org.jichobot.android.ui

import android.os.Handler
import android.os.Looper
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import org.jichobot.android.kito.BotEmote
import org.jichobot.android.kito.BotState
import org.jichobot.android.kito.KitoEngine
import org.jichobot.android.kito.SoundSink

/**
 * What a finger does to Kito, as on the computer: a tap is a slap (three quick ones make him dizzy
 * for a few seconds), a long press is a pet (hearts). The sounds go through [sound], so the sound
 * switch in Settings silences them too.
 */
class KitoTouch(
    private val engine: KitoEngine,
    private val sound: SoundSink,
    private val stateNow: () -> BotState,
) {
    private val main = Handler(Looper.getMainLooper())

    /** While true the screen must not reset Kito's state: he is dizzy on purpose. */
    var dizzy = false
        private set

    init {
        engine.onDizzy = {
            dizzy = true
            engine.setState(BotState.DIZZY, force = true)
            sound.play("dizzy")
            main.postDelayed({
                dizzy = false
                engine.setState(stateNow(), force = true)
            }, DIZZY_MS)
        }
    }

    val modifier: Modifier = Modifier.pointerInput(engine) {
        detectTapGestures(
            onTap = { if (!dizzy) engine.slap() },
            onLongPress = {
                if (!dizzy) {
                    engine.triggerEmote(BotEmote.LOVE)
                    sound.play("love")
                }
            },
        )
    }

    private companion object { const val DIZZY_MS = 3_300L }
}
