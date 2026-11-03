/** A play counts after this many seconds of actual listening... */
export const PLAY_COUNT_SECONDS = 30;

/** ...or half of a track that is shorter than a minute. */
export function playThreshold(durationS: number): number {
  return Number.isFinite(durationS) && durationS > 0 ? Math.min(PLAY_COUNT_SECONDS, durationS / 2) : PLAY_COUNT_SECONDS;
}

/**
 * Counts seconds actually listened, from successive playback positions. Seeking forward or
 * back doesn't count, so jumping to the end of a song doesn't register a play.
 */
export class ListenCounter {
  private listened = 0;
  private last: number | null = null;
  private reported = false;

  reset(): void {
    this.listened = 0;
    this.last = null;
    this.reported = false;
  }

  /** Feed the current position. Returns true exactly once, when the play should be reported. */
  tick(positionS: number, durationS: number): boolean {
    const delta = this.last === null ? 0 : positionS - this.last;
    this.last = positionS;
    // timeupdate fires every ~250 ms; anything bigger or negative is a seek.
    if (delta > 0 && delta < 2) this.listened += delta;
    if (!this.reported && this.listened >= playThreshold(durationS)) {
      this.reported = true;
      return true;
    }
    return false;
  }
}
