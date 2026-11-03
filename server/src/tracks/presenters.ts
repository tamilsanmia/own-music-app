import type { TrackStatus } from '@prisma/client';

type AdminTrackRow = {
  id: string;
  title: string;
  albumId: string;
  trackNumber: number;
  durationMs: number | null;
  status: TrackStatus;
  errorMessage: string | null;
  originalFilename: string | null;
  sizeBytes: number | null;
  sourceInfo: string | null;
  createdAt: Date;
  updatedAt: Date;
  artist: { id: string; name: string };
};

/** Track as the admin sees it, including processing state. */
export function presentAdminTrack(t: AdminTrackRow) {
  return {
    id: t.id,
    title: t.title,
    albumId: t.albumId,
    trackNumber: t.trackNumber,
    durationMs: t.durationMs,
    status: t.status,
    errorMessage: t.errorMessage,
    originalFilename: t.originalFilename,
    sizeBytes: t.sizeBytes,
    sourceInfo: t.sourceInfo,
    artist: t.artist,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}
