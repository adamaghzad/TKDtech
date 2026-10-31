import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../apps/local-server/src/persistence/database';
import { hashPassword } from '../../apps/local-server/src/security/auth';

const databasePath = process.env.DATABASE_PATH ?? '/tmp/tkd-e2e.db';

function createTournamentAdmin(): string {
  const database = openDatabase(databasePath);
  const email = `role-${randomUUID()}@example.com`;
  const profileId = randomUUID();
  const organizationId = randomUUID();
  try {
    database.exec('BEGIN IMMEDIATE');
    const timestamp = new Date().toISOString();
    database.prepare('INSERT INTO organizations(id,name,slug,created_at) VALUES (?,?,?,?)').run(organizationId, 'Role management browser fixture', `role-fixture-${randomUUID()}`, timestamp);
    database.prepare('INSERT INTO profiles(id,email,full_name,password_hash,created_at) VALUES (?,?,?,?,?)').run(profileId, email, 'Role Change Target', hashPassword(randomUUID()), timestamp);
    database.prepare('INSERT INTO organization_members(organization_id,profile_id,role) VALUES (?,?,?)').run(organizationId, profileId, 'TOURNAMENT_ADMIN');
    database.exec('COMMIT');
    return email;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}

function storedRole(email: string): string | undefined {
  const database = openDatabase(databasePath);
  try {
    const row = database.prepare('SELECT role FROM organization_members WHERE profile_id=(SELECT id FROM profiles WHERE email=?)').get(email) as { role: string } | undefined;
    return row?.role;
  } finally {
    database.close();
  }
}

test('a Super Admin promotes a Tournament Admin by email and persists the responsive role change', async ({ page }) => {
  const email = createTournamentAdmin();
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Organization role management' })).toBeVisible({ timeout: 15000 });
  const target = page.locator('article').filter({ has: page.getByText(email, { exact: true }) });
  await expect(target.getByText('Role Change Target', { exact: true })).toBeVisible();
  await target.getByRole('combobox').selectOption('SUPER_ADMIN');
  await expect(target.getByRole('button', { name: 'Change role' })).toBeEnabled();
  await target.getByRole('button', { name: 'Change role' }).click();
  await expect(target.locator('span').filter({ hasText: 'SUPER ADMIN' }).first()).toBeVisible({ timeout: 15000 });
  expect(storedRole(email)).toBe('SUPER_ADMIN');

  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.screenshot({ path: 'artifacts/organization-role-management.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Organization role management' })).toBeVisible();
  await expect(page.getByText('Super Admin only', { exact: true })).toBeVisible();
  await expect(target.getByRole('combobox', { name: `Role for ${email}` })).toBeVisible();
  await expect(target.getByRole('button', { name: 'Change role' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/organization-role-management-mobile.png', fullPage: true });
});
