# Security & Setup — Design Spec
**Date:** 2026-04-12
**Status:** Approved
**Phase:** 2 (first sub-project)

---

## Overview

Two features that form the security and onboarding foundation for Phase 2:

1. **Brute-Force Protection** — account-based lock (5 failures) + IP-based block (15 failures), both with 15-minute timeout
2. **First-Run Setup UI** — `/setup` page for interactive admin creation when no admin exists yet; optionally creates the first wedding + gallery in the same flow

No schema migrations required — `AdminUser.failedAttempts` and `lockedUntil` are already in the Prisma schema.

---

## Architecture

### Brute-Force Protection

**`apps/backend/src/plugins/bruteForce.ts`** (new)

A Fastify plugin holding an in-memory `Map<string, { count: number; resetAt: number }>` for IP tracking. Decorates the Fastify instance with:

- `checkIpBlocked(ip: string): boolean` — returns true if count ≥ 15 and not yet expired
- `recordIpFailure(ip: string): void` — increments count, sets `resetAt = now + 15min` on first failure
- `resetIpFailures(ip: string): void` — removes the IP entry (called on successful login)

Entries expire lazily on access. A `setInterval` every 5 minutes purges entries where `resetAt < now` to prevent unbounded memory growth. The plugin is registered in `apps/backend/src/server.ts` before the route plugins.

**`apps/backend/src/routes/admin/auth.ts`** (modify)

Login handler (`POST /api/v1/admin/login`) checks in this order:

1. `fastify.checkIpBlocked(ip)` → `429 { type: 'ip-blocked', title: 'Zu viele Fehlversuche. Bitte versuche es in 15 Minuten erneut.', status: 429 }`
2. `AdminUser.lockedUntil > now` → `429 { type: 'account-locked', title: 'Konto gesperrt. Bitte versuche es in X Minuten erneut.', status: 429 }`
3. Wrong password:
   - `fastify.recordIpFailure(ip)`
   - `AdminUser.failedAttempts += 1`
   - If `failedAttempts >= 5`: set `lockedUntil = now + 15min`
   - `401 { type: 'invalid-credentials', title: 'Ungültige Anmeldedaten.', status: 401 }`
4. Correct password:
   - `AdminUser.failedAttempts = 0`, `lockedUntil = null`
   - `fastify.resetIpFailures(ip)`
   - Create session → `200`

IP is read from `request.ip` — Fastify respects `trustProxy` so it extracts the real client IP behind the Docker reverse proxy.

The `lockedUntil` message includes the remaining minutes: computed as `Math.ceil((lockedUntil - now) / 60_000)`.

---

### First-Run Setup UI

**`apps/backend/src/routes/setup.ts`** (new)

Two public (unauthenticated) routes:

```
GET  /api/v1/setup/status
  → { setupRequired: true }   if AdminUser count = 0
  → { setupRequired: false }  if AdminUser count > 0

POST /api/v1/setup
  Body: { username: string, password: string, weddingName?: string, galleryName?: string }
  → 409 { type: 'setup-complete' }         if AdminUser already exists
  → 400 { type: 'validation-error' }       if password < 12 chars or username empty
  → 201 { message: 'Setup abgeschlossen.' } on success
```

On success: creates `AdminUser` (bcrypt password hash, `failedAttempts: 0`). If `weddingName` is provided, also creates a `Wedding` (slug auto-generated inline: `name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')`) and a `Gallery` using `galleryName` (falls back to `weddingName` if omitted, same slug generation). No external `slugify` dependency needed.

Registered in `apps/backend/src/server.ts` under the `/api/v1` prefix, **without** the `requireAdmin` preHandler.

**`apps/frontend/src/app/setup/page.tsx`** (new)

Client component (`'use client'`). On mount, calls `GET /api/v1/setup/status`:
- `setupRequired: false` → `router.replace('/admin/login')`
- `setupRequired: true` → show form

Two-step form:

- **Step 1 — Admin-Zugangsdaten:** Username (text, required) + Password (password, required, min 12 chars enforced client-side). Submit advances to Step 2.
- **Step 2 — Erste Galerie (optional):** Wedding name (text) + Gallery name (text). "Überspringen" button submits without these fields. "Galerie erstellen" submits with them.

On submit: `POST /api/v1/setup` → success → `router.replace('/admin/login')`. API errors shown below the button.

**`apps/frontend/src/middleware.ts`** (modify)

Extend the existing middleware to handle `/setup`. If a request arrives at `/setup`, the middleware calls the backend status endpoint server-side (using the internal `BACKEND_URL`). If `setupRequired: false`, redirect to `/admin/login`. This is the primary guard; the client-side check is a fallback.

**`apps/frontend/src/lib/api.ts`** (modify)

Add two helper functions:
```typescript
export async function getSetupStatus(): Promise<{ setupRequired: boolean }>
export async function submitSetup(data: {
  username: string
  password: string
  weddingName?: string
  galleryName?: string
}): Promise<void>
```

---

## Data Flow

### Login with brute-force

```
Browser → POST /api/v1/admin/login { username, password }
  Fastify plugin: checkIpBlocked(ip)?       → 429
  DB: AdminUser.lockedUntil > now?          → 429
  bcrypt.compare(password, hash) → false?
    recordIpFailure(ip)
    failedAttempts += 1
    if >= 5: lockedUntil = now + 15min      → 401
  bcrypt.compare → true
    failedAttempts = 0, lockedUntil = null
    resetIpFailures(ip)
    create Session                          → 200
```

### Setup flow

```
Browser → GET /setup
  Middleware → GET BACKEND_URL/api/v1/setup/status
    setupRequired: false → redirect /admin/login
    setupRequired: true  → render page

User fills form → POST /api/v1/setup { username, password, weddingName?, galleryName? }
  AdminUser exists?        → 409
  password < 12 chars?     → 400
  create AdminUser
  weddingName provided?
    create Wedding (slug from name)
    create Gallery (name = galleryName ?? weddingName, slug from name)
                           → 201
Browser → router.replace('/admin/login')
```

---

## Error Handling

| Scenario | Response | Frontend display |
|---|---|---|
| IP blocked | 429 `ip-blocked` | Existing login error state |
| Account locked | 429 `account-locked` | Existing login error state (includes remaining minutes) |
| Wrong password (not yet locked) | 401 `invalid-credentials` | Existing login error state |
| Setup already complete (POST) | 409 `setup-complete` | Redirect (shouldn't occur if middleware works) |
| Password too short | 400 `validation-error` | Inline under password field |
| Setup page visited after setup | — | Middleware redirect to `/admin/login` |

---

## Testing

### Backend — `apps/backend/tests/brute-force.test.ts` (new)

- 5 wrong passwords → 6th attempt returns 429 `account-locked`
- Account `failedAttempts` resets to 0 on successful login
- `lockedUntil` is set when threshold reached; request after it expires succeeds
- 15 failures from same IP → 16th returns 429 `ip-blocked`
- Different IPs don't share counters
- IP block expires after 15 min (mock `Date.now`)
- Successful login after IP failures → IP counter reset

### Backend — `apps/backend/tests/setup.test.ts` (new)

- `GET /api/v1/setup/status` → `{ setupRequired: true }` when no admin exists
- `GET /api/v1/setup/status` → `{ setupRequired: false }` when admin exists
- `POST /api/v1/setup` creates `AdminUser`, returns 201
- `POST /api/v1/setup` with `weddingName` creates `Wedding` + `Gallery`
- `POST /api/v1/setup` without `weddingName` does not create `Wedding`
- `POST /api/v1/setup` when admin exists → 409
- `POST /api/v1/setup` password < 12 chars → 400
- `POST /api/v1/setup` empty username → 400

### Frontend — `apps/frontend/tests/setup-form.test.tsx` (new)

- Shows Step 1 form when API returns `{ setupRequired: true }`
- Redirects to `/admin/login` when API returns `{ setupRequired: false }`
- "Überspringen" in Step 2 calls `submitSetup` without `weddingName`/`galleryName`
- Client-side validation: password < 12 chars shows inline error, does not call API

### E2E

**`apps/frontend/e2e/auth.spec.ts`** (modify)
- 5 consecutive wrong passwords → next attempt shows lock error message

**`apps/frontend/e2e/setup.spec.ts`** (new)

> Note: The shared E2E environment always has an admin (created in `global-setup.ts`), so the "form visible" and "create admin" scenarios are fully covered by backend integration tests and frontend unit tests. E2E only tests the guard behaviour in the live environment.

- Visiting `/setup` when admin exists → redirects to `/admin/login`

---

## File Map

| File | Action |
|---|---|
| `apps/backend/src/plugins/bruteForce.ts` | Create |
| `apps/backend/src/routes/admin/auth.ts` | Modify |
| `apps/backend/src/routes/setup.ts` | Create |
| `apps/backend/src/server.ts` | Modify (register plugin + setup routes) |
| `apps/backend/tests/brute-force.test.ts` | Create |
| `apps/backend/tests/setup.test.ts` | Create |
| `apps/frontend/src/app/setup/page.tsx` | Create |
| `apps/frontend/src/lib/api.ts` | Modify (add setup helpers) |
| `apps/frontend/src/middleware.ts` | Modify (add /setup guard) |
| `apps/frontend/tests/setup-form.test.tsx` | Create |
| `apps/frontend/e2e/auth.spec.ts` | Modify |
| `apps/frontend/e2e/setup.spec.ts` | Create |
