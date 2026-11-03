import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, GripVertical, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useShallow } from 'zustand/react/shallow';
import { PlaylistCover } from '@/components/PlaylistCover';
import { toQueueFromMixed, TrackRow } from '@/components/TrackList';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-dialog';
import { Textarea } from '@/components/ui/controls';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenuItem } from '@/components/ui/dropdown';
import { Field, FormError, Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/lib/api';
import { formatDuration } from '@/lib/format';
import { playlistKeys, playlistsApi, usePlaylist, usePlaylistActions, type Playlist } from '@/lib/playlists';
import { useQueryClient } from '@tanstack/react-query';
import { currentTrack, usePlayer, type QueueTrack } from '@/player/store';

function EditDetailsDialog({ playlist, onClose }: { playlist: Playlist; onClose(): void }) {
  const { update } = usePlaylistActions(playlist.id);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const description = String(form.get('description') ?? '').trim();
    update.mutate({ name: String(form.get('name')).trim(), description: description || null }, { onSuccess: onClose });
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
          <DialogDescription>Only you can see your playlists.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <Field label="Name" htmlFor="pl-name">
            <Input id="pl-name" name="name" defaultValue={playlist.name} required maxLength={100} />
          </Field>
          <Field label="Description" htmlFor="pl-desc" hint="Optional.">
            <Textarea id="pl-desc" name="description" defaultValue={playlist.description ?? ''} maxLength={300} />
          </Field>
          <FormError message={update.error instanceof ApiError ? update.error.message : update.error ? 'Could not save.' : null} />
          <DialogFooter>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SortableRow({
  itemId,
  items,
  index,
  onMove,
  onRemove,
}: {
  itemId: string;
  items: QueueTrack[];
  index: number;
  onMove(to: number): void;
  onRemove(): void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: itemId });
  const title = items[index].title;
  return (
    <TrackRow
      ref={setNodeRef}
      items={items}
      index={index}
      variant="mixed"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'relative z-10 opacity-80' : undefined}
      leading={
        <button
          type="button"
          ref={setActivatorNodeRef}
          aria-label={`Drag to reorder ${title}`}
          className="mr-1 flex size-6 cursor-grab touch-none items-center justify-center text-muted opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
      }
      menuExtra={
        <>
          <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(index - 1)}>
            <ArrowUp aria-hidden /> Move up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={index === items.length - 1} onSelect={() => onMove(index + 1)}>
            <ArrowDown aria-hidden /> Move down
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onRemove}>
            <Trash2 aria-hidden /> Remove from this playlist
          </DropdownMenuItem>
        </>
      }
    />
  );
}

export function PlaylistPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const playlist = usePlaylist(id);
  const { move, remove } = usePlaylistActions(id);
  const [editing, setEditing] = useState(false);
  const { nowId, playing, playTracks, togglePlay } = usePlayer(
    useShallow((s) => ({ nowId: currentTrack(s)?.id, playing: s.playing, playTracks: s.playTracks, togglePlay: s.togglePlay })),
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (playlist.isPending) return <Spinner label="Loading playlist" />;
  if (playlist.error instanceof ApiError && playlist.error.status === 404) return <p className="text-muted">This playlist doesn’t exist.</p>;
  if (playlist.isError) return <FormError message="Could not load this playlist." />;

  const p = playlist.data;
  const queue = toQueueFromMixed(p.items.map((i) => i.track));
  const totalMs = queue.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
  const playingHere = playing && queue.some((t) => t.id === nowId);

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const to = p.items.findIndex((i) => i.itemId === e.over!.id);
    move.mutate({ itemId: String(e.active.id), to });
  }

  return (
    <section className="grid gap-8">
      <header className="flex flex-wrap items-end gap-6">
        <PlaylistCover covers={p.covers} size="large" className="w-48 shadow-2xl sm:w-56" />
        <div className="grid min-w-0 gap-2">
          <p className="text-sm font-semibold">Playlist</p>
          <h1 className="text-4xl font-bold break-words sm:text-6xl">{p.name}</h1>
          {p.description && <p className="text-sm text-muted">{p.description}</p>}
          <p className="text-sm text-muted">
            {p.items.length} {p.items.length === 1 ? 'song' : 'songs'}
            {p.items.length > 0 && `, ${formatDuration(totalMs)}`}
          </p>
        </div>
      </header>

      <div className="flex items-center gap-4">
        {p.items.length > 0 && (
          <button
            type="button"
            aria-label={playingHere ? `Pause ${p.name}` : `Play ${p.name}`}
            onClick={() => (playingHere ? togglePlay() : playTracks(queue, 0))}
            className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
          >
            {playingHere ? <Pause className="size-6 fill-current" aria-hidden /> : <Play className="ml-1 size-6 fill-current" aria-hidden />}
          </button>
        )}
        <Button variant="ghost" onClick={() => setEditing(true)}>
          <Pencil aria-hidden /> Edit details
        </Button>
        <ConfirmButton
          trigger={
            <Button variant="ghost">
              <Trash2 aria-hidden /> Delete playlist
            </Button>
          }
          title={`Delete “${p.name}”?`}
          description="The songs stay in the library; only this playlist is removed."
          onConfirm={async () => {
            await playlistsApi.delete(p.id);
            queryClient.removeQueries({ queryKey: playlistKeys.one(p.id) });
            navigate('/', { replace: true });
            await queryClient.invalidateQueries({ queryKey: playlistKeys.list });
          }}
        />
      </div>

      {p.items.length === 0 ? (
        <p className="text-muted">This playlist is empty. Find songs with Search, then use “⋯ → Add to playlist”.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={p.items.map((i) => i.itemId)} strategy={verticalListSortingStrategy}>
            <ol aria-label="Playlist songs" className="grid">
              {p.items.map((item, i) => (
                <SortableRow
                  key={item.itemId}
                  itemId={item.itemId}
                  items={queue}
                  index={i}
                  onMove={(to) => move.mutate({ itemId: item.itemId, to })}
                  onRemove={() => remove.mutate(item.itemId)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      {move.error || remove.error ? <FormError message="That change couldn’t be saved, so it was undone." /> : null}
      {editing && <EditDetailsDialog playlist={p} onClose={() => setEditing(false)} />}
    </section>
  );
}
