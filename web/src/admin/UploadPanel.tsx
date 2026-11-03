import { CheckCircle2, FileAudio, RotateCcw, UploadCloud, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { ProgressBar } from '@/components/ui/controls';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';
import { canRetry, useUploads, type UploadItem } from './uploadStore';

const ACCEPT = 'audio/*,.mp3,.m4a,.aac,.flac,.wav,.aif,.aiff,.ogg,.opus,.wma,.alac';

export function useAlbumUploads(albumId: string): UploadItem[] {
  return useUploads(useShallow((s) => s.items.filter((i) => i.albumId === albumId)));
}

function UploadRow({ item }: { item: UploadItem }) {
  const { retry, remove } = useUploads(useShallow((s) => ({ retry: s.retry, remove: s.remove })));
  const pct = item.size ? (item.sent / item.size) * 100 : 0;
  const stateText =
    item.state === 'queued'
      ? 'Waiting'
      : item.state === 'uploading'
        ? item.sent >= item.size
          ? 'Checking file…'
          : `${formatBytes(item.sent)} of ${formatBytes(item.size)}`
        : item.state === 'done'
          ? 'Uploaded, now converting'
          : item.error;

  return (
    <li className="grid gap-2 px-4 py-3" aria-label={`Upload ${item.name}`}>
      <div className="flex items-center gap-3">
        {item.state === 'done' ? (
          <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden />
        ) : (
          <FileAudio className="size-4 shrink-0 text-muted" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{item.name}</span>
        <span className={cn('shrink-0 text-xs', item.state === 'error' ? 'text-danger' : 'text-muted')}>{stateText}</span>
        {canRetry(item) && (
          <Button size="sm" variant="secondary" onClick={() => retry(item.key)} aria-label={`Retry upload of ${item.name}`}>
            <RotateCcw aria-hidden /> Retry
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={() => remove(item.key)}
          aria-label={item.state === 'done' || item.state === 'error' ? `Dismiss ${item.name}` : `Cancel upload of ${item.name}`}
        >
          <X aria-hidden />
        </Button>
      </div>
      {item.state !== 'done' && item.state !== 'error' && <ProgressBar value={pct} label={`${item.name} progress`} />}
    </li>
  );
}

/** Drop zone plus the list of uploads for one album. */
export function UploadPanel({ albumId }: { albumId: string }) {
  const add = useUploads((s) => s.add);
  const clearFinished = useUploads((s) => s.clearFinished);
  const items = useAlbumUploads(albumId);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function addFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length) add(albumId, files);
  }

  return (
    <div className="grid gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          'flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border',
        )}
      >
        <UploadCloud className="size-8 text-muted" aria-hidden />
        <p className="text-sm">
          Drop audio files here, or{' '}
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => input.current?.click()}>
            choose files
          </button>
        </p>
        <p className="text-xs text-muted">MP3, AAC/M4A, FLAC, WAV, AIFF, OGG or Opus, up to 1 GB each. Titles come from the file names.</p>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          aria-label="Choose audio files"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {items.length > 0 && (
        <div className="rounded-lg bg-surface">
          <div className="flex items-center justify-between px-4 pt-3">
            <h3 className="text-sm font-bold">Uploads</h3>
            {items.some((i) => i.state === 'done') && (
              <Button size="sm" variant="ghost" onClick={() => clearFinished(albumId)}>
                Clear finished
              </Button>
            )}
          </div>
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <UploadRow key={item.key} item={item} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
