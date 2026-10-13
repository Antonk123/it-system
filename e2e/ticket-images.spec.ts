import { test, expect, type Page } from '@playwright/test';
import templates from './fixtures/ticket-templates.json' with { type: 'json' };
import { E2E_ADMIN, E2E_CONTACT } from './constants';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const file = { name: 'screen.png', mimeType: 'image/png', buffer: png };
let counter = 20;

test.beforeAll(async ({ request }) => {
  const csrf = (await (await request.get('/api/csrf-token')).json()).csrfToken;
  const login = await request.post('/api/auth/login', { data: E2E_ADMIN, headers: { 'X-CSRF-Token': csrf } });
  expect(login.ok()).toBeTruthy();
  const { accessToken } = await login.json();
  const auth = { Authorization: `Bearer ${accessToken}` };
  const token = (await (await request.get('/api/csrf-token', { headers: auth })).json()).csrfToken;
  const headers = { ...auth, 'X-CSRF-Token': token };
  const existing = await (await request.get('/api/templates', { headers })).json();
  if (!(await (await request.get('/api/public/categories')).json()).some((c: { label: string }) => c.label === 'Testkategori')) await request.post('/api/categories', { headers, data: { label: 'Testkategori' } });
  await request.post('/api/users', { headers, data: { email: 'image-user@example.com', password: 'Temporary-Images123!', role: 'user', displayName: 'Bildtest användare' } });
  for (const template of templates) {
    for (const old of existing.filter((t: { name: string }) => t.name === template.name)) await request.delete(`/api/templates/${old.id}`, { headers });
    const response = await request.post('/api/templates', { headers, data: template });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
});

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `203.0.113.${counter++}` });
});

async function fillTemplate(page: Page, template: typeof templates[number]) {
  for (const field of template.fields) {
    if (field.field_type === 'textarea') {
      await page.locator('fieldset').filter({ has: page.locator(`label[for="${field.field_name}"]`) }).last().locator('.ProseMirror').fill('Behöver åtkomst till arbetet.');
    } else if (field.field_type === 'select') {
      await page.locator(`[id="${field.field_name}"]`).click();
      await page.getByRole('option', { name: field.options![0], exact: true }).click();
    } else {
      await page.locator(`[id="${field.field_name}"]`).fill(field.field_type === 'number' ? '2' : 'Testuppgift');
    }
  }
}

for (const template of templates) {
  test(`publik mall: ${template.name} — riktiga editorfält, bild och sändning`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const forbidden: string[] = []; page.on('request', request => { if (request.url().includes('/kb/upload-image')) forbidden.push(request.url()); });
    await page.goto('/submit-ticket?embed=1');
    await expect(page.getByRole('button', { name: 'Skicka ärende' })).toBeEnabled();
    await page.getByLabel('Ditt namn *').fill('Bildtest');
    await page.getByLabel('Din e-post *').fill('image-test@example.com');
    await page.getByRole('combobox').first().click();
    await page.getByRole('option').filter({ hasText: template.name }).click();
    await fillTemplate(page, template);
    if (template.fields.some(field => field.field_type === 'textarea')) {
      await page.locator('.rich-text-editor input[type=file]').first().setInputFiles(file);
      await expect(page.locator('.ProseMirror img')).toHaveCount(1);
      await page.locator('.rich-text-editor input[type=file]').first().setInputFiles({ ...file, name: 'second.png' });
      await expect(page.locator('.ProseMirror img')).toHaveCount(2);
      await expect.poll(() => page.locator('.ProseMirror img').first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
      await page.reload();
      await expect(page.locator('.ProseMirror img')).toHaveCount(2);
      await expect(page.getByLabel('Ditt namn *')).toHaveValue('Bildtest');
      await expect.poll(() => page.locator('.ProseMirror img').last().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    }
    await expect(page.getByRole('button', { name: 'Skicka ärende' })).toBeEnabled();
    const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/public/tickets') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Skicka ärende' }).click();
    const response = await responsePromise;
    // Bot timing guard is intentionally retained; retry in place after its short window.
    if (response.status() === 400 && (await response.text()).includes('snabbt')) {
      await page.waitForTimeout(3100);
      await page.getByRole('button', { name: 'Skicka ärende' }).click();
    } else expect(response.status(), await response.text()).toBe(201);
    await expect(page.getByText('Ärendet skickat!')).toBeVisible();
    expect(errors).toEqual([]); expect(forbidden).toEqual([]);
  });
}

test('public form retains text and images through server errors; paste and drop use same adapter', async ({ page }) => {
  await page.goto('/submit-ticket');
  await expect(page.getByRole('button', { name: 'Skicka ärende' })).toBeEnabled();
  await page.getByLabel('Ditt namn *').fill('Testperson');
  await page.getByLabel('Din e-post *').fill('test@example.com');
  await page.getByLabel('Ärendets titel *').fill('Sparad text');
  await page.locator('.ProseMirror').fill('Texten ska finnas kvar.');
  await page.getByRole('button', { name: 'Formatering', exact: true }).click();
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Infoga bild', exact: true }).click();
  await (await picker).setFiles(file);
  await expect(page.locator('.ProseMirror img')).toHaveCount(1);
  for (const status of [401, 403, 413, 429, 500]) {
    await page.route('**/api/public/tickets', route => route.fulfill({ status, json: { error: `Testfel ${status}` } }));
    await page.getByRole('button', { name: 'Skicka ärende' }).click();
    await expect(page.getByText(`Testfel ${status}`)).toBeVisible();
    await expect(page).toHaveURL(/\/submit-ticket$/);
    await expect(page.getByLabel('Ärendets titel *')).toHaveValue('Sparad text');
    await expect(page.locator('.ProseMirror img')).toHaveCount(1);
    await page.unroute('**/api/public/tickets');
  }
  for (const kind of ['paste', 'drop']) {
    await page.locator('.ProseMirror').evaluate((element, { bytes, kind }) => {
      const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], 'clipboard.png', { type: 'image/png' }));
      const rect = element.getBoundingClientRect();
      const event = kind === 'paste' ? new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }) : new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, clientX: rect.left + 15, clientY: rect.top + 15 });
      element.dispatchEvent(event);
    }, { bytes: [...png], kind });
    await expect(page.locator('.ProseMirror img')).toHaveCount(kind === 'paste' ? 2 : 3);
  }
  await page.screenshot({ path: 'test-results/public-images-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/public-images-mobile.png', fullPage: true });
});

test('authenticated admin inline image survives save and reopening', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-post').fill(E2E_ADMIN.email);
  await page.getByLabel('Lösenord').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: 'Logga in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto('/tickets/new');
  await page.getByLabel('Titel *').fill('Bildärende');
  await page.getByRole('combobox', { name: 'Beställare' }).click();
  await page.getByRole('option', { name: new RegExp(E2E_CONTACT.name) }).click();
  await page.locator('.ProseMirror').first().fill('Beskrivning med bild.');
  await page.locator('.rich-text-editor input[type=file]').first().setInputFiles(file);
  await expect(page.locator('.ProseMirror img')).toHaveCount(1);
  await page.getByRole('button', { name: 'Skapa ärende', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]{36}$/);
  await expect.poll(() => page.locator('img[data-ticket-image]').first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await page.reload();
  await expect.poll(() => page.locator('img[data-ticket-image]').first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
});

test('ordinary signed-in user: all six templates and original inline images', async ({ page }) => {
  test.setTimeout(90000);
  const forbidden: string[] = []; page.on('request', req => { if (req.url().includes('/kb/upload-image')) forbidden.push(req.url()); });
  await page.goto('/login');
  await page.getByLabel('E-post').fill('image-user@example.com');
  await page.getByLabel('Lösenord').fill('Temporary-Images123!');
  await page.getByRole('button', { name: 'Logga in', exact: true }).click();
  await expect(page).toHaveURL(/change-password/);
  await page.getByLabel('Nuvarande lösenord').fill('Temporary-Images123!');
  await page.getByLabel('Nytt lösenord', { exact: true }).fill('Permanent-Images456!');
  await page.getByLabel('Upprepa nytt lösenord').fill('Permanent-Images456!');
  await page.getByRole('button', { name: 'Byt lösenord', exact: true }).click();
  await expect(page).not.toHaveURL(/change-password/);
  for (const template of templates) {
    await page.goto('/tickets/new');
    await page.getByText('Använd mall', { exact: true }).click();
    await page.locator('details').filter({ hasText: 'Använd mall' }).getByRole('combobox').click();
    await page.getByRole('option').filter({ hasText: template.name }).click();
    await fillTemplate(page, template);
    await page.getByRole('combobox', { name: 'Beställare' }).click();
    await page.getByRole('option', { name: new RegExp(E2E_CONTACT.name) }).click();
    // All internal templates have an additional-information editor even when their fields are plain text.
    await page.locator('.rich-text-editor input[type=file]').last().setInputFiles(file);
    await expect(page.locator('.ProseMirror img')).toHaveCount(1);
    if (template === templates[0]) {
      await page.getByRole('button', { name: 'Samma som beställaren', exact: true }).click();
      await expect(page.locator('#anvandare')).toHaveValue(`${E2E_CONTACT.name} (${E2E_CONTACT.email})`);
      await expect(page).toHaveURL(/\/tickets\/new$/);
      await page.reload();
      await expect(page.locator('.ProseMirror img')).toHaveCount(1);
      await expect.poll(() => page.locator('.ProseMirror img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    }
    await page.getByRole('button', { name: 'Skapa ärende', exact: true }).click();
    await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]{36}$/);
    // Inline extra information is stored as notes; ordinary attachment preview also verifies access.
    await expect.poll(() => page.locator('img[alt="screen.png"]').first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  }
  await page.goto('/tickets/new');
  await page.getByLabel('Titel *', { exact: true }).fill('Vanlig användare utan mall');
  await page.getByRole('combobox', { name: 'Beställare' }).click();
  await page.getByRole('option', { name: new RegExp(E2E_CONTACT.name) }).click();
  await page.locator('.ProseMirror').fill('Beskrivning utan mall');
  await page.locator('.rich-text-editor input[type=file]').setInputFiles(file);
  await expect(page.locator('.ProseMirror img')).toHaveCount(1);
  await page.getByRole('button', { name: 'Skapa ärende', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]{36}$/);
  const savedUrl = page.url();
  await page.goto(`${savedUrl}/edit`);
  await expect(page.locator('.ProseMirror img')).toHaveCount(1);
  await expect.poll(() => page.locator('.ProseMirror img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await page.locator('.rich-text-editor input[type=file]').first().setInputFiles({ ...file, name: 'edited.png' });
  await expect(page.locator('.ProseMirror img')).toHaveCount(2);
  await page.getByRole('button', { name: 'Spara ändringar', exact: true }).click();
  await expect(page).not.toHaveURL(/edit$/);
  await page.goto(savedUrl);
  await expect(page.locator('img[data-ticket-image]')).toHaveCount(2);
  expect(forbidden).toEqual([]);
});

test('Navet iframe sandbox and theme bridge, category keyboard action and local images', async ({ page }) => {
  const host = 'https://navet-dev.prefabmastarna.se/__ticket-image-local-test';
  // Real support-frame sandbox and appearance protocol; only the local test form is mutated.
  await page.route('https://ticket-image.test/**', async route => {
    const response = await route.fetch({ url: route.request().url().replace('https://ticket-image.test', 'http://localhost:5173') });
    await route.fulfill({ response });
  });
  await page.route(host, route => route.fulfill({ contentType: 'text/html', body: `<html><body style="margin:0"><iframe title="Felanmälan" style="width:100%;height:95vh;border:0" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox" src="https://ticket-image.test/submit-ticket?embed=1"></iframe></body></html>` }));
  await page.goto(host);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('button', { name: 'Skicka ärende' })).toBeEnabled();
  await frame.getByLabel('Ditt namn *').fill('Navet-test');
  await frame.getByLabel('Ärendets titel *').fill('Bild inifrån Navet');
  await frame.locator('.ProseMirror').fill('Text från inbäddat formulär.');
  await frame.locator('.rich-text-editor input[type=file]').setInputFiles(file);
  await expect(frame.locator('.ProseMirror img')).toHaveCount(1);
  const summary = frame.locator('summary').filter({ hasText: 'Kategori' });
  await summary.focus(); await summary.press('Enter');
  await expect(frame.getByRole('button', { name: 'Testkategori', exact: true }).first()).toBeVisible();
  await expect(summary.locator('svg')).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.querySelector('iframe')!.contentWindow!.postMessage({ type: 'prefabnavet.appearance', version: 1, theme, palette: 'bibliotek' }, 'https://ticket-image.test'), theme);
    await expect(frame.locator('html')).toHaveAttribute('data-prefabnavet-theme', theme);
    await page.screenshot({ path: `test-results/navet-iframe-${theme}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/navet-iframe-mobile.png', fullPage: true });
  await expect(frame.getByLabel('Ditt namn *')).toHaveValue('Navet-test');
  await expect.poll(() => frame.locator('.ProseMirror img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await frame.getByRole('combobox').first().click();
  await frame.getByRole('option').filter({ hasText: templates[0].name }).click();
  await expect(frame.getByRole('alertdialog')).toBeVisible();
  await expect(frame.getByRole('listbox')).toHaveCount(0);
  await expect.poll(() => frame.getByRole('alertdialog').evaluate(el => getComputedStyle(el).opacity)).toBe('1');
  const dialog = await frame.getByRole('alertdialog').boundingBox();
  expect(dialog!.x).toBeGreaterThanOrEqual(0);
  expect(dialog!.x + dialog!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/navet-template-confirmation.png', fullPage: true, animations: 'disabled' });
  await frame.getByRole('button', { name: 'Behåll innehållet', exact: true }).click();
  await expect(frame.getByLabel('Ärendets titel *')).toHaveValue('Bild inifrån Navet');
  await frame.getByRole('combobox').first().click();
  await frame.getByRole('option').filter({ hasText: templates[0].name }).click();
  await frame.getByRole('button', { name: 'Byt mall', exact: true }).click();
  await expect(frame.locator('#system_name')).toBeVisible();

});

test('blocked local storage gives a visible warning without breaking the form', async ({ page }) => {
  await page.addInitScript(() => { indexedDB.open = () => { throw new Error('Blocked for test'); }; });
  await page.goto('/submit-ticket');
  await expect(page.getByText(/Utkastet kan inte sparas/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skicka ärende' })).toBeEnabled();
  await page.getByLabel('Ärendets titel *').fill('Kvar utan lagring');
  await page.locator('.rich-text-editor input[type=file]').setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(page.getByText('Välj en PNG-, JPEG-, GIF- eller WebP-bild.')).toBeVisible();
  await expect(page.getByLabel('Ärendets titel *')).toHaveValue('Kvar utan lagring');
});

test('draft expiration, scope isolation, cancelled picker and template choice keep data safe', async ({ page }) => {
  await page.goto('/submit-ticket');
  await expect(page.getByRole('button', { name: 'Skicka ärende' })).toBeEnabled();
  await page.getByLabel('Ditt namn *').fill('Utkasttest');
  await page.getByLabel('Ärendets titel *').fill('Behåll denna titel');
  await page.locator('.ProseMirror').fill('Sparad beskrivning');
  await page.locator('.rich-text-editor input[type=file]').setInputFiles(file);
  await expect(page.locator('.ProseMirror img')).toHaveCount(1);
  await page.locator('.rich-text-editor input[type=file]').setInputFiles([]);
  await expect(page.locator('.ProseMirror img')).toHaveCount(1);
  await page.locator('.ProseMirror').press('End'); await page.locator('.ProseMirror').press('Enter');
  await expect(page).toHaveURL(/submit-ticket/);
  await page.getByRole('button', { name: 'Formatering', exact: true }).click();
  await page.getByRole('button', { name: 'Infoga länk', exact: true }).click();
  await page.getByLabel('URL *', { exact: true }).fill('https://example.com');
  await page.getByLabel('Visningstext (valfritt)').fill('Länktext');
  await page.getByRole('button', { name: 'Infoga', exact: true }).click();
  await expect(page.locator('.ProseMirror a')).toHaveAttribute('href', 'https://example.com');
  await expect(page.getByLabel('Ärendets titel *')).toHaveValue('Behåll denna titel');
  await page.getByRole('combobox').first().click();
  await page.getByRole('option').filter({ hasText: templates[0].name }).click();
  await page.getByRole('button', { name: 'Behåll innehållet', exact: true }).click();
  await expect(page.getByLabel('Ärendets titel *')).toHaveValue('Behåll denna titel');
  await expect(page.locator('.ProseMirror img')).toHaveCount(1);
  await page.reload();
  await expect(page.getByLabel('Ärendets titel *')).toHaveValue('Behåll denna titel');
  await expect(page.locator('.ProseMirror img')).toHaveCount(1);
  // Remove image through the real editor, then persist the deletion.
  await page.locator('.ProseMirror').press('ControlOrMeta+A');
  await page.locator('.ProseMirror').press('Backspace');
  await page.locator('.ProseMirror').fill('Bilden borttagen');
  await expect(page.locator('.ProseMirror img')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.ProseMirror img')).toHaveCount(0);
  await page.goto('/login');
  // Move the saved public draft into another user's namespace, with an expired public copy.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('it-ticket-drafts', 1); r.onsuccess = () => resolve(r.result); r.onerror = reject; });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite'); const store = tx.objectStore('drafts'); const request = store.get('public:new');
      request.onsuccess = () => { store.put(request.result, 'user:someone-else:ticket:new'); store.put({ ...request.result, expires: Date.now() - 1 }, 'public:new'); };
      tx.oncomplete = () => resolve(); tx.onerror = reject;
    }); db.close();
  });
  await page.goto('/submit-ticket');
  await expect(page.getByLabel('Ditt namn *')).toHaveValue('');
  await expect(page.getByLabel('Ärendets titel *')).toHaveValue('');
});

test('lost success response retries one ticket with the same images and key', async ({ page }) => {
  await page.goto('/submit-ticket');
  await expect(page.getByRole('button', { name: 'Skicka ärende' })).toBeEnabled();
  await page.getByLabel('Ditt namn *').fill('Återförsök');
  await page.getByLabel('Din e-post *').fill('retry@example.com');
  await page.getByLabel('Ärendets titel *').fill('Nätverksavbrott efter sparande');
  await page.locator('.ProseMirror').fill('Texten bevaras');
  await page.locator('.rich-text-editor input[type=file]').setInputFiles(file);
  await expect(page.locator('.ProseMirror img')).toHaveCount(1);
  await page.waitForTimeout(3100); // Public honeypot minimum age.
  let firstId = ''; const keys: string[] = [];
  await page.route('**/api/public/tickets', async route => {
    keys.push(route.request().headers()['idempotency-key']);
    const response = await route.fetch(); expect(response.status()).toBe(201);
    firstId = (await response.json()).ticketId;
    await route.abort('connectionreset');
  });
  await page.getByRole('button', { name: 'Skicka ärende' }).dblclick();
  await expect(page.getByRole('button', { name: 'Skicka ärende' })).toBeEnabled();
  await expect(page.getByLabel('Ärendets titel *')).toHaveValue('Nätverksavbrott efter sparande');
  await expect(page.locator('.ProseMirror img')).toHaveCount(1);
  await page.unroute('**/api/public/tickets');
  await page.route('**/api/public/tickets', async route => {
    keys.push(route.request().headers()['idempotency-key']);
    const response = await route.fetch(); expect(response.status()).toBe(201);
    expect((await response.json()).ticketId).toBe(firstId);
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Skicka ärende' }).click();
  await expect(page.getByText('Ärendet skickat!')).toBeVisible();
  expect(keys).toHaveLength(2); expect(keys[1]).toBe(keys[0]);
  await page.reload();
  await expect(page.getByLabel('Ditt namn *')).toHaveValue('');
  await expect(page.locator('.ProseMirror img')).toHaveCount(0);
});

test('a damaged saved draft cannot break the public form on every visit', async ({ page }) => {
  await page.goto('/submit-ticket');
  await expect(page.getByRole('button', { name: 'Skicka ärende' })).toBeEnabled();
  await page.goto('/login');
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('it-ticket-drafts', 1); r.onsuccess = () => resolve(r.result); r.onerror = reject; });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite');
      tx.objectStore('drafts').put({ expires: Date.now() + 86400000, value: { formData: null, images: [] } }, 'public:new');
      tx.oncomplete = () => resolve(); tx.onerror = reject;
    }); db.close();
  });
  await page.goto('/submit-ticket');
  await expect(page.getByRole('button', { name: 'Skicka ärende' })).toBeEnabled();
  await expect(page.getByText(/Det sparade utkastet kunde inte återställas/)).toBeVisible();
  await page.getByLabel('Ditt namn *').fill('Kan fortfarande skapa ärende');
});

test('different content in a second tab is never falsely acknowledged as saved', async ({ page, context }) => {
  await page.goto('/submit-ticket');
  await expect(page.getByRole('button', { name: 'Skicka ärende' })).toBeEnabled();
  await page.getByLabel('Ditt namn *').fill('Två flikar');
  await page.getByLabel('Din e-post *').fill('two-tabs@example.com');
  await page.getByLabel('Ärendets titel *').fill('Första versionen');
  await page.locator('.ProseMirror').fill('Beskrivning');
  const second = await context.newPage();
  await second.setExtraHTTPHeaders({ 'X-Forwarded-For': '203.0.113.222' });
  await second.goto('/submit-ticket');
  await expect(second.getByLabel('Ärendets titel *')).toHaveValue('Första versionen');
  await second.getByLabel('Ärendets titel *').fill('Andra versionen');
  await page.waitForTimeout(3100);
  await page.getByRole('button', { name: 'Skicka ärende' }).click();
  await expect(page.getByText('Ärendet skickat!')).toBeVisible();
  await second.getByRole('button', { name: 'Skicka ärende' }).click();
  await expect(second.getByText(/En tidigare version av ärendet är redan sparad/)).toBeVisible();
  await expect(second.getByLabel('Ärendets titel *')).toHaveValue('Andra versionen');
  await second.getByRole('button', { name: 'Skicka ärende' }).click();
  await expect(second.getByText('Ärendet skickat!')).toBeVisible();
});

test('public share shows permitted inline images and stops working when revoked', async ({ page, request }) => {
  const imageId = crypto.randomUUID();
  const submitted = await request.post('/api/public/tickets', {
    headers: { 'X-Forwarded-For': '203.0.113.223' },
    multipart: {
      payload: JSON.stringify({ name: 'Delningstest', email: 'share-image@example.com', title: 'Delat bildärende', customFields: [{ fieldName: 'reason', fieldLabel: 'Motivering', fieldValue: `<p>Publik beskrivning</p><img src="/api/attachments/file/${imageId}" alt="Bild i text">` }] }),
      [imageId]: { name: 'share.png', mimeType: 'image/png', buffer: png },
    },
  });
  expect(submitted.status()).toBe(201);
  const { ticketId } = await submitted.json();
  const csrf = (await (await request.get('/api/csrf-token')).json()).csrfToken;
  const login = await request.post('/api/auth/login', { data: E2E_ADMIN, headers: { 'X-CSRF-Token': csrf, 'X-Forwarded-For': '203.0.113.224' } });
  const { accessToken } = await login.json();
  const auth = { Authorization: `Bearer ${accessToken}` };
  const freshCsrf = (await (await request.get('/api/csrf-token', { headers: auth })).json()).csrfToken;
  const headers = { ...auth, 'X-CSRF-Token': freshCsrf };
  const share = await request.post(`/api/shares/ticket/${ticketId}`, { headers });
  expect(share.status()).toBe(201);
  const { share_token } = await share.json();
  await page.goto(`/shared/${share_token}`);
  await expect(page.getByRole('heading', { name: 'Delat bildärende' })).toBeVisible();
  await expect.poll(() => page.getByRole('img', { name: 'Bild i text', exact: true }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  expect((await request.delete(`/api/shares/ticket/${ticketId}`, { headers })).ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByText('Kunde inte visa ärende')).toBeVisible();
});


test('permission request reuses contact details without losing the option to request for someone else', async ({ page }) => {
  await page.goto('/submit-ticket');
  await page.getByRole('combobox').first().click();
  await page.getByRole('option').filter({ hasText: templates[0].name }).click();
  const reuse = page.getByRole('button', { name: 'Gäller mig', exact: true });
  await expect(reuse).toBeDisabled();
  await page.getByLabel('Ditt namn *').fill('Kontaktperson');
  await page.getByLabel('Din e-post *').fill('kontakt@example.com');
  await reuse.click();
  await expect(page.locator('#anvandare')).toHaveValue('Kontaktperson (kontakt@example.com)');
  await expect(page).toHaveURL(/\/submit-ticket$/);
  await page.locator('#anvandare').fill('Kollega (kollega@example.com)');
  await page.getByLabel('Ditt namn *').fill('Uppdaterad kontakt');
  await expect(page.locator('#anvandare')).toHaveValue('Kollega (kollega@example.com)');
  await page.reload();
  await expect(page.locator('#anvandare')).toHaveValue('Kollega (kollega@example.com)');
  await expect(page.getByLabel('Ditt namn *')).toHaveValue('Uppdaterad kontakt');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.locator('html').evaluate(el => el.scrollWidth <= window.innerWidth)).toBe(true);
    const editor = await page.locator('.rich-text-editor').boundingBox();
    const form = await page.locator('form').boundingBox();
    expect(editor!.x + editor!.width).toBeLessThanOrEqual(form!.x + form!.width);
    await page.screenshot({ path: `test-results/permission-request-contact-${width}.png`, fullPage: true, animations: 'disabled' });
  }
});
