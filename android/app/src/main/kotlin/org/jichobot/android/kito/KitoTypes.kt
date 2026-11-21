package org.jichobot.android.kito

/** Components 0..1, like the TS `RGB` tuple. */
data class Rgb(val r: Double, val g: Double, val b: Double) {
    fun mix(o: Rgb, t: Double) = Rgb(r + (o.r - r) * t, g + (o.g - g) * t, b + (o.b - b) * t)
}

enum class EyeShape { PILL, WIDE, DOT, LINE, FLAT, HAPPY, CLOSED, SPIRAL, HEART, STAR, TIRED, WINK, CUP }

enum class BadgeKind { DOTS, BANG, QUESTION, DOT }

data class Badge(val kind: BadgeKind, val color: Rgb)

enum class BotState(val key: String) {
    IDLE("idle"), WORKING("working"), THINKING("thinking"), SEARCHING("searching"),
    APPROVAL("approval"), QUESTION("question"), ERROR("error"), FINISHED("finished"),
    RATELIMIT("ratelimit"), SLEEPING("sleeping"), DIZZY("dizzy"),
}

enum class BotEmote(val key: String) {
    LOVE("love"), SURPRISED("surprised"), PROUD("proud"), WINK("wink"),
    YAWN("yawn"), HAPPY("happy"), ANNOYED("annoyed"),
}

data class BotStateCfg(
    val color: Rgb,
    val tint: Double,
    val eye: EyeShape,
    val badge: Badge?,
    val bounces: Boolean = false,
    val scans: Boolean = false,
    val breathes: Boolean = false,
    val zz: Boolean = false,
    val sweat: Boolean = false,
    val look: Pair<Double, Double>? = null,
    val tilt: Double = 0.0,
)

object KitoConst {
    const val EYE_W = 0.18
    const val EYE_H = 0.34
    const val EYE_SP = 0.30
    const val EYE_P = -0.05
    val BASE_TOP = Rgb(0.655, 0.667, 0.69)    // legacy mascot hood
    val BASE_BOTTOM = Rgb(0.467, 0.478, 0.506) // shaded shell

    val C_IDLE = Rgb(1.0, 0.541, 0.502)
    val C_WORKING = Rgb(0.373, 0.839, 1.0)
    val C_THINKING = Rgb(0.545, 0.361, 0.965)
    val C_SEARCHING = Rgb(0.388, 0.396, 0.949)
    val C_APPROVAL = Rgb(1.0, 0.694, 0.231)
    val C_QUESTION = Rgb(0.133, 0.827, 0.933)
    val C_ERROR = Rgb(0.957, 0.314, 0.369)
    val C_FINISHED = Rgb(0.31, 0.878, 0.627)
    val C_RATELIMIT = Rgb(0.984, 0.573, 0.235)
    val C_SLEEPING = Rgb(0.478, 0.498, 0.529)
    val C_DIZZY = Rgb(0.957, 0.447, 0.714)

    val STATES: Map<BotState, BotStateCfg> = mapOf(
        BotState.IDLE to BotStateCfg(C_IDLE, 0.0, EyeShape.PILL, null),
        BotState.WORKING to BotStateCfg(C_WORKING, 0.0, EyeShape.WIDE, Badge(BadgeKind.DOTS, C_WORKING)),
        BotState.THINKING to BotStateCfg(C_THINKING, 0.0, EyeShape.DOT, Badge(BadgeKind.DOTS, C_THINKING), look = 0.42 to -0.38),
        BotState.SEARCHING to BotStateCfg(C_SEARCHING, 0.0, EyeShape.LINE, Badge(BadgeKind.DOTS, C_SEARCHING), scans = true),
        BotState.APPROVAL to BotStateCfg(C_APPROVAL, 0.0, EyeShape.WIDE, Badge(BadgeKind.BANG, C_APPROVAL)),
        BotState.QUESTION to BotStateCfg(C_QUESTION, 0.0, EyeShape.CUP, Badge(BadgeKind.QUESTION, C_QUESTION)),
        BotState.ERROR to BotStateCfg(C_ERROR, 0.0, EyeShape.FLAT, Badge(BadgeKind.DOT, C_ERROR)),
        BotState.FINISHED to BotStateCfg(C_FINISHED, 0.0, EyeShape.HAPPY, Badge(BadgeKind.DOT, C_FINISHED)),
        BotState.RATELIMIT to BotStateCfg(C_RATELIMIT, 0.0, EyeShape.TIRED, Badge(BadgeKind.DOT, C_RATELIMIT), sweat = true),
        BotState.SLEEPING to BotStateCfg(C_SLEEPING, 0.0, EyeShape.CLOSED, null, breathes = true, zz = true),
        BotState.DIZZY to BotStateCfg(C_DIZZY, 0.0, EyeShape.SPIRAL, null),
    )

    /** State to sound file name (res/raw), as STATE_SOUND in engine.ts. */
    val STATE_SOUND: Map<BotState, String> = mapOf(
        BotState.WORKING to "work", BotState.THINKING to "think", BotState.SEARCHING to "search",
        BotState.APPROVAL to "approval", BotState.QUESTION to "question", BotState.ERROR to "error",
        BotState.FINISHED to "finish", BotState.RATELIMIT to "rate", BotState.SLEEPING to "sleep",
        BotState.DIZZY to "dizzy",
    )

    val EMOTE_EYE: Map<BotEmote, EyeShape> = mapOf(
        BotEmote.LOVE to EyeShape.HEART, BotEmote.SURPRISED to EyeShape.WIDE, BotEmote.PROUD to EyeShape.STAR,
        BotEmote.WINK to EyeShape.WINK, BotEmote.YAWN to EyeShape.CUP, BotEmote.HAPPY to EyeShape.HAPPY,
        BotEmote.ANNOYED to EyeShape.FLAT,
    )
}
