#!/usr/bin/env bash
# Prepara um Postgres VAZIO de laboratório para o assistente: papéis do Supabase simulados, migrations e
# dados de demonstração (30 dias). Nunca aponte para o Supabase de produção.
#
#   DATABASE_URL=postgresql://... agent/lab/prepare-db.sh
#
# Recusa rodar se o banco já tiver public.readings (mesma proteção de scripts/test-db.sh).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
psql_bin="${PG_BIN:+$PG_BIN/}psql"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
: "${DATABASE_URL:?defina DATABASE_URL (banco vazio de laboratório)}"

run_sql() { "$psql_bin" -d "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

if [[ "$(run_sql -tA -c "select to_regclass('public.readings') is not null")" == "t" ]]; then
  echo "erro: o banco já tem public.readings; use um banco vazio" >&2
  exit 3
fi

run_sql -f "$root/supabase/tests/_bootstrap.sql"
for f in "$root"/supabase/migrations/*.sql; do run_sql -f "$f"; done
run_sql -f "$root/supabase/seed_demo.sql"
echo "laboratório pronto: $(run_sql -tA -c "select count(*) from public.readings") leituras, $(run_sql -tA -c "select count(*) from public.v_house_daily") dias"
