import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moveItem } from '@/lib/playlists';
import { usePlayer } from '@/player/store';
import { instances, lastHls } from '../../test/fake-hls';
import { cat, seedAlbum, seedPlaylist, seedTrack } from '../../test/mock-catalog';
import { renderApp } from '../../test/render';

vi.mock('hls.js', () => import('../../test/fake-hls'));

function setup() {
  const { album } = seedAlbum();
  const tracks = ['One', 'Two', 'Three'].map((t) => seedTrack(album.id, t, 'READY'));
  return { album, tracks };
}
const order = () =>
  within(screen.getByRole('list', { name: 'Playlist songs' }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('p')!.textContent);

async function openMenu(user: ReturnType<typeof renderApp>['user'], title: string) {
  await user.click(screen.getByRole('button', { name: `More options for ${title}` }));
  return screen.findByRole('menu');
}

beforeEach(() => {
  instances.length = 0;
});

describe('moveItem', () => {
  it('moves an item and clamps the target', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c'], 0, 99)).toEqual(['b', 'c', 'a']);
  });
});

describe('PlaylistPage', () => {
  it('shows the songs and plays the playlist', async () => {
    const { tracks } = setup();
    const p = seedPlaylist('u-ann', 'Road Trip', [tracks[2].id, tracks[0].id]);
    const { user } = renderApp(`/playlists/${p.id}`, { as: 'listener' });

    expect(await screen.findByRole('heading', { name: 'Road Trip' })).toBeInTheDocument();
    expect(order()).toEqual(['Three', 'One']);
    expect(screen.getByText('2 songs, 6:10')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Play Road Trip' }));
    await waitFor(() => expect(lastHls()?.source).toContain(tracks[2].id));
    expect(usePlayer.getState().queue.map((t) => t.title)).toEqual(['Three', 'One']);
  });

  it('reorders with Move up / Move down and saves the new order', async () => {
    const { tracks } = setup();
    const p = seedPlaylist('u-ann', 'Mix', tracks.map((t) => t.id));
    const { user } = renderApp(`/playlists/${p.id}`, { as: 'listener' });
    await screen.findByRole('heading', { name: 'Mix' });

    await user.click(within(await openMenu(user, 'Three')).getByRole('menuitem', { name: 'Move up' }));
    await waitFor(() => expect(order()).toEqual(['One', 'Three', 'Two']));
    expect(cat.playlists[0].items.map(([, t]) => t)).toEqual([tracks[0].id, tracks[2].id, tracks[1].id]);

    const menu = await openMenu(user, 'One');
    expect(within(menu).getByRole('menuitem', { name: 'Move up' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(within(menu).getByRole('menuitem', { name: 'Move down' }));
    await waitFor(() => expect(order()).toEqual(['Three', 'One', 'Two']));
  });

  it('undoes a reorder the server refuses', async () => {
    const { tracks } = setup();
    const p = seedPlaylist('u-ann', 'Mix', tracks.map((t) => t.id));
    cat.failPlaylistWrites = true;
    const { user } = renderApp(`/playlists/${p.id}`, { as: 'listener' });
    await screen.findByRole('heading', { name: 'Mix' });

    await user.click(within(await openMenu(user, 'Two')).getByRole('menuitem', { name: 'Move down' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('undone');
    expect(order()).toEqual(['One', 'Two', 'Three']);
  });

  it('removes a song, renames and deletes the playlist', async () => {
    const { tracks } = setup();
    const p = seedPlaylist('u-ann', 'Mix', [tracks[0].id, tracks[1].id]);
    const { user } = renderApp(`/playlists/${p.id}`, { as: 'listener' });
    await screen.findByRole('heading', { name: 'Mix' });

    await user.click(within(await openMenu(user, 'One')).getByRole('menuitem', { name: 'Remove from this playlist' }));
    await waitFor(() => expect(order()).toEqual(['Two']));

    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit details' });
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'Evening');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: 'Evening' })).toBeInTheDocument();
    // The sidebar follows.
    expect(within(screen.getByRole('navigation', { name: 'Your playlists' })).getByText('Evening')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete playlist' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await screen.findByRole('heading', { name: /, Ann$/ });
    expect(cat.playlists).toEqual([]);
  });

  it('other people’s playlists look like missing ones', async () => {
    const { tracks } = setup();
    const p = seedPlaylist('u-admin', 'Secret', [tracks[0].id]);
    renderApp(`/playlists/${p.id}`, { as: 'listener' });
    expect(await screen.findByText('This playlist doesn’t exist.')).toBeInTheDocument();
  });
});

describe('Adding to playlists', () => {
  it('adds a song from an album page through the ⋯ menu', async () => {
    const { album, tracks } = setup();
    seedPlaylist('u-ann', 'Road Trip', []);
    const { user } = renderApp(`/albums/${album.id}`, { as: 'listener' });
    await screen.findByRole('heading', { name: 'Pastel Blues' });

    await user.click(within(await openMenu(user, 'Two')).getByRole('menuitem', { name: 'Add to playlist' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add to playlist' });
    await user.click(within(dialog).getByRole('button', { name: /Road Trip/ }));

    expect(await screen.findByRole('status')).toHaveTextContent('Added to Road Trip');
    expect(cat.playlists[0].items.map(([, t]) => t)).toEqual([tracks[1].id]);
    await waitFor(() =>
      expect(within(screen.getByRole('navigation', { name: 'Your playlists' })).getByText('1 song')).toBeInTheDocument(),
    );
  });

  it('creates a new playlist from the dialog and adds the song to it', async () => {
    const { album, tracks } = setup();
    const { user } = renderApp(`/albums/${album.id}`, { as: 'listener' });
    await screen.findByRole('heading', { name: 'Pastel Blues' });

    await user.click(within(await openMenu(user, 'One')).getByRole('menuitem', { name: 'Add to playlist' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'New playlist' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Added to My Playlist #1');
    expect(cat.playlists).toMatchObject([{ name: 'My Playlist #1', items: [[expect.any(String), tracks[0].id]] }]);
  });

  it('the sidebar + button creates a playlist and opens it', async () => {
    const { user } = renderApp('/', { as: 'listener' });
    await screen.findByText('Create your first playlist with +');
    await user.click(screen.getByRole('button', { name: 'New playlist' }));
    expect(await screen.findByRole('heading', { name: 'My Playlist #1' })).toBeInTheDocument();
    expect(screen.getByText(/This playlist is empty/)).toBeInTheDocument();
  });
});
