package snowsig.music.ui.player

import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import snowsig.music.playback.PlayerConnection
import snowsig.music.playback.PlayerUiState
import snowsig.music.playback.QueueTrack
import javax.inject.Inject

@HiltViewModel
class PlayerViewModel @Inject constructor(private val connection: PlayerConnection) : ViewModel() {
    val state: StateFlow<PlayerUiState> = connection.state

    init {
        connection.connect()
    }

    fun play(tracks: List<QueueTrack>, index: Int) = connection.play(tracks, index)

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
