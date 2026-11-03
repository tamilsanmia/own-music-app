import { Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useShallow } from 'zustand/react/shallow';
import { Spinner } from '@/components/ui/spinner';
import { formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import { destroyEngine, getEngine } from './engine';
import { currentTrack, usePlayer } from './store';

/** Mount once inside the logged-in layout. Stops playback and clears the queue on logout. */
export function usePlaybackEngine(): void {
  useEffect(() => {
    getEngine();
    return () => {
      usePlayer.getState().reset();
      destroyEngine();
    };
  }, []);
}

function IconButton({
  label,
  onClick,
  active,
  disabled,
  children,
  className,
}: {
  label: string;
  onClick(): void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative flex size-8 items-center justify-center rounded-full transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40 [&_svg]:size-4',
        active ? 'text-primary hover:text-primary-hover' : 'text-muted',
        className,
      )}
    >
      {children}
      {active && <span className="absolute -bottom-0.5 size-1 rounded-full bg-primary" aria-hidden />}
    </button>
  );
}

function SeekBar() {
  const { currentTime, duration } = usePlayer(useShallow((s) => ({ currentTime: s.currentTime, duration: s.duration })));
  // While dragging, show the drag position instead of the playing position.
  const [dragging, setDragging] = useState<number | null>(null);
  const value = dragging ?? currentTime;
  const max = duration > 0 ? duration : 0;
  const pct = max ? (Math.min(value, max) / max) * 100 : 0;

  return (
    <div className="flex w-full items-center gap-2 text-xs tabular-nums text-muted">
      <span className="w-10 text-right">{formatDuration(value * 1000)}</span>
      <input
        type="range"
        aria-label="Seek"
        min={0}
        max={max || 1}
        step={0.1}
        value={Math.min(value, max || 1)}
        disabled={!max}
        onChange={(e) => setDragging(Number(e.target.value))}
        onPointerUp={() => {
          if (dragging !== null) getEngine().seek(dragging);
          setDragging(null);
        }}
        onKeyUp={() => {
          if (dragging !== null) getEngine().seek(dragging);
          setDragging(null);
        }}
        className="range h-1 flex-1"
        style={{ '--pct': `${pct}%` } as CSSProperties}
      />
      <span className="w-10">{formatDuration(max * 1000)}</span>
    </div>
  );
}

function VolumeControl() {
  const { volume, muted, setVolume, toggleMute } = usePlayer(
    useShallow((s) => ({ volume: s.volume, muted: s.muted, setVolume: s.setVolume, toggleMute: s.toggleMute })),
  );
  const shown = muted ? 0 : volume;
  const Icon = shown === 0 ? VolumeX : shown < 0.5 ? Volume1 : Volume2;
  return (
    <div className="flex items-center gap-2">
      <IconButton label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute}>
        <Icon aria-hidden />
      </IconButton>
      <input
        type="range"
        aria-label="Volume"
        min={0}
        max={1}
        step={0.01}
        value={shown}
        onChange={(e) => setVolume(Number(e.target.value))}
        className="range h-1 w-24"
        style={{ '--pct': `${shown * 100}%` } as CSSProperties}
      />
    </div>
  );
}

export function PlayerBar() {
  const s = usePlayer(
    useShallow((p) => ({
      track: currentTrack(p),
      playing: p.playing,
      buffering: p.buffering,
      error: p.error,
      shuffle: p.shuffle,
      repeat: p.repeat,
      togglePlay: p.togglePlay,
      next: p.next,
      prev: p.prev,
      toggleShuffle: p.toggleShuffle,
      cycleRepeat: p.cycleRepeat,
    })),
  );
  if (!s.track) return null;
  const { track } = s;

  return (
    <footer aria-label="Player" className="grid h-20 shrink-0 grid-cols-[1fr_2fr_1fr] items-center gap-4 px-2">
      <div className="flex min-w-0 items-center gap-3">
        {track.album.cover ? (
          <img src={track.album.cover.small} alt="" className="size-14 rounded-md object-cover" />
        ) : (
          <div className="size-14 rounded-md bg-surface-3" aria-hidden />
        )}
        <div className="min-w-0">
          <Link to={`/albums/${track.album.id}`} className="block truncate text-sm font-semibold hover:underline" aria-label={`Now playing: ${track.title}`}>
            {track.title}
          </Link>
          <Link to={`/artists/${track.artist.id}`} className="block truncate text-xs text-muted hover:text-foreground hover:underline">
            {track.artist.name}
          </Link>
        </div>
      </div>

      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-3">
          <IconButton label="Shuffle" onClick={s.toggleShuffle} active={s.shuffle}>
            <Shuffle aria-hidden />
          </IconButton>
          <IconButton label="Previous" onClick={s.prev}>
            <SkipBack aria-hidden className="fill-current" />
          </IconButton>
          <button
            type="button"
            onClick={s.togglePlay}
            aria-label={s.playing ? 'Pause' : 'Play'}
            className="flex size-9 items-center justify-center rounded-full bg-foreground text-background transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {s.playing && s.buffering ? (
              <Spinner label="Buffering" className="text-background" />
            ) : s.playing ? (
              <Pause className="size-4 fill-current" aria-hidden />
            ) : (
              <Play className="ml-0.5 size-4 fill-current" aria-hidden />
            )}
          </button>
          <IconButton label="Next" onClick={() => s.next()}>
            <SkipForward aria-hidden className="fill-current" />
          </IconButton>
          <IconButton
            label={s.repeat === 'one' ? 'Repeat one' : s.repeat === 'all' ? 'Repeat all' : 'Repeat'}
            onClick={s.cycleRepeat}
            active={s.repeat !== 'off'}
          >
            {s.repeat === 'one' ? <Repeat1 aria-hidden /> : <Repeat aria-hidden />}
          </IconButton>
        </div>
        {s.error ? (
          <p role="alert" className="text-xs text-danger">
            {s.error}
          </p>
        ) : (
          <SeekBar />
        )}
      </div>

      <div className="flex justify-end">
        <VolumeControl />
      </div>
    </footer>
  );
}
