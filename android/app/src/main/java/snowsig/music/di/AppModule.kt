package snowsig.music.di

import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.serialization.json.Json
import okhttp3.Dispatcher
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import snowsig.music.BuildConfig
import snowsig.music.data.api.AuthApi
import snowsig.music.data.api.MusicApi
import snowsig.music.data.auth.AuthInterceptor
import snowsig.music.data.auth.KeystoreTokenStore
import snowsig.music.data.auth.SessionManager
import snowsig.music.data.auth.TokenAuthenticator
import snowsig.music.data.auth.TokenStore
import snowsig.music.offline.QueuedPlayReporter
import snowsig.music.playback.PlayReporter
import java.util.concurrent.TimeUnit
import javax.inject.Named
import javax.inject.Qualifier
import javax.inject.Singleton

/** A scope for work that should outlive any screen (e.g. reporting plays). */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class AppScope

@Module
@InstallIn(SingletonComponent::class)
abstract class BindingsModule {
    @Binds
    abstract fun tokenStore(impl: KeystoreTokenStore): TokenStore

    @Binds
    abstract fun playReporter(impl: QueuedPlayReporter): PlayReporter
}

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    @Singleton
    fun json(): Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
    }

    @Provides
    @Singleton
    @AppScope
    fun appScope(): CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /** Plain client: cover images, streaming, and the base for the API client. */
    @Provides
    @Singleton
    @Named("plain")
    fun plainClient(): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    /**
     * Login/refresh/logout get their own dispatcher. When several API calls get a 401 at once,
     * their threads wait in the authenticator for one refresh; if the refresh had to queue on the
     * same dispatcher (max 5 requests per host) it could never start: a deadlock.
     */
    @Provides
    @Singleton
    @Named("auth")
    fun authClient(@Named("plain") plain: OkHttpClient): OkHttpClient = plain.newBuilder()
        .dispatcher(Dispatcher())
        .build()

    /** Client for the API: adds the access token and refreshes it on 401. */
    @Provides
    @Singleton
    @Named("api")
    fun apiClient(@Named("plain") plain: OkHttpClient, session: SessionManager): OkHttpClient = plain.newBuilder()
        .addInterceptor(AuthInterceptor(session))
        .authenticator(TokenAuthenticator(session))
        .build()

    @Provides
    @Singleton
    fun authApi(@Named("auth") client: OkHttpClient, json: Json): AuthApi =
        retrofit(client, json).create(AuthApi::class.java)

    @Provides
    @Singleton
    fun musicApi(@Named("api") client: OkHttpClient, json: Json): MusicApi =
        retrofit(client, json).create(MusicApi::class.java)

    private fun retrofit(client: OkHttpClient, json: Json): Retrofit = Retrofit.Builder()
        .baseUrl(BuildConfig.BASE_URL + "/")
        .client(client)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()
}
