package snowsig.music.playback

import android.content.ComponentName
import android.content.Context
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.MoreExecutors
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

enum class RepeatMode { Off, All, One }

/** Everything the player UI shows. Built from the MediaController by [snapshot]. */
data class PlayerUiState(
    val current: QueueTrack? = null,
    val queue: List<QueueTrack> = emptyList(),
    val index: Int = 0,
    val isPlaying: Boolean = false,
    val buffering: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val shuffle: Boolean = false,
    val repeat: RepeatMode = RepeatMode.Off,
    val error: String? = null,
)

/** Plain snapshot of a player, so the mapping to UI state can be unit-tested with a fake player. */
fun snapshot(p: Player): PlayerUiState {
    val items = (0 until p.mediaItemCount).map { p.getMediaItemAt(it).toQueueTrack() }
    val index = p.currentMediaItemIndex.coerceIn(0, (items.size - 1).coerceAtLeast(0))
    val duration = p.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: items.getOrNull(index)?.durationMs ?: 0
    return PlayerUiState(
        current = items.getOrNull(index),
        queue = items,
        index = index,
        isPlaying = p.isPlaying,
        buffering = p.playbackState == Player.STATE_BUFFERING && p.playWhenReady,
        positionMs = p.currentPosition.coerceAtLeast(0),
        durationMs = duration,
        shuffle = p.shuffleModeEnabled,
        repeat = when (p.repeatMode) {
            Player.REPEAT_MODE_ALL -> RepeatMode.All
            Player.REPEAT_MODE_ONE -> RepeatMode.One
            else -> RepeatMode.Off
        },
        error = p.playerError?.let(::describe),
    )
}

fun describe(e: PlaybackException): String = when (e.errorCode) {
    PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
    PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> "No connection. Check your network."
    PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> "This song can’t be played right now."
    else -> "Playback stopped: ${e.errorCodeName}"
}

fun RepeatMode.next(): RepeatMode = when (this) {
    RepeatMode.Off -> RepeatMode.All
    RepeatMode.All -> RepeatMode.One
    RepeatMode.One -> RepeatMode.Off
}

/**
 * The UI's handle on [PlaybackService], through a MediaController. Commands issued before the
 * controller connects are queued and run once it does.
 */
@Singleton
class PlayerConnection @Inject constructor(@ApplicationContext private val context: Context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val _state = MutableStateFlow(PlayerUiState())
    val state: StateFlow<PlayerUiState> = _state.asStateFlow()

    private var controller: MediaController? = null
    private var connecting = false
    private val pending = mutableListOf<(MediaController) -> Unit>()
    private var ticker: Job? = null

    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            publish()
            if (events.contains(Player.EVENT_IS_PLAYING_CHANGED)) updateTicker()
        }
    }

    /** Connect if not yet connected (e.g. when the app starts while music plays in the background). */
    fun connect() {
        if (controller != null || connecting) return
        connecting = true
        val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
        val future = MediaController.Builder(context, token).buildAsync()
        future.addListener({
            connecting = false
            val c = runCatching { future.get() }.getOrNull() ?: return@addListener
            controller = c
            c.addListener(listener)
            pending.forEach { it(c) }
            pending.clear()
            publish()
            updateTicker()
        }, MoreExecutors.directExecutor())
    }

    private fun withController(action: (MediaController) -> Unit) {
        controller?.let { action(it); return }
        pending += action
        connect()
    }

    fun play(tracks: List<QueueTrack>, startIndex: Int) = withController { c ->
        c.setMediaItems(tracks.map { it.toMediaItem() }, startIndex, 0)
        c.prepare()
        c.play()
    }

    /** Toggle; restarts a stopped or failed player. */
    fun togglePlay() = withController { c ->
        if (c.isPlaying) {
            c.pause()
        } else {
            if (c.playbackState == Player.STATE_IDLE) c.prepare()
            if (c.playbackState == Player.STATE_ENDED) c.seekTo(c.currentMediaItemIndex, 0)
            c.play()
        }
    }

    fun next() = withController { it.seekToNext() }

    /** Restarts the song after 3 seconds, otherwise goes back (Media3's default threshold). */
    fun previous() = withController { it.seekToPrevious() }

    fun seekTo(positionMs: Long) = withController { it.seekTo(positionMs) }

    fun skipTo(index: Int) = withController { it.seekTo(index, 0); it.play() }

    fun toggleShuffle() = withController { it.shuffleModeEnabled = !it.shuffleModeEnabled }

    fun cycleRepeat() = withController { c ->
        c.repeatMode = when (snapshot(c).repeat.next()) {
            RepeatMode.Off -> Player.REPEAT_MODE_OFF
            RepeatMode.All -> Player.REPEAT_MODE_ALL
            RepeatMode.One -> Player.REPEAT_MODE_ONE
        }
    }

    /** Logout: stop and forget the queue. */
    fun stop() {
        controller?.run {
            stop()
            clearMediaItems()
        }
        pending.clear()
    }

    fun currentItem(): MediaItem? = controller?.currentMediaItem

    private fun publish() {
        controller?.let { _state.value = snapshot(it) }
    }

    /** Position isn't an event, so poll it twice a second while playing. */
    private fun updateTicker() {
        ticker?.cancel()
        if (controller?.isPlaying != true) return
        ticker = scope.launch {
            while (isActive) {
                publish()
                delay(500)
            }
        }
    }
}
