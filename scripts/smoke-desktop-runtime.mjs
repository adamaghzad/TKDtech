import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const supervisor = path.join(root, 'desktop', 'supervisor.mjs');
const temporary = path.join(tmpdir(), `tkd-desktop-runtime-smoke-${randomUUID()}`);
const databasePath = path.join(temporary, 'data', 'tkd-scoring.db');
const controlFile = path.join(temporary, 'control.json');
const runtimeFile = path.join(temporary, 'runtime.json');
const licenseDirectory = path.join(temporary, 'license');
mkdirSync(path.dirname(databasePath), { recursive: true });
let active = null;

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function writeControl(instanceId) {
  const temp = `${controlFile}.tmp`;
  writeFileSync(temp, JSON.stringify({ instanceId, pid: process.pid, updatedAt: Date.now() }));
  renameSync(temp, controlFile);
}

async function issueLicense(deviceCode, output) {
  const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const issuer = path.join(root, 'scripts', 'issue-license.ts');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, issuer, '--club', 'Desktop Runtime Smoke Club', '--plan', 'CLUB', '--device', deviceCode, '--days', '30', '--output', output], {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let outputText = '';
    child.stdout.on('data', (chunk) => { outputText += chunk; });
    child.stderr.on('data', (chunk) => { outputText += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`License issuer exited with ${code}.\n${outputText}`)));
  });
  return readFileSync(output, 'utf8');
}

async function start(instanceId, port, webPort) {
  writeControl(instanceId);
  const heartbeat = setInterval(() => writeControl(instanceId), 250);
  let output = '';
  const child = fork(supervisor, [], {
    execPath: process.execPath,
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_TKD_MODE: 'LOCAL',
      TKD_MODE: 'LOCAL',
      PORT: String(port),
      TKD_WEB_PORT: String(webPort),
      TKD_APP_ROOT: root,
      TKD_DATABASE_PATH: databasePath,
      TKD_DESKTOP_LICENSE_REQUIRED: 'true',
      TKD_LICENSE_DIRECTORY: licenseDirectory,
      TKD_DESKTOP_CONTROL_FILE: controlFile,
      TKD_DESKTOP_RUNTIME_FILE: runtimeFile,
      TKD_DESKTOP_INSTANCE_ID: instanceId,
      SEED_DEVELOPMENT: 'false',
      ALLOW_DEMO_LOGIN: 'false',
      APP_PUBLIC_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      SUPABASE_URL: '',
      NEXT_PUBLIC_SUPABASE_URL: '',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  active = { child, heartbeat };
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Desktop runtime exited during startup.\n${output}`);
    try {
      const health = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
      const body = await health.json();
      if (health.ok && body.data.desktopInstance === instanceId) {
        const page = await fetch(`http://127.0.0.1:${port}/login`);
        if (page.ok) return { child, heartbeat, instanceId, output: () => output };
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Desktop runtime did not become ready.\n${output}`);
}

async function stop(runtime) {
  if (!runtime || runtime.child.exitCode !== null) {
    clearInterval(runtime?.heartbeat);
    if (active?.child === runtime?.child) active = null;
    return;
  }
  const exit = new Promise((resolve) => runtime.child.once('exit', resolve));
  runtime.child.send({ type: 'tkd-desktop-shutdown' });
  const code = await Promise.race([exit, new Promise((_, reject) => setTimeout(() => reject(new Error('Desktop runtime shutdown timed out.')), 12_000))]);
  clearInterval(runtime.heartbeat);
  assert.equal(code, 0, `Supervisor shutdown failed.\n${runtime.output()}`);
  assert.equal(existsSync(runtimeFile), false, 'Runtime status file should be removed after clean shutdown.');
  if (active?.child === runtime.child) active = null;
}

try {
  const privateKeyPath = process.env.TKD_LICENSE_PRIVATE_KEY || path.join(homedir(), '.config', 'tkd-scoring-licensing', 'ed25519-private.pem');
  if (!existsSync(privateKeyPath)) throw new Error('The licensed desktop runtime smoke requires the owner-only TKD_LICENSE_PRIVATE_KEY file; it is never bundled or committed.');
  const port = await freePort();
  const webPort = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const first = await start(randomUUID(), port, webPort);
  const health = await (await fetch(`${base}/api/v1/health`)).json();
  assert.equal(health.data.mode, 'LOCAL');
  assert.equal(health.data.database, 'SQLite');
  const initialLicenseResponse = await fetch(`${base}/api/v1/licensing/status`);
  const initialLicense = (await initialLicenseResponse.json()).data;
  assert.equal(initialLicenseResponse.status, 200);
  assert.equal(initialLicense.required, true);
  assert.equal(initialLicense.status, 'UNLICENSED');
  assert.match(initialLicense.installationCode, /^TKD(?:-[0-9A-F]{4}){5}$/);
  assert.equal((await fetch(`${base}/activation`)).status, 200);
  const internalRuntime = await fetch(`http://127.0.0.1:${webPort}/api/desktop-runtime`);
  assert.equal(internalRuntime.status, 200);
  assert.equal((await internalRuntime.json()).desktopInstance, first.instanceId);
  assert.equal((await fetch(`${base}/api/desktop-runtime`)).status, 404, 'The internal runtime identifier must not bypass the Express API boundary.');
  const download = await fetch(`${base}/download`);
  assert.equal(download.status, 200);
  const html = await download.text();
  assert.match(html, /Download for Windows x64/);
  assert.match(html, /TKD-Scoring-Windows-x64\.zip/);
  const registration = await fetch(`${base}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Desktop Smoke Organization', fullName: 'Desktop Smoke Administrator', email: 'desktop-smoke@example.test', password: 'DesktopSmoke2026!' }),
  });
  assert.equal(registration.status, 201, await registration.text());
  const cookie = registration.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie?.startsWith('tkd_session='));
  const blockedCreation = await fetch(`${base}/api/v1/tournaments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'Unlicensed Creation Attempt', startDate: '2026-11-01', endDate: '2026-11-02', mode: 'LOCAL' }),
  });
  const blockedCreationBody = await blockedCreation.text();
  assert.equal(blockedCreation.status, 403, blockedCreationBody);
  assert.equal(JSON.parse(blockedCreationBody).error.code, 'LICENSE_REQUIRED');
  const invalidActivation = await fetch(`${base}/api/v1/licensing/activate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'not-a-license' }),
  });
  assert.equal(invalidActivation.status, 400);
  const wrongDeviceToken = await issueLicense('TKD-0000-1111-2222-3333-4444', path.join(temporary, 'wrong-device.tkdlicense'));
  const wrongDeviceActivation = await fetch(`${base}/api/v1/licensing/activate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: wrongDeviceToken }),
  });
  assert.equal(wrongDeviceActivation.status, 403);
  assert.equal((await wrongDeviceActivation.json()).error.code, 'LICENSE_DEVICE_MISMATCH');
  const licenseToken = await issueLicense(initialLicense.installationCode, path.join(temporary, 'valid.tkdlicense'));
  const activation = await fetch(`${base}/api/v1/licensing/activate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: licenseToken }),
  });
  const activationBody = await activation.text();
  assert.equal(activation.status, 200, activationBody);
  assert.equal(JSON.parse(activationBody).data.status, 'ACTIVE');
  const created = await fetch(`${base}/api/v1/tournaments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'Desktop Persistence Smoke', startDate: '2026-11-01', endDate: '2026-11-02', mode: 'LOCAL' }),
  });
  const createdBody = await created.text();
  assert.equal(created.status, 201, createdBody);
  const tournament = JSON.parse(createdBody).data;
  assert.ok(tournament.id);
  const exported = await fetch(`${base}/api/v1/reports/results.csv?tournamentId=${tournament.id}`, { headers: { cookie } });
  assert.equal(exported.status, 200, await exported.text());
  assert.ok(existsSync(databasePath), 'Desktop SQLite database was not created.');
  await stop(first);

  const second = await start(randomUUID(), port, webPort);
  const restartedLicense = (await (await fetch(`${base}/api/v1/licensing/status`)).json()).data;
  assert.equal(restartedLicense.status, 'ACTIVE');
  assert.equal(restartedLicense.installationCode, initialLicense.installationCode);
  const tournaments = await fetch(`${base}/api/v1/tournaments`, { headers: { cookie } });
  const tournamentsBody = await tournaments.text();
  assert.equal(tournaments.status, 200, tournamentsBody);
  const list = JSON.parse(tournamentsBody).data;
  assert.ok(list.some((item) => item.id === tournament.id && item.name === 'Desktop Persistence Smoke'), 'Tournament or authentication session did not survive restart.');
  const anonymous = await fetch(`${base}/api/v1/auth/me`);
  assert.equal(anonymous.status, 401);
  await stop(second);
  console.log('Licensed desktop production-runtime smoke passed: activation boundary, wrong-device/invalid rejection, signed activation, Express + Next.js + SQLite, exports, authenticated writes, clean shutdown, restart license/data persistence, and anonymous authorization.');
} finally {
  if (active) {
    clearInterval(active.heartbeat);
    if (active.child.exitCode === null && active.child.connected) active.child.send({ type: 'tkd-desktop-shutdown' });
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (active.child.exitCode === null) active.child.kill('SIGKILL');
  }
  rmSync(temporary, { recursive: true, force: true });
}
