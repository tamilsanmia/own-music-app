package snowsig.music.data.settings

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import snowsig.music.di.AppScope
import javax.inject.Inject
import javax.inject.Singleton

enum class ThemeMode(val label: String) { System("Use phone setting"), Dark("Dark"), Light("Light") }

/** Accent colours. [Dynamic] follows the wallpaper (Android 12+). */
enum class Accent(val label: String, val dark: Long, val light: Long) {
    Green("Green", 0xFF1ED760, 0xFF14833B),
    Blue("Blue", 0xFF4F9DFF, 0xFF1D5FC9),
    Purple("Purple", 0xFFB18CFF, 0xFF6B3FD4),
    Pink("Pink", 0xFFFF6FB1, 0xFFC2185B),
    Orange("Orange", 0xFFFF9F43, 0xFFC25E00),
    Red("Red", 0xFFFF5C5C, 0xFFC62828),
    Dynamic("Wallpaper", 0xFF1ED760, 0xFF14833B),
}

/**
 * How songs are streamed. Downloads have their own setting.
 * Lossless needs a FLAC upload on the server; other songs fall back to the best AAC stream.
 */
enum class StreamQuality(val label: String, val detail: String) {
    Auto("Automatic", "Adjusts to your connection (up to 320 kbps)"),
    DataSaver("Data saver", "96 kbps, about 0.7 MB a minute"),
    High("High", "320 kbps whenever possible"),
    Lossless("Lossless", "FLAC up to 24-bit/96 kHz where available, else 320 kbps. Uses a lot of data."),
}

/** Which AAC rendition downloads keep. [variantIndex] is its place in master.m3u8 (96k, 160k, 320k). */
enum class DownloadQuality(val label: String, val detail: String, val variantIndex: Int) {
    DataSaver("Data saver", "96 kbps, about 0.7 MB a minute", 0),
    Normal("Normal", "160 kbps, about 1.2 MB a minute", 1),
    High("High", "320 kbps, about 2.4 MB a minute", 2),
}

@Serializable
data class EqualizerSettings(
    val enabled: Boolean = false,
    /** A device preset, or -1 for the user's own band levels. */
    val preset: Int = -1,
    /** Level per band in millibels (1/100 dB), as reported by the device. */
    val bandLevels: List<Int> = emptyList(),
    /** 0..1000. */
    val bassBoost: Int = 0,
)

@Serializable
data class AppSettings(
    val theme: ThemeMode = ThemeMode.Dark,
    val accent: Accent = Accent.Green,
    val streamQuality: StreamQuality = StreamQuality.Auto,
    val downloadQuality: DownloadQuality = DownloadQuality.Normal,
    val downloadOnWifiOnly: Boolean = false,
    /** Keep playing similar songs when the queue ends. */
    val autoplay: Boolean = true,
    /** Fade out the end and fade in the start of each song; 0 = off. */
    val fadeSeconds: Int = 0,
    val equalizer: EqualizerSettings = EqualizerSettings(),
) {
    companion object {
        const val MAX_FADE_SECONDS = 12
    }
}

private val Context.settingsStore by preferencesDataStore(name = "settings")

/** App settings, saved on the phone. Read by the UI and by the playback service. */
interface SettingsStore {
    val settings: StateFlow<AppSettings>
    fun update(change: (AppSettings) -> AppSettings)
}

@Singleton
class SettingsRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    @AppScope private val scope: CoroutineScope,
) : SettingsStore {
    private val key = stringPreferencesKey("settings")
    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true; encodeDefaults = true }
    private val writes = Mutex()

    // Read once at startup so the first frame already has the right theme. DataStore is fast;
    // the timeout only guards against a broken file.
    private val _settings = MutableStateFlow(
        runBlocking { withTimeoutOrNull(1000) { context.settingsStore.data.first()[key] } }?.let(::decode) ?: AppSettings(),
    )
    override val settings: StateFlow<AppSettings> = _settings.asStateFlow()

    override fun update(change: (AppSettings) -> AppSettings) {
        val next = change(_settings.value)
        _settings.value = next
        scope.launch {
            writes.withLock { context.settingsStore.edit { it[key] = json.encodeToString(AppSettings.serializer(), _settings.value) } }
        }
    }

    private fun decode(raw: String): AppSettings? = runCatching { json.decodeFromString(AppSettings.serializer(), raw) }.getOrNull()
}
