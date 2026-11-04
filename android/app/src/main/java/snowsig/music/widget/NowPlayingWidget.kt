package snowsig.music.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.widget.RemoteViews
import coil3.SingletonImageLoader
import coil3.request.ImageRequest
import coil3.request.allowHardware
import coil3.toBitmap
import dagger.hilt.android.AndroidEntryPoint
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import snowsig.music.MainActivity
import snowsig.music.R
import snowsig.music.absoluteUrl
import snowsig.music.playback.PlayerConnection
import javax.inject.Inject
import javax.inject.Singleton

/** What the widget shows. [hasQueue] false means "nothing to play": tapping opens the app. */
data class WidgetState(
    val title: String? = null,
    val artist: String? = null,
    val coverPath: String? = null,
    val isPlaying: Boolean = false,
    val hasQueue: Boolean = false,
)

/** Draws the home-screen widget. The playback service calls [show] whenever the song or state changes. */
@Singleton
class WidgetUpdater @Inject constructor(@ApplicationContext private val context: Context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var state = WidgetState()
    private var art: Pair<String, Bitmap>? = null
    private var artJob: Job? = null

    fun show(next: WidgetState) {
        state = next
        render()
        val path = next.coverPath
        if (path != null && art?.first != path) {
            artJob?.cancel()
            artJob = scope.launch {
                val bitmap = runCatching {
                    val request = ImageRequest.Builder(context).data(absoluteUrl(path)).size(ART_PX).allowHardware(false).build()
                    SingletonImageLoader.get(context).execute(request).image?.toBitmap()
                }.getOrNull()
                if (bitmap != null) {
                    art = path to bitmap
                    render()
                }
            }
        }
    }

    /** Redraw with the last known state (e.g. when a widget is added). */
    fun refresh() = render()

    private fun render() {
        val manager = AppWidgetManager.getInstance(context)
        val ids = manager.getAppWidgetIds(ComponentName(context, NowPlayingWidget::class.java))
        if (ids.isEmpty()) return
        val s = state
        val views = RemoteViews(context.packageName, R.layout.widget_now_playing).apply {
            setTextViewText(R.id.widget_title, s.title ?: context.getString(R.string.widget_idle_title))
            setTextViewText(R.id.widget_artist, s.artist ?: context.getString(R.string.widget_idle_subtitle))
            val bitmap = art?.takeIf { it.first == s.coverPath }?.second
            if (bitmap != null) setImageViewBitmap(R.id.widget_art, bitmap) else setImageViewResource(R.id.widget_art, R.drawable.widget_art_placeholder)
            setImageViewResource(R.id.widget_play, if (s.isPlaying) R.drawable.ic_widget_pause else R.drawable.ic_widget_play)
            setContentDescription(R.id.widget_play, context.getString(if (s.isPlaying) R.string.widget_pause else R.string.widget_play))
            val open = openApp()
            setOnClickPendingIntent(R.id.widget_root, open)
            if (s.hasQueue) {
                setOnClickPendingIntent(R.id.widget_play, action(NowPlayingWidget.ACTION_TOGGLE))
                setOnClickPendingIntent(R.id.widget_next, action(NowPlayingWidget.ACTION_NEXT))
                setOnClickPendingIntent(R.id.widget_prev, action(NowPlayingWidget.ACTION_PREVIOUS))
            } else {
                setOnClickPendingIntent(R.id.widget_play, open)
                setOnClickPendingIntent(R.id.widget_next, open)
                setOnClickPendingIntent(R.id.widget_prev, open)
            }
        }
        manager.updateAppWidget(ids, views)
    }

    private fun openApp(): PendingIntent = PendingIntent.getActivity(
        context,
        0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun action(name: String): PendingIntent = PendingIntent.getBroadcast(
        context,
        name.hashCode(),
        Intent(context, NowPlayingWidget::class.java).setAction(name),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private companion object {
        const val ART_PX = 192
    }
}

/** The 4x1 "Now playing" widget. Buttons send broadcasts here, which control the player. */
@AndroidEntryPoint
class NowPlayingWidget : AppWidgetProvider() {
    @Inject lateinit var updater: WidgetUpdater
    @Inject lateinit var player: PlayerConnection

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent) // Hilt injects here
        val command: ((PlayerConnection) -> Unit)? = when (intent.action) {
            ACTION_TOGGLE -> PlayerConnection::togglePlay
            ACTION_NEXT -> PlayerConnection::next
            ACTION_PREVIOUS -> PlayerConnection::previous
            else -> null
        }
        if (command != null) {
            // Keep the process alive until the player has the command (it may need to connect first).
            val pending = goAsync()
            player.whenConnected {
                command(player)
                pending.finish()
            }
        }
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        updater.refresh()
    }

    companion object {
        const val ACTION_TOGGLE = "snowsig.music.widget.TOGGLE"
        const val ACTION_NEXT = "snowsig.music.widget.NEXT"
        const val ACTION_PREVIOUS = "snowsig.music.widget.PREVIOUS"
    }
}
