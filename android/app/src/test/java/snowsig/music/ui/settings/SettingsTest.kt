package snowsig.music.ui.settings

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import snowsig.music.data.settings.Accent
import snowsig.music.data.settings.AppSettings
import snowsig.music.data.settings.DownloadQuality
import snowsig.music.data.settings.EqualizerSettings
import snowsig.music.data.settings.StreamQuality
import snowsig.music.data.settings.ThemeMode
import snowsig.music.ui.player.formatSpeed

class SettingsTest {
    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true; encodeDefaults = true }

    @Test
    fun `settings survive a save and load`() {
        val s = AppSettings(
            theme = ThemeMode.Light,
            accent = Accent.Purple,
            streamQuality = StreamQuality.Lossless,
            downloadQuality = DownloadQuality.High,
            downloadOnWifiOnly = true,
            autoplay = false,
            fadeSeconds = 6,
            equalizer = EqualizerSettings(enabled = true, preset = -1, bandLevels = listOf(300, 0, -200, 0, 500), bassBoost = 600),
        )
        assertEquals(s, json.decodeFromString(AppSettings.serializer(), json.encodeToString(AppSettings.serializer(), s)))
    }

    @Test
    fun `missing or unknown values fall back to defaults`() {
        // An older app version saved fewer fields; a newer one may have saved an unknown option.
        val old = json.decodeFromString(AppSettings.serializer(), """{"theme":"Light","streamQuality":"Ultra","future":1}""")
        assertEquals(ThemeMode.Light, old.theme)
        assertEquals(StreamQuality.Auto, old.streamQuality)
        assertEquals(AppSettings().copy(theme = ThemeMode.Light), old)
        // Downloads keep the 160k rendition by default, as before settings existed.
        assertEquals(1, AppSettings().downloadQuality.variantIndex)
        assertEquals(listOf(0, 1, 2), DownloadQuality.entries.sortedBy { it.variantIndex }.map { it.variantIndex })
    }

    @Test
    fun `password changes are checked before asking the server`() {
        assertEquals("Enter your current password.", passwordProblem("", "new-pass-1", "new-pass-1"))
        assertEquals("The new password needs at least 8 characters.", passwordProblem("old", "short", "short"))
        assertEquals("The new passwords don’t match.", passwordProblem("old", "new-pass-1", "new-pass-2"))
        assertEquals("The new password is the same as the current one.", passwordProblem("same-pass", "same-pass", "same-pass"))
        assertNull(passwordProblem("old-pass", "new-pass-1", "new-pass-1"))
    }

    @Test
    fun `labels for speed and frequencies`() {
        assertEquals("1×", formatSpeed(1f))
        assertEquals("0.75×", formatSpeed(0.75f))
        assertEquals("1.5×", formatSpeed(1.5f))
        assertEquals("2×", formatSpeed(2f))
        assertEquals("60 Hz", formatHz(60))
        assertEquals("14 kHz", formatHz(14_000))
        assertEquals("3.6 kHz", formatHz(3_600))
    }
}
