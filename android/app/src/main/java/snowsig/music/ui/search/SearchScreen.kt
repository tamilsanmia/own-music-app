package snowsig.music.ui.search

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import snowsig.music.data.api.GenreDto
import snowsig.music.data.api.MusicApi
import snowsig.music.data.api.SearchDto
import snowsig.music.data.api.userMessage
import snowsig.music.playback.toQueueTrack
import snowsig.music.ui.common.Loadable
import snowsig.music.ui.common.loadInto
import snowsig.music.ui.genre.GenreTile
import snowsig.music.ui.components.Artwork
import snowsig.music.ui.components.EmptyNote
import snowsig.music.ui.components.Loading
import snowsig.music.ui.components.LocalNavigator
import snowsig.music.ui.components.SectionTitle
import snowsig.music.ui.components.TrackRow
import snowsig.music.ui.player.PlayerViewModel
import snowsig.music.ui.theme.MusicColors
import javax.inject.Inject

const val SEARCH_DEBOUNCE_MS = 300L

sealed interface SearchResultState {
    data object Idle : SearchResultState
    data class Loading(val query: String) : SearchResultState
    data class Results(val query: String, val results: SearchDto) : SearchResultState {
        val isEmpty get() = results.tracks.isEmpty() && results.albums.isEmpty() && results.artists.isEmpty()
    }
    data class Error(val query: String, val message: String) : SearchResultState
}

@OptIn(FlowPreview::class)
@HiltViewModel
class SearchViewModel @Inject constructor(private val api: MusicApi) : ViewModel() {
    private val _query = MutableStateFlow("")
    val query: StateFlow<String> = _query.asStateFlow()

    private val _results = MutableStateFlow<SearchResultState>(SearchResultState.Idle)
    val results: StateFlow<SearchResultState> = _results.asStateFlow()

    private val _genres = MutableStateFlow(Loadable<List<GenreDto>>())
    /** Shown while the search box is empty. */
    val genres: StateFlow<Loadable<List<GenreDto>>> = _genres.asStateFlow()

    init {
        viewModelScope.loadInto(_genres) { api.genres() }
        viewModelScope.launch {
            // Wait for a pause in typing, skip repeats, and cancel an older search when a newer one starts.
            _query.debounce(SEARCH_DEBOUNCE_MS).map { it.trim() }.distinctUntilChanged().collectLatest { q ->
                if (q.isEmpty()) {
                    _results.value = SearchResultState.Idle
                    return@collectLatest
                }
                _results.value = SearchResultState.Loading(q)
                _results.value = try {
                    SearchResultState.Results(q, api.search(q))
                } catch (e: Exception) {
                    if (e is kotlinx.coroutines.CancellationException) throw e
                    SearchResultState.Error(q, e.userMessage())
                }
            }
        }
    }

    fun onQuery(value: String) {
        _query.value = value.take(100)
    }
}

@Composable
fun SearchScreen(contentPadding: PaddingValues, vm: SearchViewModel = hiltViewModel(), player: PlayerViewModel = hiltViewModel()) {
    val query by vm.query.collectAsStateWithLifecycle()
    val results by vm.results.collectAsStateWithLifecycle()
    val genres by vm.genres.collectAsStateWithLifecycle()
    val playerState by player.state.collectAsStateWithLifecycle()
    val nav = LocalNavigator.current

    Column(Modifier.fillMaxSize().padding(top = contentPadding.calculateTopPadding())) {
        TextField(
            value = query,
            onValueChange = vm::onQuery,
            placeholder = { Text("What do you want to listen to?") },
            leadingIcon = { Icon(Icons.Filled.Search, null) },
            trailingIcon = {
                if (query.isNotEmpty()) IconButton(onClick = { vm.onQuery("") }) { Icon(Icons.Filled.Clear, "Clear search") }
            },
            singleLine = true,
            shape = RoundedCornerShape(24.dp),
            colors = TextFieldDefaults.colors(
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
                focusedContainerColor = MusicColors.Surface3,
                unfocusedContainerColor = MusicColors.Surface3,
            ),
            modifier = Modifier.fillMaxWidth().padding(16.dp).semantics { contentDescription = "Search" },
        )
        when (val r = results) {
            SearchResultState.Idle -> BrowseGenres(genres.data.orEmpty(), contentPadding, nav::openGenre)
            is SearchResultState.Loading -> Loading()
            is SearchResultState.Error -> EmptyNote(r.message)
            is SearchResultState.Results -> if (r.isEmpty) {
                EmptyNote("No results for “${r.query}”. Check the spelling or try fewer words.")
            } else {
                val queue = r.results.tracks.map { it.toQueueTrack() }
                LazyColumn(contentPadding = PaddingValues(bottom = contentPadding.calculateBottomPadding())) {
                    if (queue.isNotEmpty()) item { SectionTitle("Songs") }
                    itemsIndexed(queue, key = { _, t -> "t-${t.id}" }) { i, t ->
                        TrackRow(t, number = null, isCurrent = t.id == playerState.current?.id, onClick = { player.playOrToggle(queue, i) }, showArt = true)
                    }
                    if (r.results.artists.isNotEmpty()) item { SectionTitle("Artists") }
                    items(r.results.artists, key = { "ar-${it.id}" }) { a ->
                        Row(
                            Modifier.fillMaxWidth().clickable { nav.openArtist(a.id) }.padding(horizontal = 16.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Artwork(a.image, Modifier.size(56.dp), round = true)
                            Column(Modifier.padding(start = 12.dp)) {
                                Text(a.name, style = MaterialTheme.typography.bodyLarge)
                                Text("Artist", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    if (r.results.albums.isNotEmpty()) item { SectionTitle("Albums") }
                    items(r.results.albums, key = { "al-${it.id}" }) { a ->
                        Row(
                            Modifier.fillMaxWidth().clickable { nav.openAlbum(a.id) }.padding(horizontal = 16.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Artwork(a.cover, Modifier.size(56.dp))
                            Column(Modifier.padding(start = 12.dp)) {
                                Text(a.title, style = MaterialTheme.typography.bodyLarge)
                                Text("Album · ${a.artist.name}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** "Browse all": genre tiles, two per row. */
@Composable
private fun BrowseGenres(genres: List<GenreDto>, contentPadding: PaddingValues, onOpen: (String) -> Unit) {
    if (genres.isEmpty()) return EmptyNote("Search for songs, albums and artists.")
    LazyVerticalGrid(
        columns = GridCells.Adaptive(minSize = 160.dp),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = contentPadding.calculateBottomPadding() + 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) { Text("Browse all", style = MaterialTheme.typography.titleLarge) }
        gridItems(genres, key = { it.name }) { g -> GenreTile(g, onClick = { onOpen(g.name) }) }
    }
}
