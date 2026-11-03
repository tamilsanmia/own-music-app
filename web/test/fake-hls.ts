import { vi } from 'vitest';

/**
 * Stand-in for hls.js. Use in a test file with:
 *   vi.mock('hls.js', () => import('../test/fake-hls'));
 */
export const instances: FakeHls[] = [];

export class FakeHls {
  static isSupported = () => true;
  config: Record<string, unknown>;
  source?: string;
  media?: HTMLMediaElement;
  destroyed = false;
  handlers = new Map<string, (event: string, data: unknown) => void>();
  recoverMediaError = vi.fn();
  constructor(config: Record<string, unknown> = {}) {
    this.config = config;
    instances.push(this);
  }
  on(event: string, fn: (event: string, data: unknown) => void) {
    this.handlers.set(event, fn);
  }
  loadSource(url: string) {
    this.source = url;
  }
  attachMedia(media: HTMLMediaElement) {
    this.media = media;
  }
  destroy() {
    this.destroyed = true;
  }
  emit(event: string, data: unknown) {
    this.handlers.get(event)?.(event, data);
  }
}

export default FakeHls;
export const Events = { ERROR: 'hlsError' };
export const ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
export const lastHls = () => instances[instances.length - 1];
