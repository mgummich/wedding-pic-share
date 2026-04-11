# Navigation & Lightbox — Design Spec
**Date:** 2026-04-11
**Status:** Approved

---

## Goal

Add a guest top-navigation bar, an admin sidebar with gallery list, and a full-screen lightbox (click-to-view) to the frontend. No new backend endpoints required.

---

## Architecture

### New Components

| File | Responsibility |
|---|---|
| `apps/frontend/src/components/GuestNav.tsx` | Sticky top bar for guest pages — gallery name + links to Gallery / Upload / Slideshow |
| `apps/frontend/src/components/AdminSidebar.tsx` | Fixed left sidebar for admin pages — gallery list + logout |
| `apps/frontend/src/components/Lightbox.tsx` | Full-screen photo/video overlay — prev/next arrows, swipe gestures, keyboard navigation |

### Modified Files

| File | Change |
|---|---|
| `apps/frontend/src/app/g/[slug]/page.tsx` | Add `<GuestNav>`, wire photo array into `<Lightbox>` |
| `apps/frontend/src/app/g/[slug]/upload/page.tsx` | Add `<GuestNav>` |
| `apps/frontend/src/app/g/[slug]/slideshow/page.tsx` | Add `<GuestNav>` |
| `apps/frontend/src/app/admin/layout.tsx` | New layout wrapping all `/admin/*` with `<AdminSidebar>` |
| `apps/frontend/src/app/admin/galleries/[id]/moderate/page.tsx` | Wire photos into `<Lightbox>` |
| `apps/frontend/src/app/admin/galleries/[id]/page.tsx` | Wire photos into `<Lightbox>` |

---

## Component Details

### GuestNav

Sticky top bar, ~56px tall. Receives `gallerySlug` and `galleryName` as props from the parent Server Component — no additional API calls.

**Layout:**
```
[ Anna & Max (truncated) ]  [⊞ Galerie] [📷 Hochladen] [▶ Slideshow]
```

- Left: gallery name (`font-display`, truncated with `truncate`)
- Right: three icon+label links pointing to `/g/[slug]`, `/g/[slug]/upload`, `/g/[slug]/slideshow`
- Active link: `text-accent` via `usePathname()` in a thin `'use client'` wrapper
- Mobile: labels hidden below `sm:`, icons only

### AdminSidebar

Fixed left sidebar, 240px wide on desktop. Collapses to a 48px icon-only rail on mobile with a hamburger toggle. Covers all `/admin/*` pages via `apps/frontend/src/app/admin/layout.tsx`.

**Contents (top to bottom):**
1. App wordmark / logo
2. **"Neu"** button → `/admin/galleries/new`
3. **Gallery list** — fetched once on mount via `getAdminGalleries()`. Each entry: gallery name + wedding name subtitle. Active gallery highlighted with `bg-surface-card border-l-2 border-accent`. Links to `/admin/galleries/[id]`.
4. **Bottom:** Logout button with icon → calls `adminLogout()` then `router.replace('/admin/login')`

On 401 from `getAdminGalleries()` → redirect to `/admin/login`.

On narrow screens: overlay backdrop closes sidebar on tap.

### Lightbox

Full-screen dark overlay (`bg-black/90`), rendered via `createPortal` into `document.body`.

**Props:**
```typescript
interface LightboxProps {
  photos: PhotoResponse[]
  index: number           // currently displayed photo index
  onClose: () => void
  onNext: () => void
  onPrev: () => void
}
```

**State lives in the parent.** Lightbox is a pure display component. Parent tracks `openIndex: number | null`.

**Controls:**
- `×` close button (top-right corner)
- `‹` / `›` arrow buttons (sides) — hidden when at first/last photo
- **Keyboard:** `←` / `→` navigate, `Esc` closes (via `useEffect` with `keydown` listener)
- **Swipe:** `pointerdown` → `pointermove` → `pointerup`; horizontal delta > 50px triggers prev/next

**Media rendering:**
- Images: `<img>` at `max-h-[90vh] max-w-[90vw]` preserving aspect ratio
- Videos: `<video autoplay muted loop>` same sizing — full inline player controls are Phase 2

**Scroll lock:** `document.body.style.overflow = 'hidden'` while open, restored on close via `useEffect` cleanup.

---

## Data Flow

```
GuestNav:      props from Server Component (no API call)
AdminSidebar:  getAdminGalleries() once on mount → local state
Lightbox:      photos array already in parent state (no new API call)
```

---

## Where Lightbox Appears

| Page | Trigger | Photo Array Source |
|---|---|---|
| Guest gallery (`/g/[slug]`) | Click `<PhotoCard>` | existing gallery fetch |
| Admin moderation (`/admin/galleries/[id]/moderate`) | Click photo thumbnail | existing pending photos fetch |
| Admin gallery settings (`/admin/galleries/[id]`) | Click photo thumbnail | existing gallery fetch |

---

## Testing

### Unit Tests (Vitest + React Testing Library)

**`Lightbox`:**
- Opens at correct index
- `›` advances index, hidden at last photo
- `‹` goes back, hidden at first photo
- `Esc` key fires `onClose`
- Arrow keys fire `onNext` / `onPrev`

**`GuestNav`:**
- Active link matches current path (mock `usePathname`)
- Links point to correct slug URLs

### E2E Tests (Playwright)

New tests in `guest-gallery.spec.ts` and `admin-galleries.spec.ts`:
- Guest: clicking first photo opens lightbox; `×` closes; `›` navigates to next
- Admin moderation: clicking a pending photo thumbnail opens lightbox
- Admin sidebar: all galleries visible; clicking a gallery navigates to its settings page; logout works

---

## Phase Placement

This feature is **Phase 1** — the lightbox ("Lightbox mit Swipe") was listed in the original Phase 1 spec but never implemented. Navigation was implied but never specified. Both are now explicitly designed and planned.

**Phase 2 deferral:** Full video inline player controls (play/pause/seek/volume) in the lightbox. Phase 1 minimum is autoplay muted loop.
