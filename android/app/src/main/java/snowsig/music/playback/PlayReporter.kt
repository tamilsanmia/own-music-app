package snowsig.music.playback

/** Sends counted plays to the server ("Recently played"). See QueuedPlayReporter. */
interface PlayReporter {
    fun report(trackId: String)
}
