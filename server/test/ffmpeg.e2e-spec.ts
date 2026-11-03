import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HLS_VARIANTS, NotAudioError, probe, transcodeToHls } from '../src/audio/ffmpeg';
import { makeFixtures } from './fixtures';

/** Runs the real ffprobe/ffmpeg binaries (installed in the dev and production images). */
describe('ffmpeg integration', () => {
  let fx: Awaited<ReturnType<typeof makeFixtures>>;
  const dir = mkdtempSync(join(tmpdir(), 'music-ffmpeg-'));

  beforeAll(async () => {
    fx = await makeFixtures(dir);
  });

  it('probes duration and format', async () => {
    const info = await probe(fx.wav);
    expect(info.durationMs).toBeGreaterThanOrEqual(4990);
    expect(info.durationMs).toBeLessThanOrEqual(5010);
    expect(info.summary).toBe('pcm_s16le · 44.1 kHz · stereo');
  });

  it('rejects a file without audio', async () => {
    await expect(probe(fx.text)).rejects.toBeInstanceOf(NotAudioError);
  });

  it('writes a master playlist with three AAC renditions in one pass', async () => {
    const out = mkdtempSync(join(dir, 'hls-'));
    await transcodeToHls(fx.wav, out);

    const master = readFileSync(join(out, 'master.m3u8'), 'utf8');
    const variants = [...master.matchAll(/#EXT-X-STREAM-INF:BANDWIDTH=(\d+),CODECS="mp4a\.40\.2"\n(.+)/g)];
    expect(variants.map((m) => m[2])).toEqual(HLS_VARIANTS.map((v) => `${v.name}/index.m3u8`));
    const bandwidths = variants.map((m) => Number(m[1]));
    expect(bandwidths).toEqual([...bandwidths].sort((a, b) => a - b));

    for (const v of HLS_VARIANTS) {
      const playlist = readFileSync(join(out, v.name, 'index.m3u8'), 'utf8');
      expect(playlist).toMatch(/#EXT-X-PLAYLIST-TYPE:VOD/);
      expect(playlist).toMatch(/#EXT-X-MAP:URI="init_\d\.mp4"/);
      expect(playlist).toMatch(/#EXT-X-ENDLIST/);
      // Segment URIs are relative, so a token in the URL path carries over to them (Task 7).
      expect(playlist).not.toMatch(/^\//m);
      const total = [...playlist.matchAll(/#EXTINF:([\d.]+)/g)].reduce((s, m) => s + Number(m[1]), 0);
      expect(total).toBeGreaterThan(4.9);
      expect(total).toBeLessThan(5.2);
      const files = readdirSync(join(out, v.name));
      expect(files.filter((f) => f.endsWith('.m4s')).length).toBeGreaterThan(0);
    }
  });
});
