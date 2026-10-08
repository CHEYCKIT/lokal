package lokal.wasapi

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class TonePlayerTest {
    @Test
    fun nativeOpenErrorIsReportedAndOutputIsClosed() {
        val output = FakeOutput().apply { openError = IllegalStateException("device rejected format") }
        val player = TonePlayer(output)

        val error = assertFailsWith<IllegalStateException> {
            player.start("device", 48_000, PcmFormat.PCM16)
        }

        assertEquals("device rejected format", error.message)
        assertEquals(PlaybackState.Failed("device rejected format"), player.state.value)
        assertTrue(output.closed)
        player.close()
        assertEquals(PlaybackState.Stopped, player.state.value)
    }

    @Test
    fun writeErrorMovesPlaybackToFailedAndClosesOutput() = runBlocking {
        val output = FakeOutput().apply {
            writeError = IllegalStateException("WASAPI output buffer overrun")
        }
        val player = TonePlayer(output)
        player.start("device", 48_000, PcmFormat.PCM16)

        assertTrue(output.writeStarted.await(5, TimeUnit.SECONDS))
        val state = withTimeout(5_000) { player.state.first { it is PlaybackState.Failed } }

        assertEquals(PlaybackState.Failed("WASAPI output buffer overrun"), state)
        assertTrue(output.closed)
        player.close()
    }

    @Test
    fun playbackCanStartAndStopWithFixedNativeChunks() {
        val output = FakeOutput()
        val player = TonePlayer(output)

        player.start("device", 48_000, PcmFormat.PCM16)
        assertEquals(PlaybackState.Playing, player.state.value)
        assertTrue(output.writeStarted.await(5, TimeUnit.SECONDS))
        player.stop()

        assertEquals(PlaybackState.Stopped, player.state.value)
        assertTrue(output.opened)
        assertTrue(output.closed)
        assertEquals(4096, output.writtenBytes)
    }

    @Test
    fun rejectsInvalidSampleRateBeforeOpeningNativeOutput() {
        val output = FakeOutput()
        val player = TonePlayer(output)

        assertFailsWith<IllegalArgumentException> {
            player.start("device", 1_000, PcmFormat.FLOAT32)
        }
        assertEquals(PlaybackState.Stopped, player.state.value)
        assertTrue(!output.opened)
    }

    private class FakeOutput : WasapiOutput {
        var openError: Exception? = null
        var opened = false
        var closed = false
        var writtenBytes = 0
        var writeError: Exception? = null
        val writeStarted = CountDownLatch(1)

        override fun devices() = listOf(AudioDevice("device", "Test output"))

        override fun open(deviceId: String, sampleRate: Int, format: PcmFormat) {
            openError?.let { throw it }
            opened = true
        }

        override fun start() = Unit

        override fun write(pcm: ByteArray) {
            writtenBytes += pcm.size
            writeStarted.countDown()
            writeError?.let { throw it }
        }

        override fun close() {
            closed = true
        }
    }
}
