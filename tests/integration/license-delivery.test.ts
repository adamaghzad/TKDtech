import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { evaluateDesktopLicense, type LicenseSigningKey, type LicenseVerificationKey } from '../../packages/licensing/src/index';
import {
  buildLicenseEmail,
  LicenseDeliveryService,
  type LicenseDeliveryInput,
  type LicenseEmail,
  type LicenseEmailSender,
} from '../../apps/local-server/src/licensing/delivery';
import { openDatabase, type SqliteDatabase } from '../../apps/local-server/src/persistence/database';
import type { Actor } from '../../apps/local-server/src/types';

const now = Date.parse('2026-10-27T12:00:00.000Z');
const pair = generateKeyPairSync('ed25519');
const signingKey: LicenseSigningKey = {
  keyId: 'TKD-TEST-DELIVERY',
  privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};
const verificationKey: LicenseVerificationKey = {
  keyId: signingKey.keyId,
  publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
};
const databases: SqliteDatabase[] = [];

class MockSender implements LicenseEmailSender {
  readonly messages: LicenseEmail[] = [];
  constructor(private readonly failure?: unknown) {}
  async send(message: LicenseEmail): Promise<{ messageId: string | null }> {
    this.messages.push(message);
    if (this.failure) throw this.failure;
    return { messageId: '<test-message@tkd.local>' };
  }
}

function setup(sender = new MockSender()) {
  const db = openDatabase(':memory:');
  databases.push(db);
  const profileId = randomUUID();
  db.prepare('INSERT INTO profiles(id,email,full_name,password_hash,created_at) VALUES(?,?,?,?,?)').run(profileId, 'owner@example.com', 'Owner', 'not-used', new Date(now).toISOString());
  const actor: Actor = { id: profileId, role: 'SUPER_ADMIN', tournamentIds: [] };
  const service = new LicenseDeliveryService(db, { now: () => now, sender, signingKey, verificationKey, env: { NODE_ENV: 'test' } });
  return { db, actor, sender, service };
}

function input(overrides: Partial<LicenseDeliveryInput> = {}): LicenseDeliveryInput {
  return {
    clubName: 'Atlas Taekwondo',
    clientEmail: 'Coach@Example.com',
    plan: 'CLUB',
    deviceCode: 'TKD-0000-1111-2222-3333-4444',
    expires: '2027-10-27',
    paymentConfirmed: true,
    ...overrides,
  };
}

afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
});

describe('owner license email delivery', () => {
  it('signs a device-bound license, attaches it to the email, and records only metadata', async () => {
    const { db, actor, sender, service } = setup();
    const result = await service.issueAndSend(actor, input(), 'approval-request-001');
    expect(result.duplicate).toBe(false);
    expect(result.delivery).toMatchObject({
      clubName: 'Atlas Taekwondo', clientEmail: 'coach@example.com', plan: 'CLUB',
      deviceCode: 'TKD-0000-1111-2222-3333-4444', status: 'SENT',
      emailMessageId: '<test-message@tkd.local>', sentAt: new Date(now).toISOString(),
    });
    expect(sender.messages).toHaveLength(1);
    const message = sender.messages[0]!;
    const evaluation = evaluateDesktopLicense(message.token, verificationKey, message.deviceCode, now);
    expect(evaluation.status).toBe('ACTIVE');
    if (evaluation.status !== 'ACTIVE') throw new Error('Expected active license');
    expect(evaluation.payload).toMatchObject({ licenseId: result.delivery.licenseId, clubName: 'Atlas Taekwondo', plan: 'CLUB' });

    const mail = buildLicenseEmail(message, 'TKDTech <owner@example.com>');
    expect(mail.to).toBe('coach@example.com');
    expect(mail.subject).toContain('Atlas Taekwondo');
    expect(mail.text).toContain('Open Activation and choose Import license file');
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments[0]).toMatchObject({ contentType: 'application/octet-stream', content: `${message.token}\n` });
    expect(mail.attachments[0]!.filename).toBe(`TKD-Scoring-${message.licenseId}.tkdlicense`);

    const stored = db.prepare('SELECT * FROM license_deliveries').all() as Array<Record<string, unknown>>;
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored[0])).not.toContain(message.token);
    expect(JSON.stringify(stored[0])).not.toContain(signingKey.privateKeyPem);
    expect(service.getDashboard(actor).deliveries).toHaveLength(1);
  });

  it('is idempotent and rejects changed details under the same approval key', async () => {
    const { actor, sender, service } = setup();
    const first = await service.issueAndSend(actor, input(), 'approval-request-002');
    const retry = await service.issueAndSend(actor, input({ clientEmail: 'COACH@example.com' }), 'approval-request-002');
    expect(retry).toEqual({ delivery: first.delivery, duplicate: true });
    expect(sender.messages).toHaveLength(1);
    await expect(service.issueAndSend(actor, input({ clubName: 'Different Club' }), 'approval-request-002')).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(sender.messages).toHaveLength(1);
  });

  it('refuses non-owner roles, unconfirmed payment, invalid devices, and past expiry', async () => {
    const { db, actor, sender, service } = setup();
    await expect(service.issueAndSend({ ...actor, role: 'TOURNAMENT_ADMIN' }, input(), 'approval-request-003')).rejects.toMatchObject({ code: 'LICENSE_OWNER_REQUIRED' });
    await expect(service.issueAndSend(actor, input({ paymentConfirmed: false }), 'approval-request-004')).rejects.toThrow();
    await expect(service.issueAndSend(actor, input({ deviceCode: 'not-a-device' }), 'approval-request-005')).rejects.toThrow();
    await expect(service.issueAndSend(actor, input({ expires: '2026-10-26' }), 'approval-request-006')).rejects.toMatchObject({ code: 'LICENSE_EXPIRY_INVALID' });
    expect(sender.messages).toHaveLength(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM license_deliveries').get()).toEqual({ count: 0 });
  });

  it('marks an uncertain SMTP result FAILED without storing the license token', async () => {
    const failure = Object.assign(new Error('Authentication details should not be stored'), { code: 'EAUTH' });
    const sender = new MockSender(failure);
    const { db, actor, service } = setup(sender);
    await expect(service.issueAndSend(actor, input(), 'approval-request-007')).rejects.toMatchObject({ code: 'LICENSE_EMAIL_FAILED', status: 502 });
    const row = db.prepare('SELECT * FROM license_deliveries').get() as Record<string, unknown>;
    expect(row).toMatchObject({ status: 'FAILED', delivery_error: 'Email delivery failed (EAUTH).', sent_at: null });
    expect(JSON.stringify(row)).not.toContain(sender.messages[0]!.token);
    expect(JSON.stringify(row)).not.toContain('Authentication details should not be stored');
  });

  it('blocks delivery when server email secrets are missing', async () => {
    const db = openDatabase(':memory:');
    databases.push(db);
    const actor: Actor = { id: randomUUID(), role: 'SUPER_ADMIN', tournamentIds: [] };
    const service = new LicenseDeliveryService(db, { now: () => now, signingKey, verificationKey, env: { NODE_ENV: 'test' } });
    expect(service.getDashboard(actor).configuration).toEqual({ configured: false, missing: ['TKD_LICENSE_EMAIL_USER', 'TKD_LICENSE_EMAIL_PASSWORD'] });
    await expect(service.issueAndSend(actor, input(), 'approval-request-008')).rejects.toMatchObject({ code: 'LICENSE_DELIVERY_NOT_CONFIGURED', status: 503 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM license_deliveries').get()).toEqual({ count: 0 });
  });

  it('refuses a mismatched signing key before creating a delivery', async () => {
    const otherPair = generateKeyPairSync('ed25519');
    const sender = new MockSender();
    const { db, actor } = setup(sender);
    const service = new LicenseDeliveryService(db, {
      now: () => now,
      sender,
      signingKey,
      verificationKey: { keyId: 'TKD-TEST-OTHER', publicKeyPem: otherPair.publicKey.export({ type: 'spki', format: 'pem' }).toString() },
      env: { NODE_ENV: 'test' },
    });
    await expect(service.issueAndSend(actor, input(), 'approval-request-009')).rejects.toMatchObject({ code: 'LICENSE_ISSUER_NOT_CONFIGURED' });
    expect(sender.messages).toHaveLength(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM license_deliveries').get()).toEqual({ count: 0 });
  });
});
