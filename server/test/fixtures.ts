import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../src/audio/ffmpeg';

/** Generated test audio, so no binary fixtures live in the repo. */
export async function makeFixtures(dir: string) {
  mkdirSync(dir, { recursive: true });
  const wav = join(dir, 'tone.wav');
  await run(
    'ffmpeg',
    ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-ac', '2', '-ar', '44100', wav],
    { timeoutMs: 30_000 },
  );
  const text = join(dir, 'notes.mp3');
  writeFileSync(text, 'this is not audio, despite the extension\n'.repeat(100));
  return { wav, wavBytes: readFileSync(wav), text, textBytes: readFileSync(text) };
}

/** A 24-bit / 96 kHz FLAC (hi-res lossless) and a lossy MP3, for the lossless stream tests. */
export async function makeAudioFormats(dir: string) {
  mkdirSync(dir, { recursive: true });
  const flac = join(dir, 'hires.flac');
  const mp3 = join(dir, 'lossy.mp3');
  const tone = ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=8:sample_rate=96000', '-ac', '2'];
  await run('ffmpeg', ['-loglevel', 'error', '-y', ...tone, '-c:a', 'flac', '-sample_fmt', 's32', flac], { timeoutMs: 30_000 });
  await run('ffmpeg', ['-loglevel', 'error', '-y', ...tone, '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', mp3], {
    timeoutMs: 30_000,
  });
  return { flac, mp3 };
}
