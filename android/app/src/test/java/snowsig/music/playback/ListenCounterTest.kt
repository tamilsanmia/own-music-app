package snowsig.music.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ListenCounterTest {
    @Test
    fun `reports once after 30 seconds of listening`() {
        val c = ListenCounter()
        val reports = (0..45).count { c.tick(it.toDouble(), 200.0) }
        assertEquals(1, reports)
        val c2 = ListenCounter()
        assertEquals(0, (0..29).count { c2.tick(it.toDouble(), 200.0) })
    }

    @Test
    fun `seeking does not count as listening`() {
        val c = ListenCounter()
        assertFalse(c.tick(0.0, 200.0))
        assertFalse(c.tick(150.0, 200.0)) // jumped
        assertFalse(c.tick(151.0, 200.0))
        assertFalse(c.tick(10.0, 200.0)) // jumped back
    }

    @Test
    fun `short songs count after half their length`() {
        assertEquals(10.0, playThreshold(20.0), 0.0)
        assertEquals(30.0, playThreshold(200.0), 0.0)
        assertEquals(30.0, playThreshold(Double.NaN), 0.0)
        val c = ListenCounter()
        assertEquals(1, (0..12).count { c.tick(it.toDouble(), 20.0) })
    }

    @Test
    fun `reset starts a new play`() {
        val c = ListenCounter()
        (0..31).forEach { c.tick(it.toDouble(), 200.0) }
        c.reset()
        assertEquals(1, (0..31).count { c.tick(it.toDouble(), 200.0) })
    }
}
