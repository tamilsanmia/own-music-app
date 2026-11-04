package snowsig.music.ui.lyrics

/** One line of lyrics. [timeMs] is null for plain (unsynced) lyrics. */
data class LyricLine(val timeMs: Long?, val text: String)

private val TIME_TAG = Regex("""\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?]""")
private val OFFSET_TAG = Regex("""^\s*\[offset:\s*([+-]?\d+)\s*]\s*$""", RegexOption.IGNORE_CASE)
/** LRC header tags such as [ar:Artist] or [ti:Title]. */
private val META_TAG = Regex("""^\s*\[[a-zA-Z]+:[^\]]*]\s*$""")

/**
 * Lyrics from the server: LRC ("[01:23.45] line", several time tags per line allowed, optional
 * [offset:ms]) when [synced], else plain text with one lyric per line.
 */
fun parseLyrics(text: String, synced: Boolean): List<LyricLine> {
    val rawLines = text.replace("\r\n", "\n").split('\n')
    if (!synced) return rawLines.map { LyricLine(null, it.trim()) }.dropWhile { it.text.isEmpty() }.dropLastWhile { it.text.isEmpty() }

    // A positive offset makes the lyrics appear sooner.
    val offset = rawLines.firstNotNullOfOrNull { OFFSET_TAG.find(it)?.groupValues?.get(1)?.toLongOrNull() } ?: 0L
    val out = mutableListOf<LyricLine>()
    for (line in rawLines) {
        if (META_TAG.matches(line) && !TIME_TAG.containsMatchIn(line)) continue
        val tags = TIME_TAG.findAll(line).toList()
        if (tags.isEmpty()) continue
        val lyric = line.substring(tags.last().range.last + 1).trim()
        for (tag in tags) {
            val (min, sec, frac) = tag.destructured
            val fracMs = when (frac.length) {
                0 -> 0L
                1 -> frac.toLong() * 100
                2 -> frac.toLong() * 10
                else -> frac.take(3).toLong()
            }
            val ms = (min.toLong() * 60 + sec.toLong()) * 1000 + fracMs - offset
            out += LyricLine(ms.coerceAtLeast(0), lyric)
        }
    }
    return out.sortedBy { it.timeMs }
}

/** Index of the line being sung at [positionMs], or -1 before the first line or for plain lyrics. */
fun currentLineIndex(lines: List<LyricLine>, positionMs: Long): Int {
    var index = -1
    for ((i, l) in lines.withIndex()) {
        val t = l.timeMs ?: return -1
        if (t <= positionMs) index = i else break
    }
    return index
}
