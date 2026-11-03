import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getEngine } from '@/player/engine';
import { ListenCounter, playThreshold } from '@/player/history';
import { usePlayer } from '@/player/store';
import { instances, lastHls } from '../../test/fake-hls';
import { cat, seedAlbum, seedTrack } from '../../test/mock-catalog';
import { renderApp } from '../../test/render';

vi.mock('hls.js', () => import('../../test/fake-hls'));

function setup() {
  const { album, artist } = seedAlbum(); // "Pastel Blues" by Nina Simone
  const tracks = [
    seedTrack(album.id, 'Feeling Good', 'READY'),
    seedTrack(album.id, 'Sinnerman', 'READY'),
    seedTrack(album.id, 'Blue Prelude', 'READY'),
  ];
  return { album, artist, tracks };
}

beforeEach(() => {
  instances.length = 0;
});

describe('search', () => {
  it('waits for the user to stop typing, then shows songs, artists and albums', async () => {
    setup();
    const { user } = renderApp('/search', { as: 'listener' });
    await user.type(await screen.findByRole('searchbox', { name: 'Search' }), 'nina');

    const songs = await screen.findByRole('list', { name: 'Songs' });
    expect(within(songs).getAllByRole('listitem')).toHaveLength(3);
    expect(within(screen.getByRole('list', { name: 'Artists' })).getByText('Nina Simone')).toBeInTheDocument();
    expect(cat.calls.search).toEqual(['nina']); // one request, not one per keystroke
  });

  it('keeps the query in the URL, so a shared link shows results', async () => {
    setup();
    renderApp('/search?q=blue', { as: 'listener' });
    expect(await screen.findByRole('searchbox')).toHaveValue('blue');
    const songs = await screen.findByRole('list', { name: 'Songs' });
    expect(within(songs).getByText('Blue Prelude')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Albums' })).getByText('Pastel Blues')).toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    setup();
    renderApp('/search?q=zzz', { as: 'listener' });
    expect(await screen.findByText(/No results for “zzz”/)).toBeInTheDocument();
  });

  it('plays a song from the results', async () => {
    const { tracks } = setup();
    const { user } = renderApp('/search?q=sinner', { as: 'listener' });
    await user.click(await screen.findByRole('button', { name: 'Play Sinnerman' }));
    await waitFor(() => expect(lastHls()?.source).toContain(tracks[1].id));
    expect(usePlayer.getState().queue.map((t) => t.title)).toEqual(['Sinnerman']);
  });
});

describe('liked songs', () => {
  it('likes a song from the album page and lists it on Liked Songs', async () => {
    const { album, tracks } = setup();
    const { user } = renderApp(`/albums/${album.id}`, { as: 'listener' });

    const like = await screen.findByRole('button', { name: 'Like Sinnerman' });
    expect(like).toHaveAttribute('aria-pressed', 'false');
    await user.click(like);
    expect(await screen.findByRole('button', { name: 'Remove Sinnerman from Liked Songs' })).toHaveAttribute('aria-pressed', 'true');
    expect(cat.likes.get('u-ann')).toEqual([tracks[1].id]);

    await user.click(screen.getByRole('link', { name: 'Liked Songs' }));
    const list = await screen.findByRole('list', { name: 'Liked Songs' });
    expect(within(list).getByText('Sinnerman')).toBeInTheDocument();
    expect(screen.getByText('1 song, 3:05')).toBeInTheDocument();

    await user.click(within(list).getByRole('button', { name: 'Remove Sinnerman from Liked Songs' }));
    expect(await screen.findByText(/Songs you like appear here/)).toBeInTheDocument();
    expect(cat.likes.get('u-ann')).toEqual([]);
  });

  it('the heart in the player bar follows the playing song', async () => {
    const { album } = setup();
    const { user } = renderApp(`/albums/${album.id}`, { as: 'listener' });
    await user.click(await screen.findByRole('button', { name: 'Play Feeling Good' }));
    const bar = within(await screen.findByRole('contentinfo', { name: 'Player' }));
    await user.click(bar.getByRole('button', { name: 'Like Feeling Good' }));
    // Every heart for that song updates together.
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Remove Feeling Good from Liked Songs' })).toHaveLength(2));
  });

  it('puts the heart back if the server refuses', async () => {
    const { album } = setup();
    cat.failLikes = true;
    const { user } = renderApp(`/albums/${album.id}`, { as: 'listener' });
    await user.click(await screen.findByRole('button', { name: 'Like Sinnerman' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Like Sinnerman' })).toHaveAttribute('aria-pressed', 'false'));
  });
});

describe('play history', () => {
  it('counts listening time, not position, and only once per play', () => {
    const c = new ListenCounter();
    let reported = 0;
    for (let t = 0; t <= 29; t += 0.25) reported += Number(c.tick(t, 200));
    expect(reported).toBe(0);
    for (let t = 29.25; t <= 40; t += 0.25) reported += Number(c.tick(t, 200));
    expect(reported).toBe(1);

    // A seek straight to the end doesn't count as listening.
    const seeker = new ListenCounter();
    expect(seeker.tick(0, 200)).toBe(false);
    expect(seeker.tick(150, 200)).toBe(false);
    expect(seeker.tick(150.25, 200)).toBe(false);
  });

  it('uses half the length for songs shorter than a minute', () => {
    expect(playThreshold(200)).toBe(30);
    expect(playThreshold(20)).toBe(10);
    expect(playThreshold(NaN)).toBe(30);
  });

  it('reports a play after 30 s of listening and shows it in Recently played', async () => {
    const { album, tracks } = setup();
    const { user } = renderApp(`/albums/${album.id}`, { as: 'listener' });
    await user.click(await screen.findByRole('button', { name: 'Play Sinnerman' }));
    await waitFor(() => expect(lastHls()?.source).toContain(tracks[1].id));

    const audio = getEngine().audio;
    const at = (t: number) => {
      audio.currentTime = t;
      act(() => void audio.dispatchEvent(new Event('timeupdate')));
    };
    for (let t = 0; t <= 29; t += 0.5) at(t);
    expect(cat.calls.plays).toEqual([]);
    for (let t = 29.5; t <= 45; t += 0.5) at(t);
    await waitFor(() => expect(cat.calls.plays).toEqual([tracks[1].id]));

    await user.click(screen.getByRole('link', { name: 'Home' }));
    const recent = await screen.findByRole('list', { name: 'Recently played' });
    expect(within(recent).getByRole('button', { name: 'Pause Sinnerman' })).toBeInTheDocument();
  });

  it('does not count a play while paused', async () => {
    const { album } = setup();
    const { user } = renderApp(`/albums/${album.id}`, { as: 'listener' });
    await user.click(await screen.findByRole('button', { name: 'Play Feeling Good' }));
    await waitFor(() => expect(lastHls()?.source).toBeDefined());
    await user.click(within(screen.getByRole('contentinfo', { name: 'Player' })).getByRole('button', { name: 'Pause' }));

    const audio = getEngine().audio;
    for (let t = 0; t <= 40; t += 0.5) {
      audio.currentTime = t;
      act(() => void audio.dispatchEvent(new Event('timeupdate')));
    }
    expect(cat.calls.plays).toEqual([]);
  });

  it('Home shows recently played songs and plays them', async () => {
    const { tracks } = setup();
    cat.history.set('u-ann', [
      [tracks[0].id, 1],
      [tracks[2].id, 2],
    ]);
    const { user } = renderApp('/', { as: 'listener' });
    const recent = await screen.findByRole('list', { name: 'Recently played' });
    expect(within(recent).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Play Blue Prelude',
      'Play Feeling Good',
    ]);
    await user.click(within(recent).getByRole('button', { name: 'Play Feeling Good' }));
    await waitFor(() => expect(lastHls()?.source).toContain(tracks[0].id));
  });
});
