import type Hls from 'hls.js';
import type { ErrorData } from 'hls.js';
import { ApiError } from '@/lib/api';
import { catalogApi } from '@/lib/catalog';
import { currentTrack, usePlayer, type PlayerState, type QueueTrack } from './store';

/** Fetch a new stream URL if the current one expires within this window. */
const REFRESH_MARGIN_MS = 60_000;

const absolute = (path: string) => new URL(path, window.location.origin).href;

type HlsModule = typeof import('hls.js');
let hlsModule: Promise<HlsModule> | null = null;
/** hls.js is ~500 KB, so it's fetched when the first track plays, not with the page. */
function loadHls(): Promise<HlsModule> {
  hlsModule ??= import('hls.js');
  return hlsModule;
}

/**
 * Drives one <audio> element from the player store: loads signed HLS URLs with hls.js (or
 * natively in Safari), follows play/pause/volume, reports time back, advances on "ended",
 * and wires up the Media Session (OS media keys, lock screen, artwork).
 */
export class PlaybackEngine {
  readonly audio: HTMLAudioElement;
  private hls: Hls | null = null;
  private trackId: string | null = null;
  private playId = -1;
  private expiresAt = 0;
  private loadSeq = 0;
  private refreshedAfterError = false;
  private lastPositionReport = 0;
  private errorTypes: HlsModule['ErrorTypes'] | null = null;
  private unsubscribe: () => void;

  constructor(audio: HTMLAudioElement = new Audio()) {
    this.audio = audio;
    audio.preload = 'auto';
    const report = usePlayer.getState().report;

    audio.addEventListener('timeupdate', () => {
      report({ currentTime: audio.currentTime });
      this.updatePositionState();
    });
    audio.addEventListener('durationchange', () => {
      if (Number.isFinite(audio.duration)) report({ duration: audio.duration });
    });
    audio.addEventListener('waiting', () => report({ buffering: true }));
    audio.addEventListener('playing', () => {
      this.refreshedAfterError = false;
      report({ buffering: false, playing: true, error: null });
    });
    // Paused by the browser or OS (headphones unplugged, another app took audio focus).
    audio.addEventListener('pause', () => {
      if (!audio.ended && usePlayer.getState().playing) report({ playing: false });
    });
    audio.addEventListener('ended', () => usePlayer.getState().next(true));
    audio.addEventListener('error', () => {
      if (!this.hls) report({ error: 'This track could not be played.', playing: false, buffering: false });
    });

    this.setupMediaSession();
    this.unsubscribe = usePlayer.subscribe((s, prev) => this.sync(s, prev));
    this.sync(usePlayer.getState(), undefined);
  }

  destroy(): void {
    this.unsubscribe();
    this.teardown();
    this.audio.removeAttribute('src');
    this.audio.load();
  }

  seek(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    this.audio.currentTime = Math.max(0, seconds);
    usePlayer.getState().report({ currentTime: this.audio.currentTime });
  }

  // ---- store -> audio ----

  private sync(s: PlayerState, prev: PlayerState | undefined): void {
    this.audio.volume = s.volume;
    this.audio.muted = s.muted;

    const track = currentTrack(s);
    if (!track) {
      if (this.trackId) this.stop();
      return;
    }
    if (track.id !== this.trackId) {
      this.playId = s.playId;
      void this.load(track, s.playing, 0);
      return;
    }
    if (s.playId !== this.playId) {
      this.playId = s.playId;
      this.seek(0);
      if (s.playing) void this.play();
      else this.audio.pause();
      return;
    }
    if (prev && s.playing !== prev.playing) {
      if (s.playing) void this.play();
      else this.audio.pause();
    }
  }

  private async play(): Promise<void> {
    if (!this.trackId) return;
    // Paused for hours? The signed URL may have expired: reload at the same spot.
    if (Date.now() > this.expiresAt - REFRESH_MARGIN_MS) {
      const track = currentTrack(usePlayer.getState());
      if (track) return this.load(track, true, this.audio.currentTime);
    }
    try {
      await this.audio.play();
    } catch (e) {
      this.handlePlayError(e);
    }
  }

  private async load(track: QueueTrack, autoplay: boolean, startAt: number): Promise<void> {
    const seq = ++this.loadSeq;
    const report = usePlayer.getState().report;
    this.trackId = track.id;
    this.teardown();
    this.updateMetadata(track);
    report({ buffering: true, error: null, currentTime: startAt, duration: (track.durationMs ?? 0) / 1000 });

    let url: string;
    try {
      const res = await catalogApi.streamUrl(track.id);
      url = absolute(res.url);
      this.expiresAt = new Date(res.expiresAt).getTime();
    } catch (e) {
      if (seq !== this.loadSeq) return;
      const msg = e instanceof ApiError && e.status === 404 ? 'This track is no longer available.' : 'Could not load this track.';
      report({ error: msg, playing: false, buffering: false });
      return;
    }
    if (seq !== this.loadSeq) return; // the user picked another track meanwhile

    let mod: HlsModule | null = null;
    try {
      mod = await loadHls();
    } catch {
      hlsModule = null; // e.g. a new deploy replaced the chunk; native HLS may still work
    }
    if (seq !== this.loadSeq) return;

    if (mod?.default.isSupported()) {
      const hls = new mod.default({ startPosition: startAt > 0 ? startAt : -1, enableWorker: true });
      this.errorTypes = mod.ErrorTypes;
      hls.on(mod.Events.ERROR, (_e, data) => this.onHlsError(hls, data));
      hls.loadSource(url);
      hls.attachMedia(this.audio);
      this.hls = hls;
    } else if (this.audio.canPlayType('application/vnd.apple.mpegurl')) {
      this.audio.src = url;
      if (startAt > 0) {
        this.audio.addEventListener('loadedmetadata', () => (this.audio.currentTime = startAt), { once: true });
      }
    } else {
      report({ error: 'This browser can’t play the stream. Try Chrome, Edge, Firefox or Safari.', playing: false, buffering: false });
      return;
    }

    if (autoplay && usePlayer.getState().playing) {
      try {
        await this.audio.play();
      } catch (e) {
        if (seq === this.loadSeq) this.handlePlayError(e);
      }
    } else {
      report({ buffering: false });
    }
  }

  private onHlsError(hls: Hls, data: ErrorData): void {
    if (hls !== this.hls || !data.fatal) return;
    const status = data.response?.code;
    const track = currentTrack(usePlayer.getState());
    if ((status === 403 || status === 401) && track && !this.refreshedAfterError) {
      // The signed URL expired or was revoked: get a fresh one once and continue where we were.
      this.refreshedAfterError = true;
      // Reset only once audio plays again (see 'playing'), so a persistent 403 can't loop.
      void this.load(track, usePlayer.getState().playing, this.audio.currentTime);
      return;
    }
    if (data.type === this.errorTypes?.MEDIA_ERROR) {
      hls.recoverMediaError();
      return;
    }
    usePlayer.getState().report({ error: 'Playback stopped: the stream could not be loaded.', playing: false, buffering: false });
    this.teardown();
    this.trackId = null;
  }

  private handlePlayError(e: unknown): void {
    // NotAllowedError: the browser blocked autoplay. AbortError: a newer load replaced this one.
    if (e instanceof DOMException && e.name === 'AbortError') return;
    usePlayer.getState().report({ playing: false, buffering: false });
  }

  private stop(): void {
    this.loadSeq++;
    this.teardown();
    this.trackId = null;
    this.audio.pause();
    this.audio.removeAttribute('src');
    if (typeof navigator !== 'undefined' && navigator.mediaSession) navigator.mediaSession.metadata = null;
  }

  private teardown(): void {
    this.hls?.destroy();
    this.hls = null;
  }

  // ---- Media Session ----

  private setupMediaSession(): void {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!ms) return;
    const p = () => usePlayer.getState();
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => p().setPlaying(true)],
      ['pause', () => p().setPlaying(false)],
      ['previoustrack', () => p().prev()],
      ['nexttrack', () => p().next()],
      ['seekto', (d) => d.seekTime !== undefined && this.seek(d.seekTime)],
      ['seekbackward', (d) => this.seek(this.audio.currentTime - (d.seekOffset ?? 10))],
      ['seekforward', (d) => this.seek(this.audio.currentTime + (d.seekOffset ?? 10))],
    ];
    for (const [action, handler] of handlers) {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* action not supported by this browser */
      }
    }
  }

  private updateMetadata(track: QueueTrack): void {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!ms || typeof MediaMetadata === 'undefined') return;
    const cover = track.album.cover;
    ms.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist.name,
      album: track.album.title,
      artwork: cover
        ? [
            { src: absolute(cover.small), sizes: '300x300', type: 'image/webp' },
            { src: absolute(cover.large), sizes: '600x600', type: 'image/webp' },
          ]
        : [],
    });
  }

  private updatePositionState(): void {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    const now = Date.now();
    if (!ms?.setPositionState || now - this.lastPositionReport < 1000) return;
    this.lastPositionReport = now;
    const { duration, currentTime, playbackRate } = this.audio;
    if (!Number.isFinite(duration) || duration <= 0) return;
    try {
      ms.setPositionState({ duration, position: Math.min(currentTime, duration), playbackRate });
    } catch {
      /* ignore invalid states during loading */
    }
  }
}

let engine: PlaybackEngine | null = null;

/** The one engine for the page, created on first use. */
export function getEngine(): PlaybackEngine {
  engine ??= new PlaybackEngine();
  return engine;
}

/** Stop playback and forget the engine (logout, tests). */
export function destroyEngine(): void {
  engine?.destroy();
  engine = null;
}
