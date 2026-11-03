import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { adminConfig } from '@/admin/config';
import { server } from '../../../test/mock-api';
import { cat, seedAlbum, seedTrack } from '../../../test/mock-catalog';
import { renderApp } from '../../../test/render';

const audio = (name: string, bytes: number) => new File([new Uint8Array(bytes)], name, { type: 'audio/mpeg' });
const statusOf = (title: string) => screen.getByLabelText(`Status of ${title}`);

/** A promise the test resolves by hand, to hold a request open. */
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((r) => (open = r));
  return { promise, open };
}

describe('AlbumPage uploads', () => {
  it('uploads several files in chunks, one after another, and lists them as queued', async () => {
    const { album } = seedAlbum();
    const { user } = renderApp(`/admin/albums/${album.id}`, { as: 'admin' });
    await screen.findByRole('heading', { name: 'Tracks' });

    await user.upload(screen.getByLabelText('Choose audio files'), [audio('01 Intro.mp3', 10), audio('02 Song.flac', 6)]);

    await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3));
    expect(cat.calls.chunks).toEqual([
      { name: '01 Intro.mp3', offset: 0, size: 4 },
      { name: '01 Intro.mp3', offset: 4, size: 4 },
      { name: '01 Intro.mp3', offset: 8, size: 2 },
      { name: '02 Song.flac', offset: 0, size: 4 },
      { name: '02 Song.flac', offset: 4, size: 2 },
    ]);
    await waitFor(() => expect(within(statusOf('01 Intro')).getByText('Queued')).toBeInTheDocument());
    expect(within(statusOf('02 Song')).getByText('Queued')).toBeInTheDocument();
    expect(within(screen.getByRole('listitem', { name: 'Upload 01 Intro.mp3' })).getByText(/now converting/)).toBeInTheDocument();
  });

  it('shows per-file progress while chunks are in flight', async () => {
    const { album } = seedAlbum();
    const second = gate();
    let puts = 0;
    server.use(
      http.put('*/api/admin/tracks/:id/upload', async () => {
        if (++puts === 2) await second.promise; // hold the second chunk of the first file
        return undefined; // fall through to the default handler
      }),
    );
    const { user } = renderApp(`/admin/albums/${album.id}`, { as: 'admin' });
    await screen.findByRole('heading', { name: 'Tracks' });
    await user.upload(screen.getByLabelText('Choose audio files'), [audio('a.mp3', 10), audio('b.mp3', 6)]);

    const a = await screen.findByRole('progressbar', { name: 'a.mp3 progress' });
    await waitFor(() => expect(a).toHaveAttribute('aria-valuenow', '40'));
    expect(screen.getByRole('progressbar', { name: 'b.mp3 progress' })).toHaveAttribute('aria-valuenow', '0');
    expect(within(screen.getByRole('listitem', { name: 'Upload b.mp3' })).getByText('Waiting')).toBeInTheDocument();
    expect(screen.getByText('Uploading 2 files…')).toBeInTheDocument();

    second.open();
    await waitFor(() => expect(screen.queryAllByRole('progressbar')).toHaveLength(0));
    expect(screen.queryByText(/Uploading \d files/)).not.toBeInTheDocument();
  });

  it('resumes from the server’s byte count after an offset conflict', async () => {
    const { album } = seedAlbum();
    let first = true;
    server.use(
      http.put('*/api/admin/tracks/:id/upload', ({ params }) => {
        if (!first) return undefined;
        first = false;
        // The server already had the first 4 bytes (e.g. a response was lost).
        cat.tracks.find((t) => t.id === params.id)!.received = 4;
        return HttpResponse.json({ message: 'Offset does not match', receivedBytes: 4 }, { status: 409 });
      }),
    );
    const { user } = renderApp(`/admin/albums/${album.id}`, { as: 'admin' });
    await screen.findByRole('heading', { name: 'Tracks' });
    await user.upload(screen.getByLabelText('Choose audio files'), [audio('c.mp3', 10)]);

    await waitFor(() => expect(within(statusOf('c')).getByText('Queued')).toBeInTheDocument());
    expect(cat.calls.chunks.map((c) => c.offset)).toEqual([4, 8]);
  });

  it('shows why a non-audio file was rejected, without offering a retry', async () => {
    const { album } = seedAlbum();
    server.use(
      http.post('*/api/admin/tracks/:id/upload/complete', ({ params }) => {
        cat.tracks = cat.tracks.filter((t) => t.id !== params.id);
        return HttpResponse.json(
          { message: 'Not a playable audio file (the file has no audio stream). The upload was discarded.' },
          { status: 400 },
        );
      }),
    );
    const { user } = renderApp(`/admin/albums/${album.id}`, { as: 'admin' });
    await screen.findByRole('heading', { name: 'Tracks' });
    await user.upload(screen.getByLabelText('Choose audio files'), [audio('notes.mp3', 5)]);

    const row = await screen.findByRole('listitem', { name: 'Upload notes.mp3' });
    expect(await within(row).findByText(/no audio stream/)).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.getByText(/No tracks yet/)).toBeInTheDocument();
  });

  it('retries a failed chunk upload from where it stopped', async () => {
    const { album } = seedAlbum();
    let failures = 0;
    server.use(
      http.put('*/api/admin/tracks/:id/upload', ({ request }) => {
        // Fail every attempt at offset 4 until the user retries.
        if (new URL(request.url).searchParams.get('offset') === '4' && failures < 4) {
          failures++;
          return HttpResponse.json({ message: 'Bad gateway' }, { status: 502 });
        }
        return undefined;
      }),
    );
    const { user } = renderApp(`/admin/albums/${album.id}`, { as: 'admin' });
    await screen.findByRole('heading', { name: 'Tracks' });
    await user.upload(screen.getByLabelText('Choose audio files'), [audio('d.mp3', 10)]);

    const row = await screen.findByRole('listitem', { name: 'Upload d.mp3' });
    await within(row).findByText('Bad gateway');
    expect(failures).toBe(4); // first try + 3 automatic retries
    await user.click(within(row).getByRole('button', { name: 'Retry upload of d.mp3' }));

    await waitFor(() => expect(within(statusOf('d')).getByText('Queued')).toBeInTheDocument());
    expect(cat.calls.chunks.map((c) => c.offset)).toEqual([0, 4, 8]);
    expect(cat.tracks).toHaveLength(1); // resumed the same track, not a new one
  });
});

describe('AlbumPage track list', () => {
  it('polls while tracks are processing and stops once they are ready', async () => {
    adminConfig.pollMs = 30;
    const { album } = seedAlbum();
    const track = seedTrack(album.id, 'Feeling Good', 'PENDING');
    cat.onAlbumGet = (n) => {
      if (n === 2) track.status = 'PROCESSING';
      if (n === 4) track.status = 'READY';
    };
    renderApp(`/admin/albums/${album.id}`, { as: 'admin' });

    expect(await within(await screen.findByLabelText('Status of Feeling Good')).findByText('Queued')).toBeInTheDocument();
    expect(await within(statusOf('Feeling Good')).findByText('Processing')).toBeInTheDocument();
    expect(await within(statusOf('Feeling Good')).findByText('Ready')).toBeInTheDocument();

    const calls = cat.calls.getAlbum;
    await new Promise((r) => setTimeout(r, 200));
    expect(cat.calls.getAlbum).toBe(calls);
    expect(screen.getByText('1 of 1 ready to play.', { exact: false })).toBeInTheDocument();
  });

  it('shows a failed track’s error and retries it', async () => {
    const { album } = seedAlbum();
    const track = seedTrack(album.id, 'Broken', 'FAILED', { errorMessage: 'ffmpeg exited with code 1: Invalid data' });
    const { user } = renderApp(`/admin/albums/${album.id}`, { as: 'admin' });

    expect(await screen.findByText('ffmpeg exited with code 1: Invalid data')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry Broken' }));

    expect(await within(statusOf('Broken')).findByText('Queued')).toBeInTheDocument();
    expect(cat.calls.retry).toEqual([track.id]);
    expect(screen.queryByText(/Invalid data/)).not.toBeInTheDocument();
  });

  it('deletes a track only after confirmation', async () => {
    const { album } = seedAlbum();
    const track = seedTrack(album.id, 'Old Take', 'READY');
    const { user } = renderApp(`/admin/albums/${album.id}`, { as: 'admin' });

    await user.click(await screen.findByRole('button', { name: 'Delete Old Take' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete “Old Take”?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(cat.calls.deleted).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Delete Old Take' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/No tracks yet/)).toBeInTheDocument();
    expect(cat.calls.deleted).toEqual([track.id]);
  });

  it('reorders and renames tracks', async () => {
    const { album } = seedAlbum();
    seedTrack(album.id, 'First', 'READY');
    seedTrack(album.id, 'Second', 'READY');
    const { user } = renderApp(`/admin/albums/${album.id}`, { as: 'admin' });

    await user.click(await screen.findByRole('button', { name: 'Move Second up' }));
    await waitFor(() => {
      const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
      expect(rows.map((r) => within(r).getAllByRole('cell')[1].querySelector('p')!.textContent)).toEqual(['Second', 'First']);
    });

    await user.click(screen.getByRole('button', { name: 'Edit First' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit track' });
    const title = within(dialog).getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'First (Live)');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('First (Live)')).toBeInTheDocument();
  });
});
