package snowsig.music.offline

import android.app.Notification
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadNotificationHelper
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.exoplayer.scheduler.Requirements
import androidx.media3.exoplayer.scheduler.Scheduler
import dagger.hilt.android.AndroidEntryPoint
import snowsig.music.R
import javax.inject.Inject

/** Runs downloads in the foreground with a progress notification. */
@UnstableApi
@AndroidEntryPoint
class MusicDownloadService : DownloadService(
    NOTIFICATION_ID,
    DEFAULT_FOREGROUND_NOTIFICATION_UPDATE_INTERVAL,
    CHANNEL_ID,
    R.string.downloads_channel,
    R.string.downloads_channel_description,
) {
    @Inject lateinit var manager: DownloadManager

    private val notifications by lazy { DownloadNotificationHelper(this, CHANNEL_ID) }

    override fun getDownloadManager(): DownloadManager = manager

    /** No background scheduler: downloads continue while the app or this service runs. */
    override fun getScheduler(): Scheduler? = null

    override fun getForegroundNotification(downloads: MutableList<Download>, notMetRequirements: @Requirements.RequirementFlags Int): Notification =
        notifications.buildProgressNotification(
            this,
            R.drawable.ic_launcher_foreground,
            null,
            resources.getQuantityString(R.plurals.downloading_songs, downloads.size, downloads.size),
            downloads,
            notMetRequirements,
        )

    private companion object {
        const val NOTIFICATION_ID = 2
        const val CHANNEL_ID = "downloads"
    }
}
