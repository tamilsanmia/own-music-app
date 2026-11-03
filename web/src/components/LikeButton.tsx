import { Heart } from 'lucide-react';
import { useLikedIds, useToggleLike } from '@/lib/likes';
import { cn } from '@/lib/utils';

export function LikeButton({ trackId, title, className }: { trackId: string; title: string; className?: string }) {
  const liked = useLikedIds().has(trackId);
  const toggle = useToggleLike();
  return (
    <button
      type="button"
      aria-label={liked ? `Remove ${title} from Liked Songs` : `Like ${title}`}
      aria-pressed={liked}
      onClick={(e) => {
        e.stopPropagation();
        toggle.mutate({ trackId, like: !liked });
      }}
      className={cn(
        'flex size-8 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        liked ? 'text-primary hover:text-primary-hover' : 'text-muted hover:text-foreground',
        className,
      )}
    >
      <Heart className={cn('size-4', liked && 'fill-current')} aria-hidden />
    </button>
  );
}
