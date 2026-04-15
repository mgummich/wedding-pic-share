# Operator Runbook

## Scope
Operational procedures for running and recovering Wedding Pic Share in Docker-based environments.

## Core Services
- `backend`
- `frontend`
- `backend-migrate` (one-shot migration job)
- `backup` (scheduled volume backup sidecar)

## Start / Stop
```bash
docker compose up -d
docker compose ps
docker compose down
```

## Health Checks
```bash
curl -fsS http://localhost:4000/health
curl -fsS http://localhost:4000/ready
curl -fsS http://localhost:3000
```

## Logs
```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f backup
```

## Database Migrations
Migrations run through the dedicated migrate service.

```bash
scripts/ops/migrate.sh
```

## Backup and Restore

### Create immediate backup snapshot on host
```bash
scripts/ops/backup-now.sh
```

### Restore from snapshot
```bash
scripts/ops/restore-backup.sh backups/<file>.tar.gz
```

## Routine Checks
- Verify backups are produced and pruned according to retention.
- Verify backend responds with `status: ok` or investigate `status: degraded`.
- Confirm frontend is reachable and admin login works.

## Incident: failed deploy after schema change
1. Stop traffic / stop services.
2. Restore last known-good backup.
3. Re-run services.
4. Validate health endpoints and admin login.
5. Investigate migration/app mismatch before retrying deploy.

## Incident: notification failures (SMTP/Webhook/ntfy)
1. Check backend logs for:
   - `smtp.notification.failed`
   - `webhook.notification.failed`
   - `ntfy.notification.failed`
2. Validate related env vars (`SMTP_*`, `WEBHOOK_*`, `NTFY_TOPIC`).
3. Trigger `/api/v1/admin/webhooks/test` from authenticated admin session.
