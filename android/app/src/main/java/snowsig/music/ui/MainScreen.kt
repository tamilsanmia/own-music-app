package snowsig.music.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import kotlinx.serialization.Serializable
import snowsig.music.data.api.UserDto
import snowsig.music.ui.home.HomeScreen
import snowsig.music.ui.player.MiniPlayer
import snowsig.music.ui.player.NowPlayingScreen
import snowsig.music.ui.player.PlayerViewModel

@Serializable
object HomeRoute

/** Ask once for notification permission (Android 13+), so the playback notification can show. */
@Composable
private fun RequestNotificationPermission() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(Unit) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}

/** The signed-in app. */
@Composable
fun MainScreen(user: UserDto, player: PlayerViewModel = hiltViewModel()) {
    RequestNotificationPermission()
    val nav = rememberNavController()
    val playerState by player.state.collectAsStateWithLifecycle()
    var nowPlaying by rememberSaveable { mutableStateOf(false) }

    Box(Modifier.fillMaxSize()) {
        Scaffold(
            modifier = Modifier.fillMaxSize(),
            bottomBar = {
                Column(Modifier.navigationBarsPadding()) {
                    MiniPlayer(playerState, onOpen = { nowPlaying = true }, onToggle = player::togglePlay)
                }
            },
        ) { padding ->
            NavHost(nav, startDestination = HomeRoute, modifier = Modifier.padding(bottom = padding.calculateBottomPadding())) {
                composable<HomeRoute> {
                    HomeScreen(displayName = user.displayName, onOpenAlbum = {}, contentPadding = padding)
                }
            }
        }
        AnimatedVisibility(
            visible = nowPlaying && playerState.current != null,
            enter = slideInVertically { it },
            exit = slideOutVertically { it },
        ) {
            NowPlayingScreen(playerState, player, onClose = { nowPlaying = false })
        }
    }
}
