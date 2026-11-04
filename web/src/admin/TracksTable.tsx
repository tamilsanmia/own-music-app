import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, MicVocal, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-dialog';
import { Textarea } from '@/components/ui/controls';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FormError, Input } from '@/components/ui/input';
import { formatBytes, formatDuration } from '@/lib/format';
import { adminKeys, tracksApi, type AdminTrack } from './catalogApi';
import { TrackStatusBadge } from './components';
import { errorText } from './dialogs';

const MAX_LYRICS = 20_000;
const LRC_LINE = /^\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/m;

function LyricsDialog({ track, onClose }: { track: AdminTrack; onClose(): void }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState(track.lyrics ?? '');
  const save = useMutation({
    mutationFn: (lyrics: string | null) => tracksApi.update(track.id, { lyrics }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.album(track.albumId) });
      onClose();
    },
  });
  const synced = LRC_LINE.test(text);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Lyrics</DialogTitle>
          <DialogDescription>{track.title}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(text.trim() === '' ? null : text);
          }}
        >
          <Field
            label="Lyrics text"
            htmlFor="track-lyrics"
            hint="Plain text, or LRC for lyrics that follow the music: one line per lyric starting with a time, like [01:23.45]."
          >
            <Textarea
              id="track-lyrics"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={MAX_LYRICS}
              rows={14}
              className="font-mono text-xs"
              placeholder={'[00:12.00] First line\n[00:17.50] Second line'}
            />
          </Field>
          <p className="text-xs text-muted" role="status">
            {text.trim() === '' ? 'No lyrics' : synced ? 'Synced lyrics (LRC)' : 'Plain lyrics'} · {text.length.toLocaleString()} /{' '}
            {MAX_LYRICS.toLocaleString()} characters
          </p>
          <FormError message={errorText(save.error)} />
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save lyrics'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditTrackDialog({ track, onClose }: { track: AdminTrack; onClose(): void }) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (input: { title: string; trackNumber: number }) => tracksApi.update(track.id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.album(track.albumId) });
      onClose();
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    save.mutate({ title: String(form.get('title')).trim(), trackNumber: Number(form.get('trackNumber')) });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit track</DialogTitle>
          <DialogDescription>{track.originalFilename ?? track.title}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <Field label="Title" htmlFor="track-title">
            <Input id="track-title" name="title" defaultValue={track.title} required maxLength={200} />
          </Field>
          <Field label="Track number" htmlFor="track-number">
            <Input id="track-number" name="trackNumber" type="number" min={1} max={999} defaultValue={track.trackNumber} required />
          </Field>
          <FormError message={errorText(save.error)} />
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TracksTable({ albumId, tracks, uploadingIds }: { albumId: string; tracks: AdminTrack[]; uploadingIds: Set<string> }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AdminTrack | null>(null);
  const [lyricsFor, setLyricsFor] = useState<AdminTrack | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.album(albumId) });

  const retry = useMutation({ mutationFn: tracksApi.retry, onSuccess: refresh });
  /** Swap track numbers with the neighbour. */
  const move = useMutation({
    mutationFn: async ([a, b]: [AdminTrack, AdminTrack]) => {
      const aNum = a.trackNumber === b.trackNumber ? b.trackNumber + (tracks.indexOf(a) < tracks.indexOf(b) ? 1 : -1) : b.trackNumber;
      await tracksApi.update(a.id, { trackNumber: aNum });
      await tracksApi.update(b.id, { trackNumber: a.trackNumber });
    },
    onSettled: refresh,
  });

  if (tracks.length === 0) return <p className="text-muted">No tracks yet. Upload some above.</p>;

  return (
    <>
      <div className="overflow-x-auto rounded-lg bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="w-12 px-4 py-3 font-semibold">#</th>
              <th className="px-4 py-3 font-semibold">Title</th>
              <th className="px-4 py-3 font-semibold">Length</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((t, i) => (
              <tr key={t.id} className="border-t border-border align-top">
                <td className="px-4 py-3 text-muted">{t.trackNumber}</td>
                <td className="px-4 py-3">
                  <p className="font-semibold">{t.title}</p>
                  <p className="text-xs text-muted">
                    {[t.sourceInfo, formatBytes(t.sizeBytes)].filter((x) => x && x !== '–').join(' · ')}
                  </p>
                  {t.status === 'FAILED' && t.errorMessage && (
                    <p className="mt-1 max-w-xl break-words text-xs text-danger">{t.errorMessage}</p>
                  )}
                  {t.status === 'UPLOADING' && !uploadingIds.has(t.id) && (
                    <p className="mt-1 text-xs text-muted">Upload didn’t finish. Delete it and upload the file again.</p>
                  )}
                </td>
                <td className="px-4 py-3 text-muted">{formatDuration(t.durationMs)}</td>
                <td className="px-4 py-3" aria-label={`Status of ${t.title}`}>
                  <div className="flex flex-wrap gap-1">
                    <TrackStatusBadge status={t.status} />
                    {t.lossless && <Badge variant="outline">Lossless</Badge>}
                    {t.lyrics && <Badge variant="outline">Lyrics</Badge>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" className="size-8" disabled={i === 0 || move.isPending}
                      onClick={() => move.mutate([t, tracks[i - 1]])} aria-label={`Move ${t.title} up`}>
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-8" disabled={i === tracks.length - 1 || move.isPending}
                      onClick={() => move.mutate([t, tracks[i + 1]])} aria-label={`Move ${t.title} down`}>
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-8" onClick={() => setEditing(t)} aria-label={`Edit ${t.title}`}>
                      <Pencil aria-hidden />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-8" onClick={() => setLyricsFor(t)} aria-label={`Lyrics of ${t.title}`}>
                      <MicVocal aria-hidden />
                    </Button>
                    {t.status === 'FAILED' && (
                      <Button size="sm" variant="secondary" disabled={retry.isPending}
                        onClick={() => retry.mutate(t.id)} aria-label={`Retry ${t.title}`}>
                        <RotateCcw aria-hidden /> Retry
                      </Button>
                    )}
                    <ConfirmButton
                      trigger={
                        <Button size="icon" variant="ghost" className="size-8" aria-label={`Delete ${t.title}`}>
                          <Trash2 aria-hidden />
                        </Button>
                      }
                      title={`Delete “${t.title}”?`}
                      description="The uploaded file and its streams are removed. This can’t be undone."
                      onConfirm={() => tracksApi.delete(t.id).then(refresh)}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {retry.error && <FormError message={errorText(retry.error)} />}
      {move.error && <FormError message={errorText(move.error)} />}
      {editing && <EditTrackDialog track={editing} onClose={() => setEditing(null)} />}
      {lyricsFor && <LyricsDialog track={lyricsFor} onClose={() => setLyricsFor(null)} />}
    </>
  );
}
