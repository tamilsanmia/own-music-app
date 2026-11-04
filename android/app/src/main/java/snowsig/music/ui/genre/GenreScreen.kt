package snowsig.music.ui.genre

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
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
import snowsig.music.data.api.AlbumDto
import snowsig.music.data.api.GenreDetailDto
import snowsig.music.data.api.GenreDto
import snowsig.music.data.api.MusicApi
import snowsig.music.ui.common.Loadable
import snowsig.music.ui.common.loadInto
import snowsig.music.ui.components.AlbumCard
import snowsig.music.ui.components.Artwork
import snowsig.music.ui.components.EmptyNote
import snowsig.music.ui.components.Loading
import snowsig.music.ui.components.LocalNavigator
import snowsig.music.ui.home.ErrorBox
import javax.inject.Inject

@HiltViewModel
class GenreViewModel @Inject constructor(saved: SavedStateHandle, private val api: MusicApi) : ViewModel() {
    val name: String = checkNotNull(saved["name"])
    private val _state = MutableStateFlow(Loadable<GenreDetailDto>())
    val state: StateFlow<Loadable<GenreDetailDto>> = _state.asStateFlow()

    init {
        reload()
    }

    fun reload() = viewModelScope.loadInto(_state) { api.genre(name) }
}

/** Albums in one genre. */
@Composable
fun GenreScreen(contentPadding: PaddingValues, vm: GenreViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val nav = LocalNavigator.current
    val genre = state.data
    when {
        genre == null && state.loading -> Loading()
        genre == null && state.notFound -> EmptyNote("Nothing in “${vm.name}” right now.")
        genre == null -> ErrorBox(state.error ?: "Could not load this genre.", vm::reload)
        else -> LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 150.dp),
            contentPadding = PaddingValues(start = 8.dp, end = 8.dp, top = contentPadding.calculateTopPadding(), bottom = 16.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                GenreBanner(genre.name, genre.albums.size)
            }
            items(genre.albums, key = AlbumDto::id) { album ->
                AlbumCard(album, onClick = { nav.openAlbum(album.id) }, subtitle = listOfNotNull(album.artist.name, album.releaseYear?.toString()).joinToString(" · "))
            }
        }
    }
}

@Composable
private fun GenreBanner(name: String, albumCount: Int) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(8.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Brush.linearGradient(genreColors(name)))
            .padding(20.dp),
    ) {
        Text("Genre", style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.8f))
        Text(name, style = MaterialTheme.typography.headlineMedium, color = Color.White)
        Text("$albumCount ${if (albumCount == 1) "album" else "albums"}", style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.8f))
    }
}

/** A stable pair of colours per genre name, so each tile keeps its look. */
fun genreColors(name: String): List<Color> {
    val palette = listOf(
        Color(0xFFE13300) to Color(0xFF8C1D00), Color(0xFF1E3264) to Color(0xFF0D1A36), Color(0xFF8D67AB) to Color(0xFF4B2E66),
        Color(0xFF148A08) to Color(0xFF0A4A04), Color(0xFFDC148C) to Color(0xFF7A0B4E), Color(0xFF477D95) to Color(0xFF223F4D),
        Color(0xFFE8115B) to Color(0xFF7D0931), Color(0xFFBA5D07) to Color(0xFF633104),
    )
    val (a, b) = palette[Math.floorMod(name.lowercase().hashCode(), palette.size)]
    return listOf(a, b)
}

/** A coloured tile for a genre, with the newest album's cover in the corner. */
@Composable
fun GenreTile(genre: GenreDto, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .aspectRatio(1.7f)
            .clip(RoundedCornerShape(8.dp))
            .background(Brush.linearGradient(genreColors(genre.name)))
            .clickable(onClick = onClick)
            .semantics { contentDescription = "Genre ${genre.name}, ${genre.albumCount} albums" },
    ) {
        Text(
            genre.name,
            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
            color = Color.White,
            modifier = Modifier.padding(12.dp),
        )
        if (genre.cover != null) {
            Artwork(genre.cover, Modifier.fillMaxWidth(0.42f).aspectRatio(1f).align(Alignment.BottomEnd).padding(start = 8.dp, top = 8.dp))
        }
    }
}
