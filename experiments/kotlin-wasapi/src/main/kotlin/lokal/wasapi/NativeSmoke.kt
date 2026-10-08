package lokal.wasapi

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import javax.sound.sampled.AudioFileFormat
import javax.sound.sampled.AudioFormat
import javax.sound.sampled.AudioInputStream
import javax.sound.sampled.AudioSystem

fun main() {
    val file = createSmokeWave()
    val output = JniWasapiOutput()
    val engine = PlaybackEngine(output)
    try {
        val devices = engine.devices()
        check(devices.isNotEmpty()) { "No active WASAPI output devices were found." }
        println("WASAPI devices: ${devices.joinToString { it.name }}")
        val device = devices.first()

        PcmFormat.entries.forEach { format ->
            println("Playing WAV through ${device.name} as ${format.name}")
            engine.play(file, device.id, format)
            val deadline = System.nanoTime() + 5_000_000_000L
            while (engine.state.value == PlaybackState.Stopped &&
                System.nanoTime() < deadline) {
                Thread.sleep(20)
            }
            while ((engine.state.value == PlaybackState.Starting ||
                    engine.state.value == PlaybackState.Playing ||
                    engine.state.value == PlaybackState.Paused ||
                    engine.state.value == PlaybackState.Stopping) &&
                System.nanoTime() < deadline) {
                Thread.sleep(20)
            }
            check(engine.state.value == PlaybackState.Stopped) {
                "${format.name} playback failed: ${engine.state.value}"
            }
        }
        println("WASAPI PCM16 and float32 playback smoke tests passed.")
    } finally {
        engine.close()
        file.delete()
    }
}

private fun createSmokeWave(): File {
    val sampleRate = 48_000
    val frames = sampleRate
    val pcm = ByteArray(frames * 4)
    val bytes = ByteBuffer.wrap(pcm).order(ByteOrder.LITTLE_ENDIAN)
    repeat(frames) { frame ->
        val value = (kotlin.math.sin(2.0 * Math.PI * 440 * frame / sampleRate) * 8000).toInt().toShort()
        bytes.putShort(value)
        bytes.putShort(value)
    }
    val format = AudioFormat(sampleRate.toFloat(), 16, 2, true, false)
    val file = File.createTempFile("lokal-wasapi-smoke-", ".wav")
    AudioInputStream(pcm.inputStream(), format, frames.toLong()).use {
        AudioSystem.write(it, AudioFileFormat.Type.WAVE, file)
    }
    return file
}
