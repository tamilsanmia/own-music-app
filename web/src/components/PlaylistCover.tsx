import { ListMusic } from 'lucide-react';
import type { ImageUrls } from '@/lib/catalog';
import { cn } from '@/lib/utils';

/** One cover, or a 2x2 mosaic once the playlist has songs from 4 different albums. */
export function PlaylistCover({ covers, className, size = 'small' }: { covers: ImageUrls[]; className?: string; size?: 'small' | 'large' }) {
  if (covers.length === 0) {
    return (
      <div aria-hidden className={cn('flex aspect-square items-center justify-center rounded-md bg-surface-3 text-muted', className)}>
        <ListMusic className="size-1/3" />
      </div>
    );
  }
  if (covers.length < 4) {
    return <img src={covers[0][size]} alt="" className={cn('aspect-square rounded-md object-cover', className)} />;
  }
  return (
    <div aria-hidden className={cn('grid aspect-square grid-cols-2 overflow-hidden rounded-md', className)}>
      {covers.slice(0, 4).map((c) => (
        <img key={c.small} src={c.small} alt="" className="aspect-square size-full object-cover" />
      ))}
    </div>
  );
}
