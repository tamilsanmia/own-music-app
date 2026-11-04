package snowsig.music.ui.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import snowsig.music.data.api.AlbumDto
import snowsig.music.data.api.GenreDto
import snowsig.music.data.api.TrackDto
import snowsig.music.ui.components.AlbumCard
import snowsig.music.ui.genre.GenreTile
import snowsig.music.ui.settings.Avatar
import java.time.LocalTime

fun greeting(hour: Int = LocalTime.now().hour): String = when {
    hour < 12 -> "Good morning"
    hour < 18 -> "Good afternoon"
    else -> "Good evening"
}

/**
 * Home: greeting, recently played, your top songs, top songs this week, genres, new albums.
 * [trackRow] draws a horizontal row of songs (`numbered` for charts); it lives in MainScreen
 * because it needs the player. [headerActions] go next to the greeting (e.g. the Cast button).
 */
@Composable
fun HomeScreen(
    displayName: String,
    onOpenAlbum: (String) -> Unit,
    onOpenGenre: (String) -> Unit = {},
    onOpenSettings: () -> Unit = {},
    trackRow: @Composable (tracks: List<TrackDto>, numbered: Boolean) -> Unit = { _, _ -> },
    headerActions: @Composable () -> Unit = {},
    contentPadding: PaddingValues = PaddingValues(),
    vm: HomeViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    HomeContent(state, displayName, onOpenAlbum, vm::refresh, onOpenGenre, onOpenSettings, trackRow, headerActions, contentPadding)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeContent(
    state: HomeUiState,
    displayName: String,
    onOpenAlbum: (String) -> Unit,
    onRefresh: () -> Unit,
    onOpenGenre: (String) -> Unit = {},
    onOpenSettings: () -> Unit = {},
    trackRow: @Composable (tracks: List<TrackDto>, numbered: Boolean) -> Unit = { _, _ -> },
    headerActions: @Composable () -> Unit = {},
    contentPadding: PaddingValues = PaddingValues(),
) {
    PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 150.dp),
            contentPadding = PaddingValues(
                start = 8.dp,
                end = 8.dp,
                top = contentPadding.calculateTopPadding() + 16.dp,
                bottom = contentPadding.calculateBottomPadding() + 16.dp,
            ),
            modifier = Modifier.fillMaxSize(),
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("${greeting()}, $displayName", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
                    headerActions()
                    Avatar(
                        displayName,
                        Modifier.padding(start = 4.dp).size(36.dp).clickable(onClick = onOpenSettings)
                            .semantics { contentDescription = "Profile and settings" },
                    )
                }
            }
            section("Recently played", state.recent) { trackRow(it, false) }
            section("Your top songs", state.mostPlayed) { trackRow(it, false) }
            section("Top this week", state.topThisWeek) { trackRow(it, true) }
            section("Browse genres", state.genres) { GenreRow(it, onOpenGenre) }
            item(span = { GridItemSpan(maxLineSpan) }) {
                Text("New albums", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(8.dp))
            }
            when {
                state.loading -> item(span = { GridItemSpan(maxLineSpan) }) {
                    Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                }
                state.error != null && state.newAlbums.isEmpty() -> item(span = { GridItemSpan(maxLineSpan) }) {
                    ErrorBox(state.error, onRefresh)
                }
                state.newAlbums.isEmpty() -> item(span = { GridItemSpan(maxLineSpan) }) {
                    Text(
                        "Your library is empty for now. Albums appear here once the admin uploads music.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(8.dp),
                    )
                }
                else -> items(state.newAlbums, key = AlbumDto::id) { album ->
                    AlbumCard(album, onClick = { onOpenAlbum(album.id) })
                }
            }
        }
    }
}

/** A titled, full-width section; hidden when there's nothing to show. */
private fun <T> LazyGridScope.section(title: String, items: List<T>, content: @Composable (List<T>) -> Unit) {
    if (items.isEmpty()) return
    item(span = { GridItemSpan(maxLineSpan) }, key = "section-$title") {
        Column(Modifier.padding(horizontal = 8.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleLarge)
            content(items)
        }
    }
}

@Composable
private fun GenreRow(genres: List<GenreDto>, onOpenGenre: (String) -> Unit) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        items(genres, key = { it.name }) { g -> GenreTile(g, onClick = { onOpenGenre(g.name) }, modifier = Modifier.width(170.dp)) }
    }
}

@Composable
fun ErrorBox(message: String, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick = onRetry) { Text("Try again") }
    }
}
