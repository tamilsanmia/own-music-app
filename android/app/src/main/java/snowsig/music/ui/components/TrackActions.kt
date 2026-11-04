package snowsig.music.ui.components

import androidx.compose.runtime.staticCompositionLocalOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import snowsig.music.data.LikesRepository
import snowsig.music.data.PlaylistsRepository
import snowsig.music.data.api.MusicApi
import snowsig.music.data.api.PlaylistSummaryDto
import snowsig.music.data.api.RadioRequest
import snowsig.music.data.api.userMessage
import snowsig.music.playback.PlayerConnection
import snowsig.music.playback.QueueTrack
import snowsig.music.playback.toQueueTrack
import javax.inject.Inject

/** Navigation that any screen or row can trigger. Provided by MainScreen. */
interface AppNavigator {
    fun openAlbum(id: String)
    fun openArtist(id: String)
    fun openPlaylist(id: String)
    fun openGenre(name: String)
    fun openSettings()
}

val LocalNavigator = staticCompositionLocalOf<AppNavigator> {
    object : AppNavigator {
        override fun openAlbum(id: String) {}
        override fun openArtist(id: String) {}
        override fun openPlaylist(id: String) {}
        override fun openGenre(name: String) {}
        override fun openSettings() {}
    }
}

/** Likes and "Add to playlist", shared by track rows, Now Playing and the Library. */
@HiltViewModel
class TrackActionsViewModel @Inject constructor(
    private val likes: LikesRepository,
    private val playlists: PlaylistsRepository,
    private val api: MusicApi,
    private val player: PlayerConnection,
) : ViewModel() {
    val likedIds: StateFlow<Set<String>> = likes.ids
    val playlistList: StateFlow<List<PlaylistSummaryDto>?> = playlists.playlists

    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 4)
    /** Short notices for a snackbar ("Added to Road Trip"). */
    val messages: SharedFlow<String> = _messages

    init {
        viewModelScope.launch { likes.errors.collect { _messages.emit(it) } }
    }

    fun toggleLike(trackId: String) = likes.toggle(trackId)

    /** Play the song, followed by similar ones (same artist and genres first). */
    fun startRadio(track: QueueTrack) = viewModelScope.launch {
        runCatching { api.radio(RadioRequest(track.id, listOf(track.id), RADIO_SIZE)).items.map { it.toQueueTrack() } }
            .onSuccess { more ->
                player.play(listOf(track) + more, 0)
                _messages.emit(if (more.isEmpty()) "No similar songs yet" else "Radio: ${track.title}")
            }
            .onFailure { _messages.emit(it.userMessage()) }
    }

    fun playNext(track: QueueTrack) {
        player.playNext(listOf(track))
        _messages.tryEmit("Plays next: ${track.title}")
    }

    fun refreshLikes() = viewModelScope.launch { likes.refresh() }

    fun loadPlaylists() = viewModelScope.launch { playlists.refresh() }

    fun addTo(playlist: PlaylistSummaryDto, trackIds: List<String>) = viewModelScope.launch {
        runCatching { playlists.add(playlist.id, trackIds) }
            .onSuccess { _messages.emit("Added to ${playlist.name}") }
            .onFailure { _messages.emit(it.userMessage()) }
    }

    fun addToNew(trackIds: List<String>) = viewModelScope.launch {
        runCatching {
            val p = playlists.create()
            playlists.add(p.id, trackIds)
            p.name
        }.onSuccess { _messages.emit("Added to $it") }.onFailure { _messages.emit(it.userMessage()) }
    }
}

private const val RADIO_SIZE = 25
