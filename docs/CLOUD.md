# Supabase and cloud setup

## Boundary — read before use

The repository contains the official Supabase JavaScript clients, typed cloud models, PostgreSQL migration, RLS/storage policies, Auth user trigger, Realtime publication, and an idempotent local-event ingestion RPC. The migration is validated on real PostgreSQL 17 with local Supabase-compatible test stubs.

No Supabase project credentials were available in the build environment. Therefore Supabase hosted Auth, Realtime delivery, Storage uploads, dashboard behavior, and project-specific default privileges have **not** been live-tested. Cloud-only administration/scoring is not yet at local-mode parity. The local push service replays match events; it does not provision an entire tournament or upload a complete authoritative match snapshot.

## 1. Create and link a project

```bash
npm ci
npx supabase@latest login
npx supabase@latest link --project-ref YOUR_PROJECT_REF
npx supabase@latest db push
```

The migration is:

```text
supabase/migrations/202610240001_initial.sql
```

Review the SQL and back up the target before applying it to an existing project. Do not run it repeatedly through ad-hoc SQL edits; use normal Supabase migration history.

## 2. Create the initial administrator

In **Supabase Dashboard → Authentication → Users**, create a user. For the optional development seed, use `admin@demo.tkd`; otherwise substitute your own administrator and adapt the seed.

The migration's `auth.users` trigger creates the corresponding public profile. To install only the fictional development organization/membership, run `supabase/seed.sql` in the SQL Editor after creating that Auth user. The seed does not create a known Auth password.

For production, create your own organization and `SUPER_ADMIN` membership using a controlled administrative SQL/script process. Do not use the fictional showcase.

## 3. Configure environment variables

Server/local sync process:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_OR_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

Browser/server rendering:

```dotenv
NEXT_PUBLIC_TKD_MODE=CLOUD
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_OR_PUBLISHABLE_KEY
```

Keep `SUPABASE_SERVICE_ROLE_KEY` only in the server environment. Never place it in `NEXT_PUBLIC_*`, client source, Git, screenshots, or a downloaded env file. Rotate it immediately if exposed.

## 4. Storage

The migration creates:

- `club-logos`: public logo bucket;
- `athlete-photos`: private, tournament-member reads;
- `tournament-exports`: private, tournament-member reads.

Private object names must begin with the tournament UUID:

```text
TOURNAMENT_UUID/athletes/ATHLETE_UUID/photo.webp
TOURNAMENT_UUID/reports/RESULTS_UUID.pdf
```

There are deliberately no direct browser write policies. Perform validated uploads with a server-only privileged client after checking membership, MIME type, and size. Hosted upload UI and lifecycle processing remain to be tested/implemented.

## 5. Realtime

The migration conditionally adds `public.matches` to `supabase_realtime` when that publication exists. `apps/web/lib/supabase/cloud-realtime.ts` implements a sequence-aware invalidation subscription: on a gap it requests a fresh authorized snapshot instead of applying uncertain deltas.

The public display should query `public.public_match_display`, a minimal fixed-column view. Direct anonymous access to athlete and club base tables is not granted by their RLS policies. Realtime on PostgreSQL changes uses the base `matches` table, not the view.

## 6. Local event-log push

The local server exposes `POST /api/v1/sync/push` to tournament administrators. It requires both Supabase URL and the server-only service key. Every attempt creates a synchronization job.

Delivery rules:

1. Replay the full event log; do not use one tournament-wide sequence to skip another match's events.
2. The RPC deduplicates event ID or match/idempotency key before checking sequence.
3. Per-match cloud sequence must advance exactly by one.
4. A duplicate is safe; a gap, stale sequence, missing match, or authorization failure is not success.
5. Only server acknowledgement can mark the job `COMPLETED`; conflicts remain `CONFLICT` with diagnostic JSON.

The target tournament/matches must already exist in cloud with matching UUIDs and expected sequences. Provisioning those records and reconciling full state are remaining work. Consequently, **do not use this push as the sole backup or disaster-recovery mechanism**; use the tested SQLite backup procedure.

## 7. Hosted Next.js deployment

Build with `npm run build` and deploy `apps/web` using the normal Next.js App Router process. Configure the public Supabase variables at build and runtime. `apps/web/proxy.ts` refreshes Supabase Auth cookies only when `NEXT_PUBLIC_TKD_MODE=CLOUD`.

A hosted frontend alone does not provide offline LAN service. For a hybrid event, run the local server separately and treat local SQLite and cloud PostgreSQL as explicit separate authorities.

## 8. Required hosted verification before production

Run the migration through Supabase CLI on a staging project, then verify:

- email/password Auth and profile trigger;
- every role's allowed and denied queries under RLS;
- anonymous display view and absence of private columns;
- Realtime authorization, reconnect, and sequence-gap behavior;
- private Storage denial and signed/member downloads;
- RPC deduplication, gaps, forbidden callers, and concurrent delivery;
- complete tournament provisioning/snapshot reconciliation once implemented;
- backup/restore using Supabase PostgreSQL tooling.
