package snowsig.music.playback

import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import snowsig.music.data.api.AlbumDetailDto
import snowsig.music.data.api.AlbumDto
import snowsig.music.data.api.AlbumRef
import snowsig.music.data.api.HomeDto
import snowsig.music.data.api.ItemsDto
import snowsig.music.data.api.MusicApi
import snowsig.music.data.api.Ref
import snowsig.music.data.api.SearchDto
import snowsig.music.data.api.TrackDto
import snowsig.music.offline.DownloadItem
import snowsig.music.offline.DownloadStatus
import snowsig.music.offline.DownloadsRepository

class SleepAndFadeTest {
    private var now = 1_000_000L
    private val timer = SleepTimer().apply { clock = { now } }

    @Test
    fun `a timed sleep counts down and can be cancelled`() {
        assertEquals(SleepTimerState.Off, timer.state.value)
        assertNull(timer.remainingMs())
        timer.start(15)
        assertEquals(15 * 60_000L, timer.remainingMs())
        now += 14 * 60_000L
        assertEquals(60_000L, timer.remainingMs())
        now += 5 * 60_000L
        assertEquals(0L, timer.remainingMs()) // never negative
        timer.cancel()
        assertEquals(SleepTimerState.Off, timer.state.value)
    }

    @Test
    fun `end of song has no countdown`() {
        timer.startEndOfTrack()
        assertEquals(SleepTimerState.EndOfTrack, timer.state.value)
        assertNull(timer.remainingMs())
    }

    @Test
    fun `fades rise at the start and fall at the end of a song`() {
        val song = 200_000L
        val fade = 5_000L
        assertEquals(0f, fadeVolume(0, song, fade))
        assertEquals(0.5f, fadeVolume(2_500, song, fade))
        assertEquals(1f, fadeVolume(100_000, song, fade))
        assertEquals(0.5f, fadeVolume(song - 2_500, song, fade))
        assertEquals(0f, fadeVolume(song, song, fade))
        // Off, or no duration yet: full volume.
        assertEquals(1f, fadeVolume(0, song, 0))
        assertEquals(1f, fadeVolume(1_000, 0, fade))
        // A song shorter than two fades still peaks below 1 in the middle.
        assertEquals(0.6f, fadeVolume(3_000, 6_000, fade), 0.001f)
    }

    @Test
    fun `the sleep timer fades out over its last 10 seconds`() {
        assertEquals(1f, sleepVolume(60_000))
        assertEquals(1f, sleepVolume(10_000))
        assertEquals(0.5f, sleepVolume(5_000))
        assertEquals(0f, sleepVolume(0))
    }

    @Test
    fun `autoplay adds songs only at the end of a non-repeating queue, online`() {
        assertTrue(shouldExtendQueue(autoplay = true, repeatOff = true, hasNext = false, itemCount = 3, online = true))
        assertFalse(shouldExtendQueue(autoplay = false, repeatOff = true, hasNext = false, itemCount = 3, online = true))
        assertFalse(shouldExtendQueue(autoplay = true, repeatOff = false, hasNext = false, itemCount = 3, online = true))
        assertFalse(shouldExtendQueue(autoplay = true, repeatOff = true, hasNext = true, itemCount = 3, online = true))
        assertFalse(shouldExtendQueue(autoplay = true, repeatOff = true, hasNext = false, itemCount = 0, online = true))
        assertFalse(shouldExtendQueue(autoplay = true, repeatOff = true, hasNext = false, itemCount = 3, online = false))
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class LibraryTreeTest {
    private val artist = Ref("ar1", "Deva")
    private fun t(id: String, title: String, album: AlbumRef? = null) = TrackDto(id, title, 1, 200_000, artist, album)
    private val vaali = AlbumRef("al1", "Vaali")
    private val api = mockk<MusicApi>()
    private val downloads = mockk<DownloadsRepository>()
    private val tree = LibraryTree(api, downloads)

    @Test
    fun `browse ids name the list a song came from`() {
        val id = BrowseIds.track("album:al1", "t2")
        assertEquals("ctx|album:al1|t2", id)
        assertEquals("album:al1" to "t2", BrowseIds.parseTrack(id))
        // Search queries may contain the separator; the track id is always last.
        assertEquals("search:a|b" to "t9", BrowseIds.parseTrack(BrowseIds.track("search:a|b", "t9")))
        assertNull(BrowseIds.parseTrack("t2"))
        assertNull(BrowseIds.parseTrack("ctx|"))
        assertNull(BrowseIds.parseTrack("album/al1"))
    }

    @Test
    fun `the root has four tabs, home lists albums, and an album lists playable songs`() = runTest {
        assertEquals(listOf("home", "recent", "library", "genres"), tree.children("root").map { it.mediaId })
        assertTrue(tree.children("root").all { it.mediaMetadata.isBrowsable == true })
        coEvery { api.home() } returns HomeDto(newAlbums = listOf(AlbumDto("al1", "Vaali", 1999, artist)))
        val albums = tree.children("home")
        assertEquals(listOf("album/al1"), albums.map { it.mediaId })
        assertEquals("Deva", albums[0].mediaMetadata.subtitle)

        coEvery { api.album("al1") } returns AlbumDetailDto("al1", "Vaali", 1999, artist, null, tracks = listOf(t("t1", "One"), t("t2", "Two")))
        val songs = tree.children("album/al1")
        assertEquals(listOf("ctx|album:al1|t1", "ctx|album:al1|t2"), songs.map { it.mediaId })
        assertEquals(true, songs[0].mediaMetadata.isPlayable)
        assertEquals("Vaali", songs[0].mediaMetadata.albumTitle)
    }

    @Test
    fun `picking a song queues its whole list from that song`() = runTest {
        coEvery { api.album("al1") } returns AlbumDetailDto("al1", "Vaali", null, artist, null, tracks = listOf(t("t1", "One"), t("t2", "Two"), t("t3", "Three")))
        val (queue, start) = tree.queueFor("ctx|album:al1|t2")!!
        assertEquals(listOf("t1", "t2", "t3"), queue.map { it.id })
        assertEquals(1, start)
        assertEquals("Vaali", queue[0].album.title) // album context fills in the album
        assertNull(tree.queueFor("ctx|album:al1|missing"))
        assertNull(tree.queueFor("t2"))

        coEvery { api.recent() } returns ItemsDto(listOf(t("t5", "Five", vaali)))
        assertEquals(listOf("t5") to 0, tree.queueFor("ctx|recent|t5")!!.let { (q, i) -> q.map { it.id } to i })

        coEvery { api.search("nila") } returns SearchDto(listOf(t("t7", "Nilavai", vaali)), emptyList(), emptyList())
        assertEquals("t7", tree.queueFor("ctx|search:nila|t7")!!.first.single().id)
    }

    @Test
    fun `downloads work without the server`() = runTest {
        val done = QueueTrack("d1", "B song", 1, artist, AlbumRef("al", "A album"))
        val other = QueueTrack("d2", "A song", 1, artist, AlbumRef("al", "A album"))
        val busy = QueueTrack("d3", "Busy", 1, artist, AlbumRef("al", "A album"))
        every { downloads.items } returns MutableStateFlow(
            mapOf(
                "d1" to DownloadItem(done, DownloadStatus.Done, 100f, 1),
                "d2" to DownloadItem(other, DownloadStatus.Done, 100f, 1),
                "d3" to DownloadItem(busy, DownloadStatus.Downloading, 50f, 1),
            ),
        )
        assertEquals(listOf("ctx|downloads|d2", "ctx|downloads|d1"), tree.children("downloads").map { it.mediaId })
    }
}
