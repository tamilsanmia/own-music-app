import { spawn } from 'node:child_process';

/** HLS renditions, lowest first. Folder names double as variant names in master.m3u8. */
export const HLS_VARIANTS = [
  { name: '96k', bitrate: '96k' },
  { name: '160k', bitrate: '160k' },
  { name: '320k', bitrate: '320k' },
] as const;
export const HLS_SEGMENT_SECONDS = 6;

export class CommandError extends Error {
  constructor(
    message: string,
    /** Tail of stderr, for the admin-facing error message. */
    readonly stderrTail: string,
  ) {
    super(message);
  }
}

interface RunOptions {
  cwd?: string;
  timeoutMs: number;
  /** Name used in error messages (e.g. "ffmpeg" when the command is run through `nice`). */
  label?: string;
  /** Strings to hide in stderr, such as server file paths. */
  redact?: string[];
}

const STDERR_TAIL_BYTES = 2000;

/** Run a command, collect stdout, keep the end of stderr, and kill it after timeoutMs. */
export function run(cmd: string, args: string[], opts: RunOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);

    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => {
      err = (err + c.toString('utf8')).slice(-STDERR_TAIL_BYTES);
    });
    const label = opts.label ?? cmd;
    const tail = () => (opts.redact ?? []).reduce((s, r) => s.split(r).join('<input>'), err).trim();
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new CommandError(`${label} could not start: ${e.message}`, ''));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new CommandError(`${label} timed out`, tail()));
      if (code !== 0) return reject(new CommandError(`${label} exited with code ${code}`, tail()));
      resolve(Buffer.concat(out).toString('utf8'));
    });
  });
}

export interface ProbeResult {
  durationMs: number;
  codec: string;
  sampleRate: number | null;
  channels: number | null;
  /** Human-readable summary, e.g. "flac · 44.1 kHz · stereo". */
  summary: string;
}

export class NotAudioError extends Error {}

interface FfprobeOutput {
  format?: { duration?: string; format_name?: string };
  streams?: { codec_type?: string; codec_name?: string; sample_rate?: string; channels?: number; duration?: string }[];
}

function channelLabel(n: number | null): string | null {
  if (n === 1) return 'mono';
  if (n === 2) return 'stereo';
  return n ? `${n} ch` : null;
}

/** Inspect a file with ffprobe. Throws NotAudioError if it has no usable audio stream. */
export async function probe(file: string): Promise<ProbeResult> {
  let raw: string;
  try {
    raw = await run(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { timeoutMs: 60_000, redact: [file] },
    );
  } catch (e) {
    throw new NotAudioError(e instanceof CommandError && e.stderrTail ? e.stderrTail.split('\n')[0] : 'unreadable file');
  }

  const data = JSON.parse(raw) as FfprobeOutput;
  const audio = data.streams?.find((s) => s.codec_type === 'audio');
  if (!audio) throw new NotAudioError('the file has no audio stream');

  const seconds = Number(data.format?.duration ?? audio.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new NotAudioError('the audio has no duration');

  const sampleRate = audio.sample_rate ? Number(audio.sample_rate) : null;
  const channels = audio.channels ?? null;
  const codec = audio.codec_name ?? 'unknown';
  const summary = [codec, sampleRate ? `${(sampleRate / 1000).toString()} kHz` : null, channelLabel(channels)]
    .filter(Boolean)
    .join(' · ');
  return { durationMs: Math.round(seconds * 1000), codec, sampleRate, channels, summary };
}

/** ffmpeg arguments for one pass that writes master.m3u8 plus one fMP4 HLS folder per variant. */
export function hlsArgs(input: string): string[] {
  const n = HLS_VARIANTS.length;
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-i', input,
    ...Array.from({ length: n }, () => ['-map', '0:a:0']).flat(),
    '-map_metadata', '-1',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2',
    ...HLS_VARIANTS.flatMap((v, i) => [`-b:a:${i}`, v.bitrate]),
    '-f', 'hls',
    '-hls_time', String(HLS_SEGMENT_SECONDS),
    '-hls_playlist_type', 'vod',
    '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', '%v/seg_%03d.m4s',
    '-master_pl_name', 'master.m3u8',
    '-var_stream_map', HLS_VARIANTS.map((v, i) => `a:${i},name:${v.name}`).join(' '),
    '%v/index.m3u8',
  ];
}

/**
 * Transcode `input` into HLS inside the (empty) directory `outDir`. ffmpeg runs at lower CPU
 * priority so transcoding doesn't slow the other apps on the server.
 */
export async function transcodeToHls(input: string, outDir: string, timeoutMs = 30 * 60_000): Promise<void> {
  await run('nice', ['-n', '10', 'ffmpeg', ...hlsArgs(input)], {
    cwd: outDir,
    timeoutMs,
    label: 'ffmpeg',
    redact: [input],
  });
}
