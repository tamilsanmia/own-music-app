import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-dialog';
import { albumsApi } from './catalogApi';

/**
 * Deletes an album, including its tracks, uploaded files and streams. The confirmation says
 * how many tracks go with it.
 */
export function DeleteAlbumButton({
  album,
  trackCount,
  compact,
  disabled,
  onDeleted,
}: {
  album: { id: string; title: string };
  trackCount: number;
  compact?: boolean;
  disabled?: boolean;
  onDeleted?(): void;
}) {
  const queryClient = useQueryClient();
  const tracks = `${trackCount} ${trackCount === 1 ? 'track' : 'tracks'}`;
  return (
    <ConfirmButton
      trigger={
        compact ? (
          <Button size="icon" variant="ghost" className="size-8" aria-label={`Delete album ${album.title}`} disabled={disabled}>
            <Trash2 aria-hidden />
          </Button>
        ) : (
          <Button variant="outline" disabled={disabled}>
            <Trash2 aria-hidden /> Delete album
          </Button>
        )
      }
      title={`Delete “${album.title}”?`}
      description={
        trackCount > 0
          ? `This deletes the album and its ${tracks}, including the uploaded files, streams, likes and play history. This can’t be undone.`
          : 'This can’t be undone.'
      }
      confirmLabel={trackCount > 0 ? `Delete album and ${tracks}` : 'Delete album'}
      onConfirm={async () => {
        await albumsApi.delete(album.id, trackCount > 0);
        onDeleted?.();
        queryClient.removeQueries({ queryKey: ['admin', 'album', album.id] });
        // Listener views (Home, search, likes, recently played) may show these tracks too.
        await queryClient.invalidateQueries();
      }}
    />
  );
}
