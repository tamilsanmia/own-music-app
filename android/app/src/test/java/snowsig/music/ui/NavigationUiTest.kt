package snowsig.music.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import androidx.compose.material3.Text
import snowsig.music.data.api.AlbumRef
import snowsig.music.data.api.GenreDto
import snowsig.music.data.api.Ref
import snowsig.music.data.api.TrackDto
import snowsig.music.playback.PlayerUiState
import snowsig.music.playback.QueueTrack
import snowsig.music.ui.home.HomeContent
import snowsig.music.ui.home.HomeUiState
import snowsig.music.ui.player.MiniPlayer
import snowsig.music.ui.theme.MusicTheme

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NavigationUiTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `home shows top songs, this week's chart and genres, and opens a genre and settings`() {
        var genre: String? = null
        var settings = 0
        val song = TrackDto("t1", "Nilavai", 1, 367_000, Ref("a", "Deva"), AlbumRef("al", "Vaali"))
        compose.setContent {
            MusicTheme {
                HomeContent(
                    HomeUiState(
                        loading = false,
                        mostPlayed = listOf(song),
                        topThisWeek = listOf(song.copy(id = "t2", title = "Kushi")),
                        genres = listOf(GenreDto("Melody", 2)),
                    ),
                    displayName = "Ann",
                    onOpenAlbum = {},
                    onRefresh = {},
                    onOpenGenre = { genre = it },
                    onOpenSettings = { settings++ },
                    trackRow = { tracks, numbered -> Text(tracks.joinToString { (if (numbered) "#" else "") + it.title }) },
                )
            }
        }
        compose.onNodeWithText("Your top songs").assertExists()
        compose.onNodeWithText("Nilavai").assertExists()
        compose.onNodeWithText("Top this week").assertExists()
        compose.onNodeWithText("#Kushi").assertExists()
        compose.onNodeWithText("Recently played").assertDoesNotExist() // empty sections are hidden
        compose.onNodeWithContentDescription("Genre Melody, 2 albums").performClick()
        assertEquals("Melody", genre)
        compose.onNodeWithContentDescription("Profile and settings").performClick()
        assertEquals(1, settings)
    }

    @Test
    fun `bottom bar switches tabs`() {
        val picked = mutableListOf<Tab>()
        compose.setContent {
            var tab by remember { mutableStateOf(Tab.Home) }
            MusicTheme { MainBottomBar(tab) { tab = it; picked += it } }
        }
        compose.onNodeWithText("Home").assertIsSelected()
        compose.onNodeWithText("Search").performClick()
        compose.onNodeWithText("Search").assertIsSelected()
        compose.onNodeWithText("Home").assertIsNotSelected()
        compose.onNodeWithText("Your Library").performClick()
        assertEquals(listOf(Tab.Search, Tab.Library), picked)
    }

    @Test
    fun `mini player shows the song, toggles playback and opens Now Playing`() {
        var toggles = 0
        var opened = 0
        val track = QueueTrack("t1", "Nilavai Kondu Vaa", 367_000, Ref("a", "Deva"), AlbumRef("al", "Vaali"))
        compose.setContent {
            MusicTheme {
                MiniPlayer(PlayerUiState(current = track, isPlaying = true, positionMs = 1000, durationMs = 367_000), onOpen = { opened++ }, onToggle = { toggles++ })
            }
        }
        compose.onNodeWithText("Nilavai Kondu Vaa").assertExists()
        compose.onNodeWithText("Deva").assertExists()
        compose.onNodeWithContentDescription("Pause").performClick()
        assertEquals(1, toggles)
        compose.onNodeWithContentDescription("Now playing: Nilavai Kondu Vaa. Open player").performClick()
        assertEquals(1, opened)
    }

    @Test
    fun `mini player is hidden when nothing is queued`() {
        compose.setContent { MusicTheme { MiniPlayer(PlayerUiState(), onOpen = {}, onToggle = {}) } }
        compose.onNodeWithContentDescription("Pause").assertDoesNotExist()
        compose.onNodeWithContentDescription("Play").assertDoesNotExist()
    }
}
