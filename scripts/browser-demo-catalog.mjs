// Real-browser walkthrough of the admin catalog pages (Task 8 demo). Runs in the Playwright
// container; see scripts/browser-demo.sh. Needs ADMIN_EMAIL/ADMIN_PASSWORD and /assets with
// cover.png, artist.png and 3 audio files.
//
// Creates "Browser Demo Artist" / "Browser Demo Album", uploads a photo, a cover and 3 tracks
// through the UI, and waits until the worker has made all of them READY. Leaves them in place.
import { readdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'https://music.snowsig.in';
const OUT = process.env.OUT_DIR ?? '/out';
const ASSETS = '/assets';
const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
const step = (msg) => console.log(`==> ${msg}`);

const browser = await chromium.launch();
const errors = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on('console', (m) => m.type() === 'error' && !/status of 401/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  step('Log in');
  await page.goto(`${BASE}/admin/artists`);
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByRole('heading', { name: 'Artists' }).waitFor();

  step('Create artist and upload a photo');
  await page.getByRole('button', { name: 'New artist' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Browser Demo Artist');
  await page.getByRole('dialog').getByLabel('Bio').fill('Created by scripts/browser-demo-catalog.mjs');
  await page.getByRole('button', { name: 'Create artist' }).click();
  await page.getByLabel('Name').and(page.locator('[value="Browser Demo Artist"]')).waitFor();
  await page.getByLabel('Choose Photo of Browser Demo Artist').setInputFiles(`${ASSETS}/artist.png`);
  await page.getByRole('img', { name: 'Photo of Browser Demo Artist' }).and(page.locator('img')).waitFor();

  step('Create album and upload a cover');
  await page.getByRole('button', { name: 'New album' }).click();
  const dialog = page.getByRole('dialog', { name: 'New album' });
  await dialog.getByLabel('Title').fill('Browser Demo Album');
  await dialog.getByLabel('Release year').fill('2026');
  await dialog.getByRole('button', { name: 'Create album' }).click();
  await page.getByRole('heading', { name: 'Tracks' }).waitFor();
  await page.getByLabel('Choose Browser Demo Album cover').setInputFiles(`${ASSETS}/cover.png`);
  await page.getByRole('img', { name: 'Browser Demo Album cover' }).and(page.locator('img')).waitFor();

  step('Upload 3 tracks');
  const audio = readdirSync(ASSETS).filter((f) => f.endsWith('.mp3')).sort();
  await page.getByLabel('Choose audio files').setInputFiles(audio.map((f) => `${ASSETS}/${f}`));
  await page.getByRole('progressbar').first().waitFor();
  await page.screenshot({ path: `${OUT}/1-uploading.png` });

  step('Wait for the worker to convert all of them');
  const started = Date.now();
  await page.getByText(`${audio.length} of ${audio.length} ready to play`).waitFor({ timeout: 300_000 });
  console.log(`    all ready after ${Math.round((Date.now() - started) / 1000)} s`);
  await page.getByRole('button', { name: 'Clear finished' }).click();
  await page.screenshot({ path: `${OUT}/2-album-ready.png`, fullPage: true });

  step('Album appears in the Albums list');
  await page.getByRole('link', { name: 'Albums', exact: true }).click();
  await page.getByRole('link', { name: 'Browser Demo Album' }).waitFor();
  await page.screenshot({ path: `${OUT}/3-albums.png` });

  if (errors.length) throw new Error(`browser console errors:\n${errors.join('\n')}`);
  console.log('OK');
} finally {
  await browser.close();
}
