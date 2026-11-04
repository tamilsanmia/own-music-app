package snowsig.music.data.auth

import snowsig.music.data.api.UserDto

/** What survives an app restart: the refresh token and who it belongs to. */
data class StoredSession(val refreshToken: String, val user: UserDto?)

interface TokenStore {
    suspend fun read(): StoredSession?
    suspend fun save(refreshToken: String, user: UserDto)
    suspend fun clear()
}
