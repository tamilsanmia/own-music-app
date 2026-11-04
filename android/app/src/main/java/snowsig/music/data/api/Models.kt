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
    val genres: List<String> = emptyList(),
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
    val hasLyrics: Boolean = false,
    /** A FLAC stream exists (the original upload was lossless). */
    val lossless: Boolean = false,
)

@Serializable
data class AlbumDetailDto(
    val id: String,
    val title: String,
    val releaseYear: Int? = null,
    val artist: Ref,
    val cover: ImageUrls? = null,
    val genres: List<String> = emptyList(),
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
data class GenreDto(val name: String, val albumCount: Int = 0, val cover: ImageUrls? = null)

@Serializable
data class GenreDetailDto(val name: String, val albums: List<AlbumDto>)

@Serializable
data class HomeDto(
    val newAlbums: List<AlbumDto>,
    /** Your most played songs (last 90 days). */
    val mostPlayed: List<TrackDto> = emptyList(),
    /** Most played by everyone in the last 7 days. */
    val topThisWeek: List<TrackDto> = emptyList(),
    val genres: List<GenreDto> = emptyList(),
)

@Serializable
data class LyricsDto(val lyrics: String? = null, val synced: Boolean = false)

@Serializable
data class RadioRequest(val seedTrackId: String, val excludeTrackIds: List<String> = emptyList(), val limit: Int = 20)

@Serializable
data class UpdateProfileRequest(val displayName: String)

@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class ChangePasswordRequest(
    val currentPassword: String,
    val newPassword: String,
    /** Mobile: the new session's refresh token comes back in the body. */
    @EncodeDefault val client: String = "mobile",
)

@Serializable
data class ItemsDto<T>(val items: List<T>, val total: Int? = null)

@Serializable
data class StreamUrlDto(val url: String, val expiresAt: String, val lossless: Boolean = false)

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
