'use client';

import { useState } from 'react';
import { Loader2, ShieldCheck, UsersRound } from 'lucide-react';
import { ROLES, type Role } from '@tkd/contracts';
import { useAdmin } from '@/components/admin/admin-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { EmptyState, ErrorState, Loading } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { post } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface OrganizationMember {
  organizationId: string;
  profileId: string;
  organizationName: string;
  fullName: string;
  email: string;
  role: Role;
}

interface RoleChangeResult {
  member: OrganizationMember;
  changed: boolean;
}

function roleLabel(role: Role) {
  return role.replaceAll('_', ' ');
}

function MemberRoleRow({ member, currentUserId, onChanged }: { member: OrganizationMember; currentUserId: string; onChanged: () => Promise<void> }) {
  const { toast } = useToast();
  const [role, setRole] = useState<Role>(member.role);
  const [pending, setPending] = useState(false);
  const self = member.profileId === currentUserId;

  const submit = async () => {
    setPending(true);
    try {
      const result = await post<RoleChangeResult>('/api/v1/admin/organization-members/role', {
        organizationId: member.organizationId,
        profileId: member.profileId,
        role,
      });
      setRole(result.member.role);
      await onChanged();
      toast(result.changed ? 'Role updated' : 'Role already up to date', `${result.member.email} · ${roleLabel(result.member.role)}`);
    } catch (error) {
      toast('Role change failed', (error as Error).message, 'error');
    } finally {
      setPending(false);
    }
  };

  return <article data-testid={`organization-member-${member.profileId}`} className="grid gap-4 rounded-xl border border-line/60 bg-black/10 p-4 xl:grid-cols-[minmax(0,1fr)_auto_minmax(17rem,22rem)] xl:items-center">
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold">{member.fullName}</p>
      <p className="mt-1 break-all text-xs text-muted">{member.email}</p>
      <p className="mt-1 text-[11px] text-muted">{member.organizationName}{self ? ' · Your account' : ''}</p>
    </div>
    <div>
      <Badge tone={member.role === 'SUPER_ADMIN' ? 'green' : 'blue'}>{roleLabel(member.role)}</Badge>
    </div>
    <div className="flex flex-col gap-2 sm:flex-row">
      <Select aria-label={`Role for ${member.email}`} value={role} disabled={self || pending} onChange={(event) => setRole(event.target.value as Role)}>
        {ROLES.map((option) => <option key={option} value={option}>{roleLabel(option)}</option>)}
      </Select>
      <Button type="button" size="sm" className="shrink-0" disabled={self || pending || role === member.role} onClick={() => void submit()}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
        {pending ? 'Saving…' : 'Change role'}
      </Button>
    </div>
    {self && <p className="text-[11px] leading-5 text-muted xl:col-span-3">Your own role must be changed by another Super Admin. This prevents accidental lockout.</p>}
  </article>;
}

export function OrganizationRoleManager() {
  const { data: admin } = useAdmin();
  const owner = admin.user.role === 'SUPER_ADMIN';
  const { data, error, loading, refresh } = useApi<OrganizationMember[]>(owner ? '/api/v1/admin/organization-members' : null);
  if (!owner) return null;

  return <Card>
    <CardHeader className="flex flex-wrap items-center justify-between gap-3">
      <CardTitle className="flex items-center gap-2"><UsersRound className="size-4 text-primary" />Organization role management</CardTitle>
      <Badge tone="green">Super Admin only</Badge>
    </CardHeader>
    <CardContent className="space-y-4">
      <p className="text-xs leading-5 text-muted">Promote or demote members by email. The server verifies every change, records it in the audit log, and applies it to existing sessions on their next request.</p>
      {loading && <Loading label="Loading organization members…" />}
      {error && <ErrorState error={error} retry={() => void refresh()} />}
      {data && data.length === 0 && <EmptyState title="No organization members" description="No member accounts are available for role management." />}
      <div className="space-y-3">
        {data?.map((member) => <MemberRoleRow key={`${member.organizationId}:${member.profileId}`} member={member} currentUserId={admin.user.id} onChanged={refresh} />)}
      </div>
    </CardContent>
  </Card>;
}
