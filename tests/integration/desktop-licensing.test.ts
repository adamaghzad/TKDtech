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
