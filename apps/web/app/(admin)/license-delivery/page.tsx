'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarDays, CheckCircle2, CircleAlert, KeyRound, LockKeyhole, MailCheck, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { useAdmin } from '@/components/admin/admin-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { ErrorState, Loading } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { post } from '@/lib/api';
import { useApi } from '@/lib/use-api';

const plans = ['FOUNDING_CLUB', 'CLUB', 'TOURNAMENT_SUPPORT'] as const;
const schema = z.object({
  clubName: z.string().trim().min(2, 'Enter the client or club name.').max(180),
  clientEmail: z.string().trim().email('Enter a valid client email.').max(254),
  plan: z.enum(plans),
  deviceCode: z.string().trim().regex(/^TKD(?:-[0-9A-F]{4}){5}$/i, 'Enter the complete installation code from the client.'),
  expires: z.string().date('Choose the paid-until date.').refine((value) => Date.parse(`${value}T23:59:59.999Z`) > Date.now(), 'The paid-until date must be in the future.'),
  paymentConfirmed: z.boolean().refine((value) => value, 'Confirm payment before issuing the license.'),
});
type Values = z.infer<typeof schema>;

type Delivery = {
  id: string;
  licenseId: string;
  clubName: string;
  clientEmail: string;
  plan: typeof plans[number];
  deviceCode: string;
  issuedAt: string;
  expiresAt: string;
  status: 'SENDING' | 'SENT' | 'FAILED';
  emailMessageId: string | null;
  deliveryError: string | null;
  createdAt: string;
  sentAt: string | null;
};
type Dashboard = { configuration: { configured: boolean; missing: string[] }; deliveries: Delivery[] };
type DeliveryResult = { delivery: Delivery; duplicate: boolean };

function isoDay(date: Date): string { return date.toISOString().slice(0, 10); }
function defaultExpiry(): string { const date = new Date(); date.setUTCFullYear(date.getUTCFullYear() + 1); return isoDay(date); }
function planLabel(plan: typeof plans[number]): string {
  if (plan === 'FOUNDING_CLUB') return 'Founding Club';
  if (plan === 'TOURNAMENT_SUPPORT') return 'Tournament Support';
  return 'Club';
}

export default function LicenseDeliveryPage() {
  const { data: admin } = useAdmin();
  const owner = admin.user.role === 'SUPER_ADMIN';
  const { data, error, loading, refresh } = useApi<Dashboard>(owner ? '/api/v1/admin/license-deliveries' : null);
  const { toast } = useToast();
  const [submitError, setSubmitError] = useState('');
  const [lastDelivery, setLastDelivery] = useState<Delivery | null>(null);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { clubName: '', clientEmail: '', plan: 'CLUB', deviceCode: '', expires: defaultExpiry(), paymentConfirmed: false },
  });

  if (!owner) return <Card><CardContent className="flex items-start gap-3"><LockKeyhole className="mt-0.5 size-5 shrink-0 text-timer" /><div><h2 className="font-semibold">Owner access required</h2><p className="mt-1 text-sm text-muted">Only the TKDTech business owner can issue and email desktop licenses.</p></div></CardContent></Card>;
  if (loading) return <Loading label="Loading license delivery…" />;
  if (error) return <ErrorState error={error} retry={refresh} />;
  if (!data) return null;

  const submit = async (values: Values) => {
    setSubmitError('');
    setLastDelivery(null);
    try {
      const result = await post<DeliveryResult>('/api/v1/admin/license-deliveries', { ...values, deviceCode: values.deviceCode.toUpperCase() });
      setLastDelivery(result.delivery);
      if (result.delivery.status === 'SENT') {
        toast(result.duplicate ? 'License already sent' : 'License emailed', `${result.delivery.licenseId} · ${result.delivery.clientEmail}`);
        reset({ clubName: '', clientEmail: '', plan: values.plan, deviceCode: '', expires: values.expires, paymentConfirmed: false });
      } else if (result.delivery.status === 'FAILED') {
        setSubmitError('The previous delivery was not confirmed. Check the email configuration and submit a new approval.');
      }
      await refresh();
    } catch (reason) {
      setSubmitError((reason as Error).message);
      toast('License email not confirmed', (reason as Error).message, 'error');
      await refresh();
    }
  };

  return <div className="space-y-5">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div><p className="text-xs font-bold uppercase tracking-widest text-primary">Paid desktop operations</p><h2 className="mt-1 text-2xl font-bold">Approve & email a license</h2><p className="mt-1 text-sm text-muted">Confirm payment, sign for one computer, and send the attachment in one step.</p></div>
      <Button variant="secondary" onClick={() => void refresh()}><RefreshCw />Refresh history</Button>
    </div>

    {!data.configuration.configured && <div role="alert" className="flex items-start gap-3 rounded-xl border border-timer/25 bg-timer/5 p-4 text-sm text-[#e4e992]"><CircleAlert className="mt-0.5 size-5 shrink-0" /><div><p className="font-semibold">Server email delivery is not configured</p><p className="mt-1 text-xs leading-5">Add these server secrets before approving a license: <code>{data.configuration.missing.join(', ')}</code>. Nothing is sent while configuration is incomplete.</p></div></div>}

    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><MailCheck className="size-4 text-primary" />New paid license</CardTitle><Badge tone={data.configuration.configured ? 'green' : 'yellow'}>{data.configuration.configured ? 'READY' : 'SETUP REQUIRED'}</Badge></CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={handleSubmit(submit)} noValidate>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Client / club name" error={errors.clubName?.message}><Input autoComplete="organization" placeholder="Atlas Taekwondo" {...register('clubName')} /></Field>
              <Field label="Client email" error={errors.clientEmail?.message}><Input type="email" autoComplete="email" placeholder="coach@example.com" {...register('clientEmail')} /></Field>
            </div>
            <Field label="Installation code" hint="The client copies this from TKD Scoring → Activation. It is not a password." error={errors.deviceCode?.message}><Input spellCheck={false} autoComplete="off" className="numeric uppercase tracking-wider" placeholder="TKD-0000-1111-2222-3333-4444" {...register('deviceCode')} /></Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Subscription plan" error={errors.plan?.message}><Select {...register('plan')}>{plans.map((plan) => <option key={plan} value={plan}>{planLabel(plan)}</option>)}</Select></Field>
              <Field label="Paid until" hint="The license expires at the end of this UTC day." error={errors.expires?.message}><Input type="date" min={isoDay(new Date())} {...register('expires')} /></Field>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line/70 bg-black/20 p-4"><input type="checkbox" className="mt-1 size-4 accent-[#2068ff]" {...register('paymentConfirmed')} /><span><span className="block text-sm font-semibold">I confirm payment for this client, plan, computer and paid period.</span><span className="mt-1 block text-xs leading-5 text-muted">This approval creates a signed license. It does not charge a card or collect payment online.</span>{errors.paymentConfirmed && <span className="mt-2 block text-xs text-[#ff8390]">{errors.paymentConfirmed.message}</span>}</span></label>
            {submitError && <div role="alert" className="flex items-start gap-2 rounded-xl border border-red/30 bg-red/5 p-3 text-xs leading-5 text-[#ff9aa4]"><CircleAlert className="mt-0.5 size-4 shrink-0" /><span>{submitError}</span></div>}
            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting || !data.configuration.configured}>{isSubmitting ? 'Signing and sending…' : 'Approve & email license'}<Send /></Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-5">
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4 text-success" />Private server operation</CardTitle></CardHeader><CardContent><ol className="space-y-4">{[
          ['1', 'Verify the request', 'Match the installation code and paid period to the client before approving.'],
          ['2', 'Sign for one computer', 'The server verifies the new signed license before contacting the email service.'],
          ['3', 'Email the attachment', 'The client imports the .tkdlicense file in Activation. No license token is stored in this dashboard.'],
        ].map(([number, title, detail]) => <li key={number} className="flex gap-3"><span className="numeric flex size-7 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-[11px] font-bold text-primary">{number}</span><div><p className="text-xs font-semibold">{title}</p><p className="mt-1 text-[11px] leading-5 text-muted">{detail}</p></div></li>)}</ol><div className="mt-5 flex gap-2 border-t border-line/60 pt-4 text-[11px] leading-5 text-muted"><LockKeyhole className="mt-0.5 size-4 shrink-0 text-primary" /><span>The signing private key and Gmail app password remain server secrets and are never returned to this browser.</span></div></CardContent></Card>
        {lastDelivery?.status === 'SENT' && <Card aria-live="polite" className="border-success/25 bg-success/[.04]"><CardContent className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" /><div><p className="text-sm font-semibold text-success">Email accepted by the mail service</p><p className="numeric mt-2 text-xs font-bold">{lastDelivery.licenseId}</p><p className="mt-1 break-all text-xs text-muted">{lastDelivery.clientEmail}</p><p className="mt-2 text-[11px] leading-5 text-muted">Ask the client to check spam if it is not visible, then confirm Activation shows Active.</p></div></CardContent></Card>}
      </div>
    </div>

    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><CalendarDays className="size-4 text-primary" />Delivery history</CardTitle><Badge>{data.deliveries.length}</Badge></CardHeader>
      <CardContent className="space-y-3">{data.deliveries.length === 0 ? <div className="py-8 text-center"><KeyRound className="mx-auto size-7 text-muted" /><p className="mt-3 text-sm font-semibold">No licenses emailed from this server yet</p><p className="mt-1 text-xs text-muted">Approved deliveries will appear here with their license ID and status.</p></div> : data.deliveries.map((delivery) => <article key={delivery.id} className="rounded-xl border border-line/60 bg-black/15 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{delivery.clubName}</p><Badge tone={delivery.status === 'SENT' ? 'green' : delivery.status === 'FAILED' ? 'red' : 'yellow'}>{delivery.status}</Badge></div><p className="mt-1 break-all text-xs text-muted">{delivery.clientEmail} · {planLabel(delivery.plan)}</p></div><p className="numeric text-xs font-bold text-[#8baeff]">{delivery.licenseId}</p></div><div className="mt-3 grid gap-2 border-t border-line/50 pt-3 text-[11px] leading-5 text-muted md:grid-cols-2"><p>Device <code className="break-all text-white/70">{delivery.deviceCode}</code></p><p>Paid until <span className="text-white/70">{delivery.expiresAt.slice(0, 10)}</span></p></div>{delivery.deliveryError && <p className="mt-2 text-xs text-[#ff9aa4]">{delivery.deliveryError}</p>}</article>)}</CardContent>
    </Card>
  </div>;
}
