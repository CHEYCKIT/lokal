package lokal.wasapi

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean

sealed interface PlaybackState {
    data object Stopped : PlaybackState
    data object Starting : PlaybackState
    data object Playing : PlaybackState
    data object Stopping : PlaybackState
    data class Failed(val message: String) : PlaybackState
}

class TonePlayer(private val output: WasapiOutput) : AutoCloseable {
    private val lock = Any()
    private val mutableState = MutableStateFlow<PlaybackState>(PlaybackState.Stopped)
    private val stopRequested = AtomicBoolean(false)
    private var playbackThread: Thread? = null

    val state: StateFlow<PlaybackState> = mutableState.asStateFlow()

    fun devices(): List<AudioDevice> = output.devices()

    fun start(deviceId: String, sampleRate: Int, format: PcmFormat) {
        synchronized(lock) {
            check(mutableState.value == PlaybackState.Stopped ||
                mutableState.value is PlaybackState.Failed) {
                "Playback is already active."
            }
            require(sampleRate in 8_000..192_000) { "Sample rate must be between 8 and 192 kHz." }
            mutableState.value = PlaybackState.Starting
            stopRequested.set(false)
            try {
                output.open(deviceId, sampleRate, format)
                output.start()
            } catch (exception: Exception) {
                try {
                    output.close()
                } catch (closeException: Exception) {
                    exception.addSuppressed(closeException)
                }
                mutableState.value = PlaybackState.Failed(exception.message ?: "Could not start playback.")
                throw exception
            }

            mutableState.value = PlaybackState.Playing
            playbackThread = Thread(
                { streamTone(sampleRate, format) },
                "lokal-test-tone",
            ).apply {
                isDaemon = true
                start()
            }
        }
    }

    fun stop() {
        val thread = synchronized(lock) {
            when (mutableState.value) {
                PlaybackState.Stopped -> return
                is PlaybackState.Failed -> {
                    mutableState.value = PlaybackState.Stopped
                    return
                }
                else -> {
                    mutableState.value = PlaybackState.Stopping
                    stopRequested.set(true)
                    playbackThread.also { it?.interrupt() }
                }
            }
        }
        thread?.join()
    }

    override fun close() = stop()

    private fun streamTone(sampleRate: Int, format: PcmFormat) {
        val bytesPerSample = format.bitsPerSample / 8
        val bytesPerFrame = bytesPerSample * CHANNELS
        val buffer = PcmFrameBuffer(bytesPerFrame, NATIVE_WRITE_FRAMES * 2)
        val tone = SineToneGenerator(sampleRate, format)
        var failure: Exception? = null
        try {
            while (!stopRequested.get()) {
                while (buffer.availableFrames < NATIVE_WRITE_FRAMES && !stopRequested.get()) {
                    val frames = minOf(GENERATE_FRAMES, NATIVE_WRITE_FRAMES - buffer.availableFrames)
                    buffer.write(tone.nextFrames(frames))
                    val nanos = frames.toLong() * NANOS_PER_SECOND / sampleRate
                    val millis = nanos / NANOS_PER_MILLISECOND
                    val extraNanos = (nanos % NANOS_PER_MILLISECOND).toInt()
                    Thread.sleep(millis, extraNanos)
                }
                if (!stopRequested.get()) {
                    output.write(checkNotNull(buffer.readExact(NATIVE_WRITE_FRAMES)))
                }
            }
        } catch (exception: InterruptedException) {
            if (!stopRequested.get()) failure = exception
        } catch (exception: Exception) {
            if (!stopRequested.get()) failure = exception
        } finally {
            try {
                output.close()
            } catch (closeException: Exception) {
                if (failure == null) failure = closeException else failure.addSuppressed(closeException)
            }
            synchronized(lock) {
                mutableState.value = failure?.let {
                    PlaybackState.Failed(it.message ?: "Playback failed.")
                } ?: PlaybackState.Stopped
                playbackThread = null
            }
        }
    }

    private class SineToneGenerator(
        private val sampleRate: Int,
        private val format: PcmFormat,
    ) {
        private var phase = 0.0

        fun nextFrames(frameCount: Int): ByteArray {
            val bytesPerSample = format.bitsPerSample / 8
            val result = ByteBuffer.allocate(frameCount * CHANNELS * bytesPerSample)
                .order(ByteOrder.LITTLE_ENDIAN)
            repeat(frameCount) {
                val sample = (AMPLITUDE * kotlin.math.sin(phase)).toFloat()
                phase += TWO_PI * TONE_FREQUENCY / sampleRate
                if (phase >= TWO_PI) phase -= TWO_PI
                repeat(CHANNELS) {
                    when (format) {
                        PcmFormat.PCM16 -> result.putShort((sample * Short.MAX_VALUE).toInt().toShort())
                        PcmFormat.FLOAT32 -> result.putFloat(sample)
                    }
                }
            }
            return result.array()
        }
    }

    private companion object {
        const val CHANNELS = 2
        const val GENERATE_FRAMES = 256
        const val NATIVE_WRITE_FRAMES = 1024
        const val NANOS_PER_SECOND = 1_000_000_000L
        const val NANOS_PER_MILLISECOND = 1_000_000L
        const val AMPLITUDE = 0.2
        const val TONE_FREQUENCY = 440.0
        const val TWO_PI = 2.0 * Math.PI
    }
}
