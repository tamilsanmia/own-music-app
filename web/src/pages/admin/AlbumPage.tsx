import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { adminKeys, albumsApi, type AdminAlbumDetail } from '@/admin/catalogApi';
import { ImageEditor } from '@/admin/components';
import { adminConfig } from '@/admin/config';
import { ArtistSelect, errorText, parseYear } from '@/admin/dialogs';
import { TracksTable } from '@/admin/TracksTable';
import { UploadPanel, useAlbumUploads } from '@/admin/UploadPanel';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-dialog';
import { Field, FormError, Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/lib/api';

const BUSY = new Set(['PENDING', 'PROCESSING']);

function AlbumForm({ album }: { album: AdminAlbumDetail }) {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (input: { title: string; artistId: string; releaseYear: number | null }) => albumsApi.update(album.id, input),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: adminKeys.album(album.id) });
      void queryClient.invalidateQueries({ queryKey: adminKeys.allAlbums });
      void queryClient.invalidateQueries({ queryKey: adminKeys.artists });
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

      <div className="border-t border-border pt-6">
        {a.tracks.length === 0 ? (
          <ConfirmButton
            trigger={
              <Button variant="outline">
                <Trash2 aria-hidden /> Delete album
              </Button>
            }
            title={`Delete “${a.title}”?`}
            description="This can’t be undone."
            onConfirm={async () => {
              await albumsApi.delete(a.id);
              queryClient.removeQueries({ queryKey: adminKeys.album(a.id) });
              navigate(`/admin/artists/${a.artist.id}`, { replace: true });
              await queryClient.invalidateQueries({ queryKey: adminKeys.allAlbums });
              await queryClient.invalidateQueries({ queryKey: adminKeys.artists });
            }}
          />
        ) : (
          <p className="text-sm text-muted">To delete this album, first delete its tracks.</p>
        )}
      </div>
    </section>
  );
}
