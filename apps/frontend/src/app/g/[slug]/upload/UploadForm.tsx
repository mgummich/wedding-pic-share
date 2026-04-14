'use client'

import { useState, useRef } from 'react'
import { Upload, Camera } from 'lucide-react'
import { uploadFile, ApiError } from '@/lib/api'
import type { UploadResponse } from '@wedding/shared'
import { validateUploadFile, UPLOAD_ERROR_MESSAGES } from '@/lib/uploadValidation'
import { isTransientUploadError, runWithRetry } from '@/lib/uploadRetry'

interface UploadFormProps {
  gallerySlug: string
  guestNameMode: 'OPTIONAL' | 'REQUIRED' | 'HIDDEN'
}

type FileStatus = { file: File; status: 'pending' | 'uploading' | 'done' | 'error'; error?: string; result?: UploadResponse }
const MAX_UPLOAD_ATTEMPTS = 3
const UPLOAD_RETRY_BACKOFF_MS = [500, 1500]

export function UploadForm({ gallerySlug, guestNameMode }: UploadFormProps) {
  const [files, setFiles] = useState<FileStatus[]>([])
  const [guestName, setGuestName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function updateFiles(updater: (prev: FileStatus[]) => FileStatus[]) {
    setFiles((prev) => updater(prev))
  }

  function toUploadErrorMessage(error: unknown): string {
    if (error instanceof ApiError) {
      return UPLOAD_ERROR_MESSAGES[error.status] ?? 'Ein Fehler ist aufgetreten. Bitte versuche es erneut.'
    }
    return 'Netzwerkfehler. Bitte versuche es erneut.'
  }

  async function uploadSingleFile(file: File, submitOnAllDone = false): Promise<boolean> {
    updateFiles((prev) => prev.map((item) =>
      item.file === file ? { ...item, status: 'uploading', error: undefined } : item
    ))

    const result = await runWithRetry({
      operation: () => uploadFile(gallerySlug, file, guestName.trim() || undefined),
      shouldRetry: isTransientUploadError,
      maxAttempts: MAX_UPLOAD_ATTEMPTS,
      backoffMs: UPLOAD_RETRY_BACKOFF_MS,
    })

    if (result.ok) {
      updateFiles((prev) =>
        {
          const next = prev.map((item) => item.file === file
          ? { ...item, status: 'done', error: undefined, result: result.value }
          : item
          )

          if (submitOnAllDone && next.length > 0 && next.every((item) => item.status === 'done')) {
            setSubmitted(true)
          }

          return next
        }
      )
      return true
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
    const validated = selected.map((f): FileStatus => {
      const validationError = validateUploadFile(f)
      if (validationError) {
        return { file: f, status: 'error', error: validationError }
      }
      return { file: f, status: 'pending' }
    })
    updateFiles(() => validated)
    setFormError(null)
    setSubmitted(false)
  }

  async function handleRetry(file: File) {
    setFormError(null)
    setSubmitted(false)
    await uploadSingleFile(file, true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (files.length === 0) {
      setFormError('Bitte wähle mindestens eine Datei aus.')
      return
    }
    if (guestNameMode === 'REQUIRED' && !guestName.trim()) {
      setFormError('Bitte gib deinen Namen ein.')
      return
    }

    const pending = files.filter((f) => f.status === 'pending')
    const nonPendingBeforeSubmit = files.filter((f) => f.status !== 'pending')
    setSubmitted(false)

    let allSucceeded = true
    for (const item of pending) {
      const ok = await uploadSingleFile(item.file)
      if (!ok) {
        allSucceeded = false
      }
    }

    if (allSucceeded && pending.length > 0 && nonPendingBeforeSubmit.every((item) => item.status === 'done')) {
      setSubmitted(true)
    }
  }

  if (submitted && files.every((f) => f.status === 'done')) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-6">
        <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mb-4">
          <span className="text-3xl">✓</span>
        </div>
        <h2 className="font-display text-2xl text-text-primary mb-2">Danke!</h2>
        <p className="text-text-muted">
          Deine Fotos wurden eingereicht und werden bald freigegeben.
        </p>
        <button
          onClick={() => { updateFiles(() => []); setSubmitted(false) }}
          className="mt-6 px-5 py-2 rounded-full border border-border text-text-muted hover:border-accent hover:text-accent transition-colors"
        >
          Weitere Fotos hochladen
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="px-4 py-6 space-y-6">
      {/* File picker */}
      <div>
        <label htmlFor="file-input" className="block text-sm font-medium text-text-primary mb-2">
          Fotos & Videos
        </label>
        <div
          onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed border-border rounded-card p-8
                     flex flex-col items-center gap-3 cursor-pointer
                     hover:border-accent transition-colors"
        >
          <Camera className="w-8 h-8 text-text-muted" />
          <span className="text-text-muted text-sm text-center">
            Tippe hier, um Fotos oder Videos auszuwählen
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
          aria-label="Fotos auswählen"
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((item, i) => (
            <li key={i} className="flex items-center gap-3 p-3 rounded-card bg-surface-card border border-border">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary truncate">{item.file.name}</p>
                {item.error && <p className="text-xs text-error mt-0.5">{item.error}</p>}
              </div>
              {item.status === 'error' ? (
                <button
                  type="button"
                  onClick={() => handleRetry(item.file)}
                  disabled={files.some((f) => f.status === 'uploading')}
                  className="text-xs font-medium text-accent hover:text-accent-hover disabled:opacity-50"
                >
                  Erneut versuchen
                </button>
              ) : (
                <span className="text-xs text-text-muted flex-shrink-0">
                  {item.status === 'uploading' && 'Lädt…'}
                  {item.status === 'done' && '✓'}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Guest name */}
      {guestNameMode !== 'HIDDEN' && (
        <div>
          <label htmlFor="guest-name" className="block text-sm font-medium text-text-primary mb-2">
            Dein Name {guestNameMode === 'OPTIONAL' && '(optional)'}
          </label>
          <input
            id="guest-name"
            type="text"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder="Max Mustermann"
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
        disabled={files.some((f) => f.status === 'uploading')}
        className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-white
                   font-medium transition-colors disabled:opacity-50"
      >
        <Upload className="w-4 h-4 inline mr-2" />
        Hochladen
      </button>
    </form>
  )
}
