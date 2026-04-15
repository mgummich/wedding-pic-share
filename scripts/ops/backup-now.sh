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

mkdir -p backups
timestamp="$(date +%Y%m%d-%H%M%S)"
output_path="/host-backups/wps-${timestamp}.tar.gz"

compose run --rm --no-deps -T \
  -v "$(pwd)/backups:/host-backups" \
  backup \
  sh -c "tar -czf ${output_path} -C /data ."

echo "Backup written to backups/wps-${timestamp}.tar.gz"
