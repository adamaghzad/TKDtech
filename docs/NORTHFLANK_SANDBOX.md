# Northflank Sandbox deployment

This guide deploys the complete application as **one container**:

- Express HTTP/WebSocket server on internal port `3000`;
- Next.js on internal loopback port `3001`;
- authoritative SQLite database on a persistent volume mounted at `/data`;
- one public HTTPS endpoint managed by Northflank.

Northflank's Sandbox is useful for a persistent public test or a small deployment. It is not a production SLA. Load-test the expected number of operators, judges, referees, and displays before an official event. An Internet-hosted container is not an offline LAN server.

## 1. Check the free resources

At the time this guide was written, Northflank advertised Sandbox with no card, up to USD 20/month of resources, and always-on services without inactivity sleep. Verify the current limits before deployment:

- <https://northflank.com/pricing>
- <https://northflank.com/docs/v1/application/billing/pricing-on-northflank>

Suggested allocation:

- runtime: `nf-compute-20` (0.2 vCPU, 512 MB RAM), one instance;
- persistent volume: 5 GB;
- no additional always-on services.

Some Sandbox accounts expose only `nf-compute-10` and `nf-compute-20`. Choose `nf-compute-20`; the 256 MB `nf-compute-10` plan is too small. The 512 MB plan is only an evaluation target and may be insufficient under tournament load.

The listed runtime and a 5 GB volume fit below the advertised resource allowance before builds and network usage. Monitor actual usage; do not assume every possible workload is free.

## 2. Put the code on GitHub

The Arena workspace is not automatically a GitHub repository. Create a **private** GitHub repository, then push a local copy of this project:

```bash
git init
git add .
git commit -m "Prepare TKD Scoring for Northflank"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

Use the repository URL you actually created. Do not commit `.env.local`, service-role secrets, the development database, backups, or uploaded personal data. The supplied `.gitignore` and `.dockerignore` exclude normal local secrets and database files.

The repository now includes:

- `Dockerfile`: Node 22 build and production runtime;
- `.dockerignore`: excludes credentials, local data, dependencies, and build artifacts.

## 3. Create the Northflank project

1. Open <https://app.northflank.com/signup> and select **Sandbox**.
2. Connect the GitHub account that can read the private repository.
3. Create a project named `tkd-scoring`.
4. Select the closest available European region to reduce latency from Morocco.

## 4. Create a combined service

Choose **Create service → Combined** and configure:

### Source and build

| Setting | Value |
|---|---|
| Name | `tkd-scoring` |
| Repository | Your private GitHub repository |
| Branch | `main` |
| Build type | `Dockerfile` |
| Dockerfile path | `Dockerfile` |
| Build context | Repository root |
| Build argument | `NEXT_PUBLIC_TKD_MODE=LOCAL` |

The Dockerfile installs the native build prerequisites for `better-sqlite3`, runs `npm ci`, and builds Next.js. The runtime command starts Express first, waits for port `3000`, and then starts Next.js internally on `3001`.

### Runtime resources

| Setting | Value |
|---|---|
| Compute plan | `nf-compute-20` (the largest option on some free accounts) |
| Instances | `1` |
| Deployment type | One instance with a single read/write volume |

**Do not scale above one instance.** The SQLite file and realtime gateway are authoritative within one process; multiple containers must not write to independent copies of the data.

### Runtime environment

Add these variables exactly, except for the public URL, which is configured after the first deployment:

```dotenv
NODE_ENV=production
PORT=3000
WEB_INTERNAL_URL=http://127.0.0.1:3001
TKD_DATABASE_PATH=/data/tournament.db
TKD_MODE=LOCAL
NEXT_PUBLIC_TKD_MODE=LOCAL
SEED_DEVELOPMENT=false
ALLOW_DEMO_LOGIN=false
PAIRING_TOKEN_TTL_SECONDS=300
PRESENCE_EXPIRY_SECONDS=15
```

Do not enable development seeding or demo authentication. No Supabase service-role key is needed for this SQLite deployment.

### Public networking

Expose only:

| Setting | Value |
|---|---|
| Internal port | `3000` |
| Protocol | `HTTP` |
| Accessibility | `Public` |

Northflank provides external HTTP/HTTPS routing and supports WebSockets on public HTTP ports. Do **not** expose `3001`; Next.js must remain internal.

Northflank networking reference: <https://northflank.com/docs/v1/application/network/configure-ports>

### Persistent volume

Under **Volumes**, add:

| Setting | Value |
|---|---|
| Size | `5 GB` |
| Container mount path | `/data` |
| Access mode | `Single Read/Write` |

`TKD_DATABASE_PATH=/data/tournament.db` places SQLite on this volume rather than ephemeral container storage.

### Health checks

Add an HTTP readiness check:

```text
Path: /login
Port: 3000
Initial delay: 30 seconds
Period: 30 seconds
Timeout: 5 seconds
Failure threshold: 3
```

`/login` verifies both Express and its proxy to Next.js. Optionally add a liveness check on `/api/v1/health` with the same port and conservative timings.

## 5. Deploy and configure the public origin

1. Create the service and watch the build/deployment logs.
2. Wait until the health check passes.
3. Open **Networking / Ports & DNS** and copy the generated `https://...code.run` URL.
4. Add this runtime variable, without a trailing slash:

   ```dotenv
   APP_PUBLIC_URL=https://YOUR-GENERATED-HOSTNAME
   ```

5. Save and restart/redeploy when Northflank requests it.

`APP_PUBLIC_URL` is used when generating judge and referee pairing URLs. It must be the public HTTPS origin, not `localhost`, `127.0.0.1`, or an internal service name. Hosted pairing prefers this explicit HTTPS origin over container/private interfaces even though the service uses `LOCAL` SQLite mode. Do not append `:3000` to the public `code.run` URL; Northflank routes HTTPS to the internal port. After correcting this variable, redeploy and issue a new five-minute QR code.

## 6. First-run verification

1. Open `https://YOUR-GENERATED-HOSTNAME/api/v1/health`; expect HTTP 200 and `"status":"ok"`.
2. Open `/register` and create the initial organization/administrator with a unique strong password.
3. Sign out and sign in again.
4. Create a small **test** tournament and verify dashboard metrics update.
5. Test the operator and public display in separate browser windows.
6. Pair test judge/referee devices and confirm QR codes use the Northflank HTTPS origin.
7. Restart the service and verify the test tournament still exists. Any active match must recover **paused for operator confirmation**, never with an unverified running clock.
8. Run a restart/reconnection drill before entering real tournament data.

## Lifecycle and operating rules

| Event | Expected result |
|---|---|
| No visitors for a while | Sandbox service remains running; no inactivity sleep |
| Container process exits | Orchestrator starts a replacement; health checks control readiness |
| Normal restart/redeploy | `/data/tournament.db` persists |
| Deployment with a single read/write volume | Brief downtime; old container stops before its replacement |
| Active match during shutdown | Recovered paused for operator confirmation |
| Volume deleted | Database is lost unless an independent backup exists |
| New commit with CI/CD enabled | Northflank may rebuild and redeploy automatically |

Disable automatic production deployment during an official event. Apply updates only between matches after a verified backup. A persistent volume is not an independent backup; periodically create and export a consistent backup using the procedure in `docs/OPERATIONS.md`.

## Production boundary

Sandbox is appropriate for evaluation and small noncritical deployments. For an official tournament, first complete load, restart, recovery, mobile-device, and backup/restore drills. Use an on-site local server if scoring must continue during an Internet outage, and upgrade the hosting resources if the 512 MB runtime or single-instance availability is insufficient. If logs show repeated out-of-memory restarts, stop retrying and move to a larger runtime.
