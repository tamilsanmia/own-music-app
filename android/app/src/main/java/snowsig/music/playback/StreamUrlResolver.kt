package snowsig.music.playback

import android.net.Uri
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.ResolvingDataSource
import kotlinx.coroutines.runBlocking
import snowsig.music.absoluteUrl
import snowsig.music.data.api.MusicApi
import java.io.IOException
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/** Queue items point at "music://track/<id>"; the real URL is signed and short-lived. */
const val TRACK_SCHEME = "music"

fun trackUri(trackId: String): Uri = Uri.parse("$TRACK_SCHEME://track/$trackId")

fun trackIdOf(uri: Uri): String? =
    if (uri.scheme == TRACK_SCHEME && uri.host == "track") uri.lastPathSegment else null

/** Fetches signed stream URLs, reusing one until it is about to expire. */
@Singleton
class StreamUrls @Inject constructor(private val api: MusicApi) {
    /** Replace for tests. */
    var clock: () -> Instant = Instant::now

    private data class Signed(val url: String, val expiresAt: Instant)
    private val cache = ConcurrentHashMap<String, Signed>()

    /** Blocking: called on ExoPlayer's loader threads. */
    fun get(trackId: String): String {
        cache[trackId]?.let { if (it.expiresAt.isAfter(clock().plusSeconds(MARGIN_S))) return it.url }
        val res = try {
            runBlocking { api.streamUrl(trackId) }
        } catch (e: IOException) {
            throw e
        } catch (e: Exception) {
            throw IOException("Could not get a stream URL for $trackId", e)
        }
        return absoluteUrl(res.url).also { cache[trackId] = Signed(it, Instant.parse(res.expiresAt)) }
    }

    /** Forget a URL the server refused (expired, or the user was deactivated). */
    fun invalidate(trackId: String) {
        cache.remove(trackId)
    }

    private companion object {
        const val MARGIN_S = 5 * 60L
    }
}

/** Turns "music://track/<id>" into the signed HTTPS URL just before ExoPlayer opens it. */
@UnstableApi
class StreamResolver(private val urls: StreamUrls) : ResolvingDataSource.Resolver {
    override fun resolveDataSpec(dataSpec: DataSpec): DataSpec {
        val id = trackIdOf(dataSpec.uri) ?: return dataSpec
        return dataSpec.withUri(Uri.parse(urls.get(id)))
    }
}
