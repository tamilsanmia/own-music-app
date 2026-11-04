package snowsig.music

import android.app.SearchManager
import android.content.Intent
import android.os.Bundle
import android.provider.MediaStore
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dagger.hilt.android.AndroidEntryPoint
import snowsig.music.data.settings.SettingsStore
import snowsig.music.playback.PlayerConnection
import snowsig.music.ui.AppRoot
import snowsig.music.ui.theme.MusicTheme
import snowsig.music.ui.theme.isDarkTheme
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var settings: SettingsStore
    @Inject lateinit var player: PlayerConnection

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val s by settings.settings.collectAsStateWithLifecycle()
            val dark = isDarkTheme(s.theme)
            // Light or dark status bar icons to match the theme.
            LaunchedEffect(dark) {
                val transparent = Color.Transparent.toArgb()
                val style = if (dark) SystemBarStyle.dark(transparent) else SystemBarStyle.light(transparent, transparent)
                enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
            }
            MusicTheme(s.theme, s.accent) { AppRoot() }
        }
        if (savedInstanceState == null) handleVoiceSearch(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleVoiceSearch(intent)
    }

    /** Google Assistant: "Play Vaali on Music". */
    private fun handleVoiceSearch(intent: Intent?) {
        if (intent?.action != MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH) return
        player.playFromSearch(intent.getStringExtra(SearchManager.QUERY).orEmpty())
    }
}
