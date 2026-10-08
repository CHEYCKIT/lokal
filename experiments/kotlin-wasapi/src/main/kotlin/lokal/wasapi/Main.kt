package lokal.wasapi

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.awt.FileDialog
import java.awt.Frame
import java.io.File

fun main() = application {
    val output = remember { JniWasapiOutput() }
    val engine = remember { PlaybackEngine(output) }
    val scope = rememberCoroutineScope()
    Window(
        title = "Lokal file playback prototype",
        onCloseRequest = {
            scope.launch {
                withContext(Dispatchers.IO) { engine.close() }
                exitApplication()
            }
        },
    ) {
        DisposableEffect(engine) {
            onDispose { engine.close() }
        }
        PrototypeApp(engine)
    }
}

@Composable
private fun PrototypeApp(engine: PlaybackEngine) {
    val playback by engine.state.collectAsState()
    val scope = rememberCoroutineScope()
    var devices by remember { mutableStateOf<List<AudioDevice>>(emptyList()) }
    var selectedDevice by remember { mutableStateOf<AudioDevice?>(null) }
    var selectedFormat by remember { mutableStateOf(PcmFormat.PCM16) }
    var selectedFile by remember { mutableStateOf<File?>(null) }
    var menuExpanded by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("Loading WASAPI devices…") }

    androidx.compose.runtime.LaunchedEffect(engine) {
        try {
            devices = withContext(Dispatchers.IO) { engine.devices() }
            selectedDevice = devices.firstOrNull()
            message = if (devices.isEmpty()) "No active output devices were found." else ""
        } catch (exception: Exception) {
            message = exception.message ?: "Could not enumerate WASAPI devices."
        }
    }

    val canSelect = playback !is PlaybackState.Starting &&
        playback !is PlaybackState.Playing &&
        playback !is PlaybackState.Paused &&
        playback !is PlaybackState.Stopping

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Kotlin / WASAPI file playback", style = MaterialTheme.typography.headlineSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(
                onClick = {
                    val dialog = FileDialog(null as Frame?, "Open audio file", FileDialog.LOAD)
                    dialog.isVisible = true
                    val file = dialog.file?.let { File(dialog.directory, it) }
                    if (file != null) {
                        selectedFile = file
                        message = ""
                    }
                },
                enabled = canSelect,
            ) { Text("Choose audio file") }
            Text(selectedFile?.name ?: "No file selected", modifier = Modifier.padding(top = 12.dp))
        }
        Row {
            TextButton(onClick = { menuExpanded = true }, enabled = devices.isNotEmpty() && canSelect) {
                Text(selectedDevice?.name ?: "Select output device")
            }
            DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                devices.forEach { device ->
                    DropdownMenuItem(
                        text = { Text(device.name) },
                        onClick = {
                            selectedDevice = device
                            menuExpanded = false
                        },
                    )
                }
            }
        }
        Text("WASAPI input format")
        Row {
            PcmFormat.entries.forEach { format ->
                RadioButton(
                    selected = selectedFormat == format,
                    onClick = { selectedFormat = format },
                    enabled = canSelect,
                )
                Text(format.name, modifier = Modifier.padding(top = 12.dp))
                Spacer(Modifier.width(16.dp))
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                enabled = selectedFile != null && selectedDevice != null &&
                    (playback == PlaybackState.Stopped ||
                        playback is PlaybackState.Failed),
                onClick = {
                    val file = selectedFile ?: return@Button
                    val device = selectedDevice ?: return@Button
                    message = ""
                    scope.launch {
                        try {
                            withContext(Dispatchers.IO) {
                                engine.play(file, device.id, selectedFormat)
                            }
                        } catch (exception: Exception) {
                            message = exception.message ?: "Could not start playback."
                        }
                    }
                },
            ) { Text("Play") }
            Button(
                enabled = playback == PlaybackState.Playing,
                onClick = { engine.pause() },
            ) { Text("Pause") }
            Button(
                enabled = playback == PlaybackState.Paused,
                onClick = { engine.resume() },
            ) { Text("Resume") }
            Button(
                enabled = playback == PlaybackState.Starting || playback == PlaybackState.Playing ||
                    playback == PlaybackState.Paused || playback == PlaybackState.Stopping,
                onClick = { scope.launch { withContext(Dispatchers.IO) { engine.stop() } } },
            ) { Text("Stop") }
        }
        Text("State: ${playback.label()}")
        if (message.isNotBlank()) Text(message, color = MaterialTheme.colorScheme.error)
        Spacer(Modifier.height(4.dp))
        Text("Decodes to source-rate stereo, then streams bounded 1024-frame blocks to shared-mode WASAPI.")
    }
}

private fun PlaybackState.label(): String = when (this) {
    PlaybackState.Stopped -> "Stopped"
    PlaybackState.Starting -> "Starting"
    PlaybackState.Playing -> "Playing"
    PlaybackState.Paused -> "Paused"
    PlaybackState.Stopping -> "Stopping"
    is PlaybackState.Failed -> "Failed: $message"
}
