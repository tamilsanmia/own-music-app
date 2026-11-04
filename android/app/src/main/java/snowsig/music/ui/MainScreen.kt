package snowsig.music.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import kotlinx.serialization.Serializable
import snowsig.music.data.api.UserDto
import snowsig.music.ui.home.HomeScreen

@Serializable
object HomeRoute

/** The signed-in app. Grows bottom navigation, player and more screens in later tasks. */
@Composable
fun MainScreen(user: UserDto) {
    val nav = rememberNavController()
    Scaffold(modifier = Modifier.fillMaxSize()) { padding ->
        NavHost(nav, startDestination = HomeRoute, modifier = Modifier.padding(bottom = padding.calculateBottomPadding())) {
            composable<HomeRoute> {
                HomeScreen(displayName = user.displayName, onOpenAlbum = {}, contentPadding = padding)
            }
        }
    }
}
