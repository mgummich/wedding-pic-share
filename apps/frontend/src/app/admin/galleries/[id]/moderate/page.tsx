'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { CheckCircle, XCircle } from 'lucide-react'
import { getAdminPhotos, moderatePhoto, batchModerate, ApiError } from '@/lib/api'
import { Lightbox } from '@/components/Lightbox'
import type { AdminPhotoResponse } from '@/lib/api'
import { useAdminI18n } from '@/components/AdminLocaleContext'

interface PageProps {
  params: Promise<{ id: string }>
}

export default function ModerationPage({ params }: PageProps) {
  const { id } = use(params)
  const router = useRouter()
  const { t } = useAdminI18n()
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
        <p className="font-display text-2xl text-text-primary mb-2">{t('moderation.doneTitle')}</p>
        <p className="text-text-muted">{t('moderation.doneDescription')}</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-surface-base">
      <header className="flex items-center justify-between px-4 pt-6 pb-4 border-b border-border sticky top-0 bg-surface-base z-10">
        <div>
          <h1 className="font-medium text-text-primary">{t('moderation.pending', { count: photos.length })}</h1>
        </div>
        <button
          onClick={handleApproveAll}
          className="text-sm px-4 py-2 rounded-full bg-success text-white hover:opacity-90 transition-opacity"
        >
          {t('moderation.approveAll')}
        </button>
      </header>

      <div className="grid grid-cols-2 gap-2 p-2">
        {photos.map((photo, index) => (
          <div key={photo.id} className="relative rounded-card overflow-hidden bg-surface-card">
            <button
              className="w-full text-left"
              onClick={() => setOpenIndex(index)}
              aria-label={t('moderation.photoEnlargeAria')}
            >
              <Image
                src={photo.thumbUrl}
                alt={t('moderation.pendingPhotoAlt')}
                width={400}
                height={400}
                className="w-full aspect-square object-cover"
                unoptimized
              />
            </button>
            {photo.guestName && (
              <p className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white">
                {photo.guestName}
              </p>
            )}
            <div className="absolute bottom-0 left-0 right-0 flex">
              <button
                onClick={() => handleModerate(photo.id, 'REJECTED')}
                className="flex-1 py-3 bg-error/80 hover:bg-error flex items-center justify-center transition-colors"
                aria-label={t('moderation.rejectAria')}
              >
                <XCircle className="w-6 h-6 text-white" />
              </button>
              <button
                onClick={() => handleModerate(photo.id, 'APPROVED')}
                className="flex-1 py-3 bg-success/80 hover:bg-success flex items-center justify-center transition-colors"
                aria-label={t('moderation.approveAria')}
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
