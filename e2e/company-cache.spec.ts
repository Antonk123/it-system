import { test, expect, type Page } from '@playwright/test';
import { E2E_ADMIN } from './constants';

declare global {
  interface Window { __companyCacheSession?: string }
}

const stat = (page: Page, label: string) => page.getByRole('heading', { name: label, exact: true }).locator('../..').locator('p');
const companyRow = (page: Page, name: string) => page.getByRole('row').filter({ has: page.getByRole('button', { name, exact: true }) });

async function capture(page: Page, mode: 'light' | 'dark', stage: 'before' | 'after') {
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${mode}\\b`));
    expect(await page.evaluate(() => localStorage.getItem('app-mode-theme'))).toBe(mode);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/it-audit-company-${mode}-${stage}-${width}.png`, fullPage: true, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 812 });
}

for (const mode of ['light', 'dark'] as const) {
  test(`company cache refreshes after contact and ticket creation through SPA navigation (${mode})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(theme => localStorage.setItem('app-mode-theme', theme), mode);
    await page.goto('/login');
    await page.getByLabel('E-post').fill(E2E_ADMIN.email);
    await page.getByLabel('Lösenord').fill(E2E_ADMIN.password);
    await page.getByRole('button', { name: 'Logga in', exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/);
    const suffix = `${Date.now()}`.slice(-6);
    const name = `Cache ${mode} AB ${suffix}`;
    const contactName = `Kontakt ${mode} ${suffix}`;
    const company = await page.evaluate(async companyName => {
      const modulePath = '/src/lib/api.ts';
      return (await import(modulePath)).api.createCompany({ name: companyName });
    }, name) as { id: string };

    // Prime the real company list and detail caches. No page.goto/reload is used
    // after this point; the marker must survive every React Router transition.
    await page.setViewportSize({ width: 1440, height: 812 });
    await page.goto('/companies');
    const row = companyRow(page, name);
    await expect(row.locator('td').nth(2)).toHaveText('0');
    await expect(row.locator('td').nth(3)).toHaveText('0');
    await expect(row.locator('td').nth(4)).toHaveText('0');
    const marker = `same-query-client-document-${mode}-${suffix}`;
    await page.evaluate(value => { window.__companyCacheSession = value; }, marker);
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/companies/${company.id}$`));
    await expect(page.getByText('Inga kontakter kopplade till detta företag.')).toBeVisible();
    await expect(stat(page, 'Öppna ärenden')).toHaveText('0');
    await expect(stat(page, 'Totalt ärenden')).toHaveText('0');
    await capture(page, mode, 'before');

    await page.getByRole('button', { name: 'Ny kontakt', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Lägg till ny kontakt' });
    await dialog.getByLabel('Namn *', { exact: true }).fill(contactName);
    await dialog.getByLabel('E-post *', { exact: true }).fill(`cache-${mode}-${suffix}@example.test`);
    await expect(dialog.getByRole('combobox', { name: 'Företag', exact: true })).toHaveText(name);
    await dialog.getByRole('button', { name: 'Lägg till kontakt', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/companies/${company.id}$`));
    await expect(page.getByText(contactName, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__companyCacheSession)).toBe(marker);
    await page.getByRole('button', { name: 'Tillbaka', exact: true }).click();
    await expect(companyRow(page, name).locator('td').nth(2)).toHaveText('1');
    await page.getByRole('button', { name, exact: true }).click();

    // The requester's company is selected by the actual ticket form.
    await page.getByRole('link', { name: 'Nytt ärende', exact: true }).click();
    const title = `Cacheärende ${mode} ${suffix}`;
    await page.getByLabel('Titel *', { exact: true }).fill(title);
    await page.getByRole('combobox', { name: 'Beställare' }).click();
    await page.getByRole('option', { name: new RegExp(contactName) }).click();
    await expect(page.getByText(`Företag: ${name} — kan ändras under Fler uppgifter.`)).toBeVisible();
    await page.locator('.ProseMirror').fill('Företagets antal ska uppdateras direkt.');
    await page.getByRole('button', { name: 'Skapa ärende', exact: true }).click();
    await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    // Creation adds a detail history entry; return through the clean form.
    await page.goBack();
    await expect(page).toHaveURL(/\/tickets\/new$/);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/companies/${company.id}$`));
    await expect(stat(page, 'Öppna ärenden')).toHaveText('1');
    await expect(stat(page, 'Totalt ärenden')).toHaveText('1');
    await expect(page.getByText(contactName, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__companyCacheSession)).toBe(marker);
    await capture(page, mode, 'after');
    await page.getByRole('button', { name: 'Tillbaka', exact: true }).click();
    const updatedRow = companyRow(page, name);
    await expect(updatedRow.locator('td').nth(2)).toHaveText('1');
    await expect(updatedRow.locator('td').nth(3)).toHaveText('1');
    await expect(updatedRow.locator('td').nth(4)).toHaveText('1');
    expect(await page.evaluate(() => window.__companyCacheSession)).toBe(marker);
    expect(errors).toEqual([]);
  });
}
