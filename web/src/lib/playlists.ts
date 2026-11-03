import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { ImageUrls, TrackWithAlbum } from './catalog';

export interface PlaylistSummary {
  id: string;
  name: string;
  description: string | null;
  trackCount: number;
  covers: ImageUrls[];
  updatedAt: string;
}
export interface PlaylistItem {
  itemId: string;
  addedAt: string;
  track: TrackWithAlbum;
}
export interface Playlist extends Omit<PlaylistSummary, 'updatedAt'> {
  createdAt: string;
  updatedAt: string;
  items: PlaylistItem[];
}

const enc = encodeURIComponent;

export const playlistsApi = {
  list: () => api<PlaylistSummary[]>('/api/me/playlists'),
  get: (id: string) => api<Playlist>(`/api/me/playlists/${enc(id)}`),
  create: (name: string) => api<Playlist>('/api/me/playlists', { method: 'POST', json: { name } }),
  update: (id: string, input: { name?: string; description?: string | null }) =>
    api<Playlist>(`/api/me/playlists/${enc(id)}`, { method: 'PATCH', json: input }),
  delete: (id: string) => api<void>(`/api/me/playlists/${enc(id)}`, { method: 'DELETE' }),
  add: (id: string, trackIds: string[]) =>
    api<{ added: number; skipped: number }>(`/api/me/playlists/${enc(id)}/tracks`, { method: 'POST', json: { trackIds } }),
  remove: (id: string, itemId: string) =>
    api<Playlist>(`/api/me/playlists/${enc(id)}/tracks/${enc(itemId)}`, { method: 'DELETE' }),
  move: (id: string, itemId: string, toIndex: number) =>
    api<Playlist>(`/api/me/playlists/${enc(id)}/move`, { method: 'POST', json: { itemId, toIndex } }),
};

export const playlistKeys = {
  all: ['playlists'] as const,
  list: ['playlists', 'list'] as const,
  one: (id: string) => ['playlists', 'one', id] as const,
};

export function usePlaylists() {
  return useQuery({ queryKey: playlistKeys.list, queryFn: playlistsApi.list });
}

export function usePlaylist(id: string) {
  return useQuery({ queryKey: playlistKeys.one(id), queryFn: () => playlistsApi.get(id) });
}

/** Move `from` to `to` in a copy of `list`. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(Math.max(0, Math.min(to, copy.length)), 0, item);
  return copy;
}

/** Mutations for one playlist. Reorder and remove update the page at once and roll back on error. */
export function usePlaylistActions(id: string) {
  const queryClient = useQueryClient();
  const key = playlistKeys.one(id);

  const optimistic = (change: (p: Playlist) => Playlist) => async () => {
    await queryClient.cancelQueries({ queryKey: key });
    const before = queryClient.getQueryData<Playlist>(key);
    if (before) queryClient.setQueryData(key, change(before));
    return { before };
  };
  const rollback = (_e: unknown, _v: unknown, ctx?: { before?: Playlist }) => {
    if (ctx?.before) queryClient.setQueryData(key, ctx.before);
  };
  const settle = () => queryClient.invalidateQueries({ queryKey: playlistKeys.all });

  const move = useMutation({
    mutationFn: ({ itemId, to }: { itemId: string; to: number }) => playlistsApi.move(id, itemId, to),
    onMutate: ({ itemId, to }) =>
      optimistic((p) => {
        const from = p.items.findIndex((i) => i.itemId === itemId);
        return from < 0 ? p : { ...p, items: moveItem(p.items, from, to) };
      })(),
    onError: rollback,
    onSettled: settle,
  });

  const remove = useMutation({
    mutationFn: (itemId: string) => playlistsApi.remove(id, itemId),
    onMutate: (itemId) =>
      optimistic((p) => {
        const items = p.items.filter((i) => i.itemId !== itemId);
        return { ...p, items, trackCount: items.length };
      })(),
    onError: rollback,
    onSettled: settle,
  });

  const update = useMutation({
    mutationFn: (input: { name?: string; description?: string | null }) => playlistsApi.update(id, input),
    onSuccess: (p) => queryClient.setQueryData(key, p),
    onSettled: settle,
  });

  return { move, remove, update };
}

/** Create a playlist named "My Playlist #n", with n one more than the user's playlist count. */
export function useCreatePlaylist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name?: string) => {
      const count = queryClient.getQueryData<PlaylistSummary[]>(playlistKeys.list)?.length ?? 0;
      return playlistsApi.create(name ?? `My Playlist #${count + 1}`);
    },
    onSuccess: (p) => {
      queryClient.setQueryData(playlistKeys.one(p.id), p);
      void queryClient.invalidateQueries({ queryKey: playlistKeys.list });
    },
  });
}

export function useAddToPlaylist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ playlistId, trackIds }: { playlistId: string; trackIds: string[] }) => playlistsApi.add(playlistId, trackIds),
    onSettled: () => queryClient.invalidateQueries({ queryKey: playlistKeys.all }),
  });
}
