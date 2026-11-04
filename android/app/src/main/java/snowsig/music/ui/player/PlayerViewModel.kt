package snowsig.music.ui.player

import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import snowsig.music.playback.PlayerConnection
import snowsig.music.playback.PlayerUiState
import snowsig.music.playback.QueueTrack
import androidx.media3.common.util.UnstableApi
import snowsig.music.offline.Connectivity
import snowsig.music.offline.DownloadsRepository
import javax.inject.Inject

/** The downloaded subset of [tracks] and where to start in it. */
fun playableOffline(tracks: List<QueueTrack>, index: Int, isDownloaded: (String) -> Boolean): Pair<List<QueueTrack>, Int> {
    val queue = tracks.filter { isDownloaded(it.id) }
    val firstFromChoice = tracks.drop(index).firstOrNull { isDownloaded(it.id) }
    return queue to (firstFromChoice?.let { queue.indexOf(it) } ?: 0)
}

@HiltViewModel
@androidx.annotation.OptIn(UnstableApi::class)
class PlayerViewModel @Inject constructor(
    private val connection: PlayerConnection,
    private val downloads: DownloadsRepository,
    private val connectivity: Connectivity,
) : ViewModel() {
    val state: StateFlow<PlayerUiState> = connection.state

    init {
        connection.connect()
    }

    /** Offline, only downloaded songs are queued (starting from the chosen one, or the next playable). */
    fun play(tracks: List<QueueTrack>, index: Int) {
        if (connectivity.online.value) return connection.play(tracks, index)
        val (queue, start) = playableOffline(tracks, index, downloads::isDownloaded)
        if (queue.isNotEmpty()) connection.play(queue, start)
    }

    /** Clicking the playing song pauses; clicking another plays the list from there. */
    fun playOrToggle(tracks: List<QueueTrack>, index: Int) {
        if (state.value.current?.id == tracks.getOrNull(index)?.id) connection.togglePlay() else play(tracks, index)
    }

    fun togglePlay() = connection.togglePlay()
    fun next() = connection.next()
    fun previous() = connection.previous()
    fun seekTo(ms: Long) = connection.seekTo(ms)
    fun skipTo(index: Int) = connection.skipTo(index)
    fun toggleShuffle() = connection.toggleShuffle()
    fun cycleRepeat() = connection.cycleRepeat()
}
