package lokal.wasapi

import java.io.File

data class AudioDevice(val id: String, val name: String)

enum class PcmFormat(val bitsPerSample: Int) {
    PCM16(16),
    FLOAT32(32),
}

interface WasapiOutput {
    fun devices(): List<AudioDevice>
    fun open(deviceId: String, sampleRate: Int, format: PcmFormat)
    fun start()
    fun write(pcm: ByteArray)
    fun close()
}

class JniWasapiOutput : WasapiOutput {
    private var handle: Long

    init {
        val library = System.getProperty("lokal.wasapi.library")
            ?.let(::File)
            ?: File("build/native/lokal_wasapi.dll").absoluteFile
        check(library.isFile) {
            "Native WASAPI library not found at $library. Run build-native.bat first."
        }
        System.load(library.absolutePath)
        handle = nativeCreate()
        check(handle != 0L) { "Could not create the native WASAPI output." }
    }

    override fun devices(): List<AudioDevice> =
        nativeDevices().map { (id, name) -> AudioDevice(id, name) }

    override fun open(deviceId: String, sampleRate: Int, format: PcmFormat) {
        nativeOpen(handle, deviceId, sampleRate, format.bitsPerSample).throwIfError()
    }

    override fun start() {
        nativeStart(handle).throwIfError()
    }

    override fun write(pcm: ByteArray) {
        nativeWrite(handle, pcm).throwIfError()
    }

    override fun close() {
        if (handle != 0L) {
            nativeClose(handle)
            nativeDestroy(handle)
            handle = 0L
        }
    }

    private fun String?.throwIfError() {
        check(this == null) { this ?: "Unknown WASAPI error." }
    }

    private external fun nativeCreate(): Long
    private external fun nativeDevices(): Array<Array<String>>
    private external fun nativeOpen(handle: Long, deviceId: String, sampleRate: Int, bits: Int): String?
    private external fun nativeStart(handle: Long): String?
    private external fun nativeWrite(handle: Long, pcm: ByteArray): String?
    private external fun nativeClose(handle: Long)
    private external fun nativeDestroy(handle: Long)
}
