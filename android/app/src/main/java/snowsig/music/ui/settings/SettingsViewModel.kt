package snowsig.music.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.util.UnstableApi
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import snowsig.music.data.api.ChangePasswordRequest
import snowsig.music.data.api.MusicApi
import snowsig.music.data.api.UpdateProfileRequest
import snowsig.music.data.api.UserDto
import snowsig.music.data.api.userMessage
import snowsig.music.data.auth.SessionManager
import snowsig.music.data.auth.SessionState
import snowsig.music.data.settings.AppSettings
import snowsig.music.data.settings.SettingsStore
import snowsig.music.offline.DownloadItem
import snowsig.music.offline.DownloadsRepository
import snowsig.music.playback.AudioEffects
import snowsig.music.playback.EqualizerInfo
import javax.inject.Inject

/** Minimum password length, as on the server. */
const val MIN_PASSWORD_LENGTH = 8

/** Problems with a password change that can be shown before asking the server. */
fun passwordProblem(current: String, new: String, confirm: String): String? = when {
    current.isEmpty() -> "Enter your current password."
    new.length < MIN_PASSWORD_LENGTH -> "The new password needs at least $MIN_PASSWORD_LENGTH characters."
    new.length > 128 -> "The new password can have at most 128 characters."
    new != confirm -> "The new passwords don’t match."
    new == current -> "The new password is the same as the current one."
    else -> null
}

@HiltViewModel
@androidx.annotation.OptIn(UnstableApi::class)
class SettingsViewModel @Inject constructor(
    private val session: SessionManager,
    private val api: MusicApi,
    private val store: SettingsStore,
    private val downloads: DownloadsRepository,
    private val effects: AudioEffects,
) : ViewModel() {
    val settings: StateFlow<AppSettings> = store.settings
    val user: StateFlow<UserDto?> = session.state
        .map { (it as? SessionState.SignedIn)?.user }
        .stateIn(viewModelScope, SharingStarted.Eagerly, (session.state.value as? SessionState.SignedIn)?.user)
    val downloadItems: StateFlow<Map<String, DownloadItem>> = downloads.items
    val equalizer: StateFlow<EqualizerInfo?> = effects.info

    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val messages: SharedFlow<String> = _messages

    fun update(change: (AppSettings) -> AppSettings) = store.update(change)

    /** [onDone] gets null on success, else the error to show. */
    fun rename(name: String, onDone: (String?) -> Unit) = viewModelScope.launch {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return@launch onDone("Enter a name.")
        runCatching { api.updateProfile(UpdateProfileRequest(trimmed)) }
            .onSuccess { session.updateUser(it); onDone(null); _messages.emit("Name changed") }
            .onFailure { onDone(it.userMessage()) }
    }

    fun changePassword(current: String, new: String, confirm: String, onDone: (String?) -> Unit) = viewModelScope.launch {
        passwordProblem(current, new, confirm)?.let { return@launch onDone(it) }
        runCatching { api.changePassword(ChangePasswordRequest(current, new)) }
            .onSuccess {
                session.replaceSession(it)
                onDone(null)
                _messages.emit("Password changed. Other devices were logged out.")
            }
            .onFailure { onDone(it.userMessage()) }
    }

    fun logout() = viewModelScope.launch { session.logout() }

    fun removeAllDownloads() = downloads.removeAll()

    // ---- equalizer ----

    fun setEqualizerEnabled(on: Boolean) = store.update { s ->
        val bands = equalizer.value?.centerFrequenciesHz?.size ?: 0
        val levels = s.equalizer.bandLevels.ifEmpty { List(bands) { 0 } }
        s.copy(equalizer = s.equalizer.copy(enabled = on, bandLevels = levels))
    }

    fun pickPreset(preset: Int) = store.update { s ->
        val levels = effects.presetLevels(preset) ?: s.equalizer.bandLevels
        s.copy(equalizer = s.equalizer.copy(enabled = true, preset = preset, bandLevels = levels))
    }

    fun setBand(band: Int, level: Int) = store.update { s ->
        val count = equalizer.value?.centerFrequenciesHz?.size ?: return@update s
        val levels = s.equalizer.bandLevels.let { if (it.size == count) it else List(count) { i -> it.getOrElse(i) { 0 } } }
            .toMutableList().also { it[band] = level }
        s.copy(equalizer = s.equalizer.copy(enabled = true, preset = -1, bandLevels = levels))
    }

    fun resetBands() = store.update { s ->
        val count = equalizer.value?.centerFrequenciesHz?.size ?: s.equalizer.bandLevels.size
        s.copy(equalizer = s.equalizer.copy(preset = -1, bandLevels = List(count) { 0 }, bassBoost = 0))
    }

    fun setBassBoost(strength: Int) = store.update { s ->
        s.copy(equalizer = s.equalizer.copy(enabled = true, bassBoost = strength.coerceIn(0, 1000)))
    }
}
