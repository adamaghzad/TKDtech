#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PG_BINDIR=$(pg_config --bindir)
TMP=$(mktemp -d /tmp/tkd-supabase-validation.XXXXXX)
cleanup(){ if [[ -d "$TMP/data" ]]; then "$PG_BINDIR/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1||true;fi;rm -rf "$TMP";}
trap cleanup EXIT
"$PG_BINDIR/initdb" -D "$TMP/data" --auth-local=trust --auth-host=trust --no-instructions >/dev/null
"$PG_BINDIR/pg_ctl" -D "$TMP/data" -o "-k $TMP -c listen_addresses=''" -w start >/dev/null
PSQL=("$PG_BINDIR/psql" -h "$TMP" -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$ROOT/scripts/supabase-validation-bootstrap.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/202610240001_initial.sql"
"${PSQL[@]}" -f "$ROOT/scripts/supabase-validation-user.sql"
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql"
"${PSQL[@]}" -f "$ROOT/scripts/supabase-validation-checks.sql"
