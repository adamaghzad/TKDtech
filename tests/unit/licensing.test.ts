import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  evaluateDesktopLicense,
  installationCodeFor,
  normalizeInstallationCode,
  signDesktopLicense,
  type DesktopLicensePayload,
} from '../../packages/licensing/src/index';

const now = Date.parse('2026-10-27T12:00:00.000Z');

function keys(keyId = 'TKD-TEST-KEY') {
  const pair = generateKeyPairSync('ed25519');
  return {
    signing: { keyId, privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() },
    verification: { keyId, publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() },
  };
}

function fixture(keyId = 'TKD-TEST-KEY'): DesktopLicensePayload {
  return {
    version: 1,
    keyId,
    licenseId: 'LIC-2026-ABC123',
    clubName: 'Atlas Test Club',
    plan: 'CLUB',
    deviceCode: installationCodeFor(randomUUID(), 'TEST-MACHINE-A'),
    issuedAt: new Date(now - 60_000).toISOString(),
    notBefore: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 30 * 86_400_000).toISOString(),
  };
}

describe('desktop license cryptography', () => {
  it('signs and verifies an active device-bound Ed25519 license', () => {
    const key = keys();
    const payload = fixture();
    const token = signDesktopLicense(payload, key.signing);
    expect(token.startsWith('tkd1.')).toBe(true);
    expect(evaluateDesktopLicense(`\uFEFF${token}\n`, key.verification, payload.deviceCode, now)).toEqual({ status: 'ACTIVE', payload });
  });

  it('rejects a modified payload even when the original signature is retained', () => {
    const key = keys();
    const payload = fixture();
    const token = signDesktopLicense(payload, key.signing);
    const [prefix, , signature] = token.split('.');
    const changed = { ...payload, clubName: 'Unpaid Changed Club' };
    const tampered = `${prefix}.${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${signature}`;
    expect(evaluateDesktopLicense(tampered, key.verification, payload.deviceCode, now).status).toBe('INVALID_SIGNATURE');
  });

  it('rejects use on another computer or installation', () => {
    const key = keys();
    const payload = fixture();
    const token = signDesktopLicense(payload, key.signing);
    const other = installationCodeFor(randomUUID(), 'TEST-MACHINE-B');
    expect(evaluateDesktopLicense(token, key.verification, other, now).status).toBe('DEVICE_MISMATCH');
  });

  it('distinguishes expired and not-yet-valid licenses', () => {
    const key = keys();
    const payload = fixture();
    const expired = signDesktopLicense({ ...payload, expiresAt: new Date(now).toISOString() }, key.signing);
    expect(evaluateDesktopLicense(expired, key.verification, payload.deviceCode, now).status).toBe('EXPIRED');
    const future = signDesktopLicense({ ...payload, notBefore: new Date(now + 6 * 60_000).toISOString() }, key.signing);
    expect(evaluateDesktopLicense(future, key.verification, payload.deviceCode, now).status).toBe('NOT_YET_VALID');
    expect(evaluateDesktopLicense(future, key.verification, payload.deviceCode, now + 60_000).status).toBe('ACTIVE');
  });

  it('rejects a license issued for an unknown verification key', () => {
    const first = keys('TKD-TEST-FIRST');
    const second = keys('TKD-TEST-SECOND');
    const payload = fixture('TKD-TEST-FIRST');
    const token = signDesktopLicense(payload, first.signing);
    expect(evaluateDesktopLicense(token, second.verification, payload.deviceCode, now).status).toBe('WRONG_KEY');
  });

  it.each(['', 'not-a-license', 'tkd1.bad.signature', 'tkd2.e30.signature', 'tkd1.e30.e30'])('rejects malformed token %s', (token) => {
    const key = keys();
    expect(evaluateDesktopLicense(token, key.verification, fixture().deviceCode, now).status).toBe('MALFORMED');
  });

  it('requires matching payload/signing key identifiers and valid payload fields', () => {
    const key = keys();
    expect(() => signDesktopLicense({ ...fixture(), keyId: 'TKD-TEST-OTHER' }, key.signing)).toThrow(/identifiers differ/);
    expect(() => signDesktopLicense({ ...fixture(), plan: 'FREE' } as unknown as DesktopLicensePayload, key.signing)).toThrow();
  });

  it('creates stable, normalizable installation codes without exposing machine identifiers', () => {
    const installation = randomUUID();
    const code = installationCodeFor(installation, 'PRIVATE-MACHINE-IDENTITY');
    expect(code).toMatch(/^TKD(?:-[0-9A-F]{4}){5}$/);
    expect(code).not.toContain('PRIVATE');
    expect(installationCodeFor(installation, 'PRIVATE-MACHINE-IDENTITY')).toBe(code);
    expect(installationCodeFor(installation, 'ANOTHER-MACHINE')).not.toBe(code);
    expect(normalizeInstallationCode(` ${code.toLowerCase()} \n`)).toBe(code);
  });
});
