import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { licenseKeyFingerprint, productionLicenseKey } from '../../packages/licensing/src/key';

const server = readFileSync('apps/local-server/src/index.ts', 'utf8');

describe('desktop licensing security boundary', () => {
  it('embeds only the reviewed public verification key', () => {
    expect(productionLicenseKey.keyId).toBe('TKD-2026-2864DB166D33');
    expect(licenseKeyFingerprint(productionLicenseKey.publicKeyPem)).toBe('2864db166d3342b1514d1e226b3c3014a4d6fe67d1bb16b2e4d195978643bc44');
    expect(productionLicenseKey.publicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(productionLicenseKey.publicKeyPem).not.toContain('PRIVATE KEY');
  });

  it('requires a license assertion on every tournament or scoring mutation route', () => {
    const allowedWithoutLicense = new Set([
      '/api/v1/auth/login',
      '/api/v1/auth/register',
      '/api/v1/auth/demo',
      '/api/v1/auth/logout',
      '/api/v1/licensing/activate',
      '/api/v1/pairing/exchange',
      '/api/v1/device/heartbeat',
      '/api/v1/sessions/:id',
      '/api/v1/sync/push',
    ]);
    const routes = [...server.matchAll(/app\.(?:post|patch|delete)\('([^']+)'/g)];
    expect(routes.length).toBeGreaterThan(15);
    const checked: string[] = [];
    for (let index = 0; index < routes.length; index += 1) {
      const match = routes[index]!;
      const route = match[1]!;
      if (allowedWithoutLicense.has(route)) continue;
      const end = routes[index + 1]?.index ?? server.length;
      const handler = server.slice(match.index, end);
      expect(handler, `${route} must enforce desktop licensing`).toContain('licensing.assert');
      checked.push(route);
    }
    expect(checked).toEqual(expect.arrayContaining([
      '/api/v1/tournaments',
      '/api/v1/tournaments/:id/status',
      '/api/v1/tournaments/:id/ruleset',
      '/api/v1/categories/:id/draws',
      '/api/v1/draws/:id/publish',
      '/api/v1/matches/:id/commands',
      '/api/v1/matches/:id/assign',
      '/api/v1/matches/:id/pairing',
      '/api/v1/judge/proposals',
      '/api/v1/referee/commands',
    ]));
  });

  it('keeps authentication, activation, heartbeat, revocation, and backup exceptions explicit', () => {
    expect(server).toContain("app.post('/api/v1/licensing/activate',authLimiter");
    expect(server).toContain("app.get('/api/v1/licensing/status'");
    expect(server).toContain("app.get('/api/v1/reports/:type.csv',requireAuth");
    expect(server).toContain("app.post('/api/v1/sync/push',requireAuth");
  });

  it('packages verification code but refuses private keys and customer licenses', () => {
    const packaging = readFileSync('desktop/scripts/build-windows.mjs', 'utf8');
    const launcher = readFileSync('desktop/main.ts', 'utf8');
    const ignore = readFileSync('.gitignore', 'utf8');
    expect(packaging).toContain("'packages', 'licensing', 'src'");
    expect(packaging).toContain("name.endsWith('.tkdlicense')");
    expect(packaging).toContain("name.includes('private')");
    expect(launcher).toContain("TKD_DESKTOP_LICENSE_REQUIRED: 'true'");
    expect(ignore).toContain('*.tkdlicense');
    expect(ignore).toContain('*private*.pem');
  });
});
