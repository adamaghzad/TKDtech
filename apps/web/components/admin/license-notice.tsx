'use client';

import Link from 'next/link';
import { CircleAlert, Clock3, KeyRound } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import type { DesktopLicenseStatus } from '@/lib/licensing';

export function LicenseNotice() {
  const { data: license } = useApi<DesktopLicenseStatus>('/api/v1/licensing/status');
  if (!license?.required) return null;
  const active = license.status === 'ACTIVE';
  const renewingSoon = active && (license.license?.daysRemaining ?? 0) <= 14;
  if (active && !renewingSoon) return null;

  return (
    <div role="status" className={`mx-auto mb-5 flex max-w-[1600px] flex-col gap-3 rounded-xl border px-4 py-3 text-xs leading-5 sm:flex-row sm:items-center ${active ? 'border-timer/25 bg-timer/[.045] text-[#e4e992]' : 'border-red/25 bg-red/[.045] text-[#ff9aa4]'}`}>
      {active ? <Clock3 className="size-5 shrink-0 text-timer" /> : <CircleAlert className="size-5 shrink-0" />}
      <div className="flex-1">
        <p className="font-semibold">{active ? `Desktop license expires in ${license.license?.daysRemaining ?? 0} days.` : 'Desktop license action required.'}</p>
        <p className="mt-0.5 opacity-80">{active ? 'Renew before expiry to keep creating tournament work without interruption.' : license.message}</p>
      </div>
      <Link href="/activation" className="inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-lg border border-white/15 px-3 font-semibold transition hover:bg-white/5"><KeyRound className="size-4" />{active ? 'Renew license' : 'Open activation'}</Link>
    </div>
  );
}
