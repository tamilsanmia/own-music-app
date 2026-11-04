package snowsig.music.ui.album

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import snowsig.music.data.api.AlbumDetailDto
import snowsig.music.data.api.AlbumRef
import snowsig.music.data.api.MusicApi
import snowsig.music.playback.QueueTrack
import snowsig.music.playback.toQueueTrack
import snowsig.music.ui.common.Loadable
import snowsig.music.ui.common.loadInto
import snowsig.music.ui.components.Artwork
import snowsig.music.ui.components.CollectionHeader
import snowsig.music.ui.components.EmptyNote
import snowsig.music.ui.components.Loading
import snowsig.music.ui.components.LocalNavigator
import snowsig.music.ui.components.TrackRow
import snowsig.music.ui.components.songsSummary
import snowsig.music.ui.home.ErrorBox
import snowsig.music.ui.player.PlayerViewModel
import javax.inject.Inject

fun AlbumDetailDto.queue(): List<QueueTrack> {
    val ref = AlbumRef(id, title, cover)
    return tracks.map { it.toQueueTrack(ref) }
}

@HiltViewModel
class AlbumViewModel @Inject constructor(saved: SavedStateHandle, private val api: MusicApi) : ViewModel() {
    private val id: String = checkNotNull(saved["id"])
    private val _state = MutableStateFlow(Loadable<AlbumDetailDto>())
    val state: StateFlow<Loadable<AlbumDetailDto>> = _state.asStateFlow()

    init {
        reload()
    }

    fun reload() = viewModelScope.loadInto(_state) { api.album(id) }
}

@Composable
fun AlbumScreen(contentPadding: PaddingValues, vm: AlbumViewModel = hiltViewModel(), player: PlayerViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val playerState by player.state.collectAsStateWithLifecycle()
    val nav = LocalNavigator.current
    val album = state.data

    when {
        album == null && state.loading -> Loading()
        album == null && state.notFound -> EmptyNote("This album isn’t available.")
        album == null -> ErrorBox(state.error ?: "Could not load this album.", vm::reload)
        else -> {
            val queue = album.queue()
            val playingHere = playerState.isPlaying && queue.any { it.id == playerState.current?.id }
            LazyColumn(contentPadding = contentPadding) {
                item {
                    CollectionHeader(
                        art = { Artwork(album.cover, Modifier.fillMaxWidth(), large = true, contentDescription = "${album.title} cover") },
                        kind = "Album",
                        title = album.title,
                        subtitle = listOfNotNull(album.artist.name, album.releaseYear?.toString(), songsSummary(queue.size, queue.sumOf { it.durationMs ?: 0 })).joinToString(" · "),
                        onSubtitleClick = { nav.openArtist(album.artist.id) },
                        onPlay = if (queue.isEmpty()) null else ({ if (playingHere) player.togglePlay() else player.play(queue, 0) }),
                        playing = playingHere,
                        playLabel = "album",
                    )
                }
                itemsIndexed(queue, key = { _, t -> t.id }) { i, t ->
                    TrackRow(
                        track = t,
                        number = album.tracks[i].trackNumber,
                        isCurrent = t.id == playerState.current?.id,
                        onClick = { player.playOrToggle(queue, i) },
                        showArtist = t.artist.id != album.artist.id,
                    )
                }
            }
        }
    }
}
