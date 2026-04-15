'use client'

import { useMemo, useRef, useState } from 'react'
import { Camera, RefreshCw, Upload, Loader2 } from 'lucide-react'
import { adminUploadFile, ApiError } from '@/lib/api'
import { getUploadErrorMessage, validateGuestName, validateUploadFile } from '@/lib/uploadValidation'
import { isTransientUploadError, runWithRetry } from '@/lib/uploadRetry'
import { runWithConcurrency } from '@/lib/asyncPool'
import { useAdminI18n } from './AdminLocaleContext'
import type { UploadResponse } from '@wedding/shared'

type UploadQueueItem = {
  id: string
  file: File
  status: 'queued' | 'uploading' | 'approved' | 'pending' | 'error'
  error?: string
  result?: UploadResponse
}

const MAX_UPLOAD_ATTEMPTS = 3
const UPLOAD_RETRY_BACKOFF_MS = [500, 1500]
const ADMIN_UPLOAD_CONCURRENCY = 3

type AdminUploadPanelProps = {
  galleryId: string
  guestNameMode: 'OPTIONAL' | 'REQUIRED' | 'HIDDEN'
  onApprovedUploads?: () => Promise<void> | void
}

export function AdminUploadPanel({
  galleryId,
  guestNameMode,
  onApprovedUploads,
}: AdminUploadPanelProps) {
  const { locale, t } = useAdminI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const [queue, setQueue] = useState<UploadQueueItem[]>([])
  const [guestName, setGuestName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [autoApproveMode, setAutoApproveMode] = useState(false)
  const [isDragActive, setIsDragActive] = useState(false)

  const processedCount = useMemo(
    () => queue.filter((item) => item.status === 'approved' || item.status === 'pending' || item.status === 'error').length,
    [queue]
  )
  const progressPercent = queue.length > 0
    ? Math.min(100, Math.round((processedCount / queue.length) * 100))
    : 0

  function toUploadErrorMessage(error: unknown): string {
    if (error instanceof ApiError) {
      return getUploadErrorMessage(error.status, locale) ?? t('adminUpload.error.uploadFailed')
    }
    return t('adminUpload.error.network')
  }

  function appendSelectedFiles(selected: File[]) {
    setQueue((prev) => [
      ...prev,
      ...selected.map((file) => {
        const validationError = validateUploadFile(file, locale)
        return {
          id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
          file,
          status: validationError ? 'error' : 'queued',
          error: validationError ?? undefined,
        } satisfies UploadQueueItem
      }),
    ])
    setFormError(null)
    setSummary(null)
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? [])
    if (selected.length === 0) return
    appendSelectedFiles(selected)
    event.target.value = ''
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragActive(false)
    const selected = Array.from(event.dataTransfer.files ?? [])
    if (selected.length === 0) return
    appendSelectedFiles(selected)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const queuedItems = queue.filter((item) => item.status === 'queued')
    const normalizedGuestName = guestName.trim()

    if (queuedItems.length === 0) {
      setFormError(t('adminUpload.error.noFiles'))
      return
    }

    if (guestNameMode === 'REQUIRED' && !normalizedGuestName) {
      setFormError(t('adminUpload.error.nameRequired'))
      return
    }

    const guestNameValidationError = validateGuestName(normalizedGuestName, locale)
    if (guestNameValidationError) {
      setFormError(guestNameValidationError)
      return
    }

    setFormError(null)
    setSummary(null)
    setIsUploading(true)

    let approvedCount = 0
    let pendingCount = 0
    let failedCount = 0

    const uploadItem = async (item: UploadQueueItem): Promise<void> => {
      setQueue((prev) => prev.map((entry) => (
        entry.id === item.id ? { ...entry, status: 'uploading', error: undefined } : entry
      )))

      const result = await runWithRetry({
        operation: () => (autoApproveMode
          ? adminUploadFile(
            galleryId,
            item.file,
            normalizedGuestName || undefined,
            { autoApprove: true }
          )
          : adminUploadFile(
            galleryId,
            item.file,
            normalizedGuestName || undefined
          )),
        shouldRetry: isTransientUploadError,
        maxAttempts: MAX_UPLOAD_ATTEMPTS,
        backoffMs: UPLOAD_RETRY_BACKOFF_MS,
      })

      if (result.ok) {
        const nextStatus = result.value.status === 'APPROVED' ? 'approved' : 'pending'
        if (nextStatus === 'approved') approvedCount += 1
        if (nextStatus === 'pending') pendingCount += 1

        setQueue((prev) => prev.map((entry) => (
          entry.id === item.id ? { ...entry, status: nextStatus, result: result.value } : entry
        )))
      } else {
        failedCount += 1
        const message = toUploadErrorMessage(result.error)

        setQueue((prev) => prev.map((entry) => (
          entry.id === item.id ? { ...entry, status: 'error', error: message } : entry
        )))
      }
    }

    await runWithConcurrency(queuedItems, ADMIN_UPLOAD_CONCURRENCY, uploadItem)

    setIsUploading(false)

    if (approvedCount > 0) {
      await onApprovedUploads?.()
    }

    setSummary(buildSummary({
      approvedCount,
      pendingCount,
      failedCount,
      t,
    }))
  }

  function retryItem(itemId: string) {
    setQueue((prev) => prev.map((entry) => (
      entry.id === itemId
        ? { ...entry, status: 'queued', error: undefined, result: undefined }
        : entry
    )))
    setFormError(null)
    setSummary(null)
  }

  return (
    <section className="max-w-4xl px-4 pb-6">
      <div className="rounded-card border border-ui-border bg-surface-card p-4 space-y-4">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted">
            {t('adminUpload.title')}
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            {t('adminUpload.description')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="admin-upload-input" className="block text-sm font-medium text-text-primary mb-2">
              {t('adminUpload.files')}
            </label>
            <div
              onClick={() => inputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  inputRef.current?.click()
                }
              }}
              onDragOver={(event) => {
                event.preventDefault()
                setIsDragActive(true)
              }}
              onDragEnter={(event) => {
                event.preventDefault()
                setIsDragActive(true)
              }}
              onDragLeave={(event) => {
                event.preventDefault()
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                setIsDragActive(false)
              }}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              className={[
                'border-2 border-dashed rounded-card p-6 flex cursor-pointer flex-col items-center gap-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30',
                isDragActive ? 'border-accent bg-accent/5' : 'border-ui-border hover:border-accent',
              ].join(' ')}
            >
              <Camera className="w-8 h-8 text-text-muted" />
              <span className="text-center text-sm text-text-muted">
                {t('adminUpload.filesHint')}
              </span>
            </div>
            <input
              id="admin-upload-input"
              ref={inputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime"
              onChange={handleFileChange}
              className="sr-only"
              aria-label={t('adminUpload.filesAria')}
            />
          </div>

          {guestNameMode !== 'HIDDEN' && (
            <div>
              <label htmlFor="admin-guest-name" className="block text-sm font-medium text-text-primary mb-2">
                {t('adminUpload.nameLabel')} {guestNameMode === 'OPTIONAL' ? t('adminUpload.nameOptional') : t('adminUpload.nameRequired')}
              </label>
              <input
                id="admin-guest-name"
                type="text"
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                placeholder={t('adminUpload.namePlaceholder')}
                maxLength={80}
                className="w-full rounded-card border border-ui-border bg-surface-base px-4 py-2.5 text-text-primary focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
              />
            </div>
          )}

          <div className="rounded-card border border-ui-border px-3 py-2.5">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={autoApproveMode}
                onChange={(event) => setAutoApproveMode(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-accent"
              />
              <span>
                <span className="block text-sm text-text-primary">{t('adminUpload.photographerMode')}</span>
                <span className="block text-xs text-text-muted">{t('adminUpload.photographerModeHint')}</span>
              </span>
            </label>
          </div>

          {queue.length > 0 && (
            <ul className="space-y-2" aria-label={t('adminUpload.queueAria')}>
              {queue.map((item) => (
                <li key={item.id} className="rounded-card border border-ui-border px-3 py-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-text-primary">{item.file.name}</p>
                      <p className="mt-1 text-xs text-text-muted">{statusLabel(item.status, t)}</p>
                      {item.error && <p className="mt-1 text-xs text-error">{item.error}</p>}
                    </div>
                    {item.status === 'error' && (
                      <button
                        type="button"
                        onClick={() => retryItem(item.id)}
                        className="inline-flex items-center gap-1 rounded-full border border-ui-border px-3 py-1 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent"
                      >
                        <RefreshCw className="w-3 h-3" />
                        {t('adminUpload.retry')}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {isUploading && queue.length > 0 && (
            <div className="space-y-1" aria-live="polite">
              <div className="h-2 w-full rounded-full bg-ui-border">
                <div
                  className="h-2 rounded-full bg-accent transition-[width] duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="text-xs text-text-muted">
                {t('adminUpload.progress', { done: processedCount, total: queue.length })}
              </p>
            </div>
          )}

          {formError && <p className="text-sm text-error">{formError}</p>}
          {summary && <p className="text-sm text-text-primary">{summary}</p>}

          <button
            type="submit"
            disabled={isUploading}
            aria-busy={isUploading}
            className="w-full rounded-full bg-accent py-3 font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            <span className="inline-flex items-center">
              {isUploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              <span>{t('adminUpload.submit')}</span>
              {isUploading && (
                <span className="sr-only"> {t('adminUpload.submitting')}</span>
              )}
            </span>
          </button>
        </form>
      </div>
    </section>
  )
}

function buildSummary({
  approvedCount,
  pendingCount,
  failedCount,
  t,
}: {
  approvedCount: number
  pendingCount: number
  failedCount: number
  t: (key: Parameters<ReturnType<typeof useAdminI18n>['t']>[0], params?: Record<string, string | number>) => string
}): string | null {
  const parts: string[] = []
  if (approvedCount > 0) parts.push(t('adminUpload.summary.approved', { count: approvedCount }))
  if (pendingCount > 0) parts.push(t('adminUpload.summary.pending', { count: pendingCount }))
  if (failedCount > 0) parts.push(t('adminUpload.summary.failed', { count: failedCount }))
  return parts.length > 0 ? t('adminUpload.summary.complete', { parts: parts.join(', ') }) : null
}

function statusLabel(
  status: UploadQueueItem['status'],
  t: ReturnType<typeof useAdminI18n>['t']
): string {
  switch (status) {
    case 'queued':
      return t('adminUpload.status.queued')
    case 'uploading':
      return t('adminUpload.status.uploading')
    case 'approved':
      return t('adminUpload.status.approved')
    case 'pending':
      return t('adminUpload.status.pending')
    case 'error':
      return t('adminUpload.status.error')
  }
}
