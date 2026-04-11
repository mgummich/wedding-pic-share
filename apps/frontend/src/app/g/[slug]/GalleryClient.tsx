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
          // photos.length is captured from the closure — safe because Math.min/Math.max
          // guards against going out of bounds if SSE adds photos while lightbox is open.
          onNext={() => setOpenIndex((i) => (i !== null ? Math.min(i + 1, photos.length - 1) : null))}
          onPrev={() => setOpenIndex((i) => (i !== null ? Math.max(i - 1, 0) : null))}
        />
      )}
    </>
  )
}
