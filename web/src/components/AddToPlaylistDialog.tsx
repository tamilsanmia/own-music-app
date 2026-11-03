import { ListMusic, Plus } from 'lucide-react';
import { useState } from 'react';
import { Artwork } from '@/components/Artwork';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormError } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/lib/api';
import { useAddToPlaylist, useCreatePlaylist, usePlaylists } from '@/lib/playlists';

/** Pick one of your playlists (or a new one) to add songs to. */
export function AddToPlaylistDialog({
  trackIds,
  label,
  onClose,
  onAdded,
}: {
  trackIds: string[];
  /** What is being added, e.g. a song title. */
  label: string;
  onClose(): void;
  onAdded?(playlistName: string): void;
}) {
  const playlists = usePlaylists();
  const add = useAddToPlaylist();
  const create = useCreatePlaylist();
  const [error, setError] = useState<string | null>(null);
  const busy = add.isPending || create.isPending;

  async function addTo(playlistId: string, name: string) {
    setError(null);
    try {
      await add.mutateAsync({ playlistId, trackIds });
      onAdded?.(name);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add to the playlist.');
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to playlist</DialogTitle>
          <DialogDescription>{label}</DialogDescription>
        </DialogHeader>
        <ul aria-label="Your playlists" className="-mx-2 grid max-h-80 overflow-y-auto">
          <li>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                try {
                  const p = await create.mutateAsync(undefined);
                  await addTo(p.id, p.name);
                } catch (e) {
                  setError(e instanceof ApiError ? e.message : 'Could not create the playlist.');
                }
              }}
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left font-semibold hover:bg-surface-3 disabled:opacity-50"
            >
              <span className="flex size-10 items-center justify-center rounded-md bg-surface-3">
                <Plus className="size-5" aria-hidden />
              </span>
              New playlist
            </button>
          </li>
          {playlists.isPending && <Spinner label="Loading playlists" className="px-2" />}
          {playlists.data?.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void addTo(p.id, p.name)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-surface-3 disabled:opacity-50"
              >
                {p.covers[0] ? (
                  <Artwork image={p.covers[0]} alt="" className="size-10" />
                ) : (
                  <span className="flex size-10 items-center justify-center rounded-md bg-surface-3 text-muted">
                    <ListMusic className="size-5" aria-hidden />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{p.name}</span>
                  <span className="block text-xs text-muted">
                    {p.trackCount} {p.trackCount === 1 ? 'song' : 'songs'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <FormError message={error} />
      </DialogContent>
    </Dialog>
  );
}
