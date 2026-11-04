// Real-browser check of playlists (Task 11): create one from the sidebar, add 3 songs with the
// ⋯ menu, drag the last song to the top with the mouse, reload to confirm it was saved, then
// delete the playlist. See scripts/browser-demo.sh.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'https://music.snowsig.in';
const OUT = process.env.OUT_DIR ?? '/out';
const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
const step = (msg) => console.log(`==> ${msg}`);

const browser = await chromium.launch();
const errors = [];
let page;
try {
  page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  page.on('console', (m) => m.type() === 'error' && !/status of 401/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  const songs = () => page.getByRole('list', { name: 'Playlist songs' }).getByRole('listitem').locator('p').first();
  const order = async () =>
    page.getByRole('list', { name: 'Playlist songs' }).getByRole('listitem').evaluateAll((lis) => lis.map((li) => li.querySelector('p').textContent));

  step('Log in');
  await page.goto(BASE);
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();

  step('Create a playlist with the sidebar +');
  await page.getByRole('navigation', { name: 'Your playlists' }).getByRole('button', { name: 'New playlist' }).click();
  const heading = page.getByRole('heading', { level: 1 });
  await heading.filter({ hasText: /My Playlist #\d+/ }).waitFor();
  const name = await heading.textContent();
  const playlistUrl = page.url();
  console.log(`    ${name}`);

  step('Add the first 3 songs of the newest album');
  await page.goto(BASE);
  await page.getByRole('list', { name: 'New albums' }).getByRole('link').first().click();
  const titles = await page.getByRole('list', { name: 'Tracks' }).getByRole('listitem').evaluateAll((lis) =>
    lis.slice(0, 3).map((li) => li.querySelector('p').textContent),
  );
  for (const title of titles) {
    await page.getByRole('listitem').filter({ hasText: title }).first().hover();
    await page.getByRole('button', { name: `More options for ${title}` }).click();
    await page.getByRole('menuitem', { name: 'Add to playlist' }).click();
    await page.getByRole('dialog', { name: 'Add to playlist' }).getByRole('button', { name: new RegExp(name) }).click();
    await page.getByRole('status').filter({ hasText: `Added to ${name}` }).waitFor();
  }
  console.log(`    added: ${titles.join(' | ')}`);

  step('Drag the last song to the top');
  await page.goto(playlistUrl);
  await songs().waitFor();
  console.log(`    before: ${(await order()).join(' | ')}`);
  const rows = page.getByRole('list', { name: 'Playlist songs' }).getByRole('listitem');
  await rows.nth(2).hover();
  const handle = page.getByRole('button', { name: `Drag to reorder ${titles[2]}` });
  const from = await handle.boundingBox();
  const to = await rows.nth(0).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(from.x + from.width / 2, from.y + (to.y + 4 - from.y) * (i / 12));
  }
  await page.mouse.up();
  await page.waitForFunction(
    (first) => document.querySelector('[aria-label="Playlist songs"] li p')?.textContent === first,
    titles[2],
  );
  const expected = [titles[2], titles[0], titles[1]];
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/1-playlist.png` });

  step('Reload: the new order was saved');
  await page.reload();
  await songs().waitFor();
  const after = await order();
  console.log(`    after reload: ${after.join(' | ')}`);
  if (after.join() !== expected.join()) throw new Error(`expected ${expected.join(' | ')}`);

  step('Delete the playlist');
  await page.getByRole('button', { name: 'Delete playlist' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await page.waitForURL(`${BASE}/`);
  await page.getByRole('navigation', { name: 'Your playlists' }).getByText(name, { exact: true }).waitFor({ state: 'detached', timeout: 5000 });

  if (errors.length) throw new Error(`browser console errors:\n${errors.join('\n')}`);
  console.log('OK');
} catch (e) {
  await page?.screenshot({ path: `${OUT}/error.png` });
  throw e;
} finally {
  await browser.close();
}
