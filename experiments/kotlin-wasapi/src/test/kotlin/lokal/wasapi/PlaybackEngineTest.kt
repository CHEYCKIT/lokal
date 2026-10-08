package lokal.wasapi

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.io.ByteArrayInputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.sound.sampled.AudioFormat
import javax.sound.sampled.AudioInputStream
import javax.sound.sampled.AudioSystem
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class PlaybackEngineTest {
    @Test
    fun decodesWavToStereoFloatFrames() {
        val wav = wavFile(frameCount = 2500)
        try {
            PcmFileDecoder.open(wav).use { decoder ->
                assertEquals(48_000, decoder.format.sampleRate)
                assertEquals(2, decoder.format.channels)
                assertEquals(1024, decoder.readFrames()!!.size / 2)
                assertEquals(1024, decoder.readFrames()!!.size / 2)
                assertEquals(452, decoder.readFrames()!!.size / 2)
                assertEquals(null, decoder.readFrames())
            }
        } finally {
            wav.delete()
        }
    }

    @Test
    fun rejectsUnknownAndMissingFilesWithErrors() {
        val missing = File("missing-${System.nanoTime()}.wav")
        assertFailsWith<IllegalArgumentException> { PcmFileDecoder.open(missing) }
        val invalid = File.createTempFile("invalid-audio", ".wav").apply { writeText("not audio") }
        try {
            assertFailsWith<Exception> { PcmFileDecoder.open(invalid) }
        } finally {
            invalid.delete()
        }
    }

    @Test
    fun encodesBothOutputFormatsAsLittleEndian() {
        val samples = floatArrayOf(-1f, 0.5f)
        val pcm16 = encodePcm(samples, PcmFormat.PCM16)
        assertContentEquals(byteArrayOf(0, -128, 0, 64), pcm16)
        val float32 = ByteBuffer.wrap(encodePcm(samples, PcmFormat.FLOAT32))
            .order(ByteOrder.LITTLE_ENDIAN)
        assertEquals(-1f, float32.float)
        assertEquals(0.5f, float32.float)
    }

    @Test
    fun streamsFileAndClosesOutputForBothFormats() {
        for (format in PcmFormat.entries) {
            val file = wavFile(frameCount = 2048)
            try {
                val output = FakeOutput()
                val player = PlaybackEngine(output)
                player.play(file, "device", format)
                assertTrue(output.firstWrite.await(5, TimeUnit.SECONDS))
                runBlocking {
                    withTimeout(5000) { player.state.first { it == PlaybackState.Stopped || it is PlaybackState.Failed } }
                }
                assertTrue(output.opened)
                assertTrue(output.closed)
                assertEquals(format, output.format)
                assertEquals(2048 * 2 * format.bitsPerSample / 8, output.writtenBytes)
                player.close()
            } finally {
                file.delete()
            }
        }
    }

    @Test
    fun reportsDecodeAndOutputErrors() = runBlocking {
        val file = wavFile(frameCount = 1024)
        try {
            val output = FakeOutput().apply { writeError = IllegalStateException("device write failed") }
            val player = PlaybackEngine(output)
            player.play(file, "device", PcmFormat.PCM16)
            val state = withTimeout(5000) { player.state.first { it is PlaybackState.Failed } }
            assertEquals(PlaybackState.Failed("device write failed"), state)
            assertTrue(output.closed)
            player.close()
        } finally {
            file.delete()
        }
    }

    @Test
    fun pauseResumeAndStopAreReflectedInState() {
        val file = wavFile(frameCount = 48_000)
        try {
            val output = FakeOutput().apply { writeDelayMs = 4 }
            val player = PlaybackEngine(output)
            player.play(file, "device", PcmFormat.PCM16)
            assertTrue(output.firstWrite.await(5, TimeUnit.SECONDS))
            player.pause()
            assertTrue(output.pauseReached.await(5, TimeUnit.SECONDS))
            assertEquals(PlaybackState.Paused, player.state.value)
            player.resume()
            assertTrue(output.resumeStarted.await(5, TimeUnit.SECONDS))
            assertEquals(PlaybackState.Playing, player.state.value)
            player.stop()
            assertEquals(PlaybackState.Stopped, player.state.value)
            assertTrue(output.closed)
            player.close()
        } finally {
            file.delete()
        }
    }

    private fun wavFile(frameCount: Int): File {
        val format = AudioFormat(48_000f, 16, 2, true, false)
        val pcm = ByteArray(frameCount * format.frameSize)
        AudioInputStream(ByteArrayInputStream(pcm), format, frameCount.toLong()).use { stream ->
            val file = File.createTempFile("lokal-playback", ".wav")
            AudioSystem.write(stream, javax.sound.sampled.AudioFileFormat.Type.WAVE, file)
            return file
        }
    }

    private class FakeOutput : WasapiOutput {
        @Volatile var opened = false
        @Volatile var closed = false
        @Volatile var format: PcmFormat? = null
        @Volatile var writtenBytes = 0
        @Volatile var writeError: Exception? = null
        @Volatile var writeDelayMs = 0L
        val firstWrite = CountDownLatch(1)
        val pauseReached = CountDownLatch(1)
        val resumeStarted = CountDownLatch(2)

        override fun devices() = listOf(AudioDevice("device", "Test device"))
        override fun open(deviceId: String, sampleRate: Int, format: PcmFormat) {
            this.format = format
            opened = true
        }
        override fun start() {
            resumeStarted.countDown()
        }
        override fun pause() {
            pauseReached.countDown()
        }
        override fun write(pcm: ByteArray) {
            firstWrite.countDown()
            if (writeDelayMs > 0) Thread.sleep(writeDelayMs)
            writeError?.let { throw it }
            writtenBytes += pcm.size
        }
        override fun close() {
            closed = true
        }
    }
}
