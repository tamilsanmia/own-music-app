package snowsig.music.offline

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dagger.Module
import dagger.Provides
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import retrofit2.HttpException
import snowsig.music.data.api.MusicApi
import snowsig.music.data.api.PlayRequest
import snowsig.music.di.AppScope
import snowsig.music.playback.PlayReporter
import java.io.IOException
import java.time.Instant
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/** A counted play waiting to be sent (offline, or the server didn't answer). */
@Entity(tableName = "pending_plays")
data class PendingPlay(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val trackId: String,
    /** ISO-8601, so the server records when it was really played. */
    val playedAt: String,
)

@Dao
interface PendingPlayDao {
    @Insert
    suspend fun insert(play: PendingPlay)

    @Query("SELECT * FROM pending_plays ORDER BY id LIMIT :limit")
    suspend fun oldest(limit: Int): List<PendingPlay>

    @Query("DELETE FROM pending_plays WHERE id = :id")
    suspend fun delete(id: Long)
}

@Database(entities = [PendingPlay::class], version = 1, exportSchema = false)
abstract class OfflineDb : RoomDatabase() {
    abstract fun pendingPlays(): PendingPlayDao
}

@Module
@InstallIn(SingletonComponent::class)
object OfflineDbModule {
    @Provides
    @Singleton
    fun db(@ApplicationContext context: Context): OfflineDb = Room.databaseBuilder(context, OfflineDb::class.java, "offline.db").build()

    @Provides
    fun pendingPlays(db: OfflineDb): PendingPlayDao = db.pendingPlays()
}

/** Sends pending plays, oldest first. */
class PlayFlusher @Inject constructor(private val dao: PendingPlayDao, private val api: MusicApi) {
    enum class Outcome { Done, Retry }

    suspend fun flush(batch: Int = 200): Outcome {
        for (play in dao.oldest(batch)) {
            try {
                api.recordPlay(PlayRequest(play.trackId, play.playedAt))
                dao.delete(play.id)
            } catch (e: HttpException) {
                when {
                    // 4xx: the server will never accept it (track deleted, older than 30 days...). Drop it.
                    e.code() in 400..499 && e.code() != 401 && e.code() != 429 -> dao.delete(play.id)
                    else -> return Outcome.Retry
                }
            } catch (e: IOException) {
                return Outcome.Retry
            }
        }
        return Outcome.Done
    }
}

@HiltWorker
class FlushPlaysWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val flusher: PlayFlusher,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result =
        if (flusher.flush() == PlayFlusher.Outcome.Done) Result.success() else Result.retry()
}

/**
 * Plays are stored first and sent by WorkManager when there's a connection, so plays of
 * downloaded songs made offline still show up in "Recently played" later.
 */
@Singleton
class QueuedPlayReporter @Inject constructor(
    @ApplicationContext private val context: Context,
    private val dao: PendingPlayDao,
    @AppScope private val scope: CoroutineScope,
) : PlayReporter {
    override fun report(trackId: String) {
        scope.launch {
            dao.insert(PendingPlay(trackId = trackId, playedAt = Instant.now().toString()))
            val work = OneTimeWorkRequestBuilder<FlushPlaysWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("flush-plays", ExistingWorkPolicy.APPEND_OR_REPLACE, work)
        }
    }
}
