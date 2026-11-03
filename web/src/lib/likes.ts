import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { catalogKeys, libraryApi } from './catalog';

/** The set of liked track ids, shared by every heart button on the page. */
export function useLikedIds(): Set<string> {
  const q = useQuery({ queryKey: catalogKeys.likedIds, queryFn: libraryApi.likedIds, staleTime: 5 * 60_000 });
  return new Set(q.data ?? []);
}

/** Like or unlike, updating hearts immediately and rolling back if the server says no. */
export function useToggleLike() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ trackId, like }: { trackId: string; like: boolean }) =>
      like ? libraryApi.like(trackId) : libraryApi.unlike(trackId),
    onMutate: async ({ trackId, like }) => {
      await queryClient.cancelQueries({ queryKey: catalogKeys.likedIds });
      const before = queryClient.getQueryData<string[]>(catalogKeys.likedIds);
      queryClient.setQueryData<string[]>(catalogKeys.likedIds, (ids = []) =>
        like ? [trackId, ...ids.filter((id) => id !== trackId)] : ids.filter((id) => id !== trackId),
      );
      return { before };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) queryClient.setQueryData(catalogKeys.likedIds, ctx.before);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['likes'] });
    },
  });
}
