import { packager } from '@electron/packager';
import { ZipArchive } from 'archiver';
import extractZip from 'extract-zip';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = path.resolve(desktopDir, '..');
const desktopPackage = JSON.parse(readFileSync(path.join(desktopDir, 'package.json'), 'utf8'));
const rootLock = JSON.parse(readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8'));
const version = desktopPackage.version;
const nodeVersion = '22.16.0';
const sqliteVersion = rootLock.packages['node_modules/better-sqlite3'].version;
const sqliteAbi = '127';
const sqliteArchiveSha256 = '94bdd2d44203759a4e1b76f4f7e91750cfeca4190e9fe356b05c1f73599124e9';
const sqliteBinarySha256 = 'c6770a96c516d2b3e78308ecfcc146c38c0eb0875e180c8028d77f1e93914c6d';
const artifactDir = path.resolve(process.env.DESKTOP_ARTIFACT_DIR || path.join(desktopDir, 'artifacts'));
const workDir = path.join(artifactDir, 'work');
const cacheDir = process.env.DESKTOP_DOWNLOAD_CACHE || path.join(os.tmpdir(), 'tkd-scoring-desktop-cache');
const artifactName = 'TKD-Scoring-Windows-x64.zip';
const artifactPath = path.join(artifactDir, artifactName);
const skipAppBuild = process.argv.includes('--skip-app-build');
const skipLauncherBuild = process.argv.includes('--skip-launcher-build');

if (Number(process.versions.node.split('.')[0]) !== 22) {
  throw new Error(`Build with Node 22; the current build process uses ${process.versions.node}.`);
}
if (sqliteVersion !== '11.10.0') {
  throw new Error(`The pinned Windows better-sqlite3 prebuild is for 11.10.0, but the lockfile resolves ${sqliteVersion}. Update and revalidate the prebuild before packaging.`);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

async function sha256(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

async function download(url, destination, expectedSha256) {
  mkdirSync(path.dirname(destination), { recursive: true });
  if (existsSync(destination) && (!expectedSha256 || await sha256(destination) === expectedSha256)) {
    console.log(`[download] Using verified cache: ${path.basename(destination)}`);
    return;
  }
  console.log(`[download] ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
  const temporary = `${destination}.partial`;
  rmSync(temporary, { force: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { mode: 0o600 }));
  if (expectedSha256 && await sha256(temporary) !== expectedSha256) {
    rmSync(temporary, { force: true });
    throw new Error(`SHA-256 mismatch for ${url}`);
  }
  renameSync(temporary, destination);
}

function copy(source, destination, options = {}) {
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true, force: true, ...options });
}

function assertPe64(filename) {
  const data = readFileSync(filename);
  if (data.length < 64 || data.toString('ascii', 0, 2) !== 'MZ') throw new Error(`Not a Windows PE binary: ${filename}`);
  const offset = data.readUInt32LE(0x3c);
  if (data.toString('ascii', offset, offset + 4) !== 'PE\0\0') throw new Error(`Invalid PE header: ${filename}`);
  const machine = data.readUInt16LE(offset + 4);
  if (machine !== 0x8664) throw new Error(`Not a Windows x64 binary (machine 0x${machine.toString(16)}): ${filename}`);
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(filename) : [filename];
  });
}

function assertNoSecrets(directory) {
  const forbidden = walk(directory).filter((filename) => {
    const name = path.basename(filename).toLowerCase();
    return name === '.env' || name.startsWith('.env.') || name.endsWith('.tkdlicense') || (name.endsWith('.pem') && name.includes('private')) || name === 'tkd-scoring.db' || name.endsWith('.sqlite') || name.endsWith('.db-wal') || name.endsWith('.db-shm');
  });
  if (forbidden.length) throw new Error(`Refusing to package environment files, private keys, customer licenses, or local databases:\n${forbidden.join('\n')}`);
}

async function stageApplication(appRoot) {
  mkdirSync(appRoot, { recursive: true });
  for (const file of ['package.json', 'package-lock.json', 'tsconfig.json']) {
    copyFileSync(path.join(rootDir, file), path.join(appRoot, file));
  }
  copy(path.join(rootDir, 'apps', 'local-server', 'src'), path.join(appRoot, 'apps', 'local-server', 'src'));
  copy(path.join(rootDir, 'packages', 'contracts', 'src'), path.join(appRoot, 'packages', 'contracts', 'src'));
  copy(path.join(rootDir, 'packages', 'domain', 'src'), path.join(appRoot, 'packages', 'domain', 'src'));
  copy(path.join(rootDir, 'packages', 'licensing', 'src'), path.join(appRoot, 'packages', 'licensing', 'src'));
  copy(path.join(rootDir, 'apps', 'web', '.next'), path.join(appRoot, 'apps', 'web', '.next'), {
    filter: (source) => !source.includes(`${path.sep}.next${path.sep}cache`) && !source.includes(`${path.sep}.next${path.sep}dev`),
  });
  copy(path.join(rootDir, 'apps', 'web', 'public'), path.join(appRoot, 'apps', 'web', 'public'));
  copyFileSync(path.join(rootDir, 'apps', 'web', 'next.config.mjs'), path.join(appRoot, 'apps', 'web', 'next.config.mjs'));
  if (!existsSync(path.join(appRoot, 'apps', 'web', '.next', 'BUILD_ID'))) throw new Error('Optimized Next.js BUILD_ID is missing. Run the production build first.');

  console.log('[stage] Installing production dependencies for win32/x64 without running install scripts…');
  await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
    'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--os=win32', '--cpu=x64',
  ], { cwd: appRoot });

  const sqliteArchive = path.join(cacheDir, `better-sqlite3-v${sqliteVersion}-node-v${sqliteAbi}-win32-x64.tar.gz`);
  await download(`https://github.com/WiseLibs/better-sqlite3/releases/download/v${sqliteVersion}/better-sqlite3-v${sqliteVersion}-node-v${sqliteAbi}-win32-x64.tar.gz`, sqliteArchive, sqliteArchiveSha256);
  const sqliteExtract = path.join(workDir, 'sqlite-prebuild');
  rmSync(sqliteExtract, { recursive: true, force: true });
  mkdirSync(sqliteExtract, { recursive: true });
  await run('tar', ['-xzf', sqliteArchive, '-C', sqliteExtract]);
  const sqliteBinarySource = path.join(sqliteExtract, 'build', 'Release', 'better_sqlite3.node');
  if (await sha256(sqliteBinarySource) !== sqliteBinarySha256) throw new Error('The Windows SQLite binary hash does not match the reviewed prebuild.');
  const sqliteBinaryTarget = path.join(appRoot, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  mkdirSync(path.dirname(sqliteBinaryTarget), { recursive: true });
  copyFileSync(sqliteBinarySource, sqliteBinaryTarget);
  assertPe64(sqliteBinaryTarget);

  const esbuild = path.join(appRoot, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe');
  if (!existsSync(esbuild)) throw new Error('The Windows esbuild runtime required by tsx was not installed. Check npm --os/--cpu handling.');
  assertPe64(esbuild);
  for (const nativeBinary of walk(path.join(appRoot, 'node_modules')).filter((filename) => filename.endsWith('.node'))) assertPe64(nativeBinary);
  assertNoSecrets(appRoot);
}

async function stageNodeRuntime(runtimeDir) {
  const base = `node-v${nodeVersion}-win-x64`;
  const archive = path.join(cacheDir, `${base}.zip`);
  const checksums = path.join(cacheDir, `node-v${nodeVersion}-SHASUMS256.txt`);
  await download(`https://nodejs.org/dist/v${nodeVersion}/${base}.zip`, archive);
  await download(`https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`, checksums);
  const expected = readFileSync(checksums, 'utf8').split(/\r?\n/).find((line) => line.trim().endsWith(`  ${base}.zip`))?.split(/\s+/)[0];
  if (!expected || await sha256(archive) !== expected) throw new Error('Official Node.js runtime checksum validation failed.');
  const extracted = path.join(workDir, 'node-runtime');
  rmSync(extracted, { recursive: true, force: true });
  await extractZip(archive, { dir: extracted });
  mkdirSync(runtimeDir, { recursive: true });
  copyFileSync(path.join(extracted, base, 'node.exe'), path.join(runtimeDir, 'node.exe'));
  copyFileSync(path.join(extracted, base, 'LICENSE'), path.join(runtimeDir, 'NODE-LICENSE.txt'));
  assertPe64(path.join(runtimeDir, 'node.exe'));
}

function git(args) {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd: rootDir, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('error', () => resolve(''));
    child.on('close', (code) => resolve(code === 0 ? output.trim() : ''));
  });
}

async function createZip(sourceDirectory) {
  rmSync(artifactPath, { force: true });
  const output = createWriteStream(artifactPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const completed = new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(output);
  archive.directory(sourceDirectory, 'TKD-Scoring');
  await archive.finalize();
  await completed;
}

async function validatePortableDirectory(directory) {
  const resources = path.join(directory, 'resources');
  const required = [
    path.join(directory, 'TKD Scoring.exe'),
    path.join(resources, 'runtime', 'node.exe'),
    path.join(resources, 'desktop', 'supervisor.mjs'),
    path.join(resources, 'desktop', 'control.html'),
    path.join(resources, 'app-root', 'apps', 'web', '.next', 'BUILD_ID'),
    path.join(resources, 'app-root', 'apps', 'local-server', 'src', 'persistence', 'migrations', '001_initial.sql'),
    path.join(resources, 'app-root', 'apps', 'local-server', 'src', 'persistence', 'migrations', '002_license_deliveries.sql'),
    path.join(resources, 'app-root', 'apps', 'local-server', 'src', 'persistence', 'migrations', '003_video_review.sql'),
    path.join(resources, 'app-root', 'apps', 'local-server', 'src', 'licensing', 'service.ts'),
    path.join(resources, 'app-root', 'apps', 'local-server', 'src', 'licensing', 'delivery.ts'),
    path.join(resources, 'app-root', 'packages', 'licensing', 'src', 'key.ts'),
    path.join(resources, 'app-root', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.join(resources, 'app-root', 'node_modules', 'next', 'dist', 'bin', 'next'),
    path.join(resources, 'app-root', 'node_modules', 'nodemailer', 'dist', 'cjs', 'nodemailer.js'),
    path.join(resources, 'app-root', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
  ];
  for (const filename of required) if (!existsSync(filename)) throw new Error(`Portable package is missing ${filename}`);
  const nextOutput = path.join(resources, 'app-root', 'apps', 'web', '.next');
  for (const transient of ['cache', 'dev']) {
    if (existsSync(path.join(nextOutput, transient))) throw new Error(`Portable package must not contain Next.js ${transient} artifacts.`);
  }
  assertPe64(required[0]);
  assertPe64(required[1]);
  assertPe64(required[required.length - 1]);
  assertNoSecrets(directory);
}

rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
mkdirSync(artifactDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });

if (!skipAppBuild) {
  console.log('[build] Creating optimized local-mode Next.js application…');
  await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: rootDir,
    env: {
      ...process.env,
      NEXT_PUBLIC_TKD_MODE: 'LOCAL',
      NEXT_PUBLIC_SUPABASE_URL: '',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  });
}
if (!skipLauncherBuild) {
  console.log('[build] Compiling Electron launcher…');
  await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--prefix', desktopDir, 'run', 'build'], { cwd: rootDir });
}

const appRoot = path.join(workDir, 'app-root');
const runtimeDir = path.join(workDir, 'runtime');
const desktopResources = path.join(workDir, 'desktop');
const launcherStage = path.join(workDir, 'launcher');
await stageApplication(appRoot);
await stageNodeRuntime(runtimeDir);
mkdirSync(desktopResources, { recursive: true });
for (const file of ['supervisor.mjs', 'control.html']) copyFileSync(path.join(desktopDir, file), path.join(desktopResources, file));
copyFileSync(path.join(desktopDir, 'assets', 'icon.png'), path.join(desktopResources, 'icon.png'));
mkdirSync(launcherStage, { recursive: true });
copy(path.join(desktopDir, 'dist'), path.join(launcherStage, 'dist'));
writeFileSync(path.join(launcherStage, 'package.json'), JSON.stringify({
  name: 'tkd-scoring-desktop',
  productName: 'TKD Scoring',
  version,
  private: true,
  type: 'commonjs',
  main: 'dist/main.js',
}, null, 2));

const releaseInfo = {
  application: 'TKD Scoring',
  version,
  platform: 'win32-x64',
  portable: true,
  unsigned: true,
  node: nodeVersion,
  electron: desktopPackage.devDependencies.electron,
  betterSqlite3: sqliteVersion,
  licensing: 'Ed25519-signed, device-bound offline desktop activation; private key and customer licenses excluded',
  sourceRevision: await git(['rev-parse', 'HEAD']),
  sourceTreeDirty: Boolean(await git(['status', '--porcelain'])),
  builtAt: new Date().toISOString(),
  validation: 'PE/x64, dependency, migration, environment-file and ZIP-structure checks; not a physical-Windows execution test',
};
writeFileSync(path.join(desktopResources, 'release.json'), JSON.stringify(releaseInfo, null, 2));

console.log('[package] Creating portable Electron application…');
const packageOutput = path.join(workDir, 'package');
const [portableDirectory] = await packager({
  dir: launcherStage,
  out: packageOutput,
  tmpdir: path.join(workDir, 'packager-tmp'),
  name: 'TKD Scoring',
  executableName: 'TKD Scoring',
  platform: 'win32',
  arch: 'x64',
  appVersion: version,
  electronVersion: desktopPackage.devDependencies.electron,
  buildVersion: `${version}.0`,
  appCopyright: `Copyright © ${new Date().getUTCFullYear()} ADAM AGHZAF · TKDTech Sports Management`,
  icon: path.join(desktopDir, 'assets', 'icon.ico'),
  asar: true,
  prune: false,
  overwrite: true,
  extraResource: [appRoot, runtimeDir, desktopResources],
  win32metadata: {
    CompanyName: 'TKDTech Sports Management',
    FileDescription: 'TKD Scoring Local Desktop',
    InternalName: 'TKD Scoring',
    OriginalFilename: 'TKD Scoring.exe',
    ProductName: 'TKD Scoring',
  },
});
await validatePortableDirectory(portableDirectory);
writeFileSync(path.join(portableDirectory, 'READ-ME-FIRST.txt'), `TKD SCORING ${version} — WINDOWS x64 PORTABLE\n\n1. Extract this entire folder from the ZIP. Do not run the EXE inside the ZIP.\n2. Run \"TKD Scoring.exe\". Keep the resources folder beside it.\n3. The complete local system starts automatically; Node.js installation and commands are not required.\n4. On first run, copy the installation code shown in Activation and request a paid license from TKDTech. Import the signed .tkdlicense file before creating tournament work.\n5. Allow private/local network access if Windows Firewall asks. Judge devices must use the same LAN.\n6. Press Ctrl+Shift+L in the operator window to open local status, LAN addresses, data and logs.\n\nDATA\nYour SQLite database is stored in your Windows user profile under %APPDATA%\\TKD Scoring\\data. Close the app before backing up the whole data folder. Reinstalling or replacing the portable folder does not intentionally delete this database.\n\nPORTS\nOperator/API/LAN: 3000. Internal Next.js: 3001 (loopback only). Close other software using these ports before starting.\n\nLICENSE\nA signed license is bound to this computer/installation and its paid validity period. Tournament records stay readable and exportable after expiry; new work is blocked, while an already in-progress tournament can be finished. Internet is not required for scoring after activation. Do not delete the license folder when moving or updating the portable folder; request a device transfer when changing computers.\n\nSECURITY NOTICE\nThis portable build is not code-signed. Windows may show an unknown-publisher or SmartScreen warning. Download only from the official TKDtech GitHub release and verify the published SHA-256.\n\nOriginal TKD Scoring software by ADAM AGHZAF · TKDTech Sports Management.\n`);

console.log('[package] Creating ZIP…');
await createZip(portableDirectory);
const zipValidation = path.join(workDir, 'zip-validation');
await extractZip(artifactPath, { dir: zipValidation });
await validatePortableDirectory(path.join(zipValidation, 'TKD-Scoring'));
const digest = await sha256(artifactPath);
const size = statSync(artifactPath).size;
writeFileSync(`${artifactPath}.sha256`, `${digest}  ${artifactName}\n`);
const manifest = {
  ...releaseInfo,
  artifact: artifactName,
  sha256: digest,
  size,
  downloadUrl: `https://github.com/adamaghzad/TKDtech/releases/download/desktop-v${version}/${artifactName}`,
  zipValidation: 'PASSED',
};
writeFileSync(path.join(artifactDir, 'release-manifest.json'), JSON.stringify(manifest, null, 2));
rmSync(workDir, { recursive: true, force: true });
console.log(`\nDesktop artifact ready:\n${artifactPath}\nSHA-256: ${digest}\nSize: ${(size / 1024 / 1024).toFixed(1)} MiB\n`);
