# TKD Scoring

**By ADAM AGHZAF — TKDTech Sports Management**

A production-oriented Taekwondo tournament administration and Kyorugi scoring system with an authoritative local HTTP/WebSocket server, persistent SQLite event history, responsive administration, mobile judge/referee pairing, and a television scoreboard.

> Independent TKDTech software. It is not affiliated with or endorsed by Daedo or World Taekwondo, is not WT-certified, and does not emulate PSS sensor hardware. Scoring values and repechage policy in the included example ruleset must be checked against the rules adopted for each real event.

## Implementation status

| Area | Status |
|---|---|
| Local tournament server | Implemented and tested: Express HTTP API, typed WebSockets, SQLite WAL persistence, authentication, permissions, audit history, restart recovery |
| Tournament workflow | Tournament/club/athlete/category creation, registration validation, passing weigh-ins, random/seeded immutable draw versions, byes, elimination and configurable repechage, mat assignment, result advancement |
| Live scoring | Server-authoritative state machine, timer controls, `9.85`-style seconds/hundredths below 10 seconds, operator scoring, distinct-judge consensus, configurable round/match point gap, automatic two-round-win completion, penalties with configurable automatic Gam-Jeom disqualification, corrections, result finalization, transactional progression |
| Displays/devices | Read-only 16:9 public display, operator console, short-lived QR pairing, responsive controller-style J1/J2/J3 controls with fixed Blue/Red touch zones and device feedback, referee controls, presence expiry and reconnection recovery |
| Reports | Authenticated CSV and PDF exports; results and medal tables derive from stored records |
| Browser/PWA | Responsive App Router UI, localization resources, installable manifest and application-shell service worker |
| Portable Windows desktop | Electron launcher + bundled Node 22 + the same Express/Next.js/SQLite system; automatic startup, per-user persistence, supervised shutdown and LAN access. Windows x64 ZIP is a GitHub Release asset; physical-Windows verification remains required |
| Paid desktop licensing | Ed25519-signed, device-bound `.tkdlicense` files; private owner-only issuer, activation UI, server-side tournament/scoring enforcement, offline LAN operation, renewal warnings, and in-progress tournament continuation after expiry |
| Supabase foundation | PostgreSQL schema, RLS, storage policies, Auth trigger, Realtime publication, typed clients, and idempotent event-ingest RPC included; migration executed successfully against local PostgreSQL 17 with Supabase-compatible validation stubs |
| Live cloud deployment | **Not verified against a real Supabase project.** Full cloud administration/scoring parity and complete tournament provisioning/bidirectional synchronization remain work; do not treat the event-log push as a complete cloud backup |
| Android server hosting | **Not implemented or claimed.** Use a laptop/dedicated Linux host. The browser PWA is not an offline tournament server |
| PSS/IVR hardware | Not integrated. Browser judge buttons submit scoring proposals only |

## Windows desktop: download and run everything locally

Use the [website download page](https://p01--tkd-scoring--krbhnw2hlgh6.code.run/download) or the public `desktop-v1.2.0` GitHub Release. Download `TKD-Scoring-Windows-x64.zip` and its separate SHA-256 file, extract the entire archive, then run **`TKD Scoring.exe`**. Node.js installation and terminal commands are not required.

The launcher automatically starts the existing Express, Next.js, SQLite and WebSocket system, opens activation when required, and keeps the database and signed license in the Windows user profile. Tournament work requires a paid, device-bound license; see [Paid desktop licensing](docs/LICENSING.md). Press **Ctrl+Shift+L** for LAN addresses, data/logs and recovery controls. The portable release is unsigned, so Windows may show SmartScreen/unknown-publisher warnings. See [Desktop operation and packaging](docs/DESKTOP.md) before an official event.

## Quick start: development showcase

Requirements: Node.js 22+, npm 10+, and a native build environment supported by `better-sqlite3`.

```bash
npm ci
SEED_DEVELOPMENT=true \
ALLOW_DEMO_LOGIN=true \
TKD_DATABASE_PATH=./data/tkd-scoring.db \
npm run dev
```

Open **http://localhost:3000**. Port `3000` is the only browser-facing port; Next.js runs internally on `3001`.

Development-only sign-in:

- Email: `admin@demo.tkd`
- Password: `DemoAdmin2026!`

The root page attempts the demo login only when `ALLOW_DEMO_LOGIN=true`. Never enable either development flag for an official event, and never reuse the development database in production.

The fictional showcase is **Morocco Open · Development Showcase**. Match `203` starts paused in round 3 at blue 12, red 8 so scoring and recovery can be explored without completing the bracket.

## Production-style local start

Use a fresh database and disable all demo access:

```bash
npm ci
npm run build
NODE_ENV=production \
SEED_DEVELOPMENT=false \
ALLOW_DEMO_LOGIN=false \
TKD_DATABASE_PATH=/var/lib/tkd-scoring/tournament.db \
APP_PUBLIC_URL=http://192.168.1.10:3000 \
WEB_INTERNAL_URL=http://127.0.0.1:3001 \
npm start
```

Register the initial organization at `/login`, then create a tournament. See [Deployment](docs/DEPLOYMENT.md) for a service unit, LAN/TLS, firewall, and reverse-proxy guidance.

## Core operating workflow

1. Create a tournament and its clubs.
2. Import or create clubs, then categories, then athletes with compatible division/category and a passing weigh-in. Each CSV row is validated independently; athlete `clubName`/`categoryName` values resolve existing records case-insensitively, while UUID fields remain supported. The `csv-import-test/` pack exercises 4 clubs, 4 categories, and 12 assigned athletes.
3. Generate a random or seeded draw. Publishing freezes that draw version and creates bracket/match records; later seeds generate a new version rather than silently replacing it.
4. Open **Schedule**, assign ready matches to mats, then open **Matches** or **Live Scoreboard**. Completing a match releases its mat and automatically assigns the next eligible queued match without starting its timer.
5. Pair authorized devices from **Judges & Referees**. Each role has one active replaceable session; pairing tokens expire and are stored only as hashes.
6. Start/resume the round from the operator or referee console. Paired corner judges use a responsive controller interface: landscape gamepad clusters or portrait stacked primary controls, with all five Blue/Red techniques visible and no scoring-page overflow. Fixed touch zones support muscle memory; visual, vibration, and distinct tone feedback distinguish input sent, pending consensus, acceptance, and rejection where the device/browser supports them. With one online corner judge, that judge's authorized input is accepted immediately; when two or more are online, matching input from two distinct judges is required inside the consensus window. The mode switches automatically with device presence, and duplicate deliveries cannot award extra points.
7. Open **Tournament → Rules & status → Configurable scoring rules** before matches begin. Round gap uses only the active round and records `POINT_GAP`; match gap uses cumulative points and can run at a configured round ending and/or live from a configured round. New example rulesets start with the WT-style values 15 and 20 (end of Round 2 and live from Round 3); legacy rulesets without these fields stay disabled. Saves create audited revisions and are locked while any match is active. Verify the event outline, including senior semifinal/final exclusions—the control is tournament-wide, not a per-stage override. The same form configures Gam-Jeom opponent points (0–20) and the cumulative automatic-disqualification threshold (1–100). Gam-Jeom opponent points participate in gap evaluation, while disqualification retains priority.
8. At nonfinal round expiry the server enters the configured rest and the TV keeps the completed round's points and winner visible, with a yellow winner banner and yellow markers beside won rounds. Non-tied rounds start the rest countdown immediately. During rounds and ordinary time-outs, the large Blue/Red numbers show current-round points, so each new round starts at 0–0 while cumulative match totals remain authoritative in storage. Only after-round rest switches them to ended-round wins and adds the R1/R2/R3 summary near the top, excluding future rounds. If a round ends with equal points, the rest clock holds at full duration with **AWAITING SUPERIORITY**; an authorized referee/operator must record the officials' winner before rest or the next round can resume. Recording that audited decision starts the rest countdown automatically, and equal points remain unchanged. A nonfinal round recovered or paused at `0.00` also enters rest automatically; final-round zero without a two-round winner remains paused for the result workflow. Rest is non-scoring; when it reaches zero the TV shows **REST ENDED**, and the operator or referee explicitly starts the next round.
9. Use documented correction/undo reasons for nonfinal scoring mistakes. Completed matches cannot be silently progressed again; a dedicated completed-result correction/downstream-reversal workflow is listed as remaining work.
10. Open `/display/:matchId` on the television. Slim athlete side rails show current-round scoring activity: pink headguards for head kicks and blue hogus for body kicks, including turning variants. Every judge-scored head/trunk entry keeps its own J1–J3 pending/confirmed states; operator-added kicks are labelled `OPERATOR` rather than assigned fictitious judges. Every effective judge punch also remains as a separate entry with its own J1–J3 states and closed-fist icon, so new attempts append without hiding earlier confirmations. With five or more techniques, compact horizontal rows keep every entry and its judge/operator state visible without covering the Gam-Jeom footer. Punches remain separate from head/body `HITS`; expired pending input or an append-only correction removes only its corresponding technique entry while other confirmed activity remains. Each cumulative Gam-Jeom count has a centered, yellow-accent footer fully contained inside the athlete rail. These displays derive only from authoritative scoring records, not protector sensors or PSS hardware. Use **Sound off / Enable sound** once to unlock browser audio for an authoritative accepted-score confirmation, final-five-second beeps, and the original dual-tone competition-style round/rest end buzzer; the preference is saved per device. Public clients remain read-only and cannot issue scoring commands.
11. Completed match displays present **MATCH … RESULT**, a yellow **WINNER** banner, decision-aware round wins or total points, the winner's flag/name/country, and a round-by-round summary. Review results, medals, audit history, and CSV/PDF reports.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Next.js development server and separately runnable local HTTP/WebSocket server |
| `npm run build` | Production Next.js build |
| `npm start` | Production frontend and local server |
| `npm run typecheck` | Strict TypeScript across application, server, packages, scripts, and tests |
| `npm run lint` | Noninteractive ESLint flat-config check |
| `npm test` | Unit, integration, realtime, security-configuration, and sync tests |
| `npm run test:integration` | SQLite persistence, WebSocket, and synchronization integration tests |
| `npm run test:e2e` | Real Chromium dashboard/operator/public/mobile-judge/download tests |
| `npm run desktop:build` | Strictly compile the Electron main/preload launcher |
| `npm run desktop:package` | Build and validate the portable Windows x64 ZIP and separate SHA-256 (large artifacts stay out of Git) |
| `npm run test:desktop:runtime` | Optimized Express + Next.js + SQLite desktop-supervisor smoke, authenticated write and restart-persistence verification |
| `npm run validate:migrations` | Fresh SQLite migration, required entities, and foreign-key validation |
| `npm run validate:supabase` | Temporary PostgreSQL migration/RLS/trigger/RPC validation; requires PostgreSQL binaries |
| `npm run backup -- /path/backup.db` | Consistent online SQLite backup followed by integrity check |
| `npm run check` | Types, lint, tests, SQLite migration validation, desktop launcher compilation, and production build |

For a new browser-test machine:

```bash
npx playwright install --with-deps chromium
npm run test:e2e
```

The Playwright configuration reuses port `3000` when available or builds and starts an isolated production server with a seeded test database and test-only demo API. The production login does not render a demo button. Before a full verification run, remove stale test state with `rm -f /tmp/tkd-e2e.db /tmp/tkd-e2e.db-shm /tmp/tkd-e2e.db-wal`; never use that test database for an official event.

## Architecture

```text
Browser admin/operator/public/judge/referee
                    │ relative HTTP + /ws
                    ▼
Local Express server :3000  ── proxies non-API traffic ──▶ Next.js :3001
                    │
                    ├── authoritative match/domain services
                    ├── SQLite WAL + append-only match events + audit
                    └── optional, conflict-aware Supabase event RPC boundary

Supabase cloud: separate PostgreSQL/Auth/RLS/Realtime/Storage authority
```

The portable desktop wraps this same topology in an Electron launcher and bundled external Node supervisor. It does not replace the domain logic: Express remains the authority on port `3000`, Next.js remains loopback-only on `3001`, and SQLite moves to the desktop user's persistent data directory. IPC, heartbeat monitoring and per-instance runtime identity coordinate clean shutdown and orphan recovery.

A service worker can cache the application shell but is never an authority. A cloud Next.js deployment cannot serve judges on an Internet-disconnected LAN. The local server must remain running on a network-accessible host for offline operation.

## Security defaults

- Public mutation APIs require an authenticated, authorized server-side actor; hidden buttons are not the security boundary.
- Auth/pairing/session tokens are opaque random values stored as hashes. Pairing tokens are short-lived and single-use.
- Commands require an expected match version and an idempotency key.
- Draw versions, match events, and completed results have immutable/append-only protections.
- Public tournament responses exclude DOB, club contact details, session/token records, and internal registration data.
- The Supabase service-role key is read only by the local/server sync process, never by browser source.
- The desktop licensing private key remains outside Git and packages; only its Ed25519 public verification key is embedded. Express enforces activation on tournament/scoring mutations, not only the activation UI.
- Development seeding requires `SEED_DEVELOPMENT=true`; the demo endpoint separately requires `ALLOW_DEMO_LOGIN=true`.
- Desktop staging excludes environment files, local databases and development dependencies, disables demo access, clears cloud service-role configuration, and uses isolated/sandboxed Electron renderer windows without Node integration.

## Documentation

- [Deployment and LAN hosting](docs/DEPLOYMENT.md)
- [Northflank Sandbox container deployment](docs/NORTHFLANK_SANDBOX.md)
- [Supabase activation for the configured project](docs/SUPABASE_ACTIVATION.md)
- [Supabase/cloud setup and boundaries](docs/CLOUD.md)
- [Portable Windows desktop operation, packaging, and release](docs/DESKTOP.md)
- [Paid desktop licensing, issuance, key custody, and expiry](docs/LICENSING.md)
- [Operations, backup, recovery, and troubleshooting](docs/OPERATIONS.md)
- [HTTP/WebSocket API](docs/API.md)
- [Security and roles](docs/SECURITY.md)
- [Verification record](docs/TESTING.md)

## Known remaining work

Before official production adoption, complete and test live Supabase project provisioning and cloud workflow parity, full snapshot/bidirectional sync conflict resolution, dedicated completed-result correction with safe downstream bracket reversal, automatic queue optimization/manual queue reorder UI, any required hardware or video-review integration, Android-specific hosting if desired, and event-specific rules validation. These boundaries are intentional disclosures, not simulated functionality.
