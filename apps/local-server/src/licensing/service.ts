import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
  evaluateDesktopLicense,
  installationCodeFor,
  installationCodeSchema,
  normalizeInstallationCode,
  planQuotaDefaults,
  TOURNAMENT_MONTHLY_CREATION_LIMIT,
  type DesktopLicensePayload,
  type LicenseEvaluationStatus,
  type LicenseVerificationKey,
  type PlanQuotaDefaults,
} from '../../../../packages/licensing/src/index';
import { productionLicenseKey } from '../../../../packages/licensing/src/key';
import type { SqliteDatabase } from '../persistence/database';
import { HttpError } from '../http';

export type DesktopLicenseState = 'NOT_REQUIRED' | 'UNLICENSED' | 'ACTIVE' | 'EXPIRED' | 'DEVICE_MISMATCH' | 'NOT_YET_VALID' | 'INVALID';
export type LicenseBinding = 'MACHINE_AND_INSTALLATION' | 'INSTALLATION_ONLY';

export interface DesktopLicenseStatus {
  required: boolean;
  status: DesktopLicenseState;
  installationCode: string;
  binding: LicenseBinding;
  canStartNewWork: boolean;
  canFinishActiveTournament: boolean;
  serverTime: string;
  message: string | null;
  license: {
    licenseId: string;
    clubName: string;
    plan: DesktopLicensePayload['plan'];
    issuedAt: string;
    expiresAt: string;
    daysRemaining: number;
  } | null;
  capabilities: DesktopPlanCapabilities;
  usage: DesktopLicenseUsage | null;
}

export interface DesktopLicenseUsage {
  matches: { limit: number | null; used: number; resetsAt: string };
  tournaments: { limit: number | null; used: number; usedThisMonth: number; monthlyLimit: number | null; nextReleaseAt: string | null };
}

export interface DesktopPlanCapabilities {
  registrations: boolean;
  draws: boolean;
  podium: boolean;
  reports: boolean;
  fullJudgingPanel: boolean;
}

export type DesktopPlanFeature = keyof Omit<DesktopPlanCapabilities, 'fullJudgingPanel'>;

const FULL_PLAN_CAPABILITIES: DesktopPlanCapabilities = { registrations: true, draws: true, podium: true, reports: true, fullJudgingPanel: true };
const TRAINING_PLAN_CAPABILITIES: DesktopPlanCapabilities = { registrations: false, draws: false, podium: false, reports: false, fullJudgingPanel: false };
const PLAN_FEATURE_LABELS: Record<DesktopPlanFeature, string> = {
  registrations: 'Club, category and athlete registrations',
  draws: 'Draw generation and publishing',
  podium: 'Podium and medal ceremonies',
  reports: 'PDF and CSV reports',
};

interface DesktopLicenseServiceOptions {
  required?: boolean;
  directory?: string;
  machineId?: string;
  binding?: LicenseBinding;
  now?: () => number;
  verificationKey?: LicenseVerificationKey;
}

interface InstallationRecord {
  version: 1;
  installationId: string;
  createdAt: string;
}

const installationSchema = z.object({
  version: z.literal(1),
  installationId: z.string().uuid(),
  createdAt: z.string().min(20).max(40),
}).strict();

function detectMachineIdentity(): { id: string; binding: LicenseBinding } {
  const configured = process.env.TKD_MACHINE_ID?.trim();
  if (configured) return { id: configured, binding: 'MACHINE_AND_INSTALLATION' };
  if (process.platform === 'win32') {
    try {
      const output = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], {
        encoding: 'utf8',
        timeout: 2_000,
        windowsHide: true,
      });
      const match = output.match(/MachineGuid\s+REG_SZ\s+([0-9a-f-]{36})/i);
      if (match?.[1]) return { id: `WINDOWS-MACHINE-GUID:${match[1].toUpperCase()}`, binding: 'MACHINE_AND_INSTALLATION' };
    } catch {
      // Some locked-down Windows environments deny registry access. The persistent
      // installation identity still prevents casually reusing only the license file.
    }
    return { id: 'WINDOWS-INSTALLATION-ONLY', binding: 'INSTALLATION_ONLY' };
  }
  return { id: `HOSTNAME:${hostname()}`, binding: 'MACHINE_AND_INSTALLATION' };
}

function atomicWrite(filename: string, contents: string): void {
  const temporary = `${filename}.${process.pid}.tmp`;
  writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, filename);
}

function publicState(status: LicenseEvaluationStatus): DesktopLicenseState {
  if (status === 'ACTIVE' || status === 'EXPIRED' || status === 'DEVICE_MISMATCH' || status === 'NOT_YET_VALID') return status;
  return 'INVALID';
}

// Offline clock-guard policy:
// - A rollback larger than LICENSE_CLOCK_ROLLBACK_TOLERANCE_MS blocks all licensed work
//   until the clock is restored (an expired license cannot be revived by moving the date back).
// - Small corrections (timezone fixes, NTP adjustments) stay within the tolerance.
// - The stored high-water mark only rises, and at most LICENSE_CLOCK_FORWARD_CAP_MS per
//   process, so a future-clock accident never poisons the guard beyond recovery.
// - Activating a fresh valid license resets the guard (support recovery path).
const LICENSE_CLOCK_ROLLBACK_TOLERANCE_MS = 72 * 3_600_000;
const LICENSE_CLOCK_FORWARD_CAP_MS = 72 * 3_600_000;
const LICENSE_CLOCK_WRITE_THRESHOLD_MS = 3_600_000;

export class DesktopLicenseService {
  private readonly required: boolean;
  private clockGuardCeiling?: number;
  private readonly directory: string;
  private readonly installationFile: string;
  private readonly licenseFile: string;
  private readonly now: () => number;
  private readonly verificationKey: LicenseVerificationKey;
  private readonly configuredMachineId?: string;
  private readonly configuredBinding?: LicenseBinding;
  private installationRecord?: InstallationRecord;
  private machineIdentity?: { id: string; binding: LicenseBinding };

  constructor(private readonly db: SqliteDatabase, options: DesktopLicenseServiceOptions = {}) {
    this.required = options.required ?? process.env.TKD_DESKTOP_LICENSE_REQUIRED === 'true';
    this.directory = options.directory ?? process.env.TKD_LICENSE_DIRECTORY ?? path.join(path.dirname(process.env.TKD_DATABASE_PATH ?? path.resolve('data/tkd-scoring.db')), 'license');
    this.installationFile = path.join(this.directory, 'installation.json');
    this.licenseFile = path.join(this.directory, 'desktop.tkdlicense');
    this.now = options.now ?? Date.now;
    this.verificationKey = options.verificationKey ?? productionLicenseKey;
    this.configuredMachineId = options.machineId;
    this.configuredBinding = options.binding;
  }

  private identity(): { installation: InstallationRecord; machine: { id: string; binding: LicenseBinding }; code: string } {
    if (!this.installationRecord) {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      if (existsSync(this.installationFile)) {
        this.installationRecord = installationSchema.parse(JSON.parse(readFileSync(this.installationFile, 'utf8'))) as InstallationRecord;
      } else {
        const installation: InstallationRecord = { version: 1, installationId: randomUUID(), createdAt: new Date(this.now()).toISOString() };
        atomicWrite(this.installationFile, JSON.stringify(installation, null, 2));
        this.installationRecord = installation;
      }
    }
    if (!this.machineIdentity) {
      this.machineIdentity = this.configuredMachineId
        ? { id: this.configuredMachineId, binding: this.configuredBinding ?? 'MACHINE_AND_INSTALLATION' }
        : detectMachineIdentity();
    }
    return {
      installation: this.installationRecord,
      machine: this.machineIdentity,
      code: installationCodeFor(this.installationRecord.installationId, this.machineIdentity.id),
    };
  }

  private statusMessage(status: DesktopLicenseState): string | null {
    switch (status) {
      case 'UNLICENSED': return 'Activate a paid desktop license before creating tournament work.';
      case 'EXPIRED': return 'The desktop license has expired. New work is blocked; an already in-progress tournament can be finished and all records remain readable and exportable.';
      case 'DEVICE_MISMATCH': return 'This license was issued for a different computer or installation. Request a device transfer.';
      case 'NOT_YET_VALID': return 'This license is not valid yet. Check the computer clock and the license start date.';
      case 'INVALID': return 'The installed license is invalid or damaged. Import the original file or request a replacement.';
      default: return null;
    }
  }

  private clockGuard(now: number): { blocked: boolean; message: string | null } {
    const row = this.db.prepare('SELECT last_seen_ms FROM license_clock_guard WHERE id=1').get() as { last_seen_ms: number } | undefined;
    const lastSeen = row?.last_seen_ms;
    if (lastSeen !== undefined && now < lastSeen - LICENSE_CLOCK_ROLLBACK_TOLERANCE_MS) {
      return {
        blocked: true,
        message: `The system clock was moved back (last recorded ${new Date(lastSeen).toISOString()}). Restore the correct date and time, then restart the application. If the date is already correct, contact support to re-activate the license.`,
      };
    }
    if (lastSeen === undefined || now > lastSeen) {
      if (this.clockGuardCeiling === undefined) this.clockGuardCeiling = (lastSeen ?? now) + LICENSE_CLOCK_FORWARD_CAP_MS;
      const target = Math.min(now, this.clockGuardCeiling);
      if (lastSeen === undefined || target - lastSeen >= LICENSE_CLOCK_WRITE_THRESHOLD_MS) {
        this.db.prepare('INSERT INTO license_clock_guard(id, last_seen_ms, updated_at) VALUES(1, ?, ?) ON CONFLICT(id) DO UPDATE SET last_seen_ms=excluded.last_seen_ms, updated_at=excluded.updated_at')
          .run(target, new Date(target).toISOString());
      }
    }
    return { blocked: false, message: null };
  }

  private resetClockGuard(now: number): void {
    this.db.prepare('INSERT INTO license_clock_guard(id, last_seen_ms, updated_at) VALUES(1, ?, ?) ON CONFLICT(id) DO UPDATE SET last_seen_ms=excluded.last_seen_ms, updated_at=excluded.updated_at')
      .run(now, new Date(now).toISOString());
    this.clockGuardCeiling = now + LICENSE_CLOCK_FORWARD_CAP_MS;
  }

  getStatus(): DesktopLicenseStatus {
    const serverTime = new Date(this.now()).toISOString();
    if (!this.required) {
      return {
        required: false,
        status: 'NOT_REQUIRED',
        installationCode: '',
        binding: 'MACHINE_AND_INSTALLATION',
        canStartNewWork: true,
        canFinishActiveTournament: false,
        serverTime,
        capabilities: FULL_PLAN_CAPABILITIES,
        usage: null,
        message: null,
        license: null,
      };
    }

    let identity: ReturnType<DesktopLicenseService['identity']>;
    try {
      identity = this.identity();
    } catch {
      return {
        required: true,
        status: 'INVALID',
        installationCode: '',
        binding: 'INSTALLATION_ONLY',
        canStartNewWork: false,
        canFinishActiveTournament: false,
        serverTime,
        message: 'The installation identity is damaged or unavailable. Preserve the license folder and contact support.',
        license: null,
        capabilities: FULL_PLAN_CAPABILITIES,
        usage: null,
      };
    }

    const base = {
      required: true,
      installationCode: identity.code,
      binding: identity.machine.binding,
      canStartNewWork: false,
      canFinishActiveTournament: false,
      serverTime,
      capabilities: FULL_PLAN_CAPABILITIES,
      usage: null,
    } as const;
    const guard = this.clockGuard(this.now());
    if (guard.blocked) {
      return { ...base, status: 'INVALID', message: guard.message, license: null };
    }
    if (!existsSync(this.licenseFile)) {
      return { ...base, status: 'UNLICENSED', message: this.statusMessage('UNLICENSED'), license: null };
    }

    let token: string;
    try {
      token = readFileSync(this.licenseFile, 'utf8');
    } catch {
      return { ...base, status: 'INVALID', message: this.statusMessage('INVALID'), license: null };
    }
    const evaluation = evaluateDesktopLicense(token, this.verificationKey, identity.code, this.now());
    const status = publicState(evaluation.status);
    const payload = evaluation.payload;
    const showLicense = payload && ['ACTIVE', 'EXPIRED', 'NOT_YET_VALID'].includes(status);
    return {
      ...base,
      status,
      canStartNewWork: status === 'ACTIVE',
      canFinishActiveTournament: status === 'EXPIRED',
      message: this.statusMessage(status),
      license: showLicense ? {
        licenseId: payload.licenseId,
        clubName: payload.clubName,
        plan: payload.plan,
        issuedAt: payload.issuedAt,
        expiresAt: payload.expiresAt,
        daysRemaining: Math.max(0, Math.ceil((Date.parse(payload.expiresAt) - this.now()) / 86_400_000)),
      } : null,
      capabilities: status === 'ACTIVE' && payload?.plan === 'SALLE' ? TRAINING_PLAN_CAPABILITIES : FULL_PLAN_CAPABILITIES,
      usage: status === 'ACTIVE' && payload ? this.usage(payload) : null,
    };
  }

  activate(token: string): DesktopLicenseStatus {
    if (!this.required) throw new HttpError(400, 'LICENSE_NOT_REQUIRED', 'Desktop license activation is not required in this deployment.');
    const identity = this.identity();
    const guard = this.clockGuard(this.now());
    if (guard.blocked) throw new HttpError(403, 'LICENSE_CLOCK_ROLLBACK', guard.message ?? 'The system clock was moved back. Restore the correct date and time before activating a license.');
    const evaluation = evaluateDesktopLicense(token, this.verificationKey, identity.code, this.now());
    if (evaluation.status !== 'ACTIVE') {
      const status = publicState(evaluation.status);
      const code = status === 'DEVICE_MISMATCH' ? 'LICENSE_DEVICE_MISMATCH' : status === 'EXPIRED' ? 'LICENSE_EXPIRED' : status === 'NOT_YET_VALID' ? 'LICENSE_NOT_YET_VALID' : 'LICENSE_INVALID';
      throw new HttpError(status === 'INVALID' ? 400 : 403, code, this.statusMessage(status) ?? 'The license could not be activated.');
    }
    atomicWrite(this.licenseFile, `${token.replace(/^\uFEFF/, '').trim()}\n`);
    this.resetClockGuard(this.now());
    return this.getStatus();
  }

  private denial(status: DesktopLicenseState): HttpError {
    const expired = status === 'EXPIRED';
    return new HttpError(403, expired ? 'LICENSE_EXPIRED' : 'LICENSE_REQUIRED', expired
      ? 'The desktop license has expired. Renew it for new work; existing records and an in-progress tournament remain available.'
      : 'A valid paid desktop license is required for this operation.');
  }

  assertNewWork(): void {
    const status = this.getStatus();
    if (!status.canStartNewWork) throw this.denial(status.status);
  }

  assertTournamentWork(tournamentId: string): void {
    const status = this.getStatus();
    if (!status.required || status.status === 'ACTIVE') return;
    if (status.status === 'EXPIRED') {
      const tournament = this.db.prepare('SELECT status FROM tournaments WHERE id=?').get(tournamentId) as { status: string } | undefined;
      if (tournament?.status === 'IN_PROGRESS') return;
    }
    throw this.denial(status.status);
  }

  /**
   * Salle training-plan gating: an active SALLE license keeps scoring, general matches,
   * the TV displays and single-judge (J1 + referee) control, while tournament production
   * (registrations, draws, podium, reports, corner judges) requires Salle+ or a club/tournament plan.
   */
  assertPlanFeature(feature: DesktopPlanFeature): void {
    if (!this.trainingOnly()) return;
    throw new HttpError(403, 'PLAN_UPGRADE_REQUIRED', `${PLAN_FEATURE_LABELS[feature]} are not part of the Salle training plan. Upgrade to Salle+ (tournaments included) to unlock them.`);
  }

  assertJudgePairing(role: string): void {
    if (!this.trainingOnly()) return;
    if (role === 'J2' || role === 'J3') {
      throw new HttpError(403, 'PLAN_UPGRADE_REQUIRED', 'Corner judges J2 and J3 are part of the full judging panel. The Salle training plan includes single-judge scoring (J1) and the referee controller.');
    }
  }

  private trainingOnly(): boolean {
    if (!this.required) return false;
    const status = this.getStatus();
    return status.status === 'ACTIVE' && status.license?.plan === 'SALLE';
  }

  // ---------------------------------------------------------------------------
  // Plan quotas (1.2.25): monthly match allowance and rolling-year tournament
  // creation allowance. Quotas live in the signed license (v2 tokens) or fall
  // back to plan defaults; usage is counted from the local database so the
  // allowance survives reinstalls of the app but not the club's own data.
  // ---------------------------------------------------------------------------

  private activePayload(): DesktopLicensePayload | null {
    if (!this.required) return null;
    let identity: ReturnType<DesktopLicenseService['identity']>;
    try {
      identity = this.identity();
    } catch {
      return null;
    }
    if (this.clockGuard(this.now()).blocked) return null;
    if (!existsSync(this.licenseFile)) return null;
    let token: string;
    try {
      token = readFileSync(this.licenseFile, 'utf8');
    } catch {
      return null;
    }
    const evaluation = evaluateDesktopLicense(token, this.verificationKey, identity.code, this.now());
    return evaluation.status === 'ACTIVE' ? evaluation.payload : null;
  }

  private resolveQuotas(payload: DesktopLicensePayload): PlanQuotaDefaults {
    if (payload.version === 2) return { matchQuota: payload.matchQuota, tournamentQuota: payload.tournamentQuota };
    return planQuotaDefaults[payload.plan];
  }

  private monthStartIso(now: number): string {
    const date = new Date(now);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
  }

  private nextMonthStartIso(now: number): string {
    const date = new Date(now);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString();
  }

  private countStartedMatches(monthStartIso: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM matches WHERE actual_start_at IS NOT NULL AND actual_start_at >= ?').get(monthStartIso) as { n: number };
    return row.n;
  }

  private countCreatedTournaments(sinceIso: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM tournaments WHERE created_at >= ?').get(sinceIso) as { n: number };
    return row.n;
  }

  private oldestCreatedTournamentAt(sinceIso: string): string | null {
    const row = this.db.prepare('SELECT MIN(created_at) AS oldest FROM tournaments WHERE created_at >= ?').get(sinceIso) as { oldest: string | null };
    return row.oldest;
  }

  private usage(payload: DesktopLicensePayload): DesktopLicenseUsage {
    const now = this.now();
    const monthStart = this.monthStartIso(now);
    const windowStart = new Date(now - 365 * 86_400_000).toISOString();
    const quotas = this.resolveQuotas(payload);
    const tournamentsLimited = quotas.tournamentQuota !== null;
    const oldest = tournamentsLimited ? this.oldestCreatedTournamentAt(windowStart) : null;
    return {
      matches: { limit: quotas.matchQuota, used: this.countStartedMatches(monthStart), resetsAt: this.nextMonthStartIso(now) },
      tournaments: {
        limit: quotas.tournamentQuota,
        used: tournamentsLimited ? this.countCreatedTournaments(windowStart) : 0,
        usedThisMonth: tournamentsLimited ? this.countCreatedTournaments(monthStart) : 0,
        monthlyLimit: quotas.tournamentQuota !== null && quotas.tournamentQuota > 0 ? TOURNAMENT_MONTHLY_CREATION_LIMIT : null,
        nextReleaseAt: oldest ? new Date(Date.parse(oldest) + 365 * 86_400_000).toISOString() : null,
      },
    };
  }

  /** Tournament creation gate: Salle cannot create tournaments at all; Salle+ is limited per rolling year and per calendar month. */
  assertTournamentCreation(): void {
    if (!this.required) return;
    const payload = this.activePayload();
    if (!payload) {
      this.assertNewWork();
      return;
    }
    if (payload.plan === 'SALLE') {
      throw new HttpError(403, 'PLAN_UPGRADE_REQUIRED', 'Tournament creation is not part of the Salle training plan (training & grades). Upgrade to Salle+ — 3 tournaments per year included — to create tournaments.');
    }
    const quotas = this.resolveQuotas(payload);
    if (quotas.tournamentQuota === null) return;
    const now = this.now();
    const monthStart = this.monthStartIso(now);
    const windowStart = new Date(now - 365 * 86_400_000).toISOString();
    if (quotas.tournamentQuota > 0 && this.countCreatedTournaments(monthStart) >= TOURNAMENT_MONTHLY_CREATION_LIMIT) {
      throw new HttpError(403, 'PLAN_TOURNAMENT_MONTHLY_LIMIT', `This plan allows at most ${TOURNAMENT_MONTHLY_CREATION_LIMIT} new tournaments per calendar month. The monthly counter resets on ${this.nextMonthStartIso(now).slice(0, 10)}.`);
    }
    if (this.countCreatedTournaments(windowStart) >= quotas.tournamentQuota) {
      const oldest = this.oldestCreatedTournamentAt(windowStart);
      const release = oldest ? new Date(Date.parse(oldest) + 365 * 86_400_000).toISOString().slice(0, 10) : null;
      throw new HttpError(403, 'PLAN_TOURNAMENT_QUOTA_EXCEEDED', `The plan's tournament allowance is used: ${quotas.tournamentQuota} tournament(s) per rolling 12 months.${release ? ` A slot frees on ${release}.` : ''} Already created tournaments stay fully usable. Upgrade to Salle Pro for unlimited tournaments.`);
    }
  }

  /** Match start gate: blocks the START of the next match once the monthly allowance is used. A running match is never interrupted. */
  assertMatchStart(): void {
    if (!this.required) return;
    const payload = this.activePayload();
    if (!payload) return;
    const quotas = this.resolveQuotas(payload);
    if (quotas.matchQuota === null) return;
    const now = this.now();
    if (this.countStartedMatches(this.monthStartIso(now)) >= quotas.matchQuota) {
      throw new HttpError(403, 'PLAN_MATCH_QUOTA_EXCEEDED', `The plan's match allowance is used: ${quotas.matchQuota} match(es) started this calendar month. A running match is never interrupted. The counter resets on ${this.nextMonthStartIso(now).slice(0, 10)} — or upgrade to Salle+ for unlimited matches.`);
    }
  }
}

export function normalizedLicenseDeviceCode(value: string): string {
  return installationCodeSchema.parse(normalizeInstallationCode(value));
}
