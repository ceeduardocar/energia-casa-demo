#!/usr/bin/env bash
# Roda bootstrap, migrations e testes SQL num Postgres VAZIO e DESCARTÁVEL.
#
#   DATABASE_URL=postgresql://... scripts/test-db.sh
#
# Recusa rodar se o banco já tiver public.readings (proteção contra banco real),
# a menos que RESET_TEST_DB=1 — nesse caso apaga os schemas public e test antes.
# PG_BIN (opcional) aponta para a pasta dos binários do Postgres (psql).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
psql_bin="${PG_BIN:+$PG_BIN/}psql"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "erro: defina DATABASE_URL (banco vazio e descartável)" >&2
  exit 2
fi

run_sql() {
  "$psql_bin" -d "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 "$@"
}

has_readings="$(run_sql -tA -c "select to_regclass('public.readings') is not null")"
if [[ "$has_readings" == "t" ]]; then
  if [[ "${RESET_TEST_DB:-}" != "1" ]]; then
    echo "erro: o banco já tem public.readings. Use um banco descartável ou RESET_TEST_DB=1." >&2
    exit 3
  fi
  run_sql -c "drop schema if exists public cascade; drop schema if exists test cascade; create schema public;"
fi

echo "== bootstrap"
run_sql -f "$root/supabase/tests/_bootstrap.sql"

shopt -s nullglob
for f in "$root"/supabase/migrations/*.sql; do
  echo "== migration $(basename "$f")"
  run_sql -f "$f"
done

failed=0
for f in "$root"/supabase/tests/*.test.sql; do
  name="$(basename "$f")"
  [[ "$name" == _* ]] && continue
  if out="$(run_sql -f "$f" 2>&1)"; then
    echo "ok   $name"
  else
    echo "FAIL $name"
    echo "$out" | sed 's/^/     /'
    failed=1
  fi
done

if [[ $failed -ne 0 ]]; then
  echo "== testes falharam"
  exit 1
fi
echo "== todos os testes passaram"
