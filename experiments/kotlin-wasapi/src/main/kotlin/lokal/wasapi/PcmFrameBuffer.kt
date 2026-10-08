package lokal.wasapi

class PcmFrameBuffer(
    private val bytesPerFrame: Int,
    capacityFrames: Int,
) {
    private val data: ByteArray
    private var readFrame = 0
    private var writeFrame = 0
    var availableFrames: Int = 0
        private set

    init {
        require(bytesPerFrame > 0) { "Bytes per frame must be positive." }
        require(capacityFrames > 0) { "Buffer capacity must be positive." }
        data = ByteArray(Math.multiplyExact(bytesPerFrame, capacityFrames))
    }

    @Synchronized
    fun write(pcm: ByteArray) {
        require(pcm.size % bytesPerFrame == 0) { "PCM data must contain whole frames." }
        val frames = pcm.size / bytesPerFrame
        check(frames <= capacityFrames - availableFrames) { "PCM frame buffer is full." }
        copyIntoRing(pcm, 0, writeFrame, pcm.size)
        writeFrame = (writeFrame + frames) % capacityFrames
        availableFrames += frames
    }

    @Synchronized
    fun readExact(frames: Int): ByteArray? {
        require(frames >= 0) { "Frame count cannot be negative." }
        if (frames > availableFrames) return null
        val result = ByteArray(Math.multiplyExact(frames, bytesPerFrame))
        copyFromRing(result, readFrame, result.size)
        readFrame = (readFrame + frames) % capacityFrames
        availableFrames -= frames
        return result
    }

    private val capacityFrames: Int
        get() = data.size / bytesPerFrame

    private fun copyIntoRing(source: ByteArray, sourceOffset: Int, frameOffset: Int, byteCount: Int) {
        val offset = frameOffset * bytesPerFrame
        val firstBytes = minOf(byteCount, data.size - offset)
        source.copyInto(data, offset, sourceOffset, sourceOffset + firstBytes)
        if (firstBytes < byteCount) {
            source.copyInto(data, 0, sourceOffset + firstBytes, sourceOffset + byteCount)
        }
    }

    private fun copyFromRing(destination: ByteArray, frameOffset: Int, byteCount: Int) {
        val offset = frameOffset * bytesPerFrame
        val firstBytes = minOf(byteCount, data.size - offset)
        data.copyInto(destination, 0, offset, offset + firstBytes)
        if (firstBytes < byteCount) {
            data.copyInto(destination, firstBytes, 0, byteCount - firstBytes)
        }
    }
}
