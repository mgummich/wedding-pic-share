# Upload Retry Mechanism — Design Spec
**Date:** 2026-04-14
**Status:** Approved
**Phase:** 2 (sub-project)

---

## Overview

Implement a robust retry mechanism for guest uploads on `/g/[slug]/upload` to improve reliability on flaky networks, while keeping behavior explicit and predictable for users.

This spec covers only the retry mechanism (Phase 2 item `10` in the base roadmap).  
Sequencing decision for next work:

1. First: Retry mechanism (this spec)
2. Next: E-Mail notifications (SMTP)
3. S3 storage backend moved from Phase 2 to **Phase 4**

---

## Scope

### In Scope

- Guest upload form retry behavior (`apps/frontend/src/app/g/[slug]/upload/UploadForm.tsx`)
- Automatic retries for transient failures only
- Per-file manual retry for failed files
- Unit tests for retry behavior
- Focused E2E verification for retry UX (as needed)

### Out of Scope

- Backend retry jobs/queues
- Persisting retry state across page reload/navigation
- Admin upload panel behavior changes
- SMTP implementation details (covered in next sub-project)
- S3 backend implementation (deferred to Phase 4)

---

## Behavior

### Retry Policy

- Uploads remain sequential per file.
- Automatic retry is attempted only for:
  - network errors (no HTTP response)
  - HTTP `5xx` responses
- Maximum attempts per file: `3` total.
- Backoff schedule:
  - attempt 2: `500ms`
  - attempt 3: `1500ms`
  - after the third failed attempt, the file is marked as failed (no further automatic retries).

### Non-Retryable Failures

No automatic retry for business/validation errors (`4xx`), including common upload outcomes:

- `403` upload window closed
- `409` duplicate
- `413` file too large
- `415` unsupported media type

These failures are surfaced immediately with existing user-facing messages.

### Manual Retry

- Each failed file row displays `Erneut versuchen`.
- Manual retry re-queues only that file.
- Successfully uploaded files are never retried.
- Manual retry reuses the same transient/non-transient classification logic.

### State Persistence

- Retry queue/file state is in-memory only.
- Refresh/navigation resets state (explicitly accepted for this phase).

### Completion UX

- Success confirmation view is shown only if all selected files complete successfully.
- Mixed results keep the form visible with per-file status and retry actions.

---

## Architecture

### Frontend-Only State Machine

No API contract changes are required. The upload form remains the source of truth for per-file state:

- `status`: `pending | uploading | done | error`
- `attempts`: number
- `error`: user-facing message when failed

A local retry wrapper handles transient retry behavior around existing `uploadFile(...)`.

### Error Classification

- `ApiError` with `status >= 500` => transient
- non-`ApiError` thrown by network layer => transient
- all other API errors (`4xx`) => non-transient

---

## Testing

### Unit Tests (`apps/frontend/tests/upload-form.test.tsx`)

- Retries transient failure then succeeds
- Stops after max attempts on repeated transient failure
- Does not auto-retry on non-transient `4xx`
- Shows manual retry button for failed files
- Manual retry only retries failed file(s)

### E2E (focused)

`apps/frontend/e2e/guest-gallery.spec.ts` may include a focused transient failure scenario if practical in current harness; otherwise unit coverage is the primary verification layer for retry logic.

---

## Risks And Mitigations

- **Risk:** accidental retries on business errors  
  **Mitigation:** strict retry classifier with explicit `5xx`/network-only conditions.

- **Risk:** user confusion on partial success  
  **Mitigation:** per-file statuses + explicit manual retry action and mixed-result summary copy.

- **Risk:** unstable timing tests due to real backoff delays  
  **Mitigation:** unit tests use mocked timers and mocked API outcomes.

---

## Roadmap Adjustment

Roadmap order update requested by product direction:

- **Phase 2 next:** retry mechanism (this), then SMTP notifications.
- **Moved to Phase 4:** S3 storage backend (previously listed in Phase 2).
