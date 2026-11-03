import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { adminConfig } from '@/admin/config';
import { uploaderConfig } from '@/admin/uploader';
import { resetUploads } from '@/admin/uploadStore';
import { setAccessToken } from '@/lib/api';
import { resetDb, server } from './mock-api';
import { resetCatalog } from './mock-catalog';

// jsdom's Blob has no arrayBuffer() and MSW's XHR interceptor sends it as the text
// "[object Blob]". Use Node's standard Blob/File so uploaded chunks carry real bytes, as in a browser.
globalThis.Blob = NodeBlob as unknown as typeof Blob;
globalThis.File = NodeFile as unknown as typeof File;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  resetDb();
  resetCatalog();
  resetUploads();
  setAccessToken(null);
  adminConfig.pollMs = 3000;
  uploaderConfig.retryDelayMs = 0;
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
