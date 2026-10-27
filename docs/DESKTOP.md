# TKD Scoring portable Windows desktop

The desktop release packages the **existing authoritative TKD Scoring application**. It does not introduce a second scoring engine or turn the hosted website into a fake offline mode.

## Download and run

The public download page is `/download` on the deployed website. The portable artifact is distributed as a public GitHub Release asset, not committed to Git:

- `TKD-Scoring-Windows-x64.zip`
- `TKD-Scoring-Windows-x64.zip.sha256`
- Release tag format: `desktop-v<version>`

On Windows 10/11 x64:

1. Download the ZIP and its `.sha256` file from the same official release.
2. Verify the ZIP with `certutil -hashfile TKD-Scoring-Windows-x64.zip SHA256` and compare the result with the published checksum.
3. Use **Extract All** on the ZIP. Do not run the application from inside the compressed archive.
4. Open the extracted `TKD-Scoring` folder and run **`TKD Scoring.exe`**. Keep `resources` and all DLLs beside the executable.
5. Wait for automatic startup. The operator window opens only after the matching desktop Express instance and the Next.js frontend are ready.
6. Register the initial organization and create a tournament. Demo seeding and demo login are deliberately disabled in the desktop runtime.

No Node.js installation, npm command, installer, or administrator-level setup is required. Internet is needed to download/update the package, not to run scoring on the venue LAN afterward.

### Unsigned-release warning

This portable build is **not code-signed**. Windows can show an unknown-publisher or SmartScreen warning. The download page and release notes disclose this explicitly. A checksum detects a changed file; it does not turn an unsigned binary into a publisher-signed one. Download only from the official TKDtech release.

## What starts automatically

```text
TKD Scoring.exe (Electron)
        │ IPC shutdown + heartbeat control file
        ▼
Bundled Node 22 supervisor
        ├── Express + WebSockets + SQLite :3000, bound to 0.0.0.0
        └── Next.js production server     :3001, bound to 127.0.0.1

Operator: http://127.0.0.1:3000
Judges/referees/displays: http://PC-LAN-ADDRESS:3000
```

The external Node runtime runs the same `apps/local-server/src/index.ts`, optimized `apps/web/.next`, contracts/domain packages, migrations, and `better-sqlite3` database used by the existing production-style local topology. The Next.js server is loopback-only; venue devices cross the Express HTTP/WebSocket authorization boundary on port `3000`.

The package includes Windows x64 binaries for Electron, Node, esbuild/`tsx`, SQLite and optional Next.js native dependencies. A Linux native SQLite or esbuild binary is never substituted into the Windows archive.

## Status panel and LAN pairing

Press **Ctrl+Shift+L** while the operator window is focused to reopen the desktop status panel. It provides:

- startup/readiness/failure state;
- operator and detected private-LAN URLs;
- buttons to reopen the operator, retry a failed startup, open the data folder, and open logs.

The launcher selects a private or link-local IPv4 address for `APP_PUBLIC_URL` when one is available. It does not deliberately use a public, loopback, or otherwise unsuitable address as a claimed LAN pairing URL. If no suitable interface exists, the status panel says so. Connect the PC to the venue LAN and restart the application if the address changes.

On the first run, Windows Firewall may request network permission. Private/local-network access is required for separate judge devices. Also check router client isolation and confirm that every device is on the same LAN. Do not expose port `3000` directly to the public Internet; use the documented authenticated TLS deployment when remote access is required.

Ports `3000` and `3001` must be free. The desktop launcher uses a single-application-instance lock and does not silently connect to an unrelated service already using those ports.

## Persistent data, logs, backup, and updates

Per-user Windows locations:

| Content | Location |
|---|---|
| SQLite database | `%APPDATA%\TKD Scoring\data\tkd-scoring.db` |
| SQLite WAL sidecars while running | Beside the database |
| Launcher and runtime log | `%APPDATA%\TKD Scoring\logs\desktop.log` |
| Supervisor heartbeat/runtime status | `%APPDATA%\TKD Scoring\desktop-*.json` |

The database is outside the portable folder. Replacing the portable folder with a newer release does not intentionally delete tournament data.

**Backup:** close the application and copy the whole `data` folder, not only an active `.db` file. WAL content may not yet be checkpointed into the main file. Keep an additional off-PC backup for an official event.

**Restore/recovery:** close the application, preserve the current data folder for investigation, then restore a known-good whole-folder backup. Reopen the app and verify records before resuming. As in service mode, recovered running timers are paused for operator confirmation; officials must verify match state after an abrupt failure.

**Update:** close the app, back up data, extract the new release into a new folder, and run its EXE. There is no automatic updater claim.

**Uninstall:** close the app and delete the portable folder. This leaves the per-user database intact. Delete `%APPDATA%\TKD Scoring` separately only when intentionally removing all local application data.

## Shutdown and orphan recovery

Normal window/application shutdown requests supervised IPC shutdown. The supervisor asks Express to pause/persist affected timers and close SQLite, stops Next.js, and escalates to process-tree termination only after a timeout.

The supervisor checks a launcher heartbeat. If the launcher disappears, it stops the complete runtime instead of leaving an unowned scoring server. If either Express or Next.js exits unexpectedly, the supervisor stops the sibling service rather than leaving a partial system available.

For a subsequent launch after an abrupt failure, the launcher compares random per-instance identifiers from Express and the loopback-only Next.js runtime endpoint against the previous runtime record. It only performs orphan process cleanup when an identifier matches; it does not kill an arbitrary process merely because a port is occupied. The internal endpoint is not proxied as a public Express API route.

## Build the Windows ZIP

Build prerequisites on the packaging machine:

- Node.js **22.16.0** and npm 10;
- the root and desktop locked dependencies (`npm ci` and `npm --prefix desktop ci`);
- `tar` for the pinned SQLite prebuild archive;
- enough disk space for staging, Electron, the extracted ZIP and validation copy (several GB);
- network access to npm, nodejs.org and GitHub release downloads.

```bash
export PATH=/path/to/node22/bin:$PATH   # when Node 22 is not the default
npm ci
npm --prefix desktop ci
npm run desktop:package
```

Default output is the Git-ignored `desktop/artifacts/` directory. To keep large work files outside the workspace or a small temporary filesystem:

```bash
DESKTOP_ARTIFACT_DIR=/home/user/.cache/tkd-desktop-artifacts \
DESKTOP_DOWNLOAD_CACHE=/home/user/.cache/tkd-desktop-downloads \
npm run desktop:package
```

For iteration only, `node desktop/scripts/build-windows.mjs --skip-app-build --skip-launcher-build` reuses an already validated Next.js build and compiled launcher. Run the full command for a release.

The build:

1. creates an optimized local-mode Next.js build with cloud public environment values empty;
2. compiles strict Electron main/preload TypeScript;
3. copies only required server/domain sources, migrations, public files and the optimized `.next` output (excluding `.next/cache`);
4. runs `npm ci --omit=dev --ignore-scripts --os=win32 --cpu=x64` in isolated staging;
5. downloads the official Node 22 Windows runtime and validates it against the official `SHASUMS256.txt`;
6. installs the pinned, hash-verified `better-sqlite3` Node-v127 Windows x64 prebuild;
7. packages Electron with the branded EXE/icon and external resources;
8. refuses environment files and tournament databases, checks required migrations/runtime files, and verifies native binaries as PE32+ x64;
9. creates the ZIP, extracts it again for structure validation, and writes a separate SHA-256 plus release manifest.

The checksum is deliberately a separate release asset. Embedding the ZIP's own hash inside its bundled download page would change the ZIP and invalidate that hash.

## Publish a release

Build from a clean committed source tree so `resources/desktop/release.json` records the correct source revision and `sourceTreeDirty: false`. Create GitHub Release `desktop-v1.0.0` (or the current desktop package version) and upload both the ZIP and `.sha256`. Include the actual SHA-256, file size, local data behavior, firewall note, unsigned warning, source commit, and verification limits in the release notes.

Keep the large ZIP, extracted package and staging directories out of Git. The website's `apps/web/lib/desktop-release.ts` points to the stable release asset URLs; it does not embed the artifact hash.

## Verification boundary

Linux validation can execute the equivalent production Express/Next.js/SQLite topology and inspect the Windows package. It cannot honestly prove that Windows Explorer, SmartScreen, Windows Firewall, win32 process-tree termination, or the signed-out Windows desktop experience works on every machine. A physical Windows 10/11 x64 smoke test remains required before an official tournament:

1. download and checksum the public asset;
2. extract and launch with no Node.js installed;
3. register, restart, and confirm the same tournament returns;
4. connect two judge/referee devices over the real LAN;
5. test scoring/reconnection and a clean close;
6. test launcher/process failure recovery and confirm no orphan remains;
7. verify backup/restore and the Windows Firewall/SmartScreen prompts.
