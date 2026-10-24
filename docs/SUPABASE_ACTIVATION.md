# Activate the supplied Supabase project

Project URL and publishable key are configured in the git-ignored `.env.local` files. The application remains in `LOCAL` mode until activation checks pass.

Current connection check (2026-10-24):

- `auth/v1/settings`: HTTP 200 — project/Auth reachable.
- `public.tournaments`: missing (`PGRST205`).
- `public.public_match_display`: missing (`PGRST205`).

## Required one-time SQL step

A publishable browser key cannot create tables or run DDL. Do not replace it with a client-side service/secret key.

1. Open [Supabase Dashboard](https://supabase.com/dashboard) and select project `raalegrgighhdgkitvus`.
2. Open **SQL Editor → New query**.
3. Copy the complete contents of `supabase/migrations/202610240001_initial.sql` from this workspace.
4. Run it once and confirm it completes without an error.
5. In **Authentication → Users**, create the initial administrator account with a strong unique password. Do not use the local demo password.
6. The migration trigger creates the profile automatically when the Auth user is created.
7. Create a production organization and `SUPER_ADMIN` membership for that user using a controlled admin SQL/script process. The optional `supabase/seed.sql` is only for the fictional development organization and is not recommended for an official event.
8. Return to this conversation so authenticated RLS, public display access, Realtime, and storage can be tested before cloud mode is enabled.

## Recheck from the workspace

With the public environment variables loaded:

```bash
set -a
source .env.local
set +a
npm run check:supabase
```

The check exits with status 2 while required entities are missing. It does not send tournament data or mutate the project.

## After schema installation

The following still require verification before `NEXT_PUBLIC_TKD_MODE=CLOUD`:

- authenticated sign-in and profile creation;
- organization/membership bootstrap;
- role-specific RLS allow/deny tests;
- anonymous minimal public display query;
- Realtime authorization and reconnect behavior;
- private storage policies;
- explicit cloud/local authority selection.

Do not put a service-role or secret API key in `.env.local` for the browser. If server-side sync is later required, configure that credential only in the local server's protected environment.
