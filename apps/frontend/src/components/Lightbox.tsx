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
