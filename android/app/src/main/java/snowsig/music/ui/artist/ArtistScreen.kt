package snowsig.music.ui.artist

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import snowsig.music.data.api.ArtistDetailDto
import snowsig.music.data.api.MusicApi
import snowsig.music.ui.common.Loadable
import snowsig.music.ui.common.loadInto
import snowsig.music.ui.components.AlbumCard
import snowsig.music.ui.components.Artwork
import snowsig.music.ui.components.CollectionHeader
import snowsig.music.ui.components.EmptyNote
import snowsig.music.ui.components.Loading
import snowsig.music.ui.components.LocalNavigator
import snowsig.music.ui.components.SectionTitle
import snowsig.music.ui.home.ErrorBox
import javax.inject.Inject

@HiltViewModel
class ArtistViewModel @Inject constructor(saved: SavedStateHandle, private val api: MusicApi) : ViewModel() {
    private val id: String = checkNotNull(saved["id"])
    private val _state = MutableStateFlow(Loadable<ArtistDetailDto>())
    val state: StateFlow<Loadable<ArtistDetailDto>> = _state.asStateFlow()

    init {
        reload()
    }

    fun reload() = viewModelScope.loadInto(_state) { api.artist(id) }
}

@Composable
fun ArtistScreen(contentPadding: PaddingValues, vm: ArtistViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val nav = LocalNavigator.current
    val artist = state.data
    when {
        artist == null && state.loading -> Loading()
        artist == null && state.notFound -> EmptyNote("This artist isn’t available.")
        artist == null -> ErrorBox(state.error ?: "Could not load this artist.", vm::reload)
        else -> LazyVerticalGrid(GridCells.Adaptive(150.dp), contentPadding = contentPadding, modifier = Modifier.padding(horizontal = 8.dp)) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                CollectionHeader(
                    art = { Artwork(artist.image, Modifier.fillMaxWidth(), round = true, large = true, contentDescription = "Photo of ${artist.name}") },
                    kind = "Artist",
                    title = artist.name,
                    subtitle = "${artist.albums.size} ${if (artist.albums.size == 1) "album" else "albums"}",
                    onPlay = null,
                    playing = false,
                    playLabel = artist.name,
                )
            }
            artist.bio?.let { bio ->
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Text(bio, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp))
                }
            }
            item(span = { GridItemSpan(maxLineSpan) }) { SectionTitle("Albums") }
            items(artist.albums, key = { it.id }) { album ->
                AlbumCard(album, onClick = { nav.openAlbum(album.id) }, subtitle = album.releaseYear?.toString() ?: "Album")
            }
        }
    }
}
