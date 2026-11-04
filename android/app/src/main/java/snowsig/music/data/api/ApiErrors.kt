package snowsig.music.data.api

import android.util.Log
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import retrofit2.HttpException
import java.io.IOException

private val lenient = Json { ignoreUnknownKeys = true }

/** HTTP status of an API failure, or null for network errors and anything else. */
val Throwable.httpStatus: Int?
    get() = (this as? HttpException)?.code()

/** A short message for the user, using the server's own message when it has one. */
fun Throwable.userMessage(): String {
    // Unexpected errors are logged (adb logcat -s Music) so they can be diagnosed.
    if (this !is IOException && this !is HttpException) runCatching { Log.w("Music", "Unexpected error", this) }
    return when {
        this is IOException -> "Can’t reach the server. Check your connection."
        this is HttpException && code() == 429 -> "Too many attempts. Wait a minute and try again."
        this is HttpException -> serverMessage(this) ?: "Something went wrong (${code()})."
        this is SerializationException -> "The server sent an answer the app doesn’t understand."
        else -> "Something went wrong (${this::class.simpleName})."
    }
}

/** Nest errors look like { "message": "..." } or { "message": ["...", "..."] }. */
private fun serverMessage(e: HttpException): String? = runCatching {
    val body = e.response()?.errorBody()?.string() ?: return null
    when (val m = lenient.parseToJsonElement(body).jsonObject["message"]) {
        is JsonPrimitive -> m.content
        is JsonArray -> m.joinToString(", ") { (it as? JsonPrimitive)?.content ?: it.toString() }
        is JsonObject, null -> null
        else -> null
    }
}.getOrNull()
