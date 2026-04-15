# Architecture Decisions

## ADR-001: Media Processing Transport

### Context
Media processing runs in three modes:
- `inline` (same process)
- `worker-thread` (Node worker threads)
- `bullmq` (Redis-backed queue workers)

### Decision
- Worker-thread mode transfers binary payloads as `Uint8Array` with transferable buffers.
- BullMQ mode transfers temporary file paths in job payloads (not raw/base64 binaries).

### Rationale
- Avoid base64 expansion overhead for large image/video buffers.
- Keep Redis job payload size bounded and predictable.
- Reduce serialization/GC pressure in hot upload paths.

### References
- `apps/backend/src/services/mediaProcessor.ts`
- `apps/backend/src/workers/mediaWorker.ts`

## ADR-002: Upload Window Default Behavior

### Context
Galleries can define optional upload windows.

### Decision
If no upload windows are configured, uploads are open by default.

### Rationale
This keeps onboarding friction low and mirrors existing product behavior.

### References
- `apps/backend/src/services/uploadWindows.ts`
- `apps/backend/src/routes/guest/upload.ts`

## ADR-003: beforePersist Hook Contract

### Context
Upload processing can be long-running (media transform + storage writes), and gallery state may change during processing.

### Decision
`ingestUploadedPhoto` accepts optional `beforePersist` guard logic:
- runs after file processing, before DB write
- throwing aborts persistence
- staged files are deleted in rollback path

### Rationale
Allows race-sensitive checks (upload window closure, gallery archival) without duplicating ingest logic.

### References
- `apps/backend/src/services/photoIngest.ts`
- `apps/backend/src/routes/guest/upload.ts`

## ADR-004: Admin Seed Idempotency

### Context
`seedAdmin` can run on boot (`SEED_ADMIN_ON_BOOT=true`), including repeated starts/restarts.

### Decision
`seedAdmin` is idempotent:
- existing user + same password -> no-op
- existing user + changed password -> update hash
- missing user -> create

### Rationale
Supports controlled password rotation via environment/config while remaining safe across repeated runs.

### References
- `apps/backend/src/seed.ts`
- `apps/backend/src/main.ts`

## ADR-005: Session Tokens Stored as Hashes

### Context
Session tokens were historically stored in plaintext in DB.

### Decision
- Persist SHA-256 hash of session token in `Session.token`.
- Keep temporary fallback lookup for legacy plaintext rows and migrate on read.

### Rationale
Reduces impact of DB disclosure by preventing direct reuse of stored session values.

### References
- `apps/backend/src/services/sessionToken.ts`
- `apps/backend/src/routes/admin/auth.ts`
- `apps/backend/src/plugins/auth.ts`
