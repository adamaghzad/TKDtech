import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { signDesktopLicense, type DesktopLicensePayload } from '../../packages/licensing/src/index';
import { DesktopLicenseService } from '../../apps/local-server/src/licensing/service';
import { openDatabase, type SqliteDatabase } from '../../apps/local-server/src/persistence/database';
import { HttpError } from '../../apps/local-server/src/http';

const initialNow = Date.parse('2026-10-27T12:00:00.000Z');
const temporaryDirectories: string[] = [];
const databases: SqliteDatabase[] = [];
const pair = generateKeyPairSync('ed25519');
const signingKey = { keyId: 'TKD-TEST-SERVICE', privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
const verificationKey = { keyId: signingKey.keyId, publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() };

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'tkd-desktop-license-'));
  temporaryDirectories.push(directory);
  return directory;
}

function database(): SqliteDatabase {
  const db = openDatabase(':memory:');
  databases.push(db);
  return db;
}

function service(db: SqliteDatabase, directory: string, clock: () => number = () => initialNow): DesktopLicenseService {
  return new DesktopLicenseService(db, { required: true, directory, machineId: 'SERVICE-TEST-MACHINE', now: clock, verificationKey });
}

function payload(deviceCode: string, now = initialNow, overrides: Partial<DesktopLicensePayload> = {}): DesktopLicensePayload {
  return {
    version: 1,
    keyId: signingKey.keyId,
    licenseId: 'LIC-2026-SERVICE1',
    clubName: 'Service Test Club',
    plan: 'CLUB',
    deviceCode,
    issuedAt: new Date(now - 60_000).toISOString(),
    notBefore: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 30 * 86_400_000).toISOString(),
    ...overrides,
  };
}

function tournament(db: SqliteDatabase, status: string): string {
  const organizationId = randomUUID();
  const tournamentId = randomUUID();
  const timestamp = new Date(initialNow).toISOString();
  db.prepare('INSERT INTO organizations(id,name,slug,created_at) VALUES(?,?,?,?)').run(organizationId, 'License Test Organization', `license-${organizationId}`, timestamp);
  db.prepare(`INSERT INTO tournaments(id,organization_id,name,slug,description,organizer,venue,country,start_date,end_date,timezone,status,mat_count,ruleset_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(tournamentId, organizationId, 'License Test Tournament', `tournament-${tournamentId}`, '', 'Tester', 'Casablanca', 'Morocco', '2026-10-27', '2026-10-28', 'Africa/Casablanca', status, 1, 'test-ruleset', timestamp, timestamp);
  return tournamentId;
}

function expectHttpCode(operation: () => void, code: string): void {
  let error: unknown;
  try { operation(); } catch (reason) { error = reason; }
  expect(error).toBeInstanceOf(HttpError);
  expect((error as HttpError).code).toBe(code);
}

afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('desktop license service', () => {
  it('requires activation before new work, including when an old tournament exists', () => {
    const db = database();
    const licensing = service(db, temporaryDirectory());
    const activeTournament = tournament(db, 'IN_PROGRESS');
    const status = licensing.getStatus();
    expect(status).toMatchObject({ required: true, status: 'UNLICENSED', canStartNewWork: false, canFinishActiveTournament: false });
    expect(status.installationCode).toMatch(/^TKD(?:-[0-9A-F]{4}){5}$/);
    expectHttpCode(() => licensing.assertNewWork(), 'LICENSE_REQUIRED');
    expectHttpCode(() => licensing.assertTournamentWork(activeTournament), 'LICENSE_REQUIRED');
  });

  it('activates, stores private file permissions, and survives a service restart', () => {
    const db = database();
    const directory = temporaryDirectory();
    const licensing = service(db, directory);
    const code = licensing.getStatus().installationCode;
    const token = signDesktopLicense(payload(code), signingKey);
    const activated = licensing.activate(`\n${token}\n`);
    expect(activated).toMatchObject({ status: 'ACTIVE', canStartNewWork: true, installationCode: code });
    expect(activated.license).toMatchObject({ clubName: 'Service Test Club', plan: 'CLUB', daysRemaining: 30 });
    expect(statSync(path.join(directory, 'installation.json')).mode & 0o777).toBe(0o600);
    expect(statSync(path.join(directory, 'desktop.tkdlicense')).mode & 0o777).toBe(0o600);
    expect(readFileSync(path.join(directory, 'desktop.tkdlicense'), 'utf8')).toBe(`${token}\n`);
    expect(() => licensing.assertNewWork()).not.toThrow();

    const restarted = service(db, directory);
    expect(restarted.getStatus()).toMatchObject({ status: 'ACTIVE', installationCode: code });
    expect(() => restarted.assertNewWork()).not.toThrow();
  });

  it('refuses a license for another device without saving it', () => {
    const db = database();
    const directory = temporaryDirectory();
    const licensing = service(db, directory);
    const actualCode = licensing.getStatus().installationCode;
    const token = signDesktopLicense(payload('TKD-0000-1111-2222-3333-4444'), signingKey);
    expectHttpCode(() => licensing.activate(token), 'LICENSE_DEVICE_MISMATCH');
    expect(existsSync(path.join(directory, 'desktop.tkdlicense'))).toBe(false);
    expect(licensing.getStatus()).toMatchObject({ status: 'UNLICENSED', installationCode: actualCode });
  });

  it('rejects expired, future, and invalid activations', () => {
    const db = database();
    const licensing = service(db, temporaryDirectory());
    const code = licensing.getStatus().installationCode;
    expectHttpCode(() => licensing.activate(signDesktopLicense(payload(code, initialNow, { expiresAt: new Date(initialNow).toISOString() }), signingKey)), 'LICENSE_EXPIRED');
    expectHttpCode(() => licensing.activate(signDesktopLicense(payload(code, initialNow, { notBefore: new Date(initialNow + 6 * 60_000).toISOString() }), signingKey)), 'LICENSE_NOT_YET_VALID');
    expectHttpCode(() => licensing.activate('not-a-license'), 'LICENSE_INVALID');
  });

  it('allows only an existing in-progress tournament to continue after expiry', () => {
    const db = database();
    let clock = initialNow;
    const licensing = service(db, temporaryDirectory(), () => clock);
    const code = licensing.getStatus().installationCode;
    licensing.activate(signDesktopLicense(payload(code, clock, { expiresAt: new Date(clock + 86_400_000).toISOString() }), signingKey));
    const active = tournament(db, 'IN_PROGRESS');
    const draft = tournament(db, 'DRAFT');
    clock += 2 * 86_400_000;
    expect(licensing.getStatus()).toMatchObject({ status: 'EXPIRED', canStartNewWork: false, canFinishActiveTournament: true });
    expect(() => licensing.assertTournamentWork(active)).not.toThrow();
    expectHttpCode(() => licensing.assertTournamentWork(draft), 'LICENSE_EXPIRED');
    expectHttpCode(() => licensing.assertNewWork(), 'LICENSE_EXPIRED');
  });

  it('does not grant active-tournament continuation to a damaged or invalid license', () => {
    const db = database();
    const directory = temporaryDirectory();
    const licensing = service(db, directory);
    licensing.getStatus();
    const active = tournament(db, 'IN_PROGRESS');
    writeFileSync(path.join(directory, 'desktop.tkdlicense'), 'tkd1.invalid.invalid\n');
    expect(licensing.getStatus().status).toBe('INVALID');
    expectHttpCode(() => licensing.assertTournamentWork(active), 'LICENSE_REQUIRED');
  });

  it('leaves non-desktop development and cloud deployments unchanged', () => {
    const db = database();
    const directory = temporaryDirectory();
    const licensing = new DesktopLicenseService(db, { required: false, directory });
    expect(licensing.getStatus()).toMatchObject({ required: false, status: 'NOT_REQUIRED', canStartNewWork: true });
    expect(() => licensing.assertNewWork()).not.toThrow();
    expect(existsSync(path.join(directory, 'installation.json'))).toBe(false);
  });
});

describe('offline clock guard (subscription enforcement)', () => {
  const longPayload = (deviceCode: string, now = initialNow) => payload(deviceCode, now, { notBefore: new Date(initialNow - 10 * 86_400_000).toISOString(), expiresAt: new Date(now + 800 * 86_400_000).toISOString() });

  it('blocks all licensed work when the clock is rolled back beyond the tolerance', () => {
    const db = database();
    const directory = temporaryDirectory();
    let clock = initialNow;
    const licensing = service(db, directory, () => clock);
    const code = licensing.getStatus().installationCode;
    licensing.activate(signDesktopLicense(payload(code), signingKey));
    expect(licensing.getStatus().status).toBe('ACTIVE');

    // Ten days back: the expired-license revival trick must not work.
    clock -= 10 * 86_400_000;
    const rolledBack = licensing.getStatus();
    expect(rolledBack.status).toBe('INVALID');
    expect(rolledBack.message).toMatch(/clock was moved back/i);
    expect(rolledBack.canStartNewWork).toBe(false);
    expect(rolledBack.canFinishActiveTournament).toBe(false);
    expectHttpCode(() => licensing.assertNewWork(), 'LICENSE_REQUIRED');
  });

  it('tolerates a small clock correction without losing the high-water mark', () => {
    const db = database();
    const directory = temporaryDirectory();
    let clock = initialNow;
    const licensing = service(db, directory, () => clock);
    const code = licensing.getStatus().installationCode;
    licensing.activate(signDesktopLicense(longPayload(code), signingKey));

    clock -= 2 * 3_600_000; // two hours back, well within the 72h tolerance
    expect(licensing.getStatus()).toMatchObject({ status: 'ACTIVE', canStartNewWork: true });

    // The stored mark still reflects the furthest time seen, so a later large
    // rollback from the same starting point is still blocked.
    clock = initialNow - 20 * 86_400_000;
    expect(licensing.getStatus().status).toBe('INVALID');
  });

  it('caps forward growth so a future-clock accident never poisons the guard', () => {
    const db = database();
    const directory = temporaryDirectory();
    let clock = initialNow;
    const licensing = service(db, directory, () => clock);
    const code = licensing.getStatus().installationCode;
    licensing.activate(signDesktopLicense(longPayload(code), signingKey));

    // Clock accidentally set far into the future, then corrected back.
    clock = initialNow + 400 * 86_400_000;
    expect(licensing.getStatus().status).toBe('ACTIVE');
    clock = initialNow + 86_400_000;
    expect(licensing.getStatus()).toMatchObject({ status: 'ACTIVE', canStartNewWork: true });
  });

  it('rejects activation of a license while the clock is rolled back, and activation resets the guard', () => {
    const db = database();
    const directory = temporaryDirectory();
    let clock = initialNow;
    const licensing = service(db, directory, () => clock);
    const code = licensing.getStatus().installationCode;

    // Seed the high-water mark, then roll the clock back.
    clock += 5 * 86_400_000;
    licensing.getStatus();
    clock = initialNow - 15 * 86_400_000;
    expectHttpCode(() => licensing.activate(signDesktopLicense(longPayload(code, initialNow), signingKey)), 'LICENSE_CLOCK_ROLLBACK');

    // After the clock is restored forward, activating a fresh valid license clears the guard.
    clock = initialNow + 6 * 86_400_000;
    const activated = licensing.activate(signDesktopLicense(longPayload(code, initialNow + 6 * 86_400_000), signingKey));
    expect(activated.status).toBe('ACTIVE');
    clock = initialNow + 7 * 86_400_000;
    expect(licensing.getStatus()).toMatchObject({ status: 'ACTIVE', canStartNewWork: true });
  });
});

describe('Salle plan capability gating', () => {
  const activated = (plan: 'SALLE' | 'SALLE_PLUS') => {
    const db = database();
    const licensing = service(db, temporaryDirectory());
    const code = licensing.getStatus().installationCode;
    const status = licensing.activate(signDesktopLicense(payload(code, initialNow, { plan }), signingKey));
    expect(status.status).toBe('ACTIVE');
    return licensing;
  };

  it('keeps scoring work but blocks tournament production and the full judging panel for Salle', () => {
    const salle = activated('SALLE');
    expect(salle.getStatus()).toMatchObject({
      status: 'ACTIVE',
      canStartNewWork: true,
      capabilities: { registrations: false, draws: false, podium: false, reports: false, fullJudgingPanel: false },
    });
    expect(() => salle.assertNewWork()).not.toThrow();
    for (const feature of ['registrations', 'draws', 'podium', 'reports'] as const) {
      expectHttpCode(() => salle.assertPlanFeature(feature), 'PLAN_UPGRADE_REQUIRED');
    }
    expectHttpCode(() => salle.assertJudgePairing('J2'), 'PLAN_UPGRADE_REQUIRED');
    expectHttpCode(() => salle.assertJudgePairing('J3'), 'PLAN_UPGRADE_REQUIRED');
    expect(() => salle.assertJudgePairing('J1')).not.toThrow();
    expect(() => salle.assertJudgePairing('REFEREE')).not.toThrow();
  });

  it('unlocks everything for Salle Plus and for an unlicensed (owner) deployment', () => {
    const sallePlus = activated('SALLE_PLUS');
    expect(sallePlus.getStatus()).toMatchObject({
      status: 'ACTIVE',
      capabilities: { registrations: true, draws: true, podium: true, reports: true, fullJudgingPanel: true },
    });
    for (const feature of ['registrations', 'draws', 'podium', 'reports'] as const) {
      expect(() => sallePlus.assertPlanFeature(feature)).not.toThrow();
    }
    expect(() => sallePlus.assertJudgePairing('J2')).not.toThrow();

    const owner = new DesktopLicenseService(database(), { required: false, directory: temporaryDirectory(), machineId: 'SERVICE-TEST-MACHINE', now: () => initialNow, verificationKey: verificationKey });
    expect(owner.getStatus().capabilities).toMatchObject({ registrations: true, reports: true });
    expect(() => owner.assertPlanFeature('registrations')).not.toThrow();
    expect(() => owner.assertJudgePairing('J3')).not.toThrow();
  });
});
