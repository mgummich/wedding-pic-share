'use client'

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react'
import type { PhotoResponse } from '@wedding/shared'
import type { AdminMessageKey } from '@/lib/adminI18n'
import { useGuestI18n } from '@/lib/guestI18n'

type TranslateFn = (key: AdminMessageKey, params?: Record<string, string | number>) => string

interface LightboxProps {
  photos: PhotoResponse[]
  index: number
  onClose: () => void
  onNext: () => void
  onPrev: () => void
  allowDownload?: boolean
  t?: TranslateFn
}

export function Lightbox({ photos, index, onClose, onNext, onPrev, allowDownload, t: translate }: LightboxProps) {
  const { t: guestT } = useGuestI18n()
  const t = translate ?? guestT
  const photo = photos[index]
  const hasPrev = index > 0
  const hasNext = index < photos.length - 1
  const pointerStart = useRef<{ x: number; y: number } | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const lastFocusedElementRef = useRef<HTMLElement | null>(null)
  const keyboardHandlersRef = useRef({
    onClose,
    onNext,
    onPrev,
    hasPrev,
    hasNext,
  })

  useEffect(() => {
    keyboardHandlersRef.current = {
      onClose,
      onNext,
      onPrev,
      hasPrev,
      hasNext,
    }
  }, [onClose, onNext, onPrev, hasPrev, hasNext])

  // Keep one listener and read latest handlers from a ref.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const handlers = keyboardHandlersRef.current
      if (e.key === 'Escape') handlers.onClose()
      if (e.key === 'ArrowRight' && handlers.hasNext) handlers.onNext()
      if (e.key === 'ArrowLeft' && handlers.hasPrev) handlers.onPrev()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  // Scroll lock
  // NOTE: If two Lightbox instances are ever open simultaneously (currently impossible
  // given parent usage), the second instance captures 'hidden' as the prev value and
  // restores it on unmount, leaving the body locked. Safe for single-instance usage.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  useEffect(() => {
    lastFocusedElementRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    closeButtonRef.current?.focus()
    return () => {
      lastFocusedElementRef.current?.focus()
    }
  }, [])

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return
    const container = dialogRef.current
    if (!container) return
    const focusable = container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])'
    )
    if (focusable.length === 0) {
      event.preventDefault()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    } else if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    }
  }

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
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label={t('lightbox.photoAltDefault')}
      tabIndex={-1}
      onKeyDown={handleDialogKeyDown}
      onClick={onClose}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => { pointerStart.current = null }}
    >
      {/* Close */}
      <button
        ref={closeButtonRef}
        onClick={(e) => { e.stopPropagation(); onClose() }}
        className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 text-white
                   hover:bg-black/70 transition-colors"
        aria-label={t('lightbox.close')}
      >
        <X className="w-6 h-6" />
      </button>

      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 rounded-full bg-black/50 px-3 py-1 text-xs text-white/90">
        {t('lightbox.counter', { current: index + 1, total: photos.length })}
      </div>

      {/* Download */}
      {allowDownload && photo.mediaType === 'IMAGE' && (
        <a
          href={`${photo.displayUrl}&download=1`}
          download
          onClick={(e) => e.stopPropagation()}
          className="absolute top-4 right-16 z-10 p-2 rounded-full bg-black/50 text-white
                     hover:bg-black/70 transition-colors"
          aria-label={t('lightbox.download')}
        >
          <Download className="w-6 h-6" />
        </a>
      )}

      {/* Prev */}
      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); onPrev() }}
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full
                     bg-black/50 text-white hover:bg-black/70 transition-colors"
          aria-label={t('lightbox.prev')}
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
          aria-label={t('lightbox.next')}
        >
          <ChevronRight className="w-8 h-8" />
        </button>
      )}

      {/* Media — stop propagation so clicks on the image don't close the lightbox */}
      <div
        className="relative"
        onClick={(e) => e.stopPropagation()}
      >
        {photo.mediaType === 'VIDEO' ? (
          <video
            key={photo.id}
            src={photo.displayUrl}
            poster={photo.thumbUrl}
            controls
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
            alt={photo.guestName
              ? t('lightbox.photoAltByGuest', { guest: photo.guestName })
              : t('lightbox.photoAltDefault')}
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
