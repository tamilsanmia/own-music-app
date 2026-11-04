package snowsig.music.ui.lyrics

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import retrofit2.HttpException
import snowsig.music.data.api.MusicApi
import snowsig.music.data.api.userMessage
import snowsig.music.playback.PlayerUiState
import snowsig.music.ui.components.Loading
import snowsig.music.ui.theme.MusicColors

sealed interface LyricsState {
    data object Loading : LyricsState
    data object None : LyricsState
    data class Ready(val lines: List<LyricLine>, val synced: Boolean) : LyricsState
    data class Error(val message: String) : LyricsState
}

@HiltViewModel
class LyricsViewModel @javax.inject.Inject constructor(private val api: MusicApi) : ViewModel() {
    private val _state = MutableStateFlow<LyricsState>(LyricsState.Loading)
    val state: StateFlow<LyricsState> = _state.asStateFlow()
    private var loadedFor: String? = null
    private var job: Job? = null

    fun load(trackId: String) {
        if (trackId == loadedFor) return
        loadedFor = trackId
        job?.cancel()
        _state.value = LyricsState.Loading
        job = viewModelScope.launch {
            _state.value = try {
                val res = api.lyrics(trackId)
                val text = res.lyrics
                if (text.isNullOrBlank()) LyricsState.None else LyricsState.Ready(parseLyrics(text, res.synced), res.synced)
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                if (e is HttpException && e.code() == 404) LyricsState.None else LyricsState.Error(e.userMessage())
            }
        }
    }
}

/** Full-screen lyrics for the playing song. Synced lyrics follow the music; tap a line to jump there. */
@Composable
fun LyricsScreen(state: PlayerUiState, onSeek: (Long) -> Unit, onClose: () -> Unit, vm: LyricsViewModel = hiltViewModel()) {
    BackHandler(onBack = onClose)
    val track = state.current ?: return
    LaunchedEffect(track.id) { vm.load(track.id) }
    val lyrics by vm.state.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxSize().background(MusicColors.Surface).systemBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(Icons.Filled.KeyboardArrowDown, contentDescription = "Close lyrics") }
            Column(Modifier.weight(1f)) {
                Text(track.title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(track.artist.name, style = MaterialTheme.typography.bodySmall, color = MusicColors.Muted, maxLines = 1)
            }
        }
        when (val l = lyrics) {
            LyricsState.Loading -> Loading()
            LyricsState.None -> Note("No lyrics for this song yet.")
            is LyricsState.Error -> Note(l.message)
            is LyricsState.Ready -> LyricsList(l, state.positionMs, onSeek)
        }
    }
}

@Composable
private fun Note(text: String) {
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Text(text, color = MusicColors.Muted, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun LyricsList(lyrics: LyricsState.Ready, positionMs: Long, onSeek: (Long) -> Unit) {
    val current = if (lyrics.synced) currentLineIndex(lyrics.lines, positionMs) else -1
    val list = rememberLazyListState()
    // Keep the sung line a little above the middle.
    LaunchedEffect(current) { if (current > 2) list.animateScrollToItem((current - 2).coerceAtLeast(0)) }
    LazyColumn(
        state = list,
        contentPadding = PaddingValues(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        itemsIndexed(lyrics.lines) { i, line ->
            val past = lyrics.synced && i < current
            val now = i == current
            Text(
                line.text.ifEmpty { "♪" },
                style = MaterialTheme.typography.headlineSmall.copy(fontWeight = if (now) FontWeight.Bold else FontWeight.SemiBold),
                color = when {
                    !lyrics.synced -> MusicColors.Foreground
                    now -> MusicColors.Foreground
                    past -> MusicColors.Muted.copy(alpha = 0.8f)
                    else -> MusicColors.Muted
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .then(
                        if (line.timeMs != null) {
                            Modifier.clickable { onSeek(line.timeMs) }.semantics { contentDescription = "Play from: ${line.text}" }
                        } else {
                            Modifier
                        },
                    ),
            )
        }
    }
}
