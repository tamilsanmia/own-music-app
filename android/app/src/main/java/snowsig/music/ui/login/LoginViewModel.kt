package snowsig.music.ui.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import snowsig.music.data.api.userMessage
import snowsig.music.data.auth.SessionManager
import javax.inject.Inject

data class LoginUiState(
    val email: String = "",
    val password: String = "",
    val submitting: Boolean = false,
    val error: String? = null,
) {
    val canSubmit: Boolean get() = !submitting && email.isNotBlank() && password.isNotEmpty()
}

@HiltViewModel
class LoginViewModel @Inject constructor(private val session: SessionManager) : ViewModel() {
    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    fun onEmail(value: String) = _state.update { it.copy(email = value, error = null) }

    fun onPassword(value: String) = _state.update { it.copy(password = value, error = null) }

    /** On success the session changes and AppRoot swaps to the main screen. */
    fun submit() {
        val s = _state.value
        if (!s.canSubmit) return
        _state.update { it.copy(submitting = true, error = null) }
        viewModelScope.launch {
            try {
                session.login(s.email, s.password)
                _state.update { it.copy(submitting = false, password = "") }
            } catch (e: Exception) {
                _state.update { it.copy(submitting = false, error = e.userMessage()) }
            }
        }
    }
}
