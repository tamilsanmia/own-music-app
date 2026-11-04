package snowsig.music.ui.common

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import retrofit2.HttpException
import snowsig.music.data.api.userMessage

/** Data from the server with loading and error state. `notFound` for 404s. */
data class Loadable<T>(
    val data: T? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val notFound: Boolean = false,
)

/** Load into [state], keeping existing data while reloading. */
fun <T> CoroutineScope.loadInto(state: MutableStateFlow<Loadable<T>>, fetch: suspend () -> T) = launch {
    state.update { it.copy(loading = true, error = null) }
    try {
        val data = fetch()
        state.value = Loadable(data = data, loading = false)
    } catch (e: Exception) {
        state.update {
            it.copy(loading = false, error = e.userMessage(), notFound = (e as? HttpException)?.code() == 404)
        }
    }
}
