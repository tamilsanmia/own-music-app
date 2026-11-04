package snowsig.music.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import snowsig.music.data.api.AlbumDto
import snowsig.music.data.api.GenreDto
import snowsig.music.data.api.MusicApi
import snowsig.music.data.api.TrackDto
import snowsig.music.data.api.userMessage
import javax.inject.Inject

data class HomeUiState(
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val newAlbums: List<AlbumDto> = emptyList(),
    val recent: List<TrackDto> = emptyList(),
    val mostPlayed: List<TrackDto> = emptyList(),
    val topThisWeek: List<TrackDto> = emptyList(),
    val genres: List<GenreDto> = emptyList(),
    val error: String? = null,
)

@HiltViewModel
class HomeViewModel @Inject constructor(private val api: MusicApi) : ViewModel() {
    private val _state = MutableStateFlow(HomeUiState())
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun refresh() = load(refreshing = true)

    private fun load(refreshing: Boolean = false) {
        _state.update { it.copy(refreshing = refreshing, error = null) }
        viewModelScope.launch {
            try {
                val home = async { api.home() }
                val recent = async { runCatching { api.recent().items }.getOrDefault(emptyList()) }
                val h = home.await()
                _state.update {
                    HomeUiState(
                        loading = false,
                        newAlbums = h.newAlbums,
                        recent = recent.await().take(8),
                        mostPlayed = h.mostPlayed,
                        topThisWeek = h.topThisWeek,
                        genres = h.genres,
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, refreshing = false, error = e.userMessage()) }
            }
        }
    }
}
