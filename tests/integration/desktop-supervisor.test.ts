import { afterEach, describe, expect, it } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const supervisorPath = path.resolve('desktop/supervisor.mjs');
const running = new Set<ChildProcess>();
const temporaryDirectories = new Set<string>();

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a test port.');
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function poll<T>(operation: () => Promise<T> | T, predicate: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let latest: T;
  while (Date.now() < deadline) {
    try {
      latest = await operation();
      if (predicate(latest)) return latest;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the desktop supervisor fixture.');
}

function exited(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => child.once('exit', (code) => resolve(code)));
}

function writeControl(filename: string, instanceId: string, pid: number): void {
  const temporary = `${filename}.test-tmp`;
  writeFileSync(temporary, JSON.stringify({ instanceId, pid, updatedAt: Date.now() }));
  renameSync(temporary, filename);
}

async function startFixture() {
  const appRoot = path.join(tmpdir(), `tkd-supervisor-test-${randomUUID()}`);
  temporaryDirectories.add(appRoot);
  const tsxCli = path.join(appRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const nextCli = path.join(appRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
  const expressEntry = path.join(appRoot, 'apps', 'local-server', 'src', 'index.ts');
  const expressImpl = path.join(appRoot, 'express-fixture.mjs');
  const marker = path.join(appRoot, 'events.log');
  mkdirSync(path.dirname(tsxCli), { recursive: true });
  mkdirSync(path.dirname(nextCli), { recursive: true });
  mkdirSync(path.dirname(expressEntry), { recursive: true });
  writeFileSync(expressEntry, '// The fixture tsx launcher loads express-fixture.mjs.\n');
  writeFileSync(tsxCli, `import { pathToFileURL } from 'node:url';\nawait import(pathToFileURL(process.env.FIXTURE_EXPRESS_IMPL).href);\n`);
  writeFileSync(expressImpl, `
    import { createServer } from 'node:http';
    import { appendFileSync } from 'node:fs';
    const marker=process.env.FIXTURE_MARKER;
    appendFileSync(marker,'express:start\\n');
    const server=createServer((request,response)=>{
      if(request.url==='/api/v1/health'){
        response.writeHead(200,{'content-type':'application/json'});
        response.end(JSON.stringify({data:{desktopInstance:process.env.TKD_DESKTOP_INSTANCE_ID}}));
        return;
      }
      response.writeHead(404);response.end();
    });
    server.listen(Number(process.env.PORT),'127.0.0.1');
    process.on('message',(message)=>{
      if(message?.type==='tkd-desktop-shutdown'){
        appendFileSync(marker,'express:clean\\n');
        server.closeAllConnections();server.close(()=>process.exit(0));
        setTimeout(()=>process.exit(1),1000).unref();
      }
    });
  `);
  writeFileSync(nextCli, `
    import { createServer } from 'node:http';
    import { appendFileSync } from 'node:fs';
    const marker=process.env.FIXTURE_MARKER;
    appendFileSync(marker,'next:start\\n');
    const server=createServer((_request,response)=>{response.writeHead(200);response.end('next fixture');});
    server.listen(Number(process.env.TKD_WEB_PORT),'127.0.0.1');
    function stop(){appendFileSync(marker,'next:clean\\n');server.closeAllConnections();server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),1000).unref();}
    process.on('SIGTERM',stop);process.on('SIGINT',stop);
  `);

  const instanceId = randomUUID();
  const port = await freePort();
  const webPort = await freePort();
  const controlFile = path.join(appRoot, 'control.json');
  const runtimeFile = path.join(appRoot, 'runtime.json');
  writeControl(controlFile, instanceId, process.pid);
  const heartbeat = setInterval(() => writeControl(controlFile, instanceId, process.pid), 250);
  const child = fork(supervisorPath, [], {
    execPath: process.execPath,
    env: {
      ...process.env,
      PORT: String(port),
      TKD_WEB_PORT: String(webPort),
      TKD_APP_ROOT: appRoot,
      TKD_DESKTOP_CONTROL_FILE: controlFile,
      TKD_DESKTOP_RUNTIME_FILE: runtimeFile,
      TKD_DESKTOP_INSTANCE_ID: instanceId,
      FIXTURE_EXPRESS_IMPL: expressImpl,
      FIXTURE_MARKER: marker,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  running.add(child);
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', () => {});
  child.once('exit', () => { clearInterval(heartbeat); running.delete(child); });
  const healthy = () => fetch(`http://127.0.0.1:${port}/api/v1/health`).then(async (response) => {
    const body = await response.json() as { data: { desktopInstance: string } };
    return response.ok && body.data.desktopInstance === instanceId;
  }).catch(() => false);
  await poll(healthy, Boolean);
  await poll(() => fetch(`http://127.0.0.1:${webPort}`).then((response) => response.ok).catch(() => false), Boolean);
  await poll(() => existsSync(runtimeFile), Boolean);
  return { child, appRoot, instanceId, port, webPort, controlFile, runtimeFile, marker, heartbeat };
}

afterEach(async () => {
  for (const child of running) {
    if (child.exitCode === null && child.connected) child.send({ type: 'tkd-desktop-shutdown' });
    await Promise.race([exited(child), new Promise((resolve) => setTimeout(resolve, 3_000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  running.clear();
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
  temporaryDirectories.clear();
});

describe('desktop process supervisor', () => {
  it('starts Express and Next.js and shuts both down cleanly through IPC', async () => {
    const fixture = await startFixture();
    const runtime = JSON.parse(readFileSync(fixture.runtimeFile, 'utf8')) as { expressPid: number; webPid: number; instanceId: string };
    expect(runtime.instanceId).toBe(fixture.instanceId);
    expect(runtime.expressPid).toBeGreaterThan(0);
    expect(runtime.webPid).toBeGreaterThan(0);
    const exit = exited(fixture.child);
    fixture.child.send({ type: 'tkd-desktop-shutdown' });
    expect(await exit).toBe(0);
    clearInterval(fixture.heartbeat);
    const events = readFileSync(fixture.marker, 'utf8');
    expect(events).toContain('express:start');
    expect(events).toContain('next:start');
    expect(events).toContain('express:clean');
    expect(events).toContain('next:clean');
    expect(existsSync(fixture.runtimeFile)).toBe(false);
    await expect(fetch(`http://127.0.0.1:${fixture.port}/api/v1/health`)).rejects.toThrow();
  }, 20_000);

  it('stops the complete runtime when the desktop launcher heartbeat is lost', async () => {
    const fixture = await startFixture();
    clearInterval(fixture.heartbeat);
    writeControl(fixture.controlFile, fixture.instanceId, 999_999);
    expect(await exited(fixture.child)).toBe(0);
    const events = readFileSync(fixture.marker, 'utf8');
    expect(events).toContain('express:clean');
    expect(events).toContain('next:clean');
    expect(existsSync(fixture.runtimeFile)).toBe(false);
  }, 20_000);

  it('stops the sibling service instead of leaving a partial scoring system running', async () => {
    const fixture = await startFixture();
    const runtime = JSON.parse(readFileSync(fixture.runtimeFile, 'utf8')) as { webPid: number };
    process.kill(runtime.webPid, 'SIGTERM');
    expect(await exited(fixture.child)).toBe(1);
    clearInterval(fixture.heartbeat);
    const events = readFileSync(fixture.marker, 'utf8');
    expect(events).toContain('next:clean');
    expect(events).toContain('express:clean');
    await expect(fetch(`http://127.0.0.1:${fixture.port}/api/v1/health`)).rejects.toThrow();
  }, 20_000);
});
