'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, Camera, CheckCircle2 } from 'lucide-react'
import { uploadFile, deletePendingUpload, ApiError } from '@/lib/api'
import type { UploadResponse } from '@wedding/shared'
import { validateUploadFile, getUploadErrorMessage, validateGuestName } from '@/lib/uploadValidation'
import { isTransientUploadError, runWithRetry } from '@/lib/uploadRetry'
import { useGuestI18n } from '@/lib/guestI18n'
import { runWithConcurrency } from '@/lib/asyncPool'

interface UploadFormProps {
  gallerySlug: string
  guestNameMode: 'OPTIONAL' | 'REQUIRED' | 'HIDDEN'
}

type FileStatus = {
  file: File
  status: 'pending' | 'uploading' | 'done' | 'deleting' | 'error'
  error?: string
  result?: UploadResponse
}
const MAX_UPLOAD_ATTEMPTS = 3
const UPLOAD_RETRY_BACKOFF_MS = [500, 1500]
const UPLOAD_CONCURRENCY = 3

export function UploadForm({ gallerySlug, guestNameMode }: UploadFormProps) {
  const router = useRouter()
  const { locale, t } = useGuestI18n()
  const [files, setFiles] = useState<FileStatus[]>([])
  const [guestName, setGuestName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [isDragActive, setIsDragActive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const completedCount = useMemo(
    () => files.filter((item) => item.status === 'done').length,
    [files]
  )
  const hasUploadInFlight = files.some((item) => item.status === 'uploading' || item.status === 'deleting')
  const progressPercent = files.length > 0
    ? Math.min(100, Math.round((completedCount / files.length) * 100))
    : 0

  function updateFiles(updater: (prev: FileStatus[]) => FileStatus[]) {
    setFiles((prev) => updater(prev))
  }

  function toUploadErrorMessage(error: unknown): string {
    if (error instanceof ApiError) {
      return getUploadErrorMessage(error.status, locale) ?? t('guest.uploadForm.error.generic')
    }
    return t('guest.uploadForm.error.network')
  }

  function buildUnlockRedirectPath(): string {
    return `/g/${gallerySlug}/unlock?next=${encodeURIComponent(`/g/${gallerySlug}/upload`)}`
  }

  function queueSelectedFiles(selectedFiles: File[]) {
    const validated = selectedFiles.map((f): FileStatus => {
      const validationError = validateUploadFile(f, locale)
      if (validationError) {
        return { file: f, status: 'error', error: validationError }
      }
      return { file: f, status: 'pending' }
    })
    updateFiles(() => validated)
    setFormError(null)
    setSubmitted(false)
  }

  function canDeletePendingUpload(item: FileStatus): boolean {
    return item.status === 'done'
      && item.result?.status === 'PENDING'
      && typeof item.result.deleteToken === 'string'
  }

  async function uploadSingleFile(
    file: File,
    options: { submitOnAllDone?: boolean; guestNameValue?: string } = {}
  ): Promise<boolean> {
    const { submitOnAllDone = false, guestNameValue } = options
    const effectiveGuestName = guestNameValue ?? (guestName.trim() || undefined)

    updateFiles((prev) => prev.map((item) =>
      item.file === file ? { ...item, status: 'uploading', error: undefined } : item
    ))

    const result = await runWithRetry({
      operation: () => uploadFile(gallerySlug, file, effectiveGuestName),
      shouldRetry: isTransientUploadError,
      maxAttempts: MAX_UPLOAD_ATTEMPTS,
      backoffMs: UPLOAD_RETRY_BACKOFF_MS,
    })

    if (result.ok) {
      updateFiles((prev) => {
        const next: FileStatus[] = prev.map((item): FileStatus => (
          item.file === file
            ? { ...item, status: 'done', error: undefined, result: result.value }
            : item
        ))

        if (submitOnAllDone && next.length > 0 && next.every((item) => item.status === 'done')) {
          setSubmitted(true)
        }

        return next
      })
      return true
    }

    if (result.error instanceof ApiError && result.error.status === 401) {
      router.replace(buildUnlockRedirectPath())
      return false
    }

    updateFiles((prev) =>
      prev.map((item) => item.file === file
        ? { ...item, status: 'error', error: toUploadErrorMessage(result.error) }
        : item
      )
    )
    return false
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? [])
    if (selected.length === 0) return
    queueSelectedFiles(selected)
    setIsDragActive(false)
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const selected = Array.from(event.dataTransfer.files ?? [])
    setIsDragActive(false)
    if (selected.length === 0) return
    queueSelectedFiles(selected)
  }

  async function handleRetry(file: File) {
    setFormError(null)
    setSubmitted(false)
    await uploadSingleFile(file, { submitOnAllDone: true })
  }

  async function handleDeletePendingUpload(file: File) {
    const target = files.find((item) => item.file === file)
    if (!target || !canDeletePendingUpload(target) || !target.result?.deleteToken) return

    updateFiles((prev) => prev.map((item) => (
      item.file === file ? { ...item, status: 'deleting', error: undefined } : item
    )))

    try {
      await deletePendingUpload(gallerySlug, target.result.id, target.result.deleteToken)
      updateFiles((prev) => prev.filter((item) => item.file !== file))
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace(buildUnlockRedirectPath())
        return
      }
      const message = error instanceof ApiError
        ? (getUploadErrorMessage(error.status, locale) ?? t('guest.uploadForm.error.deleteFailed'))
        : t('guest.uploadForm.error.deleteFailed')
      updateFiles((prev) => prev.map((item) => (
        item.file === file
          ? { ...item, status: 'done', error: message }
          : item
      )))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (files.length === 0) {
      setFormError(t('guest.uploadForm.error.selectFile'))
      return
    }
    if (guestNameMode === 'REQUIRED' && !guestName.trim()) {
      setFormError(t('guest.uploadForm.error.nameRequired'))
      return
    }
    const normalizedGuestName = guestName.trim()
    const guestNameValidationError = validateGuestName(normalizedGuestName, locale)
    if (guestNameValidationError) {
      setFormError(guestNameValidationError)
      return
    }

    const pending = files.filter((f) => f.status === 'pending')
    const nonPendingBeforeSubmit = files.filter((f) => f.status !== 'pending')
    setSubmitted(false)

    const results = await runWithConcurrency(pending, UPLOAD_CONCURRENCY, (item) => uploadSingleFile(item.file, {
      guestNameValue: normalizedGuestName || undefined,
    }))
    const allSucceeded = results.every(Boolean)

    if (allSucceeded && pending.length > 0 && nonPendingBeforeSubmit.every((item) => item.status === 'done')) {
      setSubmitted(true)
    }
  }

  if (submitted && files.length > 0 && files.every((f) => f.status === 'done')) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-6">
        <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mb-4">
          <CheckCircle2 className="h-8 w-8 text-success" aria-hidden="true" />
        </div>
        <h2 className="font-display text-2xl text-text-primary mb-2">{t('guest.uploadForm.success.title')}</h2>
        <p className="text-text-muted">
          {t('guest.uploadForm.success.description')}
        </p>
        <button
          onClick={() => { updateFiles(() => []); setSubmitted(false) }}
          className="mt-6 px-5 py-2 rounded-full border border-border text-text-muted hover:border-accent hover:text-accent transition-colors"
        >
          {t('guest.uploadForm.success.uploadMore')}
        </button>
        {files.some((item) => canDeletePendingUpload(item)) && (
          <ul className="mt-6 w-full max-w-lg space-y-2 text-left">
            {files.filter((item) => canDeletePendingUpload(item)).map((item) => (
              <li key={`${item.file.name}-${item.file.size}-${item.file.lastModified}`} className="flex items-center gap-3 p-3 rounded-card bg-surface-card border border-border">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">{item.file.name}</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {t('guest.uploadForm.status.pending')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDeletePendingUpload(item.file)}
                  className="text-xs font-medium text-error hover:opacity-80"
                >
                  {t('guest.uploadForm.deletePending')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="px-4 py-6 space-y-6">
      <div>
        <label htmlFor="file-input" className="block text-sm font-medium text-text-primary mb-2">
          {t('guest.uploadForm.filesLabel')}
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
            'border-2 border-dashed rounded-card p-8 flex flex-col items-center gap-3 cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-accent/30',
            isDragActive ? 'border-accent bg-accent/5' : 'border-border hover:border-accent',
          ].join(' ')}
        >
          <Camera className="w-8 h-8 text-text-muted" />
          <span className="text-text-muted text-sm text-center">
            {t('guest.uploadForm.filesHint')}
          </span>
        </div>
        <input
          id="file-input"
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime"
          onChange={handleFileChange}
          className="sr-only"
          aria-label={t('guest.uploadForm.filesAria')}
        />
      </div>

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((item) => (
            <li key={`${item.file.name}-${item.file.size}-${item.file.lastModified}`} className="flex items-center gap-3 p-3 rounded-card bg-surface-card border border-border">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary truncate">{item.file.name}</p>
                {item.error && <p className="text-xs text-error mt-0.5">{item.error}</p>}
              </div>
              {item.status === 'error' ? (
                <button
                  type="button"
                  onClick={() => handleRetry(item.file)}
                  disabled={hasUploadInFlight}
                  className="text-xs font-medium text-accent hover:text-accent-hover disabled:opacity-50"
                >
                  {t('guest.uploadForm.retry')}
                </button>
              ) : canDeletePendingUpload(item) ? (
                <button
                  type="button"
                  onClick={() => void handleDeletePendingUpload(item.file)}
                  disabled={files.some((f) => f.status === 'uploading')}
                  className="text-xs font-medium text-error hover:opacity-80 disabled:opacity-50"
                >
                  {t('guest.uploadForm.deletePending')}
                </button>
              ) : (
                <span className="text-xs text-text-muted flex-shrink-0 inline-flex items-center gap-1">
                  {item.status === 'uploading' && t('guest.uploadForm.status.uploading')}
                  {item.status === 'deleting' && t('guest.uploadForm.status.deleting')}
                  {item.status === 'done' && item.result?.status === 'PENDING' && t('guest.uploadForm.status.pending')}
                  {item.status === 'done' && item.result?.status !== 'PENDING' && (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                      <span>{t('guest.uploadForm.status.done')}</span>
                    </>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {hasUploadInFlight && files.length > 0 && (
        <div className="space-y-1" aria-live="polite">
          <div className="h-2 w-full rounded-full bg-border">
            <div
              className="h-2 rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="text-xs text-text-muted">
            {t('guest.uploadForm.progress', { done: completedCount, total: files.length })}
          </p>
        </div>
      )}

      {guestNameMode !== 'HIDDEN' && (
        <div>
          <label htmlFor="guest-name" className="block text-sm font-medium text-text-primary mb-2">
            {t('guest.uploadForm.nameLabel')} {guestNameMode === 'OPTIONAL' && t('common.optional')}
          </label>
          <input
            id="guest-name"
            type="text"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder={t('guest.uploadForm.namePlaceholder')}
            maxLength={80}
            className="w-full px-4 py-2.5 rounded-card border border-border
                       focus:outline-none focus:border-accent text-text-primary
                       bg-surface-card"
          />
        </div>
      )}

      {formError && <p className="text-sm text-error">{formError}</p>}

      <button
        type="submit"
        disabled={hasUploadInFlight}
        className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-white
                   font-medium transition-colors disabled:opacity-50"
      >
        <Upload className="w-4 h-4 inline mr-2" />
        {t('guest.uploadForm.submit')}
      </button>
    </form>
  )
}
