'use client'

import { useRef, useState } from 'react'
import { Camera, RefreshCw, Upload } from 'lucide-react'
import { adminUploadFile, ApiError } from '@/lib/api'
import { UPLOAD_ERROR_MESSAGES, validateUploadFile } from '@/lib/uploadValidation'
import type { UploadResponse } from '@wedding/shared'

type UploadQueueItem = {
  id: string
  file: File
  status: 'queued' | 'uploading' | 'approved' | 'pending' | 'error'
  error?: string
  result?: UploadResponse
}

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
  const inputRef = useRef<HTMLInputElement>(null)
  const [queue, setQueue] = useState<UploadQueueItem[]>([])
  const [guestName, setGuestName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? [])
    if (selected.length === 0) return

    setQueue((prev) => [
      ...prev,
      ...selected.map((file) => {
        const validationError = validateUploadFile(file)
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
    event.target.value = ''
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const queuedItems = queue.filter((item) => item.status === 'queued')

    if (queuedItems.length === 0) {
      setFormError('Bitte füge mindestens eine Datei zur Upload-Warteschlange hinzu.')
      return
    }

    if (guestNameMode === 'REQUIRED' && !guestName.trim()) {
      setFormError('Bitte gib einen Namen für diese Uploads ein.')
      return
    }

    setFormError(null)
    setSummary(null)
    setIsUploading(true)

    let approvedCount = 0
    let pendingCount = 0
    let failedCount = 0

    for (const item of queuedItems) {
      setQueue((prev) => prev.map((entry) => (
        entry.id === item.id ? { ...entry, status: 'uploading', error: undefined } : entry
      )))

      try {
        const result = await adminUploadFile(galleryId, item.file, guestName.trim() || undefined)
        const nextStatus = result.status === 'APPROVED' ? 'approved' : 'pending'
        if (nextStatus === 'approved') approvedCount += 1
        if (nextStatus === 'pending') pendingCount += 1

        setQueue((prev) => prev.map((entry) => (
          entry.id === item.id ? { ...entry, status: nextStatus, result } : entry
        )))
      } catch (error) {
        failedCount += 1
        const message = error instanceof ApiError
          ? (UPLOAD_ERROR_MESSAGES[error.status] ?? 'Upload fehlgeschlagen. Bitte erneut versuchen.')
          : 'Netzwerkfehler. Bitte erneut versuchen.'

        setQueue((prev) => prev.map((entry) => (
          entry.id === item.id ? { ...entry, status: 'error', error: message } : entry
        )))
      }
    }

    setIsUploading(false)

    if (approvedCount > 0) {
      await onApprovedUploads?.()
    }

    setSummary(buildSummary(approvedCount, pendingCount, failedCount))
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
    <section className="max-w-lg px-4 pb-6">
      <div className="rounded-card border border-border bg-surface-card p-4 space-y-4">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted">
            Admin Upload
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            Mehrere Dateien werden stabil nacheinander hochgeladen.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="admin-upload-input" className="block text-sm font-medium text-text-primary mb-2">
              Dateien
            </label>
            <div
              onClick={() => inputRef.current?.click()}
              className="border-2 border-dashed border-border rounded-card p-6 flex cursor-pointer flex-col items-center gap-3 hover:border-accent transition-colors"
            >
              <Camera className="w-8 h-8 text-text-muted" />
              <span className="text-center text-sm text-text-muted">
                Dateien zur Upload-Warteschlange hinzufügen
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
              aria-label="Dateien auswählen"
            />
          </div>

          {guestNameMode !== 'HIDDEN' && (
            <div>
              <label htmlFor="admin-guest-name" className="block text-sm font-medium text-text-primary mb-2">
                Name {guestNameMode === 'OPTIONAL' ? '(optional)' : '(Pflicht)'}
              </label>
              <input
                id="admin-guest-name"
                type="text"
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                placeholder="Zum Beispiel: Trauzeuge"
                maxLength={80}
                className="w-full rounded-card border border-border bg-surface-base px-4 py-2.5 text-text-primary focus:border-accent focus:outline-none"
              />
            </div>
          )}

          {queue.length > 0 && (
            <ul className="space-y-2" aria-label="Upload-Warteschlange">
              {queue.map((item) => (
                <li key={item.id} className="rounded-card border border-border px-3 py-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-text-primary">{item.file.name}</p>
                      <p className="mt-1 text-xs text-text-muted">{statusLabel(item.status)}</p>
                      {item.error && <p className="mt-1 text-xs text-error">{item.error}</p>}
                    </div>
                    {item.status === 'error' && (
                      <button
                        type="button"
                        onClick={() => retryItem(item.id)}
                        className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Erneut versuchen
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {formError && <p className="text-sm text-error">{formError}</p>}
          {summary && <p className="text-sm text-text-primary">{summary}</p>}

          <button
            type="submit"
            disabled={isUploading}
            className="w-full rounded-full bg-accent py-3 font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            <Upload className="mr-2 inline h-4 w-4" />
            {isUploading ? 'Uploads laufen…' : 'Uploads starten'}
          </button>
        </form>
      </div>
    </section>
  )
}

function buildSummary(approvedCount: number, pendingCount: number, failedCount: number): string | null {
  const parts: string[] = []
  if (approvedCount > 0) parts.push(`${approvedCount} freigegeben`)
  if (pendingCount > 0) parts.push(`${pendingCount} in Moderation`)
  if (failedCount > 0) parts.push(`${failedCount} fehlgeschlagen`)
  return parts.length > 0 ? `Upload abgeschlossen: ${parts.join(', ')}.` : null
}

function statusLabel(status: UploadQueueItem['status']): string {
  switch (status) {
    case 'queued':
      return 'In Warteschlange'
    case 'uploading':
      return 'Wird hochgeladen'
    case 'approved':
      return 'Freigegeben'
    case 'pending':
      return 'In Moderation'
    case 'error':
      return 'Fehlgeschlagen'
  }
}
