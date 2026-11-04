package snowsig.music.ui.downloads

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.DownloadDone
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.util.UnstableApi
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import snowsig.music.offline.Connectivity
import snowsig.music.offline.DownloadItem
import snowsig.music.offline.DownloadStatus
import snowsig.music.offline.DownloadsRepository
import snowsig.music.playback.QueueTrack
import snowsig.music.ui.components.CollectionHeader
import snowsig.music.ui.components.EmptyNote
import snowsig.music.ui.components.TrackRow
import snowsig.music.ui.components.songsSummary
import snowsig.music.ui.player.PlayerViewModel
import snowsig.music.ui.theme.MusicColors
import javax.inject.Inject

@androidx.annotation.OptIn(UnstableApi::class)
@HiltViewModel
class DownloadsViewModel @Inject constructor(
    private val repo: DownloadsRepository,
    connectivity: Connectivity,
) : ViewModel() {
    val items: StateFlow<Map<String, DownloadItem>> = repo.items
    val online: StateFlow<Boolean> = connectivity.online

    fun download(tracks: List<QueueTrack>) = repo.download(tracks)
    fun remove(trackId: String) = repo.remove(trackId)
    fun remove(tracks: List<QueueTrack>) = tracks.forEach { repo.remove(it.id) }
    fun removeAll() = repo.removeAll()
}

/** Small marker next to a song: downloaded, downloading or failed. */
@Composable
fun DownloadMarker(trackId: String, vm: DownloadsViewModel = hiltViewModel()) {
    val items by vm.items.collectAsStateWithLifecycle()
    val item = items[trackId] ?: return
    when (item.status) {
        DownloadStatus.Done -> Icon(Icons.Filled.DownloadDone, "Downloaded", tint = MusicColors.Primary, modifier = Modifier.size(16.dp))
        DownloadStatus.Failed -> Icon(Icons.Filled.ErrorOutline, "Download failed", tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(16.dp))
        else -> CircularProgressIndicator(
            progress = { item.percent / 100f },
            modifier = Modifier.size(14.dp).semantics { contentDescription = "Downloading" },
            strokeWidth = 2.dp,
        )
    }
}

/** Download / remove all songs of an album or playlist. */
@Composable
fun DownloadAllButton(tracks: List<QueueTrack>, label: String, vm: DownloadsViewModel = hiltViewModel()) {
    val items by vm.items.collectAsStateWithLifecycle()
    var confirm by remember { mutableStateOf(false) }
    if (tracks.isEmpty()) return
    val done = tracks.count { items[it.id]?.status == DownloadStatus.Done }
    val busy = tracks.any { items[it.id]?.status.let { s -> s == DownloadStatus.Queued || s == DownloadStatus.Downloading } }
    IconButton(
        onClick = { if (done == tracks.size) confirm = true else vm.download(tracks) },
        modifier = Modifier.semantics {
            contentDescription = when {
                done == tracks.size -> "Remove download of $label"
                busy -> "Downloading $label"
                else -> "Download $label"
            }
        },
    ) {
        when {
            done == tracks.size -> Icon(Icons.Filled.DownloadDone, null, tint = MusicColors.Primary)
            busy -> CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            else -> Icon(Icons.Filled.Download, null)
        }
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Remove from downloads?") },
            text = { Text("You won’t be able to play $label offline.") },
            confirmButton = { TextButton(onClick = { confirm = false; vm.remove(tracks) }) { Text("Remove") } },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } },
        )
    }
}

/** Shown at the top while the phone is offline. */
@Composable
fun OfflineBanner(vm: DownloadsViewModel = hiltViewModel(), onOpenDownloads: () -> Unit) {
    val online by vm.online.collectAsStateWithLifecycle()
    if (online) return
    Row(
        Modifier.fillMaxWidth().background(MusicColors.Surface3).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.CloudOff, null, modifier = Modifier.size(18.dp))
        Text("You’re offline. Only downloaded songs can play.", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f).padding(start = 8.dp))
        TextButton(onClick = onOpenDownloads) { Text("Downloads") }
    }
}

@Composable
fun DownloadsScreen(contentPadding: PaddingValues, vm: DownloadsViewModel = hiltViewModel(), player: PlayerViewModel = hiltViewModel()) {
    val items by vm.items.collectAsStateWithLifecycle()
    val playerState by player.state.collectAsStateWithLifecycle()
    var confirmAll by remember { mutableStateOf(false) }
    val list = items.values.sortedWith(compareBy({ it.track.album.title }, { it.track.title }))
    val done = list.filter { it.status == DownloadStatus.Done }.map { it.track }
    val bytes = list.sumOf { it.bytes }

    LazyColumn(contentPadding = contentPadding) {
        item {
            CollectionHeader(
                art = { Icon(Icons.Filled.DownloadDone, null, tint = MusicColors.Primary, modifier = Modifier.size(96.dp)) },
                kind = "On this phone",
                title = "Downloads",
                subtitle = songsSummary(done.size, done.sumOf { it.durationMs ?: 0 }) + " · " + "%.1f MB".format(bytes / 1_048_576.0),
                onPlay = if (done.isEmpty()) null else ({ player.play(done, 0) }),
                playing = playerState.isPlaying && done.any { it.id == playerState.current?.id },
                playLabel = "downloads",
                actions = { if (list.isNotEmpty()) TextButton(onClick = { confirmAll = true }) { Text("Remove all") } },
            )
        }
        if (list.isEmpty()) item { EmptyNote("Download albums and playlists with the download button to listen without a connection.") }
        itemsIndexed(list, key = { _, it -> it.track.id }) { _, item ->
            TrackRow(
                track = item.track,
                number = null,
                isCurrent = item.track.id == playerState.current?.id,
                onClick = { if (item.status == DownloadStatus.Done) player.playOrToggle(done, done.indexOfFirst { it.id == item.track.id }) },
                showArt = true,
            )
        }
    }
    if (confirmAll) {
        AlertDialog(
            onDismissRequest = { confirmAll = false },
            title = { Text("Remove all downloads?") },
            text = { Text("This frees the space on your phone. You can download them again later.") },
            confirmButton = { TextButton(onClick = { confirmAll = false; vm.removeAll() }) { Text("Remove all") } },
            dismissButton = { TextButton(onClick = { confirmAll = false }) { Text("Cancel") } },
        )
    }
}
