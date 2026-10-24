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

## Mat queue lifecycle

Completing a match or recording a walkover releases its active mat assignment in the same transaction as result finalization and bracket advancement. The server deterministically assigns the next eligible `PENDING`/`READY` match by queue position and match number, skipping matches with athletes in another live match. The newly assigned match remains stopped in `READY`; an operator or referee must start it explicitly. If no eligible match remains, the mat becomes `AVAILABLE`.

Server startup reconciles stale active assignments left on resolved matches through the same recovery path. `/display/mat/:matId` checks the assignment every three seconds, switches the read-only display when the active match changes, and shows a waiting state when the mat is available.

## Match commands

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

`submittedAt` is the device-reported timestamp used for diagnostics. The server replaces it with its own receipt time when evaluating proposal expiry and the consensus window, so unsynchronized phone clocks cannot reject an otherwise valid proposal. Delivery retries remain protected by event IDs, idempotency keys, and per-judge sequences. Both judges' requests must still arrive inside the configured consensus window.

New proposal responses include non-sensitive `diagnostics`: server receipt time, the configured window/threshold, matching judge count, and the number of earlier matching proposals that expired before arrival. These fields explain pending responses; they do not relax consensus or alter scoring policy.

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
