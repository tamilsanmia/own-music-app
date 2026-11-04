package snowsig.music.data.api

import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

/** Login, refresh and logout. Uses an HTTP client without the auth interceptor/authenticator. */
interface AuthApi {
    @POST("api/auth/login")
    suspend fun login(@Body body: LoginRequest): SessionDto

    @POST("api/auth/refresh")
    suspend fun refresh(@Body body: RefreshRequest): SessionDto

    @POST("api/auth/logout")
    suspend fun logout(@Body body: RefreshRequest)
}

/** Everything else. Calls carry the access token and refresh it on 401 automatically. */
interface MusicApi {
    @GET("api/me")
    suspend fun me(): UserDto

    @GET("api/home")
    suspend fun home(): HomeDto

    @GET("api/albums/{id}")
    suspend fun album(@Path("id") id: String): AlbumDetailDto

    @GET("api/artists/{id}")
    suspend fun artist(@Path("id") id: String): ArtistDetailDto

    @GET("api/tracks/{id}/stream-url")
    suspend fun streamUrl(@Path("id") trackId: String): StreamUrlDto

    @GET("api/search")
    suspend fun search(@Query("q") query: String): SearchDto

    @GET("api/me/likes/ids")
    suspend fun likedIds(): List<String>

    @GET("api/me/likes")
    suspend fun likes(@Query("limit") limit: Int = 100, @Query("offset") offset: Int = 0): ItemsDto<TrackDto>

    @PUT("api/me/likes/{id}")
    suspend fun like(@Path("id") trackId: String)

    @DELETE("api/me/likes/{id}")
    suspend fun unlike(@Path("id") trackId: String)

    @POST("api/me/history")
    suspend fun recordPlay(@Body body: PlayRequest)

    @GET("api/me/recent")
    suspend fun recent(): ItemsDto<TrackDto>

    @GET("api/me/playlists")
    suspend fun playlists(): List<PlaylistSummaryDto>

    @GET("api/me/playlists/{id}")
    suspend fun playlist(@Path("id") id: String): PlaylistDto

    @POST("api/me/playlists")
    suspend fun createPlaylist(@Body body: CreatePlaylistRequest): PlaylistDto

    @PATCH("api/me/playlists/{id}")
    suspend fun renamePlaylist(@Path("id") id: String, @Body body: RenamePlaylistRequest): PlaylistDto

    @DELETE("api/me/playlists/{id}")
    suspend fun deletePlaylist(@Path("id") id: String)

    @POST("api/me/playlists/{id}/tracks")
    suspend fun addToPlaylist(@Path("id") id: String, @Body body: AddTracksRequest)

    @DELETE("api/me/playlists/{id}/tracks/{itemId}")
    suspend fun removeFromPlaylist(@Path("id") id: String, @Path("itemId") itemId: String): PlaylistDto

    @POST("api/me/playlists/{id}/move")
    suspend fun movePlaylistItem(@Path("id") id: String, @Body body: MoveRequest): PlaylistDto
}
