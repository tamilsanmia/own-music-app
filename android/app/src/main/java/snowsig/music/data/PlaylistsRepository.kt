package snowsig.music.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import snowsig.music.data.api.AddTracksRequest
import snowsig.music.data.api.CreatePlaylistRequest
import snowsig.music.data.api.MusicApi
import snowsig.music.data.api.PlaylistDto
import snowsig.music.data.api.PlaylistSummaryDto
import javax.inject.Inject
import javax.inject.Singleton

/** The user's playlists, for the Library screen and the "Add to playlist" sheet. */
@Singleton
class PlaylistsRepository @Inject constructor(private val api: MusicApi) {
    private val _playlists = MutableStateFlow<List<PlaylistSummaryDto>?>(null)
    /** null until first loaded. */
    val playlists: StateFlow<List<PlaylistSummaryDto>?> = _playlists.asStateFlow()

    suspend fun refresh() {
        runCatching { api.playlists() }.onSuccess { _playlists.value = it }
    }

    /** "My Playlist #n" unless a name is given. */
    suspend fun create(name: String? = null): PlaylistDto {
        val n = (_playlists.value?.size ?: 0) + 1
        return api.createPlaylist(CreatePlaylistRequest(name ?: "My Playlist #$n")).also { refresh() }
    }

    suspend fun add(playlistId: String, trackIds: List<String>) {
        api.addToPlaylist(playlistId, AddTracksRequest(trackIds))
        refresh()
    }

    suspend fun delete(playlistId: String) {
        api.deletePlaylist(playlistId)
        _playlists.value = _playlists.value?.filterNot { it.id == playlistId }
        refresh()
    }
}
