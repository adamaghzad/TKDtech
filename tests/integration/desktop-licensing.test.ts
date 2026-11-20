import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { signDesktopLicense, type DesktopLicensePayloadV1, type DesktopLicensePayloadV2 } from '../../packages/licensing/src/index';
import { DesktopLicenseService } from '../../apps/local-server/src/licensing/service';
import { LicenseDeliveryService, type LicenseEmail } from '../../apps/local-server/src/licensing/delivery';
import { openDatabase, type SqliteDatabase } from '../../apps/local-server/src/persistence/database';
import { HttpError } from '../../apps/local-server/src/http';
import type { Actor } from '../../apps/local-server/src/types';

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

function payload(deviceCode: string, now = initialNow, overrides: Partial<DesktopLicensePayloadV1> = {}): DesktopLicensePayloadV1 {
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

function payloadV2(deviceCode: string, overrides: Partial<DesktopLicensePayloadV2> = {}, now = initialNow): DesktopLicensePayloadV2 {
  return {
    version: 2,
    keyId: signingKey.keyId,
    licenseId: 'LIC-2026-SERVICE2',
    clubName: 'Service Test Club',
    plan: 'SALLE_PLUS',
    deviceCode,
    issuedAt: new Date(now - 60_000).toISOString(),
    notBefore: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 30 * 86_400_000).toISOString(),
    matchQuota: null,
    tournamentQuota: null,
    ...overrides,
  };
}

function createdTournamentAt(db: SqliteDatabase, createdAtIso: string): string {
  const organizationId = randomUUID();
  const tournamentId = randomUUID();
  db.prepare('INSERT INTO organizations(id,name,slug,created_at) VALUES(?,?,?,?)').run(organizationId, 'Quota Organization', `quota-${organizationId}`, createdAtIso);
  db.prepare(`INSERT INTO tournaments(id,organization_id,name,slug,description,organizer,venue,country,start_date,end_date,timezone,status,mat_count,ruleset_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(tournamentId, organizationId, 'Quota Tournament', `tournament-${tournamentId}`, '', 'Tester', 'Casablanca', 'Morocco', '2026-10-27', '2026-10-28', 'Africa/Casablanca', 'DRAFT', 1, 'test-ruleset', createdAtIso, createdAtIso);
  return tournamentId;
}

function startedMatches(db: SqliteDatabase, count: number, startedAtIso: string): void {
  const organizationId = randomUUID();
  const tournamentId = randomUUID();
  const categoryId = randomUUID();
  db.prepare('INSERT INTO organizations(id,name,slug,created_at) VALUES(?,?,?,?)').run(organizationId, 'Quota Match Organization', `quota-match-${organizationId}`, startedAtIso);
  db.prepare(`INSERT INTO tournaments(id,organization_id,name,slug,description,organizer,venue,country,start_date,end_date,timezone,status,mat_count,ruleset_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(tournamentId, organizationId, 'Quota Match Tournament', `tournament-${tournamentId}`, '', 'Tester', 'Casablanca', 'Morocco', '2026-10-27', '2026-10-28', 'Africa/Casablanca', 'IN_PROGRESS', 1, 'test-ruleset', startedAtIso, startedAtIso);
  db.prepare(`INSERT INTO categories(id,tournament_id,name,division,age_group,min_weight_kg,max_weight_kg,ruleset_id,format,rounds,round_duration_ms,break_duration_ms,golden_point_policy)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(categoryId, tournamentId, 'Senior -68', 'SENIOR', 'ADULT', 60, 68, 'test-ruleset', 'SINGLE_ELIMINATION', 3, 120000, 30000, 'SUDDEN_DEATH');
  for (let index = 1; index <= count; index += 1) {
    db.prepare(`INSERT INTO matches(id,tournament_id,category_id,match_number,state,timer_json,actual_start_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(randomUUID(), tournamentId, categoryId, `QM-${count}-${index}`, 'COMPLETED', '{}', startedAtIso, startedAtIso, startedAtIso);
  }
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

describe('Plan quotas (match and tournament allowances)', () => {
  const activated = (build: (code: string) => string) => {
    const db = database();
    const licensing = service(db, temporaryDirectory());
    const code = licensing.getStatus().installationCode;
    const status = licensing.activate(build(code));
    expect(status.status).toBe('ACTIVE');
    return { db, licensing };
  };
  const token = (overrides: Partial<DesktopLicensePayloadV1>) => (code: string) => signDesktopLicense(payload(code, initialNow, overrides), signingKey);
  const tokenV2 = (overrides: Partial<DesktopLicensePayloadV2>) => (code: string) => signDesktopLicense(payloadV2(code, overrides), signingKey);

  it('exposes plan-default quotas for v1 tokens and explicit quotas for v2 tokens', () => {
    const salle = activated(token({ plan: 'SALLE' }));
    expect(salle.licensing.getStatus().usage).toMatchObject({
      matches: { limit: 200, used: 0 },
      tournaments: { limit: 0, used: 0, usedThisMonth: 0, monthlyLimit: null },
    });
    const sallePlus = activated(token({ plan: 'SALLE_PLUS' }));
    expect(sallePlus.licensing.getStatus().usage).toMatchObject({
      matches: { limit: null, used: 0 },
      tournaments: { limit: 3, used: 0, usedThisMonth: 0, monthlyLimit: 2 },
    });
    const club = activated(token({ plan: 'CLUB' }));
    expect(club.licensing.getStatus().usage).toMatchObject({ matches: { limit: null }, tournaments: { limit: null, monthlyLimit: null } });
    const overridden = activated(tokenV2({ matchQuota: 50, tournamentQuota: 2 }));
    expect(overridden.licensing.getStatus().usage).toMatchObject({ matches: { limit: 50 }, tournaments: { limit: 2, monthlyLimit: 2 } });
    const owner = new DesktopLicenseService(database(), { required: false, directory: temporaryDirectory(), machineId: 'SERVICE-TEST-MACHINE', now: () => initialNow, verificationKey });
    expect(owner.getStatus().usage).toBeNull();
  });

  it('blocks tournament creation for the Salle training plan', () => {
    const salle = activated(token({ plan: 'SALLE' }));
    expectHttpCode(() => salle.licensing.assertTournamentCreation(), 'PLAN_UPGRADE_REQUIRED');
    expect(() => salle.licensing.assertMatchStart()).not.toThrow();
  });

  it('limits Salle+ tournament creations to 2 per calendar month', () => {
    const sallePlus = activated(token({ plan: 'SALLE_PLUS' }));
    const thisMonth = new Date(initialNow).toISOString();
    createdTournamentAt(sallePlus.db, thisMonth);
    expect(() => sallePlus.licensing.assertTournamentCreation()).not.toThrow();
    createdTournamentAt(sallePlus.db, thisMonth);
    expectHttpCode(() => sallePlus.licensing.assertTournamentCreation(), 'PLAN_TOURNAMENT_MONTHLY_LIMIT');
    expect(sallePlus.licensing.getStatus().usage).toMatchObject({ tournaments: { usedThisMonth: 2, monthlyLimit: 2 } });
  });

  it('limits Salle+ to 3 tournament creations per rolling 12 months, frees slots on deletion and ignores older ones', () => {
    const sallePlus = activated(token({ plan: 'SALLE_PLUS' }));
    const day = 86_400_000;
    const oldOutsideWindow = createdTournamentAt(sallePlus.db, new Date(initialNow - 400 * day).toISOString());
    expect(sallePlus.licensing.getStatus().usage).toMatchObject({ tournaments: { used: 0 } });
    createdTournamentAt(sallePlus.db, new Date(initialNow - 100 * day).toISOString());
    createdTournamentAt(sallePlus.db, new Date(initialNow - 40 * day).toISOString());
    expect(() => sallePlus.licensing.assertTournamentCreation()).not.toThrow();
    createdTournamentAt(sallePlus.db, new Date(initialNow - 35 * day).toISOString());
    expectHttpCode(() => sallePlus.licensing.assertTournamentCreation(), 'PLAN_TOURNAMENT_QUOTA_EXCEEDED');
    expect(sallePlus.licensing.getStatus().usage?.tournaments.nextReleaseAt).toBe(new Date(initialNow - 100 * day + 365 * day).toISOString());
    sallePlus.db.prepare('DELETE FROM tournaments WHERE id=?').run(oldOutsideWindow);
    expectHttpCode(() => sallePlus.licensing.assertTournamentCreation(), 'PLAN_TOURNAMENT_QUOTA_EXCEEDED');
    const oldest = sallePlus.db.prepare('SELECT id FROM tournaments WHERE created_at=?').get(new Date(initialNow - 100 * day).toISOString()) as { id: string };
    sallePlus.db.prepare('DELETE FROM tournaments WHERE id=?').run(oldest.id);
    expect(() => sallePlus.licensing.assertTournamentCreation()).not.toThrow();
  });

  it('keeps Salle Pro and club plans unlimited for tournament creation', () => {
    const day = 86_400_000;
    const pro = activated(tokenV2({ plan: 'SALLE_PRO' }));
    for (let index = 0; index < 5; index += 1) createdTournamentAt(pro.db, new Date(initialNow - (index + 1) * 10 * day).toISOString());
    expect(() => pro.licensing.assertTournamentCreation()).not.toThrow();
    expect(pro.licensing.getStatus().usage).toMatchObject({ matches: { limit: null }, tournaments: { limit: null } });
    const club = activated(token({ plan: 'CLUB' }));
    for (let index = 0; index < 5; index += 1) createdTournamentAt(club.db, new Date(initialNow - (index + 1) * 10 * day).toISOString());
    expect(() => club.licensing.assertTournamentCreation()).not.toThrow();
  });

  it('blocks the next match start once the monthly Salle allowance is used, without ever interrupting a running match', () => {
    const thisMonth = new Date(initialNow).toISOString();
    const salle = activated(token({ plan: 'SALLE' }));
    startedMatches(salle.db, 199, thisMonth);
    expect(() => salle.licensing.assertMatchStart()).not.toThrow();
    startedMatches(salle.db, 1, thisMonth);
    expectHttpCode(() => salle.licensing.assertMatchStart(), 'PLAN_MATCH_QUOTA_EXCEEDED');
    expect(salle.licensing.getStatus().usage).toMatchObject({ matches: { used: 200, limit: 200, resetsAt: '2026-11-01T00:00:00.000Z' } });

    const lastMonth = '2026-09-15T10:00:00.000Z';
    const salleLastMonth = activated(token({ plan: 'SALLE' }));
    startedMatches(salleLastMonth.db, 200, lastMonth);
    expect(() => salleLastMonth.licensing.assertMatchStart()).not.toThrow();
  });

  it('keeps match starts unlimited for Salle+ v1 and honors explicit v2 match quotas', () => {
    const thisMonth = new Date(initialNow).toISOString();
    const sallePlus = activated(token({ plan: 'SALLE_PLUS' }));
    startedMatches(sallePlus.db, 500, thisMonth);
    expect(() => sallePlus.licensing.assertMatchStart()).not.toThrow();

    const capped = activated(tokenV2({ matchQuota: 10 }));
    startedMatches(capped.db, 10, thisMonth);
    expectHttpCode(() => capped.licensing.assertMatchStart(), 'PLAN_MATCH_QUOTA_EXCEEDED');

    const generous = activated(tokenV2({ matchQuota: 250 }));
    startedMatches(generous.db, 200, thisMonth);
    expect(() => generous.licensing.assertMatchStart()).not.toThrow();
  });

  it('never consults quotas on unlicensed or expired deployments', () => {
    const unlicensed = service(database(), temporaryDirectory());
    expectHttpCode(() => unlicensed.assertTournamentCreation(), 'LICENSE_REQUIRED');
    expect(() => unlicensed.assertMatchStart()).not.toThrow();
    const owner = new DesktopLicenseService(database(), { required: false, directory: temporaryDirectory(), machineId: 'SERVICE-TEST-MACHINE', now: () => initialNow, verificationKey });
    expect(() => owner.assertTournamentCreation()).not.toThrow();
    expect(() => owner.assertMatchStart()).not.toThrow();
  });
});

describe('License delivery quotas (v1/v2 token issuance)', () => {
  const owner: Actor = { id: randomUUID(), role: 'SUPER_ADMIN', tournamentIds: [] };
  const deliver = async (input: Record<string, unknown>, requestKey: string) => {
    const db = database();
    db.prepare('INSERT INTO profiles(id,email,full_name,password_hash,created_at) VALUES(?,?,?,?,?)').run(owner.id, 'quota-owner@example.com', 'Quota Owner', 'not-used', new Date(initialNow).toISOString());
    let emailed: LicenseEmail | undefined;
    const sender = { send: async (message: LicenseEmail) => { emailed = message; return { messageId: 'quota-test' }; } };
    const service = new LicenseDeliveryService(db, { now: () => initialNow, env: {} as NodeJS.ProcessEnv, sender, signingKey, verificationKey });
    const result = await service.issueAndSend(owner, input, requestKey);
    if (!emailed) throw new Error('The delivery email was not captured.');
    return { result: result.delivery, emailed, db };
  };
  const input = (deviceCode: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    clubName: 'Quota Test Club', clientEmail: 'quota@example.com', plan: 'SALLE', deviceCode, expires: '2027-10-27', paymentConfirmed: true, ...extra,
  });

  it('issues v1 tokens with plan defaults (compatible with builds up to 1.2.24) and records the quotas', async () => {
    const { result, emailed, db } = await deliver(input('TKD-1111-2222-3333-4444-5555'), 'quota-delivery-v1');
    expect(result.status).toBe('SENT');
    expect(result.plan).toBe('SALLE');
    expect(result.matchQuota).toBe(200);
    expect(result.tournamentQuota).toBe(0);
    expect(emailed.token.startsWith('tkd1.')).toBe(true);
    expect(emailed.matchQuota).toBe(200);
    const row = db.prepare('SELECT match_quota,tournament_quota FROM license_deliveries WHERE id=?').get(result.id) as { match_quota: number; tournament_quota: number };
    expect(row).toMatchObject({ match_quota: 200, tournament_quota: 0 });
    const sallePlus = await deliver(input('TKD-1111-2222-3333-4444-5556', { plan: 'SALLE_PLUS' }), 'quota-delivery-v1-salle-plus');
    expect(sallePlus.emailed.token.startsWith('tkd1.')).toBe(true);
    expect(sallePlus.result.tournamentQuota).toBe(3);
  });

  it('issues v2 tokens for quota overrides and the SALLE_PRO plan', async () => {
    const overridden = await deliver(input('TKD-1111-2222-3333-4444-5557', { plan: 'SALLE_PLUS', matchQuota: 250, tournamentQuota: 5 }), 'quota-delivery-v2-override');
    expect(overridden.emailed.token.startsWith('tkd2.')).toBe(true);
    expect(overridden.result.matchQuota).toBe(250);
    expect(overridden.result.tournamentQuota).toBe(5);
    const pro = await deliver(input('TKD-1111-2222-3333-4444-5558', { plan: 'SALLE_PRO' }), 'quota-delivery-v2-pro');
    expect(pro.emailed.token.startsWith('tkd2.')).toBe(true);
    expect(pro.result.plan).toBe('SALLE_PRO');
    expect(pro.result.matchQuota).toBeNull();
    expect(pro.result.tournamentQuota).toBeNull();
  });

  it('activates delivered v1 and v2 tokens on the desktop service with the intended quotas', async () => {
    const db = database();
    const licensing = service(db, temporaryDirectory());
    const code = licensing.getStatus().installationCode;
    const v1 = await deliver(input(code), 'quota-delivery-activate-v1');
    expect(licensing.activate(v1.emailed.token).status).toBe('ACTIVE');
    expect(licensing.getStatus().usage).toMatchObject({ matches: { limit: 200 }, tournaments: { limit: 0 } });
    const v2 = await deliver(input(code, { plan: 'SALLE_PLUS', matchQuota: 280, tournamentQuota: 4 }), 'quota-delivery-activate-v2');
    expect(licensing.activate(v2.emailed.token).status).toBe('ACTIVE');
    expect(licensing.getStatus().usage).toMatchObject({ matches: { limit: 280 }, tournaments: { limit: 4 } });
    expect(licensing.getStatus().license?.plan).toBe('SALLE_PLUS');
  });

  it('keeps idempotency: the same approval key replays the same delivery', async () => {
    const db = database();
    db.prepare('INSERT INTO profiles(id,email,full_name,password_hash,created_at) VALUES(?,?,?,?,?)').run(owner.id, 'quota-owner@example.com', 'Quota Owner', 'not-used', new Date(initialNow).toISOString());
    let sent = 0;
    const sender = { send: async (message: LicenseEmail) => { sent += 1; return { messageId: 'quota-test' }; } };
    const service = new LicenseDeliveryService(db, { now: () => initialNow, env: {} as NodeJS.ProcessEnv, sender, signingKey, verificationKey });
    const first = await service.issueAndSend(owner, input('TKD-1111-2222-3333-4444-5559', { plan: 'SALLE_PLUS' }), 'quota-delivery-idempotent');
    const second = await service.issueAndSend(owner, input('TKD-1111-2222-3333-4444-5559', { plan: 'SALLE_PLUS' }), 'quota-delivery-idempotent');
    expect(second.duplicate).toBe(true);
    expect(second.delivery.licenseId).toBe(first.delivery.licenseId);
    expect(sent).toBe(1);
  });
});
