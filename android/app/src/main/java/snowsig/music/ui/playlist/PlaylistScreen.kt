package snowsig.music.ui.playlist

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import snowsig.music.data.PlaylistsRepository
import snowsig.music.data.api.MoveRequest
import snowsig.music.data.api.MusicApi
import snowsig.music.data.api.PlaylistDto
import snowsig.music.data.api.RenamePlaylistRequest
import snowsig.music.data.api.userMessage
import snowsig.music.playback.toQueueTrack
import snowsig.music.ui.common.Loadable
import snowsig.music.ui.common.loadInto
import snowsig.music.ui.components.CollectionHeader
import snowsig.music.ui.components.EmptyNote
import snowsig.music.ui.components.Loading
import snowsig.music.ui.components.PlaylistCover
import snowsig.music.ui.components.TrackMenuItem
import snowsig.music.ui.components.TrackRow
import snowsig.music.ui.components.songsSummary
import snowsig.music.ui.home.ErrorBox
import snowsig.music.ui.player.PlayerViewModel
import javax.inject.Inject

/** Move `from` to `to` in a copy of the list (clamped). */
fun <T> List<T>.moved(from: Int, to: Int): List<T> {
    val copy = toMutableList()
    val item = copy.removeAt(from)
    copy.add(to.coerceIn(0, copy.size), item)
    return copy
}

/** Reorder and remove update the screen at once and are undone if the server refuses. */
@HiltViewModel
class PlaylistViewModel @Inject constructor(
    saved: SavedStateHandle,
    private val api: MusicApi,
    private val playlists: PlaylistsRepository,
) : ViewModel() {
    val id: String = checkNotNull(saved["id"])
    private val _state = MutableStateFlow(Loadable<PlaylistDto>())
    val state: StateFlow<Loadable<PlaylistDto>> = _state.asStateFlow()
    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    init {
        reload()
    }

    fun reload() = viewModelScope.loadInto(_state) { api.playlist(id) }

    fun move(itemId: String, to: Int) = optimistic({ p ->
        val from = p.items.indexOfFirst { it.itemId == itemId }
        if (from < 0) p else p.copy(items = p.items.moved(from, to))
    }) { api.movePlaylistItem(id, MoveRequest(itemId, to)) }

    fun remove(itemId: String) = optimistic({ p ->
        val items = p.items.filterNot { it.itemId == itemId }
        p.copy(items = items, trackCount = items.size)
    }) { api.removeFromPlaylist(id, itemId) }

    fun rename(name: String) = viewModelScope.launch {
        runCatching { api.renamePlaylist(id, RenamePlaylistRequest(name.trim())) }
            .onSuccess { p -> _state.update { it.copy(data = p) }; playlists.refresh() }
            .onFailure { _message.value = it.userMessage() }
    }

    fun delete(onDeleted: () -> Unit) = viewModelScope.launch {
        runCatching { playlists.delete(id) }.onSuccess { onDeleted() }.onFailure { _message.value = it.userMessage() }
    }

    private fun optimistic(change: (PlaylistDto) -> PlaylistDto, call: suspend () -> PlaylistDto) {
        val before = _state.value.data ?: return
        _state.update { it.copy(data = change(before)) }
        _message.value = null
        viewModelScope.launch {
            try {
                val saved = call()
                _state.update { it.copy(data = saved) }
                playlists.refresh()
            } catch (e: Exception) {
                _state.update { it.copy(data = before) }
                _message.value = "That change couldn’t be saved, so it was undone."
            }
        }
    }
}

@Composable
fun PlaylistScreen(
    contentPadding: PaddingValues,
    onDeleted: () -> Unit,
    vm: PlaylistViewModel = hiltViewModel(),
    player: PlayerViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val playerState by player.state.collectAsStateWithLifecycle()
    var renaming by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    val p = state.data

    when {
        p == null && state.loading -> Loading()
        p == null && state.notFound -> EmptyNote("This playlist doesn’t exist.")
        p == null -> ErrorBox(state.error ?: "Could not load this playlist.", vm::reload)
        else -> {
            val queue = p.items.map { it.track.toQueueTrack() }
            val playingHere = playerState.isPlaying && queue.any { it.id == playerState.current?.id }
            LazyColumn(contentPadding = contentPadding) {
                item {
                    CollectionHeader(
                        art = { PlaylistCover(p.covers, Modifier.fillMaxWidth()) },
                        kind = "Playlist",
                        title = p.name,
                        subtitle = listOfNotNull(p.description, songsSummary(queue.size, queue.sumOf { it.durationMs ?: 0 })).joinToString(" · "),
                        onPlay = if (queue.isEmpty()) null else ({ if (playingHere) player.togglePlay() else player.play(queue, 0) }),
                        playing = playingHere,
                        playLabel = p.name,
                        actions = {
                            IconButton(onClick = { renaming = true }) { Icon(Icons.Filled.Edit, "Rename playlist") }
                            IconButton(onClick = { confirmDelete = true }) { Icon(Icons.Filled.Delete, "Delete playlist") }
                        },
                    )
                }
                message?.let { item { EmptyNote(it) } }
                if (queue.isEmpty()) item { EmptyNote("This playlist is empty. Find songs with Search, then use ⋯ → Add to playlist.") }
                itemsIndexed(p.items, key = { _, item -> item.itemId }) { i, item ->
                    TrackRow(
                        track = queue[i],
                        number = null,
                        isCurrent = queue[i].id == playerState.current?.id,
                        onClick = { player.playOrToggle(queue, i) },
                        showArt = true,
                        extraMenu = listOf(
                            TrackMenuItem("Move up", enabled = i > 0) { vm.move(item.itemId, i - 1) },
                            TrackMenuItem("Move down", enabled = i < p.items.lastIndex) { vm.move(item.itemId, i + 1) },
                            TrackMenuItem("Remove from this playlist") { vm.remove(item.itemId) },
                        ),
                    )
                }
            }
            if (renaming) RenameDialog(p.name, onDismiss = { renaming = false }, onSave = { vm.rename(it); renaming = false })
            if (confirmDelete) {
                AlertDialog(
                    onDismissRequest = { confirmDelete = false },
                    title = { Text("Delete “${p.name}”?") },
                    text = { Text("The songs stay in the library; only this playlist is removed.") },
                    confirmButton = { TextButton(onClick = { confirmDelete = false; vm.delete(onDeleted) }) { Text("Delete") } },
                    dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
                )
            }
        }
    }
}

@Composable
private fun RenameDialog(current: String, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var name by remember { mutableStateOf(current) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Rename playlist") },
        text = { OutlinedTextField(name, { name = it.take(100) }, label = { Text("Name") }, singleLine = true) },
        confirmButton = { TextButton(onClick = { onSave(name) }, enabled = name.isNotBlank()) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
