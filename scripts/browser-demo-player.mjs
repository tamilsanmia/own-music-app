// Real-browser playback check (Task 9). Runs Google Chrome (which has the AAC decoder that
// Playwright's own Chromium lacks) against production. See scripts/browser-demo.sh.
//
// Logs in, opens the newest album, presses Play, and checks that time actually advances,
// segments stream with 200s, the Media Session has the track, and Next moves to track 2.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'https://music.snowsig.in';
const OUT = process.env.OUT_DIR ?? '/out';
const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
const step = (msg) => console.log(`==> ${msg}`);

const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || undefined,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
const stream = { ok: 0, refused: 0, segments: 0, variants: new Set() };
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on('console', (m) => m.type() === 'error' && !/status of 401/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    const m = r.url().match(/\/stream\/[^/]+\/[^/]+\/(?:(\d+k)\/)?(.+)$/);
    if (!m) return;
    if (r.status() < 300) stream.ok++;
    else stream.refused++;
    if (m[1]) stream.variants.add(m[1]);
    if (m[2].endsWith('.m4s')) stream.segments++;
  });

  step(`Log in (${await browser.version()})`);
  await page.goto(BASE);
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();

  step('Open the newest album');
  const grid = page.getByRole('list', { name: 'New albums' });
  await grid.waitFor();
  await grid.getByRole('link').first().click();
  const title = await page.getByRole('heading', { level: 1 }).textContent();
  console.log(`    ${title}`);

  step('Play and check that time advances');
  await page.getByRole('button', { name: 'Play album' }).click();
  const player = page.getByRole('contentinfo', { name: 'Player' });
  const first = await player.getByRole('link', { name: /^Now playing:/ }).textContent();
  const seek = player.getByRole('slider', { name: 'Seek' });
  await page.waitForFunction(
    () => Number(document.querySelector('input[aria-label="Seek"]')?.value ?? 0) >= 4,
    null,
    { timeout: 30_000 },
  );
  console.log(`    "${first}" at ${Number(await seek.inputValue()).toFixed(1)} s`);
  if (await player.getByRole('alert').count()) throw new Error(await player.getByRole('alert').textContent());
  const session = await page.evaluate(() => {
    const m = navigator.mediaSession.metadata;
    return m && { title: m.title, artist: m.artist, album: m.album, artwork: m.artwork.length };
  });
  console.log(`    Media Session: ${JSON.stringify(session)}`);
  if (session?.title !== first) throw new Error('Media Session metadata does not match the playing track');
  await page.screenshot({ path: `${OUT}/1-playing.png` });

  step('Seek to 10 s');
  await seek.focus();
  await seek.fill('10');
  await page.keyboard.press('ArrowRight'); // keyup commits the seek
  await page.waitForFunction(() => Number(document.querySelector('input[aria-label="Seek"]')?.value ?? 0) >= 10, null, { timeout: 15_000 });

  step('Next track');
  await player.getByRole('button', { name: 'Next' }).click();
  const nowLink = player.getByRole('link', { name: /^Now playing:/ });
  await page.waitForFunction((t) => !document.querySelector('[aria-label^="Now playing:"]')?.textContent?.includes(t), first);
  const second = await nowLink.textContent();
  await page.waitForFunction(() => Number(document.querySelector('input[aria-label="Seek"]')?.value ?? 0) >= 2, null, { timeout: 30_000 });
  console.log(`    "${second}" playing`);

  step('Pause stops time');
  await player.getByRole('button', { name: 'Pause' }).click();
  const paused = Number(await seek.inputValue());
  await page.waitForTimeout(1500);
  if (Number(await seek.inputValue()) - paused > 0.3) throw new Error('time kept moving while paused');
  await page.screenshot({ path: `${OUT}/2-paused.png` });

  console.log(`    stream requests: ${stream.ok} ok, ${stream.refused} refused, ${stream.segments} segments, variants ${[...stream.variants].join(',')}`);
  if (stream.refused) throw new Error('some stream requests were refused');
  if (errors.length) throw new Error(`browser console errors:\n${errors.join('\n')}`);
  console.log('OK');
} finally {
  await browser.close();
}
