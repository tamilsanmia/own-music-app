import { Disc3, ListPlus, MoreHorizontal, User } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { QueueTrack } from '@/player/store';
import { AddToPlaylistDialog } from './AddToPlaylistDialog';

/** The "⋯" menu on a track row: add to playlist, go to album/artist, plus any `extra` items. */
export function TrackMenu({ track, extra, className }: { track: QueueTrack; extra?: ReactNode; className?: string }) {
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More options for ${track.title}`}
          className={cn(
            'flex size-8 items-center justify-center rounded-full text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary data-[state=open]:text-foreground',
            className,
          )}
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setAdding(true)}>
            <ListPlus aria-hidden /> Add to playlist
          </DropdownMenuItem>
          {extra}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate(`/albums/${track.album.id}`)}>
            <Disc3 aria-hidden /> Go to album
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate(`/artists/${track.artist.id}`)}>
            <User aria-hidden /> Go to artist
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {adding && (
        <AddToPlaylistDialog
          trackIds={[track.id]}
          label={track.title}
          onClose={() => setAdding(false)}
          onAdded={(name) => toast(`Added to ${name}`)}
        />
      )}
    </>
  );
}
