import { build } from 'esbuild';
import { ZipFile } from 'yazl';
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
import { finished, pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(rootDir, 'android');
const artifactDir = path.resolve(process.env.ANDROID_ARTIFACT_DIR || path.join(androidDir, 'build'));
const workDir = path.join(artifactDir, 'work');
const appRoot = path.join(workDir, 'app-root');
const generatedAssets = path.join(androidDir, 'app', 'build', 'generated', 'tkdAssets');
const cacheDir = process.env.ANDROID_DOWNLOAD_CACHE || path.join(os.tmpdir(), 'tkd-android-downloads');
const runtimeVersion = '24.20.0-0';
const runtimeArchiveName = `nodejs-mobile-android-${runtimeVersion}.zip`;
const runtimeArchiveSha256 = 'f5ffbaf4f2679fa9180b0758c637c2f8fc8828300f95129badf213a028fb37bb';
const nextVersion = JSON.parse(readFileSync(path.join(rootDir, 'node_modules', 'next', 'package.json'), 'utf8')).version;
const skipAppBuild = process.argv.includes('--skip-app-build');

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
    return name === '.env' || name.startsWith('.env.') || name.endsWith('.tkdlicense') || (name.endsWith('.pem') && name.includes('private')) || name === 'tkd-scoring.db' || name === 'tournament.db' || name.endsWith('.sqlite') || name.endsWith('.db-wal') || name.endsWith('.db-shm');
  });
  if (forbidden.length) throw new Error(`Refusing to package environment files, private keys, customer licenses, or local databases:\n${forbidden.join('\n')}`);
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

async function createRuntimeArchive(source, destination) {
  console.log('[archive] Creating a single first-launch runtime asset…');
  const archive = new ZipFile();
  const output = createWriteStream(destination, { mode: 0o600 });
  const sourceFinished = finished(archive.outputStream);
  const outputFinished = finished(output);
  archive.outputStream.pipe(output);
  const alreadyCompressed = /\.(?:png|jpe?g|gif|webp|ico|woff2?|zip|gz)$/i;
  const files = walk(source).sort((left, right) => left.localeCompare(right));
  for (const filename of files) {
    const name = path.relative(source, filename).split(path.sep).join('/');
    const compress = !alreadyCompressed.test(name);
    archive.addFile(filename, name, {
      mtime: new Date('2026-01-01T00:00:00.000Z'),
      compress,
      ...(compress ? { compressionLevel: 6 } : {}),
    });
  }
  archive.end();
  await Promise.all([sourceFinished, outputFinished]);
}

async function stageApplication() {
  mkdirSync(appRoot, { recursive: true });
  for (const file of ['package.json', 'package-lock.json']) copyFileSync(path.join(rootDir, file), path.join(appRoot, file));
  copy(path.join(rootDir, 'apps', 'web', '.next'), path.join(appRoot, 'apps', 'web', '.next'), {
    filter: (source) => !source.includes(`${path.sep}.next${path.sep}cache`) && !source.includes(`${path.sep}.next${path.sep}dev`),
  });
  copy(path.join(rootDir, 'apps', 'web', 'public'), path.join(appRoot, 'apps', 'web', 'public'));
  copyFileSync(path.join(rootDir, 'apps', 'web', 'next.config.mjs'), path.join(appRoot, 'apps', 'web', 'next.config.mjs'));
  copy(path.join(rootDir, 'apps', 'local-server', 'src', 'persistence', 'migrations'), path.join(appRoot, 'migrations'));
  if (!existsSync(path.join(appRoot, 'apps', 'web', '.next', 'BUILD_ID'))) throw new Error('Optimized Next.js BUILD_ID is missing.');

  console.log('[stage] Installing JavaScript production dependencies without native install scripts…');
  await run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: appRoot });
  await run('npm', ['install', '--omit=dev', '--no-save', '--package-lock=false', '--ignore-scripts', '--no-audit', '--no-fund', `@next/swc-wasm-nodejs@${nextVersion}`], { cwd: appRoot });

  // The Android server is precompiled on the build host. It uses node:sqlite,
  // so neither better-sqlite3 nor the tsx/esbuild runtime is shipped. Next's
  // optional native image/build accelerators are replaced by JS/WASM fallbacks.
  for (const name of ['better-sqlite3', 'tsx', 'concurrently', 'wait-on', 'esbuild', 'sharp']) rmSync(path.join(appRoot, 'node_modules', name), { recursive: true, force: true });
  for (const scope of ['@esbuild', '@img', '@rollup', '@unrs']) rmSync(path.join(appRoot, 'node_modules', scope), { recursive: true, force: true });
  rmSync(path.join(appRoot, 'node_modules', '.bin'), { recursive: true, force: true });
  const nextScope = path.join(appRoot, 'node_modules', '@next');
  for (const name of readdirSync(nextScope)) {
    if (name.startsWith('swc-') && name !== 'swc-wasm-nodejs') rmSync(path.join(nextScope, name), { recursive: true, force: true });
  }
  const nativeBinaries = walk(appRoot).filter((filename) => filename.endsWith('.node'));
  if (nativeBinaries.length) throw new Error(`Unreviewed native Node dependencies remain:\n${nativeBinaries.join('\n')}`);

  console.log('[bundle] Precompiling the authoritative local server for Android…');
  await build({
    entryPoints: [path.join(rootDir, 'apps', 'local-server', 'src', 'index.ts')],
    outfile: path.join(appRoot, 'server.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: path.join(rootDir, 'tsconfig.json'),
    external: ['next', 'express', 'cookie-parser', 'helmet', 'express-rate-limit', 'http-proxy', 'ws', 'zod', 'nodemailer', 'pdfkit', '@supabase/supabase-js'],
    plugins: [{
      name: 'android-node-sqlite',
      setup(builder) {
        builder.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: path.join(rootDir, 'apps', 'local-server', 'src', 'persistence', 'node-sqlite.ts') }));
      },
    }],
  });
  assertNoSecrets(appRoot);
}

async function stageNodeMobile() {
  const archive = path.join(cacheDir, runtimeArchiveName);
  await download(`https://github.com/digidem/nodejs-mobile/releases/download/v${runtimeVersion}/${runtimeArchiveName}`, archive, runtimeArchiveSha256);
  const extracted = path.join(workDir, 'node-mobile');
  mkdirSync(extracted, { recursive: true });
  await run('unzip', ['-q', archive, '-d', extracted]);
  const destination = path.join(androidDir, 'app', 'libnode');
  rmSync(destination, { recursive: true, force: true });
  copy(path.join(extracted, 'include'), path.join(destination, 'include'));
  for (const abi of ['arm64-v8a', 'armeabi-v7a', 'x86_64']) copy(path.join(extracted, 'bin', abi), path.join(destination, 'bin', abi));
  for (const filename of ['NODE-LICENSE.txt', 'NODEJS-MOBILE-LICENSE.txt']) {
    const url = filename === 'NODE-LICENSE.txt'
      ? 'https://raw.githubusercontent.com/nodejs/node/v24.20.0/LICENSE'
      : 'https://raw.githubusercontent.com/digidem/nodejs-mobile/v24.20.0-0/LICENSE';
    await download(url, path.join(appRoot, filename));
  }
}

rmSync(workDir, { recursive: true, force: true });
rmSync(generatedAssets, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });
mkdirSync(generatedAssets, { recursive: true });

if (!skipAppBuild) {
  console.log('[build] Creating optimized local-mode Next.js application…');
  await run('npm', ['run', 'build'], {
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

await stageApplication();
await stageNodeMobile();
const manifest = {
  application: 'TKD Scoring Android Host',
  nodeMobile: runtimeVersion,
  nodeMobileSha256: runtimeArchiveSha256,
  next: nextVersion,
  sourceRevision: await git(['rev-parse', 'HEAD']),
  sourceTreeDirty: Boolean(await git(['status', '--porcelain'])),
  database: 'SQLite through node:sqlite on Android; existing better-sqlite3 retained on Windows/Linux',
  nativeNodeAddons: false,
  secretsIncluded: false,
  preparedAt: new Date().toISOString(),
};
const manifestJson = JSON.stringify(manifest, null, 2);
writeFileSync(path.join(appRoot, 'android-runtime.json'), manifestJson);
assertNoSecrets(appRoot);
await createRuntimeArchive(appRoot, path.join(generatedAssets, 'app-runtime.zip'));
writeFileSync(path.join(generatedAssets, 'runtime-manifest.json'), manifestJson);
assertNoSecrets(generatedAssets);
const bytes = walk(generatedAssets).reduce((total, filename) => total + statSync(filename).size, 0);
console.log(`\nAndroid runtime prepared: ${generatedAssets}\nPayload: ${(bytes / 1024 / 1024).toFixed(1)} MiB\nNode mobile: ${runtimeVersion}\n`);
