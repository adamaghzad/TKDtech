import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { fork, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { lanUrls, preferredLanUrl } from './network';

app.setName('TKD Scoring');

const PORT = 3000;
const WEB_PORT = 3001;
const operatorUrl = `http://127.0.0.1:${PORT}`;
const instanceId = randomUUID();
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.setAppUserModelId('com.tkdtech.scoring');
  const userData = app.getPath('userData');
  const dataDirectory = path.join(userData, 'data');
  const logsDirectory = path.join(userData, 'logs');
  const controlFile = path.join(userData, 'desktop-control.json');
  const runtimeFile = path.join(userData, 'desktop-runtime.json');
  const databasePath = path.join(dataDirectory, 'tkd-scoring.db');
  mkdirSync(dataDirectory, { recursive: true });
  mkdirSync(logsDirectory, { recursive: true });
  app.setPath('logs', logsDirectory);
  const logFile = path.join(logsDirectory, 'desktop.log');

  type DesktopState = 'STARTING' | 'RUNNING' | 'STOPPING' | 'STOPPED' | 'FAILED';
  interface DesktopStatus {
    state: DesktopState;
    message: string;
    operatorUrl: string;
    lanUrls: string[];
    dataDirectory: string;
    logsDirectory: string;
    version: string;
  }

  let status: DesktopStatus = {
    state: 'STARTING',
    message: 'Starting the complete local scoring system…',
    operatorUrl,
    lanUrls: lanUrls(PORT),
    dataDirectory,
    logsDirectory,
    version: app.getVersion(),
  };
  let runtimeChild: ChildProcess | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  let mainWindow: BrowserWindow | null = null;
  let controlWindow: BrowserWindow | null = null;
  let startPromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;
  let quitting = false;
  let shutdownComplete = false;
  let stopping = false;

  function log(message: string, error?: unknown): void {
    const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : error ? String(error) : '';
    const line = `[${new Date().toISOString()}] ${message}${detail ? ` ${detail}` : ''}\n`;
    try { appendFileSync(logFile, line, { mode: 0o600 }); } catch {}
    if (error) console.error(message, error);
    else console.log(message.trim());
  }

  function publishStatus(next: Partial<DesktopStatus>): void {
    status = { ...status, ...next, lanUrls: lanUrls(PORT) };
    for (const window of [controlWindow, mainWindow]) {
      if (window && !window.isDestroyed()) window.webContents.send('desktop:status', status);
    }
  }

  function resourcePaths(): { appRoot: string; supervisor: string; node: string; controlHtml: string; icon: string } {
    if (app.isPackaged) {
      return {
        appRoot: path.join(process.resourcesPath, 'app-root'),
        supervisor: path.join(process.resourcesPath, 'desktop', 'supervisor.mjs'),
        node: path.join(process.resourcesPath, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'),
        controlHtml: path.join(process.resourcesPath, 'desktop', 'control.html'),
        icon: path.join(process.resourcesPath, 'desktop', 'icon.png'),
      };
    }
    return {
      appRoot: path.resolve(app.getAppPath(), '..'),
      supervisor: path.join(app.getAppPath(), 'supervisor.mjs'),
      node: process.env.TKD_DESKTOP_NODE || (process.platform === 'win32' ? 'node.exe' : 'node'),
      controlHtml: path.join(app.getAppPath(), 'control.html'),
      icon: path.join(app.getAppPath(), 'assets', 'icon.png'),
    };
  }

  function writeJsonAtomic(filename: string, value: unknown): void {
    const temporary = `${filename}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, filename);
  }

  function writeControlFile(): void {
    writeJsonAtomic(controlFile, { instanceId, pid: process.pid, updatedAt: Date.now() });
  }

  function startHeartbeat(): void {
    writeControlFile();
    heartbeat = setInterval(() => {
      try { writeControlFile(); }
      catch (error) { log('Could not update the supervisor heartbeat.', error); }
    }, 2_000);
  }

  function stopHeartbeat(): void {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  }

  function readRuntime(): { instanceId?: string; supervisorPid?: number; expressPid?: number; webPid?: number } | null {
    try { return JSON.parse(readFileSync(runtimeFile, 'utf8')) as { instanceId?: string; supervisorPid?: number; expressPid?: number; webPid?: number }; }
    catch { return null; }
  }

  function processIsAlive(pid?: number): boolean {
    if (!Number.isInteger(pid) || !pid || pid <= 0) return false;
    try { process.kill(pid, 0); return true; }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  }

  async function terminateTree(pid?: number, force = true): Promise<void> {
    if (!processIsAlive(pid) || pid === process.pid) return;
    if (process.platform === 'win32') {
      const args = ['/pid', String(pid), '/t'];
      if (force) args.push('/f');
      await new Promise<void>((resolve) => {
        const task = spawn('taskkill', args, { windowsHide: true, stdio: 'ignore' });
        const timeout = setTimeout(() => { task.kill(); resolve(); }, 3_000);
        task.on('error', () => { clearTimeout(timeout); resolve(); });
        task.on('close', () => { clearTimeout(timeout); resolve(); });
      });
      return;
    }
    try { process.kill(pid!, force ? 'SIGKILL' : 'SIGTERM'); } catch {}
  }

  function request(url: string, timeoutMs = 1_500): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const request = http.get(url, { timeout: timeoutMs }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
      });
      request.on('timeout', () => request.destroy(new Error('Request timed out')));
      request.on('error', reject);
    });
  }

  async function healthInstance(): Promise<string | null> {
    try {
      const response = await request(`${operatorUrl}/api/v1/health`);
      if (response.status !== 200) return null;
      const payload = JSON.parse(response.body) as { data?: { desktopInstance?: string | null } };
      return payload.data?.desktopInstance ?? null;
    } catch { return null; }
  }

  async function webInstance(): Promise<string | null> {
    try {
      const response = await request(`http://127.0.0.1:${WEB_PORT}/api/desktop-runtime`);
      if (response.status !== 200) return null;
      const payload = JSON.parse(response.body) as { desktopInstance?: string | null };
      return payload.desktopInstance ?? null;
    } catch { return null; }
  }

  async function recoverOrphanedRuntime(): Promise<void> {
    const previous = readRuntime();
    if (!previous?.instanceId || previous.instanceId === instanceId) return;
    const [expressMatches, webMatches] = await Promise.all([
      healthInstance().then((value) => value === previous.instanceId),
      webInstance().then((value) => value === previous.instanceId),
    ]);
    if (!expressMatches && !webMatches) return;
    log(`Recovering orphaned local services from instance ${previous.instanceId}.`);
    await terminateTree(previous.supervisorPid);
    await Promise.all([terminateTree(previous.expressPid), terminateTree(previous.webPid)]);
    const deadline = Date.now() + 6_000;
    while (Date.now() < deadline) {
      const [express, web] = await Promise.all([healthInstance(), webInstance()]);
      if (express !== previous.instanceId && web !== previous.instanceId) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    rmSync(runtimeFile, { force: true });
    rmSync(controlFile, { force: true });
  }

  function removeOwnFiles(): void {
    try {
      const control = JSON.parse(readFileSync(controlFile, 'utf8')) as { instanceId?: string };
      if (control.instanceId === instanceId) rmSync(controlFile, { force: true });
    } catch {}
    const runtime = readRuntime();
    if (runtime?.instanceId === instanceId) rmSync(runtimeFile, { force: true });
  }

  function openControlWindow(): void {
    if (controlWindow && !controlWindow.isDestroyed()) {
      controlWindow.show();
      controlWindow.focus();
      controlWindow.webContents.send('desktop:status', status);
      return;
    }
    const paths = resourcePaths();
    controlWindow = new BrowserWindow({
      width: 660,
      height: 720,
      minWidth: 480,
      minHeight: 600,
      title: 'TKD Scoring · Local Desktop',
      icon: paths.icon,
      backgroundColor: '#080d18',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(app.getAppPath(), 'dist', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    controlWindow.setMenuBarVisibility(false);
    controlWindow.on('closed', () => { controlWindow = null; });
    controlWindow.webContents.on('did-finish-load', () => controlWindow?.webContents.send('desktop:status', status));
    void controlWindow.loadFile(paths.controlHtml);
  }

  function openOperatorWindow(): void {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      return;
    }
    const paths = resourcePaths();
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 960,
      minWidth: 1024,
      minHeight: 700,
      title: 'TKD Scoring',
      icon: paths.icon,
      backgroundColor: '#080d18',
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    mainWindow.setMenuBarVisibility(false);
    mainWindow.on('closed', () => {
      mainWindow = null;
      if (controlWindow && !controlWindow.isDestroyed() && !controlWindow.isVisible()) app.quit();
    });
    const isOperatorUrl = (value: string): boolean => {
      try { return new URL(value).origin === operatorUrl; }
      catch { return false; }
    };
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isOperatorUrl(url)) {
        void mainWindow?.loadURL(url);
      } else if (url.startsWith('https://')) {
        void shell.openExternal(url);
      }
      return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (!isOperatorUrl(url)) {
        event.preventDefault();
        if (url.startsWith('https://')) void shell.openExternal(url);
      }
    });
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.control && input.shift && input.key.toLowerCase() === 'l') {
        event.preventDefault();
        openControlWindow();
      }
    });
    void mainWindow.loadURL(operatorUrl);
    controlWindow?.hide();
  }

  function attachRuntimeOutput(child: ChildProcess): void {
    child.stdout?.on('data', (chunk: Buffer) => log(`[runtime] ${chunk.toString('utf8').trim()}`));
    child.stderr?.on('data', (chunk: Buffer) => log(`[runtime:error] ${chunk.toString('utf8').trim()}`));
  }

  async function waitUntilReady(child: ChildProcess): Promise<void> {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (quitting || stopping) throw new Error('Startup cancelled because the desktop application is closing.');
      if (runtimeChild !== child || child.exitCode !== null) throw new Error('The local service supervisor stopped during startup. Open the desktop log for details.');
      try {
        if (await healthInstance() === instanceId) {
          const page = await request(operatorUrl, 2_500);
          if (page.status === 200) return;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new Error('The local scoring system did not become ready within 90 seconds. Check that ports 3000 and 3001 are free and review the desktop log.');
  }

  async function performStart(): Promise<void> {
    publishStatus({ state: 'STARTING', message: 'Checking previous local services and preparing persistent storage…' });
    await recoverOrphanedRuntime();
    if (quitting) return;
    const paths = resourcePaths();
    for (const [label, filename] of [['Application', paths.appRoot], ['Supervisor', paths.supervisor], ['Node runtime', paths.node]] as const) {
      if (!existsSync(filename)) throw new Error(`${label} is missing at ${filename}. Re-extract the complete desktop ZIP.`);
    }

    const publicUrl = preferredLanUrl(PORT);
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_TKD_MODE: 'LOCAL',
      TKD_MODE: 'LOCAL',
      PORT: String(PORT),
      TKD_WEB_PORT: String(WEB_PORT),
      WEB_INTERNAL_URL: `http://127.0.0.1:${WEB_PORT}`,
      TKD_DATABASE_PATH: databasePath,
      TKD_APP_ROOT: paths.appRoot,
      TKD_DESKTOP_CONTROL_FILE: controlFile,
      TKD_DESKTOP_RUNTIME_FILE: runtimeFile,
      TKD_DESKTOP_INSTANCE_ID: instanceId,
      APP_PUBLIC_URL: publicUrl ?? '',
      SEED_DEVELOPMENT: 'false',
      ALLOW_DEMO_LOGIN: 'false',
      SUPABASE_SERVICE_ROLE_KEY: '',
      SUPABASE_URL: '',
      NEXT_PUBLIC_SUPABASE_URL: '',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
      NO_COLOR: '1',
    };
    delete environment.ELECTRON_RUN_AS_NODE;

    publishStatus({
      state: 'STARTING',
      message: publicUrl
        ? 'Starting Express, Next.js, SQLite, realtime scoring and LAN access…'
        : 'Starting local services. No private LAN address is currently available for judge devices.',
    });
    startHeartbeat();
    const child = fork(paths.supervisor, [], {
      execPath: paths.node,
      execArgv: [],
      cwd: paths.appRoot,
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    runtimeChild = child;
    attachRuntimeOutput(child);
    child.on('error', (error) => log('Desktop supervisor process error.', error));
    child.on('exit', (code, signal) => {
      if (runtimeChild === child) runtimeChild = null;
      stopHeartbeat();
      const previous = readRuntime();
      if (!stopping && !quitting) {
        log(`Local services stopped unexpectedly (${code ?? signal ?? 'unknown'}).`);
        publishStatus({
          state: 'FAILED',
          message: 'Local services stopped unexpectedly. Your saved database has not been deleted. Select Retry, or open the logs for troubleshooting.',
        });
        openControlWindow();
        mainWindow?.close();
        void Promise.all([terminateTree(previous?.expressPid), terminateTree(previous?.webPid)]);
      }
    });

    try {
      await waitUntilReady(child);
      if (quitting || stopping) return;
      publishStatus({
        state: 'RUNNING',
        message: publicUrl
          ? 'Local mode is ready. Judge and referee devices on the same network can use the LAN address below.'
          : 'Local mode is ready on this computer. Connect to a local network and restart to enable judge-device pairing.',
      });
      log(`TKD Scoring desktop is ready. Data: ${databasePath}; LAN: ${publicUrl ?? 'not available'}.`);
      openOperatorWindow();
    } catch (error) {
      await stopRuntime();
      if (!quitting) {
        log('Desktop startup failed.', error);
        publishStatus({
          state: 'FAILED',
          message: error instanceof Error ? error.message : 'The local application could not start.',
        });
        openControlWindow();
      }
    }
  }

  function startRuntime(): Promise<void> {
    if (runtimeChild || status.state === 'RUNNING') {
      openOperatorWindow();
      return Promise.resolve();
    }
    if (!startPromise) {
      startPromise = performStart().finally(() => { startPromise = null; });
    }
    return startPromise;
  }

  async function performStop(): Promise<void> {
    const child = runtimeChild;
    const runtime = readRuntime();
    stopping = true;
    stopHeartbeat();
    if (!child && !runtime) {
      removeOwnFiles();
      stopping = false;
      return;
    }
    publishStatus({ state: 'STOPPING', message: 'Saving match state and shutting down local services…' });
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      if (child.connected) {
        try { child.send({ type: 'tkd-desktop-shutdown' }); }
        catch { await terminateTree(child.pid ?? undefined); }
      } else await terminateTree(child.pid ?? undefined, false);
      await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 7_000))]);
      if (child.exitCode === null && runtimeChild === child) await terminateTree(child.pid ?? undefined);
    }
    if (runtime?.instanceId === instanceId) {
      await Promise.all([terminateTree(runtime.expressPid), terminateTree(runtime.webPid)]);
    }
    runtimeChild = null;
    removeOwnFiles();
    stopping = false;
    if (!quitting) publishStatus({ state: 'STOPPED', message: 'Local services are stopped. Your tournament database remains on this computer.' });
  }

  function stopRuntime(): Promise<void> {
    if (!stopPromise) stopPromise = performStop().finally(() => { stopPromise = null; });
    return stopPromise;
  }

  ipcMain.handle('desktop:get-status', () => status);
  ipcMain.handle('desktop:retry', async () => { await stopRuntime(); await startRuntime(); });
  ipcMain.handle('desktop:open-operator', () => { if (status.state === 'RUNNING') openOperatorWindow(); });
  ipcMain.handle('desktop:open-data', async () => { await shell.openPath(dataDirectory); });
  ipcMain.handle('desktop:open-logs', async () => { await shell.openPath(logsDirectory); });
  ipcMain.handle('desktop:open-external', async (_event, url: unknown) => {
    if (typeof url === 'string' && url.startsWith('https://')) await shell.openExternal(url);
  });

  app.on('second-instance', () => {
    if (status.state === 'RUNNING') openOperatorWindow();
    else openControlWindow();
  });
  app.on('activate', () => {
    if (status.state === 'RUNNING') openOperatorWindow();
    else openControlWindow();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    quitting = true;
    if (shutdownComplete) return;
    event.preventDefault();
    void stopRuntime().finally(() => {
      shutdownComplete = true;
      app.quit();
    });
  });

  process.on('uncaughtException', (error) => {
    log('Unexpected desktop launcher failure.', error);
    if (!quitting) {
      publishStatus({ state: 'FAILED', message: 'The desktop launcher encountered an error. Your database is preserved; local services will be stopped safely.' });
      void stopRuntime().finally(() => app.quit());
    }
  });
  process.on('unhandledRejection', (error) => log('Unhandled desktop launcher rejection.', error));

  void app.whenReady().then(async () => {
    app.setAboutPanelOptions({ applicationName: 'TKD Scoring', applicationVersion: app.getVersion(), authors: ['ADAM AGHZAF · TKDTech Sports Management'] });
    openControlWindow();
    await startRuntime();
  }).catch((error) => {
    log('Desktop initialization failed.', error);
    void dialog.showMessageBox({
      type: 'error',
      title: 'TKD Scoring could not start',
      message: 'TKD Scoring could not initialize.',
      detail: `${error instanceof Error ? error.message : String(error)}\n\nYour database is stored separately and has not been deleted.`,
    }).finally(() => app.quit());
  });
}
