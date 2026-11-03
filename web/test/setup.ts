import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { setAccessToken } from '@/lib/api';
import { resetDb, server } from './mock-api';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  resetDb();
  setAccessToken(null);
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
