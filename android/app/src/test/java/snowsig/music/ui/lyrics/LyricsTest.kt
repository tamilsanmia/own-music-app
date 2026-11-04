package snowsig.music.ui.lyrics

import org.junit.Assert.assertEquals
import org.junit.Test

class LyricsTest {
    @Test
    fun `plain lyrics keep their lines without times`() {
        val lines = parseLyrics("\n  First line \r\nSecond line\n\nThird\n\n", synced = false)
        assertEquals(listOf("First line", "Second line", "", "Third"), lines.map { it.text })
        assertEquals(listOf(null, null, null, null), lines.map { it.timeMs })
    }

    @Test
    fun `LRC lines get their times, sorted, with header tags skipped`() {
        val lrc = """
            [ar:Deva]
            [ti:Nilavai Kondu Vaa]
            [00:12.50] Nilavai kondu vaa
            [00:05.00]Intro
            [01:02.123] Third
            [2:03] No fraction
            [00:20.7] One decimal
            Untimed text is ignored
        """.trimIndent()
        val lines = parseLyrics(lrc, synced = true)
        assertEquals(
            listOf(5_000L to "Intro", 12_500L to "Nilavai kondu vaa", 20_700L to "One decimal", 62_123L to "Third", 123_000L to "No fraction"),
            lines.map { it.timeMs to it.text },
        )
    }

    @Test
    fun `a line with several time tags repeats, and the offset tag shifts every line`() {
        val lines = parseLyrics("[offset:+500]\n[00:10.00][00:40.00] Chorus\n[00:20.00] Verse\n[00:00.20] Starts at once", synced = true)
        assertEquals(listOf(0L to "Starts at once", 9_500L to "Chorus", 19_500L to "Verse", 39_500L to "Chorus"), lines.map { it.timeMs to it.text })
    }

    @Test
    fun `the current line is the last one that has started`() {
        val lines = parseLyrics("[00:05.00] a\n[00:10.00] b\n[00:15.00] c", synced = true)
        assertEquals(-1, currentLineIndex(lines, 4_999))
        assertEquals(0, currentLineIndex(lines, 5_000))
        assertEquals(1, currentLineIndex(lines, 14_999))
        assertEquals(2, currentLineIndex(lines, 600_000))
        assertEquals(-1, currentLineIndex(parseLyrics("a\nb", synced = false), 10_000))
        assertEquals(-1, currentLineIndex(emptyList(), 10_000))
    }
}
