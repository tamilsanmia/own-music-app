package snowsig.music.data.auth

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import retrofit2.HttpException
import snowsig.music.data.api.AuthApi
import snowsig.music.data.api.LoginRequest
import snowsig.music.data.api.RefreshRequest
import snowsig.music.data.api.SessionDto
import snowsig.music.data.api.UserDto
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

sealed interface SessionState {
    /** Still reading the stored session at startup. */
    data object Unknown : SessionState
    data object SignedOut : SessionState
    data class SignedIn(val user: UserDto) : SessionState
}

/**
 * Owns the login session. The access token lives only in memory; the refresh token is in
 * [TokenStore]. Refreshing is serialized with a mutex because the server rotates refresh tokens
 * and treats reuse of an old one as theft (which would log the user out everywhere).
 */
@Singleton
class SessionManager @Inject constructor(
    private val authApi: AuthApi,
    private val store: TokenStore,
) {
    private val _state = MutableStateFlow<SessionState>(SessionState.Unknown)
    val state: StateFlow<SessionState> = _state.asStateFlow()

    @Volatile
    var accessToken: String? = null
        private set

    private val mutex = Mutex()

    /** Called once at startup. Works offline: a stored user stays signed in until the server says otherwise. */
    suspend fun restore() {
        val stored = store.read()
        if (stored == null) {
            _state.value = SessionState.SignedOut
            return
        }
        if (refresh(failedToken = null) == null && _state.value == SessionState.Unknown) {
            _state.value = stored.user?.let { SessionState.SignedIn(it) } ?: SessionState.SignedOut
        }
    }

    /** Throws on failure; see [snowsig.music.data.api.userMessage] for a displayable message. */
    suspend fun login(email: String, password: String) {
        val session = authApi.login(LoginRequest(email.trim(), password))
        mutex.withLock { accept(session) }
    }

    /**
     * Get a fresh access token. If [failedToken] is no longer the current token, another request
     * already refreshed and the current one is returned without calling the server.
     * Returns null when there is no session (signed out) or the server can't be reached.
     */
    suspend fun refresh(failedToken: String?): String? = mutex.withLock {
        val current = accessToken
        if (current != null && current != failedToken) return current
        val stored = store.read() ?: run {
            signOutLocally()
            return null
        }
        try {
            accept(authApi.refresh(RefreshRequest(stored.refreshToken)))
            accessToken
        } catch (e: HttpException) {
            if (e.code() == 401 || e.code() == 403) signOutLocally()
            null
        } catch (e: IOException) {
            null // offline: keep the session, try again later
        }
    }

    suspend fun logout() {
        val token = mutex.withLock {
            val t = store.read()?.refreshToken
            signOutLocally()
            t
        }
        if (token != null) runCatching { authApi.logout(RefreshRequest(token)) }
    }

    private suspend fun accept(session: SessionDto) {
        store.save(session.refreshToken, session.user)
        accessToken = session.accessToken
        _state.value = SessionState.SignedIn(session.user)
    }

    private suspend fun signOutLocally() {
        accessToken = null
        store.clear()
        _state.value = SessionState.SignedOut
    }
}
