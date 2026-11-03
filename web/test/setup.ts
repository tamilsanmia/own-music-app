import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { adminConfig } from '@/admin/config';
import { uploaderConfig } from '@/admin/uploader';
import { resetUploads } from '@/admin/uploadStore';
import { setAccessToken } from '@/lib/api';
// Don't import '@/player/engine' here: it would load the real hls.js before a test file's
// vi.mock('hls.js') applies. The layout destroys the engine on unmount anyway.
import { usePlayer } from '@/player/store';
import { resetDb, server } from './mock-api';
import { resetCatalog } from './mock-catalog';

// jsdom's Blob has no arrayBuffer() and MSW's XHR interceptor sends it as the text
// "[object Blob]". Use Node's standard Blob/File so uploaded chunks carry real bytes, as in a browser.
globalThis.Blob = NodeBlob as unknown as typeof Blob;
globalThis.File = NodeFile as unknown as typeof File;

// jsdom doesn't implement media playback. Record calls instead; tests fire media events by hand.
HTMLMediaElement.prototype.play = vi.fn(function (this: HTMLMediaElement) {
  Object.defineProperty(this, 'paused', { value: false, configurable: true });
  return Promise.resolve();
});
HTMLMediaElement.prototype.pause = vi.fn(function (this: HTMLMediaElement) {
  Object.defineProperty(this, 'paused', { value: true, configurable: true });
});
HTMLMediaElement.prototype.load = vi.fn();

// jsdom has no Media Session API. A small fake that keeps the action handlers for tests.
class FakeMediaMetadata {
  constructor(init: object) {
    Object.assign(this, init);
  }
}
const mediaSession = {
  metadata: null as unknown,
  handlers: new Map<string, unknown>(),
  setActionHandler(action: string, fn: unknown) {
    this.handlers.set(action, fn);
  },
  setPositionState: vi.fn(),
};
Object.defineProperty(navigator, 'mediaSession', { value: mediaSession, configurable: true });
globalThis.MediaMetadata = FakeMediaMetadata as unknown as typeof MediaMetadata;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  resetDb();
  resetCatalog();
  resetUploads();
  setAccessToken(null);
  adminConfig.pollMs = 3000;
  uploaderConfig.retryDelayMs = 0;
  usePlayer.setState(usePlayer.getInitialState(), true);
  localStorage.clear();
  vi.mocked(HTMLMediaElement.prototype.play).mockClear();
  vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
