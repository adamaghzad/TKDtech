# Tournament operations and recovery

## Before the event

1. Use a fresh production database with `SEED_DEVELOPMENT=false` and `ALLOW_DEMO_LOGIN=false`.
2. Verify the ruleset, scoring values, consensus threshold/window, timer durations, disqualification threshold, Golden Point behavior, and repechage policy with the event's officials.
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

## Authoritative scoring rules

- Only the server accepts scores and transitions. The browser never decides consensus or the final winner.
- Commands carry `expectedVersion` and an idempotency key. A stale operator must reload rather than overwrite a newer match.
- A judge proposal is not itself a point. The configured number of distinct judge sessions must agree within the configured window.
- In two-judge mode, repeated input from one judge cannot satisfy consensus or award duplicate points. In one-judge mode, each deliberate unique proposal is accepted once; retries remain idempotent.
- Persist the event and match transaction first; only then acknowledge/broadcast.
- Corrections require a reason and create new audit/history records. Never edit the database to erase a published mistake.

## Process restart and power recovery

Running timers are deliberately changed to a confirmation-safe paused state during recovery. A graceful shutdown persists the paused remaining time before the database closes; after an abrupt crash, officials must verify the recovered timer against their own records. After a restart:

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
| `WEB_UNAVAILABLE` | Ensure Next.js is running on internal port 3001 and `WEB_INTERNAL_URL` points to it |
| LAN device cannot connect | Host firewall, Wi-Fi client isolation, correct interface/IP, port 3000, and that all devices use the same LAN |
| Judge buttons disabled | Session status/expiry, heartbeat presence, match state, and whether the referee/operator started the round |
| Points not accepted | Need distinct judge agreement; inspect rejected/expired proposal reason and server event history |
| `MATCH_VERSION_CONFLICT` | Reload the authoritative snapshot; do not bypass expected versions |
| WebSocket sequence gap | Client automatically requests a full snapshot; inspect network if repeated |
| Demo login returns 404 | `ALLOW_DEMO_LOGIN` is disabled, correctly for production |
| Fresh production has no showcase | Expected: `SEED_DEVELOPMENT` is false; register an organization instead |
| Cloud conflict | Leave the job conflicted, compare per-match cloud/local sequences, and provision/reconcile explicitly; never mark it complete manually |

## Emergency priorities

Preserve the database and logs first. Use the local server as the event authority if Internet fails. Do not switch mid-match to a separate cloud/local authority without an explicit reconciliation decision by the tournament administrator.
