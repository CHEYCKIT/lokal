package lokal.wasapi

import java.io.Closeable
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import javax.sound.sampled.AudioFormat
import javax.sound.sampled.AudioInputStream
import javax.sound.sampled.AudioSystem

data class DecodedAudioFormat(val sampleRate: Int, val channels: Int, val frameSize: Int)

class PcmFileDecoder private constructor(
    private val input: AudioInputStream,
    val format: DecodedAudioFormat,
) : Closeable {
    private val bytes = ByteArray(CHUNK_FRAMES * format.frameSize)
    private var pendingBytes = 0
    private var endOfStream = false

    /** Returns normalized interleaved stereo float samples, or null at end of file. */
    fun readFrames(maxFrames: Int = CHUNK_FRAMES): FloatArray? {
        require(maxFrames in 1..CHUNK_FRAMES)
        val length = maxFrames * format.frameSize
        var offset = pendingBytes
        while (offset < length && !endOfStream) {
            val count = input.read(bytes, offset, length - offset)
            if (count < 0) {
                endOfStream = true
                break
            }
            if (count == 0) {
                Thread.yield()
                continue
            }
            offset += count
        }
        val frameBytes = format.frameSize
        val completeBytes = offset - offset % frameBytes
        pendingBytes = offset - completeBytes
        if (pendingBytes > 0) bytes.copyInto(bytes, 0, completeBytes, offset)
        if (completeBytes == 0) {
            check(pendingBytes == 0) { "Decoded audio ended with an incomplete PCM frame." }
            return null
        }
        val buffer = ByteBuffer.wrap(bytes, 0, completeBytes).order(ByteOrder.LITTLE_ENDIAN)
        val samples = FloatArray(completeBytes / 2)
        for (index in samples.indices) {
            samples[index] = buffer.short.toFloat() / 32768f
        }
        return samples
    }

    override fun close() = input.close()

    companion object {
        const val CHUNK_FRAMES = 1024

        fun open(file: File): PcmFileDecoder {
            require(file.isFile) { "Audio file does not exist: $file" }
            val source = AudioSystem.getAudioInputStream(file)
            try {
                val sourceFormat = source.format
                require(sourceFormat.channels in 1..8) {
                    "Unsupported channel count ${sourceFormat.channels}."
                }
                require(sourceFormat.sampleRate.isFinite() && sourceFormat.sampleRate in 8_000f..192_000f) {
                    "Unsupported audio sample rate ${sourceFormat.sampleRate}."
                }
                val outputFormat = AudioFormat(
                    AudioFormat.Encoding.PCM_SIGNED,
                    sourceFormat.sampleRate,
                    16,
                    2,
                    4,
                    sourceFormat.sampleRate,
                    false,
                )
                check(AudioSystem.isConversionSupported(outputFormat, sourceFormat)) {
                    "No Java Sound decoder/conversion is available for ${sourceFormat}."
                }
                val converted = AudioSystem.getAudioInputStream(outputFormat, source)
                return PcmFileDecoder(
                    converted,
                    DecodedAudioFormat(outputFormat.sampleRate.toInt(), 2, outputFormat.frameSize),
                )
            } catch (exception: Exception) {
                source.close()
                throw exception
            }
        }
    }
}

internal fun encodePcm(samples: FloatArray, format: PcmFormat): ByteArray {
    val bytesPerSample = format.bitsPerSample / 8
    val buffer = ByteBuffer.allocate(samples.size * bytesPerSample).order(ByteOrder.LITTLE_ENDIAN)
    for (sample in samples) {
        val safe = if (sample.isFinite()) sample.coerceIn(-1f, 1f) else 0f
        when (format) {
            PcmFormat.PCM16 -> buffer.putShort(
                (safe * 32768f).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort(),
            )
            PcmFormat.FLOAT32 -> buffer.putFloat(safe)
        }
    }
    return buffer.array()
}
