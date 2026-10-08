package lokal.wasapi

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class PcmFrameBufferTest {
    @Test
    fun readsAcrossRingWrapInOrder() {
        val buffer = PcmFrameBuffer(bytesPerFrame = 2, capacityFrames = 3)
        buffer.write(byteArrayOf(1, 2, 3, 4))
        assertContentEquals(byteArrayOf(1, 2), buffer.readExact(1))
        buffer.write(byteArrayOf(5, 6, 7, 8))

        assertContentEquals(byteArrayOf(3, 4, 5, 6), buffer.readExact(2))
        assertContentEquals(byteArrayOf(7, 8), buffer.readExact(1))
        assertEquals(0, buffer.availableFrames)
    }

    @Test
    fun rejectsMisalignedWritesAndOverrun() {
        val buffer = PcmFrameBuffer(bytesPerFrame = 4, capacityFrames = 2)
        assertFailsWith<IllegalArgumentException> { buffer.write(byteArrayOf(1, 2, 3)) }
        buffer.write(ByteArray(8))
        assertFailsWith<IllegalStateException> { buffer.write(ByteArray(4)) }
    }

    @Test
    fun exactReadWaitsUntilAllFramesAreAvailable() {
        val buffer = PcmFrameBuffer(bytesPerFrame = 2, capacityFrames = 4)
        buffer.write(byteArrayOf(1, 2))

        assertNull(buffer.readExact(2))
        assertEquals(1, buffer.availableFrames)
    }
}
