package snowsig.music.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import snowsig.music.data.api.ImageUrls
import snowsig.music.ui.theme.MusicColors

/** Cover, kind ("Album"), title, subtitle and the big green Play button. */
@Composable
fun CollectionHeader(
    art: @Composable () -> Unit,
    kind: String,
    title: String,
    subtitle: String,
    onPlay: (() -> Unit)?,
    playing: Boolean,
    playLabel: String,
    onSubtitleClick: (() -> Unit)? = null,
    actions: @Composable () -> Unit = {},
) {
    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.fillMaxWidth().padding(horizontal = 32.dp), contentAlignment = Alignment.Center) { art() }
        Text(kind, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(title, style = MaterialTheme.typography.headlineMedium)
        Text(
            subtitle,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = if (onSubtitleClick != null) Modifier.clickable(onClick = onSubtitleClick) else Modifier,
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            actions()
            Spacer(Modifier.weight(1f))
            if (onPlay != null) {
                FilledIconButton(
                    onClick = onPlay,
                    modifier = Modifier.size(56.dp).semantics { contentDescription = if (playing) "Pause $playLabel" else "Play $playLabel" },
                    shape = CircleShape,
                    colors = IconButtonDefaults.filledIconButtonColors(containerColor = MusicColors.Primary, contentColor = MusicColors.OnPrimary),
                ) {
                    Icon(if (playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.size(32.dp))
                }
            }
        }
    }
}

/** One cover, or a 2x2 mosaic for playlists with songs from 4+ albums. */
@Composable
fun PlaylistCover(covers: List<ImageUrls>, modifier: Modifier = Modifier) {
    Box(modifier.aspectRatio(1f).clip(RoundedCornerShape(6.dp)).background(MusicColors.Surface3), contentAlignment = Alignment.Center) {
        when {
            covers.isEmpty() -> Icon(Icons.AutoMirrored.Filled.QueueMusic, null, tint = MusicColors.Muted)
            covers.size < 4 -> Artwork(covers[0], Modifier.fillMaxSize())
            else -> Column(Modifier.fillMaxSize()) {
                for (r in 0..1) Row(Modifier.weight(1f)) {
                    for (c in 0..1) Artwork(covers[r * 2 + c], Modifier.weight(1f).fillMaxSize())
                }
            }
        }
    }
}

@Composable
fun Loading(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
}

@Composable
fun EmptyNote(text: String, modifier: Modifier = Modifier) {
    Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = modifier.padding(16.dp))
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.titleLarge, modifier = modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp))
}

/** Total length for headers: "12 songs, 48 min". */
fun songsSummary(count: Int, totalMs: Long): String {
    val minutes = (totalMs / 60_000).toInt()
    val length = if (minutes >= 60) "${minutes / 60} hr ${minutes % 60} min" else "$minutes min"
    return "$count ${if (count == 1) "song" else "songs"}" + if (count > 0) ", $length" else ""
}

@Composable
fun Gap(h: Int = 8) = Spacer(Modifier.height(h.dp).width(1.dp))
