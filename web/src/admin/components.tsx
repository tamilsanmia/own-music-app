import { Loader2, Upload } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ImageUrls, TrackStatus } from './catalogApi';

const STATUS: Record<TrackStatus, { label: string; variant: 'default' | 'success' | 'danger' | 'outline' }> = {
  UPLOADING: { label: 'Uploading', variant: 'outline' },
  PENDING: { label: 'Queued', variant: 'default' },
  PROCESSING: { label: 'Processing', variant: 'default' },
  READY: { label: 'Ready', variant: 'success' },
  FAILED: { label: 'Failed', variant: 'danger' },
};

export function TrackStatusBadge({ status }: { status: TrackStatus }) {
  const s = STATUS[status];
  return (
    <Badge variant={s.variant} className="gap-1">
      {status === 'PROCESSING' && <Loader2 className="size-3 animate-spin" aria-hidden />}
      {s.label}
    </Badge>
  );
}

export { Artwork } from '@/components/Artwork';
import { Artwork } from '@/components/Artwork';

/** Large artwork with "Upload"/"Replace" and "Remove" buttons. */
export function ImageEditor({
  image,
  alt,
  round,
  onUpload,
  onRemove,
}: {
  image: ImageUrls | null;
  alt: string;
  round?: boolean;
  onUpload(file: File): Promise<unknown>;
  onRemove(): Promise<unknown>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Upload failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid w-48 shrink-0 gap-3">
      {image ? (
        <img src={image.large} alt={alt} className={cn('aspect-square w-48 object-cover shadow-2xl', round ? 'rounded-full' : 'rounded-md')} />
      ) : (
        <Artwork image={null} alt={alt} round={round} className="w-48" />
      )}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        className="sr-only"
        aria-label={`Choose ${alt}`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void run(() => onUpload(file));
        }}
      />
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
          <Upload aria-hidden />
          {image ? 'Replace' : 'Upload'}
        </Button>
        {image && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(onRemove)}>
            Remove
          </Button>
        )}
      </div>
      <FormError message={error} />
    </div>
  );
}

/** Page title row with optional actions on the right. */
export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold">{title}</h1>
        {subtitle && <p className="mt-2 text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  );
}
