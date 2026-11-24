#!/usr/bin/env bash
# Sobe ou derruba um Postgres temporário para os testes locais.
#
#   scripts/local-pg.sh start   # imprime a DATABASE_URL
#   scripts/local-pg.sh stop    # para e apaga os dados
#
# Dados em /tmp/energia-pg, porta 54329, autenticação trust, fuso UTC.
# No Linux/macOS conecta por socket em /tmp/energia-pg; no Windows (Git Bash)
# por TCP em localhost. PG_BIN (opcional) aponta para a pasta dos binários.
# Se rodar como root, usa um usuário sem privilégios (energiapg).
set -euo pipefail

port=54329
dir=/tmp/energia-pg
data="$dir/data"
bin="${PG_BIN:+$PG_BIN/}"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) windows=1 ;;
  *) windows=0 ;;
esac

as_pg() {
  if [[ "$(id -u)" == "0" ]]; then
    id energiapg >/dev/null 2>&1 || useradd --system --no-create-home energiapg
    chown -R energiapg "$dir"
    su energiapg -s /bin/bash -c "$(printf '%q ' "$@")"
  else
    "$@"
  fi
}

native_path() {
  if [[ $windows == 1 ]]; then cygpath -m "$1"; else echo "$1"; fi
}

start() {
  if [[ -f "$data/postmaster.pid" ]]; then
    echo "erro: já existe um Postgres em $data (rode stop antes)" >&2
    exit 1
  fi
  rm -rf "$dir"
  mkdir -p "$dir"
  as_pg "${bin}initdb" -D "$(native_path "$data")" -U postgres --auth=trust -E UTF8 --no-locale >/dev/null
  if [[ $windows == 1 ]]; then
    listen="localhost"; sockets=""
    url="postgresql://postgres@localhost:$port/postgres"
  else
    listen=""; sockets="$dir"
    url="postgresql://postgres@/postgres?host=$dir&port=$port"
  fi
  cat >>"$data/postgresql.conf" <<EOF
port = $port
listen_addresses = '$listen'
unix_socket_directories = '$sockets'
timezone = 'UTC'
EOF
  as_pg "${bin}pg_ctl" -D "$(native_path "$data")" -l "$(native_path "$dir/log.txt")" -w start >/dev/null
  echo "$url"
}

stop() {
  if [[ -d "$data" ]]; then
    as_pg "${bin}pg_ctl" -D "$(native_path "$data")" -m fast -w stop >/dev/null 2>&1 || true
  fi
  rm -rf "$dir"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  *) echo "uso: $0 start|stop" >&2; exit 2 ;;
esac
