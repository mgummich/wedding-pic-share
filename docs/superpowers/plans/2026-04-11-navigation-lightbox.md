# Navigation & Lightbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a guest top-nav bar, an admin sidebar with gallery list, and a full-screen lightbox (click-to-view with swipe + keyboard) to the frontend.

**Architecture:** Three new components (`Lightbox`, `GuestNav`, `AdminSidebar`) + one new Next.js layout (`admin/layout.tsx`). No new backend endpoints. `Lightbox` is a pure display component — state lives in the parent. `GuestNav` is split into a Server-friendly shell (`GuestNav.tsx`) that receives props, plus a `'use client'` inner component (`GuestNavClient.tsx`) for `usePathname` active-link highlighting. `AdminSidebar` is fully client-side.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind CSS, Lucide React, Vitest + React Testing Library (unit), Playwright (E2E)

**Run tests:** `pnpm --filter @wedding/frontend run test` (unit), `pnpm --filter @wedding/frontend exec playwright test` (E2E)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `apps/frontend/src/components/Lightbox.tsx` | **Create** | Full-screen overlay: prev/next arrows, swipe, keyboard, scroll lock |
| `apps/frontend/src/components/GuestNav.tsx` | **Create** | Nav shell (Server Component) — gallery name + renders GuestNavClient |
| `apps/frontend/src/components/GuestNavClient.tsx` | **Create** | Active-link nav links (Client Component, uses `usePathname`) |
| `apps/frontend/src/components/AdminSidebar.tsx` | **Create** | Fixed sidebar: gallery list + logout (Client Component) |
| `apps/frontend/src/app/admin/layout.tsx` | **Create** | Wraps `/admin/*` pages (except login) with AdminSidebar |
| `apps/frontend/src/app/g/[slug]/page.tsx` | **Modify** | Add `<GuestNav>`, wire photos into `<Lightbox>` via GalleryClient |
| `apps/frontend/src/app/g/[slug]/GalleryClient.tsx` | **Modify** | Add `openIndex` state, pass `onPhotoClick` to PhotoGrid, render Lightbox |
| `apps/frontend/src/app/g/[slug]/upload/page.tsx` | **Modify** | Add `<GuestNav>`, remove standalone back-arrow header |
| `apps/frontend/src/app/g/[slug]/slideshow/page.tsx` | **Modify** | Add `<GuestNav>` |
| `apps/frontend/src/app/admin/page.tsx` | **Modify** | Remove duplicate "Neu" + logout controls (now in sidebar) |
| `apps/frontend/src/app/admin/galleries/[id]/moderate/page.tsx` | **Modify** | Add click-to-lightbox on photo thumbnails |
| `apps/frontend/src/app/admin/galleries/[id]/page.tsx` | **Modify** | Fetch approved photos, add photo grid + Lightbox |
| `apps/frontend/tests/lightbox.test.tsx` | **Create** | Unit tests for Lightbox |
| `apps/frontend/tests/guest-nav.test.tsx` | **Create** | Unit tests for GuestNavClient |
| `apps/frontend/e2e/guest-gallery.spec.ts` | **Modify** | Add lightbox + guest nav E2E tests |
| `apps/frontend/e2e/admin-galleries.spec.ts` | **Modify** | Add admin sidebar + moderation lightbox E2E tests |
| `apps/frontend/e2e/pages/LightboxPage.ts` | **Create** | Page object for Lightbox |

---

### Task 1: Lightbox component

**Files:**
- Create: `apps/frontend/src/components/Lightbox.tsx`
- Create: `apps/frontend/tests/lightbox.test.tsx`

- [ ] **Step 1: Write failing Lightbox unit tests**

Create `apps/frontend/tests/lightbox.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Lightbox } from '../src/components/Lightbox'
import type { PhotoResponse } from '@wedding/shared'

function makePhoto(id: string): PhotoResponse {
  return {
    id,
    mediaType: 'IMAGE',
    thumbUrl: `/thumb/${id}.webp`,
    displayUrl: `/display/${id}.webp`,
    blurDataUrl: null,
    guestName: null,
    duration: null,
    createdAt: new Date().toISOString(),
  } as PhotoResponse
}

const photos = [makePhoto('p1'), makePhoto('p2'), makePhoto('p3')]

describe('Lightbox', () => {
  const onClose = vi.fn()
  const onNext = vi.fn()
  const onPrev = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the photo at the given index', () => {
    render(<Lightbox photos={photos} index={1} onClose={onClose} onNext={onNext} onPrev={onPrev} />)
    expect(screen.getByRole('img')).toHaveAttribute('src', '/display/p2.webp')
  })

  it('calls onClose when close button is clicked', async () => {
    render(<Lightbox photos={photos} index={0} onClose={onClose} onNext={onNext} onPrev={onPrev} />)
    await userEvent.click(screen.getByRole('button', { name: /schließen/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onNext when next button is clicked', async () => {
    render(<Lightbox photos={photos} index={0} onClose={onClose} onNext={onNext} onPrev={onPrev} />)
    await userEvent.click(screen.getByRole('button', { name: /nächstes/i }))
    expect(onNext).toHaveBeenCalledOnce()
  })

  it('calls onPrev when prev button is clicked', async () => {
    render(<Lightbox photos={photos} index={2} onClose={onClose} onNext={onNext} onPrev={onPrev} />)
    await userEvent.click(screen.getByRole('button', { name: /vorheriges/i }))
    expect(onPrev).toHaveBeenCalledOnce()
  })

  it('hides next button on last photo', () => {
    render(<Lightbox photos={photos} index={2} onClose={onClose} onNext={onNext} onPrev={onPrev} />)
    expect(screen.queryByRole('button', { name: /nächstes/i })).toBeNull()
  })

  it('hides prev button on first photo', () => {
    render(<Lightbox photos={photos} index={0} onClose={onClose} onNext={onNext} onPrev={onPrev} />)
    expect(screen.queryByRole('button', { name: /vorheriges/i })).toBeNull()
  })

  it('calls onClose on Escape key', () => {
    render(<Lightbox photos={photos} index={0} onClose={onClose} onNext={onNext} onPrev={onPrev} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onNext on ArrowRight key', () => {
    render(<Lightbox photos={photos} index={0} onClose={onClose} onNext={onNext} onPrev={onPrev} />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onNext).toHaveBeenCalledOnce()
  })

  it('calls onPrev on ArrowLeft key', () => {
    render(<Lightbox photos={photos} index={2} onClose={onClose} onNext={onNext} onPrev={onPrev} />)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(onPrev).toHaveBeenCalledOnce()
  })

  it('does not call onNext on ArrowRight when on last photo', () => {
    render(<Lightbox photos={photos} index={2} onClose={onClose} onNext={onNext} onPrev={onPrev} />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onNext).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm --filter @wedding/frontend run test -- lightbox
```

Expected: FAIL — `Cannot find module '../src/components/Lightbox'`

- [ ] **Step 3: Create `Lightbox.tsx`**

Create `apps/frontend/src/components/Lightbox.tsx`:

```typescript
'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import type { PhotoResponse } from '@wedding/shared'

interface LightboxProps {
  photos: PhotoResponse[]
  index: number
  onClose: () => void
  onNext: () => void
  onPrev: () => void
}

export function Lightbox({ photos, index, onClose, onNext, onPrev }: LightboxProps) {
  const photo = photos[index]
  const hasPrev = index > 0
  const hasNext = index < photos.length - 1
  const pointerStart = useRef<{ x: number; y: number } | null>(null)

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' && hasNext) onNext()
      if (e.key === 'ArrowLeft' && hasPrev) onPrev()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose, onNext, onPrev, hasPrev, hasNext])

  // Scroll lock
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  function handlePointerDown(e: React.PointerEvent) {
    pointerStart.current = { x: e.clientX, y: e.clientY }
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!pointerStart.current) return
    const dx = e.clientX - pointerStart.current.x
    const dy = e.clientY - pointerStart.current.y
    pointerStart.current = null
    // Only trigger swipe if horizontal movement dominates and exceeds threshold
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return
    if (dx < 0 && hasNext) onNext()
    if (dx > 0 && hasPrev) onPrev()
  }

  if (!photo) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      {/* Close */}
      <button
        onClick={(e) => { e.stopPropagation(); onClose() }}
        className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 text-white
                   hover:bg-black/70 transition-colors"
        aria-label="Schließen"
      >
        <X className="w-6 h-6" />
      </button>

      {/* Prev */}
      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); onPrev() }}
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full
                     bg-black/50 text-white hover:bg-black/70 transition-colors"
          aria-label="Vorheriges Foto"
        >
          <ChevronLeft className="w-8 h-8" />
        </button>
      )}

      {/* Next */}
      {hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); onNext() }}
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full
                     bg-black/50 text-white hover:bg-black/70 transition-colors"
          aria-label="Nächstes Foto"
        >
          <ChevronRight className="w-8 h-8" />
        </button>
      )}

      {/* Media — stop propagation so clicks on the image don't close the lightbox */}
      <div
        className="relative"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        {photo.mediaType === 'VIDEO' ? (
          <video
            key={photo.id}
            src={photo.displayUrl}
            poster={photo.thumbUrl}
            autoPlay
            muted
            loop
            playsInline
            className="max-h-[90vh] max-w-[90vw] object-contain"
          />
        ) : (
          // Using plain <img> here — the lightbox shows the full-res displayUrl
          // directly from the backend, not via Next.js image optimization.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={photo.id}
            src={photo.displayUrl}
            alt={photo.guestName ? `Foto von ${photo.guestName}` : 'Hochzeitsfoto'}
            className="max-h-[90vh] max-w-[90vw] object-contain"
          />
        )}
      </div>

      {/* Guest name caption */}
      {photo.guestName && (
        <div className="absolute bottom-6 left-0 right-0 flex justify-center pointer-events-none">
          <span className="text-white/70 text-sm bg-black/40 px-3 py-1 rounded-full">
            {photo.guestName}
          </span>
        </div>
      )}
    </div>,
    document.body,
  )
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm --filter @wedding/frontend run test -- lightbox
```

Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/Lightbox.tsx apps/frontend/tests/lightbox.test.tsx
git commit -m "feat(frontend): Lightbox component with keyboard and swipe navigation"
```

---

### Task 2: GuestNav component

**Files:**
- Create: `apps/frontend/src/components/GuestNav.tsx`
- Create: `apps/frontend/src/components/GuestNavClient.tsx`
- Create: `apps/frontend/tests/guest-nav.test.tsx`

- [ ] **Step 1: Write failing GuestNavClient unit tests**

Create `apps/frontend/tests/guest-nav.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GuestNavClient } from '../src/components/GuestNavClient'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
}))

import { usePathname } from 'next/navigation'

describe('GuestNavClient', () => {
  it('renders all three nav links', () => {
    vi.mocked(usePathname).mockReturnValue('/g/test-slug')
    render(<GuestNavClient gallerySlug="test-slug" />)
    expect(screen.getByRole('link', { name: /galerie/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /hochladen/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /slideshow/i })).toBeInTheDocument()
  })

  it('links point to the correct slug URLs', () => {
    vi.mocked(usePathname).mockReturnValue('/g/my-wedding')
    render(<GuestNavClient gallerySlug="my-wedding" />)
    expect(screen.getByRole('link', { name: /galerie/i })).toHaveAttribute('href', '/g/my-wedding')
    expect(screen.getByRole('link', { name: /hochladen/i })).toHaveAttribute('href', '/g/my-wedding/upload')
    expect(screen.getByRole('link', { name: /slideshow/i })).toHaveAttribute('href', '/g/my-wedding/slideshow')
  })

  it('highlights the gallery link when on the gallery page', () => {
    vi.mocked(usePathname).mockReturnValue('/g/test-slug')
    render(<GuestNavClient gallerySlug="test-slug" />)
    expect(screen.getByRole('link', { name: /galerie/i })).toHaveClass('text-accent')
    expect(screen.getByRole('link', { name: /hochladen/i })).not.toHaveClass('text-accent')
  })

  it('highlights the upload link when on the upload page', () => {
    vi.mocked(usePathname).mockReturnValue('/g/test-slug/upload')
    render(<GuestNavClient gallerySlug="test-slug" />)
    expect(screen.getByRole('link', { name: /hochladen/i })).toHaveClass('text-accent')
    expect(screen.getByRole('link', { name: /galerie/i })).not.toHaveClass('text-accent')
  })

  it('highlights the slideshow link when on the slideshow page', () => {
    vi.mocked(usePathname).mockReturnValue('/g/test-slug/slideshow')
    render(<GuestNavClient gallerySlug="test-slug" />)
    expect(screen.getByRole('link', { name: /slideshow/i })).toHaveClass('text-accent')
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm --filter @wedding/frontend run test -- guest-nav
```

Expected: FAIL — `Cannot find module '../src/components/GuestNavClient'`

- [ ] **Step 3: Create `GuestNavClient.tsx`**

Create `apps/frontend/src/components/GuestNavClient.tsx`:

```typescript
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutGrid, Camera, Play } from 'lucide-react'

interface GuestNavClientProps {
  gallerySlug: string
}

const NAV_LINKS = [
  { getHref: (slug: string) => `/g/${slug}`, icon: LayoutGrid, label: 'Galerie' },
  { getHref: (slug: string) => `/g/${slug}/upload`, icon: Camera, label: 'Hochladen' },
  { getHref: (slug: string) => `/g/${slug}/slideshow`, icon: Play, label: 'Slideshow' },
]

export function GuestNavClient({ gallerySlug }: GuestNavClientProps) {
  const pathname = usePathname()

  return (
    <div className="flex items-center gap-1">
      {NAV_LINKS.map(({ getHref, icon: Icon, label }) => {
        const href = getHref(gallerySlug)
        const active = pathname === href
        return (
          <Link
            key={label}
            href={href}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors
              ${active ? 'text-accent bg-accent/10' : 'text-text-muted hover:text-text-primary'}`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Create `GuestNav.tsx`**

Create `apps/frontend/src/components/GuestNav.tsx`:

```typescript
import { GuestNavClient } from './GuestNavClient'

interface GuestNavProps {
  gallerySlug: string
  galleryName: string
}

export function GuestNav({ gallerySlug, galleryName }: GuestNavProps) {
  return (
    <nav className="sticky top-0 z-30 bg-surface-base/95 backdrop-blur border-b border-border">
      <div className="flex items-center justify-between px-4 h-14">
        <span className="font-display text-lg text-text-primary truncate mr-4">
          {galleryName}
        </span>
        <GuestNavClient gallerySlug={gallerySlug} />
      </div>
    </nav>
  )
}
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
pnpm --filter @wedding/frontend run test -- guest-nav
```

Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/components/GuestNav.tsx apps/frontend/src/components/GuestNavClient.tsx apps/frontend/tests/guest-nav.test.tsx
git commit -m "feat(frontend): GuestNav component with active-link highlighting"
```

---

### Task 3: Add GuestNav to guest pages + wire Lightbox into gallery

**Files:**
- Modify: `apps/frontend/src/app/g/[slug]/page.tsx`
- Modify: `apps/frontend/src/app/g/[slug]/GalleryClient.tsx`
- Modify: `apps/frontend/src/app/g/[slug]/upload/page.tsx`
- Modify: `apps/frontend/src/app/g/[slug]/slideshow/page.tsx`

- [ ] **Step 1: Update `GalleryClient.tsx` to support lightbox**

Replace `apps/frontend/src/app/g/[slug]/GalleryClient.tsx` with:

```typescript
'use client'

import { useState, useCallback } from 'react'
import { PhotoGrid } from '@/components/PhotoGrid'
import { UploadButton } from '@/components/UploadButton'
import { EmptyState } from '@/components/EmptyState'
import { Lightbox } from '@/components/Lightbox'
import { useSSE } from '@/lib/sse'
import { getGallery } from '@/lib/api'
import type { PhotoResponse, GalleryResponse } from '@wedding/shared'

interface GalleryClientProps {
  gallery: GalleryResponse
  initialPhotos: PhotoResponse[]
  initialCursor: string | null
  initialHasMore: boolean
}

export function GalleryClient({
  gallery,
  initialPhotos,
  initialCursor,
  initialHasMore,
}: GalleryClientProps) {
  const [photos, setPhotos] = useState(initialPhotos)
  const [cursor, setCursor] = useState(initialCursor)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [loading, setLoading] = useState(false)
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  // SSE: prepend new photos approved by admin in real-time
  useSSE(gallery.slug, {
    onPhoto: useCallback((photo: PhotoResponse) => {
      setPhotos((prev) => {
        if (prev.some((p) => p.id === photo.id)) return prev
        return [photo, ...prev]
      })
    }, []),
  })

  async function loadMore() {
    if (!hasMore || loading || !cursor) return
    setLoading(true)
    try {
      const result = await getGallery(gallery.slug, { cursor })
      setPhotos((prev) => [...prev, ...result.data])
      setCursor(result.pagination.nextCursor)
      setHasMore(result.pagination.hasMore)
    } finally {
      setLoading(false)
    }
  }

  function handlePhotoClick(photo: PhotoResponse) {
    const index = photos.findIndex((p) => p.id === photo.id)
    if (index !== -1) setOpenIndex(index)
  }

  if (photos.length === 0) {
    return (
      <>
        <EmptyState
          title="Noch keine Fotos"
          description="Sei der Erste und teile deinen schönsten Moment!"
        />
        <UploadButton gallerySlug={gallery.slug} isEmpty />
      </>
    )
  }

  return (
    <>
      <PhotoGrid
        photos={photos}
        layout={gallery.layout}
        onPhotoClick={handlePhotoClick}
      />

      {hasMore && (
        <div className="flex justify-center mt-8 pb-24">
          <button
            onClick={loadMore}
            disabled={loading}
            className="px-6 py-2.5 rounded-full border border-border text-text-muted
                       hover:border-accent hover:text-accent transition-colors
                       disabled:opacity-50"
          >
            {loading ? 'Lädt…' : 'Mehr laden'}
          </button>
        </div>
      )}

      <UploadButton gallerySlug={gallery.slug} />

      {openIndex !== null && (
        <Lightbox
          photos={photos}
          index={openIndex}
          onClose={() => setOpenIndex(null)}
          onNext={() => setOpenIndex((i) => (i !== null ? Math.min(i + 1, photos.length - 1) : null))}
          onPrev={() => setOpenIndex((i) => (i !== null ? Math.max(i - 1, 0) : null))}
        />
      )}
    </>
  )
}
```

- [ ] **Step 2: Update guest gallery `page.tsx` to add GuestNav**

Replace `apps/frontend/src/app/g/[slug]/page.tsx` with:

```typescript
import { notFound } from 'next/navigation'
import { getGallery, ApiError } from '@/lib/api'
import { GalleryClient } from './GalleryClient'
import { GuestNav } from '@/components/GuestNav'

interface PageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params
  try {
    const gallery = await getGallery(slug)
    return { title: gallery.name }
  } catch {
    return { title: 'Galerie nicht gefunden' }
  }
}

export default async function GalleryPage({ params }: PageProps) {
  const { slug } = await params

  let galleryData: Awaited<ReturnType<typeof getGallery>>
  try {
    galleryData = await getGallery(slug)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound()
    throw err
  }

  return (
    <main className="min-h-screen bg-surface-base">
      <GuestNav gallerySlug={slug} galleryName={galleryData.name} />

      <div className="px-4 pt-6 pb-3">
        {galleryData.description && (
          <p className="text-text-muted">{galleryData.description}</p>
        )}
        <p className="text-text-muted text-sm mt-1">{galleryData.photoCount} Fotos</p>
      </div>

      <div className="px-2 pb-32">
        <GalleryClient
          gallery={galleryData}
          initialPhotos={galleryData.data}
          initialCursor={galleryData.pagination.nextCursor}
          initialHasMore={galleryData.pagination.hasMore}
        />
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Update upload `page.tsx` to add GuestNav**

Replace `apps/frontend/src/app/g/[slug]/upload/page.tsx` with:

```typescript
import { notFound } from 'next/navigation'
import { getGallery, ApiError } from '@/lib/api'
import { UploadForm } from './UploadForm'
import { GuestNav } from '@/components/GuestNav'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function UploadPage({ params }: PageProps) {
  const { slug } = await params

  let gallery: Awaited<ReturnType<typeof getGallery>>
  try {
    gallery = await getGallery(slug)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound()
    throw err
  }

  return (
    <main className="min-h-screen bg-surface-base max-w-lg mx-auto">
      <GuestNav gallerySlug={slug} galleryName={gallery.name} />
      <div className="px-4 pt-4">
        <h1 className="font-display text-xl text-text-primary mb-1">Fotos hochladen</h1>
      </div>
      <UploadForm gallerySlug={slug} guestNameMode={gallery.guestNameMode} />
    </main>
  )
}
```

- [ ] **Step 4: Update slideshow `page.tsx` to add GuestNav**

At the top of `apps/frontend/src/app/g/[slug]/slideshow/page.tsx`, the slideshow is full-screen (`fixed inset-0`). The GuestNav should NOT be inside the full-screen div — add it outside as an overlay. Replace the file:

```typescript
'use client'

import { useState, useEffect, useCallback, use } from 'react'
import Image from 'next/image'
import { getGallery } from '@/lib/api'
import { useSSE } from '@/lib/sse'
import { GuestNav } from '@/components/GuestNav'
import type { PhotoResponse } from '@wedding/shared'

const DISPLAY_DURATION_MS = Number(process.env.NEXT_PUBLIC_SLIDESHOW_INTERVAL_MS ?? 8000)

interface PageProps {
  params: Promise<{ slug: string }>
}

export default function SlideshowPage({ params }: PageProps) {
  const { slug } = use(params)
  const [photos, setPhotos] = useState<PhotoResponse[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [galleryName, setGalleryName] = useState('')

  useEffect(() => {
    getGallery(slug, { limit: 50 }).then((g) => {
      setPhotos(g.data)
      setGalleryName(g.name)
    })
  }, [slug])

  useSSE(slug, {
    onPhoto: useCallback((photo: PhotoResponse) => {
      setPhotos((prev) => {
        if (prev.some((p) => p.id === photo.id)) return prev
        return [...prev, photo]
      })
    }, []),
  })

  useEffect(() => {
    if (photos.length < 2) return
    const timer = setInterval(() => {
      setIsTransitioning(true)
      setTimeout(() => {
        setCurrentIndex((i) => (i + 1) % photos.length)
        setIsTransitioning(false)
      }, 800)
    }, DISPLAY_DURATION_MS)
    return () => clearInterval(timer)
  }, [photos.length])

  const current = photos[currentIndex]

  return (
    <>
      {/* GuestNav floats above the full-screen slideshow */}
      <div className="fixed top-0 left-0 right-0 z-20">
        <GuestNav gallerySlug={slug} galleryName={galleryName} />
      </div>

      {photos.length === 0 ? (
        <div
          className="fixed inset-0 flex flex-col items-center justify-center pt-14"
          style={{ background: 'var(--slideshow-bg)', color: 'var(--slideshow-text)' }}
        >
          <p className="font-display text-3xl mb-4">{galleryName}</p>
          <p className="text-lg opacity-70">Noch keine Fotos freigegeben.</p>
        </div>
      ) : (
        <div
          className="fixed inset-0 pt-14"
          style={{ background: 'var(--slideshow-bg)' }}
        >
          {/* Vignette */}
          <div className="absolute inset-0 pointer-events-none z-10"
               style={{ boxShadow: 'inset 0 0 200px rgba(0,0,0,0.8)' }} />

          {/* Photo */}
          {current && (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{
                opacity: isTransitioning ? 0 : 1,
                transition: `opacity var(--slideshow-crossfade-duration) var(--slideshow-crossfade-easing)`,
              }}
            >
              {current.mediaType === 'VIDEO' ? (
                <video
                  key={current.id}
                  src={current.displayUrl}
                  poster={current.thumbUrl}
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="max-h-screen max-w-screen object-contain"
                />
              ) : (
                <Image
                  key={current.id}
                  src={current.displayUrl}
                  alt={current.guestName ? `Photo by ${current.guestName}` : 'Wedding photo'}
                  fill
                  className="object-contain"
                  unoptimized
                  priority
                />
              )}
            </div>
          )}

          {/* Footer: guest name + upload hint */}
          <div
            className="absolute bottom-0 left-0 right-0 z-20 flex items-end justify-between p-8"
            style={{ color: 'var(--slideshow-text)' }}
          >
            <div>
              {current?.guestName && (
                <p className="text-base opacity-60">{current.guestName}</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-xl opacity-80">📷 Teile deine Fotos</p>
              <p className="text-base opacity-50">/g/{slug}/upload</p>
            </div>
          </div>

          {/* Progress dots */}
          {photos.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex gap-1.5">
              {photos.slice(0, Math.min(photos.length, 20)).map((_, i) => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full transition-opacity"
                  style={{
                    background: 'var(--slideshow-text)',
                    opacity: i === currentIndex % 20 ? 1 : 0.3,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add \
  apps/frontend/src/app/g/[slug]/GalleryClient.tsx \
  apps/frontend/src/app/g/[slug]/page.tsx \
  "apps/frontend/src/app/g/[slug]/upload/page.tsx" \
  "apps/frontend/src/app/g/[slug]/slideshow/page.tsx"
git commit -m "feat(frontend): add GuestNav to guest pages and wire Lightbox into gallery"
```

---

### Task 4: AdminSidebar component + admin layout

**Files:**
- Create: `apps/frontend/src/components/AdminSidebar.tsx`
- Create: `apps/frontend/src/app/admin/layout.tsx`
- Modify: `apps/frontend/src/app/admin/page.tsx`

- [ ] **Step 1: Create `AdminSidebar.tsx`**

Create `apps/frontend/src/components/AdminSidebar.tsx`:

```typescript
'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { LogOut, Plus, Menu, X } from 'lucide-react'
import { getAdminGalleries, adminLogout, ApiError } from '@/lib/api'

export function AdminSidebar() {
  const router = useRouter()
  const pathname = usePathname()
  const [galleries, setGalleries] = useState<Awaited<ReturnType<typeof getAdminGalleries>>>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    getAdminGalleries()
      .then(setGalleries)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/admin/login')
      })
  }, [router])

  async function handleLogout() {
    await adminLogout()
    router.replace('/admin/login')
  }

  return (
    <>
      {/* Mobile hamburger toggle */}
      <button
        className="fixed top-3 left-3 z-50 md:hidden p-2 rounded-full
                   bg-surface-card border border-border shadow-sm text-text-muted"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Seitenleiste schließen' : 'Seitenleiste öffnen'}
      >
        {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 h-full z-40 w-60 bg-surface-card border-r border-border
          flex flex-col transition-transform duration-200
          ${open ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0
        `}
      >
        {/* Wordmark */}
        <div className="px-5 pt-6 pb-4 border-b border-border shrink-0">
          <p className="font-display text-xl text-text-primary">Wedding Pics</p>
        </div>

        {/* Gallery list */}
        <nav className="flex-1 overflow-y-auto py-3">
          <div className="flex items-center justify-between px-4 mb-1">
            <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
              Galerien
            </span>
            <Link
              href="/admin/galleries/new"
              onClick={() => setOpen(false)}
              className="p-1 text-text-muted hover:text-accent transition-colors"
              aria-label="Neue Galerie erstellen"
            >
              <Plus className="w-4 h-4" />
            </Link>
          </div>

          {galleries.map((gallery) => {
            const isActive = pathname.startsWith(`/admin/galleries/${gallery.id}`)
            return (
              <Link
                key={gallery.id}
                href={`/admin/galleries/${gallery.id}`}
                onClick={() => setOpen(false)}
                className={`flex flex-col px-4 py-2.5 border-l-2 transition-colors ${
                  isActive
                    ? 'border-accent bg-surface-base text-text-primary'
                    : 'border-transparent text-text-muted hover:text-text-primary hover:bg-surface-base'
                }`}
              >
                <span className="text-sm font-medium truncate">{gallery.name}</span>
                <span className="text-xs truncate opacity-60">{gallery.weddingName}</span>
              </Link>
            )
          })}

          {galleries.length === 0 && (
            <p className="px-4 py-3 text-xs text-text-muted">Noch keine Galerien</p>
          )}
        </nav>

        {/* Logout */}
        <div className="px-4 py-4 border-t border-border shrink-0">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm text-text-muted
                       hover:text-text-primary transition-colors w-full"
          >
            <LogOut className="w-4 h-4" />
            Abmelden
          </button>
        </div>
      </aside>
    </>
  )
}
```

- [ ] **Step 2: Create `apps/frontend/src/app/admin/layout.tsx`**

```typescript
'use client'

import { usePathname } from 'next/navigation'
import { AdminSidebar } from '@/components/AdminSidebar'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  // Don't render the sidebar on the login page
  if (pathname === '/admin/login') return <>{children}</>
  return (
    <div className="md:pl-60">
      <AdminSidebar />
      {children}
    </div>
  )
}
```

- [ ] **Step 3: Simplify `admin/page.tsx` — remove duplicate controls**

The "Neu" button and logout are now in the sidebar. Replace `apps/frontend/src/app/admin/page.tsx` with:

```typescript
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getAdminGalleries, ApiError } from '@/lib/api'
import { Settings } from 'lucide-react'

export default function AdminDashboardPage() {
  const router = useRouter()
  const [galleries, setGalleries] = useState<Awaited<ReturnType<typeof getAdminGalleries>>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getAdminGalleries()
      .then(setGalleries)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/admin/login')
      })
      .finally(() => setLoading(false))
  }, [router])

  return (
    <main className="min-h-screen bg-surface-base">
      <header className="flex items-center justify-between px-4 pt-6 pb-4 border-b border-border">
        <h1 className="font-display text-2xl text-text-primary">Galerien</h1>
      </header>

      <div className="px-4 py-4 space-y-3">
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-card bg-border animate-pulse" />
            ))}
          </div>
        )}

        {!loading && galleries.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center">
            <p className="text-text-muted mb-4">Noch keine Galerien. Erstelle die erste!</p>
            <Link
              href="/admin/galleries/new"
              className="px-5 py-2.5 rounded-full bg-accent text-white hover:bg-accent-hover transition-colors"
            >
              Erste Galerie erstellen
            </Link>
          </div>
        )}

        {galleries.map((gallery) => (
          <div
            key={gallery.id}
            className="bg-surface-card border border-border rounded-card p-4"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-medium text-text-primary">{gallery.name}</h2>
                <p className="text-sm text-text-muted mt-0.5">{gallery.photoCount} Fotos</p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/admin/galleries/${gallery.id}/moderate`}
                  className="text-xs px-3 py-1.5 rounded-full bg-surface-base border border-border
                             text-text-muted hover:border-accent hover:text-accent transition-colors"
                >
                  Moderieren
                </Link>
                <Link
                  href={`/admin/galleries/${gallery.id}`}
                  aria-label="Einstellungen"
                  className="p-1.5 text-text-muted hover:text-accent transition-colors"
                >
                  <Settings className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add \
  apps/frontend/src/components/AdminSidebar.tsx \
  apps/frontend/src/app/admin/layout.tsx \
  apps/frontend/src/app/admin/page.tsx
git commit -m "feat(frontend): AdminSidebar + admin layout"
```

---

### Task 5: Wire Lightbox into moderation page

**Files:**
- Modify: `apps/frontend/src/app/admin/galleries/[id]/moderate/page.tsx`

- [ ] **Step 1: Add lightbox state and click handlers to moderation page**

Replace `apps/frontend/src/app/admin/galleries/[id]/moderate/page.tsx` with:

```typescript
'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { CheckCircle, XCircle } from 'lucide-react'
import { getAdminPhotos, moderatePhoto, batchModerate, ApiError } from '@/lib/api'
import { Lightbox } from '@/components/Lightbox'
import type { AdminPhotoResponse } from '@/lib/api'

interface PageProps {
  params: Promise<{ id: string }>
}

export default function ModerationPage({ params }: PageProps) {
  const { id } = use(params)
  const router = useRouter()
  const [photos, setPhotos] = useState<AdminPhotoResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  useEffect(() => {
    getAdminPhotos(id, { status: 'PENDING' })
      .then((r) => setPhotos(r.data))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/admin/login')
      })
      .finally(() => setLoading(false))
  }, [id, router])

  async function handleModerate(photoId: string, action: 'APPROVED' | 'REJECTED') {
    await moderatePhoto(photoId, { status: action })
    setPhotos((prev) => prev.filter((p) => p.id !== photoId))
    // If lightbox is open on the moderated photo, close it
    setOpenIndex(null)
  }

  async function handleApproveAll() {
    const ids = photos.map((p) => p.id)
    if (ids.length === 0) return
    await batchModerate({ action: 'approve', photoIds: ids })
    setPhotos([])
    setOpenIndex(null)
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-surface-base px-4 py-6">
        <div className="grid grid-cols-2 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="aspect-square rounded-card bg-border animate-pulse" />
          ))}
        </div>
      </main>
    )
  }

  if (photos.length === 0) {
    return (
      <main className="min-h-screen bg-surface-base flex flex-col items-center justify-center px-4">
        <p className="font-display text-2xl text-text-primary mb-2">Alles erledigt!</p>
        <p className="text-text-muted">Keine ausstehenden Fotos.</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-surface-base">
      <header className="flex items-center justify-between px-4 pt-6 pb-4 border-b border-border sticky top-0 bg-surface-base z-10">
        <div>
          <h1 className="font-medium text-text-primary">{photos.length} ausstehend</h1>
        </div>
        <button
          onClick={handleApproveAll}
          className="text-sm px-4 py-2 rounded-full bg-success text-white hover:opacity-90 transition-opacity"
        >
          Alle freigeben
        </button>
      </header>

      <div className="grid grid-cols-2 gap-2 p-2">
        {photos.map((photo, index) => (
          <div key={photo.id} className="relative rounded-card overflow-hidden bg-surface-card">
            <button
              className="w-full text-left"
              onClick={() => setOpenIndex(index)}
              aria-label="Foto vergrößern"
            >
              <Image
                src={photo.thumbUrl}
                alt="Ausstehendes Foto"
                width={400}
                height={400}
                className="w-full aspect-square object-cover"
                unoptimized
              />
            </button>
            {photo.guestName && (
              <p className="absolute top-2 left-2 text-xs text-white bg-black/50 px-2 py-0.5 rounded-full pointer-events-none">
                {photo.guestName}
              </p>
            )}
            <div className="absolute bottom-0 left-0 right-0 flex">
              <button
                onClick={() => handleModerate(photo.id, 'REJECTED')}
                className="flex-1 py-3 bg-error/80 hover:bg-error flex items-center justify-center transition-colors"
                aria-label="Ablehnen"
              >
                <XCircle className="w-6 h-6 text-white" />
              </button>
              <button
                onClick={() => handleModerate(photo.id, 'APPROVED')}
                className="flex-1 py-3 bg-success/80 hover:bg-success flex items-center justify-center transition-colors"
                aria-label="Freigeben"
              >
                <CheckCircle className="w-6 h-6 text-white" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {openIndex !== null && (
        <Lightbox
          photos={photos}
          index={openIndex}
          onClose={() => setOpenIndex(null)}
          onNext={() => setOpenIndex((i) => (i !== null ? Math.min(i + 1, photos.length - 1) : null))}
          onPrev={() => setOpenIndex((i) => (i !== null ? Math.max(i - 1, 0) : null))}
        />
      )}
    </main>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/app/admin/galleries/[id]/moderate/page.tsx
git commit -m "feat(frontend): lightbox on moderation page"
```

---

### Task 6: Add photo section + Lightbox to gallery settings page

**Files:**
- Modify: `apps/frontend/src/app/admin/galleries/[id]/page.tsx`

The settings page currently only shows the edit form. Add a read-only approved-photos grid below the form, with lightbox support. Photos are fetched via `getAdminPhotos(id, { status: 'APPROVED' })`.

- [ ] **Step 1: Update gallery settings page**

Add photo fetching and lightbox to the existing `apps/frontend/src/app/admin/galleries/[id]/page.tsx`. Replace the file:

```typescript
'use client'

import { useEffect, useState, use, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { getAdminGalleries, updateGallery, deleteGallery, getAdminPhotos, ApiError } from '@/lib/api'
import { Lightbox } from '@/components/Lightbox'
import type { AdminPhotoResponse } from '@/lib/api'

interface PageProps {
  params: Promise<{ id: string }>
}

type GalleryData = Awaited<ReturnType<typeof getAdminGalleries>>[number]

export default function GallerySettingsPage({ params }: PageProps) {
  const { id } = use(params)
  const router = useRouter()

  const [gallery, setGallery] = useState<GalleryData | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [photos, setPhotos] = useState<AdminPhotoResponse[]>([])
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [layout, setLayout] = useState<'MASONRY' | 'GRID'>('MASONRY')
  const [guestNameMode, setGuestNameMode] = useState<'OPTIONAL' | 'REQUIRED' | 'HIDDEN'>('OPTIONAL')
  const [allowGuestDownload, setAllowGuestDownload] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    getAdminGalleries()
      .then((galleries) => {
        const found = galleries.find((g) => g.id === id)
        if (!found) { setLoadError(true); return }
        setGallery(found)
        setName(found.name)
        setDescription(found.description ?? '')
        setLayout(found.layout)
        setGuestNameMode(found.guestNameMode)
        setAllowGuestDownload(found.allowGuestDownload)
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/admin/login')
        else setLoadError(true)
      })

    getAdminPhotos(id, { status: 'APPROVED' })
      .then((r) => setPhotos(r.data))
      .catch(() => { /* non-critical — photos section just stays empty */ })
  }, [id, router])

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setSaveError(null)
    setSaving(true)
    setSaved(false)
    try {
      await updateGallery(id, {
        name,
        description: description.trim() || null,
        layout,
        guestNameMode,
        allowGuestDownload,
      })
      setSaved(true)
    } catch {
      setSaveError('Speichern fehlgeschlagen. Bitte versuche es erneut.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteGallery(id)
      router.replace('/admin')
    } catch {
      setSaveError('Löschen fehlgeschlagen.')
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (loadError) {
    return (
      <main className="min-h-screen bg-surface-base flex flex-col items-center justify-center px-4">
        <p className="text-text-muted mb-4">Galerie nicht gefunden.</p>
        <Link href="/admin" className="text-accent hover:underline">Zurück zur Übersicht</Link>
      </main>
    )
  }

  if (!gallery) {
    return (
      <main className="min-h-screen bg-surface-base px-4 py-6">
        <div className="space-y-3 max-w-lg">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-card bg-border animate-pulse" />
          ))}
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-surface-base">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4 border-b border-border">
        <Link href="/admin" className="p-1.5 text-text-muted hover:text-text-primary transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-2xl text-text-primary truncate">{gallery.name}</h1>
          <p className="text-xs text-text-muted font-mono mt-0.5">/g/{gallery.slug}</p>
        </div>
      </header>

      <form onSubmit={handleSave} className="px-4 py-6 space-y-5 max-w-lg">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-text-primary mb-1">
            Name
          </label>
          <input
            id="name"
            type="text"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-2.5 rounded-card border border-border focus:outline-none focus:border-accent bg-surface-card text-text-primary"
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-text-primary mb-1">
            Beschreibung <span className="text-text-muted font-normal">(optional)</span>
          </label>
          <textarea
            id="description"
            rows={2}
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-4 py-2.5 rounded-card border border-border focus:outline-none focus:border-accent bg-surface-card text-text-primary resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">Layout</label>
          <div className="flex gap-3">
            {(['MASONRY', 'GRID'] as const).map((l) => (
              <label key={l} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="layout"
                  value={l}
                  checked={layout === l}
                  onChange={() => setLayout(l)}
                  className="accent-accent"
                />
                <span className="text-sm text-text-primary">{l === 'MASONRY' ? 'Masonry' : 'Raster'}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">Gastname</label>
          <div className="flex flex-col gap-2">
            {([['OPTIONAL', 'Optional'], ['REQUIRED', 'Pflichtfeld'], ['HIDDEN', 'Ausgeblendet']] as const).map(([val, label]) => (
              <label key={val} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="guestNameMode"
                  value={val}
                  checked={guestNameMode === val}
                  onChange={() => setGuestNameMode(val)}
                  className="accent-accent"
                />
                <span className="text-sm text-text-primary">{label}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={allowGuestDownload}
            onChange={(e) => setAllowGuestDownload(e.target.checked)}
            className="w-4 h-4 accent-accent"
          />
          <span className="text-sm text-text-primary">Gäste dürfen Fotos herunterladen</span>
        </label>

        {saveError && <p className="text-sm text-error">{saveError}</p>}
        {saved && <p className="text-sm text-success">Gespeichert ✓</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-50"
        >
          {saving ? 'Wird gespeichert…' : 'Speichern'}
        </button>
      </form>

      {/* Approved photos */}
      {photos.length > 0 && (
        <section className="px-4 pb-8 max-w-lg">
          <h2 className="text-sm font-medium text-text-muted uppercase tracking-wide mb-3">
            Freigegebene Fotos ({photos.length})
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo, index) => (
              <button
                key={photo.id}
                onClick={() => setOpenIndex(index)}
                className="relative aspect-square overflow-hidden rounded-card group"
                aria-label="Foto vergrößern"
              >
                <Image
                  src={photo.thumbUrl}
                  alt={photo.guestName ?? 'Hochzeitsfoto'}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform duration-200"
                  unoptimized
                />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Danger zone */}
      <div className="px-4 pb-10 max-w-lg">
        <div className="border border-error/30 rounded-card p-4">
          <p className="text-sm font-medium text-text-primary mb-1">Galerie löschen</p>
          <p className="text-xs text-text-muted mb-3">
            Löscht die Galerie und alle zugehörigen Fotos unwiderruflich.
          </p>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-error text-error text-sm hover:bg-error hover:text-white transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Galerie löschen
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 rounded-full bg-error text-white text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {deleting ? 'Wird gelöscht…' : 'Wirklich löschen'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-4 py-2 rounded-full border border-border text-text-muted text-sm hover:border-accent hover:text-accent transition-colors"
              >
                Abbrechen
              </button>
            </div>
          )}
        </div>
      </div>

      {openIndex !== null && (
        <Lightbox
          photos={photos}
          index={openIndex}
          onClose={() => setOpenIndex(null)}
          onNext={() => setOpenIndex((i) => (i !== null ? Math.min(i + 1, photos.length - 1) : null))}
          onPrev={() => setOpenIndex((i) => (i !== null ? Math.max(i - 1, 0) : null))}
        />
      )}
    </main>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/app/admin/galleries/[id]/page.tsx
git commit -m "feat(frontend): approved photo grid + lightbox on gallery settings page"
```

---

### Task 7: Run all unit tests + E2E page objects + E2E tests

**Files:**
- Create: `apps/frontend/e2e/pages/LightboxPage.ts`
- Modify: `apps/frontend/e2e/guest-gallery.spec.ts`
- Modify: `apps/frontend/e2e/admin-galleries.spec.ts`

- [ ] **Step 1: Run unit tests — verify all pass**

```bash
pnpm --filter @wedding/frontend run test
```

Expected: All tests pass (existing + new lightbox + guest-nav tests).

- [ ] **Step 2: Create `LightboxPage.ts` page object**

Create `apps/frontend/e2e/pages/LightboxPage.ts`:

```typescript
import { type Page, type Locator } from '@playwright/test'

export class LightboxPage {
  readonly overlay: Locator
  readonly closeButton: Locator
  readonly nextButton: Locator
  readonly prevButton: Locator
  readonly photo: Locator

  constructor(private page: Page) {
    this.overlay = page.locator('.fixed.inset-0.z-50')
    this.closeButton = page.getByRole('button', { name: /schließen/i })
    this.nextButton = page.getByRole('button', { name: /nächstes/i })
    this.prevButton = page.getByRole('button', { name: /vorheriges/i })
    this.photo = page.locator('.fixed.inset-0.z-50 img, .fixed.inset-0.z-50 video').first()
  }
}
```

- [ ] **Step 3: Add lightbox + nav E2E tests to `guest-gallery.spec.ts`**

Open `apps/frontend/e2e/guest-gallery.spec.ts` and append these new test blocks after the existing `'Guest Upload'` describe block:

```typescript
import { LightboxPage } from './pages/LightboxPage'

// ... (keep all existing tests) ...

test.describe('Guest Nav', () => {
  test('nav bar is visible on gallery page', async ({ page }) => {
    await page.goto(`/g/${TEST_GALLERY_SLUG}`)
    await expect(page.getByRole('navigation')).toBeVisible()
    await expect(page.getByRole('link', { name: /galerie/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /hochladen/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /slideshow/i })).toBeVisible()
  })

  test('upload link in nav navigates to upload page', async ({ page }) => {
    await page.goto(`/g/${TEST_GALLERY_SLUG}`)
    await page.getByRole('link', { name: /hochladen/i }).click()
    await expect(page).toHaveURL(`/g/${TEST_GALLERY_SLUG}/upload`)
  })

  test('slideshow link in nav navigates to slideshow page', async ({ page }) => {
    await page.goto(`/g/${TEST_GALLERY_SLUG}`)
    await page.getByRole('link', { name: /slideshow/i }).click()
    await expect(page).toHaveURL(`/g/${TEST_GALLERY_SLUG}/slideshow`)
  })
})

test.describe('Guest Gallery Lightbox', () => {
  test.beforeEach(async ({ request }) => {
    // Ensure at least one approved photo exists by uploading + approving via API
    const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000'
    const uploadRes = await request.post(`${API_URL}/api/v1/g/${TEST_GALLERY_SLUG}/upload`, {
      multipart: {
        file: {
          name: 'lightbox-test.png',
          mimeType: 'image/png',
          buffer: Buffer.concat([TINY_PNG, Buffer.from(Math.random().toString())]),
        },
      },
    })
    if (!uploadRes.ok()) return // gallery may already have photos

    const uploaded = await uploadRes.json()
    await request.post(`${API_URL}/api/v1/admin/photos/batch`, {
      data: { action: 'approve', photoIds: [uploaded.id] },
    })
  })

  test('clicking a photo opens the lightbox', async ({ page }) => {
    await page.goto(`/g/${TEST_GALLERY_SLUG}`)
    const lightbox = new LightboxPage(page)
    const firstPhoto = page.locator('[role="button"]').first()
    await expect(firstPhoto).toBeVisible()
    await firstPhoto.click()
    await expect(lightbox.overlay).toBeVisible()
    await expect(lightbox.closeButton).toBeVisible()
  })

  test('close button dismisses the lightbox', async ({ page }) => {
    await page.goto(`/g/${TEST_GALLERY_SLUG}`)
    const lightbox = new LightboxPage(page)
    await page.locator('[role="button"]').first().click()
    await expect(lightbox.overlay).toBeVisible()
    await lightbox.closeButton.click()
    await expect(lightbox.overlay).not.toBeVisible()
  })

  test('Escape key closes the lightbox', async ({ page }) => {
    await page.goto(`/g/${TEST_GALLERY_SLUG}`)
    const lightbox = new LightboxPage(page)
    await page.locator('[role="button"]').first().click()
    await expect(lightbox.overlay).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(lightbox.overlay).not.toBeVisible()
  })
})
```

- [ ] **Step 4: Add admin sidebar E2E tests to `admin-galleries.spec.ts`**

Append to the existing `'Admin Dashboard'` describe block in `apps/frontend/e2e/admin-galleries.spec.ts`:

```typescript
test.describe('Admin Sidebar', () => {
  test('sidebar is visible on admin dashboard', async ({ adminPage }) => {
    await adminPage.goto('/admin')
    await expect(adminPage.locator('aside')).toBeVisible()
  })

  test('test gallery appears in sidebar', async ({ adminPage }) => {
    await adminPage.goto('/admin')
    await expect(
      adminPage.locator('aside').getByText(TEST_GALLERY_NAME)
    ).toBeVisible()
  })

  test('clicking gallery in sidebar navigates to settings', async ({ adminPage }) => {
    await adminPage.goto('/admin')
    await adminPage.locator('aside').getByText(TEST_GALLERY_NAME).click()
    await expect(adminPage).toHaveURL(/\/admin\/galleries\/.+(?<!\/moderate)$/)
  })

  test('sidebar is not shown on login page', async ({ page }) => {
    await page.goto('/admin/login')
    await expect(page.locator('aside')).not.toBeVisible()
  })
})
```

- [ ] **Step 5: Commit**

```bash
git add \
  apps/frontend/e2e/pages/LightboxPage.ts \
  apps/frontend/e2e/guest-gallery.spec.ts \
  apps/frontend/e2e/admin-galleries.spec.ts
git commit -m "test(frontend): E2E tests for lightbox, guest nav, and admin sidebar"
```
