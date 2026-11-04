package snowsig.music.ui.library

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import snowsig.music.data.LikesRepository
import snowsig.music.data.PlaylistsRepository
import snowsig.music.data.api.MusicApi
import snowsig.music.data.api.PlaylistSummaryDto
import snowsig.music.data.api.TrackDto
import snowsig.music.data.api.userMessage
import snowsig.music.playback.toQueueTrack
import snowsig.music.ui.common.Loadable
import snowsig.music.ui.common.loadInto
import snowsig.music.ui.components.CollectionHeader
import snowsig.music.ui.components.EmptyNote
import snowsig.music.ui.components.Loading
import snowsig.music.ui.components.LocalNavigator
import snowsig.music.ui.components.PlaylistCover
import snowsig.music.ui.components.SectionTitle
import snowsig.music.ui.components.TrackRow
import snowsig.music.ui.components.songsSummary
import snowsig.music.ui.home.ErrorBox
import snowsig.music.ui.player.PlayerViewModel
import javax.inject.Inject

@HiltViewModel
class LibraryViewModel @Inject constructor(
    private val api: MusicApi,
    private val playlistsRepo: PlaylistsRepository,
    private val likes: LikesRepository,
) : ViewModel() {
    val playlists: StateFlow<List<PlaylistSummaryDto>?> = playlistsRepo.playlists
    val likedCount = likes.ids
    private val _recent = MutableStateFlow(Loadable<List<TrackDto>>())
    val recent: StateFlow<Loadable<List<TrackDto>>> = _recent.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    fun refresh() {
        viewModelScope.launch { playlistsRepo.refresh() }
        viewModelScope.launch { likes.refresh() }
        viewModelScope.loadInto(_recent) { api.recent().items }
    }

    fun createPlaylist(onCreated: (String) -> Unit) = viewModelScope.launch {
        runCatching { playlistsRepo.create() }.onSuccess { onCreated(it.id) }.onFailure { _error.value = it.userMessage() }
    }
}

@Composable
fun LibraryScreen(
    contentPadding: PaddingValues,
    onOpenLiked: () -> Unit,
    onOpenDownloads: (() -> Unit)? = null,
    vm: LibraryViewModel = hiltViewModel(),
    player: PlayerViewModel = hiltViewModel(),
) {
    LaunchedEffect(Unit) { vm.refresh() }
    val playlists by vm.playlists.collectAsStateWithLifecycle()
    val liked by vm.likedCount.collectAsStateWithLifecycle()
    val recent by vm.recent.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val playerState by player.state.collectAsStateWithLifecycle()
    val nav = LocalNavigator.current

    LazyColumn(contentPadding = contentPadding) {
        item {
            Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Your Library", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
                IconButton(onClick = { vm.createPlaylist(nav::openPlaylist) }) { Icon(Icons.Filled.Add, "New playlist") }
            }
        }
        error?.let { item { EmptyNote(it) } }
        item {
            LibraryEntry(
                title = "Liked Songs",
                subtitle = "Playlist · ${liked.size} ${if (liked.size == 1) "song" else "songs"}",
                art = { GradientTile { Icon(Icons.Filled.Favorite, null, tint = Color.White) } },
                onClick = onOpenLiked,
            )
        }
        onOpenDownloads?.let { open ->
            item {
                LibraryEntry(
                    title = "Downloads",
                    subtitle = "Songs on this phone",
                    art = { GradientTile(listOf(Color(0xFF1ED760), Color(0xFF0B6E33))) { Icon(Icons.Filled.Download, null, tint = Color.White) } },
                    onClick = open,
                )
            }
        }
        items(playlists.orEmpty(), key = { it.id }) { p ->
            LibraryEntry(
                title = p.name,
                subtitle = "Playlist · ${p.trackCount} ${if (p.trackCount == 1) "song" else "songs"}",
                art = { PlaylistCover(p.covers, Modifier.size(56.dp)) },
                onClick = { nav.openPlaylist(p.id) },
            )
        }
        if (playlists?.isEmpty() == true) item { EmptyNote("Create a playlist with + and add songs from any ⋯ menu.") }
        val recentTracks = recent.data.orEmpty()
        if (recentTracks.isNotEmpty()) {
            item { SectionTitle("Recently played") }
            val queue = recentTracks.map { it.toQueueTrack() }
            itemsIndexed(queue, key = { _, t -> "r-${t.id}" }) { i, t ->
                TrackRow(t, number = null, isCurrent = t.id == playerState.current?.id, onClick = { player.playOrToggle(queue, i) }, showArt = true)
            }
        }
    }
}

@Composable
private fun GradientTile(colors: List<Color> = listOf(Color(0xFF4F46E5), Color(0xFF7DD3FC)), icon: @Composable () -> Unit) {
    Box(Modifier.size(56.dp).clip(RoundedCornerShape(6.dp)).background(Brush.linearGradient(colors)), contentAlignment = Alignment.Center) { icon() }
}

@Composable
private fun LibraryEntry(title: String, subtitle: String, art: @Composable () -> Unit, onClick: () -> Unit) {
    ListItem(
        headlineContent = { Text(title) },
        supportingContent = { Text(subtitle) },
        leadingContent = art,
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.clickable(onClick = onClick),
    )
}

// ---- Liked Songs ----

@HiltViewModel
class LikedViewModel @Inject constructor(private val api: MusicApi, likes: LikesRepository) : ViewModel() {
    private val _state = MutableStateFlow(Loadable<List<TrackDto>>())
    val state: StateFlow<Loadable<List<TrackDto>>> = _state.asStateFlow()
    /** Hide songs unliked here at once, before the list reloads. */
    val likedIds = likes.ids

    init {
        reload()
        viewModelScope.launch { likes.changes.collect { reload() } }
    }

    fun reload() = viewModelScope.loadInto(_state) {
        val all = mutableListOf<TrackDto>()
        var offset = 0
        while (true) {
            val page = api.likes(limit = 100, offset = offset)
            all += page.items
            if (page.items.size < 100) break
            offset += 100
        }
        all
    }
}

@Composable
fun LikedScreen(contentPadding: PaddingValues, vm: LikedViewModel = hiltViewModel(), player: PlayerViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val likedIds by vm.likedIds.collectAsStateWithLifecycle()
    val playerState by player.state.collectAsStateWithLifecycle()
    val tracks = state.data?.filter { it.id in likedIds }
    when {
        tracks == null && state.loading -> Loading()
        tracks == null -> ErrorBox(state.error ?: "Could not load your liked songs.", vm::reload)
        else -> {
            val queue = tracks.map { it.toQueueTrack() }
            val playingHere = playerState.isPlaying && queue.any { it.id == playerState.current?.id }
            LazyColumn(contentPadding = contentPadding, verticalArrangement = Arrangement.Top) {
                item {
                    CollectionHeader(
                        art = { GradientTile { Icon(Icons.Filled.Favorite, null, tint = Color.White, modifier = Modifier.size(28.dp)) } },
                        kind = "Playlist",
                        title = "Liked Songs",
                        subtitle = songsSummary(queue.size, queue.sumOf { it.durationMs ?: 0 }),
                        onPlay = if (queue.isEmpty()) null else ({ if (playingHere) player.togglePlay() else player.play(queue, 0) }),
                        playing = playingHere,
                        playLabel = "Liked Songs",
                    )
                }
                if (queue.isEmpty()) item { EmptyNote("Songs you like appear here. Tap the heart next to any song.") }
                itemsIndexed(queue, key = { _, t -> t.id }) { i, t ->
                    TrackRow(t, number = null, isCurrent = t.id == playerState.current?.id, onClick = { player.playOrToggle(queue, i) }, showArt = true)
                }
            }
        }
    }
}
