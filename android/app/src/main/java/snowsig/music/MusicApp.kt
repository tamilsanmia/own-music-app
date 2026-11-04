package snowsig.music

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import dagger.hilt.android.HiltAndroidApp
import okhttp3.OkHttpClient
import javax.inject.Inject
import javax.inject.Named

@HiltAndroidApp
class MusicApp : Application(), SingletonImageLoader.Factory {
    @Inject
    @Named("plain")
    lateinit var httpClient: OkHttpClient

    /** Cover images are public (unguessable URLs), so Coil uses the plain client. */
    override fun newImageLoader(context: PlatformContext): ImageLoader = ImageLoader.Builder(context)
        .components { add(OkHttpNetworkFetcherFactory(callFactory = { httpClient })) }
        .crossfade(true)
        .build()
}

/** Server paths like "/media/covers/x-300.webp" to absolute URLs. */
fun absoluteUrl(path: String): String = if (path.startsWith("http")) path else BuildConfig.BASE_URL + path
