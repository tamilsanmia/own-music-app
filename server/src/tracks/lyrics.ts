/** A line starting with an LRC time tag such as [01:23.45] or [1:23]. */
const LRC_LINE = /^\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/m;

/** Lyrics with timestamps can be shown in sync with the music. */
export function isSyncedLyrics(lyrics: string): boolean {
  return LRC_LINE.test(lyrics);
}

/** Unify line endings and trim; empty lyrics are stored as null. */
export function normalizeLyrics(lyrics: string | null): string | null {
  const text = (lyrics ?? '').replace(/\r\n?/g, '\n').trim();
  return text === '' ? null : text;
}
