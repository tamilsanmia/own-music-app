import { api } from '@/lib/api';

export interface ImageUrls {
  small: string;
  large: string;
}
export interface Ref {
  id: string;
  name: string;
}
export interface Page<T> {
  items: T[];
  total: number;
}

export interface Artist {
  id: string;
  name: string;
  bio: string | null;
  image: ImageUrls | null;
}
export interface AdminArtist extends Artist {
  albumCount: number;
  trackCount: number;
}

export interface Album {
  id: string;
  title: string;
  releaseYear: number | null;
  artist: Ref;
  cover: ImageUrls | null;
  createdAt: string;
}
export interface AdminAlbum extends Album {
  trackCount: number;
}

export type TrackStatus = 'UPLOADING' | 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';

export interface AdminTrack {
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
  artist: Ref;
  createdAt: string;
  updatedAt: string;
}
export interface AdminAlbumDetail extends Album {
  tracks: AdminTrack[];
}

export interface CreatedTrack {
  track: AdminTrack;
  upload: { chunkBytes: number; maxChunkBytes: number; receivedBytes: number };
}

function imageForm(file: File): FormData {
  const form = new FormData();
  form.append('image', file);
  return form;
}

const id = encodeURIComponent;

export const artistsApi = {
  list: () => api<Page<AdminArtist>>('/api/admin/artists?limit=100'),
  get: (artistId: string) => api<AdminArtist>(`/api/admin/artists/${id(artistId)}`),
  create: (input: { name: string; bio?: string }) => api<Artist>('/api/admin/artists', { method: 'POST', json: input }),
  update: (artistId: string, input: { name?: string; bio?: string | null }) =>
    api<Artist>(`/api/admin/artists/${id(artistId)}`, { method: 'PATCH', json: input }),
  delete: (artistId: string) => api<void>(`/api/admin/artists/${id(artistId)}`, { method: 'DELETE' }),
  setImage: (artistId: string, file: File) =>
    api<Artist>(`/api/admin/artists/${id(artistId)}/image`, { method: 'PUT', body: imageForm(file) }),
  removeImage: (artistId: string) => api<Artist>(`/api/admin/artists/${id(artistId)}/image`, { method: 'DELETE' }),
};

export const albumsApi = {
  list: (artistId?: string) =>
    api<Page<AdminAlbum>>(`/api/admin/albums?limit=100${artistId ? `&artistId=${id(artistId)}` : ''}`),
  get: (albumId: string) => api<AdminAlbumDetail>(`/api/admin/albums/${id(albumId)}`),
  create: (input: { title: string; artistId: string; releaseYear?: number }) =>
    api<Album>('/api/admin/albums', { method: 'POST', json: input }),
  update: (albumId: string, input: { title?: string; artistId?: string; releaseYear?: number | null }) =>
    api<Album>(`/api/admin/albums/${id(albumId)}`, { method: 'PATCH', json: input }),
  /** With `withTracks`, the album's tracks and their files are deleted too. */
  delete: (albumId: string, withTracks = false) =>
    api<void>(`/api/admin/albums/${id(albumId)}${withTracks ? '?deleteTracks=true' : ''}`, { method: 'DELETE' }),
  setCover: (albumId: string, file: File) =>
    api<Album>(`/api/admin/albums/${id(albumId)}/cover`, { method: 'PUT', body: imageForm(file) }),
  removeCover: (albumId: string) => api<Album>(`/api/admin/albums/${id(albumId)}/cover`, { method: 'DELETE' }),
};

export const tracksApi = {
  create: (input: { albumId: string; filename: string; sizeBytes: number }) =>
    api<CreatedTrack>('/api/admin/tracks', { method: 'POST', json: input }),
  uploadStatus: (trackId: string) =>
    api<{ status: TrackStatus; receivedBytes: number; sizeBytes: number }>(`/api/admin/tracks/${id(trackId)}/upload`),
  complete: (trackId: string) =>
    api<AdminTrack>(`/api/admin/tracks/${id(trackId)}/upload/complete`, { method: 'POST', json: {} }),
  update: (trackId: string, input: { title?: string; trackNumber?: number }) =>
    api<AdminTrack>(`/api/admin/tracks/${id(trackId)}`, { method: 'PATCH', json: input }),
  retry: (trackId: string) => api<AdminTrack>(`/api/admin/tracks/${id(trackId)}/retry`, { method: 'POST', json: {} }),
  delete: (trackId: string) => api<void>(`/api/admin/tracks/${id(trackId)}`, { method: 'DELETE' }),
};

export const adminKeys = {
  artists: ['admin', 'artists'] as const,
  artist: (artistId: string) => ['admin', 'artists', artistId] as const,
  albums: (artistId?: string) => ['admin', 'albums', artistId ?? 'all'] as const,
  allAlbums: ['admin', 'albums'] as const,
  album: (albumId: string) => ['admin', 'album', albumId] as const,
};
