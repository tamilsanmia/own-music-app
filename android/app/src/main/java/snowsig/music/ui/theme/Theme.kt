package snowsig.music.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** Same palette as the web app (web/src/index.css). */
object MusicColors {
    val Background = Color(0xFF121212)
    val Surface = Color(0xFF181818)
    val Surface2 = Color(0xFF242424)
    val Surface3 = Color(0xFF2A2A2A)
    val Border = Color(0xFF333333)
    val Foreground = Color(0xFFFFFFFF)
    val Muted = Color(0xFFA7A7A7)
    val Primary = Color(0xFF1ED760)
    val OnPrimary = Color(0xFF000000)
    val Danger = Color(0xFFF15E6C)
}

private val scheme = darkColorScheme(
    primary = MusicColors.Primary,
    onPrimary = MusicColors.OnPrimary,
    background = MusicColors.Background,
    onBackground = MusicColors.Foreground,
    surface = MusicColors.Background,
    onSurface = MusicColors.Foreground,
    surfaceVariant = MusicColors.Surface2,
    onSurfaceVariant = MusicColors.Muted,
    surfaceContainer = MusicColors.Surface,
    surfaceContainerHigh = MusicColors.Surface2,
    surfaceContainerHighest = MusicColors.Surface3,
    outline = MusicColors.Border,
    error = MusicColors.Danger,
)

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
fun MusicTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, typography = typography, content = content)
}
