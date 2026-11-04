package snowsig.music.playback

/** A play counts after this many seconds of actual listening, or half of a shorter-than-a-minute song. */
const val PLAY_COUNT_SECONDS = 30.0

fun playThreshold(durationS: Double): Double =
    if (durationS.isFinite() && durationS > 0) minOf(PLAY_COUNT_SECONDS, durationS / 2) else PLAY_COUNT_SECONDS

/**
 * Counts seconds actually listened from successive playback positions (same rules as the web
 * player). Jumps (seeks) don't count, so skipping to the end of a song doesn't register a play.
 */
class ListenCounter {
    private var listened = 0.0
    private var last: Double? = null
    private var reported = false

    fun reset() {
        listened = 0.0
        last = null
        reported = false
    }

    /** Feed the current position. Returns true exactly once, when the play should be reported. */
    fun tick(positionS: Double, durationS: Double): Boolean {
        val delta = last?.let { positionS - it } ?: 0.0
        last = positionS
        // Ticks come about once a second; anything bigger, or negative, is a seek.
        if (delta > 0 && delta < 3) listened += delta
        if (!reported && listened >= playThreshold(durationS)) {
            reported = true
            return true
        }
        return false
    }
}
