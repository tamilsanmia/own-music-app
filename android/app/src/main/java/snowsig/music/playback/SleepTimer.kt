package snowsig.music.playback

import android.os.SystemClock
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

sealed interface SleepTimerState {
    data object Off : SleepTimerState
    /** Pause when [SystemClock.elapsedRealtime] reaches [endsAtMs]. */
    data class At(val endsAtMs: Long) : SleepTimerState
    /** Pause when the current song ends. */
    data object EndOfTrack : SleepTimerState
}

/**
 * The sleep timer. The UI sets it; [PlaybackService] carries it out (fades out and pauses).
 * Both run in the app process, so they share this singleton.
 */
@Singleton
class SleepTimer @Inject constructor() {
    /** Replace for tests. Uses elapsed time, so changing the phone's clock doesn't matter. */
    var clock: () -> Long = SystemClock::elapsedRealtime

    private val _state = MutableStateFlow<SleepTimerState>(SleepTimerState.Off)
    val state: StateFlow<SleepTimerState> = _state.asStateFlow()

    fun start(minutes: Int) {
        require(minutes > 0)
        _state.value = SleepTimerState.At(clock() + minutes * 60_000L)
    }

    fun startEndOfTrack() {
        _state.value = SleepTimerState.EndOfTrack
    }

    fun cancel() {
        _state.value = SleepTimerState.Off
    }

    /** Time left for a timed sleep, or null. Never negative. */
    fun remainingMs(): Long? = (state.value as? SleepTimerState.At)?.let { (it.endsAtMs - clock()).coerceAtLeast(0) }

    companion object {
        val CHOICES_MINUTES = listOf(5, 15, 30, 45, 60, 90)
        /** The music fades out over the last seconds before the timer pauses it. */
        const val FADE_OUT_MS = 10_000L
    }
}

/** Volume for "fade between songs": rises over the first [fadeMs] and falls over the last. */
fun fadeVolume(positionMs: Long, durationMs: Long, fadeMs: Long): Float {
    if (fadeMs <= 0 || durationMs <= 0) return 1f
    val fadeIn = positionMs.toFloat() / fadeMs
    val fadeOut = (durationMs - positionMs).toFloat() / fadeMs
    return minOf(1f, fadeIn, fadeOut).coerceIn(0f, 1f)
}

/** Volume while the sleep timer runs out: full until the last [fadeMs], then down to silence. */
fun sleepVolume(remainingMs: Long, fadeMs: Long = SleepTimer.FADE_OUT_MS): Float =
    if (fadeMs <= 0) 1f else (remainingMs.toFloat() / fadeMs).coerceIn(0f, 1f)

/**
 * Autoplay adds similar songs when the last one in the queue starts, unless the user asked to
 * repeat, the queue is empty, or the phone is offline.
 */
fun shouldExtendQueue(autoplay: Boolean, repeatOff: Boolean, hasNext: Boolean, itemCount: Int, online: Boolean): Boolean =
    autoplay && repeatOff && !hasNext && itemCount > 0 && online
