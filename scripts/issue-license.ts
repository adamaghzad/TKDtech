import { createPrivateKey, createPublicKey, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  desktopLicensePlans,
  evaluateDesktopLicense,
  installationCodeSchema,
  licensePayloadSchema,
  licensePayloadSchemaV2,
  normalizeInstallationCode,
  planQuotaDefaults,
  signDesktopLicense,
  type DesktopLicensePlan,
  type DesktopLicensePayload,
} from '../packages/licensing/src/index';
import { assertProductionPrivateKey, productionLicenseKey } from '../packages/licensing/src/key';

const usage = `Issue a device-bound TKD Scoring desktop license after confirming payment.

TKD_LICENSE_PRIVATE_KEY=/secure/ed25519-private.pem \\
  npm run license:issue -- \\
  --club "Example Taekwondo Club" \\
  --plan CLUB \\
  --device TKD-1234-5678-9ABC-DEF0-1234 \\
  --days 365 \\
  --output /secure/example-club.tkdlicense

Plans: ${desktopLicensePlans.join(', ')}
Use either --days N or --expires YYYY-MM-DD (end of that UTC day).
Optional allowances: --match-quota N|unlimited and --tournament-quota N|unlimited
(defaults: SALLE 200 matches / 0 tournament, SALLE+ unlimited / 3 tournaments).
The output is never overwritten unless --force is explicitly supplied.`;

function argumentsOf(argv: string[]): Map<string, string | boolean> {
  const result = new Map<string, string | boolean>();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]!;
    if (!name.startsWith('--')) throw new Error(`Unexpected argument: ${name}`);
    if (name === '--force' || name === '--help') {
      result.set(name, true);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}.`);
    result.set(name, value);
    index += 1;
  }
  return result;
}

function required(args: Map<string, string | boolean>, name: string): string {
  const value = args.get(name);
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.\n\n${usage}`);
  return value.trim();
}

function expiry(args: Map<string, string | boolean>, now: number): number {
  const days = args.get('--days');
  const expires = args.get('--expires');
  if ((days == null) === (expires == null)) throw new Error('Use exactly one of --days or --expires.');
  if (typeof days === 'string') {
    const count = Number(days);
    if (!Number.isInteger(count) || count < 1 || count > 3_650) throw new Error('--days must be an integer from 1 to 3650.');
    return now + count * 86_400_000;
  }
  const value = required(args, '--expires');
  const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T23:59:59.999Z`) : Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= now) throw new Error('--expires must be a valid future date.');
  return timestamp;
}

try {
  const args = argumentsOf(process.argv.slice(2));
  if (args.has('--help')) {
    console.log(usage);
    process.exit(0);
  }
  const supported = new Set(['--club', '--plan', '--device', '--days', '--expires', '--output', '--force', '--help', '--match-quota', '--tournament-quota']);
  for (const name of args.keys()) if (!supported.has(name)) throw new Error(`Unknown option ${name}.\n\n${usage}`);

  const now = Date.now();
  const clubName = required(args, '--club');
  const plan = required(args, '--plan').toUpperCase() as DesktopLicensePlan;
  if (!desktopLicensePlans.includes(plan)) throw new Error(`Unsupported plan ${plan}.`);
  const deviceCode = installationCodeSchema.parse(normalizeInstallationCode(required(args, '--device')));
  const output = path.resolve(required(args, '--output'));
  if (existsSync(output) && !args.has('--force')) throw new Error(`Refusing to overwrite ${output}. Choose another file or explicitly use --force.`);

  const privateKeyPath = process.env.TKD_LICENSE_PRIVATE_KEY || path.join(homedir(), '.config', 'tkd-scoring-licensing', 'ed25519-private.pem');
  const privateKeyPem = readFileSync(privateKeyPath, 'utf8');
  const privateKey = createPrivateKey({ key: privateKeyPem, format: 'pem', passphrase: process.env.TKD_LICENSE_PRIVATE_KEY_PASSPHRASE });
  const derivedPublicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  assertProductionPrivateKey(derivedPublicKey);

  const quotaOf = (name: '--match-quota' | '--tournament-quota'): number | null | undefined => {
    const value = args.get(name);
    if (value == null) return undefined;
    if (typeof value !== 'string') throw new Error(`${name} expects a number or "unlimited".`);
    if (value === 'unlimited') return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1_000_000) throw new Error(`${name} must be a whole number from 0 to 1000000, or "unlimited".`);
    return parsed;
  };
  const quotaDefaults = planQuotaDefaults[plan];
  const matchQuota = quotaOf('--match-quota') ?? quotaDefaults.matchQuota;
  const tournamentQuota = quotaOf('--tournament-quota') ?? quotaDefaults.tournamentQuota;
  const useV2 = plan === 'SALLE_PRO' || matchQuota !== quotaDefaults.matchQuota || tournamentQuota !== quotaDefaults.tournamentQuota;
  const licenseId = `LIC-${new Date(now).getUTCFullYear()}-${randomBytes(6).toString('hex').toUpperCase()}`;
  const expiresAt = new Date(expiry(args, now)).toISOString();
  const payload: DesktopLicensePayload = useV2
    ? licensePayloadSchemaV2.parse({
      version: 2 as const,
      keyId: productionLicenseKey.keyId,
      licenseId,
      clubName,
      plan,
      deviceCode,
      issuedAt: new Date(now).toISOString(),
      notBefore: new Date(now - 5 * 60_000).toISOString(),
      expiresAt,
      matchQuota,
      tournamentQuota,
    })
    : licensePayloadSchema.parse({
      version: 1 as const,
      keyId: productionLicenseKey.keyId,
      licenseId,
      clubName,
      plan,
      deviceCode,
      issuedAt: new Date(now).toISOString(),
      notBefore: new Date(now - 5 * 60_000).toISOString(),
      expiresAt,
    });
  const token = signDesktopLicense(payload, { keyId: productionLicenseKey.keyId, privateKeyPem });
  const verification = evaluateDesktopLicense(token, productionLicenseKey, deviceCode, now);
  if (verification.status !== 'ACTIVE') throw new Error(`Internal issuance verification failed: ${verification.status}. No license was written.`);

  mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  writeFileSync(output, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(`License issued: ${payload.licenseId}`);
  console.log(`Club: ${payload.clubName}`);
  console.log(`Plan: ${payload.plan}`);
  console.log(`Device: ${payload.deviceCode}`);
  console.log(`Expires: ${payload.expiresAt}`);
  console.log(`Match allowance: ${matchQuota === null ? 'unlimited' : `${matchQuota}/month`}`);
  console.log(`Tournament allowance: ${tournamentQuota === null ? 'unlimited' : `${tournamentQuota}/12 months`}`);
  console.log(`File: ${output}`);
  console.log('Send only this .tkdlicense file to the customer. Never send or commit the private key.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
