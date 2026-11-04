package snowsig.music.playback

import android.net.Uri
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import snowsig.music.absoluteUrl
import snowsig.music.data.api.AlbumRef
import snowsig.music.data.api.ImageUrls
import snowsig.music.data.api.Ref
import snowsig.music.data.api.TrackDto

/** What the app knows about a queued track; travels in MediaMetadata between UI and service. */
data class QueueTrack(
    val id: String,
    val title: String,
    val durationMs: Long?,
    val artist: Ref,
    val album: AlbumRef,
    /** The server has a FLAC stream of this track. */
    val lossless: Boolean = false,
)

fun TrackDto.toQueueTrack(albumContext: AlbumRef? = null): QueueTrack =
    QueueTrack(id, title, durationMs, artist, album ?: albumContext ?: AlbumRef("", ""), lossless)

private const val ARTIST_ID = "artistId"
private const val ALBUM_ID = "albumId"
private const val COVER_SMALL = "coverSmall"
private const val COVER_LARGE = "coverLarge"
private const val HAS_LOSSLESS = "lossless"

/** A playable item. The URI is resolved to a signed URL at load time (see StreamResolver). */
fun QueueTrack.toMediaItem(): MediaItem = MediaItem.Builder()
    .setMediaId(id)
    .setUri(trackUri(id))
    .setMimeType(MimeTypes.APPLICATION_M3U8)
    .setMediaMetadata(metadata())
    .build()

private fun QueueTrack.metadata(): MediaMetadata = MediaMetadata.Builder()
    .setTitle(title)
    .setArtist(artist.name)
    .setAlbumTitle(album.title)
    .setArtworkUri(album.cover?.large?.let { Uri.parse(absoluteUrl(it)) })
    .setDurationMs(durationMs)
    .setIsPlayable(true)
    .setIsBrowsable(false)
    .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
    .setExtras(
        Bundle().apply {
            putString(ARTIST_ID, artist.id)
            putString(ALBUM_ID, album.id)
            putBoolean(HAS_LOSSLESS, lossless)
            album.cover?.let {
                putString(COVER_SMALL, it.small)
                putString(COVER_LARGE, it.large)
            }
        },
    )
    .build()

/**
 * Controllers don't pass an item's URI to the session (only id and metadata), so the service
 * rebuilds playable items here. With [preferLossless], tracks that have a FLAC stream use it.
 */
fun MediaItem.withPlayableUri(preferLossless: Boolean = false): MediaItem {
    val lossless = preferLossless && mediaMetadata.extras?.getBoolean(HAS_LOSSLESS) == true
    return buildUpon().setUri(trackUri(mediaId, lossless)).setMimeType(MimeTypes.APPLICATION_M3U8).build()
}

fun MediaItem.toQueueTrack(): QueueTrack {
    val m = mediaMetadata
    val extras = m.extras
    val small = extras?.getString(COVER_SMALL)
    val large = extras?.getString(COVER_LARGE)
    return QueueTrack(
        id = mediaId,
        title = m.title?.toString().orEmpty(),
        durationMs = m.durationMs,
        artist = Ref(extras?.getString(ARTIST_ID).orEmpty(), m.artist?.toString().orEmpty()),
        album = AlbumRef(
            id = extras?.getString(ALBUM_ID).orEmpty(),
            title = m.albumTitle?.toString().orEmpty(),
            cover = if (small != null && large != null) ImageUrls(small, large) else null,
        ),
        lossless = extras?.getBoolean(HAS_LOSSLESS) == true,
    )
}
