package lokal.wasapi

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File

sealed interface PlaybackState {
    data object Stopped : PlaybackState
    data object Starting : PlaybackState
    data object Playing : PlaybackState
    data object Paused : PlaybackState
    data object Stopping : PlaybackState
    data class Failed(val message: String) : PlaybackState
}

class PlaybackEngine(private val output: WasapiOutput) : AutoCloseable {
    private val lock = Object()
    private val mutableState = MutableStateFlow<PlaybackState>(PlaybackState.Stopped)
    private var worker: Thread? = null
    @Volatile private var stopRequested = false
    @Volatile private var pauseRequested = false

    val state: StateFlow<PlaybackState> = mutableState.asStateFlow()

    fun devices(): List<AudioDevice> = output.devices()

    fun play(file: File, deviceId: String, format: PcmFormat) {
        val thread = synchronized(lock) {
            check(mutableState.value == PlaybackState.Stopped || mutableState.value is PlaybackState.Failed) {
                "Stop current playback before starting another file."
            }
            require(file.isFile) { "Audio file does not exist: $file" }
            stopRequested = false
            pauseRequested = false
            mutableState.value = PlaybackState.Starting
            Thread({ streamFile(file, deviceId, format) }, "lokal-file-playback").apply {
                isDaemon = true
                worker = this
            }
        }
        thread.start()
    }

    fun pause() {
        synchronized(lock) {
            if (mutableState.value != PlaybackState.Playing) return
            pauseRequested = true
            mutableState.value = PlaybackState.Paused
        }
    }

    fun resume() {
        synchronized(lock) {
            if (mutableState.value != PlaybackState.Paused) return
            pauseRequested = false
            mutableState.value = PlaybackState.Playing
            lock.notifyAll()
        }
    }

    fun stop() {
        val thread = synchronized(lock) {
            if (mutableState.value == PlaybackState.Stopped) return
            if (mutableState.value is PlaybackState.Failed) {
                mutableState.value = PlaybackState.Stopped
                return
            }
            mutableState.value = PlaybackState.Stopping
            stopRequested = true
            pauseRequested = false
            lock.notifyAll()
            worker
        }
        thread?.join()
    }

    override fun close() {
        stop()
        output.dispose()
    }

    private fun streamFile(file: File, deviceId: String, pcmFormat: PcmFormat) {
        var failure: Exception? = null
        var decoder: PcmFileDecoder? = null
        var outputOpened = false
        try {
            decoder = PcmFileDecoder.open(file)
            if (stopRequested) return
            output.open(deviceId, decoder.format.sampleRate, pcmFormat)
            outputOpened = true
            if (stopRequested) return
            output.start()
            mutableState.value = PlaybackState.Playing

            val bytesPerFrame = decoder.format.frameSize * (pcmFormat.bitsPerSample / 16)
            val staging = PcmFrameBuffer(bytesPerFrame, PcmFileDecoder.CHUNK_FRAMES * 2)
            while (!stopRequested) {
                awaitResume()
                if (stopRequested) break
                val samples = decoder.readFrames() ?: break
                staging.write(encodePcm(samples, pcmFormat))
                val frameCount = samples.size / decoder.format.channels
                check(staging.availableFrames >= frameCount)
                output.write(checkNotNull(staging.readExact(frameCount)))
            }
        } catch (exception: Exception) {
            if (!stopRequested) failure = exception
        } finally {
            try {
                decoder?.close()
            } catch (exception: Exception) {
                if (failure == null && !stopRequested) failure = exception
                else failure?.addSuppressed(exception)
            }
            if (outputOpened) {
                try {
                    output.close()
                } catch (exception: Exception) {
                    if (failure == null && !stopRequested) failure = exception
                    else failure?.addSuppressed(exception)
                }
            }
            synchronized(lock) {
                mutableState.value = failure?.let {
                    PlaybackState.Failed(it.message ?: "File playback failed.")
                } ?: PlaybackState.Stopped
                worker = null
            }
        }
    }

    private fun awaitResume() {
        synchronized(lock) {
            var outputPaused = false
            while (pauseRequested && !stopRequested) {
                if (!outputPaused) {
                    output.pause()
                    outputPaused = true
                }
                lock.wait()
            }
            if (outputPaused && !stopRequested) output.start()
        }
    }
}
