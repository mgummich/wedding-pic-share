'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import { CheckCircle, XCircle, ArrowLeft } from 'lucide-react'
import { getAdminPhotos, moderatePhoto, batchModerate, ApiError } from '@/lib/api'
import { Lightbox } from '@/components/Lightbox'
import type { AdminPhotoResponse } from '@/lib/api'
import { useAdminI18n } from '@/components/AdminLocaleContext'
import { useToast } from '@/components/ToastProvider'

const APPROVE_ALL_UNDO_MS = process.env.NODE_ENV === 'test' ? 0 : 5000

export default function ModerationPage() {
  const params = useParams<{ id: string }>()
  const id = params.id ?? ''
  const router = useRouter()
  const { t } = useAdminI18n()
  const { showToast } = useToast()
  const [photos, setPhotos] = useState<AdminPhotoResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingApproveAllIds, setPendingApproveAllIds] = useState<string[] | null>(null)
  const approveAllTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!id) return
    let active = true
    getAdminPhotos(id, { status: 'PENDING' })
      .then((r) => {
        if (!active) return
        setPhotos(r.data)
        setNextCursor(r.pagination.nextCursor)
        setHasMore(r.pagination.hasMore)
      })
      .catch((err) => {
        if (!active) return
        if (err instanceof ApiError && err.status === 401) router.replace('/admin/login')
        else setLoadError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [id, router])

  useEffect(() => {
    return () => {
      if (approveAllTimerRef.current) {
        clearTimeout(approveAllTimerRef.current)
      }
    }
  }, [])

  function handleBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }
    router.push('/admin')
  }

  async function handleModerate(photoId: string, action: 'APPROVED' | 'REJECTED') {
    setActionError(null)
    setIsSubmitting(true)
    try {
      await moderatePhoto(photoId, { status: action })
      setPhotos((prev) => prev.filter((p) => p.id !== photoId))
      setOpenIndex(null)
    } catch {
      const message = t('moderation.error.moderateFailed')
      setActionError(message)
      showToast(message, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function runApproveAll(ids: string[]) {
    setPendingApproveAllIds(null)
    if (ids.length === 0) return
    setActionError(null)
    setIsSubmitting(true)
    try {
      const result = await batchModerate({ action: 'approve', photoIds: ids })
      if (result.failed.length > 0) {
        const failedIds = new Set(result.failed)
        setPhotos((prev) => prev.filter((photo) => failedIds.has(photo.id)))
        const message = t('moderation.error.partialApprove', { count: result.failed.length })
        setActionError(message)
        showToast(message, 'error')
      } else {
        setPhotos([])
        showToast(t('moderation.approveAllSuccess'), 'success')
      }
      setOpenIndex(null)
    } catch {
      const message = t('moderation.error.approveAllFailed')
      setActionError(message)
      showToast(message, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleApproveAll() {
    if (pendingApproveAllIds || isSubmitting) return
    const ids = photos.map((p) => p.id)
    if (ids.length === 0) return
    setPendingApproveAllIds(ids)
    setActionError(null)
    approveAllTimerRef.current = setTimeout(() => {
      approveAllTimerRef.current = null
      void runApproveAll(ids)
    }, APPROVE_ALL_UNDO_MS)
  }

  function handleUndoApproveAll() {
    if (approveAllTimerRef.current) {
      clearTimeout(approveAllTimerRef.current)
      approveAllTimerRef.current = null
    }
    setPendingApproveAllIds(null)
  }

  async function handleLoadMore() {
    if (!hasMore || !nextCursor || loadingMore) return
    setActionError(null)
    setLoadingMore(true)
    try {
      const result = await getAdminPhotos(id, { status: 'PENDING', cursor: nextCursor })
      setPhotos((prev) => {
        const existingIds = new Set(prev.map((photo) => photo.id))
        const next = result.data.filter((photo) => !existingIds.has(photo.id))
        return [...prev, ...next]
      })
      setNextCursor(result.pagination.nextCursor)
      setHasMore(result.pagination.hasMore)
    } catch {
      const message = t('moderation.error.loadMoreFailed')
      setActionError(message)
      showToast(message, 'error')
    } finally {
      setLoadingMore(false)
    }
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

  if (!loadError && photos.length === 0 && !hasMore) {
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
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            aria-label={t('moderation.backAria')}
            className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="font-medium text-text-primary">{t('moderation.pending', { count: photos.length })}</h1>
        </div>
        <button
          onClick={handleApproveAll}
          disabled={isSubmitting || pendingApproveAllIds !== null}
          className="text-sm px-4 py-2 rounded-full bg-success text-white hover:opacity-90 transition-opacity"
        >
          {t('moderation.approveAll')}
        </button>
      </header>

      {pendingApproveAllIds && (
        <div className="px-4 py-3 border-b border-border bg-accent/10 flex items-center justify-between gap-3" role="status" aria-live="polite">
          <p className="text-sm text-text-primary">{t('moderation.undo.message')}</p>
          <button
            type="button"
            onClick={handleUndoApproveAll}
            className="text-sm px-3 py-1.5 rounded-full border border-border text-text-muted hover:border-accent hover:text-accent transition-colors"
          >
            {t('moderation.undo.action')}
          </button>
        </div>
      )}

      {loadError && (
        <div className="px-4 py-3">
          <p className="text-sm text-error">{t('moderation.error.loadFailed')}</p>
        </div>
      )}

      {actionError && (
        <div className="px-4 py-3">
          <p className="text-sm text-error">{actionError}</p>
        </div>
      )}

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
                alt={photo.guestName
                  ? t('lightbox.photoAltByGuest', { guest: photo.guestName })
                  : t('moderation.pendingPhotoAlt', { index: index + 1 })}
                width={400}
                height={400}
                className="w-full aspect-square object-cover"
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
                disabled={isSubmitting}
                className="flex-1 py-3 bg-error/80 hover:bg-error flex items-center justify-center transition-colors"
                aria-label={t('moderation.rejectAria')}
              >
                <XCircle className="w-6 h-6 text-white" />
              </button>
              <button
                onClick={() => handleModerate(photo.id, 'APPROVED')}
                disabled={isSubmitting}
                className="flex-1 py-3 bg-success/80 hover:bg-success flex items-center justify-center transition-colors"
                aria-label={t('moderation.approveAria')}
              >
                <CheckCircle className="w-6 h-6 text-white" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {hasMore && (
        <div className="flex justify-center px-4 pb-6">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="text-sm px-4 py-2 rounded-full border border-border text-text-muted hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
          >
            {loadingMore ? t('moderation.loadingMore') : t('moderation.loadMore')}
          </button>
        </div>
      )}

      {openIndex !== null && (
        <Lightbox
          photos={photos}
          index={openIndex}
          onClose={() => setOpenIndex(null)}
          onNext={() => setOpenIndex((i) => (i !== null ? Math.min(i + 1, photos.length - 1) : null))}
          onPrev={() => setOpenIndex((i) => (i !== null ? Math.max(i - 1, 0) : null))}
          t={t}
        />
      )}
    </main>
  )
}
