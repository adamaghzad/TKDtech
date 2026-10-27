# Tournament operations and recovery

## Before the event

1. Use a fresh production database with `SEED_DEVELOPMENT=false` and `ALLOW_DEMO_LOGIN=false`.
2. Verify the ruleset, scoring values, consensus threshold/window, timer durations, disqualification threshold, round/match point-gap thresholds and timing, Golden Point behavior, and repechage policy with the event's officials. Configure point gap under **Rules & status** before active matches; the control is tournament-wide, so any senior semifinal/final exclusion must be handled by the adopted event configuration rather than assumed.
3. Run `npm run check`, `npm run validate:supabase` if cloud is used, and `npm run test:e2e` on the actual host where possible.
4. Connect host, operator, judge/referee devices, and TV to the same dedicated LAN. Prefer wired host/TV connections and a reserved DHCP address.
5. Open the host's LAN address, not `localhost`, on every other device.
6. Create and publish a test draw in a nonofficial tournament, pair all roles, submit duplicate and distinct proposals, restart the host, and verify paused-timer recovery.
7. Take a backup and test restoring it to a separate path.

## Pairing and replacement

- Generate a role-specific QR from **Judges & Referees** or the operator console.
- Tokens are short-lived and single-use. Replacement requires explicit operator action and revokes the previous role session.
- Do not print long-term judge tokens on public brackets or send them to the TV display.
- Presence comes from heartbeat timestamps, not from a stale socket label. Expired devices must reconnect/heartbeat before being considered online.
- If a phone sleeps, reopen the session URL. Revoke and re-pair if its session expired or was replaced.
- Corner judges use a responsive controller layout with all five techniques for each athlete: landscape places Head above, Body in the large center, Punch below, and turning techniques at the sides; portrait stacks the primary controls and keeps turning techniques on the bottom row. The layout preserves fixed touch zones without horizontal overflow at tested phone, tablet, and desktop sizes.
- Judge feedback includes an immediate tap response plus distinct visual, vibration, and Web Audio cues for pending, accepted, and rejected server responses. Vibration and audio depend on device/browser support; test the actual judge devices and keep their pages open. Feedback never awards a point by itself—the authoritative server response and consensus policy remain decisive.

## Match and timer audio

At 10 seconds and above, match and rest clocks retain the `M:SS` display. Below 10 seconds they show seconds and hundredths without a minute prefix (for example `9.85`), and expiry reads `0.00`. TV, operator, dashboard, and judge/referee clocks use the same formatter and the server's authoritative remaining milliseconds; no independent browser countdown was introduced. The existing 100 ms display refresh and authoritative expiry behavior are unchanged.

The public TV and operator scoreboard provide a clearly visible per-device sound control. Browsers require one tap on **Enable sound** after opening/reloading the page before audio can play. An authoritative blue/red score increase emits one short `1320 Hz` confirmation after the server accepts it; a judge tap alone, initial page load, duplicate snapshot, or score-lowering undo does not emit that confirmation. Round and rest timers emit short `880 Hz` beeps at 5, 4, 3, 2, and 1 seconds and an original competition-style dual `180/240 Hz` buzzer for 1.1 seconds at zero. This is not a proprietary PSS sound or a claim of hardware equivalence. Tones are generated locally with Web Audio and work without Internet access. Verify the TV/operator speakers before the event; audio is supplementary and never changes the authoritative score or timer.

## Round and match result displays

- During rounds and ordinary mid-round time-outs, the large Blue/Red numbers are **current-round points**. Every new round starts at **0–0**; cumulative match totals remain stored for decisions and final results. The round-win summary is not shown in these phases.
- Only after-round rest shows large **ended-round wins** plus the R1/R2/R3 points near the top. Wins count only through `currentRound - 1`, so upcoming rounds cannot contribute; for example, Red winning Round 1 by 7–2 produces a large Blue 0 / Red 1 rest score. The center panel keeps the completed round's points and shows a yellow round-winner banner; future rounds never receive a winner marker.
- If a round ends with equal points under the round-win policy, the TV shows **AWAITING SUPERIORITY** and **SUPERIORITY REQUIRED**. The rest clock holds at its full duration, and neither rest resume nor next-round startup is allowed. An authorized referee/operator records the officials' final Blue/Red decision with an audit reason; that persisted decision releases the hold and starts the rest countdown automatically unless it gives that athlete a second round win, in which case the match completes immediately. Equal points stay unchanged, and the selected athlete receives the round win, yellow marker, and superiority banner. An existing decision cannot be overwritten through this action.
- Event officials remain responsible for their adopted technical/PSS/superiority procedure. The application records the final decision; it does not infer PSS hits, simulate officials' votes, or claim hardware equivalence.
- Athlete side rails show current-round head/body kicks and punches with separate technique entries. Every judge-scored head, trunk, or punch keeps its own J1–J3 pending/confirmed states; new attempts append without hiding earlier confirmations. Operator-added kicks are labelled `OPERATOR` and never receive fabricated judge votes. At five or more simultaneous techniques, the rail uses compact horizontal rows to retain every entry and judge/operator state without overlapping or clipping the Gam-Jeom footer. Punches do not increment head/body hit counts. Server-persisted expiry and append-only corrections remove only the corresponding entry while other confirmed activity remains. Each cumulative Gam-Jeom count uses a centered, yellow-accent footer inside the rail rather than sitting behind it. These are operator/judge record visualizations, not protector-sensor readings.
- A completed or disqualified match-specific display (`/display/:matchId`) switches to a dedicated **MATCH … RESULT** screen with a yellow **WINNER** banner, the winner's corner color, flag, name, country, decision method, and round-by-round points.
- The large Blue/Red result values are round wins for round-win and Golden Point decisions, or total points for total-points and match `POINT_GAP` decisions. Cumulative Blue/Red points remain visible separately; values always come from the authoritative completed snapshot.
- Mat displays retain their automatic next-match assignment behavior. The completed match's direct display URL remains available on its result screen.

## Authoritative scoring rules

- Only the server accepts scores and transitions. The browser never decides consensus or the final winner.
- Commands carry `expectedVersion` and an idempotency key. A stale operator must reload rather than overwrite a newer match.
- A judge proposal becomes a point only under the active consensus policy: one fresh online corner judge can score alone; two or more online judges require two distinct matching proposals inside the configured window.
- In two-judge mode, repeated input from one judge cannot satisfy consensus or award duplicate points. In one-judge mode, each deliberate unique proposal is accepted once; retries remain idempotent.
- Under the round-win policy, an athlete who secures **two ended rounds** wins the match immediately. The server checks this after operator round end, authoritative timer expiry, and an authorized superiority decision. It records `COMPLETED` with `ROUND_WINS`, stops the timer, persists the result, advances the bracket, and releases/advances the mat without starting another rest or round. A leading score in an unfinished round does not count as a round win; unresolved tied rounds still require their authorized procedure.
- **Configurable round point gap:** when enabled, the server compares only the active round after operator scores, accepted judge consensus, and Gam-Jeom opponent points. At the configured difference it stops the round, records its winner and `POINT_GAP`, then follows normal rest/two-round-win behavior. With a threshold of 15, 14–0 continues and 15–0 ends the round. The accepted scoring event and subsequent point-gap decision are separate persisted history records.
- **Configurable match point gap:** when enabled, the server compares cumulative match points at the configured completed round and/or immediately from the configured live round. A match ending this way records `COMPLETED` with decision `POINT_GAP`, stops the timer, persists the official result, advances the bracket, and releases/advances the mat. The example 20-point policy checks at the end of Round 2 and live from Round 3. At round completion, match gap takes priority over ordinary two-round-win finalization; disqualification retains priority over both gap rules.
- Ruleset saves cover point gap plus Gam-Jeom opponent points/disqualification threshold. They require a tournament administrator, create a new version and `RULESET_UPDATED` audit record, reject stale versions, and are rejected while any tournament match is active. Omitted legacy point-gap fields remain disabled. Thresholds/timing are tournament-wide, not per-category or per-stage overrides; verify the event outline and any exclusions before official use.
- Each Gam-Jeom adds one penalty to the penalized athlete and the configured points (default +1, configurable 0–20) to the opponent. These opponent points participate in round/match gap evaluation. When the athlete's cumulative match penalty count reaches the configured threshold (default **5**, configurable 1–100), that same server transaction stops the timer, sets `DISQUALIFIED`, records the opponent as winner by `DISQUALIFICATION`, persists the official result, advances the bracket, and releases/advances the mat. Further scoring is closed; correcting the resolved result requires the dedicated authorized correction workflow rather than generic undo.
- Persist the event and match transaction first; only then acknowledge/broadcast.
- Corrections require a reason and create new audit/history records. Never edit the database to erase a published mistake.

## Portable Windows desktop operations

For the portable app, extract the complete official Windows x64 ZIP and run `TKD Scoring.exe`; never run it inside the ZIP or move the EXE away from `resources`. No Node.js/npm setup is needed. The launcher starts the same Express/Next.js/SQLite/WebSocket system and opens the operator only after readiness. Register a real organization—desktop demo access is disabled.

- Press **Ctrl+Shift+L** in the operator window for detected LAN addresses, startup state, retry, data and logs.
- The database is `%APPDATA%\TKD Scoring\data\tkd-scoring.db`; logs are under `%APPDATA%\TKD Scoring\logs`.
- Keep ports `3000` and `3001` free. Separate venue devices use the PC's LAN address on port `3000`, never the loopback-only `3001` port.
- Allow private/local network access if Windows Firewall requests it, and check Wi-Fi client isolation. Do not expose the local port directly to the Internet.
- The portable release is unsigned; expect possible SmartScreen/unknown-publisher warnings and verify the separate release SHA-256 before running.
- Close the app before copying the whole data folder for backup. Replacing the portable folder does not intentionally delete per-user data.
- Normal close uses supervised shutdown; heartbeat and per-instance identity checks handle launcher loss and orphan cleanup. After any abrupt failure, verify recovered match/timers with officials before resuming.

See [Desktop operation and packaging](DESKTOP.md) for updates, release verification, and the required physical-Windows checklist.

## Process restart and power recovery

Running timers are deliberately changed to a confirmation-safe paused state during recovery. A graceful shutdown persists the paused remaining time before the database closes; after an abrupt crash, officials must verify the recovered timer against their own records. A nonfinal round already at zero is treated as expired and automatically enters rest; non-tied rounds start counting down, while an unresolved tied round keeps its superiority hold. Final-round zero without a two-round winner remains paused for the result workflow. After a restart:

1. Open the operator console for every previously live match.
2. Confirm athletes, round, score, penalties, and remaining time against officials' records.
3. Reconnect judges/referees and confirm presence.
4. Resume only after the center referee/operator confirms the recovered state.
5. Investigate any rejected sequence or version conflict rather than forcing a browser retry loop.

SQLite uses WAL and foreign keys. Match advancement occurs in the same transaction as result finalization, so a destination cannot be advanced twice after a completed match without an authorized correction path.

## Online backup

While the service is running:

```bash
TKD_DATABASE_PATH=/var/lib/tkd-scoring/tournament.db \
npm run backup -- /var/backups/tkd-scoring/event-2026-10-24.db
```

The command uses SQLite's online backup API and then opens the copy read-only for `PRAGMA integrity_check`. It prints the final path only after the check passes. Copy that backup to encrypted, off-host storage and restrict access to it.

Do not copy only the active `.db` file while SQLite is running; WAL content may not be in that file.

## Restore drill

Stop the service first. Preserve the existing database for investigation, then restore to a new path:

```bash
sudo systemctl stop tkd-scoring
sudo cp /var/lib/tkd-scoring/tournament.db /var/lib/tkd-scoring/tournament.pre-restore.db
sudo cp /var/backups/tkd-scoring/event-2026-10-24.db /var/lib/tkd-scoring/tournament.restored.db
sudo chown tkd:tkd /var/lib/tkd-scoring/tournament.restored.db
npm run check:database -- /var/lib/tkd-scoring/tournament.restored.db
```

The restored-file check verifies integrity, foreign-key violations, and schema migration version. Start the service against the restored path, verify record counts and the latest audit/event IDs, then resume operations.

For a whole-file offline restore, also remove stale `-wal` and `-shm` sidecars associated with the replaced database only after the service is stopped and a safety copy exists.

## Registration CSV imports

Open the tournament's **Clubs**, **Categories**, or **Athletes** section and use **Import CSV**. For related test data, import in this order: clubs → categories → athletes. The ready-to-use synthetic pack is in `csv-import-test/` and creates 4 clubs, 4 categories, and 12 assigned athletes with passing weigh-ins.

- Club headers: `name,country,countryCode,headCoach,contactEmail`.
- Category headers: `name,division,ageGroup,minWeightKg,maxWeightKg` plus optional `format,rounds,roundDurationSeconds,breakDurationSeconds,goldenPointPolicy,repechagePolicy`.
- Athlete headers support `clubId`/`categoryId` UUIDs or `clubName`/`categoryName`. Names are matched case-insensitively within the tournament, so clubs/categories must exist first.
- UTF-8 BOM, CRLF, quoted commas, escaped quotes, and quoted newlines are supported. At most 500 data rows are attempted per file.
- Rows are validated independently through the existing authorized APIs. The summary reports imported/rejected counts and the first error. Existing club/category names and athlete name/birth-date duplicates are rejected rather than overwritten or duplicated.

## Reports

CSV and PDF endpoints require an authenticated authorized session. Available report types are `athletes`, `clubs`, `categories`, `schedule`, `results`, `medals`, and `audit`.

Open **Tournament → Reports** or request:

```text
/api/v1/reports/results.pdf?tournamentId=UUID
/api/v1/reports/results.csv?tournamentId=UUID
```

Do not expose club contacts or full registration exports on the public TV browser.

## Troubleshooting

| Symptom | Check |
|---|---|
| Rest stays at `0.00` before the next round | Confirm the deployed health includes `pausedZeroRecovery: NON_FINAL_ROUND_TO_BREAK`; a nonfinal paused-zero round should enter rest within 500 ms. At genuine rest expiry, `0.00 · REST ENDED` is expected and the operator/referee must start the next round. |
| Desktop does not open the operator | Extract the whole ZIP, keep `resources` beside the EXE, free ports 3000/3001, then open **Ctrl+Shift+L → Open logs**; use Retry after correcting the cause |
| Windows warns about the desktop publisher | This portable release is unsigned; verify the official release SHA-256 and source before proceeding |
| Desktop LAN pairing is unavailable | Check the status panel for a private LAN address, reconnect the PC to the venue network and restart; verify firewall/client isolation |
| `WEB_UNAVAILABLE` | Ensure Next.js is running on internal port 3001 and `WEB_INTERNAL_URL` points to it |
| LAN device cannot connect | Confirm the current hotspot IP and issue a new QR after network changes; use a Private network profile, allow bundled `node.exe`/TCP 3000, and check Wi-Fi client isolation. “No internet connection” alone is normal on an offline LAN |
| `crypto.randomUUID is not a function` while pairing | Fixed in desktop **1.0.1**: plain-HTTP LAN browsers use secure `getRandomValues()` event IDs. Install the new portable release, then issue a fresh QR; do not disable browser security features |
| Judge buttons disabled | Session status/expiry, heartbeat presence, match state, and whether the referee/operator started the round |
| Points not accepted | Need distinct judge agreement; inspect rejected/expired proposal reason and server event history |
| `MATCH_VERSION_CONFLICT` | Reload the authoritative snapshot; do not bypass expected versions |
| WebSocket sequence gap | Client automatically requests a full snapshot; inspect network if repeated |
| Demo login returns 404 | `ALLOW_DEMO_LOGIN` is disabled, correctly for production |
| Fresh production has no showcase | Expected: `SEED_DEVELOPMENT` is false; register an organization instead |
| Cloud conflict | Leave the job conflicted, compare per-match cloud/local sequences, and provision/reconcile explicitly; never mark it complete manually |

## Emergency priorities

Preserve the database and logs first. Use the local server as the event authority if Internet fails. Do not switch mid-match to a separate cloud/local authority without an explicit reconciliation decision by the tournament administrator.
