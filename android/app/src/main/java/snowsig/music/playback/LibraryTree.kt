package snowsig.music.playback

import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import snowsig.music.absoluteUrl
import snowsig.music.data.api.AlbumDto
import snowsig.music.data.api.AlbumRef
import snowsig.music.data.api.MusicApi
import snowsig.music.offline.DownloadStatus
import snowsig.music.offline.DownloadsRepository
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Media ids in the browse tree (Android Auto and other media browsers):
 *   root -> home | recent | library | genres
 *   library -> liked | playlists | downloads;  playlists -> playlist/<id>;  genres -> genre/<name>
 *   home and genre/<name> list albums: album/<id>
 * Playable songs are "ctx|<list>|<trackId>", where <list> names the list the song was picked
 * from (album:<id>, playlist:<id>, liked, recent, downloads, search:<query>). Playing one queues
 * that whole list, starting at the song.
 */
object BrowseIds {
    const val ROOT = "root"
    const val HOME = "home"
    const val RECENT = "recent"
    const val LIBRARY = "library"
    const val GENRES = "genres"
    const val LIKED = "liked"
    const val PLAYLISTS = "playlists"
    const val DOWNLOADS = "downloads"
    const val ALBUM = "album/"
    const val PLAYLIST = "playlist/"
    const val GENRE = "genre/"
    private const val CTX = "ctx|"

    fun track(list: String, trackId: String) = "$CTX$list|$trackId"

    /** (list, trackId) of a playable browse id, or null for anything else. */
    fun parseTrack(mediaId: String): Pair<String, String>? {
        if (!mediaId.startsWith(CTX)) return null
        val cut = mediaId.lastIndexOf('|')
        if (cut <= CTX.length) return null
        return mediaId.substring(CTX.length, cut) to mediaId.substring(cut + 1)
    }
}

/** Builds the browse tree from the API (and downloads, which also work offline). */
@UnstableApi
@Singleton
class LibraryTree @Inject constructor(
    private val api: MusicApi,
    private val downloads: DownloadsRepository,
) {
    fun root(): MediaItem = folder(BrowseIds.ROOT, "Music", MediaMetadata.MEDIA_TYPE_FOLDER_MIXED)

    suspend fun children(parentId: String): List<MediaItem> = when {
        parentId == BrowseIds.ROOT -> listOf(
            folder(BrowseIds.HOME, "Home", MediaMetadata.MEDIA_TYPE_FOLDER_ALBUMS),
            folder(BrowseIds.RECENT, "Recent", MediaMetadata.MEDIA_TYPE_FOLDER_MIXED),
            folder(BrowseIds.LIBRARY, "Library", MediaMetadata.MEDIA_TYPE_FOLDER_MIXED),
            folder(BrowseIds.GENRES, "Genres", MediaMetadata.MEDIA_TYPE_FOLDER_GENRES),
        )
        parentId == BrowseIds.HOME -> api.home().newAlbums.map(::albumItem)
        parentId == BrowseIds.LIBRARY -> listOf(
            folder(BrowseIds.LIKED, "Liked Songs", MediaMetadata.MEDIA_TYPE_PLAYLIST),
            folder(BrowseIds.PLAYLISTS, "Playlists", MediaMetadata.MEDIA_TYPE_FOLDER_PLAYLISTS),
            folder(BrowseIds.DOWNLOADS, "Downloads", MediaMetadata.MEDIA_TYPE_PLAYLIST),
        )
        parentId == BrowseIds.PLAYLISTS -> api.playlists().map { p ->
            folder(BrowseIds.PLAYLIST + p.id, p.name, MediaMetadata.MEDIA_TYPE_PLAYLIST, subtitle = "${p.trackCount} songs",
                art = p.covers.firstOrNull()?.large)
        }
        parentId == BrowseIds.GENRES -> api.genres().map { g ->
            folder(BrowseIds.GENRE + g.name, g.name, MediaMetadata.MEDIA_TYPE_GENRE, art = g.cover?.large)
        }
        parentId.startsWith(BrowseIds.GENRE) -> api.genre(parentId.removePrefix(BrowseIds.GENRE)).albums.map(::albumItem)
        else -> {
            val list = when {
                parentId.startsWith(BrowseIds.ALBUM) -> "album:" + parentId.removePrefix(BrowseIds.ALBUM)
                parentId.startsWith(BrowseIds.PLAYLIST) -> "playlist:" + parentId.removePrefix(BrowseIds.PLAYLIST)
                parentId in setOf(BrowseIds.LIKED, BrowseIds.RECENT, BrowseIds.DOWNLOADS) -> parentId
                else -> null
            }
            list?.let { l -> tracks(l).map { trackItem(l, it) } }.orEmpty()
        }
    }

    /** The songs of a list (see [BrowseIds]). */
    suspend fun tracks(list: String): List<QueueTrack> = when {
        list.startsWith("album:") -> api.album(list.removePrefix("album:")).let { a ->
            val ref = AlbumRef(a.id, a.title, a.cover)
            a.tracks.map { it.toQueueTrack(ref) }
        }
        list.startsWith("playlist:") -> api.playlist(list.removePrefix("playlist:")).items.map { it.track.toQueueTrack() }
        list.startsWith("search:") -> search(list.removePrefix("search:"))
        list == BrowseIds.LIKED -> api.likes(limit = 100).items.map { it.toQueueTrack() }
        list == BrowseIds.RECENT -> api.recent().items.map { it.toQueueTrack() }
        list == BrowseIds.DOWNLOADS -> downloads.items.value.values
            .filter { it.status == DownloadStatus.Done }
            .map { it.track }
            .sortedWith(compareBy({ it.album.title }, { it.title }))
        else -> emptyList()
    }

    suspend fun search(query: String): List<QueueTrack> = api.search(query).tracks.map { it.toQueueTrack() }

    /** The queue for a playable browse id: the whole list, starting at the chosen song. */
    suspend fun queueFor(mediaId: String): Pair<List<QueueTrack>, Int>? {
        val (list, trackId) = BrowseIds.parseTrack(mediaId) ?: return null
        val tracks = tracks(list)
        val index = tracks.indexOfFirst { it.id == trackId }
        return if (index < 0) null else tracks to index
    }

    fun trackItem(list: String, track: QueueTrack): MediaItem =
        track.toMediaItem().buildUpon().setMediaId(BrowseIds.track(list, track.id)).build()

    private fun albumItem(a: AlbumDto) = folder(
        BrowseIds.ALBUM + a.id, a.title, MediaMetadata.MEDIA_TYPE_ALBUM, subtitle = a.artist.name, art = a.cover?.large,
    )

    private fun folder(id: String, title: String, type: Int, subtitle: String? = null, art: String? = null) =
        MediaItem.Builder()
            .setMediaId(id)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle)
                    .setArtworkUri(art?.let { Uri.parse(absoluteUrl(it)) })
                    .setIsBrowsable(true)
                    .setIsPlayable(false)
                    .setMediaType(type)
                    .build(),
            )
            .build()
}
