package snowsig.music.ui.settings

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import snowsig.music.BuildConfig
import snowsig.music.data.settings.Accent
import snowsig.music.data.settings.AppSettings
import snowsig.music.data.settings.DownloadQuality
import snowsig.music.data.settings.StreamQuality
import snowsig.music.data.settings.ThemeMode
import snowsig.music.offline.DownloadStatus
import snowsig.music.ui.components.SectionTitle
import snowsig.music.ui.theme.LocalPalette
import snowsig.music.ui.theme.MusicColors

private enum class Dialog { Name, Password, Logout, StreamQuality, DownloadQuality, Theme, RemoveDownloads }

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(contentPadding: PaddingValues, onOpenEqualizer: () -> Unit, vm: SettingsViewModel = hiltViewModel()) {
    val settings by vm.settings.collectAsStateWithLifecycle()
    val user by vm.user.collectAsStateWithLifecycle()
    val downloads by vm.downloadItems.collectAsStateWithLifecycle()
    var dialog by remember { mutableStateOf<Dialog?>(null) }
    val done = downloads.values.filter { it.status == DownloadStatus.Done }
    val bytes = downloads.values.sumOf { it.bytes }

    LazyColumn(contentPadding = contentPadding) {
        item {
            Text("Profile & settings", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(16.dp))
        }
        // ---- account ----
        item {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Avatar(user?.displayName.orEmpty(), Modifier.size(56.dp))
                Column(Modifier.padding(start = 16.dp).weight(1f)) {
                    Text(user?.displayName.orEmpty(), style = MaterialTheme.typography.titleLarge)
                    Text(user?.email.orEmpty(), style = MaterialTheme.typography.bodyMedium, color = MusicColors.Muted)
                }
            }
        }
        item { Entry("Change name", user?.displayName) { dialog = Dialog.Name } }
        item { Entry("Change password", "Logs out your other devices") { dialog = Dialog.Password } }
        item { Entry("Log out", null) { dialog = Dialog.Logout } }

        // ---- playback ----
        item { SectionTitle("Playback") }
        item { Entry("Streaming quality", settings.streamQuality.label) { dialog = Dialog.StreamQuality } }
        item {
            SwitchEntry("Autoplay", "Keep playing similar songs when your music ends", settings.autoplay) { on ->
                vm.update { it.copy(autoplay = on) }
            }
        }
        item {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                Text("Fade between songs", style = MaterialTheme.typography.bodyLarge)
                Text(
                    if (settings.fadeSeconds == 0) "Off" else "${settings.fadeSeconds} s fade out and in",
                    style = MaterialTheme.typography.bodySmall,
                    color = MusicColors.Muted,
                )
                Slider(
                    value = settings.fadeSeconds.toFloat(),
                    onValueChange = { v -> vm.update { it.copy(fadeSeconds = v.toInt()) } },
                    valueRange = 0f..AppSettings.MAX_FADE_SECONDS.toFloat(),
                    steps = AppSettings.MAX_FADE_SECONDS - 1,
                    modifier = Modifier.semantics {
                        contentDescription = "Fade between songs"
                        stateDescription = if (settings.fadeSeconds == 0) "Off" else "${settings.fadeSeconds} seconds"
                    },
                )
            }
        }
        item { Entry("Equalizer", if (settings.equalizer.enabled) "On" else "Off", chevron = true, onClick = onOpenEqualizer) }

        // ---- downloads ----
        item { SectionTitle("Downloads") }
        item { Entry("Download quality", settings.downloadQuality.label) { dialog = Dialog.DownloadQuality } }
        item {
            SwitchEntry("Download over Wi-Fi only", "Saves mobile data; downloads wait for Wi-Fi", settings.downloadOnWifiOnly) { on ->
                vm.update { it.copy(downloadOnWifiOnly = on) }
            }
        }
        item {
            Entry(
                "Storage used",
                "%.1f MB · %d %s".format(bytes / 1_048_576.0, done.size, if (done.size == 1) "song" else "songs"),
            ) {}
        }
        if (downloads.isNotEmpty()) item { Entry("Remove all downloads", "Frees the space on this phone") { dialog = Dialog.RemoveDownloads } }

        // ---- appearance ----
        item { SectionTitle("Appearance") }
        item { Entry("Theme", settings.theme.label) { dialog = Dialog.Theme } }
        item {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                Text("Accent colour", style = MaterialTheme.typography.bodyLarge)
                Spacer(Modifier.height(8.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Accent.entries
                        .filter { it != Accent.Dynamic || Build.VERSION.SDK_INT >= Build.VERSION_CODES.S }
                        .forEach { a -> AccentSwatch(a, selected = a == settings.accent) { vm.update { it.copy(accent = a) } } }
                }
            }
        }

        // ---- about ----
        item { SectionTitle("About") }
        item { Entry("Version", BuildConfig.VERSION_NAME) {} }
        item { Entry("Server", BuildConfig.BASE_URL.removePrefix("https://")) {} }
        item { Spacer(Modifier.height(24.dp)) }
    }

    when (dialog) {
        Dialog.Name -> NameDialog(user?.displayName.orEmpty(), vm, onDismiss = { dialog = null })
        Dialog.Password -> PasswordDialog(vm, onDismiss = { dialog = null })
        Dialog.Logout -> ConfirmDialog("Log out?", "Downloads stay on this phone.", "Log out", onConfirm = vm::logout, onDismiss = { dialog = null })
        Dialog.RemoveDownloads -> ConfirmDialog(
            "Remove all downloads?", "You can download them again later.", "Remove all",
            onConfirm = vm::removeAllDownloads, onDismiss = { dialog = null },
        )
        Dialog.StreamQuality -> ChoiceDialog(
            "Streaming quality", StreamQuality.entries, settings.streamQuality, { it.label }, { it.detail },
            onPick = { q -> vm.update { it.copy(streamQuality = q) } }, onDismiss = { dialog = null },
        )
        Dialog.DownloadQuality -> ChoiceDialog(
            "Download quality", DownloadQuality.entries, settings.downloadQuality, { it.label },
            { it.detail + ". Applies to new downloads." },
            onPick = { q -> vm.update { it.copy(downloadQuality = q) } }, onDismiss = { dialog = null },
        )
        Dialog.Theme -> ChoiceDialog(
            "Theme", ThemeMode.entries, settings.theme, { it.label }, { null },
            onPick = { t -> vm.update { it.copy(theme = t) } }, onDismiss = { dialog = null },
        )
        null -> Unit
    }
}

@Composable
fun Avatar(name: String, modifier: Modifier = Modifier) {
    Box(modifier.clip(CircleShape).background(MusicColors.Primary), contentAlignment = Alignment.Center) {
        Text(name.trim().take(1).uppercase().ifEmpty { "?" }, style = MaterialTheme.typography.titleLarge, color = MusicColors.OnPrimary)
    }
}

@Composable
private fun Entry(title: String, subtitle: String?, chevron: Boolean = false, onClick: () -> Unit) {
    ListItem(
        headlineContent = { Text(title) },
        supportingContent = subtitle?.let { { Text(it) } },
        trailingContent = if (chevron) ({ Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null) }) else null,
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.clickable(onClick = onClick),
    )
}

@Composable
private fun SwitchEntry(title: String, subtitle: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    ListItem(
        headlineContent = { Text(title) },
        supportingContent = { Text(subtitle) },
        trailingContent = { Switch(checked = checked, onCheckedChange = null) },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.selectable(selected = checked, role = Role.Switch, onClick = { onChange(!checked) }),
    )
}

@Composable
private fun AccentSwatch(accent: Accent, selected: Boolean, onClick: () -> Unit) {
    val color = if (accent == Accent.Dynamic) MaterialTheme.colorScheme.primary else Color(if (LocalPalette.current.isDark) accent.dark else accent.light)
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .size(40.dp)
                .clip(CircleShape)
                .background(color)
                .border(if (selected) 3.dp else 0.dp, MusicColors.Foreground, CircleShape)
                .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
                .semantics { contentDescription = accent.label },
            contentAlignment = Alignment.Center,
        ) {
            if (selected) Icon(Icons.Filled.Check, null, tint = Color.White)
        }
        Text(accent.label, style = MaterialTheme.typography.labelSmall, color = MusicColors.Muted)
    }
}

@Composable
private fun <T> ChoiceDialog(
    title: String,
    options: List<T>,
    current: T,
    label: (T) -> String,
    detail: (T) -> String?,
    onPick: (T) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                options.forEach { o ->
                    Row(
                        Modifier.fillMaxWidth().selectable(selected = o == current, role = Role.RadioButton) { onPick(o); onDismiss() }
                            .padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = o == current, onClick = null)
                        Column(Modifier.padding(start = 12.dp)) {
                            Text(label(o), style = MaterialTheme.typography.bodyLarge)
                            detail(o)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MusicColors.Muted) }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}

@Composable
private fun ConfirmDialog(title: String, text: String, action: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = { TextButton(onClick = { onDismiss(); onConfirm() }) { Text(action) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun NameDialog(current: String, vm: SettingsViewModel, onDismiss: () -> Unit) {
    var name by remember { mutableStateOf(current) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Change name") },
        text = {
            Column {
                OutlinedTextField(name, { name = it.take(100); error = null }, label = { Text("Name") }, singleLine = true)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && name.isNotBlank(), onClick = {
                busy = true
                vm.rename(name) { e -> busy = false; if (e == null) onDismiss() else error = e }
            }) { Text(if (busy) "Saving…" else "Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun PasswordDialog(vm: SettingsViewModel, onDismiss: () -> Unit) {
    var current by remember { mutableStateOf("") }
    var new by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val field = @Composable { label: String, value: String, onChange: (String) -> Unit ->
        OutlinedTextField(
            value, { onChange(it); error = null },
            label = { Text(label) },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Change password") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                field("Current password", current) { current = it }
                field("New password (8+ characters)", new) { new = it }
                field("Repeat new password", confirm) { confirm = it }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy, onClick = {
                busy = true
                vm.changePassword(current, new, confirm) { e -> busy = false; if (e == null) onDismiss() else error = e }
            }) { Text(if (busy) "Saving…" else "Change") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

// ---- equalizer ----

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EqualizerScreen(contentPadding: PaddingValues, vm: SettingsViewModel = hiltViewModel()) {
    val settings by vm.settings.collectAsStateWithLifecycle()
    val info by vm.equalizer.collectAsStateWithLifecycle()
    val eq = settings.equalizer

    LazyColumn(contentPadding = contentPadding) {
        item { Text("Equalizer", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(16.dp)) }
        val i = info
        if (i == null) {
            item {
                Text(
                    "The equalizer isn’t available on this phone right now. Play a song and try again.",
                    color = MusicColors.Muted,
                    modifier = Modifier.padding(16.dp),
                )
            }
            return@LazyColumn
        }
        item { SwitchEntry("Equalizer", "Applies to music in this app", eq.enabled) { vm.setEqualizerEnabled(it) } }
        if (i.presets.isNotEmpty()) {
            item {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    Text("Presets", style = MaterialTheme.typography.bodyLarge)
                    Spacer(Modifier.height(8.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        i.presets.forEachIndexed { index, name ->
                            androidx.compose.material3.FilterChip(
                                selected = eq.enabled && eq.preset == index,
                                onClick = { vm.pickPreset(index) },
                                label = { Text(name) },
                            )
                        }
                        androidx.compose.material3.FilterChip(
                            selected = eq.enabled && eq.preset < 0,
                            onClick = { vm.setEqualizerEnabled(true); vm.update { it.copy(equalizer = it.equalizer.copy(preset = -1)) } },
                            label = { Text("Custom") },
                        )
                    }
                }
            }
        }
        item { HorizontalDivider(Modifier.padding(vertical = 8.dp)) }
        i.centerFrequenciesHz.forEachIndexed { band, hz ->
            item(key = "band-$band") {
                val level = eq.bandLevels.getOrElse(band) { 0 }
                Column(Modifier.padding(horizontal = 16.dp, vertical = 2.dp)) {
                    Row(Modifier.fillMaxWidth()) {
                        Text(formatHz(hz), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                        Text("%+.1f dB".format(level / 100f), style = MaterialTheme.typography.bodySmall, color = MusicColors.Muted)
                    }
                    Slider(
                        value = level.toFloat(),
                        onValueChange = { vm.setBand(band, it.toInt()) },
                        valueRange = i.minLevel.toFloat()..i.maxLevel.toFloat(),
                        enabled = eq.enabled,
                        modifier = Modifier.semantics { contentDescription = "${formatHz(hz)} band"; stateDescription = "%+.1f dB".format(level / 100f) },
                    )
                }
            }
        }
        if (i.bassBoostSupported) {
            item {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    Row(Modifier.fillMaxWidth()) {
                        Text("Bass boost", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                        Text(if (eq.bassBoost == 0) "Off" else "${eq.bassBoost / 10}%", style = MaterialTheme.typography.bodySmall, color = MusicColors.Muted)
                    }
                    Slider(
                        value = eq.bassBoost.toFloat(),
                        onValueChange = { vm.setBassBoost(it.toInt()) },
                        valueRange = 0f..1000f,
                        enabled = eq.enabled,
                        modifier = Modifier.semantics { contentDescription = "Bass boost"; stateDescription = "${eq.bassBoost / 10} percent" },
                    )
                }
            }
        }
        item {
            OutlinedButton(onClick = vm::resetBands, enabled = eq.enabled, modifier = Modifier.padding(16.dp)) { Text("Reset to flat") }
        }
        item {
            Text(
                "Uses this phone’s built-in equalizer. It doesn’t affect Chromecast.",
                style = MaterialTheme.typography.bodySmall,
                color = MusicColors.Muted,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
    }
}

/** 60 -> "60 Hz", 14000 -> "14 kHz". */
fun formatHz(hz: Int): String = if (hz >= 1000) "${"%.1f".format(hz / 1000f).removeSuffix(".0")} kHz" else "$hz Hz"
