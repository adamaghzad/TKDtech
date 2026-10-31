import { afterEach, describe, expect, it } from 'vitest';
import type { Role } from '@tkd/contracts';
import { HttpError } from '../../apps/local-server/src/http';
import { openDatabase, type SqliteDatabase } from '../../apps/local-server/src/persistence/database';
import { TournamentRepository } from '../../apps/local-server/src/persistence/repository';

const databases: SqliteDatabase[] = [];

function database() {
  const db = openDatabase(':memory:');
  databases.push(db);
  return db;
}

function account(repository: TournamentRepository, db: SqliteDatabase, email: string, role: Role = 'TOURNAMENT_ADMIN') {
  const session = repository.registerOrganization({ name: `Organization ${email}`, fullName: `User ${email}`, email, password: 'Organization2026!' });
  if (role !== 'TOURNAMENT_ADMIN') db.prepare('UPDATE organization_members SET role=? WHERE profile_id=?').run(role, session.user.id);
  const membership = db.prepare('SELECT organization_id FROM organization_members WHERE profile_id=?').get(session.user.id) as { organization_id: string };
  const user = repository.userForProfile(session.user.id);
  return { ...session, user, organizationId: membership.organization_id, actor: repository.actor(user) };
}

function expectHttpCode(operation: () => unknown, code: string) {
  let error: unknown;
  try { operation(); } catch (reason) { error = reason; }
  expect(error).toBeInstanceOf(HttpError);
  expect((error as HttpError).code).toBe(code);
}

afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
});

describe('organization role management', () => {
  it('lets a Super Admin promote a Tournament Admin and updates an existing session with an audit record', () => {
    const db = database();
    const repository = new TournamentRepository(db);
    const owner = account(repository, db, 'owner@example.com', 'SUPER_ADMIN');
    const target = account(repository, db, 'target@example.com');

    const result = repository.changeOrganizationMemberRole(owner.actor, { organizationId: target.organizationId, profileId: target.user.id, role: 'SUPER_ADMIN' });

    expect(result.changed).toBe(true);
    expect(result.member).toMatchObject({ email: 'target@example.com', role: 'SUPER_ADMIN' });
    expect(repository.userForProfile(target.user.id).role).toBe('SUPER_ADMIN');
    expect(repository.userForToken(target.token)?.role).toBe('SUPER_ADMIN');
    expect(repository.listOrganizationMembers(owner.actor)).toHaveLength(2);
    const audit = db.prepare(`SELECT action,entity_type,before_json,after_json FROM audit_logs WHERE action='ORGANIZATION_MEMBER_ROLE_CHANGED'`).get() as { action: string; entity_type: string; before_json: string; after_json: string };
    expect(audit).toMatchObject({ action: 'ORGANIZATION_MEMBER_ROLE_CHANGED', entity_type: 'organization_member' });
    expect(JSON.parse(audit.before_json)).toEqual({ role: 'TOURNAMENT_ADMIN' });
    expect(JSON.parse(audit.after_json)).toEqual({ role: 'SUPER_ADMIN' });
  });

  it('denies member listing and role elevation to a Tournament Admin', () => {
    const db = database();
    const repository = new TournamentRepository(db);
    const target = account(repository, db, 'admin@example.com');

    expectHttpCode(() => repository.listOrganizationMembers(target.actor), 'SUPER_ADMIN_REQUIRED');
    expectHttpCode(() => repository.changeOrganizationMemberRole(target.actor, { organizationId: target.organizationId, profileId: target.user.id, role: 'SUPER_ADMIN' }), 'SUPER_ADMIN_REQUIRED');
    expect(repository.userForProfile(target.user.id).role).toBe('TOURNAMENT_ADMIN');
  });

  it('requires another Super Admin to change the current account role', () => {
    const db = database();
    const repository = new TournamentRepository(db);
    const owner = account(repository, db, 'owner@example.com', 'SUPER_ADMIN');

    expectHttpCode(() => repository.changeOrganizationMemberRole(owner.actor, { organizationId: owner.organizationId, profileId: owner.user.id, role: 'TOURNAMENT_ADMIN' }), 'SELF_ROLE_CHANGE_FORBIDDEN');
    expect(repository.userForProfile(owner.user.id).role).toBe('SUPER_ADMIN');
  });

  it('prevents demotion of the only Super Admin in an organization', () => {
    const db = database();
    const repository = new TournamentRepository(db);
    const owner = account(repository, db, 'owner@example.com', 'SUPER_ADMIN');
    const other = account(repository, db, 'other@example.com', 'SUPER_ADMIN');

    expectHttpCode(() => repository.changeOrganizationMemberRole(owner.actor, { organizationId: other.organizationId, profileId: other.user.id, role: 'TOURNAMENT_ADMIN' }), 'LAST_SUPER_ADMIN');
    expect(repository.userForProfile(other.user.id).role).toBe('SUPER_ADMIN');
  });

  it('treats an unchanged role as idempotent without a duplicate audit record', () => {
    const db = database();
    const repository = new TournamentRepository(db);
    const owner = account(repository, db, 'owner@example.com', 'SUPER_ADMIN');
    const target = account(repository, db, 'target@example.com');

    const result = repository.changeOrganizationMemberRole(owner.actor, { organizationId: target.organizationId, profileId: target.user.id, role: 'TOURNAMENT_ADMIN' });

    expect(result.changed).toBe(false);
    expect(result.member.role).toBe('TOURNAMENT_ADMIN');
    expect(db.prepare(`SELECT COUNT(*) AS count FROM audit_logs WHERE action='ORGANIZATION_MEMBER_ROLE_CHANGED'`).get()).toEqual({ count: 0 });
  });
});
