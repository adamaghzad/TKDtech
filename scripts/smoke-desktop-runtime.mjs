import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const supervisor = path.join(root, 'desktop', 'supervisor.mjs');
const temporary = path.join(tmpdir(), `tkd-desktop-runtime-smoke-${randomUUID()}`);
const databasePath = path.join(temporary, 'data', 'tkd-scoring.db');
const controlFile = path.join(temporary, 'control.json');
const runtimeFile = path.join(temporary, 'runtime.json');
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
  const port = await freePort();
  const webPort = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const first = await start(randomUUID(), port, webPort);
  const health = await (await fetch(`${base}/api/v1/health`)).json();
  assert.equal(health.data.mode, 'LOCAL');
  assert.equal(health.data.database, 'SQLite');
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
  const created = await fetch(`${base}/api/v1/tournaments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'Desktop Persistence Smoke', startDate: '2026-11-01', endDate: '2026-11-02', mode: 'LOCAL' }),
  });
  const createdBody = await created.text();
  assert.equal(created.status, 201, createdBody);
  const tournament = JSON.parse(createdBody).data;
  assert.ok(tournament.id);
  assert.ok(existsSync(databasePath), 'Desktop SQLite database was not created.');
  await stop(first);

  const second = await start(randomUUID(), port, webPort);
  const tournaments = await fetch(`${base}/api/v1/tournaments`, { headers: { cookie } });
  const tournamentsBody = await tournaments.text();
  assert.equal(tournaments.status, 200, tournamentsBody);
  const list = JSON.parse(tournamentsBody).data;
  assert.ok(list.some((item) => item.id === tournament.id && item.name === 'Desktop Persistence Smoke'), 'Tournament or authentication session did not survive restart.');
  const anonymous = await fetch(`${base}/api/v1/auth/me`);
  assert.equal(anonymous.status, 401);
  await stop(second);
  console.log('Desktop production-runtime smoke passed: Express + Next.js + SQLite, download page, authenticated writes, clean shutdown, restart persistence, and anonymous authorization.');
} finally {
  if (active) {
    clearInterval(active.heartbeat);
    if (active.child.exitCode === null && active.child.connected) active.child.send({ type: 'tkd-desktop-shutdown' });
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (active.child.exitCode === null) active.child.kill('SIGKILL');
  }
  rmSync(temporary, { recursive: true, force: true });
}
