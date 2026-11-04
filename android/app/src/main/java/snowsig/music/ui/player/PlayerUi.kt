package snowsig.music.ui.player

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.material.icons.filled.Album
import androidx.compose.material.icons.filled.Bedtime
import androidx.compose.material.icons.filled.Cast
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Lyrics
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableLongStateOf
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
import androidx.compose.runtime.collectAsState
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.media3.cast.MediaRouteButton
import kotlinx.coroutines.delay
import snowsig.music.playback.PlayerUiState
import snowsig.music.playback.QueueTrack
import snowsig.music.playback.RepeatMode
import snowsig.music.playback.SleepTimer
import snowsig.music.playback.SleepTimerState
import snowsig.music.ui.components.Artwork
import snowsig.music.ui.components.LocalNavigator
import snowsig.music.ui.components.TrackActionsViewModel
import snowsig.music.ui.theme.MusicColors

/** 185000 -> "3:05". */
fun formatTime(ms: Long): String {
    val total = (ms / 1000).coerceAtLeast(0)
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

/** 1.0 -> "1×", 1.25 -> "1.25×". */
fun formatSpeed(speed: Float): String = (if (speed % 1f == 0f) speed.toInt().toString() else speed.toString().trimEnd('0')) + "×"

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
                val sub = if (state.casting) "Casting · ${track.artist.name}" else track.artist.name
                Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            trailing()
            PlayPauseButton(state, onToggle, small = true)
        }
        LinearProgressIndicator(
            progress = { if (state.durationMs > 0) state.positionMs.toFloat() / state.durationMs else 0f },
            modifier = Modifier.fillMaxWidth().height(2.dp).padding(horizontal = 8.dp),
            color = MaterialTheme.colorScheme.onSurface,
            trackColor = MusicColors.Foreground.copy(alpha = 0.2f),
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
            colors = IconButtonDefaults.filledIconButtonColors(containerColor = MusicColors.Foreground, contentColor = MusicColors.Background),
        ) {
            if (state.buffering) {
                CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 3.dp, color = MusicColors.Background)
            } else {
                Icon(if (state.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.size(36.dp))
            }
        }
    }
}

/** Which sheet is open over Now Playing. */
private enum class PlayerSheet { Sleep, Speed }

/**
 * Full-screen player. `extraActions` sits next to the title (e.g. the like button).
 * [onOpenLyrics] and [onOpenEqualizer] open those screens.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NowPlayingScreen(
    state: PlayerUiState,
    vm: PlayerViewModel,
    onClose: () -> Unit,
    onOpenLyrics: () -> Unit,
    onOpenEqualizer: () -> Unit,
    extraActions: @Composable () -> Unit = {},
    actions: TrackActionsViewModel = hiltViewModel(),
) {
    BackHandler(onBack = onClose)
    val track = state.current ?: return
    var dragging by remember { mutableStateOf<Float?>(null) }
    var sheet by remember { mutableStateOf<PlayerSheet?>(null) }
    val sleep by vm.sleep.collectAsState()
    val settings by vm.settings.collectAsState()
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
            CastButton()
            PlayerMenu(
                track = track,
                speed = state.speed,
                onSleep = { sheet = PlayerSheet.Sleep },
                onSpeed = { sheet = PlayerSheet.Speed },
                onEqualizer = onOpenEqualizer,
                onRadio = { actions.startRadio(track) },
                onClose = onClose,
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
        StatusChips(
            lossless = vm.playsLossless(track),
            casting = state.casting,
            speed = state.speed,
            sleep = sleep,
            remainingMs = vm::sleepRemainingMs,
            onSleep = { sheet = PlayerSheet.Sleep },
            onSpeed = { sheet = PlayerSheet.Speed },
            equalizerOn = settings.equalizer.enabled && !state.casting,
            onEqualizer = onOpenEqualizer,
        )
        Spacer(Modifier.height(8.dp))
        Slider(
            value = shown.toFloat().coerceIn(0f, duration.toFloat()),
            valueRange = 0f..duration.toFloat(),
            onValueChange = { dragging = it },
            onValueChangeFinished = {
                dragging?.let { vm.seekTo(it.toLong()) }
                dragging = null
            },
            colors = SliderDefaults.colors(thumbColor = MusicColors.Foreground, activeTrackColor = MusicColors.Foreground),
            modifier = Modifier.semantics { contentDescription = "Seek"; stateDescription = formatTime(shown) },
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(formatTime(shown), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(formatTime(state.durationMs), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
        Row(
            Modifier.fillMaxWidth().padding(vertical = 12.dp),
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
        TextButton(onClick = onOpenLyrics) {
            Icon(Icons.Filled.Lyrics, contentDescription = null, modifier = Modifier.size(18.dp))
            Text("  Lyrics")
        }
        Spacer(Modifier.height(12.dp))
    }

    when (sheet) {
        PlayerSheet.Sleep -> SleepTimerSheet(sleep, vm, onDismiss = { sheet = null })
        PlayerSheet.Speed -> SpeedSheet(state.speed, onPick = { vm.setSpeed(it); sheet = null }, onDismiss = { sheet = null })
        null -> Unit
    }
}

@Composable
private fun PlayerMenu(
    track: QueueTrack,
    speed: Float,
    onSleep: () -> Unit,
    onSpeed: () -> Unit,
    onEqualizer: () -> Unit,
    onRadio: () -> Unit,
    onClose: () -> Unit,
) {
    val nav = LocalNavigator.current
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "More options") }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text("Sleep timer") }, leadingIcon = { Icon(Icons.Filled.Bedtime, null) }, onClick = { open = false; onSleep() })
            DropdownMenuItem(
                text = { Text("Playback speed (${formatSpeed(speed)})") },
                leadingIcon = { Icon(Icons.Filled.Speed, null) },
                onClick = { open = false; onSpeed() },
            )
            DropdownMenuItem(text = { Text("Equalizer") }, leadingIcon = { Icon(Icons.Filled.GraphicEq, null) }, onClick = { open = false; onEqualizer() })
            DropdownMenuItem(text = { Text("Start radio") }, leadingIcon = { Icon(Icons.Filled.Radio, null) }, onClick = { open = false; onRadio() })
            HorizontalDivider()
            if (track.album.id.isNotEmpty()) {
                DropdownMenuItem(text = { Text("Go to album") }, leadingIcon = { Icon(Icons.Filled.Album, null) }, onClick = {
                    open = false
                    onClose()
                    nav.openAlbum(track.album.id)
                })
            }
            if (track.artist.id.isNotEmpty()) {
                DropdownMenuItem(text = { Text("Go to artist") }, leadingIcon = { Icon(Icons.Filled.Person, null) }, onClick = {
                    open = false
                    onClose()
                    nav.openArtist(track.artist.id)
                })
            }
        }
    }
}

/** Small labels under the title: lossless, casting, speed, sleep timer, equalizer. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StatusChips(
    lossless: Boolean,
    casting: Boolean,
    speed: Float,
    sleep: SleepTimerState,
    remainingMs: () -> Long?,
    onSleep: () -> Unit,
    onSpeed: () -> Unit,
    equalizerOn: Boolean,
    onEqualizer: () -> Unit,
) {
    // Tick once a second so the sleep countdown moves.
    var now by remember { mutableLongStateOf(0L) }
    LaunchedEffect(sleep) {
        while (sleep is SleepTimerState.At) {
            now = System.nanoTime()
            delay(1000)
        }
    }
    FlowRow(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (lossless) Chip("LOSSLESS", highlight = true)
        if (casting) Chip("Casting", icon = { Icon(Icons.Filled.Cast, null, Modifier.size(14.dp)) })
        if (speed != 1f) Chip(formatSpeed(speed), onClick = onSpeed)
        if (equalizerOn) Chip("EQ", onClick = onEqualizer)
        when (sleep) {
            // key(now): redraw the countdown on every tick.
            is SleepTimerState.At -> key(now) {
                Chip("Sleep in ${formatTime(remainingMs() ?: 0)}", icon = { Icon(Icons.Filled.Bedtime, null, Modifier.size(14.dp)) }, onClick = onSleep)
            }
            SleepTimerState.EndOfTrack -> Chip("Sleep after this song", icon = { Icon(Icons.Filled.Bedtime, null, Modifier.size(14.dp)) }, onClick = onSleep)
            SleepTimerState.Off -> Unit
        }
    }
}

@Composable
private fun Chip(text: String, highlight: Boolean = false, icon: (@Composable () -> Unit)? = null, onClick: (() -> Unit)? = null) {
    val color = if (highlight) MusicColors.Primary else MusicColors.Muted
    Row(
        Modifier
            .clip(RoundedCornerShape(50))
            .border(1.dp, color, RoundedCornerShape(50))
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 10.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        icon?.invoke()
        Text(text, style = MaterialTheme.typography.labelSmall, color = color)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SleepTimerSheet(sleep: SleepTimerState, vm: PlayerViewModel, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = MusicColors.Surface2) {
        Text("Sleep timer", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = 16.dp))
        Text(
            "The music fades out and pauses.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )
        val item = @Composable { label: String, onClick: () -> Unit ->
            ListItem(
                headlineContent = { Text(label) },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                modifier = Modifier.clickable { onClick(); onDismiss() },
            )
        }
        SleepTimer.CHOICES_MINUTES.forEach { m -> item(if (m < 60) "$m minutes" else if (m == 60) "1 hour" else "${m / 60} h ${m % 60} min") { vm.sleepIn(m) } }
        item("End of this song") { vm.sleepAtEndOfTrack() }
        if (sleep != SleepTimerState.Off) item("Turn off timer") { vm.cancelSleep() }
        Spacer(Modifier.height(24.dp))
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun SpeedSheet(current: Float, onPick: (Float) -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = MusicColors.Surface2) {
        Text("Playback speed", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = 16.dp))
        Text(
            "The pitch stays the same.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )
        FlowRow(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PlayerViewModel.SPEEDS.forEach { s ->
                FilterChip(selected = s == current, onClick = { onPick(s) }, label = { Text(formatSpeed(s)) })
            }
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

/** The Cast button: picks a Chromecast or speaker group on the network. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable
fun CastButton(modifier: Modifier = Modifier) = MediaRouteButton(modifier)
