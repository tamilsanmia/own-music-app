package snowsig.music.playback

import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import io.mockk.every
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import snowsig.music.data.api.AlbumRef
import snowsig.music.data.api.ImageUrls
import snowsig.music.data.api.Ref
import snowsig.music.data.api.TrackDto

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class QueueMapperTest {
    private val cover = ImageUrls("/media/covers/c-300.webp", "/media/covers/c-600.webp")
    private val album = AlbumRef("al1", "Vaali", cover)
    private val track = QueueTrack("t1", "April Madhathil", 331_000, Ref("ar1", "Deva"), album)

    @Test
    fun `a queue track becomes a playable HLS media item with metadata`() {
        val item = track.toMediaItem()
        assertEquals("t1", item.mediaId)
        assertEquals("music://track/t1", item.localConfiguration!!.uri.toString())
        assertEquals(MimeTypes.APPLICATION_M3U8, item.localConfiguration!!.mimeType)
        val m = item.mediaMetadata
        assertEquals("April Madhathil", m.title)
        assertEquals("Deva", m.artist)
        assertEquals("Vaali", m.albumTitle)
        assertEquals("https://music.snowsig.in/media/covers/c-600.webp", m.artworkUri.toString())
    }

    @Test
    fun `metadata round-trips back to the queue track`() {
        assertEquals(track, track.toMediaItem().toQueueTrack())
        val noCover = track.copy(album = album.copy(cover = null))
        assertEquals(noCover, noCover.toMediaItem().toQueueTrack())
    }

    @Test
    fun `the service restores the URI of items that arrive without one`() {
        val fromController = MediaItem.Builder().setMediaId("t1").setMediaMetadata(track.toMediaItem().mediaMetadata).build()
        assertNull(fromController.localConfiguration)
        val playable = fromController.withPlayableUri()
        assertEquals("music://track/t1", playable.localConfiguration!!.uri.toString())
        assertEquals("April Madhathil", playable.mediaMetadata.title)
    }

    @Test
    fun `tracks from an album page take the album as context`() {
        val dto = TrackDto("t2", "Gee Priya", 2, 330_000, Ref("ar1", "Deva"))
        assertEquals(album, dto.toQueueTrack(album).album)
        val withOwn = dto.copy(album = AlbumRef("al9", "Other"))
        assertEquals("al9", withOwn.toQueueTrack(album).album.id)
    }

    private fun player(
        items: List<QueueTrack> = listOf(track, track.copy(id = "t2", title = "Second")),
        index: Int = 1,
        duration: Long = 330_000,
        state: Int = Player.STATE_READY,
        playWhenReady: Boolean = true,
        playing: Boolean = true,
        repeat: Int = Player.REPEAT_MODE_OFF,
        error: PlaybackException? = null,
    ): Player = mockk {
        every { mediaItemCount } returns items.size
        every { getMediaItemAt(any()) } answers { items[firstArg<Int>()].toMediaItem() }
        every { currentMediaItemIndex } returns index
        every { this@mockk.duration } returns duration
        every { isPlaying } returns playing
        every { playbackState } returns state
        every { this@mockk.playWhenReady } returns playWhenReady
        every { currentPosition } returns 42_000
        every { shuffleModeEnabled } returns true
        every { repeatMode } returns repeat
        every { playerError } returns error
    }

    @Test
    fun `player state maps to UI state`() {
        val s = snapshot(player())
        assertEquals("Second", s.current?.title)
        assertEquals(1, s.index)
        assertEquals(2, s.queue.size)
        assertTrue(s.isPlaying)
        assertFalse(s.buffering)
        assertEquals(42_000, s.positionMs)
        assertEquals(330_000, s.durationMs)
        assertTrue(s.shuffle)
        assertEquals(RepeatMode.Off, s.repeat)
        assertNull(s.error)
    }

    @Test
    fun `uses the catalog duration until the stream reports one, and shows buffering only when playing`() {
        val s = snapshot(player(duration = C.TIME_UNSET, state = Player.STATE_BUFFERING))
        assertEquals(331_000, s.durationMs)
        assertTrue(s.buffering)
        assertFalse(snapshot(player(state = Player.STATE_BUFFERING, playWhenReady = false)).buffering)
    }

    @Test
    fun `repeat modes and errors map through`() {
        assertEquals(RepeatMode.All, snapshot(player(repeat = Player.REPEAT_MODE_ALL)).repeat)
        assertEquals(RepeatMode.One, snapshot(player(repeat = Player.REPEAT_MODE_ONE)).repeat)
        val err = PlaybackException("x", null, PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED)
        assertEquals("No connection. Check your network.", snapshot(player(error = err)).error)
        assertEquals(listOf(RepeatMode.All, RepeatMode.One, RepeatMode.Off), RepeatMode.entries.map { it.next() })
    }

    @Test
    fun `an empty queue has no current track`() {
        val s = snapshot(player(items = emptyList(), index = 0))
        assertNull(s.current)
        assertEquals(0, s.queue.size)
    }
}
