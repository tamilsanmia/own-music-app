package snowsig.music.offline

import android.content.Context
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.DatabaseProvider
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.datasource.cache.Cache
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.NoOpCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.offline.DefaultDownloadIndex
import androidx.media3.exoplayer.offline.DefaultDownloaderFactory
import androidx.media3.exoplayer.offline.DownloadManager
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import snowsig.music.playback.StreamResolver
import snowsig.music.playback.StreamUrls
import java.io.File
import java.util.concurrent.Executors
import javax.inject.Named
import javax.inject.Singleton

/**
 * The download cache and manager, shared by downloads and playback.
 *
 * Requests go: CacheDataSource (keys without tokens) -> ResolvingDataSource (music://track/<id>
 * to a signed URL) -> OkHttp. Downloads write to the cache; playback only reads it, so streaming
 * doesn't fill the phone, but downloaded songs play from disk, online or not.
 */
@UnstableApi
@Module
@InstallIn(SingletonComponent::class)
object MediaModule {
    @Provides
    @Singleton
    fun databaseProvider(@ApplicationContext context: Context): DatabaseProvider = StandaloneDatabaseProvider(context)

    /** App-private storage; nothing is evicted automatically. Removed with the app. */
    @Provides
    @Singleton
    fun downloadCache(@ApplicationContext context: Context, db: DatabaseProvider): Cache =
        SimpleCache(File(context.filesDir, "downloads"), NoOpCacheEvictor(), db)

    @Provides
    @Singleton
    @Named("network")
    fun networkSource(@Named("plain") client: OkHttpClient, urls: StreamUrls): DataSource.Factory =
        ResolvingDataSource.Factory(OkHttpDataSource.Factory(client), StreamResolver(urls))

    @Provides
    @Singleton
    @Named("playback")
    fun playbackSource(cache: Cache, @Named("network") network: DataSource.Factory): DataSource.Factory =
        CacheDataSource.Factory()
            .setCache(cache)
            .setUpstreamDataSourceFactory(network)
            .setCacheKeyFactory(TokenStrippingCacheKeyFactory)
            .setCacheWriteDataSinkFactory(null) // read-only: streaming doesn't fill the cache
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)

    @Provides
    @Singleton
    fun downloadManager(
        @ApplicationContext context: Context,
        db: DatabaseProvider,
        cache: Cache,
        @Named("network") network: DataSource.Factory,
    ): DownloadManager {
        val writing = CacheDataSource.Factory()
            .setCache(cache)
            .setUpstreamDataSourceFactory(network)
            .setCacheKeyFactory(TokenStrippingCacheKeyFactory)
        return DownloadManager(
            context,
            DefaultDownloadIndex(db),
            DefaultDownloaderFactory(writing, Executors.newFixedThreadPool(2)),
        ).apply { maxParallelDownloads = 2 }
    }
}
