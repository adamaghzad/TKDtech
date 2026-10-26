# Verification record

Verified locally on **2026-10-26** with **Node.js 22.23.4**, **Next.js 16.4.3**, **React 19**, **Zod 4.6.7**, and Chromium via Playwright.

## Automated checks

| Check | Result |
|---|---|
| `npm run typecheck` | Passed, strict TypeScript with unchecked-index and other strict options |
| `npm run lint` | Passed with no errors or warnings using Next 16 native ESLint flat config |
| `npm test` | **91/91 tests passed across 14 files** |
| `npm run test:e2e` | **11/11 real Chromium tests passed** against the final Next 16 production preview |
| `npm run validate:migrations` | Passed: SQLite migration 1, 28 required entities, foreign keys enforced |
| `npm run validate:supabase` | Passed on temporary PostgreSQL 17: 29 RLS tables, auth/storage definitions, immutable draws, idempotent/conflict-aware RPC |
| `npm run build` | Passed: optimized Next 16.4.3 App Router production build with proxy convention |
| `npm audit --omit=dev --audit-level=high` | **0 vulnerabilities** after dependency upgrades/removal of unused vulnerable packages |

## Covered domain and persistence behavior

- Bracket sizes 2–32, deterministic random draws, seeded placement, byes, graph integrity, and reproducibility.
- Finalist-path configurable repechage for 4/8/16/32 entrants and winner progression.
- Point values, penalties, distinct-judge consensus using server receipt time despite skewed device clocks, duplicate delivery, ties, Golden Point, timer behavior, and state transitions.
- Automatic one-/two-judge switching from fresh device presence: immediate one-judge acceptance, two-judge restoration on reconnection, and pending-input resolution without duplicate scoring decisions.
- Automatic nonfinal-round expiry starts the category-configured running break; a paused nonfinal `0:00` round is also recovered into that break. The completed round result is persisted, scoring stays closed, break expiry does not start scoring, final-round expiry pauses without repeat transitions, and interrupted breaks recover/resume correctly.
- Timer-alert tracking emits one beep at each of 5/4/3/2/1 seconds and one round/rest end alert, with no initial-load replay, paused alert, unsupported-timer alert, or duplicate snapshot alert.
- Score-alert tracking emits once for authoritative blue/red score increases, including multi-point scores, with no initial-load/match-change replay, duplicate-snapshot repeat, or undo sound; a later new score sounds normally.
- Live large scores show current-round points during rounds and ordinary time-outs, including a verified 0–0 start to the next round while cumulative totals remain stored. Only after-round breaks show ended-round wins through `currentRound - 1`, exclude future rounds, and add the separate per-round summary. Completed-result scoring uses round wins for round-win/Golden Point results and authoritative cumulative points for a total-points decision.
- An ended tied round blocks next-round startup until an authorized referee/operator records a reasoned superiority decision. The server preserves equal points, persists/audits the winner, rejects overwrite attempts, includes that winner in match results, and broadcasts the updated round-win summary.
- Club/category/athlete CSV parsing supports UTF-8 BOM, CRLF, quoted fields, and independent row failures with a 500-row cap. Real browser uploads create 4 clubs and 4 categories, reject repeated duplicates, then create 12 athletes whose club/category names resolve to the correct registrations and passing weigh-ins.
- Role/tournament permissions and public denial.
- Idempotent commands and optimistic version conflicts.
- Pending-proposal diagnostics identify earlier matching proposals that expired before server arrival without changing the configured consensus policy.
- Expired/revoked pairing, heartbeat presence expiry, and assigned-session validation.
- Transactional completion and winner advancement; completed matches cannot be advanced again through the generic path.
- Completion releases the mat, deterministically auto-assigns the next eligible queued match without starting it, leaves an empty mat available, skips athletes live elsewhere, and recovers stale resolved assignments.
- Published draw/event immutability, multiple mats, simultaneous-athlete conflict checks, and restart recovery.
- Real WebSocket synchronization among operator, public display, and two judges, including duplicate snapshots, reconnection, and sequence-gap recovery.
- Sync full-log replay, server acknowledgement, duplicate handling, and conflict jobs never marked complete.
- Category + passing-weigh-in athlete creation → draw generation with real tournament UUID → immutable publication.

## Browser checks

The Playwright suite verifies:

1. Demo login and record-derived dashboard metrics; operator +1 updates the authoritative score and public display, emits exactly one scheduled `1320 Hz` score-confirmation tone after the browser sound unlock, and the test correction restores the showcase.
2. An anonymous client receives HTTP 401 when attempting a match mutation.
3. One connected mobile judge sees one-judge mode, submits an immediately accepted +3, and restores the score through the audited undo path.
4. Two independently paired mobile judges see the automatic return to two-judge consensus, submit distinct proposals for one accepted +3, and restore the score.
5. A public round-rest display shows large Blue 1 / Red 0 round wins after Blue's 5–2 Round 1 win, a decreasing `REST TIME` clock, `ROUND 1 COMPLETE`, separate Blue 5 / Red 2 points, a yellow `BLUE WINS ROUND 1` banner, and a yellow marker only on ended Round 1—not future Round 2; the test then restores the showcase.
6. A Round 1 time-out with Blue 2 / Red 7 shows those current-round points and hides the round-win/per-round summary. After expiry, rest alone switches to large Blue 0 / Red 1 round wins while Round 1 remains 2–7 with Red's marker/banner. Starting Round 2 then shows **0–0 round points** while the authoritative cumulative match total remains Blue 2 / Red 7.
7. A tied 7–7 round initially shows **SUPERIORITY REQUIRED** and 0–0 round wins. The operator records Red's superiority decision with an audit reason; the public TV then shows **RED WINS ROUND 1 · SUPERIORITY**, Red's yellow marker, and 0–1 round wins while both Round 1 point values remain 7.
8. The real 500 ms server scheduler automatically turns a six-second running round into a visible decreasing rest countdown, then recovers a paused nonfinal `0:00` fixture into a separate running 30-second rest; both are checked on the public TV, not only through domain calls.
9. After the browser-required sound unlock, a six-second TV rest emits five scheduled `880 Hz` warning tones and one original competition-style dual `180/240 Hz` end buzzer; the display then reads `REST ENDED`, and the test restores the normal 60-second break.
10. Completing a match opens a dedicated **MATCH … RESULT** view on the match-specific public display; Chromium verifies the yellow winner banner, authoritative winner name/country, decision-aware Blue/Red result values, and total-point summary. The public mat display then automatically rolls to the next eligible queued match, whose timer remains stopped in `READY`.
11. In a fresh tournament, Chromium uploads `01-clubs-test.csv`, `02-categories-test.csv`, and `03-athletes-import.csv` in order. It verifies 4 clubs and 4 categories, duplicate rejection on repeated club/category uploads, then 12 athletes with correct name-based club/category assignments, 3 passing entries per category, and 12/12 successful athlete rows.

Reviewed screenshots:

- `artifacts/dashboard.png`
- `artifacts/public-scoreboard.png`
- `artifacts/judge-mobile.png`
- `artifacts/judge-single-mobile.png`
- `artifacts/round-break-display.png`
- `artifacts/timeout-round-points-display.png`
- `artifacts/red-round-win-display.png`
- `artifacts/next-round-zero-display.png`
- `artifacts/superiority-round-display.png`
- `artifacts/automatic-round-rest.png`
- `artifacts/automatic-paused-zero-rest.png`
- `artifacts/timer-audio-rest-end.png`
- `artifacts/match-result-display.png`
- `artifacts/csv-import-athletes.png`

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
