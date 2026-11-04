import { spawn } from 'node:child_process';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
  /** Bit depth of lossless audio (16, 24, …); null when unknown or lossy. */
  bitDepth: number | null;
  /** Human-readable summary, e.g. "flac · 44.1 kHz · 24-bit · stereo". */
  summary: string;
}

/** Codecs that keep every bit of the studio master. Only these get a lossless (FLAC) stream. */
const LOSSLESS_CODECS = /^(flac|alac|wavpack|ape|tta|truehd|mlp|pcm_[a-z0-9]+)$/;

export function isLosslessCodec(codec: string): boolean {
  return LOSSLESS_CODECS.test(codec);
}

export class NotAudioError extends Error {}

interface FfprobeOutput {
  format?: { duration?: string; format_name?: string };
  streams?: {
    codec_type?: string;
    codec_name?: string;
    sample_rate?: string;
    channels?: number;
    duration?: string;
    bits_per_raw_sample?: string;
    bits_per_sample?: number;
    sample_fmt?: string;
  }[];
}

/** Bit depth from ffprobe: FLAC reports bits_per_raw_sample, PCM reports bits_per_sample. */
function bitDepthOf(s: NonNullable<FfprobeOutput['streams']>[number], codec: string): number | null {
  if (!isLosslessCodec(codec)) return null;
  const raw = Number(s.bits_per_raw_sample);
  if (Number.isInteger(raw) && raw > 0) return raw;
  if (s.bits_per_sample && s.bits_per_sample > 0) return s.bits_per_sample;
  if (s.sample_fmt?.startsWith('s16')) return 16;
  if (s.sample_fmt?.startsWith('s32') || s.sample_fmt?.startsWith('flt')) return 24;
  return null;
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
  const bitDepth = bitDepthOf(audio, codec);
  const summary = [
    codec,
    sampleRate ? `${(sampleRate / 1000).toString()} kHz` : null,
    bitDepth ? `${bitDepth}-bit` : null,
    channelLabel(channels),
  ]
    .filter(Boolean)
    .join(' · ');
  return { durationMs: Math.round(seconds * 1000), codec, sampleRate, channels, bitDepth, summary };
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

/** Folder and playlist of the lossless stream, next to the AAC variants. */
export const LOSSLESS_DIR = 'flac';
export const LOSSLESS_PLAYLIST = 'lossless.m3u8';
/** Higher rates are resampled: phones can't play them natively and files get huge. */
export const LOSSLESS_MAX_SAMPLE_RATE = 96_000;

/**
 * ffmpeg arguments for a FLAC-in-fMP4 HLS stream in flac/. Keeps the original sample rate (up
 * to 96 kHz) and bit depth (16 or 24-bit); more than two channels are mixed down to stereo.
 * "-strict -2": ffmpeg 5.1 still marks FLAC in MP4 as experimental.
 */
export function losslessArgs(input: string, info: Pick<ProbeResult, 'sampleRate' | 'bitDepth' | 'channels'>): string[] {
  const hiRes = (info.bitDepth ?? 16) > 16;
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-i', input,
    '-map', '0:a:0',
    '-map_metadata', '-1',
    '-c:a', 'flac', '-compression_level', '5', '-strict', '-2',
    ...(hiRes ? ['-sample_fmt', 's32', '-bits_per_raw_sample', '24'] : ['-sample_fmt', 's16']),
    ...(info.sampleRate && info.sampleRate > LOSSLESS_MAX_SAMPLE_RATE ? ['-ar', String(LOSSLESS_MAX_SAMPLE_RATE)] : []),
    ...(info.channels && info.channels > 2 ? ['-ac', '2'] : []),
    '-f', 'hls',
    '-hls_time', String(HLS_SEGMENT_SECONDS),
    '-hls_playlist_type', 'vod',
    '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', `${LOSSLESS_DIR}/seg_%03d.m4s`,
    `${LOSSLESS_DIR}/index.m3u8`,
  ];
}

/**
 * Write flac/ and lossless.m3u8 into `outDir`. The multivariant playlist is written here rather
 * than by ffmpeg, so it names the codec (fLaC) and the real average bitrate.
 */
export async function transcodeLossless(
  input: string,
  outDir: string,
  info: Pick<ProbeResult, 'sampleRate' | 'bitDepth' | 'channels' | 'durationMs'>,
  timeoutMs = 30 * 60_000,
): Promise<void> {
  const dir = join(outDir, LOSSLESS_DIR);
  await mkdir(dir, { recursive: true });
  await run('nice', ['-n', '10', 'ffmpeg', ...losslessArgs(input, info)], {
    cwd: outDir,
    timeoutMs,
    label: 'ffmpeg (lossless)',
    redact: [input],
  });
  const files = await readdir(dir);
  let bytes = 0;
  for (const f of files) if (f.endsWith('.m4s')) bytes += (await stat(join(dir, f))).size;
  const seconds = Math.max(1, info.durationMs / 1000);
  const bandwidth = Math.max(1, Math.round((bytes * 8) / seconds));
  await writeFile(
    join(outDir, LOSSLESS_PLAYLIST),
    `#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},CODECS="fLaC"\n${LOSSLESS_DIR}/index.m3u8\n`,
  );
}
