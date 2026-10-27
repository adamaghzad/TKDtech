import { expect, test, type Page } from '@playwright/test';
import type { DesktopLicenseStatus } from '../../apps/web/lib/licensing';

const installationCode = 'TKD-1234-5678-9ABC-DEF0-1234';

function status(overrides: Partial<DesktopLicenseStatus> = {}): DesktopLicenseStatus {
  return {
    required: true,
    status: 'UNLICENSED',
    installationCode,
    binding: 'MACHINE_AND_INSTALLATION',
    canStartNewWork: false,
    canFinishActiveTournament: false,
    serverTime: '2026-10-27T12:00:00.000Z',
    message: 'Activate a paid desktop license before creating tournament work.',
    license: null,
    ...overrides,
  };
}

async function mockStatus(page: Page, value: DesktopLicenseStatus) {
  await page.route('**/api/v1/licensing/status', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: value }),
  }));
}

const activeLicense: DesktopLicenseStatus['license'] = {
  licenseId: 'LIC-2026-BROWSER1',
  clubName: 'Browser Test Club',
  plan: 'CLUB',
  issuedAt: '2026-10-01T12:00:00.000Z',
  expiresAt: '2026-11-26T12:00:00.000Z',
  daysRemaining: 30,
};

test('unlicensed desktop startup opens activation and preserves a responsive request flow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockStatus(page, status());
  await page.goto('/');
  await expect(page).toHaveURL(/\/activation/);
  await expect(page.getByRole('heading', { name: 'Activate this computer' })).toBeVisible();
  await expect(page.getByTestId('installation-code')).toHaveText(installationCode);
  await expect(page.getByRole('link', { name: 'Request on WhatsApp' })).toHaveAttribute('href', /212614192699/);
  await expect(page.getByRole('link', { name: 'Request on WhatsApp' })).toHaveAttribute('href', new RegExp(installationCode));
  await expect(page.getByRole('link', { name: 'Access saved records' })).toHaveAttribute('href', '/login');
  await page.screenshot({ path: 'artifacts/desktop-activation-unlicensed.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const dimensions = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  await page.screenshot({ path: 'artifacts/desktop-activation-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('a signed license file can be imported and activated before sign-in', async ({ page }) => {
  await mockStatus(page, status());
  let submittedToken = '';
  await page.route('**/api/v1/licensing/activate', async (route) => {
    submittedToken = route.request().postDataJSON().token as string;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: status({ status: 'ACTIVE', canStartNewWork: true, message: null, license: activeLicense }) }),
    });
  });
  await page.goto('/activation');
  const token = `tkd1.${'a'.repeat(180)}.${'b'.repeat(86)}`;
  await page.locator('input[type=file]').setInputFiles({ name: 'browser-test.tkdlicense', mimeType: 'text/plain', buffer: Buffer.from(token) });
  await expect(page.getByText('browser-test.tkdlicense', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Verify and activate' }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(submittedToken).toBe(token);
});

test('a wrong-device or invalid server response remains visible to the customer', async ({ page }) => {
  await mockStatus(page, status());
  await page.route('**/api/v1/licensing/activate', (route) => route.fulfill({
    status: 403,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'LICENSE_DEVICE_MISMATCH', message: 'This license was issued for a different computer or installation. Request a device transfer.' } }),
  }));
  await page.goto('/activation');
  await page.getByLabel('Or paste the license file contents').fill(`tkd1.${'c'.repeat(180)}.${'d'.repeat(86)}`);
  await page.getByRole('button', { name: 'Verify and activate' }).click();
  await expect(page.getByText('This license was issued for a different computer or installation. Request a device transfer.')).toBeVisible();
  await expect(page).toHaveURL(/\/activation/);
});

test('an active license opens the dashboard and shows a fourteen-day renewal warning', async ({ page }) => {
  await mockStatus(page, status({
    status: 'ACTIVE',
    canStartNewWork: true,
    message: null,
    license: { ...activeLicense!, daysRemaining: 10 },
  }));
  await page.goto('/');
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText('Desktop license expires in 10 days.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Renew license' })).toHaveAttribute('href', '/activation');
  await page.screenshot({ path: 'artifacts/dashboard-license-renewal.png', fullPage: true });
});
