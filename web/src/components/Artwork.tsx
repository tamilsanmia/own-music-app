import { ImageIcon } from 'lucide-react';
import type { ImageUrls } from '@/lib/catalog';
import { cn } from '@/lib/utils';

/** Square cover or round artist photo, with a placeholder when there is no image. */
export function Artwork({
  image,
  alt,
  className,
  round,
  size = 'small',
}: {
  image: ImageUrls | null;
  alt: string;
  className?: string;
  round?: boolean;
  size?: 'small' | 'large';
}) {
  const shape = round ? 'rounded-full' : 'rounded-md';
  return image ? (
    <img src={image[size]} alt={alt} loading="lazy" className={cn('aspect-square object-cover', shape, className)} />
  ) : (
    <div
      role="img"
      aria-label={alt}
      className={cn('flex aspect-square items-center justify-center bg-surface-3 text-muted', shape, className)}
    >
      <ImageIcon className="size-1/3" aria-hidden />
    </div>
  );
}
