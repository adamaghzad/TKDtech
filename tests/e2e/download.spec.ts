import { expect, test } from '@playwright/test';
import { desktopRelease } from '../../apps/web/lib/desktop-release';

test('public desktop download page exposes the portable Windows release and local-mode guidance', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/download');
  await expect(page.getByRole('heading', { name: 'The whole control desk. One download.' })).toBeVisible();
  const download = page.getByRole('link', { name: /Download for Windows x64/ });
  await expect(download).toBeVisible();
  await expect(download).toHaveAttribute('href', desktopRelease.downloadUrl);
  await expect(page.getByText('Extract the entire ZIP', { exact: true })).toBeVisible();
  await expect(page.getByText('Run TKD Scoring.exe', { exact: true })).toBeVisible();
  await expect(page.getByText('Persistent by default', { exact: true })).toBeVisible();
  await expect(page.getByText(/not code-signed/)).toBeVisible();
  await expect(page.getByTestId('desktop-checksum-link')).toHaveAttribute('href', desktopRelease.checksumUrl);
  await page.screenshot({ path: 'artifacts/desktop-download-page.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  const dimensions = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  await expect(download).toBeVisible();
  await page.screenshot({ path: 'artifacts/desktop-download-mobile.png', fullPage: true });

  await page.goto('/login');
  await expect(page.getByRole('link', { name: /Run everything locally/ })).toHaveAttribute('href', '/download');
  await expect(page.getByRole('button', { name: 'Enter development showcase' })).toHaveCount(0);
  await expect(page.getByLabel('Email address')).toHaveValue('');
  expect(errors).toEqual([]);
});
