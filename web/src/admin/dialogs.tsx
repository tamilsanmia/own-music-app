import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Select, Textarea } from '@/components/ui/controls';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FormError, Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { adminKeys, albumsApi, artistsApi } from './catalogApi';

export function errorText(err: unknown): string | null {
  if (!err) return null;
  return err instanceof ApiError ? err.message : 'Could not reach the server. Try again.';
}

/** "" -> undefined, "1965" -> 1965. */
export function parseYear(raw: FormDataEntryValue | null): number | undefined {
  const s = String(raw ?? '').trim();
  return s ? Number(s) : undefined;
}

export function NewArtistDialog() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const create = useMutation({
    mutationFn: artistsApi.create,
    onSuccess: (artist) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.artists });
      setOpen(false);
      navigate(`/admin/artists/${artist.id}`);
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const bio = String(form.get('bio') ?? '').trim();
    create.mutate({ name: String(form.get('name')).trim(), ...(bio ? { bio } : {}) });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) create.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          New artist
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New artist</DialogTitle>
          <DialogDescription>You can add a photo on the next page.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <Field label="Name" htmlFor="artist-name">
            <Input id="artist-name" name="name" required maxLength={200} />
          </Field>
          <Field label="Bio" htmlFor="artist-bio" hint="Optional.">
            <Textarea id="artist-bio" name="bio" maxLength={5000} />
          </Field>
          <FormError message={errorText(create.error)} />
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create artist'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ArtistSelect({ id, defaultValue }: { id: string; defaultValue?: string }) {
  const artists = useQuery({ queryKey: adminKeys.artists, queryFn: artistsApi.list });
  return (
    <Select id={id} name="artistId" required defaultValue={defaultValue ?? ''} disabled={!artists.data}>
      <option value="" disabled>
        {artists.data ? 'Choose an artist' : 'Loading…'}
      </option>
      {artists.data?.items.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </Select>
  );
}

export function NewAlbumDialog({ artistId }: { artistId?: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const create = useMutation({
    mutationFn: albumsApi.create,
    onSuccess: (album) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.allAlbums });
      void queryClient.invalidateQueries({ queryKey: adminKeys.artists });
      setOpen(false);
      navigate(`/admin/albums/${album.id}`);
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const releaseYear = parseYear(form.get('releaseYear'));
    create.mutate({
      title: String(form.get('title')).trim(),
      artistId: String(form.get('artistId')),
      ...(releaseYear ? { releaseYear } : {}),
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) create.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          New album
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New album</DialogTitle>
          <DialogDescription>Add the cover and tracks on the next page.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <Field label="Title" htmlFor="album-title">
            <Input id="album-title" name="title" required maxLength={200} />
          </Field>
          <Field label="Artist" htmlFor="album-artist">
            <ArtistSelect id="album-artist" defaultValue={artistId} />
          </Field>
          <Field label="Release year" htmlFor="album-year" hint="Optional.">
            <Input id="album-year" name="releaseYear" type="number" min={1000} max={2100} inputMode="numeric" />
          </Field>
          <FormError message={errorText(create.error)} />
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create album'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
