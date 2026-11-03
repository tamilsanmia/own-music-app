import { describe, expect, it } from 'vitest';
import {
  currentIndex,
  identityOrder,
  nextPosition,
  nextRepeat,
  prevPosition,
  shuffledOrder,
  withShuffle,
  type QueueState,
} from './queue';

const state = (over: Partial<QueueState> = {}): QueueState => ({
  length: 4,
  order: identityOrder(4),
  position: 0,
  shuffle: false,
  repeat: 'off',
  ...over,
});

/** Deterministic "random" numbers for repeatable shuffles. */
function seeded(seed = 42) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

describe('next', () => {
  it('moves forward and stops at the end with repeat off', () => {
    expect(nextPosition(state({ position: 0 }), true)).toBe(1);
    expect(nextPosition(state({ position: 3 }), true)).toBeNull();
    expect(nextPosition(state({ position: 3 }), false)).toBeNull();
  });

  it('wraps around with repeat all', () => {
    expect(nextPosition(state({ position: 3, repeat: 'all' }), true)).toBe(0);
    expect(nextPosition(state({ position: 3, repeat: 'all' }), false)).toBe(0);
  });

  it('replays the track when it ends with repeat one, but a manual next still moves on', () => {
    expect(nextPosition(state({ position: 2, repeat: 'one' }), true)).toBe(2);
    expect(nextPosition(state({ position: 2, repeat: 'one' }), false)).toBe(3);
    expect(nextPosition(state({ position: 3, repeat: 'one' }), false)).toBe(0);
  });

  it('handles an empty queue', () => {
    expect(nextPosition(state({ length: 0, order: [] }), true)).toBeNull();
  });
});

describe('previous', () => {
  it('restarts the current track after 3 seconds', () => {
    expect(prevPosition(state({ position: 2 }), 3.5)).toBe(2);
  });

  it('goes back within the first 3 seconds', () => {
    expect(prevPosition(state({ position: 2 }), 1)).toBe(1);
  });

  it('stays on the first track with repeat off and wraps with repeat all', () => {
    expect(prevPosition(state({ position: 0 }), 0)).toBe(0);
    expect(prevPosition(state({ position: 0, repeat: 'all' }), 0)).toBe(3);
  });
});

describe('shuffle', () => {
  it('puts the given track first and keeps every track exactly once', () => {
    const order = shuffledOrder(10, 7, seeded());
    expect(order[0]).toBe(7);
    expect([...order].sort((a, b) => a - b)).toEqual(identityOrder(10));
  });

  it('actually changes the order', () => {
    const order = shuffledOrder(10, 0, seeded());
    expect(order).not.toEqual(identityOrder(10));
  });

  it('keeps the playing track when turned on and off', () => {
    const s = state({ length: 6, order: identityOrder(6), position: 4 });
    const on = withShuffle(s, true, seeded());
    expect(on.position).toBe(0);
    expect(currentIndex(on)).toBe(4);

    const later = { ...s, ...on, position: 3 };
    const playing = currentIndex(later)!;
    const off = withShuffle(later, false);
    expect(off.order).toEqual(identityOrder(6));
    expect(currentIndex(off)).toBe(playing);
  });

  it('visits every track once before stopping', () => {
    let s: QueueState = { ...state({ length: 5, order: identityOrder(5), position: 0 }), ...withShuffle(state({ length: 5, order: identityOrder(5) }), true, seeded()) };
    const played = [currentIndex(s)];
    for (let p = nextPosition(s, true); p !== null; p = nextPosition(s, true)) {
      s = { ...s, position: p };
      played.push(currentIndex(s));
    }
    expect([...played].sort()).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('repeat', () => {
  it('cycles off → all → one → off', () => {
    expect([nextRepeat('off'), nextRepeat('all'), nextRepeat('one')]).toEqual(['all', 'one', 'off']);
  });
});
