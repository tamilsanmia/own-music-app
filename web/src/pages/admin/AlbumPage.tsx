import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { adminKeys, albumsApi, genresApi, parseGenres, type AdminAlbumDetail } from '@/admin/catalogApi';
import { ImageEditor } from '@/admin/components';
import { adminConfig } from '@/admin/config';
import { DeleteAlbumButton } from '@/admin/DeleteAlbumButton';
import { ArtistSelect, errorText, parseYear } from '@/admin/dialogs';
import { TracksTable } from '@/admin/TracksTable';
import { UploadPanel, useAlbumUploads } from '@/admin/UploadPanel';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/lib/api';

const BUSY = new Set(['PENDING', 'PROCESSING']);

/** Comma-separated genres, with the catalog's existing genres as one-click suggestions. */
function GenresField({ value, onChange }: { value: string; onChange(v: string): void }) {
  const names = useQuery({ queryKey: adminKeys.genres, queryFn: genresApi.names });
  const chosen = new Set(parseGenres(value).map((g) => g.toLowerCase()));
  const suggestions = (names.data ?? []).filter((g) => !chosen.has(g.toLowerCase()));
  const add = (g: string) => onChange([...parseGenres(value), g].join(', '));
  return (
    <Field label="Genres or moods" htmlFor="edit-album-genres" hint="Up to 5, separated by commas. Listeners can browse by these.">
      <Input
        id="edit-album-genres"
        name="genres"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Melody, Kuthu"
      />
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Add an existing genre">
          {suggestions.slice(0, 20).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => add(g)}
              className="rounded-full border border-border px-2 py-0.5 text-xs text-muted hover:text-foreground"
            >
              + {g}
            </button>
          ))}
        </div>
      )}
    </Field>
  );
}

function AlbumForm({ album }: { album: AdminAlbumDetail }) {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [genres, setGenres] = useState(album.genres.join(', '));
  const save = useMutation({
    mutationFn: (input: { title: string; artistId: string; releaseYear: number | null; genres: string[] }) =>
      albumsApi.update(album.id, input),
    onSuccess: (updated) => {
      setSaved(true);
      setGenres(updated.genres.join(', '));
      void queryClient.invalidateQueries({ queryKey: adminKeys.album(album.id) });
      void queryClient.invalidateQueries({ queryKey: adminKeys.allAlbums });
      void queryClient.invalidateQueries({ queryKey: adminKeys.artists });
      void queryClient.invalidateQueries({ queryKey: adminKeys.genres });
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaved(false);
    const form = new FormData(e.currentTarget);
    save.mutate({
      title: String(form.get('title')).trim(),
      artistId: String(form.get('artistId')),
      releaseYear: parseYear(form.get('releaseYear')) ?? null,
      genres: parseGenres(genres),
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid flex-1 content-start gap-4" key={album.id}>
      <Field label="Title" htmlFor="edit-album-title">
        <Input id="edit-album-title" name="title" defaultValue={album.title} required maxLength={200} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Artist" htmlFor="edit-album-artist">
          <ArtistSelect id="edit-album-artist" defaultValue={album.artist.id} />
        </Field>
        <Field label="Release year" htmlFor="edit-album-year">
          <Input id="edit-album-year" name="releaseYear" type="number" min={1000} max={2100} defaultValue={album.releaseYear ?? ''} />
        </Field>
      </div>
      <GenresField value={genres} onChange={setGenres} />
      <FormError message={errorText(save.error)} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
        {saved && <span role="status" className="text-sm text-primary">Saved</span>}
      </div>
    </form>
  );
}

export default function AlbumPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const uploads = useAlbumUploads(id);
  const activeUploads = uploads.some((u) => u.state === 'queued' || u.state === 'uploading');

  const album = useQuery({
    queryKey: adminKeys.album(id),
    queryFn: () => albumsApi.get(id),
    // Poll only while something is changing on the server.
    refetchInterval: (q) => (q.state.data?.tracks.some((t) => BUSY.has(t.status)) || activeUploads ? adminConfig.pollMs : false),
  });

  // Each finished (or failed) upload changes the track list.
  const settled = uploads.filter((u) => u.state === 'done' || u.state === 'error').length;
  useEffect(() => {
    if (settled > 0) void queryClient.invalidateQueries({ queryKey: adminKeys.album(id) });
  }, [settled, id, queryClient]);

  const uploadingIds = useMemo(
    () => new Set(uploads.filter((u) => u.state === 'queued' || u.state === 'uploading').map((u) => u.trackId).filter(Boolean) as string[]),
    [uploads],
  );

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.album(id) }),
      queryClient.invalidateQueries({ queryKey: adminKeys.allAlbums }),
    ]);

  if (album.isPending) return <Spinner label="Loading album" />;
  if (album.error instanceof ApiError && album.error.status === 404) return <p className="text-muted">This album doesn’t exist.</p>;
  if (album.isError) return <FormError message={errorText(album.error)} />;
  const a = album.data;
  const ready = a.tracks.filter((t) => t.status === 'READY').length;

  return (
    <section className="grid gap-8">
      <Link to={`/admin/artists/${a.artist.id}`} className="flex items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {a.artist.name}
      </Link>

      <div className="flex flex-wrap gap-8">
        <ImageEditor
          image={a.cover}
          alt={`${a.title} cover`}
          onUpload={(file) => albumsApi.setCover(a.id, file).then(refresh)}
          onRemove={() => albumsApi.removeCover(a.id).then(refresh)}
        />
        <AlbumForm album={a} />
      </div>

      <div className="grid gap-4">
        <div>
          <h2 className="text-xl font-bold">Tracks</h2>
          <p className="text-sm text-muted">
            {ready} of {a.tracks.length} ready to play. Listeners see the album once at least one track is ready.
          </p>
        </div>
        <UploadPanel albumId={a.id} />
        <TracksTable albumId={a.id} tracks={a.tracks} uploadingIds={uploadingIds} />
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-border pt-6">
        <DeleteAlbumButton
          album={a}
          trackCount={a.tracks.length}
          disabled={activeUploads}
          onDeleted={() => navigate(`/admin/artists/${a.artist.id}`, { replace: true })}
        />
        {activeUploads && <p className="text-sm text-muted">Wait for the uploads to finish before deleting.</p>}
      </div>
    </section>
  );
}
