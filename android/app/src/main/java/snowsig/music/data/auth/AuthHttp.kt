package snowsig.music.data.auth

import kotlinx.coroutines.runBlocking
import okhttp3.Authenticator
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route

/** Adds the current access token to every request that doesn't carry one already. */
class AuthInterceptor(private val session: SessionManager) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = session.accessToken
        val request = chain.request()
        if (token == null || request.header("Authorization") != null) return chain.proceed(request)
        return chain.proceed(request.newBuilder().header("Authorization", "Bearer $token").build())
    }
}

/**
 * On a 401, refresh the session once and retry the request with the new token. OkHttp calls
 * this on its own thread, so blocking here is expected.
 */
class TokenAuthenticator(private val session: SessionManager) : Authenticator {
    override fun authenticate(route: Route?, response: Response): Request? {
        if (response.request.url.encodedPath.startsWith("/api/auth/")) return null
        if (priorResponses(response) >= 1) return null // already retried once
        val failed = response.request.header("Authorization")?.removePrefix("Bearer ")
        val token = runBlocking { session.refresh(failed) } ?: return null
        return response.request.newBuilder().header("Authorization", "Bearer $token").build()
    }

    private fun priorResponses(response: Response): Int {
        var n = 0
        var r = response.priorResponse
        while (r != null) {
            n++
            r = r.priorResponse
        }
        return n
    }
}
