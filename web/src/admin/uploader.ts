import { ApiError, uploadBytes } from '@/lib/api';
import { tracksApi, type AdminTrack } from './catalogApi';

/** Retries per chunk for network errors and 5xx before the upload is marked failed. */
export const MAX_CHUNK_RETRIES = 3;
export const uploaderConfig = { retryDelayMs: 1000 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

function receivedFrom(e: unknown): number | undefined {
  if (e instanceof ApiError && e.status === 409 && e.body && typeof e.body === 'object') {
    const n = (e.body as { receivedBytes?: unknown }).receivedBytes;
    return typeof n === 'number' ? n : undefined;
  }
  return undefined;
}

/**
 * Send the rest of `file` to an existing upload, starting where the server says it is, then
 * finish it. Each chunk is a separate request (the proxy cuts requests off after 60 s).
 * Resumes on offset conflicts and retries transient errors.
 */
export async function sendFile(
  trackId: string,
  file: Blob,
  chunkBytes: number,
  onProgress: (sentBytes: number) => void,
  signal?: AbortSignal,
): Promise<AdminTrack> {
  let offset = (await tracksApi.uploadStatus(trackId)).receivedBytes;
  onProgress(offset);
  let failures = 0;

  while (offset < file.size) {
    if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
    const start = offset;
    const end = Math.min(start + chunkBytes, file.size);
    try {
      const res = await uploadBytes<{ receivedBytes: number }>(
        `/api/admin/tracks/${encodeURIComponent(trackId)}/upload?offset=${start}`,
        file.slice(start, end),
        { onProgress: (loaded) => onProgress(start + loaded), signal },
      );
      offset = res.receivedBytes;
      failures = 0;
      onProgress(offset);
    } catch (e) {
      if (isAbort(e)) throw e;
      const resumeAt = receivedFrom(e);
      if (resumeAt !== undefined) {
        // The server has a different byte count than we thought: continue from there.
        offset = resumeAt;
        onProgress(offset);
        continue;
      }
      const transient = !(e instanceof ApiError) || e.status === 0 || e.status >= 500;
      if (!transient || ++failures > MAX_CHUNK_RETRIES) throw e;
      await sleep(uploaderConfig.retryDelayMs * failures);
      offset = (await tracksApi.uploadStatus(trackId)).receivedBytes;
    }
  }
  return tracksApi.complete(trackId);
}
