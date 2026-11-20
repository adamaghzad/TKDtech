'use client';

import Link from 'next/link';
import { CircleAlert, Clock3, Gauge, KeyRound, MessageCircle } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import type { DesktopLicenseStatus } from '@/lib/licensing';

function UsageCounters({ license }: { license: DesktopLicenseStatus }) {
  const usage = license.usage;
  if (!usage) return null;
  const matchCounter = usage.matches.limit === null ? null : { limit: usage.matches.limit, used: usage.matches.used, resetsAt: usage.matches.resetsAt };
  const tournamentCounter = usage.tournaments.limit === null ? null : { limit: usage.tournaments.limit, used: usage.tournaments.used, nextReleaseAt: usage.tournaments.nextReleaseAt };
  if (!matchCounter && !tournamentCounter) return null;
  const matchNearLimit = matchCounter && matchCounter.limit > 0 && matchCounter.used >= Math.ceil(matchCounter.limit * 0.8);
  const tournamentNearLimit = tournamentCounter && tournamentCounter.used >= tournamentCounter.limit;
  const warn = Boolean(matchNearLimit || tournamentNearLimit);
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-1.5 text-[11px] font-semibold ${warn ? 'border-timer/30 bg-timer/[.06] text-[#e4e992]' : 'border-line/60 bg-black/20 text-white/75'}`}>
      <span className="inline-flex items-center gap-1.5 opacity-70"><Gauge className="size-3.5" />Consommation</span>
      {matchCounter && (
        <span className={matchNearLimit ? 'text-[#e4e992]' : undefined}>
          Matchs ce mois : {matchCounter.used}/{matchCounter.limit}
          <span className="ml-1 font-normal opacity-60">(remise à zéro le {new Date(matchCounter.resetsAt).toLocaleDateString('fr-FR')})</span>
        </span>
      )}
      {tournamentCounter && (
        <span className={tournamentNearLimit ? 'text-[#e4e992]' : undefined}>
          Tournois (12 mois) : {tournamentCounter.used}/{tournamentCounter.limit}
          {tournamentCounter.nextReleaseAt && <span className="ml-1 font-normal opacity-60">(place libre le {new Date(tournamentCounter.nextReleaseAt).toLocaleDateString('fr-FR')})</span>}
        </span>
      )}
      {warn && (
        <a href={`https://wa.me/212614192699?text=${encodeURIComponent('Bonjour, je veux passer au niveau au-dessus (Salle+ / Salle Pro) pour mes matchs et tournois.')}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-[#25D366]/30 bg-[#25D366]/10 px-2 py-0.5 text-[#7fe0a8] transition hover:bg-[#25D366]/20">
          <MessageCircle className="size-3" />Upgrade
        </a>
      )}
    </div>
  );
}

export function LicenseNotice() {
  const { data: license } = useApi<DesktopLicenseStatus>('/api/v1/licensing/status');
  if (!license?.required) return null;
  const active = license.status === 'ACTIVE';
  const renewingSoon = active && (license.license?.daysRemaining ?? 0) <= 14;
  const hasUsage = active && Boolean(license.usage && (license.usage.matches.limit !== null || license.usage.tournaments.limit !== null));
  if (active && !renewingSoon && !hasUsage) return null;
  if (active && !renewingSoon) {
    return (
      <div role="status" className="mx-auto mb-5 max-w-[1600px]">
        <UsageCounters license={license} />
      </div>
    );
  }

  return (
    <div role="status" className={`mx-auto mb-5 flex max-w-[1600px] flex-col gap-3 rounded-xl border px-4 py-3 text-xs leading-5 sm:flex-row sm:items-center ${active ? 'border-timer/25 bg-timer/[.045] text-[#e4e992]' : 'border-red/25 bg-red/[.045] text-[#ff9aa4]'}`}>
      {active ? <Clock3 className="size-5 shrink-0 text-timer" /> : <CircleAlert className="size-5 shrink-0" />}
      <div className="flex-1">
        <p className="font-semibold">{active ? `Desktop license expires in ${license.license?.daysRemaining ?? 0} days.` : 'Desktop license action required.'}</p>
        <p className="mt-0.5 opacity-80">{active ? 'Renew before expiry to keep creating tournament work without interruption.' : license.message}</p>
        {active && <div className="mt-2"><UsageCounters license={license} /></div>}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <a href={`https://wa.me/212614192699?text=${encodeURIComponent(active ? 'Bonjour, je veux renouveler ma licence TKD Scoring.' : 'Bonjour, j\'ai besoin d\'aide avec la licence TKD Scoring.')}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-[#25D366]/30 bg-[#25D366]/10 px-3 font-semibold text-[#7fe0a8] transition hover:bg-[#25D366]/20"><MessageCircle className="size-4" />WhatsApp</a>
        <Link href="/activation" className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-white/15 px-3 font-semibold transition hover:bg-white/5"><KeyRound className="size-4" />{active ? 'Renew license' : 'Open activation'}</Link>
      </div>
    </div>
  );
}
