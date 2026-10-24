# Verification record

Verified locally on **2026-10-24** with **Node.js 22.23.4**, **Next.js 16.4.3**, **React 19**, **Zod 4.6.7**, and Chromium via Playwright.

## Automated checks

| Check | Result |
|---|---|
| `npm run typecheck` | Passed, strict TypeScript with unchecked-index and other strict options |
| `npm run lint` | Passed with no errors or warnings using Next 16 native ESLint flat config |
| `npm test` | **60/60 tests passed across 9 files** |
| `npm run test:e2e` | **3/3 real Chromium tests passed** against the final Next 16 production preview |
| `npm run validate:migrations` | Passed: SQLite migration 1, 28 required entities, foreign keys enforced |
| `npm run validate:supabase` | Passed on temporary PostgreSQL 17: 29 RLS tables, auth/storage definitions, immutable draws, idempotent/conflict-aware RPC |
| `npm run build` | Passed: optimized Next 16.4.3 App Router production build with proxy convention |
| `npm audit --omit=dev --audit-level=high` | **0 vulnerabilities** after dependency upgrades/removal of unused vulnerable packages |

## Covered domain and persistence behavior

- Bracket sizes 2–32, deterministic random draws, seeded placement, byes, graph integrity, and reproducibility.
- Finalist-path configurable repechage for 4/8/16/32 entrants and winner progression.
- Point values, penalties, distinct-judge consensus using server receipt time despite skewed device clocks, duplicate delivery, ties, Golden Point, timer behavior, and state transitions.
- Role/tournament permissions and public denial.
- Idempotent commands and optimistic version conflicts.
- Pending-proposal diagnostics identify earlier matching proposals that expired before server arrival without changing the configured consensus policy.
- Expired/revoked pairing, heartbeat presence expiry, and assigned-session validation.
- Transactional completion and winner advancement; completed matches cannot be advanced again through the generic path.
- Published draw/event immutability, multiple mats, simultaneous-athlete conflict checks, and restart recovery.
- Real WebSocket synchronization among operator, public display, and two judges, including duplicate snapshots, reconnection, and sequence-gap recovery.
- Sync full-log replay, server acknowledgement, duplicate handling, and conflict jobs never marked complete.
- Category + passing-weigh-in athlete creation → draw generation with real tournament UUID → immutable publication.

## Browser checks

The Playwright suite verifies:

1. Demo login and record-derived dashboard metrics; operator control updates the authoritative score and public display state; the test correction restores the showcase.
2. An anonymous client receives HTTP 401 when attempting a match mutation.
3. Two independently paired mobile judges submit distinct proposals, one accepted +3 results, and the score is restored through the audited undo path.

Reviewed screenshots:

- `artifacts/dashboard.png`
- `artifacts/public-scoreboard.png`
- `artifacts/judge-mobile.png`

No browser page errors were observed in the dashboard/operator test.

## Runtime and recovery checks

- Health, authentication, bootstrap metrics, public data minimization, CSV, and PDF endpoints were smoke-tested against the running production preview.
- Public responses were checked to exclude athlete DOB and club contact email.
- Actual process recovery restored the showcase at blue 12, red 8, round 3 in `PAUSED` state.
- A subsequent graceful-stop drill logged the running match as paused/persisted before close; after restart the timer difference reflected only the stop-call interval (under three seconds), not server downtime.
- `npm run backup -- /tmp/tkd-backup-test.db` completed using SQLite online backup and integrity verification.
- `npm run check:database -- /tmp/tkd-backup-test.db` reported migration 1, integrity ok, and foreign keys ok.

## Not verified / not claimed

- No hosted Supabase project was available. Hosted Auth, Realtime, Storage, project default privileges, and production cloud deployment remain unverified. PostgreSQL validation used local Supabase-compatible `auth`/`storage` stubs, not the hosted service.
- Full cloud workflow parity, complete snapshot provisioning, and bidirectional conflict resolution are not complete.
- Dedicated completed-result correction with safe downstream bracket reversal is not complete.
- No PSS sensor or IVR hardware integration was tested or claimed.
- No genuine Android server runtime/background-hosting implementation was tested or claimed.
- Included scoring and repechage settings remain examples requiring validation against each event's adopted regulations.
