package snowsig.music.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import kotlinx.serialization.Serializable
import snowsig.music.data.api.TrackDto
import snowsig.music.data.api.UserDto
import snowsig.music.playback.toQueueTrack
import snowsig.music.ui.album.AlbumScreen
import snowsig.music.ui.artist.ArtistScreen
import snowsig.music.ui.components.AppNavigator
import snowsig.music.ui.components.Artwork
import snowsig.music.ui.components.LikeButton
import snowsig.music.ui.components.LocalNavigator
import snowsig.music.ui.components.TrackActionsViewModel
import snowsig.music.ui.downloads.DownloadsScreen
import snowsig.music.ui.downloads.OfflineBanner
import snowsig.music.ui.home.HomeScreen
import snowsig.music.ui.library.LibraryScreen
import snowsig.music.ui.library.LikedScreen
import snowsig.music.ui.player.MiniPlayer
import snowsig.music.ui.player.NowPlayingScreen
import snowsig.music.ui.player.PlayerViewModel
import snowsig.music.ui.playlist.PlaylistScreen
import snowsig.music.ui.search.SearchScreen
import snowsig.music.ui.genre.GenreScreen
import snowsig.music.ui.lyrics.LyricsScreen
import snowsig.music.ui.settings.EqualizerScreen
import snowsig.music.ui.settings.SettingsScreen
import snowsig.music.ui.player.CastButton

@Serializable object HomeRoute
@Serializable object SearchRoute
@Serializable object LibraryRoute
@Serializable object LikedRoute
@Serializable data class AlbumRoute(val id: String)
@Serializable data class ArtistRoute(val id: String)
@Serializable data class PlaylistRoute(val id: String)
@Serializable object DownloadsRoute
@Serializable object SettingsRoute
@Serializable object EqualizerRoute
@Serializable data class GenreRoute(val name: String)

enum class Tab(val label: String, val icon: ImageVector, val route: Any) {
    Home("Home", Icons.Filled.Home, HomeRoute),
    Search("Search", Icons.Filled.Search, SearchRoute),
    Library("Your Library", Icons.Filled.LibraryMusic, LibraryRoute),
}

/** Bottom navigation. Selecting a tab keeps each tab's own back stack. */
@Composable
fun MainBottomBar(selected: Tab, onSelect: (Tab) -> Unit) {
    NavigationBar(containerColor = MaterialTheme.colorScheme.background) {
        Tab.entries.forEach { tab ->
            NavigationBarItem(
                selected = tab == selected,
                onClick = { onSelect(tab) },
                icon = { Icon(tab.icon, contentDescription = null) },
                label = { Text(tab.label) },
            )
        }
    }
}

private fun NavHostController.switchTo(tab: Tab) = navigate(tab.route) {
    popUpTo(graph.findStartDestination().id) { saveState = true }
    launchSingleTop = true
    restoreState = true
}

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

/** The signed-in app: tabs, screens, mini player and Now Playing. */
@Composable
fun MainScreen(
    user: UserDto,
    player: PlayerViewModel = hiltViewModel(),
    actions: TrackActionsViewModel = hiltViewModel(),
) {
    RequestNotificationPermission()
    val nav = rememberNavController()
    val playerState by player.state.collectAsStateWithLifecycle()
    var nowPlaying by rememberSaveable { mutableStateOf(false) }
    var lyrics by rememberSaveable { mutableStateOf(false) }
    var tab by rememberSaveable { mutableStateOf(Tab.Home) }
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(Unit) { actions.messages.collect { snackbar.showSnackbar(it) } }
    LaunchedEffect(user.id) { actions.refreshLikes() }

    val navigator = remember(nav) {
        object : AppNavigator {
            override fun openAlbum(id: String) { nowPlaying = false; nav.navigate(AlbumRoute(id)) }
            override fun openArtist(id: String) { nowPlaying = false; nav.navigate(ArtistRoute(id)) }
            override fun openPlaylist(id: String) { nowPlaying = false; nav.navigate(PlaylistRoute(id)) }
            override fun openGenre(name: String) { nowPlaying = false; nav.navigate(GenreRoute(name)) }
            override fun openSettings() { nowPlaying = false; nav.navigate(SettingsRoute) { launchSingleTop = true } }
        }
    }

    CompositionLocalProvider(LocalNavigator provides navigator) {
        Box(Modifier.fillMaxSize()) {
            Scaffold(
                modifier = Modifier.fillMaxSize(),
                snackbarHost = { SnackbarHost(snackbar) },
                topBar = { Column(Modifier.statusBarsPadding()) { OfflineBanner(onOpenDownloads = { nav.navigate(DownloadsRoute) }) } },
                bottomBar = {
                    Column {
                        MiniPlayer(playerState, onOpen = { nowPlaying = true }, onToggle = player::togglePlay, trailing = {
                            playerState.current?.let { LikeButton(it.id, it.title) }
                        })
                        MainBottomBar(tab) { t -> tab = t; nav.switchTo(t) }
                    }
                },
            ) { padding ->
                val inner = PaddingValues(top = padding.calculateTopPadding() + 8.dp, bottom = 16.dp)
                NavHost(nav, startDestination = HomeRoute, modifier = Modifier.padding(bottom = padding.calculateBottomPadding())) {
                    composable<HomeRoute> {
                        HomeScreen(
                            displayName = user.displayName,
                            onOpenAlbum = navigator::openAlbum,
                            onOpenGenre = navigator::openGenre,
                            onOpenSettings = navigator::openSettings,
                            trackRow = { tracks, numbered -> TrackTiles(tracks, numbered, player) },
                            headerActions = { CastButton() },
                            contentPadding = PaddingValues(top = padding.calculateTopPadding()),
                        )
                    }
                    composable<SearchRoute> { SearchScreen(inner) }
                    composable<LibraryRoute> {
                        LibraryScreen(inner, onOpenLiked = { nav.navigate(LikedRoute) }, onOpenDownloads = { nav.navigate(DownloadsRoute) })
                    }
                    composable<LikedRoute> { LikedScreen(inner) }
                    composable<AlbumRoute> { AlbumScreen(inner) }
                    composable<ArtistRoute> { ArtistScreen(inner) }
                    composable<PlaylistRoute> { PlaylistScreen(inner, onDeleted = { nav.popBackStack() }) }
                    composable<DownloadsRoute> { DownloadsScreen(inner) }
                    composable<SettingsRoute> { SettingsScreen(inner, onOpenEqualizer = { nav.navigate(EqualizerRoute) }) }
                    composable<EqualizerRoute> { EqualizerScreen(inner) }
                    composable<GenreRoute> { GenreScreen(inner) }
                }
            }
            AnimatedVisibility(
                visible = nowPlaying && playerState.current != null,
                enter = slideInVertically { it },
                exit = slideOutVertically { it },
            ) {
                NowPlayingScreen(
                    playerState,
                    player,
                    onClose = { nowPlaying = false },
                    onOpenLyrics = { lyrics = true },
                    onOpenEqualizer = { nowPlaying = false; nav.navigate(EqualizerRoute) { launchSingleTop = true } },
                    extraActions = { playerState.current?.let { LikeButton(it.id, it.title) } },
                )
            }
            AnimatedVisibility(
                visible = lyrics && nowPlaying && playerState.current != null,
                enter = slideInVertically { it },
                exit = slideOutVertically { it },
            ) {
                LyricsScreen(playerState, onSeek = player::seekTo, onClose = { lyrics = false })
            }
        }
    }
}

/** A row of song tiles on Home ("Recently played", charts). Tapping one plays the row from there. */
@Composable
private fun TrackTiles(tracks: List<TrackDto>, numbered: Boolean, player: PlayerViewModel) {
    val queue = tracks.map { it.toQueueTrack() }
    LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        itemsIndexed(queue, key = { _, t -> t.id }) { i, t ->
            Column(Modifier.width(120.dp).clickable { player.playOrToggle(queue, i) }) {
                Artwork(t.album.cover, Modifier.size(120.dp), contentDescription = "Play ${t.title}")
                Text(
                    if (numbered) "${i + 1}. ${t.title}" else t.title,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(t.artist.name, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}
