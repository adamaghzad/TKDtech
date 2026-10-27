import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { LicenseDeliveryService, buildLicenseEmail } from '../apps/local-server/src/licensing/delivery.ts';
import { evaluateDesktopLicense } from '../packages/licensing/src/index.ts';
import { productionLicenseKey } from '../packages/licensing/src/key.ts';
import { openDatabase } from '../apps/local-server/src/persistence/database.ts';

const privateKeyPath = process.env.TKD_LICENSE_PRIVATE_KEY || path.join(homedir(), '.config', 'tkd-scoring-licensing', 'ed25519-private.pem');
if (!existsSync(privateKeyPath)) throw new Error('Owner-only smoke requires TKD_LICENSE_PRIVATE_KEY; no email will be sent.');
const db = openDatabase(':memory:');
try {
  const actor = { id: randomUUID(), role: 'SUPER_ADMIN', tournamentIds: [] };
  db.prepare('INSERT INTO profiles(id,email,full_name,password_hash,created_at) VALUES(?,?,?,?,?)').run(actor.id, 'owner@example.com', 'Owner', 'not-used', new Date().toISOString());
  const messages = [];
  const sender = { async send(message) { messages.push(message); return { messageId: '<production-key-smoke@mail.invalid>' }; } };
  const service = new LicenseDeliveryService(db, {
    env: { NODE_ENV: 'test', TKD_LICENSE_PRIVATE_KEY: privateKeyPath },
    sender,
  });
  const deviceCode = 'TKD-0000-1111-2222-3333-4444';
  const expires = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  const result = await service.issueAndSend(actor, {
    clubName: 'Production Key Smoke', clientEmail: 'client@example.com', plan: 'CLUB',
    deviceCode, expires, paymentConfirmed: true,
  }, `production-key-smoke-${randomUUID()}`);
  if (messages.length !== 1) throw new Error('Mock sender did not receive exactly one message.');
  const evaluation = evaluateDesktopLicense(messages[0].token, productionLicenseKey, deviceCode);
  if (evaluation.status !== 'ACTIVE') throw new Error(`Production-key license evaluation failed: ${evaluation.status}`);
  const wrongDevice = evaluateDesktopLicense(messages[0].token, productionLicenseKey, 'TKD-4444-3333-2222-1111-0000');
  if (wrongDevice.status !== 'DEVICE_MISMATCH') throw new Error('Wrong-device binding was not rejected.');
  const email = buildLicenseEmail(messages[0], 'TKDTech <owner@example.com>');
  if (email.attachments[0].content !== `${messages[0].token}\n`) throw new Error('Email attachment differs from the verified token.');
  if (result.delivery.status !== 'SENT') throw new Error('Mock delivery was not marked sent.');
  console.log(`Production-key delivery smoke passed: ${result.delivery.licenseId}`);
  console.log('Real signature verified · intended device active · wrong device rejected · attachment exact · no real email sent');
} finally {
  db.close();
}
