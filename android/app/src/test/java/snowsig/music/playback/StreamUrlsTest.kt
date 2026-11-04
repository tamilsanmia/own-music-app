package snowsig.music.playback

import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import snowsig.music.data.api.MusicApi
import snowsig.music.data.api.StreamUrlDto
import java.time.Instant
import android.net.Uri

@UnstableApi
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class StreamUrlsTest {
    private val api = mockk<MusicApi>()
    private var now = Instant.parse("2026-11-04T10:00:00Z")
    private var n = 0

    private fun urls() = StreamUrls(api).apply { clock = { now } }

    init {
        coEvery { api.streamUrl(any()) } answers {
            n++
            StreamUrlDto(url = "/stream/tok$n/${firstArg<String>()}/master.m3u8", expiresAt = "2026-11-04T16:00:00Z")
        }
    }

    @Test
    fun `reuses a signed URL until 5 minutes before it expires`() {
        val u = urls()
        assertEquals("https://music.snowsig.in/stream/tok1/t1/master.m3u8", u.get("t1"))
        now = Instant.parse("2026-11-04T15:54:00Z")
        assertEquals("https://music.snowsig.in/stream/tok1/t1/master.m3u8", u.get("t1"))
        now = Instant.parse("2026-11-04T15:56:00Z")
        assertEquals("https://music.snowsig.in/stream/tok2/t1/master.m3u8", u.get("t1"))
        coVerify(exactly = 2) { api.streamUrl("t1") }
    }

    @Test
    fun `invalidate forces a new URL`() {
        val u = urls()
        u.get("t1")
        u.invalidate("t1")
        assertEquals("https://music.snowsig.in/stream/tok2/t1/master.m3u8", u.get("t1"))
    }

    @Test
    fun `the resolver swaps music URIs for signed URLs and leaves others alone`() {
        val resolver = StreamResolver(urls())
        val resolved = resolver.resolveDataSpec(DataSpec(trackUri("t9")))
        assertEquals("https://music.snowsig.in/stream/tok1/t9/master.m3u8", resolved.uri.toString())

        val segment = DataSpec(Uri.parse("https://music.snowsig.in/stream/tok1/t9/160k/seg_000.m4s"))
        assertEquals(segment.uri, resolver.resolveDataSpec(segment).uri)
        assertEquals(1, n)
    }

    @Test
    fun `track ids come only from music track URIs`() {
        assertEquals("abc", trackIdOf(trackUri("abc")))
        assertNull(trackIdOf(Uri.parse("https://music.snowsig.in/stream/x/abc/master.m3u8")))
        assertNull(trackIdOf(Uri.parse("music://album/abc")))
    }
}
