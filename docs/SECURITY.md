# Security, roles, and data boundaries

## Role model

| Role | Intended authority |
|---|---|
| `SUPER_ADMIN` | Organization-wide administration and assigned tournament operations |
| `TOURNAMENT_ADMIN` | Tournament/category/draw administration, match control, pairing, reports, sync requests |
| `REGISTRATION_MANAGER` | Club/athlete registration and passing weigh-in records; cannot publish draws or control matches |
| `MAT_OPERATOR` | Mat assignment, match/timer/scoring controls, device pairing; privileged previous-round correction remains administrator-only |
| `REFEREE` | Restricted device commands: start/pause/resume, penalties, medical/video review, completion |
| `CORNER_JUDGE` | Signed assigned-session scoring proposals only |
| `PUBLIC_VIEWER` | Read-only public tournament/display data |

Server checks include both role and tournament membership/assignment. Client navigation is not an authorization control. Test coverage includes allowed and denied role actions.

## Authentication and sessions

- Local passwords use the repository's salted password hashing implementation; plaintext passwords are not stored.
- Browser auth tokens and device/pairing tokens are random opaque credentials stored as hashes.
- Pairing tokens are single-use and expire. Role replacement revokes the previous session.
- Logout revokes the current auth token.
- Device presence expires independently of socket state.

Production must start with a fresh nonseeded database. `SEED_DEVELOPMENT=true` creates the fictional showcase and known demo administrator; `ALLOW_DEMO_LOGIN=true` separately enables the one-click demo endpoint. Disable both for official events.

## Match integrity

- Expected versions reject stale commands.
- Idempotency records make safe retries possible.
- The server, not browsers, validates transitions, timer changes, consensus, penalties, winner calculation, and bracket progression.
- Distinct judge sessions are required for consensus.
- Match events and published draw versions have database immutability triggers.
- State/result/advancement commits complete before realtime broadcast.
- Public mutation attempts receive authorization errors even with valid match IDs.

Generic undo is limited to reversible nonfinal scoring. Dedicated completed-result correction and downstream bracket reversal are not yet implemented; this must be completed before events requiring post-final result changes.

## Public data minimization

The local public tournament response excludes full athlete DOB, club contact email, registration/weigh-in internals, session/token tables, and audit records. The cloud `public_match_display` view exposes only display fields and athlete display names/country codes. Athlete and club base-table policies are member-only.

Public match state being visible does not imply permission to call operator APIs. Do not add sensitive fields to public snapshots without an explicit privacy review.

## Cloud credential boundary

`NEXT_PUBLIC_SUPABASE_URL` and the anonymous/publishable key may reach browser code. `SUPABASE_SERVICE_ROLE_KEY` is used only by the server-side sync service and must never appear in client environment variables, static bundles, logs, screenshots, or reports.

Cloud authorization is defined with PostgreSQL RLS and restricted RPCs. The ingestion RPC checks a tournament administrator or the service role and is not anonymously executable. Local PostgreSQL validation covers policy definitions and RPC behavior, but hosted Supabase RLS/Auth/Realtime/Storage testing is still required.

## Browser and transport protections

- Helmet defaults and disabled Express fingerprinting.
- JSON body size limits.
- Dedicated login/proposal rate limits.
- Same-origin checks for cookie-authenticated requests carrying an Origin header.
- `HttpOnly`, `SameSite=Lax` cookies; Secure when HTTPS is detected directly or through the trusted proxy.
- Relative browser URLs avoid cross-origin LAN mistakes.

For Internet deployment, use HTTPS and a reviewed reverse proxy. Local tournament LANs should be private, dedicated, and firewalled; LAN HTTP is not appropriate for untrusted/public networks.

## Audit and privacy operations

Audit records include actor, action, entity, timestamps, before/after data, and correction reasons where applicable. Reports containing contacts or audit details require authenticated access. Backups contain personal and competition data: encrypt them, restrict access, define retention, and securely dispose of obsolete copies according to the event's privacy policy.
