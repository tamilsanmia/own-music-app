import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AlbumCard, AlbumGrid } from '@/components/AlbumCard';
import { ArtistCard } from '@/components/ArtistCard';
import { toQueueFromMixed, TrackList } from '@/components/TrackList';
import { FormError } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { catalogApi, catalogKeys } from '@/lib/catalog';

/** Wait this long after the last keystroke before searching. */
export const SEARCH_DEBOUNCE_MS = 250;

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get('q') ?? '';
  const [text, setText] = useState(urlQuery);

  // Debounce typing into the URL (?q=...), which drives the query. Back/forward and shared
  // links work because the URL is the source of truth.
  useEffect(() => {
    const t = setTimeout(() => {
      const q = text.trim();
      if (q !== urlQuery) setParams(q ? { q } : {}, { replace: true });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, urlQuery, setParams]);

  const q = urlQuery.trim();
  const results = useQuery({
    queryKey: catalogKeys.search(q),
    queryFn: () => catalogApi.search(q),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const data = q ? results.data : undefined;
  const nothing = data && !data.tracks.length && !data.albums.length && !data.artists.length;

  return (
    <section className="grid gap-8">
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
        <input
          type="search"
          aria-label="Search"
          placeholder="What do you want to listen to?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
          maxLength={100}
          className="h-12 w-full rounded-full border border-transparent bg-surface-3 pl-12 pr-12 text-sm text-foreground placeholder:text-muted hover:border-border focus-visible:border-foreground focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {text && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setText('')}
            className="absolute right-3 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>

      {!q && <p className="text-muted">Search for songs, albums and artists.</p>}
      {q && results.isPending && <Spinner label="Searching" />}
      {q && results.isError && <FormError message="Search failed. Try again." />}
      {nothing && <p className="text-muted">No results for “{q}”. Check the spelling or try fewer words.</p>}

      {data && data.tracks.length > 0 && (
        <div className="grid gap-2">
          <h2 className="text-xl font-bold">Songs</h2>
          <TrackList items={toQueueFromMixed(data.tracks)} variant="mixed" label="Songs" />
        </div>
      )}
      {data && data.artists.length > 0 && (
        <div className="grid gap-4">
          <h2 className="text-xl font-bold">Artists</h2>
          <ul aria-label="Artists" className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-4">
            {data.artists.map((a) => (
              <ArtistCard key={a.id} artist={a} />
            ))}
          </ul>
        </div>
      )}
      {data && data.albums.length > 0 && (
        <div className="grid gap-4">
          <h2 className="text-xl font-bold">Albums</h2>
          <AlbumGrid label="Albums">
            {data.albums.map((a) => (
              <AlbumCard key={a.id} album={a} />
            ))}
          </AlbumGrid>
        </div>
      )}
    </section>
  );
}
