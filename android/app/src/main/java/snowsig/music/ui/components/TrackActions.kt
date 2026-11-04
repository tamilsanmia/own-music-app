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
import snowsig.music.data.api.PlaylistSummaryDto
import snowsig.music.data.api.userMessage
import javax.inject.Inject

/** Navigation that any screen or row can trigger. Provided by MainScreen. */
interface AppNavigator {
    fun openAlbum(id: String)
    fun openArtist(id: String)
    fun openPlaylist(id: String)
}

val LocalNavigator = staticCompositionLocalOf<AppNavigator> {
    object : AppNavigator {
        override fun openAlbum(id: String) {}
        override fun openArtist(id: String) {}
        override fun openPlaylist(id: String) {}
    }
}

/** Likes and "Add to playlist", shared by track rows, Now Playing and the Library. */
@HiltViewModel
class TrackActionsViewModel @Inject constructor(
    private val likes: LikesRepository,
    private val playlists: PlaylistsRepository,
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
