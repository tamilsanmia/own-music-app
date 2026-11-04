package snowsig.music.playback

import android.app.PendingIntent
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import dagger.hilt.android.AndroidEntryPoint
import okhttp3.OkHttpClient
import snowsig.music.MainActivity
import javax.inject.Inject
import javax.inject.Named

/**
 * Plays music in the background. Media3's MediaSessionService gives the notification, lock-screen
 * and Bluetooth/headset controls, and keeps playing when the app is swiped away. Each queue item
 * is "music://track/<id>"; [StreamResolver] swaps in a fresh signed HLS URL when ExoPlayer loads it.
 */
@UnstableApi
@AndroidEntryPoint
class PlaybackService : MediaSessionService() {
    @Inject lateinit var streamUrls: StreamUrls
    @Inject lateinit var playReporter: PlayReporter
    @Inject @Named("plain") lateinit var httpClient: OkHttpClient

    private var session: MediaSession? = null
    private lateinit var player: ExoPlayer
    private val handler = Handler(Looper.getMainLooper())
    private val listen = ListenCounter()
    private var retriedAfterRefusal = false

    override fun onCreate() {
        super.onCreate()
        val dataSource = ResolvingDataSource.Factory(OkHttpDataSource.Factory(httpClient), StreamResolver(streamUrls))
        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(dataSource))
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
                /* handleAudioFocus = */ true,
            )
            .setHandleAudioBecomingNoisy(true) // pause when headphones are unplugged
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
        player.addListener(listener)

        val openApp = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        session = MediaSession.Builder(this, player)
            .setSessionActivity(openApp)
            .setCallback(callback)
            .build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    /** Swiped away from recents: keep playing if music is on, otherwise shut down. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        val p = session?.player
        if (p == null || !p.playWhenReady || p.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        session?.run {
            player.release()
            release()
        }
        session = null
        super.onDestroy()
    }

    private val callback = object : MediaSession.Callback {
        /** Items from controllers arrive without their URI; restore it from the media id. */
        override fun onAddMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
        ): ListenableFuture<MutableList<MediaItem>> =
            Futures.immediateFuture(mediaItems.map { it.withPlayableUri() }.toMutableList())
    }

    private val listener = object : Player.Listener {
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            listen.reset()
            retriedAfterRefusal = false
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
        }

        override fun onPlayerError(error: PlaybackException) {
            // The signed URL expired (paused for hours) or was refused: get a new one, once.
            val cause = error.cause
            val refused = cause is HttpDataSource.InvalidResponseCodeException && cause.responseCode in setOf(401, 403)
            val id = player.currentMediaItem?.mediaId
            if (refused && id != null && !retriedAfterRefusal) {
                retriedAfterRefusal = true
                streamUrls.invalidate(id)
                player.prepare()
                player.play()
            }
        }
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
}
