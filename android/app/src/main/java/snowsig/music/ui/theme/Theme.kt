package snowsig.music.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import snowsig.music.data.settings.Accent
import snowsig.music.data.settings.ThemeMode

/** The app's colours. Dark matches the web app (web/src/index.css). */
@Immutable
data class Palette(
    val isDark: Boolean,
    val background: Color,
    val surface: Color,
    val surface2: Color,
    val surface3: Color,
    val border: Color,
    val foreground: Color,
    val muted: Color,
    val primary: Color,
    val onPrimary: Color,
    val danger: Color,
)

fun darkPalette(primary: Color = Color(Accent.Green.dark)) = Palette(
    isDark = true,
    background = Color(0xFF121212),
    surface = Color(0xFF181818),
    surface2 = Color(0xFF242424),
    surface3 = Color(0xFF2A2A2A),
    border = Color(0xFF333333),
    foreground = Color(0xFFFFFFFF),
    muted = Color(0xFFA7A7A7),
    primary = primary,
    onPrimary = Color(0xFF000000),
    danger = Color(0xFFF15E6C),
)

fun lightPalette(primary: Color = Color(Accent.Green.light)) = Palette(
    isDark = false,
    background = Color(0xFFFFFFFF),
    surface = Color(0xFFF6F6F6),
    surface2 = Color(0xFFEDEDED),
    surface3 = Color(0xFFE4E4E4),
    border = Color(0xFFD2D2D2),
    foreground = Color(0xFF111111),
    muted = Color(0xFF5E5E5E),
    primary = primary,
    onPrimary = Color(0xFFFFFFFF),
    danger = Color(0xFFC62828),
)

/** Builds the palette from a wallpaper-based Material scheme (Android 12+). */
private fun ColorScheme.toPalette(isDark: Boolean) = Palette(
    isDark = isDark,
    background = background,
    surface = surfaceContainerLow,
    surface2 = surfaceContainer,
    surface3 = surfaceContainerHigh,
    border = outlineVariant,
    foreground = onBackground,
    muted = onSurfaceVariant,
    primary = primary,
    onPrimary = onPrimary,
    danger = error,
)

val LocalPalette = staticCompositionLocalOf { darkPalette() }

/** Shorthand for the current palette, e.g. MusicColors.Primary. */
object MusicColors {
    val Background: Color @Composable @ReadOnlyComposable get() = LocalPalette.current.background
    val Surface: Color @Composable @ReadOnlyComposable get() = LocalPalette.current.surface
    val Surface2: Color @Composable @ReadOnlyComposable get() = LocalPalette.current.surface2
    val Surface3: Color @Composable @ReadOnlyComposable get() = LocalPalette.current.surface3
    val Border: Color @Composable @ReadOnlyComposable get() = LocalPalette.current.border
    val Foreground: Color @Composable @ReadOnlyComposable get() = LocalPalette.current.foreground
    val Muted: Color @Composable @ReadOnlyComposable get() = LocalPalette.current.muted
    val Primary: Color @Composable @ReadOnlyComposable get() = LocalPalette.current.primary
    val OnPrimary: Color @Composable @ReadOnlyComposable get() = LocalPalette.current.onPrimary
    val Danger: Color @Composable @ReadOnlyComposable get() = LocalPalette.current.danger
}

private fun Palette.scheme(): ColorScheme {
    val base = if (isDark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = primary,
        onPrimary = onPrimary,
        background = background,
        onBackground = foreground,
        surface = background,
        onSurface = foreground,
        surfaceVariant = surface2,
        onSurfaceVariant = muted,
        surfaceContainerLowest = background,
        surfaceContainerLow = surface,
        surfaceContainer = surface,
        surfaceContainerHigh = surface2,
        surfaceContainerHighest = surface3,
        outline = border,
        outlineVariant = border,
        error = danger,
    )
}

private val typography = Typography().run {
    copy(
        headlineLarge = headlineLarge.copy(fontWeight = FontWeight.Bold),
        headlineMedium = headlineMedium.copy(fontWeight = FontWeight.Bold),
        headlineSmall = headlineSmall.copy(fontWeight = FontWeight.Bold),
        titleLarge = titleLarge.copy(fontWeight = FontWeight.Bold),
        titleMedium = titleMedium.copy(fontWeight = FontWeight.SemiBold),
        labelLarge = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.SemiBold),
    )
}

@Composable
fun isDarkTheme(mode: ThemeMode): Boolean = when (mode) {
    ThemeMode.Dark -> true
    ThemeMode.Light -> false
    ThemeMode.System -> isSystemInDarkTheme()
}

@Composable
fun MusicTheme(mode: ThemeMode = ThemeMode.Dark, accent: Accent = Accent.Green, content: @Composable () -> Unit) {
    val dark = isDarkTheme(mode)
    val context = LocalContext.current
    val palette = when {
        accent == Accent.Dynamic && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            (if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)).toPalette(dark)
        dark -> darkPalette(Color(accent.dark))
        else -> lightPalette(Color(accent.light))
    }
    CompositionLocalProvider(LocalPalette provides palette) {
        MaterialTheme(colorScheme = palette.scheme(), typography = typography, content = content)
    }
}
