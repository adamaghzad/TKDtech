# Verification record

Verified locally on **2026-10-27** with **Node.js 22.16.0**, **Next.js 16.4.3**, **React 19**, **Zod 4.6.7**, **Electron 45**, and Chromium via Playwright.

## Automated checks

| Check | Result |
|---|---|
| `npm run typecheck` | Passed, strict TypeScript with unchecked-index and other strict options |
| `npm run lint` | Passed with no errors or warnings using Next 16 native ESLint flat config |
| `npm test` | **173/173 tests passed across 27 files** |
| `npm run test:e2e` | **23/23 real Chromium tests passed** against the Next 16 production server |
| `npm run desktop:build` | Passed strict Electron main/preload TypeScript compilation |
| `npm run test:desktop:runtime` | Passed real signed-license issuance, unlicensed/invalid/wrong-device API rejection, valid activation, exports, optimized desktop-supervisor startup, internal identity boundary, authenticated tournament write, clean shutdown and restart license/data persistence |
| `npm run test:license:delivery` | Passed real production-key signing, intended-device activation, wrong-device rejection and exact mock email attachment; no real email sent |
| `npm run validate:migrations` | Passed: SQLite migration 2, 29 required entities, foreign keys enforced |
| `npm run validate:supabase` | Passed on temporary PostgreSQL 17: 29 RLS tables, auth/storage definitions, immutable draws, idempotent/conflict-aware RPC |
| `npm run build` | Passed: optimized Next 16.4.3 App Router production build with proxy convention |
| `npm audit --omit=dev --audit-level=high` | **0 vulnerabilities** after dependency upgrades/removal of unused vulnerable packages |

## Covered domain and persistence behavior

- Bracket sizes 2–32, deterministic random draws, seeded placement, byes, graph integrity, and reproducibility.
- Finalist-path configurable repechage for 4/8/16/32 entrants and winner progression.
- Point values, penalties, distinct-judge consensus using server receipt time despite skewed device clocks, duplicate delivery, ties, Golden Point, timer behavior, and state transitions.
- Automatic one-/two-judge switching from fresh device presence: immediate one-judge acceptance, two-judge restoration on reconnection, and pending-input resolution without duplicate scoring decisions.
- Automatic nonfinal-round expiry starts the category-configured running break; a paused nonfinal `0:00` round is also recovered into that break. The completed round result is persisted, scoring stays closed, break expiry does not start scoring, final-round expiry without a two-round winner pauses without repeat transitions, and interrupted breaks recover/resume correctly.
- Shared timer formatting preserves `M:SS` at and above 10 seconds, switches to seconds and hundredths without a minute prefix below 10 seconds (for example `9.85`), and clamps zero/negative values to `0.00`.
- Timer-alert tracking emits one beep at each of 5/4/3/2/1 seconds and one round/rest end alert, with no initial-load replay, paused alert, unsupported-timer alert, or duplicate snapshot alert.
- Score-alert tracking emits once for authoritative blue/red score increases, including multi-point scores, with no initial-load/match-change replay, duplicate-snapshot repeat, or undo sound; a later new score sounds normally.
- Live large scores show current-round points during rounds and ordinary time-outs, including a verified 0–0 start to the next round while cumulative totals remain stored. Only after-round breaks show ended-round wins through `currentRound - 1`, exclude future rounds, and add the separate per-round summary. Completed-result scoring uses total ended-round wins for round-win, Golden Point and match point-gap results, and authoritative cumulative points only for explicit total-points decisions; cumulative points remain visible as secondary information.
- Public mat displays use a dedicated KPNP-style `WAITING` view both when no match is assigned and while a `PENDING`/`READY`/`CALLED` match awaits Round 1. The waiting view hides athlete identities, scores, timers and Gam-Jeom counts; assignment and Round 1 start replace it automatically, while the operator preview and error states remain unchanged.
- Two ended round wins automatically complete the match with `ROUND_WINS` after operator round end and authoritative timer expiry; the first win still enters rest, future rounds cannot contribute, and no third round starts. A superiority decision that supplies the second win completes immediately without starting rest, while a tied final round with no two-round winner remains paused and unresolved.
- Configurable point-gap policy verifies exact boundaries and timing: legacy omissions stay disabled; Red 14–0 continues under a 15-point round rule; exactly 15–0 persists the accepted score then a separate `POINT_GAP` round decision; a second such round win completes by `ROUND_WINS`; timer-expiry recovery honors an already-persisted gap. Cumulative 20-point match gap completes at the end of Round 2 or live in Round 3, takes priority over ordinary two-round-win finalization at round completion, and leaves a live unfinished Round 3 explicitly unended. Operator, judge-consensus, and configured Gam-Jeom points all trigger evaluation, while the configured cumulative disqualification threshold keeps `DISQUALIFICATION` priority. A custom +2 Gam-Jeom is verified both in a round-gap result and in automatic disqualification at a custom threshold of two penalties. Duplicate commands remain idempotent and below-threshold evaluation adds no no-op event/version.
- Tournament-admin ruleset saves create audited `RULESET_UPDATED` revisions for point gap and Gam-Jeom opponent points/disqualification threshold, preserve unrelated scoring fields, reject stale versions and invalid round numbers, restrict registration managers, and lock whenever a tournament match is active. Latest-ruleset joins select one deterministic revision for snapshots and proposal expiry.
- An ended tied round holds the full rest with `SUPERIORITY`, blocks every rest/next-round resume path, and survives reset/review/recovery checks until an authorized referee/operator records a reasoned decision. Legacy running unresolved breaks are paused by the scheduler. The decision releases the hold, starts rest automatically, preserves equal points, persists/audits the winner, rejects overwrites, and feeds match results.
- Club/category/athlete CSV parsing supports UTF-8 BOM, CRLF, quoted fields, and independent row failures with a 500-row cap. Real browser uploads create 4 clubs and 4 categories, reject repeated duplicates, then create 12 athletes whose club/category names resolve to the correct registrations and passing weigh-ins.
- Role/tournament permissions and public denial.
- Idempotent commands and optimistic version conflicts.
- Pending-proposal diagnostics identify earlier matching proposals that expired before server arrival without changing the configured consensus policy. The 500 ms scheduler also persists pending-punch expiry and broadcasts its removal from the public display.
- Current-round scoring activity derives separate headguard, hogu, and fist entries for head kicks, body kicks, and punches, including turning variants. Every judge-scored technique keeps its own J1–J3 pending/confirmed roles and recorded one-/two-judge threshold; operator-added kicks are labelled `OPERATOR` with no invented judge votes. Effective hit counts exclude pending input, corrections and expiry remove only their corresponding entries, successive punches/kicks retain prior confirmations, and snapshots expose no session credentials or PSS/sensor claims.
- Expired/revoked pairing, heartbeat presence expiry, and assigned-session validation.
- Transactional completion and winner advancement; completed matches cannot be advanced again through the generic path. The fourth cumulative Gam-Jeom leaves the match active, while the fifth awards the opponent point and atomically persists `DISQUALIFIED`, the opponent's `DISQUALIFICATION` win, the official result, bracket advancement, and mat release. Retries are idempotent and further penalties/generic undo are rejected.
- Completion releases the mat, deterministically auto-assigns the next eligible queued match without starting it, leaves an empty mat available, skips athletes live elsewhere, and recovers stale resolved assignments.
- Published draw/event immutability, multiple mats, simultaneous-athlete conflict checks, and restart recovery.
- Real WebSocket synchronization among operator, public display, and two judges, including duplicate snapshots, reconnection, and sequence-gap recovery.
- Sync full-log replay, server acknowledgement, duplicate handling, and conflict jobs never marked complete.
- Category + passing-weigh-in athlete creation → draw generation with real tournament UUID → immutable publication.

## Desktop licensing checks

- Independent temporary Ed25519 keys verify active signed licenses, payload tampering, wrong-device binding, wrong keys, malformed tokens, future/expired validity, and stable non-identifying installation codes.
- Persistent service tests verify owner-only file permissions, activation/restart recovery, rejected wrong-device/future/expired/invalid files, unchanged non-desktop behavior, and the exact expiry boundary: new work and draft tournaments are blocked while an existing `IN_PROGRESS` tournament can finish.
- A static security audit checks every Express tournament/scoring mutation for a licensing assertion, with only explicit authentication/activation/heartbeat/revocation/backup exceptions. Packaging must include verification code and refuse private keys/customer licenses.
- The owner-only runtime smoke uses the real production issuer and public key, never a test backdoor. It proves HTTP 403/`LICENSE_REQUIRED` before activation, HTTP 400 for a malformed file, HTTP 403/`LICENSE_DEVICE_MISMATCH` for another device, successful signed activation and tournament creation afterward, report export, and the same installation/license after restart.
- Chromium verifies unlicensed startup routing, responsive installation-code/request actions, file import and activation, visible wrong-device errors, active-license dashboard entry, and the 14-day renewal warning. Desktop/mobile screenshots were reviewed without horizontal overflow.
- License-delivery integration tests use independent temporary Ed25519 keys and a mock sender to verify signed device binding, exact email attachments, metadata-only persistence, owner/payment requirements, idempotency/conflicts, safe SMTP failure records, missing configuration and mismatched-key rejection. The owner-only `npm run test:license:delivery` smoke additionally verifies the real production key pair and wrong-device rejection without sending email.

## Browser checks

The Playwright suite verifies:

1. Demo login and record-derived dashboard metrics; operator +1 updates the authoritative score and public display, emits exactly one scheduled `1320 Hz` score-confirmation tone after the browser sound unlock, and the test correction restores the showcase.
2. An anonymous client receives HTTP 401 when attempting a match mutation.
3. One connected mobile judge runs with `Crypto.prototype.randomUUID` deliberately unavailable, pairs through the secure HTTP-LAN UUID fallback, sees one-judge mode, submits an immediately accepted +3, and restores the score through the audited undo path. Browser probes verify the `880/1320 Hz` accepted cue and tap/accepted vibration patterns. The same live paired session is resized through **390×844, 740×360, 768×1024, 1024×768, and 1440×900**; at every size all 10 technique buttons remain inside the viewport, no buttons overlap, and the document has no horizontal or vertical overflow.
4. Two independently paired mobile judges drive the public KPNP-style side rails: a Blue head kick first shows a pending headguard with J1 only, then confirms with J1/J2; a browser probe confirms the distinct `620 Hz` pending cue. The existing operator-added Blue trunk hit remains labelled `OPERATOR`. A pending punch shows only J1, server-window expiry removes it, and two fresh matching punches show J1/J2 with `2/3 confirmed` and +1. A second punch appends a fresh J1-only pending row while the first confirmation remains, then a third confirmed punch verifies compact three-entry history without dropping earlier entries. Two additional Blue trunk kicks reproduce seven simultaneous entries (three punches plus four head/trunk entries); bounding-box assertions prove that all seven remain inside the rail, no entries overlap, and the Gam-Jeom footer stays fully contained below them. A Red body kick adds a hogu confirmed by J1/J2. The test checks both athletes' icon counts and judge states, confirms that punches do not increment body hits, verifies both Gam-Jeom values and their footers' containment inside the rails, and restores every accepted score through audited corrections.
5. A public round-rest display shows large Blue 1 / Red 0 round wins after Blue's 5–2 Round 1 win, a decreasing `REST TIME` clock, `ROUND 1 COMPLETE`, separate Blue 5 / Red 2 points, a yellow `BLUE WINS ROUND 1` banner, and a yellow marker only on ended Round 1—not future Round 2; the test then restores the showcase.
6. A Round 1 time-out with Blue 2 / Red 7 shows those current-round points and hides the round-win/per-round summary. After expiry, rest alone switches to large Blue 0 / Red 1 round wins while Round 1 remains 2–7 with Red's marker/banner. Starting Round 2 then shows **0–0 round points** while the authoritative cumulative match total remains Blue 2 / Red 7.
7. A tied 7–7 round initially shows **AWAITING SUPERIORITY**, **SUPERIORITY REQUIRED**, 0–0 round wins, and a 30-second rest clock that remains unchanged over time. The operator records Red's superiority decision with an audit reason; the TV then starts **REST TIME** automatically and shows **RED WINS ROUND 1 · SUPERIORITY**, Red's yellow marker, and 0–1 round wins while both Round 1 point values remain 7.
8. The real 500 ms server scheduler automatically turns a six-second running round into a visible decreasing rest countdown, then recovers a paused nonfinal `0:00` fixture into a separate running 30-second rest; both are checked on the public TV, not only through domain calls.
9. After the browser-required sound unlock, a six-second TV rest shows seconds and hundredths without a minute prefix and emits five scheduled `880 Hz` warning tones plus one original competition-style dual `180/240 Hz` end buzzer; the display then reads `0.00` and `REST ENDED`, and the test restores the normal 60-second break.
10. On an independent match, Blue wins Round 1 and leads Round 2 without completing early. Ending Round 2 immediately opens the **MATCH … RESULT** view with `BLUE CORNER · ROUND WINS`, two round wins, authoritative total points, and Round 3 explicitly marked `NOT PLAYED`.
11. An independent completed `POINT_GAP` fixture with round scores 18–0 and 28–19 displays **TOTAL ROUND WINS 2–0** as the main result, keeps **Total points · Blue 46 · Red 19** secondary, preserves both round decisions, and marks Round 3 `NOT PLAYED`.
12. The fifth cumulative Gam-Jeom against Blue immediately opens a dedicated **MATCH … RESULT** view on the match-specific public display; Chromium verifies Red's `DISQUALIFICATION` win, the yellow winner banner, authoritative winner name/country, decision-aware Blue/Red result values, and total-point summary. The public mat display then automatically rolls to the next eligible queued match, whose timer remains stopped in `READY`.
13. Chromium opens the real tournament settings form, verifies the active-match save lock, saves round gap 12, match gap 18 with Round 2/Round 3 timing, Gam-Jeom +2, and disqualification at 6, reads back the `2025.1-example-r2` configuration through the authorized API, and confirms the persisted `RULESET_UPDATED` audit entry.
14. In a fresh tournament, Chromium uploads `01-clubs-test.csv`, `02-categories-test.csv`, and `03-athletes-import.csv` in order. It verifies 4 clubs and 4 categories, duplicate rejection on repeated club/category uploads, then 12 athletes with correct name-based club/category assignments, 3 passing entries per category, and 12/12 successful athlete rows.
15. An unauthenticated browser opens the public desktop download page, verifies the versioned ZIP/checksum/release links, extraction and firewall guidance, unsigned-build disclosure and persistent-data information, and checks 390 px mobile layout without horizontal overflow. The login page links to the download and, in production mode, shows blank credentials with no development-showcase button.
16. An unlicensed desktop root route opens Activation, shows the installation code and approved WhatsApp contact, preserves access to saved records, and remains within a 390 px mobile viewport.
17. Chromium imports a `.tkdlicense` file, submits its complete token to the activation endpoint, and continues to production sign-in after a valid response.
18. A wrong-device activation response remains visible on the Activation page without redirecting or reporting success.
19. An active desktop license opens the dashboard normally; a 10-day fixture displays the renewal warning and its Activation link.
20. A SUPER_ADMIN opens the private license-delivery page, validates the form, approves a paid device-bound request, sees the accepted email status and refreshed history, and remains within a 390 px mobile viewport.
21. An unconfirmed SMTP result stays visible, is recorded as FAILED, and is never presented as a successful email.
22. Missing server email secrets show a setup warning and disable the approval button.
23. A real empty mat first shows `WAITING FOR NEXT MATCH`, including a 390 px no-horizontal-overflow check. The real assignment API changes it to `WAITING FOR ROUND 1` with match/round numbers but no athlete names or score elements; the real `START` command then reveals the ordinary 0–0 scoreboard. The existing completed-match mat rollover also verifies its next READY match in waiting mode.

Reviewed screenshots:

- `artifacts/dashboard.png`
- `artifacts/public-scoreboard.png`
- `artifacts/judge-mobile.png`
- `artifacts/judge-single-mobile.png`
- `artifacts/judge-controller-live-phone-portrait.png`
- `artifacts/judge-controller-live-phone-landscape.png`
- `artifacts/judge-controller-live-tablet-portrait.png`
- `artifacts/judge-controller-live-tablet-landscape.png`
- `artifacts/judge-controller-live-desktop.png`
- `artifacts/judge-punch-pending-display.png`
- `artifacts/punch-round-history-display.png`
- `artifacts/kpnp-style-scoring-activity-display.png`
- `artifacts/gam-jeom-rail.png`
- `artifacts/round-break-display.png`
- `artifacts/timeout-round-points-display.png`
- `artifacts/red-round-win-display.png`
- `artifacts/next-round-zero-display.png`
- `artifacts/superiority-awaiting-display.png`
- `artifacts/superiority-round-display.png`
- `artifacts/automatic-round-rest.png`
- `artifacts/automatic-paused-zero-rest.png`
- `artifacts/timer-hundredths-round.png`
- `artifacts/timer-hundredths-countdown.png`
- `artifacts/timer-audio-rest-end.png`
- `artifacts/automatic-two-round-win-display.png`
- `artifacts/point-gap-total-round-wins-result.png`
- `artifacts/gam-jeom-disqualification-display.png`
- `artifacts/csv-import-athletes.png`
- `artifacts/point-gap-settings.png`
- `artifacts/empty-mat-waiting-display.png`
- `artifacts/empty-mat-waiting-mobile.png`
- `artifacts/ready-match-waiting-display.png`
- `artifacts/desktop-download-page.png`
- `artifacts/desktop-download-mobile.png`
- `artifacts/desktop-activation-unlicensed.png`
- `artifacts/desktop-activation-mobile.png`
- `artifacts/dashboard-license-renewal.png`
- `artifacts/license-email-delivery.png`
- `artifacts/license-email-delivery-mobile.png`

No browser page errors were observed in the dashboard/operator test.

## Desktop and portable-package checks

- Supervisor fault-injection tests start both services, verify graceful IPC shutdown, simulate launcher heartbeat loss, and stop the sibling service when one runtime exits. LAN selection tests reject public/loopback pairing addresses and deduplicate/private-sort usable IPv4 addresses.
- UUID compatibility tests cover native `randomUUID`, deterministic RFC v4 bytes through `getRandomValues`, 200 unique fallback IDs, and a useful error when secure randomness is unavailable. The real mobile-judge Chromium scenario also disables `randomUUID` before pairing and scoring.
- The optimized production supervisor smoke rejects pre-activation and wrong-device operations, issues/imports a real Ed25519-signed license through the owner-only CLI, creates a real organization/tournament and exports a report through HTTP, checks the download/activation pages and loopback-only runtime identity route, closes both services, then restarts against the same SQLite/license paths and verifies the tournament, authentication session, installation code and active license survive.
- The actual Electron 45 launcher was also executed on Linux under Xvfb with the real optimized application. It automatically opened the local operator, reported `RUNNING` through the isolated preload IPC, responded to **Ctrl+Shift+L**, started matching Express/Next.js instances, created a tournament, shut down cleanly with exit code 0, and preserved that tournament/session across a second full Electron launch and shutdown.
- The Windows packaging script produced `TKD-Scoring-Windows-x64.zip`, extracted it again, and validated the EXE, bundled Node runtime, Windows `tsx`/esbuild, optimized Next.js output, migration and Windows SQLite prebuild. Native modules were checked as PE32+ x64; environment files, tournament databases, and transient Next.js development/compiler output were rejected. The Node archive was verified against official Node.js SHA-256 sums and the SQLite prebuild against pinned reviewed hashes.
- The large ZIP and extracted staging directories are not tracked by Git. The release uses a separate `.sha256` asset so the package does not embed a self-invalidating hash.

## Runtime and recovery checks

- Health, authentication, bootstrap metrics, public data minimization, CSV, and PDF endpoints were smoke-tested against the running production preview.
- Public responses were checked to exclude athlete DOB and club contact email.
- Actual process recovery restored the showcase at blue 12, red 8, round 3 in `PAUSED` state.
- A subsequent graceful-stop drill logged the running match as paused/persisted before close; after restart the timer difference reflected only the stop-call interval (under three seconds), not server downtime.
- `npm run backup -- /tmp/tkd-backup-test.db` completed using SQLite online backup and integrity verification.
- `npm run check:database -- /tmp/tkd-backup-test.db` previously reported migration 1, integrity ok, and foreign keys ok; the separate migration validator now passes migration 2.

## Not verified / not claimed
- Real Gmail/SMTP delivery has not been attempted. Email tests use a mock sender; production app-password configuration, hosted secrets, Northflank deployment of this branch, inbox/spam placement and client receipt remain unverified. `SENT` means only that an SMTP service accepted a message.

- The Windows x64 artifact was cross-packaged and statically validated on Linux, but **not executed on a physical Windows 10/11 machine**. Windows Explorer extraction, SmartScreen, Firewall prompts, win32 process-tree termination, real Windows LAN pairing, Windows MachineGuid/registry fallback behavior, physical license activation/device transfer, and the complete no-Node-installed Windows workflow still require the checklist in `docs/DESKTOP.md`. Linux Electron execution is not represented as Windows verification.
- No hosted Supabase project was available. Hosted Auth, Realtime, Storage, project default privileges, and production cloud deployment remain unverified. PostgreSQL validation used local Supabase-compatible `auth`/`storage` stubs, not the hosted service.
- Full cloud workflow parity, complete snapshot provisioning, and bidirectional conflict resolution are not complete.
- Dedicated completed-result correction with safe downstream bracket reversal is not complete.
- No PSS sensor or IVR hardware integration was tested or claimed.
- No genuine Android server runtime/background-hosting implementation was tested or claimed.
- Included scoring and repechage settings remain examples requiring validation against each event's adopted regulations.
