import { spawn, fork } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const appRoot = process.env.TKD_APP_ROOT;
const controlFile = process.env.TKD_DESKTOP_CONTROL_FILE;
const runtimeFile = process.env.TKD_DESKTOP_RUNTIME_FILE;
const instanceId = process.env.TKD_DESKTOP_INSTANCE_ID;
const port = Number(process.env.PORT || 3000);
const webPort = Number(process.env.TKD_WEB_PORT || 3001);

if (!appRoot || !controlFile || !runtimeFile || !instanceId) {
  console.error('[desktop-supervisor] Required desktop runtime paths or instance ID are missing.');
  process.exit(2);
}

const childOptions = {
  cwd: appRoot,
  env: { ...process.env, NODE_ENV: 'production', WEB_INTERNAL_URL: `http://127.0.0.1:${webPort}` },
  windowsHide: true,
};

let expressChild;
let webChild;
let expressExited = true;
let webExited = true;
let stopping = false;
let watchdog;
let runtimeWriter;
let unhealthyChecks = 0;

function writeJsonAtomic(filename, value) {
  const temporary = `${filename}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, filename);
}

function writeRuntime(state = 'RUNNING') {
  try {
    writeJsonAtomic(runtimeFile, {
      instanceId,
      state,
      supervisorPid: process.pid,
      expressPid: expressChild?.pid ?? null,
      webPid: webChild?.pid ?? null,
      port,
      webPort,
      updatedAt: Date.now(),
    });
  } catch (error) {
    console.error('[desktop-supervisor] Could not write runtime status:', error);
  }
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function parentIsHealthy() {
  try {
    const control = JSON.parse(readFileSync(controlFile, 'utf8'));
    return control.instanceId === instanceId
      && Date.now() - Number(control.updatedAt) < 12_000
      && processIsAlive(Number(control.pid));
  } catch {
    return false;
  }
}

function terminateTree(pid, force = false) {
  if (!Number.isInteger(pid) || pid <= 0 || !processIsAlive(pid)) return;
  if (process.platform === 'win32') {
    const args = ['/pid', String(pid), '/t'];
    if (force) args.push('/f');
    const result = spawn('taskkill', args, { windowsHide: true, stdio: 'ignore' });
    result.on('error', () => {});
    return;
  }
  try { process.kill(pid, force ? 'SIGKILL' : 'SIGTERM'); } catch {}
}

function removeOwnRuntimeFile() {
  try {
    const current = JSON.parse(readFileSync(runtimeFile, 'utf8'));
    if (current.instanceId === instanceId) rmSync(runtimeFile, { force: true });
  } catch {}
}

async function waitForChildren(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while ((!expressExited || !webExited) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function shutdown(exitCode = 0, reason = 'Desktop application closed') {
  if (stopping) return;
  stopping = true;
  clearInterval(watchdog);
  clearInterval(runtimeWriter);
  console.log(`[desktop-supervisor] ${reason}; stopping local services.`);
  writeRuntime('STOPPING');

  if (expressChild && !expressExited) {
    if (expressChild.connected) {
      try { expressChild.send({ type: 'tkd-desktop-shutdown' }); }
      catch { terminateTree(expressChild.pid); }
    } else terminateTree(expressChild.pid);
  }
  if (webChild && !webExited) terminateTree(webChild.pid);

  await waitForChildren(5_000);
  if (!expressExited) terminateTree(expressChild?.pid, true);
  if (!webExited) terminateTree(webChild?.pid, true);
  await waitForChildren(1_500);
  removeOwnRuntimeFile();
  process.exit(exitCode);
}

watchdog = setInterval(() => {
  if (parentIsHealthy()) {
    unhealthyChecks = 0;
    return;
  }
  unhealthyChecks += 1;
  if (unhealthyChecks >= 3) void shutdown(0, 'Desktop launcher is no longer active');
}, 2_000);
watchdog.unref();
runtimeWriter = setInterval(() => writeRuntime(stopping ? 'STOPPING' : 'RUNNING'), 2_000);
runtimeWriter.unref();

process.on('message', (message) => {
  if (message?.type === 'tkd-desktop-shutdown') void shutdown(0);
});
process.on('SIGTERM', () => { void shutdown(0, 'Termination requested'); });
process.on('SIGINT', () => { void shutdown(0, 'Interrupt requested'); });
process.on('uncaughtException', (error) => {
  console.error('[desktop-supervisor] Unexpected failure:', error);
  void shutdown(1, 'Supervisor failure');
});
process.on('unhandledRejection', (error) => {
  console.error('[desktop-supervisor] Unhandled rejection:', error);
  void shutdown(1, 'Supervisor failure');
});

try {
  const tsxCli = path.join(appRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const serverEntry = path.join(appRoot, 'apps', 'local-server', 'src', 'index.ts');
  const nextCli = path.join(appRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
  if (!existsSync(tsxCli) || !existsSync(serverEntry) || !existsSync(nextCli)) {
    throw new Error('The bundled application runtime is incomplete. Reinstall or re-extract the desktop package.');
  }

  expressExited = false;
  expressChild = fork(tsxCli, [serverEntry], {
    ...childOptions,
    execArgv: [],
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  expressChild.on('exit', (code, signal) => {
    expressExited = true;
    writeRuntime(stopping ? 'STOPPING' : 'FAILED');
    if (!stopping) void shutdown(code || 1, `Express stopped (${code ?? signal ?? 'unknown'})`);
  });
  expressChild.on('error', (error) => {
    console.error('[desktop-supervisor] Express process error:', error);
    if (!stopping) void shutdown(1, 'Express could not start');
  });

  webExited = false;
  webChild = spawn(process.execPath, [nextCli, 'start', 'apps/web', '-p', String(webPort), '-H', '127.0.0.1'], {
    ...childOptions,
    stdio: 'inherit',
  });
  webChild.on('exit', (code, signal) => {
    webExited = true;
    writeRuntime(stopping ? 'STOPPING' : 'FAILED');
    if (!stopping) void shutdown(code || 1, `Next.js stopped (${code ?? signal ?? 'unknown'})`);
  });
  webChild.on('error', (error) => {
    console.error('[desktop-supervisor] Next.js process error:', error);
    if (!stopping) void shutdown(1, 'Next.js could not start');
  });

  writeRuntime();
  console.log(`[desktop-supervisor] Started Express and Next.js for instance ${instanceId}.`);
} catch (error) {
  console.error('[desktop-supervisor] Startup failed:', error);
  await shutdown(1, 'Runtime startup failed');
}
