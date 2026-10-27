import { createHash, sign, verify } from 'node:crypto';
import { z } from 'zod';

export const desktopLicensePlans = ['FOUNDING_CLUB', 'CLUB', 'TOURNAMENT_SUPPORT'] as const;
export type DesktopLicensePlan = (typeof desktopLicensePlans)[number];

const isoDateTime = z.string().min(20).max(40).refine((value) => Number.isFinite(Date.parse(value)), 'Invalid ISO date.');
export const installationCodeSchema = z.string().regex(/^TKD(?:-[0-9A-F]{4}){5}$/, 'Invalid installation code.');

export const licensePayloadSchema = z.object({
  version: z.literal(1),
  keyId: z.string().regex(/^TKD-[A-Z0-9-]{6,80}$/),
  licenseId: z.string().regex(/^LIC-[A-Z0-9-]{6,100}$/),
  clubName: z.string().trim().min(2).max(180),
  plan: z.enum(desktopLicensePlans),
  deviceCode: installationCodeSchema,
  issuedAt: isoDateTime,
  notBefore: isoDateTime,
  expiresAt: isoDateTime,
}).strict().superRefine((payload, context) => {
  if (Date.parse(payload.notBefore) >= Date.parse(payload.expiresAt)) {
    context.addIssue({ code: 'custom', message: 'notBefore must precede expiresAt.', path: ['notBefore'] });
  }
  if (Date.parse(payload.issuedAt) > Date.parse(payload.expiresAt)) {
    context.addIssue({ code: 'custom', message: 'issuedAt must not follow expiresAt.', path: ['issuedAt'] });
  }
});

export type DesktopLicensePayload = z.infer<typeof licensePayloadSchema>;
export type LicenseEvaluationStatus = 'ACTIVE' | 'MALFORMED' | 'WRONG_KEY' | 'INVALID_SIGNATURE' | 'DEVICE_MISMATCH' | 'NOT_YET_VALID' | 'EXPIRED';
export type LicenseEvaluation =
  | { status: 'ACTIVE'; payload: DesktopLicensePayload }
  | { status: Exclude<LicenseEvaluationStatus, 'ACTIVE'>; payload?: DesktopLicensePayload };

export interface LicenseSigningKey {
  keyId: string;
  privateKeyPem: string;
}

export interface LicenseVerificationKey {
  keyId: string;
  publicKeyPem: string;
}

export function normalizeInstallationCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

export function installationCodeFor(installationId: string, machineId: string): string {
  if (!installationId.trim() || !machineId.trim()) throw new Error('Installation and machine identities are required.');
  const digest = createHash('sha256').update(`TKD-SCORING-DESKTOP\0v1\0${machineId}\0${installationId}`).digest('hex').toUpperCase();
  const groups = digest.slice(0, 20).match(/.{4}/g)!;
  return `TKD-${groups.join('-')}`;
}

export function signDesktopLicense(payloadInput: DesktopLicensePayload, key: LicenseSigningKey): string {
  const payload = licensePayloadSchema.parse(payloadInput);
  if (payload.keyId !== key.keyId) throw new Error('License payload and signing key identifiers differ.');
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = sign(null, Buffer.from(encodedPayload, 'ascii'), key.privateKeyPem).toString('base64url');
  return `tkd1.${encodedPayload}.${signature}`;
}

function decodeSegment(segment: string): Buffer | null {
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  const decoded = Buffer.from(segment, 'base64url');
  return decoded.toString('base64url') === segment ? decoded : null;
}

export function evaluateDesktopLicense(
  tokenInput: string,
  key: LicenseVerificationKey,
  expectedDeviceCode: string,
  now = Date.now(),
): LicenseEvaluation {
  const token = tokenInput.replace(/^\uFEFF/, '').trim();
  if (!token || token.length > 16_384) return { status: 'MALFORMED' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'tkd1') return { status: 'MALFORMED' };
  const encodedPayload = parts[1]!;
  const encodedSignature = parts[2]!;
  const payloadBytes = decodeSegment(encodedPayload);
  const signature = decodeSegment(encodedSignature);
  if (!payloadBytes || !signature || payloadBytes.length > 8_192 || signature.length !== 64) return { status: 'MALFORMED' };

  let parsed: DesktopLicensePayload;
  try {
    parsed = licensePayloadSchema.parse(JSON.parse(payloadBytes.toString('utf8')));
  } catch {
    return { status: 'MALFORMED' };
  }
  if (parsed.keyId !== key.keyId) return { status: 'WRONG_KEY', payload: parsed };
  if (!verify(null, Buffer.from(encodedPayload, 'ascii'), key.publicKeyPem, signature)) {
    return { status: 'INVALID_SIGNATURE', payload: parsed };
  }
  if (parsed.deviceCode !== normalizeInstallationCode(expectedDeviceCode)) return { status: 'DEVICE_MISMATCH', payload: parsed };
  if (now + 5 * 60_000 < Date.parse(parsed.notBefore)) return { status: 'NOT_YET_VALID', payload: parsed };
  if (now >= Date.parse(parsed.expiresAt)) return { status: 'EXPIRED', payload: parsed };
  return { status: 'ACTIVE', payload: parsed };
}
