package snowsig.music.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import snowsig.music.data.api.MusicApi
import snowsig.music.di.AppScope
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Liked track ids, shared by every heart in the app. Toggling updates the hearts at once and
 * rolls back if the server refuses.
 */
@Singleton
class LikesRepository @Inject constructor(
    private val api: MusicApi,
    @AppScope private val scope: CoroutineScope,
) {
    private val _ids = MutableStateFlow<Set<String>>(emptySet())
    val ids: StateFlow<Set<String>> = _ids.asStateFlow()

    /** Bumped after every change the server accepted, so lists can reload. */
    private val _changes = MutableSharedFlow<Unit>(extraBufferCapacity = 8)
    val changes: SharedFlow<Unit> = _changes

    private val _errors = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val errors: SharedFlow<String> = _errors

    suspend fun refresh() {
        runCatching { api.likedIds() }.onSuccess { _ids.value = it.toSet() }
    }

    fun toggle(trackId: String) {
        val like = trackId !in _ids.value
        _ids.update { if (like) it + trackId else it - trackId }
        scope.launch {
            try {
                if (like) api.like(trackId) else api.unlike(trackId)
                _changes.emit(Unit)
            } catch (e: Exception) {
                _ids.update { if (like) it - trackId else it + trackId }
                _errors.emit(if (like) "Couldn’t add to Liked Songs." else "Couldn’t remove from Liked Songs.")
            }
        }
    }
}
