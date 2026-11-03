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
/** A track shown outside its album page (search, liked songs, recently played). */
export interface TrackWithAlbum extends Track {
  album: { id: string; title: string; cover: ImageUrls | null };
}
export interface SearchResults {
  tracks: TrackWithAlbum[];
  albums: Album[];
  artists: Artist[];
}

const enc = encodeURIComponent;

export const catalogApi = {
  home: () => api<{ newAlbums: Album[] }>('/api/home'),
  album: (id: string) => api<AlbumDetail>(`/api/albums/${enc(id)}`),
  artist: (id: string) => api<ArtistDetail>(`/api/artists/${enc(id)}`),
  streamUrl: (trackId: string) => api<StreamUrl>(`/api/tracks/${enc(trackId)}/stream-url`),
  search: (q: string) => api<SearchResults>(`/api/search?q=${enc(q)}`),
};

const LIKES_PAGE = 100;

export const libraryApi = {
  likedIds: () => api<string[]>('/api/me/likes/ids'),
  /** All liked songs, newest first (fetched in pages of 100). */
  async likes(): Promise<TrackWithAlbum[]> {
    const items: TrackWithAlbum[] = [];
    for (let offset = 0; ; offset += LIKES_PAGE) {
      const page = await api<{ items: TrackWithAlbum[]; total: number }>(`/api/me/likes?limit=${LIKES_PAGE}&offset=${offset}`);
      items.push(...page.items);
      if (page.items.length < LIKES_PAGE || items.length >= page.total) return items;
    }
  },
  like: (trackId: string) => api<void>(`/api/me/likes/${enc(trackId)}`, { method: 'PUT' }),
  unlike: (trackId: string) => api<void>(`/api/me/likes/${enc(trackId)}`, { method: 'DELETE' }),
  recent: () => api<{ items: TrackWithAlbum[] }>('/api/me/recent'),
  recordPlay: (trackId: string) => api<void>('/api/me/history', { method: 'POST', json: { trackId } }),
};

export const catalogKeys = {
  home: ['home'] as const,
  search: (q: string) => ['search', q] as const,
  likedIds: ['likes', 'ids'] as const,
  likes: ['likes', 'list'] as const,
  recent: ['recent'] as const,
  album: (id: string) => ['album', id] as const,
  artist: (id: string) => ['artist', id] as const,
};
