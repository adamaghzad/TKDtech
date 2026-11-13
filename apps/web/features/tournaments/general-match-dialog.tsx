'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Swords } from 'lucide-react';
import type { Mat } from '@/lib/types';
import { post } from '@/lib/api';
import { Button, type ButtonProps } from '@/components/ui/button';
import { CountryFlag, normalizeCountryCode } from '@/components/ui/country-flag';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useAdmin } from '@/components/admin/admin-context';

interface GeneralMatchDialogProps {
  tournamentId?: string;
  mats?: Mat[];
  defaultMatId?: string;
  label?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
  onCreated?: () => Promise<void> | void;
}

const PRESETS = [
  { label: 'Senior (3 × 2:00 · 1:00 rest)', rounds: '3', roundSec: '120', breakSec: '60' },
  { label: 'Junior / Cadet (3 × 1:30 · 0:45 rest)', rounds: '3', roundSec: '90', breakSec: '45' },
  { label: 'Kids / Fast (3 × 1:00 · 0:30 rest)', rounds: '3', roundSec: '60', breakSec: '30' },
  { label: 'Quick Sparring (2 × 1:00 · 0:30 rest)', rounds: '2', roundSec: '60', breakSec: '30' },
] as const;

export function GeneralMatchDialog({
  tournamentId,
  mats,
  defaultMatId,
  label = 'General Match (Chung vs Hong)',
  variant = 'default',
  size = 'default',
  className,
  onCreated,
}: GeneralMatchDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const admin = useAdmin();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [blueName, setBlueName] = useState('CHUNG');
  const [redName, setRedName] = useState('HONG');
  const [blueCode, setBlueCode] = useState('MAR');
  const [redCode, setRedCode] = useState('MAR');
  const [categoryName, setCategoryName] = useState('General Match');
  const [rounds, setRounds] = useState('3');
  const [roundSec, setRoundSec] = useState('120');
  const [breakSec, setBreakSec] = useState('60');
  const [matId, setMatId] = useState<string | null>(null);
  const autoMatId = defaultMatId ?? (mats?.find(item => item.status === 'AVAILABLE') ?? mats?.[0])?.id ?? '';
  const effectiveMatId = matId ?? autoMatId;

  const startGeneralMatch = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      let targetTournamentId = tournamentId || admin.selectedTournamentId || admin.data.activeTournament?.id;
      if (!targetTournamentId) {
        const today = new Date().toISOString().slice(0, 10);
        const createdTournament = await post<{ id: string }>('/api/v1/tournaments', {
          name: 'General Sparring Session',
          startDate: today,
          endDate: today,
          matCount: 2,
          mode: 'LOCAL',
        });
        targetTournamentId = createdTournament.id;
        admin.selectTournament(targetTournamentId);
      }

      const created = await post<{ matchId: string; matchNumber: string; matId: string | null }>(
        `/api/v1/tournaments/${targetTournamentId}/general-matches`,
        {
          blueName: blueName.trim() || 'CHUNG',
          redName: redName.trim() || 'HONG',
          blueCountryCode: normalizeCountryCode(blueCode, 'MAR'),
          redCountryCode: normalizeCountryCode(redCode, 'MAR'),
          categoryName: categoryName.trim() || 'General Match',
          rounds: Math.min(9, Math.max(1, Number(rounds) || 3)),
          roundDurationMs: Math.min(600, Math.max(5, Number(roundSec) || 120)) * 1000,
          breakDurationMs: Math.min(300, Math.max(0, Number(breakSec) || 60)) * 1000,
          matId: effectiveMatId ? effectiveMatId : undefined,
        },
      );

      await admin.refresh();
      if (onCreated) await onCreated();
      setOpen(false);
      toast(
        `Match #${created.matchNumber} ready`,
        `${blueName.trim() || 'CHUNG'} vs ${redName.trim() || 'HONG'} opened on operator scoreboard.`,
      );
      router.push(`/scoreboard/${created.matchId}`);
    } catch (error) {
      toast('Could not create General Match', (error as Error).message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} className={className} data-testid="open-general-match-dialog">
          <Swords /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent
        title="General Match · Chung vs Hong"
        description="Start an instant standalone bout without athlete registration, weigh-ins, or bracket draws."
        className="max-w-xl"
      >
        <form className="space-y-4" onSubmit={startGeneralMatch}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-blue/40 bg-blue/10 p-3 space-y-2.5">
              <p className="text-[10px] font-black uppercase tracking-widest text-[#8baeff]">Blue Corner (Chung)</p>
              <Field label="Corner / Fighter name">
                <Input
                  value={blueName}
                  onChange={e => setBlueName(e.target.value)}
                  placeholder="CHUNG"
                  data-testid="general-blue-name"
                />
              </Field>
              <Field label="Country code">
                <div className="flex items-center gap-2">
                  <CountryFlag code={blueCode} className="w-9 rounded-[3px] ring-1 ring-white/30 shadow-sm" />
                  <Input maxLength={3} value={blueCode} onChange={e => setBlueCode(e.target.value.toUpperCase())} placeholder="MAR" />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {(['MAR', 'TUN', 'ALG', 'FRA', 'ESP', 'KOR'] as const).map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setBlueCode(c)}
                      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold transition ${
                        normalizeCountryCode(blueCode, '') === c
                          ? 'border-[#8baeff] bg-blue/30 text-white'
                          : 'border-white/15 bg-black/25 text-white/70 hover:border-white/35 hover:text-white'
                      }`}
                    >
                      <CountryFlag code={c} className="w-3.5 rounded-[1.5px]" />
                      {c}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
            <div className="rounded-xl border border-red/40 bg-red/10 p-3 space-y-2.5">
              <p className="text-[10px] font-black uppercase tracking-widest text-[#ff8b96]">Red Corner (Hong)</p>
              <Field label="Corner / Fighter name">
                <Input
                  value={redName}
                  onChange={e => setRedName(e.target.value)}
                  placeholder="HONG"
                  data-testid="general-red-name"
                />
              </Field>
              <Field label="Country code">
                <div className="flex items-center gap-2">
                  <CountryFlag code={redCode} className="w-9 rounded-[3px] ring-1 ring-white/30 shadow-sm" />
                  <Input maxLength={3} value={redCode} onChange={e => setRedCode(e.target.value.toUpperCase())} placeholder="MAR" />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {(['MAR', 'TUN', 'ALG', 'FRA', 'ESP', 'KOR'] as const).map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setRedCode(c)}
                      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold transition ${
                        normalizeCountryCode(redCode, '') === c
                          ? 'border-[#ff8b96] bg-red/30 text-white'
                          : 'border-white/15 bg-black/25 text-white/70 hover:border-white/35 hover:text-white'
                      }`}
                    >
                      <CountryFlag code={c} className="w-3.5 rounded-[1.5px]" />
                      {c}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-muted">Quick timing presets</p>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map(preset => {
                const active = rounds === preset.rounds && roundSec === preset.roundSec && breakSec === preset.breakSec;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setRounds(preset.rounds);
                      setRoundSec(preset.roundSec);
                      setBreakSec(preset.breakSec);
                    }}
                    className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition ${
                      active
                        ? 'border-primary bg-primary/20 text-white'
                        : 'border-line/70 bg-white/[.02] text-muted hover:border-primary/40 hover:text-white'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Rounds">
              <Input type="number" min={1} max={9} value={rounds} onChange={e => setRounds(e.target.value)} />
            </Field>
            <Field label="Round (seconds)">
              <Input type="number" min={5} max={600} value={roundSec} onChange={e => setRoundSec(e.target.value)} />
            </Field>
            <Field label="Rest break (seconds)">
              <Input type="number" min={0} max={300} value={breakSec} onChange={e => setBreakSec(e.target.value)} />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Scoreboard header label">
              <Input value={categoryName} onChange={e => setCategoryName(e.target.value)} placeholder="General Match" />
            </Field>
            {mats && mats.length > 0 ? (
              <Field label="Assign to mat">
                <Select value={effectiveMatId} onChange={e => setMatId(e.target.value)}>
                  <option value="">Auto-select available mat</option>
                  {mats.map(mat => (
                    <option key={mat.id} value={mat.id}>
                      {mat.name} ({mat.status})
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label="Mat assignment">
                <Input disabled value="Auto-assign first available mat" />
              </Field>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} data-testid="submit-general-match">
              <Play /> {submitting ? 'Creating…' : `Start ${blueName.trim() || 'CHUNG'} vs ${redName.trim() || 'HONG'}`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
