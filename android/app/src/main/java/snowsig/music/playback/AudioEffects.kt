package snowsig.music.playback

import android.media.audiofx.BassBoost
import android.media.audiofx.Equalizer
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import snowsig.music.data.settings.EqualizerSettings
import snowsig.music.data.settings.SettingsStore
import javax.inject.Inject
import javax.inject.Singleton

/** What the phone's equalizer offers. Band count and ranges differ between phones. */
data class EqualizerInfo(
    val centerFrequenciesHz: List<Int>,
    /** Band level range in millibels (1/100 dB), e.g. -1500..1500. */
    val minLevel: Int,
    val maxLevel: Int,
    val presets: List<String>,
    val bassBoostSupported: Boolean,
)

/**
 * Equalizer and bass boost on the player's audio session, using Android's built-in effects.
 * [PlaybackService] attaches it to the player; settings changes apply at once.
 */
@Singleton
class AudioEffects @Inject constructor(private val settings: SettingsStore) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var equalizer: Equalizer? = null
    private var bassBoost: BassBoost? = null
    private var sessionId = 0
    private var job: Job? = null

    private val _info = MutableStateFlow<EqualizerInfo?>(null)
    /** Null until a player is attached, or if this phone has no equalizer. */
    val info: StateFlow<EqualizerInfo?> = _info.asStateFlow()

    /** Call on the main thread whenever the player's audio session id is known or changes. */
    fun attach(audioSessionId: Int) {
        if (audioSessionId == 0 || audioSessionId == sessionId) return
        release()
        sessionId = audioSessionId
        equalizer = runCatching { Equalizer(0, audioSessionId) }.onFailure { Log.w(TAG, "No equalizer", it) }.getOrNull()
        bassBoost = runCatching { BassBoost(0, audioSessionId) }.onFailure { Log.w(TAG, "No bass boost", it) }.getOrNull()
        _info.value = equalizer?.let { eq ->
            runCatching {
                val range = eq.bandLevelRange
                EqualizerInfo(
                    centerFrequenciesHz = (0 until eq.numberOfBands).map { eq.getCenterFreq(it.toShort()) / 1000 },
                    minLevel = range[0].toInt(),
                    maxLevel = range[1].toInt(),
                    presets = (0 until eq.numberOfPresets).map { eq.getPresetName(it.toShort()) },
                    bassBoostSupported = bassBoost?.strengthSupported == true,
                )
            }.getOrNull()
        }
        job = scope.launch {
            settings.settings.map { it.equalizer }.distinctUntilChanged().collect(::apply)
        }
    }

    /** Band levels of a device preset, so the sliders can show it. */
    fun presetLevels(preset: Int): List<Int>? {
        val eq = equalizer ?: return null
        return runCatching {
            eq.usePreset(preset.toShort())
            (0 until eq.numberOfBands).map { eq.getBandLevel(it.toShort()).toInt() }
        }.getOrNull()
    }

    private fun apply(s: EqualizerSettings) {
        val info = _info.value
        equalizer?.let { eq ->
            runCatching {
                if (s.enabled) {
                    if (s.preset >= 0 && s.preset < (info?.presets?.size ?: 0)) {
                        eq.usePreset(s.preset.toShort())
                    } else if (info != null) {
                        s.bandLevels.take(info.centerFrequenciesHz.size).forEachIndexed { band, level ->
                            eq.setBandLevel(band.toShort(), level.coerceIn(info.minLevel, info.maxLevel).toShort())
                        }
                    }
                }
                eq.enabled = s.enabled
            }.onFailure { Log.w(TAG, "Equalizer settings not applied", it) }
        }
        bassBoost?.let { bb ->
            runCatching {
                val on = s.enabled && s.bassBoost > 0 && bb.strengthSupported
                if (on) bb.setStrength(s.bassBoost.coerceIn(0, 1000).toShort())
                bb.enabled = on
            }.onFailure { Log.w(TAG, "Bass boost not applied", it) }
        }
    }

    fun release() {
        job?.cancel()
        job = null
        runCatching { equalizer?.release() }
        runCatching { bassBoost?.release() }
        equalizer = null
        bassBoost = null
        sessionId = 0
        _info.value = null
    }

    private companion object {
        const val TAG = "Music"
    }
}
