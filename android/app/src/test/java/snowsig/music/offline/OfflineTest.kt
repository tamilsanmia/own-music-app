package snowsig.music.offline

import android.net.Uri
import androidx.media3.common.MimeTypes
import androidx.media3.common.StreamKey
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.exoplayer.hls.playlist.HlsMultivariantPlaylist
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import retrofit2.HttpException
import retrofit2.Response
import snowsig.music.data.api.AlbumRef
import snowsig.music.data.api.ImageUrls
import snowsig.music.data.api.MusicApi
import snowsig.music.data.api.PlayRequest
import snowsig.music.data.api.Ref
import snowsig.music.playback.QueueTrack
import snowsig.music.playback.trackUri
import snowsig.music.ui.player.playableOffline
import java.io.IOException

@UnstableApi
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class OfflineTest {
    private fun key(url: String) = TokenStrippingCacheKeyFactory.buildCacheKey(DataSpec(Uri.parse(url)))

    @Test
    fun `cache keys drop the stream token and keep the rest of the path`() {
        assertEquals("track:abc", key("music://track/abc"))
        assertEquals("stream/abc/160k/seg_001.m4s", key("https://music.snowsig.in/stream/TOKEN1.sig/abc/160k/seg_001.m4s"))
        assertEquals(key("https://music.snowsig.in/stream/AAA.x/abc/160k/index.m3u8"), key("https://music.snowsig.in/stream/BBB.y/abc/160k/index.m3u8"))
        assertEquals("stream/abc/master.m3u8", key("https://music.snowsig.in/stream/t/abc/master.m3u8"))
        // Different tracks or files never collide.
        assertEquals(false, key("https://h/stream/t/abc/160k/seg_001.m4s") == key("https://h/stream/t/xyz/160k/seg_001.m4s"))
        assertEquals("https://music.snowsig.in/media/covers/x-300.webp", key("https://music.snowsig.in/media/covers/x-300.webp"))
        assertEquals("custom", TokenStrippingCacheKeyFactory.buildCacheKey(DataSpec.Builder().setUri("music://track/abc").setKey("custom").build()))
    }

    private val track = QueueTrack("t1", "Nilavai", 367_000, Ref("ar", "Deva"), AlbumRef("al", "Vaali", ImageUrls("/s.webp", "/l.webp")))

    @Test
    fun `download requests fetch only the 160k rendition and carry the track info`() {
        val r = downloadRequestFor(track)
        assertEquals("t1", r.id)
        assertEquals(trackUri("t1"), r.uri)
        assertEquals(MimeTypes.APPLICATION_M3U8, r.mimeType)
        assertEquals(listOf(StreamKey(HlsMultivariantPlaylist.GROUP_INDEX_VARIANT, 1)), r.streamKeys)
        assertEquals(track, r.trackInfo()!!.toQueueTrack())
    }

    @Test
    fun `offline, only downloaded songs are queued`() {
        val tracks = (1..5).map { track.copy(id = "t$it") }
        val downloaded = setOf("t2", "t4")
        val (queue, start) = playableOffline(tracks, 2, downloaded::contains) // picked t3, not downloaded
        assertEquals(listOf("t2", "t4"), queue.map { it.id })
        assertEquals(1, start) // the next playable after t3 is t4
        assertEquals(0, playableOffline(tracks, 4, downloaded::contains).second)
        assertEquals(emptyList<QueueTrack>(), playableOffline(tracks, 0) { false }.first)
    }

    private class FakeDao : PendingPlayDao {
        val rows = mutableListOf<PendingPlay>()
        override suspend fun insert(play: PendingPlay) { rows += play.copy(id = rows.size + 1L) }
        override suspend fun oldest(limit: Int) = rows.sortedBy { it.id }.take(limit)
        override suspend fun delete(id: Long) { rows.removeAll { it.id == id } }
    }

    private fun http(code: Int) = HttpException(Response.error<Any>(code, "{}".toResponseBody()))

    @Test
    fun `pending plays are sent oldest first with their original time`() = runTest {
        val dao = FakeDao().apply {
            insert(PendingPlay(trackId = "a", playedAt = "2026-11-04T10:00:00Z"))
            insert(PendingPlay(trackId = "b", playedAt = "2026-11-04T10:05:00Z"))
        }
        val api = mockk<MusicApi>(relaxed = true)
        assertEquals(PlayFlusher.Outcome.Done, PlayFlusher(dao, api).flush())
        coVerify(ordering = io.mockk.Ordering.ORDERED) {
            api.recordPlay(PlayRequest("a", "2026-11-04T10:00:00Z"))
            api.recordPlay(PlayRequest("b", "2026-11-04T10:05:00Z"))
        }
        assertEquals(emptyList<PendingPlay>(), dao.rows)
    }

    @Test
    fun `network errors keep the plays for a retry`() = runTest {
        val dao = FakeDao().apply { insert(PendingPlay(trackId = "a", playedAt = "x")) }
        val api = mockk<MusicApi> { coEvery { recordPlay(any()) } throws IOException("offline") }
        assertEquals(PlayFlusher.Outcome.Retry, PlayFlusher(dao, api).flush())
        assertEquals(1, dao.rows.size)

        coEvery { api.recordPlay(any()) } throws http(503)
        assertEquals(PlayFlusher.Outcome.Retry, PlayFlusher(dao, api).flush())
        assertEquals(1, dao.rows.size)
    }

    @Test
    fun `plays the server will never accept are dropped`() = runTest {
        val dao = FakeDao().apply {
            insert(PendingPlay(trackId = "deleted", playedAt = "x"))
            insert(PendingPlay(trackId = "ok", playedAt = "y"))
        }
        val api = mockk<MusicApi>(relaxed = true) { coEvery { recordPlay(PlayRequest("deleted", "x")) } throws http(404) }
        assertEquals(PlayFlusher.Outcome.Done, PlayFlusher(dao, api).flush())
        assertEquals(emptyList<PendingPlay>(), dao.rows)
        assertNull(dao.rows.firstOrNull())
    }
}
