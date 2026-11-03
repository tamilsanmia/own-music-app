import { api } from './api';

/** Listener-facing catalog. Only music that can be played is returned. */

export interface ImageUrls {
  small: string;
  large: string;
}
export interface Ref {
  id: string;
  name: string;
}
export interface Album {
  id: string;
  title: string;
  releaseYear: number | null;
  artist: Ref;
  cover: ImageUrls | null;
  createdAt: string;
}
export interface Track {
  id: string;
  title: string;
  trackNumber: number;
  durationMs: number | null;
  artist: Ref;
}
export interface AlbumDetail extends Album {
  tracks: Track[];
}
export interface Artist {
  id: string;
  name: string;
  bio: string | null;
  image: ImageUrls | null;
}
export interface ArtistDetail extends Artist {
  albums: Album[];
}
export interface StreamUrl {
  url: string;
  expiresAt: string;
}

const enc = encodeURIComponent;

export const catalogApi = {
  home: () => api<{ newAlbums: Album[] }>('/api/home'),
  album: (id: string) => api<AlbumDetail>(`/api/albums/${enc(id)}`),
  artist: (id: string) => api<ArtistDetail>(`/api/artists/${enc(id)}`),
  streamUrl: (trackId: string) => api<StreamUrl>(`/api/tracks/${enc(trackId)}/stream-url`),
};

export const catalogKeys = {
  home: ['home'] as const,
  album: (id: string) => ['album', id] as const,
  artist: (id: string) => ['artist', id] as const,
};
