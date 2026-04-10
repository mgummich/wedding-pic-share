'use client'

import { useState, useCallback } from 'react'
import { PhotoGrid } from '@/components/PhotoGrid.js'
import { UploadButton } from '@/components/UploadButton.js'
import { EmptyState } from '@/components/EmptyState.js'
import { useSSE } from '@/lib/sse.js'
import { getGallery } from '@/lib/api.js'
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
    </>
  )
}
