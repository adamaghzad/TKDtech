# Local HTTP and WebSocket API

Base URL: the local server origin, normally `http://HOST:3000`. Successful responses use `{ "data": ... }`; errors use `{ "error": { "code", "message", "details?" } }`.

## Authentication

```http
POST /api/v1/auth/login
Content-Type: application/json

{"email":"user@example.com","password":"your-password"}
```

The server sets an `HttpOnly`, `SameSite=Lax` session cookie. Logout is `POST /api/v1/auth/logout`; current identity is `GET /api/v1/auth/me`. Organization registration is `POST /api/v1/auth/register` with `name`, `fullName`, `email`, and a password of at least ten characters.

`POST /api/v1/auth/demo` exists only when `ALLOW_DEMO_LOGIN=true` and returns 404 otherwise.

Example authenticated request:

```bash
curl -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","password":"your-password"}' \
  http://127.0.0.1:3000/api/v1/auth/login
curl -b cookies.txt http://127.0.0.1:3000/api/v1/bootstrap
```

## Main endpoints

| Method/path | Purpose/access |
|---|---|
| `GET /api/v1/health` | Process, mode, database, server time |
| `GET /api/v1/bootstrap` | Authenticated dashboard metrics and selected records |
| `GET /api/v1/public/tournaments` | Published public tournament list |
| `GET /api/v1/public/tournaments/:id` | Minimal public detail; draft/cancelled tournaments return 404 |
| `GET /api/v1/public/tournaments/:id/live` | Public live-match IDs |
| `GET/POST /api/v1/tournaments` | List/create authorized tournaments |
| `GET /api/v1/tournaments/:id` | Authorized full administration detail |
| `PATCH /api/v1/tournaments/:id/status` | Administrator status/completion/cancellation transition |
| `POST /api/v1/tournaments/:id/clubs` | Registration write permission |
| `POST /api/v1/tournaments/:id/categories` | Tournament administrator |
| `POST /api/v1/tournaments/:id/athletes` | Registration, category, duplicate, seed, and weigh-in validation |
| `POST /api/v1/categories/:id/draws` | Generate random/seeded draw from eligible passing entrants |
| `POST /api/v1/draws/:id/publish` | Freeze draw version and create bracket/matches |
| `GET /api/v1/categories/:id/bracket` | Authorized bracket graph |
| `POST /api/v1/matches/:id/assign` | Mat assignment and athlete/mat conflict validation |
| `GET /api/v1/mats/:id/active-match` | Mat's active match ID |
| `GET /api/v1/matches/:id` | Snapshot; public or authorized according to tournament state |
| `GET /api/v1/matches/:id/events` | Authorized event history |
| `POST /api/v1/matches/:id/commands` | Authorized operator/referee command |
| `POST /api/v1/matches/:id/pairing` | Operator-issued short-lived role QR/token |
| `POST /api/v1/pairing/exchange` | Single-use token exchange for device credential |
| `GET /api/v1/device/session` | Device credential session/snapshot |
| `POST /api/v1/device/heartbeat` | Presence heartbeat |
| `POST /api/v1/judge/proposals` | Corner-judge scoring proposal |
| `POST /api/v1/referee/commands` | Restricted referee device command |
| `GET /api/v1/judges?matchId=UUID` | Authorized sessions/presence |
| `DELETE /api/v1/sessions/:id` | Authorized session revocation |
| `GET /api/v1/audit?tournamentId=UUID` | Authorized audit records |
| `GET /api/v1/reports/:type.csv?...` | Authorized CSV report |
| `GET /api/v1/reports/:type.pdf?...` | Authorized PDF report |
| `GET /api/v1/network/status` | Authenticated LAN/cloud/sync status |
| `POST /api/v1/sync/push` | Tournament-admin event-log delivery; see cloud limitations |

## Registration CSV imports

The administration UI provides client-side CSV import for clubs, categories, and athletes using the existing authorized `POST /api/v1/tournaments/:id/clubs`, `/categories`, and `/athletes` endpoints. Each row is a separate validated API request; up to 500 rows are attempted, and row failures are reported without silently overwriting records. Club/category names and athlete name/birth-date duplicates are rejected.

For athletes, `clubId` and `categoryId` accept tournament-owned UUIDs. Alternatively, `clubName` and `categoryName` resolve existing records case-insensitively in the administration client before the API request. Import clubs and categories before referencing their names. The synthetic end-to-end test pack is stored in `csv-import-test/`.

## Mat queue lifecycle

Completing a match, recording a walkover, or reaching the Gam-Jeom disqualification threshold releases its active mat assignment in the same transaction as result finalization and bracket advancement. The server deterministically assigns the next eligible `PENDING`/`READY` match by queue position and match number, skipping matches with athletes in another live match. The newly assigned match remains stopped in `READY`; an operator or referee must start it explicitly. If no eligible match remains, the mat becomes `AVAILABLE`.

Server startup reconciles stale active assignments left on resolved matches through the same recovery path. `/display/mat/:matId` checks the assignment every three seconds, switches the read-only display when the active match changes, and shows a waiting state when the mat is available.

## Round and rest lifecycle

The server checks authoritative running timers every 500 ms and persists expiry before broadcasting the new snapshot. When a nonfinal round expires without producing an automatic two-round match win, it records that round's winner/end time and enters `ROUND_BREAK`. Non-tied rounds start the category-configured break immediately; a tied round under the round-win policy persists a `SUPERIORITY` hold with the full break duration instead. A nonfinal round found paused at zero is reconciled through the same expiry path; final-round zero without a two-round winner remains paused. The public display shows the rest clock and the just-completed round's blue/red points and winner. Scoring remains closed throughout the break.

Under `ROUND_WINS`, the server counts only ended rounds through the round just resolved. Two wins by one athlete immediately produce `state='COMPLETED'`, `decisionMethod='ROUND_WINS'`, a stopped timer, and the normal transactional result/bracket/mat finalization. This applies to manual `NEXT_ROUND`, `TIMER_EXPIRED` (including final-round expiry), and `ROUND_SUPERIORITY`; no additional rest or third round starts. The completion event payload includes the round result and `matchResult` with both round-win counts. Unfinished-round score leads and unresolved ties do not count.

During rounds and ordinary time-outs, the live display's large Blue/Red values are the current round's authoritative points. A new round therefore starts at 0–0 even though cumulative match totals remain stored for decisions and results. Only `BREAK` switches to the after-round summary: large values count ended-round wins through `currentRound - 1`, and per-round points/winner markers appear separately. Future rounds cannot contribute.

For round-win results, an ended round with equal points requires an authorized `ROUND_SUPERIORITY` decision before rest or the next round can resume. Until then, the break remains paused with `timer.holdReason='SUPERIORITY'`; the scheduler also holds any legacy running unresolved break, and reset/recovery paths cannot clear the requirement. The referee/operator supplies the officials' winning `side` and an audit `reason`. The server accepts it only for the just-ended tied round during rest or the final-round zero pause, stores `SUPERIORITY` on the round, rejects attempts to overwrite an existing winner, and automatically starts the held rest after a nonfinal decision unless that winner has just secured a second round win, which instead completes the match immediately. The application records the officials' outcome rather than calculating technical/PSS superiority itself.

When the break reaches zero it stays in `ROUND_BREAK`; it never starts the next round automatically. An operator or referee must explicitly start it. `NEXT_ROUND` from a paused round ends that round and starts the break; during a break it skips the remaining rest and starts the next round. `RESUME` resumes a paused break, or starts the next round when the break is running/expired. Final-round expiry pauses at zero without creating an extra round or break.

A completed or disqualified match-specific public display renders a dedicated result view from the snapshot's `winner`, `decisionMethod`, athlete, score, and round records. Its main Blue/Red values show ended-round wins unless `decisionMethod` is `TOTAL_POINTS`, in which case they show the authoritative cumulative points. The other total and per-round values remain visible for verification.

## Match commands

`GAM_JEOM` requires the penalized `side` and is accepted only during active/paused scoring states. It appends one penalty and awards the configured opponent points. If the penalized side reaches the cumulative `disqualificationThreshold`, the same transaction pauses the timer, sets `state='DISQUALIFIED'`, records the opponent with `decisionMethod='DISQUALIFICATION'`, and runs normal result/bracket/mat finalization. The penalty event payload includes `automaticDisqualification`, `totalPenalties`, `disqualificationThreshold`, and the winner. Replaying the same idempotency key returns the resolved snapshot without another penalty or result.

```http
POST /api/v1/matches/MATCH_UUID/commands
Authorization: session cookie
Idempotency-Key: 3d6b16f4-4c07-4bb0-a1f9-60bd825dd08c
Content-Type: application/json

{"type":"SCORE","side":"BLUE","pointType":"BODY_KICK","expectedVersion":17}
```

Command types:

- `START`, `PAUSE`, `RESUME`;
- `RESET_TIMER` (reason required);
- `NEXT_ROUND`, `PREVIOUS_ROUND` (previous-round correction requires administrator and reason);
- `SCORE` with `side` and `pointType`, or operator manual `points` adjustment;
- `GAM_JEOM` with `side`;
- `MEDICAL_TIMEOUT`, `VIDEO_REVIEW`, `END_REVIEW`;
- `ROUND_SUPERIORITY` with the officials' winning `side` and an audit `reason` for an ended tied round;
- `COMPLETE`, `WALKOVER`;
- `UNDO` with a reason for a reversible nonfinal scoring event.

Every mutating operator command should include the latest `expectedVersion` and a unique `Idempotency-Key`. Reusing a key with the same command returns the stored outcome; stale versions and different reuse are rejected rather than overwriting current state.

Point types are `BODY_PUNCH`, `BODY_KICK`, `HEAD_KICK`, `TURNING_BODY_KICK`, and `TURNING_HEAD_KICK`. Values come from the tournament's configured ruleset.

Completed results cannot be undone through this generic command. A dedicated completed-result correction/progression-reversal workflow is remaining work; do not alter published results directly in SQLite.

## Judge proposal

Exchange a pairing token before submitting. Proposal body follows `scoreProposalSchema`:

```json
{
  "eventId": "UUID",
  "matchId": "UUID",
  "roundId": "UUID",
  "judgeSessionId": "UUID",
  "side": "BLUE",
  "pointType": "HEAD_KICK",
  "submittedAt": 1792830000000,
  "sequence": 1,
  "idempotencyKey": "unique-random-key"
}
```

Send the device credential as `Authorization: Bearer DEVICE_TOKEN`. The session must belong to the match and judge role. Scoring is accepted only in a live scoring state.

`submittedAt` is the device-reported timestamp used for diagnostics. The server replaces it with its own receipt time when evaluating proposal expiry and the consensus window, so unsynchronized phone clocks cannot reject an otherwise valid proposal. Delivery retries remain protected by event IDs, idempotency keys, and per-judge sequences.

Consensus switches automatically from fresh corner-judge presence. With exactly one online judge, that authorized judge's proposal is accepted immediately in `ONE_JUDGE_MODE`. When two or more judges are online, matching proposals from two distinct judges are required inside the configured window. A submitting device is marked live before its threshold is evaluated; stale presence does not count. Reconnecting a second judge restores two-judge consensus, and accepted decisions remain idempotent.

Proposal responses include non-sensitive `diagnostics`: server receipt time, configured window, effective threshold, online/matching judge counts, active scoring mode, and the number of earlier matching proposals that expired before arrival. These fields explain pending and accepted responses without exposing device credentials.

## WebSockets

Connect to `/ws?matchId=MATCH_UUID`. Public display connections receive only display-safe snapshots. Operator connections use the same session cookie. Device connections use their assigned credential flow.

Envelope:

```json
{
  "schemaVersion": 1,
  "eventId": "UUID",
  "tournamentId": "UUID",
  "matchId": "UUID-or-null",
  "serverTimestamp": 1792830000000,
  "sequence": 42,
  "actorId": "UUID-or-null",
  "type": "match.snapshot",
  "payload": {}
}
```

Clients track sequence per match. Duplicate/old envelopes are ignored; a gap triggers an HTTP snapshot fetch. Reconnection always requests a fresh snapshot. The server commits state before broadcasting.

## Rate limits and CSRF

Authentication and proposal endpoints have dedicated rate limits. Cookie-authenticated mutations with an `Origin` header must match the request host. Use JSON content types and same-origin browser clients. Public callers cannot mutate matches even if they know UUIDs.
