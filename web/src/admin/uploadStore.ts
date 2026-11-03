import { create } from 'zustand';
import { ApiError } from '@/lib/api';
import { tracksApi } from './catalogApi';
import { sendFile } from './uploader';

export type UploadState = 'queued' | 'uploading' | 'done' | 'error';

export interface UploadItem {
  key: string;
  albumId: string;
  name: string;
  size: number;
  sent: number;
  state: UploadState;
  error?: string;
  /** Set once the server has created the track; lets a failed upload resume. */
  trackId?: string;
  chunkBytes?: number;
}

interface UploadStore {
  items: UploadItem[];
  add(albumId: string, files: File[]): void;
  /** Try a failed upload again, resuming where the server stopped. */
  retry(key: string): void;
  /** Cancel (if running) and forget an upload. The server-side track is left for the admin. */
  remove(key: string): void;
  clearFinished(albumId: string): void;
}

// Kept outside the store: not serializable and not needed for rendering.
const files = new Map<string, File>();
const controllers = new Map<string, AbortController>();
let running = false;
let seq = 0;

function message(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return 'Upload failed. Check your connection and retry.';
}

/**
 * Upload queue shared by all admin pages, so uploads keep going while the admin navigates.
 * Files go one at a time; the server transcodes one at a time anyway.
 */
export const useUploads = create<UploadStore>((set, get) => {
  const patch = (key: string, p: Partial<UploadItem>) =>
    set((s) => ({ items: s.items.map((i) => (i.key === key ? { ...i, ...p } : i)) }));

  async function runOne(item: UploadItem): Promise<void> {
    const file = files.get(item.key);
    if (!file) return;
    const ctrl = new AbortController();
    controllers.set(item.key, ctrl);
    patch(item.key, { state: 'uploading', error: undefined });
    try {
      let { trackId, chunkBytes } = item;
      if (!trackId || !chunkBytes) {
        const created = await tracksApi.create({ albumId: item.albumId, filename: file.name, sizeBytes: file.size });
        trackId = created.track.id;
        chunkBytes = created.upload.chunkBytes;
        patch(item.key, { trackId, chunkBytes });
      }
      await sendFile(trackId, file, chunkBytes, (sent) => patch(item.key, { sent }), ctrl.signal);
      patch(item.key, { state: 'done', sent: file.size });
      files.delete(item.key);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      // A 400 on completion means the server rejected and deleted the file: don't resume.
      const discarded = e instanceof ApiError && e.status === 400;
      patch(item.key, { state: 'error', error: message(e), ...(discarded ? { trackId: undefined } : {}) });
      if (discarded) files.delete(item.key);
    } finally {
      controllers.delete(item.key);
    }
  }

  async function pump(): Promise<void> {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const next = get().items.find((i) => i.state === 'queued');
        if (!next) break;
        await runOne(next);
      }
    } finally {
      running = false;
    }
  }

  return {
    items: [],
    add(albumId, list) {
      const added = list.map((file) => {
        const key = `u${++seq}`;
        files.set(key, file);
        return { key, albumId, name: file.name, size: file.size, sent: 0, state: 'queued' as const };
      });
      set((s) => ({ items: [...s.items, ...added] }));
      void pump();
    },
    retry(key) {
      if (!files.has(key)) return;
      patch(key, { state: 'queued', error: undefined });
      void pump();
    },
    remove(key) {
      controllers.get(key)?.abort();
      files.delete(key);
      set((s) => ({ items: s.items.filter((i) => i.key !== key) }));
    },
    clearFinished(albumId) {
      set((s) => ({ items: s.items.filter((i) => i.albumId !== albumId || i.state !== 'done') }));
    },
  };
});

export function canRetry(item: UploadItem): boolean {
  return item.state === 'error' && files.has(item.key);
}

export function hasActiveUploads(items: UploadItem[]): boolean {
  return items.some((i) => i.state === 'queued' || i.state === 'uploading');
}

/** For tests. */
export function resetUploads(): void {
  controllers.forEach((c) => c.abort());
  controllers.clear();
  files.clear();
  running = false;
  useUploads.setState({ items: [] });
}
