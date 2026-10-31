import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../../apps/local-server/src/persistence/database';
import { TournamentRepository } from '../../apps/local-server/src/persistence/repository';
import { recoverSingleOrganizationSuperAdmin } from '../../apps/local-server/src/persistence/owner-recovery';

const databases: SqliteDatabase[] = [];
function setup() {
  const db = openDatabase(':memory:');
  databases.push(db);
  return { db, repository: new TournamentRepository(db) };
}
afterEach(() => { for (const db of databases.splice(0)) if (db.open) db.close(); });

describe('temporary owner recovery', () => {
  it('promotes only the exact Tournament Admin and writes one audit record', () => {
    const { db, repository } = setup();
    const target = repository.registerOrganization({ name: 'Owner recovery', fullName: 'Target', email: 'adam.aghzaf@gmail.com', password: 'OwnerRecovery2026!' });
    const other = repository.registerOrganization({ name: 'Other organization', fullName: 'Other', email: 'other@example.com', password: 'OtherAccount2026!' });

    expect(recoverSingleOrganizationSuperAdmin(db, 'ADAM.AGHZAF@GMAIL.COM').status).toBe('PROMOTED');
    expect(repository.userForProfile(target.user.id).role).toBe('SUPER_ADMIN');
    expect(repository.userForProfile(other.user.id).role).toBe('TOURNAMENT_ADMIN');
    expect(recoverSingleOrganizationSuperAdmin(db, 'adam.aghzaf@gmail.com').status).toBe('ALREADY_SUPER_ADMIN');
    const audit = db.prepare(`SELECT action,before_json,after_json,reason FROM audit_logs WHERE action='ORGANIZATION_MEMBER_ROLE_RECOVERED'`).all() as Array<{ action: string; before_json: string; after_json: string; reason: string }>;
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]!.before_json)).toEqual({ role: 'TOURNAMENT_ADMIN' });
    expect(JSON.parse(audit[0]!.after_json)).toEqual({ role: 'SUPER_ADMIN' });
  });

  it('refuses a missing account', () => {
    const { db } = setup();
    expect(() => recoverSingleOrganizationSuperAdmin(db, 'missing@example.com')).toThrow('RECOVERY_ACCOUNT_NOT_FOUND');
  });

  it('refuses ambiguous multi-organization membership without changing either role', () => {
    const { db, repository } = setup();
    const target = repository.registerOrganization({ name: 'First organization', fullName: 'Target', email: 'target@example.com', password: 'OwnerRecovery2026!' });
    const other = repository.registerOrganization({ name: 'Second organization', fullName: 'Other', email: 'other@example.com', password: 'OtherAccount2026!' });
    const otherMembership = db.prepare('SELECT organization_id FROM organization_members WHERE profile_id=?').get(other.user.id) as { organization_id: string };
    db.prepare('INSERT INTO organization_members(organization_id,profile_id,role) VALUES(?,?,?)').run(otherMembership.organization_id, target.user.id, 'TOURNAMENT_ADMIN');

    expect(() => recoverSingleOrganizationSuperAdmin(db, 'target@example.com')).toThrow('RECOVERY_SINGLE_MEMBERSHIP_REQUIRED');
    expect(db.prepare('SELECT role FROM organization_members WHERE profile_id=?').all(target.user.id)).toEqual([{ role: 'TOURNAMENT_ADMIN' }, { role: 'TOURNAMENT_ADMIN' }]);
  });
});
