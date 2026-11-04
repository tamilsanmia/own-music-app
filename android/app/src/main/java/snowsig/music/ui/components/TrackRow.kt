package snowsig.music.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Album
import androidx.compose.material.icons.filled.Equalizer
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import snowsig.music.offline.DownloadStatus
import snowsig.music.playback.QueueTrack
import snowsig.music.ui.downloads.DownloadMarker
import snowsig.music.ui.downloads.DownloadsViewModel
import snowsig.music.ui.player.formatTime
import snowsig.music.ui.theme.MusicColors

/** Heart that likes/unlikes a song. */
@Composable
fun LikeButton(trackId: String, title: String, actions: TrackActionsViewModel = hiltViewModel()) {
    val liked by actions.likedIds.collectAsStateWithLifecycle()
    val isLiked = trackId in liked
    IconButton(
        onClick = { actions.toggleLike(trackId) },
        modifier = Modifier.semantics { contentDescription = if (isLiked) "Remove $title from Liked Songs" else "Like $title" },
    ) {
        Icon(
            if (isLiked) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
            contentDescription = null,
            tint = if (isLiked) MusicColors.Primary else MusicColors.Muted,
        )
    }
}

/** An extra entry in a track's ⋯ menu. */
data class TrackMenuItem(val label: String, val enabled: Boolean = true, val onClick: () -> Unit)

/**
 * One song in a list. Tapping plays; the number turns into an equalizer for the playing song.
 * `showArt` adds the album cover (for search, likes and playlists).
 */
@Composable
fun TrackRow(
    track: QueueTrack,
    number: Int?,
    isCurrent: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    showArt: Boolean = false,
    showArtist: Boolean = true,
    extraMenu: List<TrackMenuItem> = emptyList(),
    downloads: DownloadsViewModel = hiltViewModel(),
) {
    val items by downloads.items.collectAsStateWithLifecycle()
    val online by downloads.online.collectAsStateWithLifecycle()
    val download = items[track.id]
    val available = online || download?.status == DownloadStatus.Done
    val downloadMenu = when (download?.status) {
        null, DownloadStatus.Failed -> TrackMenuItem("Download") { downloads.download(listOf(track)) }
        else -> TrackMenuItem("Remove download") { downloads.remove(track.id) }
    }
    Row(
        modifier
            .fillMaxWidth()
            .alpha(if (available) 1f else 0.4f)
            .clickable(enabled = available, onClick = onClick)
            .padding(start = 16.dp, end = 4.dp, top = 6.dp, bottom = 6.dp)
            .semantics { contentDescription = "Play ${track.title}" },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (showArt) {
            Artwork(track.album.cover, Modifier.size(48.dp))
            Spacer(Modifier.width(12.dp))
        } else if (number != null || isCurrent) {
            Box(Modifier.width(32.dp), contentAlignment = Alignment.CenterStart) {
                if (isCurrent) {
                    Icon(Icons.Filled.Equalizer, contentDescription = null, tint = MusicColors.Primary, modifier = Modifier.size(18.dp))
                } else {
                    Text("$number", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        Column(Modifier.weight(1f)) {
            Text(
                track.title,
                style = MaterialTheme.typography.bodyLarge,
                color = if (isCurrent) MusicColors.Primary else MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            val sub = listOfNotNull(track.artist.name.takeIf { showArtist }, track.durationMs?.let(::formatTime)).joinToString(" · ")
            Row(verticalAlignment = Alignment.CenterVertically) {
                DownloadMarker(track.id, downloads)
                if (download != null) Spacer(Modifier.width(6.dp))
                if (sub.isNotEmpty()) {
                    Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        LikeButton(track.id, track.title)
        TrackMenu(track, listOf(downloadMenu) + extraMenu)
    }
}

@Composable
fun TrackMenu(track: QueueTrack, extra: List<TrackMenuItem> = emptyList(), actions: TrackActionsViewModel = hiltViewModel()) {
    val nav = LocalNavigator.current
    var open by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }, modifier = Modifier.semantics { contentDescription = "More options for ${track.title}" }) {
            Icon(Icons.Filled.MoreVert, contentDescription = null, tint = MusicColors.Muted)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text("Add to playlist") },
                leadingIcon = { Icon(Icons.AutoMirrored.Filled.PlaylistAdd, null) },
                onClick = { open = false; adding = true },
            )
            DropdownMenuItem(
                text = { Text("Play next") },
                leadingIcon = { Icon(Icons.AutoMirrored.Filled.QueueMusic, null) },
                onClick = { open = false; actions.playNext(track) },
            )
            DropdownMenuItem(
                text = { Text("Start radio") },
                leadingIcon = { Icon(Icons.Filled.Radio, null) },
                onClick = { open = false; actions.startRadio(track) },
            )
            extra.forEach { item ->
                DropdownMenuItem(text = { Text(item.label) }, enabled = item.enabled, onClick = { open = false; item.onClick() })
            }
            HorizontalDivider()
            if (track.album.id.isNotEmpty()) {
                DropdownMenuItem(text = { Text("Go to album") }, leadingIcon = { Icon(Icons.Filled.Album, null) }, onClick = { open = false; nav.openAlbum(track.album.id) })
            }
            if (track.artist.id.isNotEmpty()) {
                DropdownMenuItem(text = { Text("Go to artist") }, leadingIcon = { Icon(Icons.Filled.Person, null) }, onClick = { open = false; nav.openArtist(track.artist.id) })
            }
        }
    }
    if (adding) AddToPlaylistSheet(listOf(track.id), track.title, onDismiss = { adding = false })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddToPlaylistSheet(
    trackIds: List<String>,
    label: String,
    onDismiss: () -> Unit,
    actions: TrackActionsViewModel = hiltViewModel(),
) {
    val playlists by actions.playlistList.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { actions.loadPlaylists() }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = MusicColors.Surface2) {
        Text("Add to playlist", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = 16.dp))
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
        LazyColumn(Modifier.padding(bottom = 24.dp)) {
            item {
                ListItem(
                    headlineContent = { Text("New playlist") },
                    leadingContent = { Icon(Icons.Filled.Add, null) },
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    modifier = Modifier.clickable { actions.addToNew(trackIds); onDismiss() },
                )
            }
            items(playlists.orEmpty(), key = { it.id }) { p ->
                ListItem(
                    headlineContent = { Text(p.name) },
                    supportingContent = { Text("${p.trackCount} ${if (p.trackCount == 1) "song" else "songs"}") },
                    leadingContent = { PlaylistCover(p.covers, Modifier.size(48.dp)) },
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    modifier = Modifier.clickable { actions.addTo(p, trackIds); onDismiss() },
                )
            }
        }
    }
}
