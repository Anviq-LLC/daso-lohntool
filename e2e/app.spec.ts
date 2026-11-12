import { type Page, request as pwRequest } from '@playwright/test';
import { test, expect } from './fixtures.ts';
import { header } from './token.ts';
import { mkdirSync } from 'node:fs';

const shots = process.env.SHOTS_DIR || 'test-results/shots';
mkdirSync(shots, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('access control', () => {
  const base = 'http://127.0.0.1:8788';
  const get = async (path: string, headers: Record<string, string> = {}) => {
    const ctx = await pwRequest.newContext({ baseURL: base, extraHTTPHeaders: headers });
    const res = await ctx.get(path);
    const status = res.status();
    await ctx.dispose();
    return status;
  };
  test('no identity gets 401 on pages and api', async () => {
    for (const path of ['/', '/api/me', '/api/months/2027-02', '/api/settings', '/index.html']) expect(await get(path), path).toBe(401);
  });
  test('forged Access email header is ignored', async () => {
    expect(await get('/api/me', { 'cf-access-authenticated-user-email': 'owner@example.test' })).toBe(401);
  });
  test('bad tokens are refused', async () => {
    expect(await get('/api/me', header({ aud: 'other-app' })), 'wrong audience').toBe(401);
    expect(await get('/api/me', header({ exp: Math.floor(Date.now() / 1000) - 10 })), 'expired').toBe(401);
    expect(await get('/api/me', header({ iss: 'https://evil.example' })), 'wrong issuer').toBe(401);
    const t = header()['cf-access-jwt-assertion'].split('.');
    expect(await get('/api/me', { 'cf-access-jwt-assertion': t[0] + '.' + t[1] + '.AAAA' }), 'bad signature').toBe(401);
  });
  test('valid token without a role (a Monteur) gets 403 and no data', async () => {
    const h = header({ email: 'monteur@example.test' });
    expect(await get('/api/me', h)).toBe(403);
    expect(await get('/api/months/2027-02', h)).toBe(403);
    expect(await get('/', h)).toBe(403);
  });
  test('Buchhaltung role works but cannot manage access', async () => {
    const h = header({ email: 'buero@example.test' });
    expect(await get('/api/me', h)).toBe(200);
    expect(await get('/api/roles', h)).toBe(403);
  });
});

test.describe('app', () => {
  test.describe.configure({ mode: 'serial' });

  test('month overview shows computed rows', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Monat').fill('2027-02');
    const table = page.getByTestId('month-table');
    await expect(table.getByRole('row', { name: /Ben Beispiel/ })).toBeVisible();
    await expect(table.getByRole('row', { name: /Anna Test/ })).toBeVisible();
    await expect(table.getByRole('row', { name: /Cem Muster/ })).toBeVisible();
    await expect(table.getByText('Altfall Archiv')).toHaveCount(0);
    await expect(table.getByRole('row', { name: /Ben Beispiel/ })).toContainText('3.606,56');
    // Anna: Feb 8 job plus a report written on 4 March for work on 25 Feb
    await expect(table.getByRole('row', { name: /Anna Test/ })).toContainText('18.000,00');
    await expect(page.locator('details.warn')).toHaveCount(0);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shot(page, '01-month-desktop');
  });

  test('detail panel and correction', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Monat').fill('2027-02');
    await page.getByRole('button', { name: 'Ben Beispiel' }).click();
    const detail = page.getByLabel('Details Ben Beispiel');
    await expect(detail).toContainText('Umsatzbonus');
    await expect(detail).toContainText('Werkzeugrate');
    await expect(detail.getByLabel('Monatsansicht Ben Beispiel')).toContainText('Summe');
    await detail.getByLabel('Bezeichnung').fill('Rückbuchung Januar');
    await detail.getByLabel('Betrag').fill('-50,00');
    await detail.getByRole('button', { name: 'Erfassen' }).click();
    await expect(detail).toContainText('Rückbuchung Januar');
    await expect(detail).toContainText('-50,00');
    await shot(page, '02-detail');
  });

  test('employee terms are editable', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Mitarbeiter', exact: true }).click();
    await page.getByLabel('Zuschlag Cem Muster').fill('');
    await page.getByLabel('Zuschlag Cem Muster').pressSequentially('0,5');
    await expect(page.getByLabel('Zuschlag Cem Muster')).toHaveValue('0,5');
    await page.getByRole('row', { name: /Cem Muster/ }).getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Gespeichert für Cem Muster');
    await shot(page, '03-employees');
  });

  test('holidays remove the warning', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Einstellungen' }).click();
    await page.getByLabel('Feiertage').fill('2027-01-01\n2027-02-02');
    await page.getByRole('button', { name: 'Einstellungen speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Gespeichert');
    await shot(page, '04-settings');
    await page.getByRole('button', { name: 'Monat', exact: true }).click();
    await page.getByLabel('Monat').fill('2027-02');
    await expect(page.getByTestId('month-table')).toBeVisible();
  });

  test('external week and tool account', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Werkzeug und Extern' }).click();
    await page.getByLabel('Monat').fill('2027-02');
    const form = page.getByRole('form', { name: 'Woche erfassen' });
    await form.getByLabel('KW').fill('2027-W06');
    await form.getByLabel('Stunden').fill('40');
    await form.getByLabel('Rechnung netto').fill('1.680,00');
    await form.getByRole('button', { name: 'Erfassen' }).click();
    await expect(page.getByRole('row', { name: /KW 06/ })).toContainText('80,00');
    await shot(page, '05-tools');
  });

  test('release freezes the month', async ({ page, api: request }) => {
    await page.goto('/');
    await page.getByLabel('Monat').fill('2027-02');
    await page.getByRole('button', { name: 'Zur Prüfung geben' }).click();
    await expect(page.getByTestId('status')).toHaveText('Prüfung offen');
    await page.getByRole('button', { name: 'Zur Freigabe geben' }).click();
    await expect(page.getByTestId('status')).toHaveText('Zur Freigabe');
    await page.getByRole('button', { name: 'Freigeben' }).click();
    await expect(page.getByTestId('status')).toHaveText('Freigegeben');
    await expect(page.getByText('Schreibgeschützt')).toBeVisible();
    await shot(page, '06-released');
    const w = await request.post('/api/adjustments', { data: { month: '2027-02', resourceId: 'r2', kind: 'praemie', label: 'x', cents: 100 } });
    expect(w.status()).toBe(409);
    const tools = await (await request.get('/api/tools')).json();
    expect(tools[0].paid_before_cents).toBe(5000);
    const csv = await request.get('/api/months/2027-02/export.csv');
    expect(csv.status()).toBe(200);
    const body = await csv.text();
    expect(body).toContain('Ben Beispiel');
    expect(body.split('\r\n')[0]).toContain('Monat;Mitarbeiter');
  });

  test('GF can reopen with a reason and the installment is rolled back', async ({ page, api: request }) => {
    const bad = await request.post('/api/months/2027-02/status', { data: { to: 'pruefung' } });
    expect(bad.status()).toBe(400);
    const ok = await request.post('/api/months/2027-02/status', { data: { to: 'pruefung', reason: 'Fehler gefunden' } });
    expect(ok.status()).toBe(200);
    expect((await (await request.get('/api/tools')).json())[0].paid_before_cents).toBe(0);
    await page.goto('/');
    await page.getByRole('button', { name: 'Protokoll' }).click();
    await expect(page.getByText('Freigabe zurückgenommen')).toBeVisible();
  });

  test('mobile and dark layouts have no page overflow', async ({ browser }) => {
    for (const [name, opts] of [['mobile', { viewport: { width: 375, height: 800 } }], ['dark', { viewport: { width: 1280, height: 800 }, colorScheme: 'dark' as const }]] as const) {
      const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:8788', locale: 'de-DE', extraHTTPHeaders: header(), ...opts });
      const page = await ctx.newPage();
      await page.goto('/');
      await page.getByLabel('Monat').fill('2027-02');
      await expect(page.getByTestId('month-table')).toBeVisible();
      expect(await overflow(page), name).toBeLessThanOrEqual(0);
      await shot(page, `07-month-${name}`);
      await ctx.close();
    }
  });
});

test('payroll sheet shows computed brutto and keeps typed values', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Lohnabrechnung' }).click();
  await page.getByLabel('Monat').fill('2027-02');
  const row = page.getByTestId('payroll-table').getByRole('row', { name: /Ben Beispiel/ });
  await expect(row).toContainText('3.814,04');
  await row.getByLabel('Fitness Ben Beispiel').fill('59,99');
  await row.getByLabel('Fitness Ben Beispiel').blur();
  await expect(page.getByLabel('Fitness Ben Beispiel')).toHaveValue('59,99');
  await page.getByLabel('Grundgehalt Ben Beispiel').fill('4.000,00');
  await page.getByLabel('Grundgehalt Ben Beispiel').blur();
  await expect(page.getByTestId('payroll-table').getByRole('row', { name: /Ben Beispiel/ })).toContainText('6.850,00');
  await shot(page, '08-payroll');
});
