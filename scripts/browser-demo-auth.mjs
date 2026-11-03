// Real-browser walkthrough of the deployed web app (Task 4 demo).
// Runs in the Playwright container; see scripts/browser-demo.sh. Needs ADMIN_EMAIL/ADMIN_PASSWORD.
//
// 1. A logged-out visit to /admin/users goes to the login page.
// 2. The admin logs in, lands back on /admin/users, and adds a listener.
// 3. A page reload keeps the session (refresh cookie over real HTTPS).
// 4. The listener logs in, sees no admin section, and /admin/users sends them home.
// 5. The admin deactivates the demo listener again.
// Fails on any browser console error (e.g. a CSP violation).
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'https://music.snowsig.in';
const OUT = process.env.OUT_DIR ?? '/out';
const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required');

const browser = await chromium.launch();
const errors = [];
const step = (msg) => console.log(`==> ${msg}`);

async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  // 401s are expected (session check while logged out, deactivated listener). Anything else,
  // such as a CSP violation ("Refused to ...") or a script error, fails the demo.
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 401/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return page;
}

async function login(page, email, password) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
}

try {
  const admin = await newPage();

  step('Logged-out visit to /admin/users shows the login page');
  await admin.goto(`${BASE}/admin/users`);
  await admin.getByRole('heading', { name: 'Log in to Music' }).waitFor();
  await admin.screenshot({ path: `${OUT}/1-login.png` });

  step('Admin logs in and returns to Users');
  await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
  await admin.getByRole('heading', { name: 'Users' }).waitFor();
  if (!admin.url().endsWith('/admin/users')) throw new Error(`expected /admin/users, got ${admin.url()}`);

  step('Admin adds a listener');
  const email = `browser-demo-${Date.now()}@music.snowsig.in`;
  await admin.getByRole('button', { name: 'Add listener' }).click();
  const dialog = admin.getByRole('dialog', { name: 'Add listener' });
  await dialog.getByLabel('Name').fill('Browser Demo');
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByRole('button', { name: 'Generate' }).click();
  const password = await dialog.getByLabel('Password').inputValue();
  await admin.screenshot({ path: `${OUT}/2-add-listener.png` });
  await dialog.getByRole('button', { name: 'Create account' }).click();
  await admin.getByRole('table').getByText(email).waitFor();
  await admin.screenshot({ path: `${OUT}/3-users.png` });

  step('Reload keeps the admin logged in');
  await admin.reload();
  await admin.getByRole('heading', { name: 'Users' }).waitFor();

  step('Listener logs in in a separate browser profile');
  const listener = await newPage();
  await listener.goto(`${BASE}/`);
  await login(listener, email, password);
  await listener.getByRole('heading', { name: /Browser Demo$/ }).waitFor();
  if (await listener.getByRole('navigation', { name: 'Admin' }).count()) throw new Error('listener sees admin nav');
  await listener.screenshot({ path: `${OUT}/4-listener-home.png` });

  step('Listener is sent home from /admin/users');
  await listener.goto(`${BASE}/admin/users`);
  await listener.getByRole('heading', { name: /Browser Demo$/ }).waitFor();
  if (!listener.url().endsWith('/')) throw new Error(`expected /, got ${listener.url()}`);

  step('Admin deactivates the demo listener');
  await admin.getByRole('button', { name: `Deactivate ${email}` }).click();
  await admin.getByRole('row', { name: new RegExp(email) }).getByText('Deactivated').waitFor();

  step('Listener is logged out on the next request');
  await listener.goto(`${BASE}/account`);
  await listener.getByRole('heading', { name: 'Log in to Music' }).waitFor();

  if (errors.length) throw new Error(`browser console errors:\n${errors.join('\n')}`);
  console.log('OK');
} finally {
  await browser.close();
}
