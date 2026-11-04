package snowsig.music.testing

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.rules.TestWatcher
import org.junit.runner.Description
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import snowsig.music.data.api.UserDto
import snowsig.music.data.auth.StoredSession
import snowsig.music.data.auth.TokenStore

/** Runs viewModelScope on a test dispatcher. */
@OptIn(ExperimentalCoroutinesApi::class)
class MainDispatcherRule(val dispatcher: TestDispatcher = UnconfinedTestDispatcher()) : TestWatcher() {
    override fun starting(description: Description) = Dispatchers.setMain(dispatcher)
    override fun finished(description: Description) = Dispatchers.resetMain()
}

class InMemoryTokenStore(var session: StoredSession? = null) : TokenStore {
    override suspend fun read() = session
    override suspend fun save(refreshToken: String, user: UserDto) {
        session = StoredSession(refreshToken, user)
    }
    override suspend fun clear() {
        session = null
    }
}

/** The app's real JSON settings, so tests catch serialization mistakes. */
val testJson: Json = snowsig.music.di.apiJson

fun <T> retrofitFor(server: MockWebServer, client: OkHttpClient, api: Class<T>): T = Retrofit.Builder()
    .baseUrl(server.url("/"))
    .client(client)
    .addConverterFactory(testJson.asConverterFactory("application/json".toMediaType()))
    .build()
    .create(api)

val testUser = UserDto(id = "u1", email = "ann@test.local", displayName = "Ann", role = "USER")

fun sessionJson(access: String, refresh: String) = """
    {"accessToken":"$access","expiresIn":900,"refreshToken":"$refresh","refreshExpiresAt":"2026-12-01T00:00:00.000Z",
     "user":{"id":"u1","email":"ann@test.local","displayName":"Ann","role":"USER","isActive":true}}
""".trimIndent()

fun json(body: String, code: Int = 200): MockResponse =
    MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)
