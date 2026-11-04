package snowsig.music.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dagger.hilt.android.lifecycle.HiltViewModel
import snowsig.music.data.auth.SessionManager
import snowsig.music.data.auth.SessionState
import snowsig.music.playback.PlayerConnection
import snowsig.music.ui.login.LoginScreen
import javax.inject.Inject

@HiltViewModel
class AppViewModel @Inject constructor(val session: SessionManager, val player: PlayerConnection) : ViewModel()

/** Login when signed out, the main app when signed in. */
@Composable
fun AppRoot(vm: AppViewModel = hiltViewModel()) {
    val state by vm.session.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { if (state == SessionState.Unknown) vm.session.restore() }
    // Logging out (or being signed out by the server) stops the music and clears the queue.
    LaunchedEffect(state) { if (state == SessionState.SignedOut) vm.player.stop() }

    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        when (val s = state) {
            SessionState.Unknown -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            SessionState.SignedOut -> LoginScreen()
            is SessionState.SignedIn -> MainScreen(user = s.user)
        }
    }
}
