package snowsig.music.ui.player

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import snowsig.music.playback.PlayerUiState
import snowsig.music.playback.RepeatMode
import snowsig.music.ui.components.Artwork
import snowsig.music.ui.theme.MusicColors

/** 185000 -> "3:05". */
fun formatTime(ms: Long): String {
    val total = (ms / 1000).coerceAtLeast(0)
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

/** Slim bar above the bottom navigation while something is queued. Tap to open Now Playing. */
@Composable
fun MiniPlayer(
    state: PlayerUiState,
    onOpen: () -> Unit,
    onToggle: () -> Unit,
    trailing: @Composable () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val track = state.current ?: return
    Column(
        modifier
            .padding(horizontal = 8.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(MusicColors.Surface3)
            .clickable(onClick = onOpen)
            .semantics { contentDescription = "Now playing: ${track.title}. Open player" },
    ) {
        Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Artwork(track.album.cover, Modifier.size(40.dp))
            Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                Text(track.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(track.artist.name, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            trailing()
            PlayPauseButton(state, onToggle, small = true)
        }
        LinearProgressIndicator(
            progress = { if (state.durationMs > 0) state.positionMs.toFloat() / state.durationMs else 0f },
            modifier = Modifier.fillMaxWidth().height(2.dp).padding(horizontal = 8.dp),
            color = MaterialTheme.colorScheme.onSurface,
            trackColor = Color.White.copy(alpha = 0.2f),
            drawStopIndicator = {},
        )
    }
}

@Composable
private fun PlayPauseButton(state: PlayerUiState, onToggle: () -> Unit, small: Boolean = false) {
    val label = if (state.isPlaying) "Pause" else "Play"
    if (small) {
        IconButton(onClick = onToggle, modifier = Modifier.semantics { contentDescription = label }) {
            if (state.buffering) {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            } else {
                Icon(if (state.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow, contentDescription = null)
            }
        }
    } else {
        FilledIconButton(
            onClick = onToggle,
            modifier = Modifier.size(68.dp).semantics { contentDescription = label },
            shape = CircleShape,
            colors = IconButtonDefaults.filledIconButtonColors(containerColor = Color.White, contentColor = Color.Black),
        ) {
            if (state.buffering) {
                CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 3.dp, color = Color.Black)
            } else {
                Icon(if (state.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.size(36.dp))
            }
        }
    }
}

/** Full-screen player. `extraActions` sits next to the title (e.g. the like button). */
@Composable
fun NowPlayingScreen(
    state: PlayerUiState,
    vm: PlayerViewModel,
    onClose: () -> Unit,
    extraActions: @Composable () -> Unit = {},
) {
    BackHandler(onBack = onClose)
    val track = state.current ?: return
    var dragging by remember { mutableStateOf<Float?>(null) }
    val duration = state.durationMs.coerceAtLeast(1)
    val shown = dragging?.toLong() ?: state.positionMs

    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .systemBarsPadding()
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(Icons.Filled.KeyboardArrowDown, contentDescription = "Close player") }
            Text(
                track.album.title,
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.weight(1f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Spacer(Modifier.weight(1f))
        Artwork(track.album.cover, Modifier.fillMaxWidth().widthIn(max = 420.dp), large = true, contentDescription = "${track.album.title} cover")
        Spacer(Modifier.weight(1f))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(track.title, style = MaterialTheme.typography.headlineSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(track.artist.name, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            extraActions()
        }
        Spacer(Modifier.height(16.dp))
        Slider(
            value = shown.toFloat().coerceIn(0f, duration.toFloat()),
            valueRange = 0f..duration.toFloat(),
            onValueChange = { dragging = it },
            onValueChangeFinished = {
                dragging?.let { vm.seekTo(it.toLong()) }
                dragging = null
            },
            colors = SliderDefaults.colors(thumbColor = Color.White, activeTrackColor = Color.White),
            modifier = Modifier.semantics { contentDescription = "Seek"; stateDescription = formatTime(shown) },
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(formatTime(shown), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(formatTime(state.durationMs), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
        Row(
            Modifier.fillMaxWidth().padding(vertical = 16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ToggleIcon(
                active = state.shuffle,
                label = if (state.shuffle) "Shuffle on" else "Shuffle off",
                onClick = vm::toggleShuffle,
            ) { Icon(Icons.Filled.Shuffle, null) }
            IconButton(onClick = vm::previous, modifier = Modifier.size(56.dp)) {
                Icon(Icons.Filled.SkipPrevious, contentDescription = "Previous", modifier = Modifier.size(40.dp))
            }
            PlayPauseButton(state, vm::togglePlay)
            IconButton(onClick = vm::next, modifier = Modifier.size(56.dp)) {
                Icon(Icons.Filled.SkipNext, contentDescription = "Next", modifier = Modifier.size(40.dp))
            }
            ToggleIcon(
                active = state.repeat != RepeatMode.Off,
                label = when (state.repeat) { RepeatMode.Off -> "Repeat off"; RepeatMode.All -> "Repeat all"; RepeatMode.One -> "Repeat one" },
                onClick = vm::cycleRepeat,
            ) { Icon(if (state.repeat == RepeatMode.One) Icons.Filled.RepeatOne else Icons.Filled.Repeat, null) }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun ToggleIcon(active: Boolean, label: String, onClick: () -> Unit, icon: @Composable () -> Unit) {
    Box(contentAlignment = Alignment.BottomCenter) {
        IconButton(
            onClick = onClick,
            colors = IconButtonDefaults.iconButtonColors(contentColor = if (active) MusicColors.Primary else MusicColors.Muted),
            modifier = Modifier.semantics { contentDescription = label },
        ) { icon() }
        if (active) Box(Modifier.size(4.dp).clip(CircleShape).background(MusicColors.Primary))
    }
}
