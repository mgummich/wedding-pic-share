# Gallery Control & Access — Design Spec
**Date:** 2026-04-12
**Status:** Approved
**Phase:** 2 (sub-project 2)

---

## Overview

Three major enhancements to how guests and admins interact with galleries:

1.  **Single-Gallery Mode** — Serve a specific gallery directly from the root domain (e.g., `yoursite.com/upload`) using Next.js rewrites and a new `isActive` database flag.
2.  **Upload Windows** — Restrict guest uploads to specific date/time ranges (e.g., "Saturday 14:00 to Sunday 02:00"). Open by default if no windows are defined.
3.  **Active Gallery Management** — Admin UI to toggle which gallery is "Active". Setting one as active automatically deactivates all others.

---

## Architecture

### 1. Database Schema Extensions

**`packages/db/prisma/schema.prisma`**

```prisma
model Gallery {
  // ... existing fields
  isActive      Boolean        @default(false)
  uploadWindows UploadWindow[]
}

model UploadWindow {
  id        String   @id @default(cuid())
  galleryId String
  gallery   Gallery  @relation(fields: [galleryId], references: [id], onDelete: Cascade)
  start     DateTime
  end       DateTime
  createdAt DateTime @default(now())
}
```

A migration will be required to add these fields.

### 2. Backend Implementation

#### Active Gallery Logic
- **`GET /api/v1/g/active`** (New Public Route): Returns the single gallery where `isActive: true`. Returns `404` if none are active.
- **`PATCH /api/v1/admin/galleries/:id`** (Modify): When `isActive: true` is sent in the body, the service must first set `isActive: false` for *all* other galleries in the same wedding (or globally, depending on future multi-wedding plans — for now, globally since we have one admin).

#### Upload Window Validation
- **`POST /api/v1/g/:slug/upload`** (Modify):
  1. Fetch the gallery and its `uploadWindows`.
  2. If `uploadWindows.length === 0`, proceed (open by default).
  3. If windows exist, check if `now` is between `window.start` and `window.end` for *any* window.
  4. If outside all windows, return `403 Forbidden` with `{ type: 'upload-window-closed', title: 'Upload-Zeitfenster abgelaufen' }`.

### 3. Frontend Implementation

#### Single-Gallery Mode Rewrites
**`apps/frontend/src/middleware.ts`** (Modify):
If `process.env.SINGLE_GALLERY_MODE === 'true'`:
1.  On every request to `/`, `/upload`, or `/slideshow`:
2.  Fetch `GET BACKEND_URL/api/v1/g/active` (cached briefly).
3.  If a gallery exists, **rewrite** the request internally:
    - `/` → `/g/[slug]`
    - `/upload` → `/g/[slug]/upload`
    - `/slideshow` → `/g/[slug]/slideshow`
4.  The user sees the clean URL, but the existing page logic handles the request.

#### Admin UI: Settings & Windows
- **Gallery Settings Page** (`/admin/galleries/[id]`):
  - Add a "Haupt-Galerie (Root-URL)" toggle.
  - Add a "Upload-Zeitfenster" section.
  - List existing windows with a "Löschen" button.
  - "Zeitfenster hinzufügen" form with `start` and `end` datetime inputs.

#### Guest UI: Closed State
- **Upload Page** (`/g/[slug]/upload`):
  - If the gallery fetch returns an `isClosed` flag (calculated by backend), hide the `<UploadForm>` and show an `<EmptyState>` with a "Uploads sind zur Zeit geschlossen" message.

---

## Data Flow

### Setting a gallery as Active
1.  Admin toggles "Active" on Gallery A.
2.  `PATCH /api/v1/admin/galleries/A { isActive: true }`
3.  Backend: `UPDATE Gallery SET isActive = false WHERE id != A`
4.  Backend: `UPDATE Gallery SET isActive = true WHERE id = A`

### Guest Upload in Single-Mode
1.  Guest visits `yoursite.com/upload`.
2.  Middleware fetches active gallery (Slug: `our-wedding`).
3.  Middleware rewrites to `/g/our-wedding/upload`.
4.  Page fetches gallery data → checks windows → renders form or "Closed" message.

---

## Testing

### Backend Integration
- `POST /setup` ensures `isActive` defaults to `false`.
- `PATCH /admin/galleries/:id` verifies only one gallery can be active.
- `GET /api/v1/g/active` returns the correct gallery or 404.
- `POST /upload` returns 403 when outside defined windows.
- `POST /upload` returns 201 when windows are empty.

### Frontend Unit/E2E
- Middleware correctly rewrites `/upload` to `/g/slug/upload` in single-mode.
- Upload page displays "Closed" message when backend reports `403`.
- Admin settings successfully adds and removes upload windows.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `packages/db/prisma/schema.prisma` | Modify | Add `isActive` and `UploadWindow` model |
| `apps/backend/src/routes/guest/gallery.ts` | Create/Modify | `GET /active` + calculate window status |
| `apps/backend/src/routes/guest/upload.ts` | Modify | Window validation logic |
| `apps/backend/src/routes/admin/galleries.ts` | Modify | `isActive` unsetting logic + window CRUD |
| `apps/frontend/src/middleware.ts` | Modify | Add rewrite logic for Single-Gallery Mode |
| `apps/frontend/src/app/admin/galleries/[id]/page.tsx` | Modify | Add toggle + window management UI |
| `apps/frontend/src/app/g/[slug]/upload/page.tsx` | Modify | Handle "Closed" state UI |
| `apps/frontend/src/lib/api.ts` | Modify | Add `isActive` and `windows` to types/methods |
