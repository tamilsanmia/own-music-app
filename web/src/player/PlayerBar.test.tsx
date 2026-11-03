import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cat, seedAlbum, seedTrack } from '../../test/mock-catalog';
import { renderApp } from '../../test/render';
import { getEngine } from './engine';
import { usePlayer } from './store';

// A stand-in for hls.js that records what the engine asks of it.
const hlsMock = vi.hoisted(() => {
  const instances: FakeHls[] = [];
  class FakeHls {
    static isSupported = () => true;
    config: Record<string, unknown>;
    source?: string;
    media?: HTMLMediaElement;
    destroyed = false;
    handlers = new Map<string, (event: string, data: unknown) => void>();
    recoverMediaError = vi.fn();
    constructor(config: Record<string, unknown> = {}) {
      this.config = config;
      instances.push(this);
    }
    on(event: string, fn: (event: string, data: unknown) => void) {
      this.handlers.set(event, fn);
    }
    loadSource(url: string) {
      this.source = url;
    }
    attachMedia(media: HTMLMediaElement) {
      this.media = media;
    }
    destroy() {
      this.destroyed = true;
    }
    emit(event: string, data: unknown) {
      this.handlers.get(event)?.(event, data);
    }
  }
  return { FakeHls, instances };
});

vi.mock('hls.js', () => ({
  default: hlsMock.FakeHls,
  Events: { ERROR: 'hlsError' },
  ErrorTypes: { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' },
}));

const lastHls = () => hlsMock.instances[hlsMock.instances.length - 1];
const audio = () => getEngine().audio;
const fire = (type: string) => act(() => void audio().dispatchEvent(new Event(type)));
const nowPlaying = () => screen.getByRole('link', { name: /^Now playing: / }).textContent;
const player = () => within(screen.getByRole('contentinfo', { name: 'Player' }));

function setup() {
  const { album } = seedAlbum();
  const tracks = ['Intro', 'Second', 'Third'].map((t) => seedTrack(album.id, t, 'READY'));
  // A track still converting must not appear for listeners.
  seedTrack(album.id, 'Not Ready', 'PROCESSING');
  return { album, tracks };
}

describe('web player', () => {
  beforeEach(() => {
    hlsMock.instances.length = 0;
  });

  it('plays an album from the clicked track through a signed HLS URL', async () => {
    const { album, tracks } = setup();
    const { user } = renderApp(`/albums/${album.id}`, { as: 'listener' });

    expect(await screen.findByRole('heading', { name: 'Pastel Blues' })).toBeInTheDocument();
    expect(screen.queryByText('Not Ready')).not.toBeInTheDocument();
    expect(screen.getByText(/3 songs, 9:15/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Play Second' }));

    await waitFor(() => expect(lastHls()?.source).toBe(`http://localhost:3000/stream/tok1/${tracks[1].id}/master.m3u8`));
    expect(lastHls().media).toBe(audio());
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    expect(nowPlaying()).toBe('Second');
    expect(player().getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(cat.calls.streamUrl).toEqual([tracks[1].id]);
    expect(navigator.mediaSession.metadata).toMatchObject({ title: 'Second', artist: 'Nina Simone', album: 'Pastel Blues' });
  });

  it('skips with next and previous, and previous restarts after 3 seconds', async () => {
    const { album, tracks } = setup();
    const { user } = renderApp(`/albums/${album.id}`, { as: 'listener' });
    await user.click(await screen.findByRole('button', { name: 'Play album' }));
    await waitFor(() => expect(nowPlaying()).toBe('Intro'));

    await user.click(player().getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(lastHls().source).toContain(tracks[1].id));
    expect(hlsMock.instances[0].destroyed).toBe(true);

    // 10 s in: "previous" restarts the same track without fetching a new URL.
    audio().currentTime = 10;
    fire('timeupdate');
    await user.click(player().getByRole('button', { name: 'Previous' }));
    expect(audio().currentTime).toBe(0);
    expect(cat.calls.streamUrl).toHaveLength(2);

    // At the start: "previous" goes back a track.
    await user.click(player().getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(nowPlaying()).toBe('Intro'));
    expect(cat.calls.streamUrl).toEqual([tracks[0].id, tracks[1].id, tracks[0].id]);
  });

  it('advances when a track ends and stops after the last one', async () => {
    const { album, tracks } = setup();
    const { user } = renderApp(`/albums/${album.id}`, { as: 'listener' });
    await user.click(await screen.findByRole('button', { name: 'Play Third' }));
    await waitFor(() => expect(lastHls()?.source).toContain(tracks[2].id));

    fire('ended');
    await waitFor(() => expect(player().getByRole('button', { name: 'Play' })).toBeInTheDocument());
    // Rewound to the first track, ready to play again, but not playing.
    await waitFor(() => expect(nowPlaying()).toBe('Intro'));
    expect(usePlayer.getState().playing).toBe(false);
  });

  it('repeat all wraps to the start; repeat one replays the same track', async () => {
    const { album, tracks } = setup();
    const { user } = renderApp(`/albums/${album.id}`, { as: 'listener' });
    await user.click(await screen.findByRole('button', { name: 'Play Third' }));
    await waitFor(() => expect(lastHls()?.source).toContain(tracks[2].id));

    await user.click(player().getByRole('button', { name: 'Repeat' }));
    expect(player().getByRole('button', { name: 'Repeat all' })).toHaveAttribute('aria-pressed', 'true');
    fire('ended');
    await waitFor(() => expect(lastHls().source).toContain(tracks[0].id));
    expect(usePlayer.getState().playing).toBe(true);

    await user.click(player().getByRole('button', { name: 'Repeat all' }));
    expect(player().getByRole('button', { name: 'Repeat one' })).toBeInTheDocument();
    const fetched = cat.calls.streamUrl.length;
    audio().currentTime = 200;
    fire('ended');
    expect(audio().currentTime).toBe(0);
    expect(nowPlaying()).toBe('Intro');
    expect(cat.calls.streamUrl).toHaveLength(fetched);
  });

  it('shuffle keeps the current track and plays the rest in a new order', async () => {
    const { album } = setup();
    const { user } = renderApp(`/albums/${album.id}`, { as: 'listener' });
    await user.click(await screen.findByRole('button', { name: 'Play Second' }));
    await waitFor(() => expect(nowPlaying()).toBe('Second'));

    await user.click(player().getByRole('button', { name: 'Shuffle' }));
    expect(player().getByRole('button', { name: 'Shuffle' })).toHaveAttribute('aria-pressed', 'true');
    expect(nowPlaying()).toBe('Second');
    const s = usePlayer.getState();
    expect(s.order[0]).toBe(1);
    expect([...s.order].sort()).toEqual([0, 1, 2]);
  });

  it('pauses and resumes from the track list, the album button and the player bar', async () => {
    const { album } = setup();
    const { user } = renderApp(`/albums/${album.id}`, { as: 'listener' });
    await user.click(await screen.findByRole('button', { name: 'Play album' }));
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Pause album' }));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Play album' })).toBeInTheDocument();

    await user.click(player().getByRole('button', { name: 'Play' }));
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'Pause Intro' }));
    expect(usePlayer.getState().playing).toBe(false);
    expect(cat.calls.streamUrl).toHaveLength(1); // pausing never reloads
  });

  it('gets a fresh URL and continues at the same spot when the stream link is refused', async () => {
    const { album, tracks } = setup();
    const { user } = renderApp(`/albums/${album.id}`, { as: 'listener' });
    await user.click(await screen.findByRole('button', { name: 'Play Intro' }));
    await waitFor(() => expect(lastHls()?.source).toContain('tok1'));

    audio().currentTime = 42;
    act(() => lastHls().emit('hlsError', { fatal: true, type: 'networkError', response: { code: 403 } }));

    await waitFor(() => expect(lastHls().source).toBe(`http://localhost:3000/stream/tok2/${tracks[0].id}/master.m3u8`));
    expect(lastHls().config.startPosition).toBe(42);
    expect(hlsMock.instances[0].destroyed).toBe(true);
  });

  it('reloads with a fresh URL when resuming after the old one expired', async () => {
    cat.streamTtlMs = 30_000; // shorter than the 60 s refresh margin
    const { album } = setup();
    const { user } = renderApp(`/albums/${album.id}`, { as: 'listener' });
    await user.click(await screen.findByRole('button', { name: 'Play Intro' }));
    await waitFor(() => expect(lastHls()?.source).toContain('tok1'));

    await user.click(player().getByRole('button', { name: 'Pause' }));
    audio().currentTime = 61;
    await user.click(player().getByRole('button', { name: 'Play' }));
    await waitFor(() => expect(lastHls().source).toContain('tok2'));
    expect(lastHls().config.startPosition).toBe(61);
  });

  it('shows an error instead of playing when the stream cannot load', async () => {
    const { album } = setup();
    const { user } = renderApp(`/albums/${album.id}`, { as: 'listener' });
    await user.click(await screen.findByRole('button', { name: 'Play Intro' }));
    await waitFor(() => expect(lastHls()?.source).toBeDefined());

    act(() => lastHls().emit('hlsError', { fatal: true, type: 'networkError', response: { code: 500 } }));
    expect(await player().findByRole('alert')).toHaveTextContent('could not be loaded');
    expect(usePlayer.getState().playing).toBe(false);
  });

  it('changes and remembers the volume, and media keys control playback', async () => {
    const { album, tracks } = setup();
    const { user } = renderApp(`/albums/${album.id}`, { as: 'listener' });
    await user.click(await screen.findByRole('button', { name: 'Play Intro' }));
    await waitFor(() => expect(nowPlaying()).toBe('Intro'));

    act(() => usePlayer.getState().setVolume(0.25));
    expect(audio().volume).toBe(0.25);
    expect(localStorage.getItem('music.volume')).toBe('0.25');
    await user.click(player().getByRole('button', { name: 'Mute' }));
    expect(audio().muted).toBe(true);

    const handlers = (navigator.mediaSession as unknown as { handlers: Map<string, (d: object) => void> }).handlers;
    act(() => handlers.get('nexttrack')!({}));
    await waitFor(() => expect(lastHls().source).toContain(tracks[1].id));
    act(() => handlers.get('pause')!({}));
    expect(usePlayer.getState().playing).toBe(false);
    act(() => handlers.get('seekto')!({ seekTime: 30 }));
    expect(audio().currentTime).toBe(30);
  });

  it('stops playback and clears the queue on logout', async () => {
    const { album } = setup();
    const { user } = renderApp(`/albums/${album.id}`, { as: 'listener' });
    await user.click(await screen.findByRole('button', { name: 'Play Intro' }));
    await waitFor(() => expect(lastHls()?.source).toBeDefined());

    await user.click(screen.getByRole('button', { name: 'Log out' }));
    await screen.findByRole('heading', { name: 'Log in to Music' });
    expect(lastHls().destroyed).toBe(true);
    expect(usePlayer.getState().queue).toEqual([]);
  });
});

describe('browsing', () => {
  it('home lists new albums and links to album and artist pages', async () => {
    const { album } = setup();
    const { user } = renderApp('/', { as: 'listener' });
    const grid = await screen.findByRole('list', { name: 'New albums' });
    await user.click(within(grid).getByRole('link', { name: 'Pastel Blues' }));
    await user.click(await screen.findByRole('link', { name: 'Nina Simone' }));
    expect(await screen.findByRole('heading', { name: 'Nina Simone' })).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Albums' })).getByText('1965')).toBeInTheDocument();
    expect(album.id).toBeTruthy();
  });

  it('home explains an empty library', async () => {
    renderApp('/', { as: 'listener' });
    expect(await screen.findByText(/library is empty/)).toBeInTheDocument();
    expect(screen.queryByRole('contentinfo', { name: 'Player' })).not.toBeInTheDocument();
  });
});
