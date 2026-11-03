/** Largest audio file accepted (1 GiB). */
export const MAX_TRACK_BYTES = 1024 * 1024 * 1024;
/**
 * Chunk size clients should use. Each chunk is its own short HTTP request, so uploads of any
 * size stay well inside Traefik's 60-second request timeout even on slow connections
 * (4 MiB at 1 Mbit/s is about 34 s).
 */
export const RECOMMENDED_CHUNK_BYTES = 4 * 1024 * 1024;
/** Largest chunk the server accepts in one request. */
export const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
