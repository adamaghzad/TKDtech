import { expect, test, type Page } from '@playwright/test';

type Delivery = {
  id: string;
  licenseId: string;
  clubName: string;
  clientEmail: string;
  plan: 'CLUB';
  deviceCode: string;
  issuedAt: string;
  expiresAt: string;
  status: 'SENT' | 'FAILED';
  emailMessageId: string | null;
  deliveryError: string | null;
  createdAt: string;
  sentAt: string | null;
};

const installationCode = 'TKD-1234-5678-9ABC-DEF0-1234';
const timestamp = '2026-10-27T12:00:00.000Z';

function delivery(status: Delivery['status']): Delivery {
  return {
    id: 'delivery-browser-1', licenseId: 'LIC-2026-BROWSERMAIL1', clubName: 'Atlas Taekwondo',
    clientEmail: 'coach@example.com', plan: 'CLUB', deviceCode: installationCode,
    issuedAt: timestamp, expiresAt: '2027-12-31T23:59:59.999Z', status,
    emailMessageId: status === 'SENT' ? '<browser-message@mail.test>' : null,
    deliveryError: status === 'FAILED' ? 'Email delivery failed (EAUTH).' : null,
    createdAt: timestamp, sentAt: status === 'SENT' ? timestamp : null,
  };
}

async function mockDeliveryApi(page: Page, deliveries: Delivery[], failure = false) {
  await page.route('**/api/v1/admin/license-deliveries', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { configuration: { configured: true, missing: [] }, deliveries } }) });
      return;
    }
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['idempotency-key']).toBeTruthy();
    expect(route.request().postDataJSON()).toMatchObject({
      clubName: 'Atlas Taekwondo', clientEmail: 'coach@example.com', plan: 'CLUB',
      deviceCode: installationCode, expires: '2027-12-31', paymentConfirmed: true,
    });
    const result = delivery(failure ? 'FAILED' : 'SENT');
    deliveries.splice(0, deliveries.length, result);
    if (failure) {
      await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { code: 'LICENSE_EMAIL_FAILED', message: 'The email was not confirmed. Check the email configuration before trying again.' } }) });
    } else {
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { delivery: result, duplicate: false } }) });
    }
  });
}

async function fillApproval(page: Page) {
  await page.getByLabel('Client / club name').fill('Atlas Taekwondo');
  await page.getByLabel('Client email').fill('coach@example.com');
  await page.getByLabel('Installation code').fill(installationCode.toLowerCase());
  await page.getByLabel('Paid until').fill('2027-12-31');
  await page.getByRole('checkbox').check();
}

test('owner approves and emails a device-bound license with responsive delivery history', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockDeliveryApi(page, []);
  await page.goto('/license-delivery');
  await expect(page.getByRole('heading', { name: 'Approve & email a license' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'License delivery', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve & email license' }).click();
  await expect(page.getByText('Enter the client or club name.')).toBeVisible();
  await fillApproval(page);
  await page.getByRole('button', { name: 'Approve & email license' }).click();
  await expect(page.getByText('Email accepted by the mail service')).toBeVisible();
  await expect(page.getByText('LIC-2026-BROWSERMAIL1', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('SENT', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve & email license' })).toBeEnabled();
  await page.screenshot({ path: 'artifacts/license-email-delivery.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'artifacts/license-email-delivery-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('an unconfirmed email remains visible and is recorded as failed', async ({ page }) => {
  await mockDeliveryApi(page, [], true);
  await page.goto('/license-delivery');
  await fillApproval(page);
  await page.getByRole('button', { name: 'Approve & email license' }).click();
  await expect(page.getByText('The email was not confirmed. Check the email configuration before trying again.', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('FAILED', { exact: true })).toBeVisible();
  await expect(page.getByText('Email delivery failed (EAUTH).')).toBeVisible();
  await expect(page.getByText('Email accepted by the mail service')).toHaveCount(0);
});

test('missing server secrets disable approval safely', async ({ page }) => {
  await page.route('**/api/v1/admin/license-deliveries', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: { configuration: { configured: false, missing: ['TKD_LICENSE_EMAIL_PASSWORD'] }, deliveries: [] } }),
  }));
  await page.goto('/license-delivery');
  await expect(page.getByText('Server email delivery is not configured')).toBeVisible();
  await expect(page.getByText('TKD_LICENSE_EMAIL_PASSWORD', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve & email license' })).toBeDisabled();
});
