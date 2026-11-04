package snowsig.music.offline

import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.cache.CacheKeyFactory
import snowsig.music.playback.trackIdOf

/**
 * Cache keys without the stream token. A signed URL looks like
 *   https://music.snowsig.in/stream/<token>/<trackId>/160k/seg_001.m4s
 * and the token changes on every request, so keying on the URL would make a download
 * unfindable as soon as its token expired. Keys are instead:
 *   music://track/<id>                      -> "track:<id>"           (the master playlist)
 *   .../stream/<token>/<id>/<file path>     -> "stream/<id>/<path>"   (variant playlists, segments)
 * Anything else keeps its URL as the key.
 */
@UnstableApi
object TokenStrippingCacheKeyFactory : CacheKeyFactory {
    private val streamPath = Regex("^/stream/[^/]+/([^/]+)/(.+)$")

    override fun buildCacheKey(dataSpec: DataSpec): String {
        dataSpec.key?.let { return it }
        return keyFor(dataSpec.uri.toString(), dataSpec.uri.scheme, dataSpec.uri.encodedPath)
            ?: dataSpec.uri.toString()
    }

    /** Separated from [android.net.Uri] so it's easy to test. */
    fun keyFor(uri: String, scheme: String?, path: String?): String? {
        if (scheme == "music") return trackIdOf(android.net.Uri.parse(uri))?.let { "track:$it" }
        val m = path?.let(streamPath::find) ?: return null
        return "stream/${m.groupValues[1]}/${m.groupValues[2]}"
    }
}
