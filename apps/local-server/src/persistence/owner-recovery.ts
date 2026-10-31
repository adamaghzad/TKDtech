import type { SqliteDatabase } from './database';
import { audit } from './audit';

export interface OwnerRecoveryResult {
  status: 'PROMOTED' | 'ALREADY_SUPER_ADMIN';
  organizationId: string;
  profileId: string;
}

/** Temporary owner-approved hosted recovery. This is not exposed through any API. */
export function recoverSingleOrganizationSuperAdmin(db: SqliteDatabase, email: string): OwnerRecoveryResult {
  let result: OwnerRecoveryResult | undefined;
  db.transaction(() => {
    const profile = db.prepare('SELECT id FROM profiles WHERE lower(email)=lower(?)').get(email) as { id: string } | undefined;
    if (!profile) throw new Error('RECOVERY_ACCOUNT_NOT_FOUND');
    const memberships = db.prepare('SELECT organization_id,role FROM organization_members WHERE profile_id=?').all(profile.id) as Array<{ organization_id: string; role: string }>;
    if (memberships.length !== 1) throw new Error('RECOVERY_SINGLE_MEMBERSHIP_REQUIRED');
    const membership = memberships[0]!;
    if (membership.role === 'SUPER_ADMIN') {
      result = { status: 'ALREADY_SUPER_ADMIN', organizationId: membership.organization_id, profileId: profile.id };
      return;
    }
    if (membership.role !== 'TOURNAMENT_ADMIN') throw new Error('RECOVERY_TOURNAMENT_ADMIN_REQUIRED');
    const update = db.prepare(`UPDATE organization_members SET role='SUPER_ADMIN' WHERE organization_id=? AND profile_id=? AND role='TOURNAMENT_ADMIN'`).run(membership.organization_id, profile.id);
    if (update.changes !== 1) throw new Error('RECOVERY_ROLE_CONFLICT');
    audit(db, {
      action: 'ORGANIZATION_MEMBER_ROLE_RECOVERED',
      entityType: 'organization_member',
      entityId: `${membership.organization_id}:${profile.id}`,
      before: { role: 'TOURNAMENT_ADMIN' },
      after: { role: 'SUPER_ADMIN' },
      reason: 'Owner-approved one-time hosted recovery; no self-service authorization granted.',
    });
    result = { status: 'PROMOTED', organizationId: membership.organization_id, profileId: profile.id };
  })();
  if (!result) throw new Error('RECOVERY_FAILED');
  return result;
}
