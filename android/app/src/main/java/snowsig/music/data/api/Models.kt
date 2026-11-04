package snowsig.music.data.api

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable

/** JSON shapes of the server API (see server/src/**/presenters.ts). */

@Serializable
data class UserDto(
    val id: String,
    val email: String,
    val displayName: String,
    val role: String,
    val isActive: Boolean = true,
)

/**
 * "client": "mobile" makes the server return the refresh token in the body (web clients get a
 * cookie instead). It must always be sent, even though it's a default value.
 */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class LoginRequest(
    val email: String,
    val password: String,
    @EncodeDefault val client: String = "mobile",
)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class SessionDto(
    val accessToken: String,
    val expiresIn: Int,
    val refreshToken: String,
    val refreshExpiresAt: String,
    val user: UserDto,
)

@Serializable
data class ImageUrls(val small: String, val large: String)

@Serializable
data class Ref(val id: String, val name: String)

@Serializable
data class AlbumRef(val id: String, val title: String, val cover: ImageUrls? = null)

@Serializable
data class AlbumDto(
    val id: String,
    val title: String,
    val releaseYear: Int? = null,
    val artist: Ref,
    val cover: ImageUrls? = null,
)

@Serializable
data class TrackDto(
    val id: String,
    val title: String,
    val trackNumber: Int,
    val durationMs: Long? = null,
    val artist: Ref,
    /** Present outside album pages (search, likes, recent, playlists). */
    val album: AlbumRef? = null,
)

@Serializable
data class AlbumDetailDto(
    val id: String,
    val title: String,
    val releaseYear: Int? = null,
    val artist: Ref,
    val cover: ImageUrls? = null,
    val tracks: List<TrackDto>,
)

@Serializable
data class ArtistDto(val id: String, val name: String, val bio: String? = null, val image: ImageUrls? = null)

@Serializable
data class ArtistDetailDto(
    val id: String,
    val name: String,
    val bio: String? = null,
    val image: ImageUrls? = null,
    val albums: List<AlbumDto>,
)

@Serializable
data class HomeDto(val newAlbums: List<AlbumDto>)

@Serializable
data class ItemsDto<T>(val items: List<T>, val total: Int? = null)

@Serializable
data class StreamUrlDto(val url: String, val expiresAt: String)

@Serializable
data class SearchDto(val tracks: List<TrackDto>, val albums: List<AlbumDto>, val artists: List<ArtistDto>)

@Serializable
data class PlayRequest(val trackId: String, val playedAt: String? = null)

@Serializable
data class PlaylistSummaryDto(
    val id: String,
    val name: String,
    val description: String? = null,
    val trackCount: Int,
    val covers: List<ImageUrls> = emptyList(),
)

@Serializable
data class PlaylistItemDto(val itemId: String, val track: TrackDto)

@Serializable
data class PlaylistDto(
    val id: String,
    val name: String,
    val description: String? = null,
    val trackCount: Int,
    val covers: List<ImageUrls> = emptyList(),
    val items: List<PlaylistItemDto>,
)

@Serializable
data class CreatePlaylistRequest(val name: String)

@Serializable
data class RenamePlaylistRequest(val name: String)

@Serializable
data class AddTracksRequest(val trackIds: List<String>)

@Serializable
data class MoveRequest(val itemId: String, val toIndex: Int)
