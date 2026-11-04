package snowsig.music.playback

import android.app.PendingIntent
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.cast.CastPlayer
import androidx.media3.cast.DefaultMediaItemConverter
import androidx.media3.cast.MediaItemConverter
import androidx.media3.cast.RemoteCastPlayer
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionError
import com.google.android.gms.cast.HlsSegmentFormat
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaQueueItem
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.guava.future
import kotlinx.coroutines.launch
import snowsig.music.MainActivity
import snowsig.music.data.api.MusicApi
import snowsig.music.data.api.RadioRequest
import snowsig.music.data.settings.SettingsStore
import snowsig.music.data.settings.StreamQuality
import snowsig.music.offline.Connectivity
import snowsig.music.offline.DownloadsRepository
import snowsig.music.widget.WidgetState
import snowsig.music.widget.WidgetUpdater
import javax.inject.Inject
import javax.inject.Named

/**
 * Plays music in the background. Media3's MediaLibraryService gives the notification, lock-screen
 * and Bluetooth/headset controls, a browse tree for Android Auto, and keeps playing when the app
 * is swiped away. Each queue item is "music://track/<id>"; [StreamResolver] swaps in a fresh
 * signed HLS URL when ExoPlayer loads it.
 *
 * The session's player is a [CastPlayer] around the local ExoPlayer, so playback moves to a
 * Chromecast and back when the user picks one. Effects that only make sense on the phone
 * (equalizer, fades) act on the ExoPlayer directly.
 */
@UnstableApi
@AndroidEntryPoint
class PlaybackService : MediaLibraryService() {
    @Inject lateinit var streamUrls: StreamUrls
    @Inject lateinit var playReporter: PlayReporter
    @Inject @Named("playback") lateinit var dataSource: DataSource.Factory
    @Inject lateinit var downloads: DownloadsRepository
    @Inject lateinit var settings: SettingsStore
    @Inject lateinit var sleepTimer: SleepTimer
    @Inject lateinit var effects: AudioEffects
    @Inject lateinit var api: MusicApi
    @Inject lateinit var connectivity: Connectivity
    @Inject lateinit var tree: LibraryTree
    @Inject lateinit var widget: WidgetUpdater

    private var session: MediaLibrarySession? = null
    private lateinit var exo: ExoPlayer
    /** What the session controls: the CastPlayer, or the ExoPlayer if Cast isn't available. */
    private lateinit var player: Player
    private val handler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val listen = ListenCounter()
    private var retriedAfterRefusal = false
    private var autoplayJob: Job? = null
    private var autoplaySeed: String? = null
    /** Last browser search, so the results page doesn't search twice. */
    private var lastSearch: Pair<String, List<QueueTrack>>? = null

    override fun onCreate() {
        super.onCreate()
        exo = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(dataSource))
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
                /* handleAudioFocus = */ true,
            )
            .setHandleAudioBecomingNoisy(true) // pause when headphones are unplugged
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
        exo.addListener(localListener)
        player = castPlayerAround(exo) ?: exo
        player.addListener(listener)

        val openApp = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        session = MediaLibrarySession.Builder(this, player, callback)
            .setSessionActivity(openApp)
            .build()

        effects.attach(exo.audioSessionId)
        scope.launch {
            settings.settings.map { it.streamQuality }.distinctUntilChanged().collect(::applyQuality)
        }
        scope.launch {
            settings.settings.map { it.fadeSeconds }.distinctUntilChanged().collect { updateVolumeTicker() }
        }
        scope.launch { sleepTimer.state.collect { updateVolumeTicker() } }
        updateWidget()
    }

    /** Null when Cast can't start (no Google Play services, for example). */
    private fun castPlayerAround(local: ExoPlayer): Player? = runCatching {
        val remote = RemoteCastPlayer.Builder(this).setMediaItemConverter(CastItemConverter(streamUrls)).build()
        CastPlayer.Builder(this).setLocalPlayer(local).setRemotePlayer(remote).build()
    }.onFailure { Log.w(TAG, "Cast is not available", it) }.getOrNull()

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

    /** Swiped away from recents: keep playing if music is on, otherwise shut down. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        val p = session?.player
        if (p == null || !p.playWhenReady || p.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        scope.cancel()
        effects.release()
        widget.show(WidgetState())
        session?.run {
            player.release() // a CastPlayer releases the ExoPlayer inside it too
            release()
        }
        session = null
        super.onDestroy()
    }

    /** A queue item ready to load: the downloaded rendition if there is one, else a stream. */
    private fun playable(item: MediaItem): MediaItem {
        val download = downloads.completedRequest(item.mediaId)
        if (download != null) return item.withPlayableUri().buildUpon().setStreamKeys(download.streamKeys).build()
        return item.withPlayableUri(preferLossless = settings.settings.value.streamQuality == StreamQuality.Lossless)
    }

    private fun applyQuality(q: StreamQuality) {
        exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon()
            .setMaxAudioBitrate(if (q == StreamQuality.DataSaver) DATA_SAVER_MAX_BITRATE else Int.MAX_VALUE)
            .setForceHighestSupportedBitrate(q == StreamQuality.High || q == StreamQuality.Lossless)
            .build()
    }

    // ---- session callback: queue items, and the browse tree for Android Auto ----

    private val callback = object : MediaLibrarySession.Callback {
        override fun onAddMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
        ): ListenableFuture<MutableList<MediaItem>> = scope.future {
            resolve(mediaItems).first.map(::playable).toMutableList()
        }

        /** A song picked in a browser plays its whole list; a voice search plays the results. */
        override fun onSetMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
            startIndex: Int,
            startPositionMs: Long,
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> = scope.future {
            val (items, start) = resolve(mediaItems, startIndex)
            val position = if (start == startIndex) startPositionMs else C.TIME_UNSET
            MediaSession.MediaItemsWithStartPosition(items.map(::playable), start.coerceAtLeast(0), position)
        }

        override fun onGetLibraryRoot(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<MediaItem>> = Futures.immediateFuture(
            if (mayBrowse(browser)) LibraryResult.ofItem(tree.root(), params) else LibraryResult.ofError(SessionError.ERROR_PERMISSION_DENIED),
        )

        override fun onGetChildren(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            parentId: String,
            page: Int,
            pageSize: Int,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> = scope.future {
            if (!mayBrowse(browser)) return@future LibraryResult.ofError(SessionError.ERROR_PERMISSION_DENIED)
            runCatching { tree.children(parentId) }.fold(
                { LibraryResult.ofItemList(it.page(page, pageSize), params) },
                {
                    Log.w(TAG, "Browse $parentId failed", it)
                    LibraryResult.ofError(SessionError.ERROR_IO)
                },
            )
        }

        override fun onGetItem(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            mediaId: String,
        ): ListenableFuture<LibraryResult<MediaItem>> = scope.future {
            if (!mayBrowse(browser)) return@future LibraryResult.ofError(SessionError.ERROR_PERMISSION_DENIED)
            val (list, trackId) = BrowseIds.parseTrack(mediaId) ?: return@future LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
            val track = runCatching { tree.tracks(list).firstOrNull { it.id == trackId } }.getOrNull()
            if (track == null) LibraryResult.ofError(SessionError.ERROR_BAD_VALUE) else LibraryResult.ofItem(tree.trackItem(list, track), null)
        }

        override fun onSearch(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            query: String,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<Void>> = scope.future {
            if (!mayBrowse(browser)) return@future LibraryResult.ofError(SessionError.ERROR_PERMISSION_DENIED)
            val results = runCatching { tree.search(query) }.getOrElse { return@future LibraryResult.ofError(SessionError.ERROR_IO) }
            lastSearch = query to results
            session.notifySearchResultChanged(browser, query, results.size, params)
            LibraryResult.ofVoid()
        }

        override fun onGetSearchResult(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            query: String,
            page: Int,
            pageSize: Int,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> = scope.future {
            if (!mayBrowse(browser)) return@future LibraryResult.ofError(SessionError.ERROR_PERMISSION_DENIED)
            val results = lastSearch?.takeIf { it.first == query }?.second
                ?: runCatching { tree.search(query) }.getOrElse { return@future LibraryResult.ofError(SessionError.ERROR_IO) }
            LibraryResult.ofItemList(results.map { tree.trackItem("search:$query", it) }.page(page, pageSize), params)
        }
    }

    /**
     * Turns what a controller sent into queue items with plain track ids. A single browse-tree
     * song becomes its whole list; an empty item with a search query (voice: "play Vaali on
     * Music") becomes the search results.
     */
    private suspend fun resolve(items: List<MediaItem>, startIndex: Int = 0): Pair<List<MediaItem>, Int> {
        val single = items.singleOrNull()
        if (single != null) {
            if (single.mediaId.isEmpty()) {
                // "Play <query>" plays the search results; just "play music" plays recent songs.
                val query = single.requestMetadata.searchQuery
                val list = if (query.isNullOrBlank()) BrowseIds.RECENT else "search:$query"
                val results = runCatching { tree.tracks(list) }.getOrDefault(emptyList())
                return results.map { it.toMediaItem() } to 0
            }
            runCatching { tree.queueFor(single.mediaId) }.getOrNull()?.let { (tracks, index) ->
                return tracks.map { it.toMediaItem() } to index
            }
        }
        val flat = items.map { item ->
            val parsed = BrowseIds.parseTrack(item.mediaId)
            if (parsed == null) item else item.buildUpon().setMediaId(parsed.second).build()
        }
        return flat to startIndex
    }

    /** Only this app, Android Auto, Assistant and system UIs may browse the library. */
    private fun mayBrowse(browser: MediaSession.ControllerInfo): Boolean =
        browser.packageName == packageName || browser.isTrusted || browser.packageName in TRUSTED_BROWSERS

    // ---- player events ----

    private val listener = object : Player.Listener {
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            listen.reset()
            retriedAfterRefusal = false
            if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED) autoplaySeed = null
            // Sleep timer "end of song": the next song has just started, so pause it.
            if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO && sleepTimer.state.value == SleepTimerState.EndOfTrack) {
                player.pause()
                sleepTimer.cancel()
            }
        }

        override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
            // Same item restarted (repeat one, "previous" after 3 s): a new play.
            if (oldPosition.mediaItemIndex == newPosition.mediaItemIndex && newPosition.positionMs < 1000 &&
                (reason == Player.DISCONTINUITY_REASON_AUTO_TRANSITION || oldPosition.positionMs > 3000)
            ) {
                listen.reset()
            }
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            handler.removeCallbacks(tick)
            if (isPlaying) {
                retriedAfterRefusal = false
                handler.post(tick)
            }
            updateVolumeTicker()
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            if (playbackState == Player.STATE_ENDED && sleepTimer.state.value == SleepTimerState.EndOfTrack) sleepTimer.cancel()
        }

        override fun onEvents(p: Player, events: Player.Events) {
            if (events.containsAny(
                    Player.EVENT_MEDIA_ITEM_TRANSITION, Player.EVENT_TIMELINE_CHANGED, Player.EVENT_REPEAT_MODE_CHANGED,
                    Player.EVENT_SHUFFLE_MODE_ENABLED_CHANGED, Player.EVENT_PLAYBACK_STATE_CHANGED,
                )
            ) {
                maybeExtendQueue()
            }
            if (events.containsAny(Player.EVENT_TIMELINE_CHANGED, Player.EVENT_MEDIA_ITEM_TRANSITION)) prefetchCastUrls()
            if (events.containsAny(
                    Player.EVENT_MEDIA_ITEM_TRANSITION, Player.EVENT_IS_PLAYING_CHANGED, Player.EVENT_MEDIA_METADATA_CHANGED,
                    Player.EVENT_TIMELINE_CHANGED, Player.EVENT_PLAY_WHEN_READY_CHANGED,
                )
            ) {
                updateWidget()
            }
        }
    }

    /** Events of the phone's own player only. */
    private val localListener = object : Player.Listener {
        override fun onPlayerError(error: PlaybackException) {
            // The signed URL expired (paused for hours) or was refused: get a new one, once.
            val cause = error.cause
            val refused = cause is HttpDataSource.InvalidResponseCodeException && cause.responseCode in setOf(401, 403)
            val id = exo.currentMediaItem?.mediaId
            if (refused && id != null && !retriedAfterRefusal) {
                retriedAfterRefusal = true
                streamUrls.invalidate(id)
                exo.prepare()
                exo.play()
            }
        }

        override fun onAudioSessionIdChanged(audioSessionId: Int) = effects.attach(audioSessionId)
    }

    /**
     * Moving the queue to a Chromecast converts items on the main thread, and each needs a signed
     * URL. Fetch them for the songs around the current one, so the switch doesn't stall. Local
     * playback uses the same URLs, so this costs little extra.
     */
    private fun prefetchCastUrls() {
        if (player === exo) return
        val from = player.currentMediaItemIndex.coerceAtLeast(0)
        val ids = (from until minOf(player.mediaItemCount, from + PREFETCH_WINDOW)).map { player.getMediaItemAt(it).mediaId }
            .filter { downloads.completedRequest(it) == null && streamUrls.cached(it) == null }
        if (ids.isEmpty()) return
        scope.launch(Dispatchers.IO) { ids.forEach { id -> runCatching { streamUrls.get(id) } } }
    }

    // ---- autoplay ----

    /** When the last song in the queue starts, add similar songs after it. */
    private fun maybeExtendQueue() {
        val s = settings.settings.value
        val canExtend = shouldExtendQueue(
            autoplay = s.autoplay,
            repeatOff = player.repeatMode == Player.REPEAT_MODE_OFF,
            hasNext = player.hasNextMediaItem(),
            itemCount = player.mediaItemCount,
            online = connectivity.online.value,
        )
        val seed = player.currentMediaItem?.mediaId
        if (!canExtend || seed == null || seed == autoplaySeed || autoplayJob?.isActive == true) return
        autoplaySeed = seed
        val queued = (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId }
        autoplayJob = scope.launch {
            val more = runCatching { api.radio(RadioRequest(seed, queued.takeLast(MAX_EXCLUDE), AUTOPLAY_BATCH)).items }
                .onFailure { Log.w(TAG, "Autoplay failed", it) }
                .getOrNull().orEmpty()
            if (more.isEmpty() || player.currentMediaItem?.mediaId != seed) return@launch
            val ended = player.playbackState == Player.STATE_ENDED
            val start = player.mediaItemCount
            player.addMediaItems(more.map { playable(it.toQueueTrack().toMediaItem()) })
            if (ended) {
                player.seekTo(start, 0)
                player.play()
            }
        }
    }

    // ---- volume: fades between songs, and the sleep timer's fade-out ----

    private val volumeTick = object : Runnable {
        override fun run() {
            applyVolume()
            handler.postDelayed(this, VOLUME_TICK_MS)
        }
    }

    private fun fadeMs() = settings.settings.value.fadeSeconds * 1000L

    private fun updateVolumeTicker() {
        handler.removeCallbacks(volumeTick)
        val timed = sleepTimer.state.value is SleepTimerState.At
        if (timed || (fadeMs() > 0 && player.isPlaying)) handler.post(volumeTick) else exo.volume = 1f
    }

    private fun applyVolume() {
        var volume = 1f
        val fade = fadeMs()
        if (fade > 0) {
            val duration = exo.duration.takeIf { it != C.TIME_UNSET } ?: 0
            volume *= fadeVolume(exo.currentPosition, duration, fade)
        }
        val remaining = sleepTimer.remainingMs()
        if (remaining != null) {
            if (remaining <= 0) {
                player.pause()
                sleepTimer.cancel() // collecting the state stops this ticker
                volume = 1f
            } else {
                volume *= sleepVolume(remaining)
            }
        }
        exo.volume = volume
    }

    // ---- widget and play counting ----

    private fun updateWidget() {
        val item = player.currentMediaItem
        val track = item?.toQueueTrack()
        widget.show(
            WidgetState(
                title = track?.title,
                artist = track?.artist?.name,
                coverPath = track?.album?.cover?.small,
                isPlaying = player.isPlaying,
                hasQueue = item != null,
            ),
        )
    }

    /** Once a second while playing: count listening time for "Recently played". */
    private val tick = object : Runnable {
        override fun run() {
            val id = player.currentMediaItem?.mediaId
            if (id != null) {
                val duration = player.duration.takeIf { it != C.TIME_UNSET }?.div(1000.0) ?: Double.NaN
                if (listen.tick(player.currentPosition / 1000.0, duration)) playReporter.report(id)
            }
            handler.postDelayed(this, 1000)
        }
    }

    private companion object {
        const val TAG = "Music"
        const val DATA_SAVER_MAX_BITRATE = 128_000
        const val AUTOPLAY_BATCH = 10
        const val MAX_EXCLUDE = 500
        const val VOLUME_TICK_MS = 200L
        const val PREFETCH_WINDOW = 20
        val TRUSTED_BROWSERS = setOf(
            "com.google.android.projection.gearhead", // Android Auto
            "com.google.android.carassistant",
            "com.google.android.googlequicksearchbox", // Assistant
            "com.android.systemui",
        )
    }
}

private fun <T> List<T>.page(page: Int, pageSize: Int): List<T> =
    if (pageSize <= 0 || pageSize == Int.MAX_VALUE) this else drop(page * pageSize).take(pageSize)

/**
 * Chromecast receivers need a real URL: the signed HLS master (AAC; receivers can't play the
 * FLAC stream) with fMP4 segments. Coming back to the phone, items get their music:// URI again.
 */
@UnstableApi
private class CastItemConverter(private val urls: StreamUrls) : MediaItemConverter {
    private val default = DefaultMediaItemConverter()

    override fun toMediaQueueItem(mediaItem: MediaItem): MediaQueueItem {
        val url = runCatching { urls.get(mediaItem.mediaId) }.getOrElse { urls.cached(mediaItem.mediaId) ?: "" }
        val withUrl = mediaItem.buildUpon().setUri(url).setMimeType(MimeTypes.APPLICATION_M3U8).build()
        val media = default.toMediaQueueItem(withUrl).media ?: return default.toMediaQueueItem(withUrl)
        val info = MediaInfo.Builder(media.contentId)
            .setStreamType(media.streamType)
            .setContentType(media.contentType ?: MimeTypes.APPLICATION_M3U8)
            .setContentUrl(media.contentUrl ?: url)
            .setMetadata(media.metadata)
            .setCustomData(media.customData)
            .setHlsSegmentFormat(HlsSegmentFormat.FMP4)
            .build()
        return MediaQueueItem.Builder(info).build()
    }

    override fun toMediaItem(mediaQueueItem: MediaQueueItem): MediaItem =
        default.toMediaItem(mediaQueueItem).withPlayableUri()
}
