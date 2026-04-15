# Deployment Guide

Related docs:
- `docs/runbook.md`
- `docs/architecture-decisions.md`
- `docs/api/openapi.yaml`

## Security-Critical Environment Variables

- `SETUP_TOKEN`: required to bootstrap the first admin via `/api/v1/setup`
- `REDIS_URL`: required in production for distributed brute-force throttling and SSE fan-out

## Image Artifacts

CI builds and publishes versioned images to GHCR on `main`/`master` pushes and version tags:

- `ghcr.io/<owner>/<repo>/backend:<tag>`
- `ghcr.io/<owner>/<repo>/frontend:<tag>`

Tags include branch/tag refs, commit SHA, and `latest` for the default branch.

## Migration Flow

Migrations run in a dedicated one-shot container (`backend-migrate`) before the backend starts.
The backend container no longer runs `prisma migrate deploy` at boot.

Manual migration command:

```bash
scripts/ops/migrate.sh
```

## Backup Strategy

- Persistent app data is stored in the `wps_data` Docker volume.
- A `backup` sidecar writes compressed snapshots into `wps_backups` and prunes old backups.
- Default retention is 14 days, interval is 24h.

Relevant environment variables:

- `BACKUP_INTERVAL_SECONDS` (default `86400`)
- `BACKUP_RETENTION_DAYS` (default `14`)

Create an immediate host backup snapshot:

```bash
scripts/ops/backup-now.sh
```

## Rollback Path

If a deployment fails after a migration:

1. Restore the latest known-good backup snapshot.
2. Restart the backend/frontend containers.

```bash
scripts/ops/restore-backup.sh backups/<file>.tar.gz
```
