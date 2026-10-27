import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createTransport } from 'nodemailer';
import { z } from 'zod';
import {
  desktopLicensePlans,
  evaluateDesktopLicense,
  installationCodeSchema,
  licensePayloadSchema,
  normalizeInstallationCode,
  signDesktopLicense,
  type DesktopLicensePayload,
  type LicenseSigningKey,
  type LicenseVerificationKey,
} from '../../../../packages/licensing/src/index';
import { assertProductionPrivateKey, licenseKeyFingerprint, productionLicenseKey } from '../../../../packages/licensing/src/key';
import type { SqliteDatabase } from '../persistence/database';
import type { Actor } from '../types';
import { HttpError } from '../http';

const smtpUserVariable = 'TKD_LICENSE_EMAIL_USER';
const smtpPasswordVariable = 'TKD_LICENSE_EMAIL_PASSWORD';

export const licenseDeliveryInputSchema = z.object({
  clubName: z.string().trim().min(2).max(180).refine((value) => !/[\r\n\0]/.test(value), 'Club name contains invalid characters.'),
  clientEmail: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  plan: z.enum(desktopLicensePlans),
  deviceCode: z.string().transform(normalizeInstallationCode).pipe(installationCodeSchema),
  expires: z.string().date(),
  paymentConfirmed: z.boolean().refine((value) => value, 'Confirm payment before issuing the license.'),
}).strict();

export type LicenseDeliveryInput = z.infer<typeof licenseDeliveryInputSchema>;
export type LicenseDeliveryStatus = 'SENDING' | 'SENT' | 'FAILED';

export interface LicenseDelivery {
  id: string;
  licenseId: string;
  clubName: string;
  clientEmail: string;
  plan: DesktopLicensePayload['plan'];
  deviceCode: string;
  issuedAt: string;
  expiresAt: string;
  status: LicenseDeliveryStatus;
  emailMessageId: string | null;
  deliveryError: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface LicenseDeliveryDashboard {
  configuration: { configured: boolean; missing: string[] };
  deliveries: LicenseDelivery[];
}

export interface LicenseEmail {
  to: string;
  clubName: string;
  licenseId: string;
  plan: DesktopLicensePayload['plan'];
  deviceCode: string;
  expiresAt: string;
  token: string;
}

export interface LicenseEmailSender {
  send(message: LicenseEmail): Promise<{ messageId: string | null }>;
}

interface LicenseDeliveryOptions {
  now?: () => number;
  env?: NodeJS.ProcessEnv;
  sender?: LicenseEmailSender;
  signingKey?: LicenseSigningKey;
  verificationKey?: LicenseVerificationKey;
}

interface DeliveryRow {
  id: string;
  license_id: string;
  club_name: string;
  client_email: string;
  plan: DesktopLicensePayload['plan'];
  device_code: string;
  issued_at: string;
  expires_at: string;
  status: LicenseDeliveryStatus;
  email_message_id: string | null;
  delivery_error: string | null;
  created_at: string;
  sent_at: string | null;
}

function dto(row: DeliveryRow): LicenseDelivery {
  return {
    id: row.id,
    licenseId: row.license_id,
    clubName: row.club_name,
    clientEmail: row.client_email,
    plan: row.plan,
    deviceCode: row.device_code,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    status: row.status,
    emailMessageId: row.email_message_id,
    deliveryError: row.delivery_error,
    createdAt: row.created_at,
    sentAt: row.sent_at,
  };
}

function smtpPort(env: NodeJS.ProcessEnv): number {
  const value = Number(env.TKD_LICENSE_EMAIL_PORT ?? 465);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new HttpError(503, 'LICENSE_EMAIL_NOT_CONFIGURED', 'The license email SMTP port is invalid.');
  return value;
}

export function buildLicenseEmail(message: LicenseEmail, from: string) {
  const expiry = message.expiresAt.slice(0, 10);
  return {
    from,
    to: message.to,
    subject: `TKD Scoring Desktop license · ${message.clubName}`,
    text: [
      `Hello ${message.clubName},`,
      '',
      'Your TKD Scoring Desktop license is attached to this email.',
      '',
      `License ID: ${message.licenseId}`,
      `Plan: ${message.plan.replaceAll('_', ' ')}`,
      `Valid until: ${expiry} (end of day UTC)`,
      `Installation code: ${message.deviceCode}`,
      '',
      'Activate:',
      '1. Open TKD Scoring on the computer that supplied this installation code.',
      '2. Open Activation and choose Import license file.',
      `3. Select the attached TKD-Scoring-${message.licenseId}.tkdlicense file.`,
      '4. Confirm that the status is Active.',
      '',
      'The license works only for that computer and paid period. Activated LAN scoring does not require Internet.',
      'If you did not request this license, contact adam.aghzaf@gmail.com.',
      '',
      'TKDTech · Adam Aghzaf',
    ].join('\n'),
    attachments: [{
      filename: `TKD-Scoring-${message.licenseId}.tkdlicense`,
      content: `${message.token}\n`,
      contentType: 'application/octet-stream',
    }],
  };
}

export class SmtpLicenseEmailSender implements LicenseEmailSender {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async send(message: LicenseEmail): Promise<{ messageId: string | null }> {
    const user = this.env[smtpUserVariable];
    const password = this.env[smtpPasswordVariable];
    if (!user || !password) throw new HttpError(503, 'LICENSE_EMAIL_NOT_CONFIGURED', 'Gmail/SMTP credentials are not configured on the server.');
    const port = smtpPort(this.env);
    const secure = this.env.TKD_LICENSE_EMAIL_SECURE ? this.env.TKD_LICENSE_EMAIL_SECURE === 'true' : port === 465;
    const transporter = createTransport({
      host: this.env.TKD_LICENSE_EMAIL_HOST || 'smtp.gmail.com',
      port,
      secure,
      auth: { user, pass: password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    const result = await transporter.sendMail(buildLicenseEmail(message, this.env.TKD_LICENSE_EMAIL_FROM || `TKDTech <${user}>`));
    return { messageId: typeof result.messageId === 'string' ? result.messageId : null };
  }
}

export class LicenseDeliveryService {
  private readonly now: () => number;
  private readonly env: NodeJS.ProcessEnv;
  private readonly sender: LicenseEmailSender;
  private readonly verificationKey: LicenseVerificationKey;
  private cachedSigningKey?: LicenseSigningKey;

  constructor(private readonly db: SqliteDatabase, private readonly options: LicenseDeliveryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.env = options.env ?? process.env;
    this.sender = options.sender ?? new SmtpLicenseEmailSender(this.env);
    this.verificationKey = options.verificationKey ?? productionLicenseKey;
  }

  private static assertOwner(actor: Actor): void {
    if (actor.role !== 'SUPER_ADMIN') throw new HttpError(403, 'LICENSE_OWNER_REQUIRED', 'Only the business owner can issue and email desktop licenses.');
  }

  private configuration(): { configured: boolean; missing: string[] } {
    const missing: string[] = [];
    if (!this.options.signingKey && !this.env.TKD_LICENSE_PRIVATE_KEY_PEM) {
      const keyPath = this.env.TKD_LICENSE_PRIVATE_KEY || path.join(homedir(), '.config', 'tkd-scoring-licensing', 'ed25519-private.pem');
      if (!existsSync(keyPath)) missing.push('TKD_LICENSE_PRIVATE_KEY_PEM');
    }
    if (!this.options.sender) {
      if (!this.env[smtpUserVariable]) missing.push(smtpUserVariable);
      if (!this.env[smtpPasswordVariable]) missing.push(smtpPasswordVariable);
    }
    return { configured: missing.length === 0, missing };
  }

  private signingKey(): LicenseSigningKey {
    if (this.cachedSigningKey) return this.cachedSigningKey;
    try {
      const privateKeyPem = this.options.signingKey?.privateKeyPem
        ?? this.env.TKD_LICENSE_PRIVATE_KEY_PEM?.replace(/\\n/g, '\n')
        ?? readFileSync(this.env.TKD_LICENSE_PRIVATE_KEY || path.join(homedir(), '.config', 'tkd-scoring-licensing', 'ed25519-private.pem'), 'utf8');
      const privateKey = createPrivateKey({ key: privateKeyPem, format: 'pem' });
      const derivedPublicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
      if (licenseKeyFingerprint(derivedPublicKey) !== licenseKeyFingerprint(this.verificationKey.publicKeyPem)) throw new Error('Signing and verification keys differ.');
      if (this.verificationKey.keyId === productionLicenseKey.keyId) assertProductionPrivateKey(derivedPublicKey);
      this.cachedSigningKey = { keyId: this.verificationKey.keyId, privateKeyPem };
      return this.cachedSigningKey;
    } catch {
      throw new HttpError(503, 'LICENSE_ISSUER_NOT_CONFIGURED', 'The server signing key is missing, unreadable, or does not match the desktop verification key.');
    }
  }

  private findDuplicate(actorId: string, requestKey: string, requestHash: string): LicenseDelivery | null {
    const row = this.db.prepare('SELECT * FROM license_deliveries WHERE actor_id=? AND request_key=?').get(actorId, requestKey) as (DeliveryRow & { request_hash: string }) | undefined;
    if (!row) return null;
    if (row.request_hash !== requestHash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This approval key was already used with different license details. Start a new approval.');
    return dto(row);
  }

  getDashboard(actor: Actor): LicenseDeliveryDashboard {
    LicenseDeliveryService.assertOwner(actor);
    const rows = this.db.prepare('SELECT * FROM license_deliveries ORDER BY created_at DESC LIMIT 100').all() as DeliveryRow[];
    return { configuration: this.configuration(), deliveries: rows.map(dto) };
  }

  async issueAndSend(actor: Actor, input: unknown, requestKeyInput: string): Promise<{ delivery: LicenseDelivery; duplicate: boolean }> {
    LicenseDeliveryService.assertOwner(actor);
    const values = licenseDeliveryInputSchema.parse(input);
    const requestKey = requestKeyInput.trim();
    if (requestKey.length < 8 || requestKey.length > 100) throw new HttpError(400, 'INVALID_IDEMPOTENCY_KEY', 'A valid approval request key is required.');
    const expiresAt = new Date(`${values.expires}T23:59:59.999Z`).toISOString();
    if (Date.parse(expiresAt) <= this.now()) throw new HttpError(400, 'LICENSE_EXPIRY_INVALID', 'The paid license expiry must be in the future.');
    const requestHash = createHash('sha256').update(JSON.stringify([values.clubName, values.clientEmail, values.plan, values.deviceCode, values.expires])).digest('hex');
    const duplicate = this.findDuplicate(actor.id, requestKey, requestHash);
    if (duplicate) return { delivery: duplicate, duplicate: true };
    const configuration = this.configuration();
    if (!configuration.configured) throw new HttpError(503, 'LICENSE_DELIVERY_NOT_CONFIGURED', `Complete the server configuration first: ${configuration.missing.join(', ')}.`, { missing: configuration.missing });

    const now = this.now();
    const payload = licensePayloadSchema.parse({
      version: 1,
      keyId: this.verificationKey.keyId,
      licenseId: `LIC-${new Date(now).getUTCFullYear()}-${randomBytes(6).toString('hex').toUpperCase()}`,
      clubName: values.clubName,
      plan: values.plan,
      deviceCode: values.deviceCode,
      issuedAt: new Date(now).toISOString(),
      notBefore: new Date(now - 5 * 60_000).toISOString(),
      expiresAt,
    } satisfies DesktopLicensePayload);
    const token = signDesktopLicense(payload, this.signingKey());
    const verification = evaluateDesktopLicense(token, this.verificationKey, values.deviceCode, now);
    if (verification.status !== 'ACTIVE') throw new HttpError(500, 'LICENSE_ISSUANCE_VERIFICATION_FAILED', 'The new license failed verification and was not sent.');

    const id = randomUUID();
    const timestamp = new Date(now).toISOString();
    this.db.prepare(`INSERT INTO license_deliveries(
      id,license_id,request_key,request_hash,actor_id,club_name,client_email,plan,device_code,
      issued_at,expires_at,status,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, payload.licenseId, requestKey, requestHash, actor.id, payload.clubName, values.clientEmail,
      payload.plan, payload.deviceCode, payload.issuedAt, payload.expiresAt, 'SENDING', timestamp,
    );

    try {
      const sent = await this.sender.send({
        to: values.clientEmail,
        clubName: payload.clubName,
        licenseId: payload.licenseId,
        plan: payload.plan,
        deviceCode: payload.deviceCode,
        expiresAt: payload.expiresAt,
        token,
      });
      const sentAt = new Date(this.now()).toISOString();
      this.db.prepare("UPDATE license_deliveries SET status='SENT',email_message_id=?,sent_at=?,delivery_error=NULL WHERE id=?").run(sent.messageId, sentAt, id);
    } catch (error) {
      if (error instanceof HttpError && error.status === 503) {
        this.db.prepare("UPDATE license_deliveries SET status='FAILED',delivery_error=? WHERE id=?").run('Email service is not configured.', id);
      } else {
        const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code ?? 'SMTP_ERROR') : 'SMTP_ERROR';
        this.db.prepare("UPDATE license_deliveries SET status='FAILED',delivery_error=? WHERE id=?").run(`Email delivery failed (${code.slice(0, 50)}).`, id);
      }
      const failed = this.db.prepare('SELECT * FROM license_deliveries WHERE id=?').get(id) as DeliveryRow;
      throw new HttpError(502, 'LICENSE_EMAIL_FAILED', `License ${payload.licenseId} was recorded, but the email was not confirmed. Check the email configuration before trying again.`, { delivery: dto(failed) });
    }

    const delivered = this.db.prepare('SELECT * FROM license_deliveries WHERE id=?').get(id) as DeliveryRow;
    return { delivery: dto(delivered), duplicate: false };
  }
}
