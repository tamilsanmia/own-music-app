/**
 * Pure play-queue logic, kept apart from React and audio so it can be tested directly.
 *
 * `queue` keeps the order the user chose (album order). `order` is the play order: indexes into
 * `queue`, shuffled when shuffle is on. `position` is where we are in `order`.
 */

export type RepeatMode = 'off' | 'all' | 'one';

export interface QueueState {
  /** Number of tracks in the queue. */
  length: number;
  order: number[];
  position: number;
  shuffle: boolean;
  repeat: RepeatMode;
}

export type Rng = () => number;

/** Fisher–Yates shuffle of 0..n-1 with `first` moved to the front. */
export function shuffledOrder(n: number, first: number, rng: Rng = Math.random): number[] {
  const rest = Array.from({ length: n }, (_, i) => i).filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return n > 0 ? [first, ...rest] : [];
}

export function identityOrder(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** Queue index of the track at `position`, or undefined for an empty queue. */
export function currentIndex(s: Pick<QueueState, 'order' | 'position'>): number | undefined {
  return s.order[s.position];
}

/**
 * Where to go next. `auto` means the current track ended by itself: repeat-one replays it.
 * A manual "next" always moves on, as in most players. Returns null when playback should stop.
 */
export function nextPosition(s: QueueState, auto: boolean): number | null {
  if (s.length === 0) return null;
  if (auto && s.repeat === 'one') return s.position;
  if (s.position < s.length - 1) return s.position + 1;
  return s.repeat === 'off' ? null : 0;
}

/** Seconds into a track after which "previous" restarts it instead of going back. */
export const RESTART_THRESHOLD_S = 3;

/** Where "previous" goes. Returns the same position to mean "restart the current track". */
export function prevPosition(s: QueueState, currentTimeS: number): number {
  if (s.length === 0) return 0;
  if (currentTimeS > RESTART_THRESHOLD_S) return s.position;
  if (s.position > 0) return s.position - 1;
  return s.repeat === 'all' ? s.length - 1 : 0;
}

/** Turn shuffle on or off without changing the track that is playing. */
export function withShuffle(s: QueueState, on: boolean, rng: Rng = Math.random): Pick<QueueState, 'order' | 'position' | 'shuffle'> {
  const current = currentIndex(s) ?? 0;
  if (on) return { shuffle: true, order: shuffledOrder(s.length, current, rng), position: 0 };
  return { shuffle: false, order: identityOrder(s.length), position: current };
}

export function nextRepeat(mode: RepeatMode): RepeatMode {
  return mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off';
}
