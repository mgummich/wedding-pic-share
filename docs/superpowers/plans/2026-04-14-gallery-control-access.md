# Gallery Control & Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add active-gallery routing, upload-window enforcement, and gallery settings UI for managing both behaviors.

**Architecture:** Extend the Prisma schema and shared API types first so backend and frontend can share the new `isActive` and upload-window shape. Then add backend route coverage for active-gallery lookup, upload-window CRUD/enforcement, and closed-state projection on the guest gallery response. Finally, wire the frontend middleware and settings/upload pages to consume those APIs without adding duplicate route trees.

**Tech Stack:** Prisma, Fastify, Next.js App Router, React 19, Vitest, React Testing Library

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `packages/db/prisma/schema.prisma` | Modify | Add `Gallery.isActive` and `UploadWindow` model |
| `packages/db/prisma/migrations/<timestamp>_gallery_control_access/migration.sql` | Create | Persist schema changes |
| `packages/shared/src/types/gallery.ts` | Modify | Add upload-window and active-gallery fields to shared types |
| `apps/backend/src/routes/admin/galleries.ts` | Modify | Accept `isActive`, list windows, create/delete windows, enforce single active gallery |
| `apps/backend/src/routes/guest/gallery.ts` | Modify | Return `isUploadOpen`, `uploadWindows`, and `GET /g/active` |
| `apps/backend/src/routes/guest/upload.ts` | Modify | Reject uploads outside configured windows |
| `apps/backend/tests/gallery.test.ts` | Modify | Cover active gallery and upload-window CRUD/projection |
| `apps/backend/tests/upload.test.ts` | Modify | Cover upload-window closed/open behavior |
| `apps/frontend/src/lib/api.ts` | Modify | Expose new gallery fields and upload-window admin helpers |
| `apps/frontend/src/middleware.ts` | Modify | Rewrite root/upload/slideshow in single-gallery mode |
| `apps/frontend/src/app/admin/galleries/[id]/page.tsx` | Modify | Add active toggle and upload-window management UI |
| `apps/frontend/src/app/g/[slug]/upload/page.tsx` | Modify | Show closed-state message instead of upload form |
| `apps/frontend/tests/api.test.ts` | Modify | Cover new API helpers and query construction |
| `apps/frontend/tests/upload-form.test.tsx` | Modify | Cover closed-state rendering |

### Task 1: Schema and backend read-paths

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_gallery_control_access/migration.sql`
- Modify: `packages/shared/src/types/gallery.ts`
- Modify: `apps/backend/tests/gallery.test.ts`
- Modify: `apps/backend/src/routes/guest/gallery.ts`

- [ ] **Step 1: Write failing backend tests for active gallery lookup and guest projection**

Add tests to `apps/backend/tests/gallery.test.ts` that expect:

```ts
it('returns the active gallery from /api/v1/g/active', async () => {
  const activate = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/galleries/${galleryId}`,
    headers: { cookie: sessionCookie },
    payload: { isActive: true },
  })
  expect(activate.statusCode).toBe(200)

  const res = await app.inject({ method: 'GET', url: '/api/v1/g/active' })
  expect(res.statusCode).toBe(200)
  expect(res.json().slug).toBe('party')
  expect(res.json().isActive).toBe(true)
})

it('includes upload window metadata and open state on guest gallery responses', async () => {
  const update = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/galleries/${galleryId}`,
    headers: { cookie: sessionCookie },
    payload: {
      uploadWindows: [
        {
          start: '2030-06-01T12:00:00.000Z',
          end: '2030-06-01T16:00:00.000Z',
        },
      ],
    },
  })
  expect(update.statusCode).toBe(200)

  const res = await app.inject({ method: 'GET', url: '/api/v1/g/party' })
  expect(res.statusCode).toBe(200)
  expect(res.json().uploadWindows).toHaveLength(1)
  expect(res.json().isUploadOpen).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @wedding/backend exec vitest run tests/gallery.test.ts`

Expected: FAIL because `isActive`, `uploadWindows`, and `/api/v1/g/active` do not exist yet.

- [ ] **Step 3: Implement schema, shared types, and guest gallery route changes**

Add the Prisma fields/model, generate a matching SQL migration, extend `GalleryResponse`, and update `guestGalleryRoutes` to:
- include `uploadWindows` in gallery queries
- compute `isUploadOpen` as `true` when no windows exist or `now` is within any window
- expose `GET /g/active`

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @wedding/backend exec vitest run tests/gallery.test.ts`

Expected: PASS

### Task 2: Backend write-paths and upload enforcement

**Files:**
- Modify: `apps/backend/tests/gallery.test.ts`
- Modify: `apps/backend/tests/upload.test.ts`
- Modify: `apps/backend/src/routes/admin/galleries.ts`
- Modify: `apps/backend/src/routes/guest/upload.ts`

- [ ] **Step 1: Write failing tests for single-active behavior and closed upload windows**

Add backend tests that expect:

```ts
it('deactivates previously active galleries when another gallery is activated', async () => {
  const second = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/galleries',
    headers: { cookie: sessionCookie },
    payload: {
      weddingName: 'Emma & Max',
      weddingSlug: 'emma-max-2026',
      galleryName: 'Afterparty',
      gallerySlug: 'afterparty',
    },
  })
  const secondId = second.json().id

  await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/galleries/${galleryId}`,
    headers: { cookie: sessionCookie },
    payload: { isActive: true },
  })

  const res = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/galleries/${secondId}`,
    headers: { cookie: sessionCookie },
    payload: { isActive: true },
  })

  expect(res.statusCode).toBe(200)

  const all = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/galleries',
    headers: { cookie: sessionCookie },
  })
  const galleries = all.json().flatMap((w: { galleries: Array<{ id: string; isActive: boolean }> }) => w.galleries)
  expect(galleries.find((g) => g.id === galleryId)?.isActive).toBe(false)
  expect(galleries.find((g) => g.id === secondId)?.isActive).toBe(true)
})

it('rejects guest uploads outside configured windows', async () => {
  await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/galleries/${galleryId}`,
    headers: { cookie: sessionCookie },
    payload: {
      uploadWindows: [
        {
          start: '2030-06-01T12:00:00.000Z',
          end: '2030-06-01T16:00:00.000Z',
        },
      ],
    },
  })

  const jpegBuf = await sharp({
    create: { width: 100, height: 100, channels: 3, background: '#00ff00' },
  }).jpeg().toBuffer()
  const multipart = buildMultipartPayload(jpegBuf, 'image/jpeg', 'closed.jpg')

  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/g/${gallerySlug}/upload`,
    headers: { 'content-type': multipart.contentType },
    payload: multipart.body,
  })

  expect(res.statusCode).toBe(403)
  expect(res.json().type).toBe('upload-window-closed')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @wedding/backend exec vitest run tests/gallery.test.ts tests/upload.test.ts`

Expected: FAIL because the admin route neither persists windows nor enforces single-active behavior, and upload accepts closed windows.

- [ ] **Step 3: Implement admin update semantics and upload-window enforcement**

Update `adminGalleryRoutes` to:
- accept `isActive` and `uploadWindows`
- validate `start < end`
- replace existing windows transactionally when provided
- clear `isActive` on other galleries before activating the target

Update `guestUploadRoutes` to load gallery windows and return:

```ts
return reply.code(403).send({
  type: 'upload-window-closed',
  title: 'Upload-Zeitfenster abgelaufen',
  status: 403,
})
```

when no configured window contains the current time.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @wedding/backend exec vitest run tests/gallery.test.ts tests/upload.test.ts`

Expected: PASS

### Task 3: Frontend API, middleware, and pages

**Files:**
- Modify: `apps/frontend/tests/api.test.ts`
- Modify: `apps/frontend/tests/upload-form.test.tsx`
- Modify: `apps/frontend/src/lib/api.ts`
- Modify: `apps/frontend/src/middleware.ts`
- Modify: `apps/frontend/src/app/g/[slug]/upload/page.tsx`
- Modify: `apps/frontend/src/app/admin/galleries/[id]/page.tsx`

- [ ] **Step 1: Write failing frontend tests for new API helpers and closed-state UI**

Add tests that expect:

```ts
it('updates gallery settings with upload windows and active state', async () => {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ id: 'g1', isActive: true, uploadWindows: [] }),
  } as Response)

  await updateGallery('g1', {
    isActive: true,
    uploadWindows: [{ start: '2030-06-01T12:00:00.000Z', end: '2030-06-01T16:00:00.000Z' }],
  })

  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/admin/galleries/g1'),
    expect.objectContaining({ method: 'PATCH' })
  )
})
```

and a component test proving the guest upload page renders a closed message instead of the form when `getGallery()` returns `isUploadOpen: false`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @wedding/frontend exec vitest run tests/api.test.ts tests/upload-form.test.tsx`

Expected: FAIL because the types/helpers and closed-state rendering do not exist yet.

- [ ] **Step 3: Implement frontend support**

Update:
- `api.ts` types to include `isActive`, `isUploadOpen`, and `uploadWindows`
- `middleware.ts` to rewrite `/`, `/upload`, and `/slideshow` when `SINGLE_GALLERY_MODE === 'true'`
- the guest upload page to render an `<EmptyState>` message when uploads are closed
- the admin gallery settings page to toggle active state and edit upload windows inline

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @wedding/frontend exec vitest run tests/api.test.ts tests/upload-form.test.tsx`

Expected: PASS

### Task 4: Verification sweep

**Files:**
- No code changes expected

- [ ] **Step 1: Run backend verification**

Run: `pnpm --filter @wedding/backend exec vitest run tests/gallery.test.ts tests/upload.test.ts`

Expected: PASS

- [ ] **Step 2: Run frontend verification**

Run: `pnpm --filter @wedding/frontend exec vitest run tests/api.test.ts tests/upload-form.test.tsx`

Expected: PASS

- [ ] **Step 3: Run shared verification**

Run: `pnpm --filter @wedding/shared exec vitest run`

Expected: PASS
