import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Database,
  Download,
  ExternalLink,
  FolderArchive,
  HardDrive,
  Monitor,
  Network,
  Server,
  ShieldAlert,
  ShieldCheck,
  Wifi,
} from 'lucide-react';
import { Brand } from '@/components/brand';
import { desktopRelease } from '@/lib/desktop-release';

export const metadata: Metadata = {
  title: 'Download Desktop',
  description: 'Download the portable TKD Scoring Windows desktop app and automatically run the complete local scoring system.',
};

const included = [
  ['Operator application', 'The same tournament dashboard, control desk, scoreboards and reports.'],
  ['Complete local runtime', 'Express, Next.js and realtime WebSockets start together automatically.'],
  ['Persistent SQLite', 'Match events and tournament records stay on your computer and recover after restart.'],
  ['LAN judge access', 'Pair judge and referee browsers on the same venue network without internet.'],
] as const;

export default function DownloadDesktop() {
  return <main className="subtle-grid relative min-h-screen overflow-hidden bg-background">
    <div className="pointer-events-none absolute left-0 top-0 size-[520px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-primary/10 blur-[120px]"/>
    <div className="pointer-events-none absolute right-0 top-72 size-[420px] translate-x-1/3 rounded-full bg-red/5 blur-[120px]"/>
    <header className="relative mx-auto flex max-w-7xl items-center justify-between px-5 py-6 sm:px-8 lg:px-10">
      <Brand/>
      <Link href="/login" className="flex items-center gap-2 rounded-lg border border-line/70 bg-panel/70 px-3 py-2 text-xs font-semibold text-muted transition hover:border-primary/50 hover:text-white">
        <ArrowLeft className="size-4"/> Back to sign in
      </Link>
    </header>

    <section className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 pb-16 pt-10 sm:px-8 lg:grid-cols-[1.1fr_.9fr] lg:px-10 lg:pb-24 lg:pt-16">
      <div>
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[.14em] text-[#8fb3ff]">
          <Monitor className="size-4"/> Windows desktop · portable local mode
        </div>
        <h1 className="max-w-3xl text-balance text-4xl font-black leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
          The whole control desk.<br/><span className="text-[#6f9eff]">One download.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-7 text-muted sm:text-lg">
          Run the complete TKD Scoring system on your computer. No Node.js installation, no terminal commands, and no internet connection needed at the venue after download.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <a href={desktopRelease.downloadUrl} className="inline-flex min-h-12 items-center justify-center gap-3 rounded-xl bg-primary px-6 py-3 text-sm font-extrabold text-white shadow-[0_12px_36px_rgba(32,104,255,.28)] transition hover:bg-[#4f83ff] focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background">
            <Download className="size-5"/> Download for Windows x64 <ArrowRight className="size-4"/>
          </a>
          <a href={desktopRelease.releaseUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line bg-panel/80 px-5 py-3 text-sm font-semibold text-muted transition hover:border-primary/40 hover:text-white">
            Release notes <ExternalLink className="size-4"/>
          </a>
        </div>
        <p className="mt-4 text-xs leading-5 text-muted">
          Version {desktopRelease.version} · ZIP · Windows 10/11 64-bit · Extract and run <span className="font-semibold text-white">TKD Scoring.exe</span>
        </p>
        <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-xs text-muted">
          <span className="flex items-center gap-2"><Check className="size-4 text-success"/>No installation</span>
          <span className="flex items-center gap-2"><Check className="size-4 text-success"/>No commands</span>
          <span className="flex items-center gap-2"><Check className="size-4 text-success"/>Offline LAN ready</span>
        </div>
      </div>

      <div className="panel relative overflow-hidden p-6 sm:p-7">
        <div className="absolute right-0 top-0 h-1 w-full bg-gradient-to-r from-primary via-[#6f9eff] to-timer"/>
        <div className="mb-6 flex items-center justify-between">
          <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-primary">Everything included</p><h2 className="mt-1 text-xl font-bold">Starts as one system</h2></div>
          <div className="rounded-xl border border-primary/25 bg-primary/10 p-3"><Server className="size-6 text-[#79a4ff]"/></div>
        </div>
        <div className="space-y-5">
          {included.map(([title, description], index) => <div key={title} className="flex gap-3">
            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-line bg-sidebar text-[11px] font-black text-[#8fb3ff]">{index + 1}</div>
            <div><h3 className="text-sm font-bold">{title}</h3><p className="mt-1 text-xs leading-5 text-muted">{description}</p></div>
          </div>)}
        </div>
        <div className="mt-6 rounded-xl border border-line/70 bg-sidebar/70 p-4 text-xs leading-5 text-muted">
          <span className="font-bold text-white">One authoritative scoring engine.</span> The desktop package reuses the existing application; it is not a separate or simplified scoring implementation.
        </div>
      </div>
    </section>

    <section className="relative border-y border-line/60 bg-sidebar/45">
      <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8 lg:px-10">
        <div className="mb-9 max-w-2xl"><p className="text-xs font-bold uppercase tracking-[.16em] text-primary">From ZIP to scoring</p><h2 className="mt-2 text-3xl font-black tracking-tight">Three steps. Then it runs itself.</h2></div>
        <div className="grid gap-5 md:grid-cols-3">
          {[
            { icon: FolderArchive, step: '01', title: 'Extract the entire ZIP', text: 'Use “Extract All” in Windows. Do not run the EXE from inside the compressed ZIP, and keep the resources folder beside it.' },
            { icon: Monitor, step: '02', title: 'Run TKD Scoring.exe', text: 'The launcher starts the local database, API, web application and realtime services, then opens the operator automatically.' },
            { icon: Network, step: '03', title: 'Connect your venue devices', text: 'Allow private-network access if Windows Firewall asks. Judges and referees use the LAN addresses in the desktop status panel.' },
          ].map(({ icon: Icon, step, title, text }) => <article key={step} className="panel p-6">
            <div className="mb-5 flex items-center justify-between"><Icon className="size-6 text-[#79a4ff]"/><span className="numeric text-2xl text-[#42506a]">{step}</span></div>
            <h3 className="font-bold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted">{text}</p>
          </article>)}
        </div>
      </div>
    </section>

    <section className="relative mx-auto grid max-w-7xl gap-6 px-5 py-14 sm:px-8 lg:grid-cols-2 lg:px-10 lg:py-20">
      <article className="panel p-6 sm:p-7">
        <div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-success/10 p-3"><Database className="size-6 text-success"/></div><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-success">Your data stays yours</p><h2 className="text-xl font-bold">Persistent by default</h2></div></div>
        <p className="text-sm leading-6 text-muted">Tournaments, registrations, score events, corrections and audit records are stored in a per-user SQLite database. Closing and reopening the app recovers the same data. An unexpected restart pauses affected timers for operator confirmation.</p>
        <div className="mt-5 rounded-xl border border-line/70 bg-background/70 p-4">
          <div className="flex items-center gap-2 text-xs font-bold"><HardDrive className="size-4 text-[#8fb3ff]"/>Desktop data folder</div>
          <code className="mt-2 block break-all text-xs leading-5 text-[#c4d5f3]">%APPDATA%\TKD Scoring\data</code>
          <p className="mt-2 text-[11px] leading-5 text-muted">Close the app before backing up the whole folder. You can also open it from the desktop status panel.</p>
        </div>
      </article>

      <article className="panel p-6 sm:p-7">
        <div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-primary/10 p-3"><Wifi className="size-6 text-[#79a4ff]"/></div><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-primary">Offline at the venue</p><h2 className="text-xl font-bold">Local network, not a cloud shortcut</h2></div></div>
        <p className="text-sm leading-6 text-muted">The Windows PC hosts the real HTTP and WebSocket server. Judges, referees and read-only displays connect to that PC over the same local network. Internet is only needed to download the package or obtain future updates.</p>
        <ul className="mt-5 space-y-3 text-xs leading-5 text-muted">
          <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-success"/>Server-authoritative scoring, consensus, timers and audit trails remain enforced.</li>
          <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-success"/>The internal Next.js port is loopback-only; venue devices use the operator/API port.</li>
          <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-success"/>Closing the launcher supervises shutdown and preserves the database for the next run.</li>
        </ul>
      </article>
    </section>

    <section className="relative mx-auto max-w-7xl px-5 pb-16 sm:px-8 lg:px-10 lg:pb-24">
      <div className="rounded-2xl border border-[#8a6d19]/50 bg-[#2a220d]/45 p-6 sm:p-7">
        <div className="flex gap-4"><ShieldAlert className="mt-0.5 size-6 shrink-0 text-timer"/><div><h2 className="text-lg font-bold">Before the first Windows run</h2><p className="mt-2 max-w-4xl text-sm leading-6 text-[#d6cda8]">This portable release is <strong>not code-signed</strong>. Windows may show an unknown-publisher or SmartScreen warning. Download only from this page or the linked TKDtech GitHub Release, and verify the separate SHA-256 file below. Windows Firewall may also ask whether to allow local-network access; private-network permission is required for separate judge devices.</p></div></div>
        <div className="mt-5 rounded-xl border border-[#8a6d19]/40 bg-background/50 p-4"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#d6cda8]">SHA-256 · {desktopRelease.fileName}</p><a data-testid="desktop-checksum-link" href={desktopRelease.checksumUrl} className="mt-2 inline-flex items-center gap-2 text-xs font-bold text-timer hover:underline">Download the release SHA-256 file <ExternalLink className="size-3.5"/></a><p className="mt-3 text-[11px] leading-5 text-[#bfb58f]">After downloading both files, compare the published hash with <code>certutil -hashfile {desktopRelease.fileName} SHA256</code> in Windows.</p></div>
      </div>
    </section>

    <footer className="relative border-t border-line/60 bg-sidebar/40">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-7 text-xs text-muted sm:px-8 md:flex-row md:items-center md:justify-between lg:px-10">
        <p>Original TKD Scoring software by <span className="font-semibold text-white">ADAM AGHZAF</span> · TKDTech Sports Management</p>
        <p>Portable Windows x64 · v{desktopRelease.version} · <a href={desktopRelease.releaseUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">GitHub Release</a></p>
      </div>
    </footer>
  </main>;
}
