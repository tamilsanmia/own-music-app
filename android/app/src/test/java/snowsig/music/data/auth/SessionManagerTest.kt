package snowsig.music.data.auth

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import snowsig.music.data.api.AuthApi
import snowsig.music.data.api.MusicApi
import snowsig.music.testing.InMemoryTokenStore
import snowsig.music.testing.json
import snowsig.music.testing.retrofitFor
import snowsig.music.testing.sessionJson
import snowsig.music.testing.testUser
import java.util.concurrent.atomic.AtomicInteger

/** The real OkHttp interceptor + authenticator + SessionManager against a fake server. */
class SessionManagerTest {
    private lateinit var server: MockWebServer
    private lateinit var store: InMemoryTokenStore
    private lateinit var session: SessionManager
    private lateinit var api: MusicApi
    private val refreshes = AtomicInteger()

    /** Server state: which access token is valid and which refresh token it accepts. */
    @Volatile private var validAccess = "at-1"
    @Volatile private var validRefresh = "rt-1"
    @Volatile private var refreshWorks = true

    @Before
    fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when (request.path) {
                "/api/auth/login" -> json(sessionJson("at-1", "rt-1"))
                "/api/auth/refresh" -> {
                    refreshes.incrementAndGet()
                    Thread.sleep(50) // let concurrent 401s pile up
                    val sent = request.body.readUtf8()
                    if (refreshWorks && sent.contains("\"$validRefresh\"")) {
                        val n = refreshes.get() + 1
                        validAccess = "at-$n"
                        validRefresh = "rt-$n"
                        json(sessionJson(validAccess, validRefresh))
                    } else {
                        json("""{"message":"Unauthorized","statusCode":401}""", 401)
                    }
                }
                "/api/auth/logout" -> MockResponse().setResponseCode(204)
                "/api/me" ->
                    if (request.getHeader("Authorization") == "Bearer $validAccess") {
                        json("""{"id":"u1","email":"ann@test.local","displayName":"Ann","role":"USER","isActive":true}""")
                    } else {
                        json("""{"message":"Unauthorized","statusCode":401}""", 401)
                    }
                else -> MockResponse().setResponseCode(404)
            }
        }
        server.start()
        store = InMemoryTokenStore()
        val plain = OkHttpClient()
        // Same setup as AppModule: the auth client has its own dispatcher.
        val authClient = plain.newBuilder().dispatcher(okhttp3.Dispatcher()).build()
        session = SessionManager(retrofitFor(server, authClient, AuthApi::class.java), store)
        val authed = plain.newBuilder().addInterceptor(AuthInterceptor(session)).authenticator(TokenAuthenticator(session)).build()
        api = retrofitFor(server, authed, MusicApi::class.java)
    }

    @After
    fun tearDown() = server.shutdown()

    @Test
    fun `login stores the refresh token and signs in`() = runTest {
        session.login("ann@test.local", "pw")
        assertEquals(SessionState.SignedIn(testUser), session.state.value)
        assertEquals("rt-1", store.session?.refreshToken)
        assertEquals("Ann", api.me().displayName)
    }

    @Test
    fun `an expired access token is refreshed once and the request retried`() = runTest {
        session.login("ann@test.local", "pw")
        validAccess = "at-expired-on-server" // the server no longer accepts at-1
        validRefresh = "rt-1"
        assertEquals("Ann", api.me().displayName)
        assertEquals(1, refreshes.get())
        assertEquals("rt-2", store.session?.refreshToken)
    }

    @Test
    fun `concurrent 401s share one refresh, even more than OkHttp's 5 per host`() {
        runBlocking { session.login("ann@test.local", "pw") }
        validAccess = "at-expired-on-server"
        val results = runBlocking(kotlinx.coroutines.Dispatchers.IO) {
            (1..8).map { async { api.me().displayName } }.awaitAll()
        }
        assertEquals(List(8) { "Ann" }, results)
        assertEquals(1, refreshes.get())
    }

    @Test
    fun `a rejected refresh signs out and clears the stored token`() = runTest {
        session.login("ann@test.local", "pw")
        validAccess = "at-expired-on-server"
        refreshWorks = false
        val failed = runCatching { api.me() }
        assertTrue(failed.isFailure)
        assertEquals(SessionState.SignedOut, session.state.value)
        assertNull(store.session)
        assertNull(session.accessToken)
    }

    @Test
    fun `restore signs in from the stored refresh token`() = runTest {
        store.session = StoredSession("rt-1", testUser)
        session.restore()
        assertEquals(SessionState.SignedIn(testUser), session.state.value)
        assertEquals("at-2", session.accessToken)
    }

    @Test
    fun `restore stays signed in with the cached user when the server is unreachable`() = runTest {
        store.session = StoredSession("rt-1", testUser)
        server.shutdown()
        session.restore()
        assertEquals(SessionState.SignedIn(testUser), session.state.value)
        assertNull(session.accessToken)
        assertEquals("rt-1", store.session?.refreshToken) // kept for later
    }

    @Test
    fun `restore without a stored session is signed out`() = runTest {
        session.restore()
        assertEquals(SessionState.SignedOut, session.state.value)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `logout clears locally and tells the server`() = runTest {
        session.login("ann@test.local", "pw")
        session.logout()
        assertEquals(SessionState.SignedOut, session.state.value)
        assertNull(store.session)
        val paths = (1..server.requestCount).map { server.takeRequest().path }
        assertEquals(listOf("/api/auth/login", "/api/auth/logout"), paths)
    }
}
