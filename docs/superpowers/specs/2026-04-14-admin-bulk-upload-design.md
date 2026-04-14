# Admin Bulk Upload — Design Spec
**Date:** 2026-04-14
**Status:** Approved
**Phase:** 2

---

## Overview

Add an admin-only bulk upload tool inside each gallery settings page (`/admin/galleries/[id]`).

The admin can select multiple images/videos and upload them sequentially, file by file, with visible status per file. Uploads must **not** bypass moderation. The resulting photo status still follows the gallery's `moderationMode`:

- `AUTO` → uploaded files become `APPROVED`
- `MANUAL` → uploaded files become `PENDING`

This feature is operationally stronger than the guest uploader while still reusing the same backend media-processing pipeline.

---

## Goals

1. Let admins upload many files directly from the gallery settings page
2. Keep uploads stable by processing files sequentially in the browser
3. Surface clear per-file outcomes (`approved`, `pending`, `failed`)
4. Reuse the existing upload validation and media-processing rules
5. Keep moderation behavior consistent with the gallery configuration

---

## Non-Goals

- No moderation bypass for admins
- No parallel upload engine
- No chunked/resumable uploads
- No separate admin upload page
- No background job queue for this slice

---

## UX

### Placement

Add a new **"Admin Upload"** section to `apps/frontend/src/app/admin/galleries/[id]/page.tsx`.

Recommended placement:
- Below the gallery settings form
- Above the approved-photo grid/lightbox section

This keeps operational upload work near gallery configuration and visible results.

### Upload Flow

1. Admin opens a gallery settings page
2. Admin selects multiple files via file picker
3. Selected files appear in a queue list
4. Admin starts the upload
5. Files upload one-by-one in sequence
6. Each file updates its own status row
7. Completed uploads show either:
   - `Freigegeben` for `APPROVED`
   - `Zur Moderation eingereiht` for `PENDING`
8. Failed files can be retried individually or as a failed subset

### File Row States

Each queued file should display:

- filename
- media type hint if available
- status badge
- optional error text

Supported statuses:

- `queued`
- `uploading`
- `approved`
- `pending`
- `failed`

### Interaction Rules

- Upload order is the selection order
- Only one file uploads at a time
- Successful files are not re-uploaded on retry
- Failed files can be retried without losing the queue
- The picker remains available after completion so admins can add more files

### Copy

Admin copy should be short and operational, not guest-facing.

Examples:

- Section title: `Admin Upload`
- Empty hint: `Bilder und Videos direkt in diese Galerie hochladen`
- Queue status: `3 von 7 Dateien verarbeitet`
- Pending result: `Zur Moderation eingereiht`
- Approved result: `Freigegeben`
- Retry action: `Fehlgeschlagene erneut hochladen`

---

## Frontend Architecture

### New Component

**`apps/frontend/src/components/AdminUploadPanel.tsx`** (new)

Responsibilities:

- file selection
- local upload queue state
- sequential upload orchestration
- per-file status rendering
- retry behavior
- success summary

Suggested local type:

```ts
type AdminUploadItem = {
  id: string
  file: File
  status: 'queued' | 'uploading' | 'approved' | 'pending' | 'failed'
  error?: string
  uploadedPhotoId?: string
}
```

### Gallery Settings Page Integration

**`apps/frontend/src/app/admin/galleries/[id]/page.tsx`**

Changes:

- render `<AdminUploadPanel galleryId={id} moderationMode={gallery.moderationMode} onUploadsComplete={...} />`
- refresh approved photos when at least one file finishes as `APPROVED`
- optionally show a pending count summary after a manual-moderation batch

### API Client

**`apps/frontend/src/lib/api.ts`**

Add:

```ts
export async function adminUploadFile(
  galleryId: string,
  file: File
): Promise<UploadResponse>
```

This mirrors the guest upload helper shape but targets an authenticated admin route.

Validation rules should match the guest uploader:

- accepted MIME types
- client-side image/video size checks

If possible, share constants/helpers with the guest upload form instead of duplicating them.

---

## Backend Architecture

### New Route

**`POST /api/v1/admin/galleries/:id/upload`**

Authenticated admin-only route.

Request:
- multipart form with `file`

Response:
- same `UploadResponse` shape already used for guest uploads

Status behavior:
- based on gallery `moderationMode`
- never hardcoded to `APPROVED` just because the uploader is an admin

### Shared Upload Service

Refactor the current guest upload route so actual processing is shared.

Suggested new service:

**`apps/backend/src/services/photoIngest.ts`** (name flexible)

Responsibilities:

- file type validation
- duplicate detection
- image/video processing
- storage writes
- DB photo creation
- moderation-mode status assignment
- SSE broadcast for approved uploads

This service should accept enough context to work for both:

- guest upload by gallery slug
- admin upload by gallery id

### Guest Upload Route

Keep:
- slug-based access
- upload-window enforcement

Do not change:
- guest-facing API contract

### Admin Upload Route

Differences from guest route:

- requires authenticated admin
- resolves gallery by `id`
- does **not** enforce upload windows

Reason:
- upload windows are a guest constraint, not an admin operational constraint

---

## Data and State Effects

### When Moderation Mode is `AUTO`

- uploaded file is stored as `APPROVED`
- SSE broadcast fires
- photo appears in approved gallery list after refresh

### When Moderation Mode is `MANUAL`

- uploaded file is stored as `PENDING`
- no approved-grid refresh needed for that file
- admin sees per-file pending status
- moderation page will surface it later

---

## Error Handling

Per-file failures should not abort the whole batch.

Examples:

- unsupported MIME type
- duplicate upload
- processing/storage failure
- network failure

Behavior:

- failing file becomes `failed`
- later files continue uploading
- retry action only retries failed items

---

## Testing

### Backend

**`apps/backend/tests/admin-upload.test.ts`** (new) or extend existing upload/admin suites

Required coverage:

- authenticated admin can upload to gallery by `id`
- unauthenticated request is rejected
- manual moderation gallery returns `PENDING`
- auto moderation gallery returns `APPROVED`
- admin upload ignores guest upload windows
- duplicate upload returns `409`

### Frontend Unit

**`apps/frontend/tests/admin-upload-panel.test.tsx`** (new)

Required coverage:

- multiple selected files render as queued rows
- uploads run sequentially
- approved and pending statuses render correctly
- failed file can be retried
- successful files are not retried

### E2E

**`apps/frontend/e2e/admin-galleries.spec.ts`**

Required coverage:

- admin uploads multiple files to manual gallery and sees pending statuses
- admin uploads multiple files to auto gallery and sees approved result reflected in page content
- one failing file does not stop the rest of the queue

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `apps/frontend/src/components/AdminUploadPanel.tsx` | Create | Sequential admin bulk uploader UI |
| `apps/frontend/src/app/admin/galleries/[id]/page.tsx` | Modify | Embed upload panel and refresh approved photos |
| `apps/frontend/src/lib/api.ts` | Modify | Add admin upload helper |
| `apps/frontend/tests/admin-upload-panel.test.tsx` | Create | Queue and sequential status tests |
| `apps/frontend/e2e/admin-galleries.spec.ts` | Modify | Admin bulk upload E2E |
| `apps/backend/src/services/photoIngest.ts` | Create | Shared media ingest flow |
| `apps/backend/src/routes/guest/upload.ts` | Modify | Reuse shared ingest service |
| `apps/backend/src/routes/admin/upload.ts` | Create | Authenticated admin upload route |
| `apps/backend/src/server.ts` | Modify | Register admin upload route |
| `apps/backend/tests/admin-upload.test.ts` | Create | Admin upload integration tests |

---

## Acceptance Criteria

The feature is complete when:

1. Admin can upload multiple files from the gallery settings page
2. Files upload sequentially with visible per-file state
3. Admin uploads respect `moderationMode`
4. Failed files do not block the queue
5. Failed files can be retried
6. Approved uploads refresh the approved photo list
7. Backend guest/admin upload logic is shared rather than forked
