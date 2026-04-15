'use client'

import { useState, useCallback } from 'react'
import { PhotoGrid } from '@/components/PhotoGrid'
import { UploadButton } from '@/components/UploadButton'
import { EmptyState } from '@/components/EmptyState'
import { Lightbox } from '@/components/Lightbox'
import { useGuestI18n } from '@/lib/guestI18n'
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
  const { t } = useGuestI18n()
  const [photos, setPhotos] = useState(initialPhotos)
  const [cursor, setCursor] = useState(initialCursor)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [loading, setLoading] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [liveStatus, setLiveStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'closed'>('connecting')
  const [liveAnnouncement, setLiveAnnouncement] = useState('')

  // SSE: prepend new photos approved by admin in real-time
  useSSE(gallery.slug, {
    onPhoto: useCallback((photo: PhotoResponse) => {
      setPhotos((prev) => {
        if (prev.some((p) => p.id === photo.id)) return prev
        return [photo, ...prev]
      })
      setLiveAnnouncement(t('guest.gallery.live.newPhoto'))
    }, [t]),
    onConnectionStateChange: useCallback((state: 'connecting' | 'connected' | 'reconnecting' | 'closed') => {
      setLiveStatus(state)
      if (state === 'reconnecting') {
        setLiveAnnouncement(t('guest.gallery.live.reconnecting'))
      }
      if (state === 'connected') {
        setLiveAnnouncement(t('guest.gallery.live.connected'))
      }
    }, [t]),
  })

  async function loadMore() {
    if (!hasMore || loading || !cursor) return
    setLoadMoreError(null)
    setLoading(true)
    try {
      const result = await getGallery(gallery.slug, { cursor })
      setPhotos((prev) => [...prev, ...result.data])
      setCursor(result.pagination.nextCursor)
      setHasMore(result.pagination.hasMore)
    } catch {
      setLoadMoreError(t('guest.gallery.loadMoreError'))
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
          title={t('guest.gallery.emptyTitle')}
          description={t('guest.gallery.emptyDescription')}
        />
        <UploadButton gallerySlug={gallery.slug} isEmpty />
      </>
    )
  }

  return (
    <>
      <p className="sr-only" aria-live="polite">{liveAnnouncement}</p>
      {liveStatus === 'reconnecting' && (
        <div className="mb-3 rounded-card border border-border bg-surface-card px-3 py-2">
          <p className="text-xs text-text-muted" aria-live="polite">
            {t('guest.gallery.live.reconnecting')}
          </p>
        </div>
      )}

      <PhotoGrid
        photos={photos}
        layout={gallery.layout}
        onPhotoClick={handlePhotoClick}
      />

      {hasMore && (
        <div className="flex justify-center mt-8 pb-24">
          <div className="space-y-2">
            <button
              onClick={loadMore}
              disabled={loading}
              className="px-6 py-2.5 rounded-full border border-border text-text-muted
                       hover:border-accent hover:text-accent transition-colors
                       disabled:opacity-50"
            >
              {loading ? t('guest.gallery.loadingMore') : t('guest.gallery.loadMore')}
            </button>
            {loadMoreError && <p className="text-xs text-error text-center">{loadMoreError}</p>}
            {loading && (
              <div className="grid grid-cols-2 gap-2 pt-2">
                {[1, 2, 3, 4].map((item) => (
                  <div key={item} className="aspect-square rounded-card bg-border animate-pulse" />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <UploadButton gallerySlug={gallery.slug} />

      {gallery.allowGuestDownload && (
        <div className="flex justify-center mt-4 pb-4">
          <a
            href={`/api/v1/g/${gallery.slug}/download`}
            download
            className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-border
                       text-text-muted hover:border-accent hover:text-accent transition-colors text-sm"
          >
            {t('guest.gallery.downloadAll')}
          </a>
        </div>
      )}

      {openIndex !== null && (
        <Lightbox
          photos={photos}
          index={openIndex}
          onClose={() => setOpenIndex(null)}
          // photos.length is captured from the closure — safe because Math.min/Math.max
          // guards against going out of bounds if SSE adds photos while lightbox is open.
          onNext={() => setOpenIndex((i) => (i !== null ? Math.min(i + 1, photos.length - 1) : null))}
          onPrev={() => setOpenIndex((i) => (i !== null ? Math.max(i - 1, 0) : null))}
          allowDownload={gallery.allowGuestDownload}
          t={t}
        />
      )}
    </>
  )
}
