'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRight, Check, CircleAlert, Clock3, Copy, FileKey2, KeyRound, Mail, MessageCircle, ShieldCheck, Upload } from 'lucide-react';
import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { api, post } from '@/lib/api';
import type { DesktopLicenseStatus } from '@/lib/licensing';

const schema = z.object({
  token: z.string().trim().min(100, 'Choose a valid .tkdlicense file or paste its complete contents.').max(16_384, 'The license file is too large.'),
});
type Values = z.infer<typeof schema>;

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement('textarea');
  field.value = value;
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  document.execCommand('copy');
  field.remove();
}

export default function Activation() {
  const router = useRouter();
  const { toast } = useToast();
  const [status, setStatus] = useState<DesktopLicenseStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [fileName, setFileName] = useState('');
  const [copied, setCopied] = useState(false);
  const { register, handleSubmit, setValue, setError, clearErrors, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { token: '' },
  });

  const load = useCallback(async () => {
    try {
      setStatus(await api<DesktopLicenseStatus>('/api/v1/licensing/status'));
      setLoadError('');
    } catch (reason) {
      setLoadError((reason as Error).message);
    }
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  const submit = async (values: Values) => {
    try {
      const activated = await post<DesktopLicenseStatus>('/api/v1/licensing/activate', values);
      setStatus(activated);
      toast('Desktop activated', `Licensed to ${activated.license?.clubName ?? 'this club'}.`);
      router.replace('/login');
    } catch (reason) {
      setError('token', { message: (reason as Error).message });
    }
  };

  const readFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 16_384) {
      setError('token', { message: 'The selected file is not a valid desktop license.' });
      return;
    }
    const contents = await file.text();
    setValue('token', contents, { shouldValidate: true });
    clearErrors('token');
    setFileName(file.name);
  };

  const installationCode = status?.installationCode ?? '';
  const requestMessage = `Hello, I would like to activate TKD Scoring Desktop. Installation code: ${installationCode || 'unavailable'}.`;
  const whatsappUrl = `https://wa.me/212614192699?text=${encodeURIComponent(requestMessage)}`;
  const emailUrl = `mailto:adam.aghzaf@gmail.com?subject=${encodeURIComponent('TKD Scoring Desktop activation')}&body=${encodeURIComponent(requestMessage)}`;
  const active = status?.status === 'ACTIVE';

  return (
    <div className="grid min-h-screen xl:grid-cols-[.9fr_1.1fr]">
      <section className="relative hidden overflow-hidden border-r border-line/60 bg-sidebar p-12 xl:flex xl:flex-col xl:justify-between">
        <div className="absolute -left-32 -top-32 size-[420px] rounded-full bg-primary/10 blur-[110px]" />
        <div className="absolute -bottom-32 -right-20 size-[360px] rounded-full bg-success/[.06] blur-[100px]" />
        <Brand className="relative" />
        <div className="relative max-w-xl">
          <p className="mb-4 text-xs font-bold uppercase tracking-[.22em] text-primary">Desktop license activation</p>
          <h1 className="text-balance text-5xl font-black leading-[1.08] tracking-tight">Your tournament system.<br /><span className="text-[#6f9eff]">Ready for your club.</span></h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-muted">The installer can be shared freely. Tournament operations require a signed license issued after subscription confirmation.</p>
          <ol className="mt-9 space-y-5">
            {[
              ['1', 'Send your installation code', 'Use WhatsApp or email after choosing your subscription.'],
              ['2', 'Receive your private license file', 'It is signed for this computer and the paid period.'],
              ['3', 'Import and work offline', 'Scoring and LAN devices do not need an Internet connection.'],
            ].map(([number, title, detail]) => (
              <li key={number} className="flex gap-4">
                <span className="numeric flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-xs font-bold text-primary">{number}</span>
                <div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs leading-5 text-muted">{detail}</p></div>
              </li>
            ))}
          </ol>
        </div>
        <p className="relative text-xs text-muted">Original TKD Scoring software · ADAM AGHZAF</p>
      </section>

      <section className="flex items-center justify-center p-5 sm:p-8 lg:p-12">
        <div className="w-full max-w-2xl py-6">
          <Brand className="mb-8 xl:hidden" />
          <div className="mb-7">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.16em] text-primary"><KeyRound className="size-4" /> Licensed desktop</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">{active ? 'Your desktop is activated' : 'Activate this computer'}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">No payment details are entered here. Request your license, then import the signed file.</p>
          </div>

          {loadError && <div role="alert" className="mb-5 flex gap-3 rounded-xl border border-red/30 bg-red/5 p-4 text-sm text-[#ff9aa4]"><CircleAlert className="mt-0.5 size-5 shrink-0" /><span>{loadError}</span></div>}
          {!status && !loadError && <div className="panel flex min-h-64 items-center justify-center"><div className="size-8 animate-spin rounded-full border-2 border-line border-t-primary" /><span className="sr-only">Reading license status</span></div>}

          {status && (
            <>
              {status.license && (
                <div className={`mb-5 rounded-xl border p-4 ${active ? 'border-success/25 bg-success/[.055]' : 'border-timer/25 bg-timer/[.045]'}`}>
                  <div className="flex items-start gap-3">
                    {active ? <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" /> : <Clock3 className="mt-0.5 size-5 shrink-0 text-timer" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{status.license.clubName}</p>
                      <p className="mt-1 text-xs leading-5 text-muted">{status.license.plan.replaceAll('_', ' ')} · License {status.license.licenseId}</p>
                      <p className="mt-1 text-xs text-muted">Valid until {new Intl.DateTimeFormat('en-GB', { dateStyle: 'long' }).format(new Date(status.license.expiresAt))}{active ? ` · ${status.license.daysRemaining} days remaining` : ''}</p>
                    </div>
                  </div>
                </div>
              )}

              {status.message && (
                <div role="alert" className={`mb-5 flex gap-3 rounded-xl border p-4 text-xs leading-5 ${active ? 'border-success/25 bg-success/5 text-success' : 'border-timer/25 bg-timer/[.045] text-[#e4e992]'}`}>
                  <CircleAlert className="mt-0.5 size-4 shrink-0" /><span>{status.message}</span>
                </div>
              )}

              <div className="panel p-5 sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[.1em] text-muted">Your installation code</p>
                    <p data-testid="installation-code" className="numeric mt-2 break-all text-lg font-bold tracking-[.06em] text-white sm:text-xl">{installationCode || 'Unavailable — contact support'}</p>
                    <p className="mt-2 text-[11px] leading-5 text-muted">This is not a password. It identifies the computer for your license.</p>
                  </div>
                  <Button type="button" variant="secondary" size="sm" disabled={!installationCode} onClick={() => void copyText(installationCode).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); })}>
                    {copied ? <Check /> : <Copy />}{copied ? 'Copied' : 'Copy code'}
                  </Button>
                </div>
                <div className="mt-5 flex flex-wrap gap-2 border-t border-line/60 pt-5">
                  <Button asChild size="sm"><a href={whatsappUrl} target="_blank" rel="noreferrer"><MessageCircle /> Request on WhatsApp</a></Button>
                  <Button asChild size="sm" variant="secondary"><a href={emailUrl}><Mail /> Request by email</a></Button>
                  <Button asChild size="sm" variant="ghost"><a href="https://adamaghzad.github.io/tkd-scoring/subscription/" target="_blank" rel="noreferrer">View subscriptions <ArrowRight /></a></Button>
                </div>
              </div>

              <form onSubmit={handleSubmit(submit)} className="panel mt-5 space-y-5 p-5 sm:p-6">
                <div>
                  <div className="flex items-center gap-2"><FileKey2 className="size-5 text-primary" /><h3 className="text-sm font-semibold">{active ? 'Replace or renew the license' : 'Import your license'}</h3></div>
                  <p className="mt-1.5 text-xs leading-5 text-muted">Choose the <code>.tkdlicense</code> file sent by TKDTech. Its signature and device binding are verified before it is saved.</p>
                </div>
                <label className="flex cursor-pointer items-center justify-center gap-3 rounded-xl border border-dashed border-primary/35 bg-primary/[.035] px-4 py-5 text-center transition hover:border-primary/60 hover:bg-primary/[.06]">
                  <Upload className="size-5 text-primary" />
                  <span className="text-sm font-semibold">{fileName || 'Choose license file'}</span>
                  <input type="file" accept=".tkdlicense,.txt,text/plain" className="sr-only" onChange={(event) => void readFile(event.target.files?.[0])} />
                </label>
                <Field label="Or paste the license file contents" error={errors.token?.message}>
                  <Textarea spellCheck={false} autoComplete="off" className="min-h-28 resize-y break-all font-mono text-[10px] leading-4" placeholder="tkd1.…" {...register('token')} />
                </Field>
                <Button type="submit" size="lg" className="w-full" disabled={isSubmitting || !status.required}>
                  {isSubmitting ? 'Verifying signed license…' : active ? 'Verify and replace license' : 'Verify and activate'}<ArrowRight />
                </Button>
              </form>

              <div className="mt-6 flex flex-col items-start justify-between gap-3 text-xs text-muted sm:flex-row sm:items-center">
                <p>Saved tournaments remain available in read/export mode.</p>
                <Link href="/login" className="flex items-center gap-1.5 font-semibold text-primary hover:underline">{status.canFinishActiveTournament ? 'Sign in to finish or export' : 'Access saved records'}<ArrowRight className="size-3.5" /></Link>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
