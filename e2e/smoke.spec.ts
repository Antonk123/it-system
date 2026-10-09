import { test, expect, type Page } from '@playwright/test';
import { E2E_ADMIN, E2E_CONTACT } from './constants';

// Giltig 1x1 PNG (transparent).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const uniqueTitle = (prefix: string) => `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('E-post').fill(E2E_ADMIN.email);
  await page.getByLabel('Lösenord').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: 'Logga in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** Skapar ett ärende via UI:t och landar på detaljsidan. */
async function createTicket(page: Page, title: string, opts: { attach?: boolean } = {}) {
  await page.goto('/tickets/new');
  await expect(page.getByRole('heading', { name: 'Skapa nytt ärende' })).toBeVisible();
  await page.getByLabel('Titel *').fill(title);

  await page.getByRole('combobox', { name: 'Beställare' }).click();
  await page.getByRole('option', { name: new RegExp(E2E_CONTACT.name) }).click();

  if (opts.attach) {
    // Filinputen är dold (den andra, sr-only, är kamera-/foto-input); setInputFiles fungerar ändå och triggar onChange.
    await page.locator('input[type="file"].hidden').setInputFiles({
      name: 'pixel.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    });
    await expect(page.getByText('pixel.png')).toBeVisible();
  }

  await page.getByRole('button', { name: 'Skapa ärende' }).click();
  await expect(page).toHaveURL(/\/tickets\/[^/]+$/);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

test.describe('oautentiserat', () => {
  test('publika ärendeformuläret renderas', async ({ page }) => {
    await page.goto('/submit-ticket');
    await expect(page.getByRole('heading', { name: 'Skicka en supportförfrågan' })).toBeVisible();
    await expect(page.getByLabel('Ditt namn *')).toBeVisible();
    await expect(page.getByLabel('Din e-post *')).toBeVisible();
    await expect(page.getByLabel('Ärendets titel *')).toBeVisible();
  });

  test('okänd API-väg svarar JSON 404', async ({ request }) => {
    const res = await request.get('/api/finns-inte');
    expect(res.status()).toBe(404);
    expect(res.headers()['content-type']).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});

test.describe('inloggning', () => {
  test('fel lösenord ger felmeddelande utan omladdning', async ({ page }) => {
    await page.goto('/login');
    // Sentinel på window: överlever bara om sidan INTE laddas om.
    await page.evaluate(() => {
      (window as unknown as { __noReload: boolean }).__noReload = true;
    });
    await page.getByLabel('E-post').fill(E2E_ADMIN.email);
    await page.getByLabel('Lösenord').fill('fel-losenord-123');
    await page.getByRole('button', { name: 'Logga in', exact: true }).click();

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Logga in', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
  });

  test('fel lösenord visar svenskt felmeddelande', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-post').fill(E2E_ADMIN.email);
    await page.getByLabel('Lösenord').fill('fel-losenord-123');
    await page.getByRole('button', { name: 'Logga in', exact: true }).click();
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toContainText(
      /felaktig|fel e-post|fel lösenord|ogiltig/i,
    );
  });

  test('rätt lösenord landar på startsidan', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button', { name: 'Logga ut' })).toBeVisible();
  });
});

test.describe('ärendeflöde', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('skapa ärende', async ({ page }) => {
    const title = uniqueTitle('E2E skapa');
    await createTicket(page, title);
    await page.goto('/tickets');
    await expect(page.getByRole('cell', { name: title, exact: true })).toBeVisible();
  });

  test('ändra status', async ({ page }) => {
    await createTicket(page, uniqueTitle('E2E status'));
    // Statusväljaren saknar tillgängligt namn (combobox utan label) → hitta via sin roll.
    const status = page.getByRole('combobox');
    await expect(status).toHaveText('Öppen');
    await status.click();
    await page.getByRole('option', { name: 'Pågående' }).click();
    await expect(page.getByText('Status uppdaterad till Pågående')).toBeVisible();
    await expect(status).toHaveText('Pågående');

    // Överlever omladdning = sparad i backend.
    await page.reload();
    await expect(page.getByRole('combobox')).toHaveText('Pågående');
  });

  test('lägga till kommentar', async ({ page }) => {
    await createTicket(page, uniqueTitle('E2E kommentar'));
    const comment = `Kommentar från e2e ${Date.now()}`;
    await page.getByRole('textbox', { name: 'Lägg till en intern kommentar...' }).fill(comment);
    await page.getByRole('button', { name: 'Lägg till kommentar' }).click();
    await expect(page.getByText('Intern kommentar tillagd')).toBeVisible();
    await expect(page.getByText(comment)).toBeVisible();
    await expect(page.getByText('Kommentarer (1)')).toBeVisible();
  });

  test('ladda upp bilaga (png)', async ({ page }) => {
    await createTicket(page, uniqueTitle('E2E bilaga'), { attach: true });
    await expect(page.getByRole('heading', { name: 'Bilagor (1)' })).toBeVisible();
    await expect(page.getByText('pixel.png').first()).toBeVisible();

    // Filen ligger kvar på disk och går att hämta: miniatyren laddas via /api/attachments/file/:id.
    const thumb = page.getByRole('img', { name: 'pixel.png' });
    await expect(thumb).toBeVisible();
    await expect.poll(() => thumb.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
  });
});

test.describe('utloggning', () => {
  test('logga ut skickar tillbaka till inloggningen', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Logga ut' }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: 'Logga in', exact: true })).toBeVisible();

    // Skyddad sida är inte längre nåbar.
    await page.goto('/tickets');
    await expect(page).toHaveURL(/\/login/);
  });
});
