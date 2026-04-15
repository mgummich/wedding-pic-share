#!/usr/bin/env sh
set -eu

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    echo "Neither 'docker compose' nor 'docker-compose' is available."
    exit 1
  fi
}

if [ "${1:-}" = "" ]; then
  echo "Usage: scripts/ops/restore-backup.sh <backup-tar.gz>"
  exit 1
fi

backup_file="$1"
if [ ! -f "${backup_file}" ]; then
  echo "Backup file not found: ${backup_file}"
  exit 1
fi

abs_backup_file="$(cd "$(dirname "${backup_file}")" && pwd)/$(basename "${backup_file}")"

compose stop frontend backend || true
compose run --rm --no-deps --entrypoint sh \
  -v "${abs_backup_file}:/restore.tar.gz:ro" \
  backend \
  -c 'rm -rf /app/data/* && tar -xzf /restore.tar.gz -C /app/data'
compose up -d backend frontend
