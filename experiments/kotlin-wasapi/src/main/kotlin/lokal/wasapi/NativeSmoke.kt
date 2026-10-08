package lokal.wasapi

fun main() {
    val output = JniWasapiOutput()
    val player = TonePlayer(output)
    try {
        val devices = player.devices()
        check(devices.isNotEmpty()) { "No active WASAPI output devices were found." }
        println("WASAPI devices: ${devices.joinToString { it.name }}")

        val device = devices.first()
        player.start(device.id, 48_000, PcmFormat.PCM16)
        println("Playing 440 Hz tone on ${device.name}")
        Thread.sleep(1_500)
        player.stop()
        check(player.state.value == PlaybackState.Stopped) {
            "Playback stopped in an unexpected state: ${player.state.value}"
        }
        println("WASAPI playback smoke test passed.")
    } finally {
        player.close()
    }
}
