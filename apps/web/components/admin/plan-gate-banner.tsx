'use client';

import { MessageCircle, Lock } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import type { DesktopLicenseStatus } from '@/lib/licensing';

type PlanGateFeature = 'registrations' | 'draws' | 'podium' | 'reports';

const FEATURE_LABELS: Record<PlanGateFeature, string> = {
  registrations: 'Registrations (clubs, categories, athletes)',
  draws: 'Draw generation and publishing',
  podium: 'Podium and medal ceremonies',
  reports: 'PDF and CSV reports',
};

/** Shown on tournament production sections when the active license is the Salle training plan. */
export function PlanGateBanner({ feature }: { feature: PlanGateFeature }) {
  const { data: license } = useApi<DesktopLicenseStatus>('/api/v1/licensing/status');
  if (!license?.capabilities || license.capabilities[feature]) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
      <div className="flex items-start gap-3">
        <Lock className="mt-0.5 size-4 shrink-0 text-amber-400" />
        <div>
          <p className="text-sm font-semibold text-amber-200">{FEATURE_LABELS[feature]} need the Salle+ plan</p>
          <p className="mt-0.5 text-xs leading-5 text-amber-200/70">
            Your Salle license covers training, grades and single-judge scoring. Tournaments — registrations, draws, podium and reports — are included with Salle+.
          </p>
        </div>
      </div>
      <a
        href="https://wa.me/212614192699?text=Bonjour%20Adam%2C%20je%20veux%20passer%20au%20plan%20Salle%2B%20pour%20mes%20tournois."
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-lg bg-[#25D366] px-3.5 py-2 text-xs font-bold text-[#062b17] transition hover:brightness-110"
      >
        <MessageCircle className="size-4" /> Upgrade to Salle+
      </a>
    </div>
  );
}
