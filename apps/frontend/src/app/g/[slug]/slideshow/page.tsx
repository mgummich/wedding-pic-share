'use client'

import { useState, useEffect, useCallback, use } from 'react'
import Image from 'next/image'
import { getGallery } from '@/lib/api'
import { useSSE } from '@/lib/sse'
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

  if (photos.length === 0) {
    return (
      <div
        className="fixed inset-0 flex flex-col items-center justify-center"
        style={{ background: 'var(--slideshow-bg)', color: 'var(--slideshow-text)' }}
      >
        <p className="font-display text-3xl mb-4">{galleryName}</p>
        <p className="text-lg opacity-70">Noch keine Fotos freigegeben.</p>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0"
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

      {/* Footer: gallery name + QR hint */}
      <div
        className="absolute bottom-0 left-0 right-0 z-20 flex items-end justify-between p-8"
        style={{ color: 'var(--slideshow-text)' }}
      >
        <div>
          <p className="font-display text-2xl">{galleryName}</p>
          {current?.guestName && (
            <p className="text-base opacity-60 mt-1">{current.guestName}</p>
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
  )
}
