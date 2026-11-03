import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { adminKeys, albumsApi, artistsApi, type Artist } from '@/admin/catalogApi';
import { Artwork, ImageEditor } from '@/admin/components';
import { errorText, NewAlbumDialog } from '@/admin/dialogs';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-dialog';
import { Textarea } from '@/components/ui/controls';
import { Field, FormError, Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/lib/api';

function ArtistForm({ artist }: { artist: Artist }) {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (input: { name: string; bio: string | null }) => artistsApi.update(artist.id, input),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: adminKeys.artists });
      void queryClient.invalidateQueries({ queryKey: adminKeys.allAlbums });
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaved(false);
    const form = new FormData(e.currentTarget);
    const bio = String(form.get('bio') ?? '').trim();
    save.mutate({ name: String(form.get('name')).trim(), bio: bio || null });
  }

  return (
    <form onSubmit={onSubmit} className="grid flex-1 gap-4" key={artist.id}>
      <Field label="Name" htmlFor="edit-artist-name">
        <Input id="edit-artist-name" name="name" defaultValue={artist.name} required maxLength={200} />
      </Field>
      <Field label="Bio" htmlFor="edit-artist-bio">
        <Textarea id="edit-artist-bio" name="bio" defaultValue={artist.bio ?? ''} maxLength={5000} />
      </Field>
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

export default function ArtistPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const query = useQuery({ queryKey: adminKeys.artist(id), queryFn: () => artistsApi.get(id) });
  const albums = useQuery({ queryKey: adminKeys.albums(id), queryFn: () => albumsApi.list(id) });
  const artist = query.data;

  // Prefix match also refreshes this artist's own query.
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.artists });

  if (query.isPending) return <Spinner label="Loading artist" />;
  if (query.error instanceof ApiError && query.error.status === 404) return <p className="text-muted">This artist doesn’t exist.</p>;
  if (query.isError || !artist) return <FormError message={errorText(query.error)} />;

  const empty = artist.albumCount === 0 && artist.trackCount === 0;

  return (
    <section className="grid gap-8">
      <Link to="/admin/artists" className="flex items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Artists
      </Link>

      <div className="flex flex-wrap gap-8">
        <ImageEditor
          image={artist.image}
          alt={`Photo of ${artist.name}`}
          round
          onUpload={(file) => artistsApi.setImage(artist.id, file).then(refresh)}
          onRemove={() => artistsApi.removeImage(artist.id).then(refresh)}
        />
        <ArtistForm artist={artist} />
      </div>

      <div className="grid gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Albums</h2>
          <NewAlbumDialog artistId={artist.id} />
        </div>
        {albums.data?.items.length === 0 && <p className="text-muted">No albums yet.</p>}
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-4">
          {albums.data?.items.map((a) => (
            <li key={a.id}>
              <Link to={`/admin/albums/${a.id}`} className="grid gap-2 rounded-lg bg-surface p-3 hover:bg-surface-2">
                <Artwork image={a.cover} alt={`${a.title} cover`} className="w-full" />
                <p className="truncate text-sm font-semibold">{a.title}</p>
                <p className="text-xs text-muted">
                  {a.releaseYear ?? 'No year'} · {a.trackCount} {a.trackCount === 1 ? 'track' : 'tracks'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-border pt-6">
        {empty ? (
          <ConfirmButton
            trigger={
              <Button variant="outline">
                <Trash2 aria-hidden /> Delete artist
              </Button>
            }
            title={`Delete ${artist.name}?`}
            description="This can’t be undone."
            onConfirm={async () => {
              await artistsApi.delete(artist.id);
              queryClient.removeQueries({ queryKey: adminKeys.artist(artist.id) });
              navigate('/admin/artists', { replace: true });
              await refresh();
            }}
          />
        ) : (
          <p className="text-sm text-muted">To delete this artist, first delete their albums and tracks.</p>
        )}
      </div>
    </section>
  );
}
