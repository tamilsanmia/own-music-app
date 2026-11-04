package snowsig.music.playback

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import snowsig.music.data.api.MusicApi
import snowsig.music.data.api.PlayRequest
import snowsig.music.di.AppScope
import javax.inject.Inject
import javax.inject.Singleton

/** Sends counted plays to the server ("Recently played"). */
interface PlayReporter {
    fun report(trackId: String)
}

@Singleton
class ApiPlayReporter @Inject constructor(
    private val api: MusicApi,
    @AppScope private val scope: CoroutineScope,
) : PlayReporter {
    override fun report(trackId: String) {
        scope.launch { runCatching { api.recordPlay(PlayRequest(trackId)) } }
    }
}
