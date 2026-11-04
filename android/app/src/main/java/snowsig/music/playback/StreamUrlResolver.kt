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

/**
 * Queue items point at "music://track/<id>" (or "music://track/<id>?q=lossless" for the FLAC
 * stream); the real URL is signed and short-lived.
 */
const val TRACK_SCHEME = "music"
private const val QUALITY_PARAM = "q"
private const val LOSSLESS = "lossless"

fun trackUri(trackId: String, lossless: Boolean = false): Uri =
    Uri.parse("$TRACK_SCHEME://track/$trackId" + if (lossless) "?$QUALITY_PARAM=$LOSSLESS" else "")

fun trackIdOf(uri: Uri): String? =
    if (uri.scheme == TRACK_SCHEME && uri.host == "track") uri.lastPathSegment else null

fun isLosslessUri(uri: Uri): Boolean = uri.scheme == TRACK_SCHEME && uri.getQueryParameter(QUALITY_PARAM) == LOSSLESS

/** Fetches signed stream URLs, reusing one until it is about to expire. */
@Singleton
class StreamUrls @Inject constructor(private val api: MusicApi) {
    /** Replace for tests. */
    var clock: () -> Instant = Instant::now

    private data class Signed(val url: String, val expiresAt: Instant)
    private val cache = ConcurrentHashMap<String, Signed>()

    private fun key(trackId: String, lossless: Boolean) = if (lossless) "$trackId|$LOSSLESS" else trackId

    /** A URL still valid for a while, without asking the server; null if there is none. */
    fun cached(trackId: String, lossless: Boolean = false): String? =
        cache[key(trackId, lossless)]?.takeIf { it.expiresAt.isAfter(clock().plusSeconds(MARGIN_S)) }?.url

    /** Blocking: called on ExoPlayer's loader threads. */
    fun get(trackId: String, lossless: Boolean = false): String {
        cached(trackId, lossless)?.let { return it }
        val res = try {
            runBlocking { api.streamUrl(trackId, if (lossless) LOSSLESS else null) }
        } catch (e: IOException) {
            throw e
        } catch (e: Exception) {
            throw IOException("Could not get a stream URL for $trackId", e)
        }
        return absoluteUrl(res.url).also { cache[key(trackId, lossless)] = Signed(it, Instant.parse(res.expiresAt)) }
    }

    /** Forget a URL the server refused (expired, or the user was deactivated). */
    fun invalidate(trackId: String) {
        cache.remove(key(trackId, false))
        cache.remove(key(trackId, true))
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
        return dataSpec.withUri(Uri.parse(urls.get(id, isLosslessUri(dataSpec.uri))))
    }
}
