import { create } from 'zustand';
import type { ImageUrls, Ref } from '@/lib/catalog';
import {
  currentIndex,
  identityOrder,
  nextPosition,
  nextRepeat,
  prevPosition,
  shuffledOrder,
  withShuffle,
  type RepeatMode,
} from './queue';

export interface QueueTrack {
  id: string;
  title: string;
  durationMs: number | null;
  artist: Ref;
  album: { id: string; title: string; cover: ImageUrls | null };
}

const VOLUME_KEY = 'music.volume';

function savedVolume(): number {
  const v = Number(globalThis.localStorage?.getItem(VOLUME_KEY));
  return Number.isFinite(v) && v >= 0 && v <= 1 && globalThis.localStorage?.getItem(VOLUME_KEY) !== null ? v : 0.8;
}

export interface PlayerState {
  queue: QueueTrack[];
  order: number[];
  position: number;
  shuffle: boolean;
  repeat: RepeatMode;
  /** What the user wants. The audio engine follows it. */
  playing: boolean;
  /** Bumped to restart the current track from 0 (previous after 3 s, repeat one). */
  playId: number;
  currentTime: number;
  duration: number;
  buffering: boolean;
  error: string | null;
  volume: number;
  muted: boolean;

  /** Replace the queue with `tracks` and start playing tracks[start]. */
  playTracks(tracks: QueueTrack[], start?: number): void;
  togglePlay(): void;
  setPlaying(playing: boolean): void;
  next(auto?: boolean): void;
  prev(): void;
  toggleShuffle(): void;
  cycleRepeat(): void;
  setVolume(v: number): void;
  toggleMute(): void;
  reset(): void;
  /** Reports from the audio engine. */
  report(p: Partial<Pick<PlayerState, 'currentTime' | 'duration' | 'buffering' | 'error' | 'playing'>>): void;
}

const empty = {
  queue: [] as QueueTrack[],
  order: [] as number[],
  position: 0,
  playing: false,
  currentTime: 0,
  duration: 0,
  buffering: false,
  error: null as string | null,
};

export const usePlayer = create<PlayerState>((set, get) => {
  const qs = () => {
    const s = get();
    return { length: s.queue.length, order: s.order, position: s.position, shuffle: s.shuffle, repeat: s.repeat };
  };
  /** Move to `position`, or restart if it is the current one. */
  const go = (position: number) =>
    set((s) =>
      position === s.position
        ? { playId: s.playId + 1, playing: true, currentTime: 0, error: null }
        : { position, playing: true, currentTime: 0, duration: 0, error: null },
    );

  return {
    ...empty,
    shuffle: false,
    repeat: 'off',
    playId: 0,
    volume: savedVolume(),
    muted: false,

    playTracks(tracks, start = 0) {
      if (tracks.length === 0) return;
      const { shuffle, playId } = get();
      set({
        ...empty,
        queue: tracks,
        order: shuffle ? shuffledOrder(tracks.length, start) : identityOrder(tracks.length),
        position: shuffle ? 0 : start,
        playing: true,
        playId: playId + 1,
      });
    },
    togglePlay() {
      if (get().queue.length) set((s) => ({ playing: !s.playing }));
    },
    setPlaying(playing) {
      set({ playing });
    },
    next(auto = false) {
      const p = nextPosition(qs(), auto);
      if (p === null) {
        // End of the queue: stop and rewind to the first track, ready to play again.
        set({ playing: false, position: auto ? 0 : get().position, currentTime: 0 });
        if (auto) set((s) => ({ playId: s.playId + 1 }));
        return;
      }
      go(p);
    },
    prev() {
      go(prevPosition(qs(), get().currentTime));
    },
    toggleShuffle() {
      set(withShuffle(qs(), !get().shuffle));
    },
    cycleRepeat() {
      set((s) => ({ repeat: nextRepeat(s.repeat) }));
    },
    setVolume(v) {
      const volume = Math.max(0, Math.min(1, v));
      globalThis.localStorage?.setItem(VOLUME_KEY, String(volume));
      set({ volume, muted: volume === 0 ? get().muted : false });
    },
    toggleMute() {
      set((s) => ({ muted: !s.muted }));
    },
    reset() {
      set({ ...empty, playId: get().playId + 1 });
    },
    report(p) {
      set(p);
    },
  };
});

export function currentTrack(s: Pick<PlayerState, 'queue' | 'order' | 'position'>): QueueTrack | undefined {
  const i = currentIndex(s);
  return i === undefined ? undefined : s.queue[i];
}
