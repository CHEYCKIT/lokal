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

fun main() = application {
    val output = remember { JniWasapiOutput() }
    val player = remember { TonePlayer(output) }
    val scope = rememberCoroutineScope()
    Window(
        title = "Lokal WASAPI output prototype",
        onCloseRequest = {
            scope.launch {
                withContext(Dispatchers.IO) { player.close() }
                exitApplication()
            }
        },
    ) {
        DisposableEffect(player) {
            onDispose { player.close() }
        }
        PrototypeApp(player)
    }
}

@Composable
private fun PrototypeApp(player: TonePlayer) {
    val playback by player.state.collectAsState()
    val scope = rememberCoroutineScope()
    var devices by remember { mutableStateOf<List<AudioDevice>>(emptyList()) }
    var selectedDevice by remember { mutableStateOf<AudioDevice?>(null) }
    var selectedFormat by remember { mutableStateOf(PcmFormat.PCM16) }
    var menuExpanded by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("Loading WASAPI devices…") }

    androidx.compose.runtime.LaunchedEffect(player) {
        try {
            devices = withContext(Dispatchers.IO) { player.devices() }
            selectedDevice = devices.firstOrNull()
            message = if (devices.isEmpty()) "No active output devices were found." else ""
        } catch (exception: Exception) {
            message = exception.message ?: "Could not enumerate WASAPI devices."
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("WASAPI exclusive output", style = MaterialTheme.typography.headlineSmall)
        Row {
            TextButton(onClick = { menuExpanded = true }, enabled = devices.isNotEmpty()) {
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
        Text("Input tone format")
        Row {
            PcmFormat.entries.forEach { format ->
                RadioButton(
                    selected = selectedFormat == format,
                    onClick = { selectedFormat = format },
                    enabled = playback == PlaybackState.Stopped || playback is PlaybackState.Failed,
                )
                Text(format.name, modifier = Modifier.padding(top = 12.dp))
                Spacer(Modifier.width(16.dp))
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                enabled = selectedDevice != null &&
                    (playback == PlaybackState.Stopped || playback is PlaybackState.Failed),
                onClick = {
                    val device = selectedDevice ?: return@Button
                    message = ""
                    scope.launch {
                        try {
                            withContext(Dispatchers.IO) {
                                player.start(device.id, SAMPLE_RATE, selectedFormat)
                            }
                        } catch (exception: Exception) {
                            message = exception.message ?: "Could not start playback."
                        }
                    }
                },
            ) { Text("Play tone") }
            Button(
                enabled = playback == PlaybackState.Playing,
                onClick = {
                    scope.launch { withContext(Dispatchers.IO) { player.stop() } }
                },
            ) { Text("Stop") }
        }
        Text("State: ${playback.label()}")
        if (message.isNotBlank()) Text(message, color = MaterialTheme.colorScheme.error)
        Spacer(Modifier.height(4.dp))
        Text("48 kHz stereo · 440 Hz test tone")
    }
}

private fun PlaybackState.label(): String = when (this) {
    PlaybackState.Stopped -> "Stopped"
    PlaybackState.Starting -> "Starting"
    PlaybackState.Playing -> "Playing"
    PlaybackState.Stopping -> "Stopping"
    is PlaybackState.Failed -> "Failed: $message"
}

private const val SAMPLE_RATE = 48_000
