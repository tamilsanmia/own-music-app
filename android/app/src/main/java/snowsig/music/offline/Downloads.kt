package snowsig.music.offline

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import androidx.media3.common.MimeTypes
import androidx.media3.common.StreamKey
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.hls.playlist.HlsMultivariantPlaylist
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadRequest
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.exoplayer.scheduler.Requirements
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import snowsig.music.data.api.AlbumRef
import snowsig.music.data.api.ImageUrls
import snowsig.music.data.api.Ref
import snowsig.music.data.settings.SettingsStore
import snowsig.music.di.AppScope
import snowsig.music.playback.QueueTrack
import snowsig.music.playback.trackUri
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Which HLS rendition to download by default. The server writes the master playlist with variants
 * in the order 96k, 160k, 320k (server/src/audio/ffmpeg.ts HLS_VARIANTS), so 160k is variant 1.
 * Settings can pick another (DownloadQuality.variantIndex).
 */
const val DOWNLOAD_VARIANT_INDEX = 1

/** Stored in the DownloadRequest, so the Downloads screen works without a network. */
@Serializable
data class DownloadedTrackInfo(
    val id: String,
    val title: String,
    val durationMs: Long? = null,
    val artistId: String,
    val artistName: String,
    val albumId: String,
    val albumTitle: String,
    val coverSmall: String? = null,
    val coverLarge: String? = null,
    val lossless: Boolean = false,
) {
    fun toQueueTrack() = QueueTrack(
        id, title, durationMs, Ref(artistId, artistName),
        AlbumRef(albumId, albumTitle, if (coverSmall != null && coverLarge != null) ImageUrls(coverSmall, coverLarge) else null),
        lossless,
    )

    companion object {
        fun of(t: QueueTrack) = DownloadedTrackInfo(
            t.id, t.title, t.durationMs, t.artist.id, t.artist.name, t.album.id, t.album.title, t.album.cover?.small, t.album.cover?.large,
            t.lossless,
        )
    }
}

private val json = Json { ignoreUnknownKeys = true }

@UnstableApi
fun downloadRequestFor(track: QueueTrack, variantIndex: Int = DOWNLOAD_VARIANT_INDEX): DownloadRequest =
    DownloadRequest.Builder(track.id, trackUri(track.id))
        .setMimeType(MimeTypes.APPLICATION_M3U8)
        .setStreamKeys(listOf(StreamKey(HlsMultivariantPlaylist.GROUP_INDEX_VARIANT, variantIndex)))
        .setData(json.encodeToString(DownloadedTrackInfo.serializer(), DownloadedTrackInfo.of(track)).toByteArray())
        .build()

@UnstableApi
fun DownloadRequest.trackInfo(): DownloadedTrackInfo? =
    runCatching { json.decodeFromString(DownloadedTrackInfo.serializer(), String(data)) }.getOrNull()

enum class DownloadStatus { Queued, Downloading, Done, Failed }

data class DownloadItem(val track: QueueTrack, val status: DownloadStatus, val percent: Float, val bytes: Long)

@UnstableApi
fun Download.toItem(): DownloadItem? {
    val info = request.trackInfo() ?: return null
    val status = when (state) {
        Download.STATE_COMPLETED -> DownloadStatus.Done
        Download.STATE_FAILED -> DownloadStatus.Failed
        Download.STATE_DOWNLOADING -> DownloadStatus.Downloading
        else -> DownloadStatus.Queued
    }
    return DownloadItem(info.toQueueTrack(), status, percentDownloaded.coerceAtLeast(0f), bytesDownloaded)
}

/** Downloads, by track id. Wraps Media3's DownloadManager and the foreground DownloadService. */
@UnstableApi
@Singleton
class DownloadsRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val manager: DownloadManager,
    @AppScope private val scope: CoroutineScope,
    private val settings: SettingsStore,
) {
    private val _items = MutableStateFlow<Map<String, DownloadItem>>(emptyMap())
    val items: StateFlow<Map<String, DownloadItem>> = _items.asStateFlow()

    private val _waitingForWifi = MutableStateFlow(false)
    /** Downloads are paused until the phone is on Wi-Fi (the "Wi-Fi only" setting). */
    val waitingForWifi: StateFlow<Boolean> = _waitingForWifi.asStateFlow()

    init {
        manager.addListener(object : DownloadManager.Listener {
            override fun onInitialized(downloadManager: DownloadManager) = publish()
            override fun onDownloadChanged(downloadManager: DownloadManager, download: Download, finalException: Exception?) = publish()
            override fun onDownloadRemoved(downloadManager: DownloadManager, download: Download) = publish()
            override fun onRequirementsStateChanged(downloadManager: DownloadManager, requirements: Requirements, notMetRequirements: Int) =
                publish()
        })
        scope.launch(kotlinx.coroutines.Dispatchers.Main) {
            settings.settings.map { it.downloadOnWifiOnly }.distinctUntilChanged().collect { wifiOnly ->
                manager.requirements = Requirements(if (wifiOnly) Requirements.NETWORK_UNMETERED else Requirements.NETWORK)
                publish()
            }
        }
        publish()
        // Progress isn't an event: poll while something is downloading.
        scope.launch(kotlinx.coroutines.Dispatchers.Main) {
            while (true) {
                if (manager.currentDownloads.isNotEmpty()) publish()
                delay(1000)
            }
        }
    }

    private fun publish() {
        val map = mutableMapOf<String, DownloadItem>()
        manager.downloadIndex.getDownloads().use { c ->
            while (c.moveToNext()) c.download.toItem()?.let { map[it.track.id] = it }
        }
        manager.currentDownloads.forEach { d -> d.toItem()?.let { map[it.track.id] = it } }
        _items.value = map
        _waitingForWifi.value = manager.notMetRequirements and Requirements.NETWORK_UNMETERED != 0 &&
            map.values.any { it.status == DownloadStatus.Queued || it.status == DownloadStatus.Downloading }
    }

    fun isDownloaded(trackId: String) = _items.value[trackId]?.status == DownloadStatus.Done

    /** The request of a finished download, used to play only the downloaded rendition. */
    fun completedRequest(trackId: String): DownloadRequest? =
        manager.downloadIndex.getDownload(trackId)?.takeIf { it.state == Download.STATE_COMPLETED }?.request

    fun download(tracks: List<QueueTrack>) {
        tracks.filterNot { _items.value[it.id]?.status == DownloadStatus.Done }.forEach {
            val variant = settings.settings.value.downloadQuality.variantIndex
            DownloadService.sendAddDownload(context, MusicDownloadService::class.java, downloadRequestFor(it, variant), false)
        }
    }

    fun remove(trackId: String) =
        DownloadService.sendRemoveDownload(context, MusicDownloadService::class.java, trackId, false)

    fun removeAll() = DownloadService.sendRemoveAllDownloads(context, MusicDownloadService::class.java, false)
}

/** Whether the phone has a usable internet connection right now. */
@Singleton
class Connectivity @Inject constructor(@ApplicationContext context: Context) {
    private val cm = context.getSystemService(ConnectivityManager::class.java)
    private val _online = MutableStateFlow(isOnlineNow())
    val online: StateFlow<Boolean> = _online.asStateFlow()

    init {
        cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { _online.value = isOnlineNow() }
            override fun onLost(network: Network) { _online.value = isOnlineNow() }
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                _online.value = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            }
        })
    }

    private fun isOnlineNow(): Boolean =
        cm.getNetworkCapabilities(cm.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
}
