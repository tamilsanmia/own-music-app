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
