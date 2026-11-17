import { test, expect, type Page } from '@playwright/test';
import { E2E_ADMIN } from './constants';

declare global {
  interface Window {
    __kbUpdateReady?: boolean;
    __kbNoReload?: string;
  }
}

// Vite does not serve a production service worker. Keep the real registration
// module and fake only the browser's worker container to drive controllerchange.
// These checks exercise the real form/editor/API; they do not test PWA install.
async function prepare(page: Page, mode: 'light' | 'dark') {
  await page.addInitScript(theme => {
    localStorage.setItem('app-mode-theme', theme);
    const worker = new EventTarget();
    const listen = worker.addEventListener.bind(worker);
    worker.addEventListener = (type, listener, options) => {
      if (type === 'controllerchange') window.__kbUpdateReady = true;
      listen(type, listener, options);
    };
    Object.defineProperties(worker, {
      controller: { value: {} },
      register: { value: async () => ({ installing: null, update: async () => undefined }) },
    });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: worker });
  }, mode);
  await page.goto('/login');
  await page.getByLabel('E-post').fill(E2E_ADMIN.email);
  await page.getByLabel('Lösenord').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: 'Logga in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  const name = `KB audit ${mode} ${Date.now()}`;
  const category = await page.evaluate(async categoryName => {
    const modulePath = '/src/lib/api.ts';
    const { api } = await import(modulePath);
    return api.createKbCategory(categoryName);
  }, name) as { id: string };
  await page.goto('/kb/new');
  await expect(page.getByRole('heading', { name: 'Ny artikel' })).toBeVisible();
  await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${mode}\\b`));
  expect(await page.evaluate(() => localStorage.getItem('app-mode-theme'))).toBe(mode);
  await expect.poll(() => page.evaluate(() => window.__kbUpdateReady)).toBe(true);
  expect(await hasUnsavedWork(page)).toBe(false);
  await page.getByLabel('Titel *', { exact: true }).fill(name);
  await page.getByRole('textbox', { name: 'Skriv artikelns innehåll...' }).fill('Texten ska finnas kvar under uppdatering och sparfel.');
  await page.getByRole('combobox', { name: /^Kategori/ }).click();
  await page.getByRole('option', { name, exact: true }).click();
  await expect.poll(() => hasUnsavedWork(page)).toBe(true);
  return { title: name, categoryId: category.id };
}

async function hasUnsavedWork(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const modulePath = '/src/registerSW.ts';
    return (await import(modulePath)).hasUnsavedWork();
  });
}

async function deferUpdate(page: Page) {
  const sentinel = `still-editing-${Date.now()}`;
  await page.evaluate(value => {
    window.__kbNoReload = value;
    navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
  }, sentinel);
  await expect(page.getByText('En ny version finns — appen laddas om när du sparat.')).toBeVisible();
  expect(await page.evaluate(() => window.__kbNoReload)).toBe(sentinel);
  // More edits must not briefly unregister the dirty state and flush the reload.
  await page.getByRole('textbox', { name: 'Skriv artikelns innehåll...' }).press('End');
  await page.getByRole('textbox', { name: 'Skriv artikelns innehåll...' }).pressSequentially(' Mer text efter uppdateringen.');
  expect(await page.evaluate(() => window.__kbNoReload)).toBe(sentinel);
  await expect.poll(() => hasUnsavedWork(page)).toBe(true);
  return sentinel;
}

async function capture(page: Page, mode: 'light' | 'dark') {
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${mode}\\b`));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/it-audit-kb-${mode}-${width}.png`, fullPage: true, animations: 'disabled' });
  }
}

test('KB unsaved work defers a worker update through a failed save, then reloads after successful save', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const { title } = await prepare(page, 'light');
  const sentinel = await deferUpdate(page);
  await capture(page, 'light');
  await page.route('**/api/kb/articles', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 500, json: { error: 'Tillfälligt audit-sparfel' } })
    : route.continue());
  await page.getByRole('button', { name: 'Skapa artikel', exact: true }).click();
  await expect(page.getByText('Tillfälligt audit-sparfel')).toBeVisible();
  await expect(page.getByLabel('Titel *', { exact: true })).toHaveValue(title);
  await expect(page.getByRole('textbox', { name: 'Skriv artikelns innehåll...' })).toContainText('Mer text efter uppdateringen.');
  expect(await hasUnsavedWork(page)).toBe(true);
  expect(await page.evaluate(() => window.__kbNoReload)).toBe(sentinel);
  await page.unroute('**/api/kb/articles');
  const created = page.waitForResponse(response => response.url().endsWith('/api/kb/articles') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Skapa artikel', exact: true }).click();
  expect((await created).status()).toBe(201);
  await expect(page).toHaveURL(/\/kb\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__kbNoReload)).toBeUndefined();
  expect(await hasUnsavedWork(page)).toBe(false);
  expect(errors).toEqual([]);
});

test('KB unsaved work warns before a browser reload and releases the deferred update after cancellation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const { title } = await prepare(page, 'dark');
  const sentinel = await deferUpdate(page);
  const pendingDialog = page.waitForEvent('dialog');
  // A browser-initiated reload returns after the dialog is dismissed. The
  // Playwright page.reload() helper would keep waiting for a navigation that
  // the user intentionally cancelled.
  const reload = page.evaluate(() => { window.location.reload(); });
  const dialog = await pendingDialog;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await reload;
  await expect(page.getByLabel('Titel *', { exact: true })).toHaveValue(title);
  expect(await page.evaluate(() => window.__kbNoReload)).toBe(sentinel);
  expect(await hasUnsavedWork(page)).toBe(true);
  await capture(page, 'dark');
  await page.getByRole('button', { name: 'Avbryt', exact: true }).click();
  await expect(page).toHaveURL(/\/kb$/);
  await expect(page.getByRole('heading', { name: 'Kunskapsbas', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__kbNoReload)).toBeUndefined();
  expect(await hasUnsavedWork(page)).toBe(false);
  expect(errors).toEqual([]);
});
