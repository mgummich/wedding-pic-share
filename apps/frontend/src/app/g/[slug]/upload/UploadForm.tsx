'use client'

import { useState, useRef } from 'react'
import { Upload, Camera } from 'lucide-react'
import { uploadFile, ApiError } from '@/lib/api.js'
import type { UploadResponse } from '@wedding/shared'

const MAX_FILE_SIZE_MB = 50
const MAX_VIDEO_SIZE_MB = 200
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime']
const ERROR_MESSAGES: Record<number, string> = {
  409: 'Dieses Foto wurde bereits hochgeladen.',
  415: 'Dieser Dateityp wird nicht unterstützt. Erlaubt: JPEG, PNG, WEBP, HEIC, MP4, MOV.',
  413: `Diese Datei ist zu groß. Maximal erlaubt: ${MAX_FILE_SIZE_MB} MB.`,
  404: 'Diese Galerie existiert nicht oder wurde deaktiviert.',
}

interface UploadFormProps {
  gallerySlug: string
  guestNameMode: 'OPTIONAL' | 'REQUIRED' | 'HIDDEN'
}

type FileStatus = { file: File; status: 'pending' | 'uploading' | 'done' | 'error'; error?: string; result?: UploadResponse }

export function UploadForm({ gallerySlug, guestNameMode }: UploadFormProps) {
  const [files, setFiles] = useState<FileStatus[]>([])
  const [guestName, setGuestName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? [])
    const validated = selected.map((f): FileStatus => {
      if (!ALLOWED_TYPES.includes(f.type)) {
        return { file: f, status: 'error', error: ERROR_MESSAGES[415] }
      }
      const limitMb = f.type.startsWith('video/') ? MAX_VIDEO_SIZE_MB : MAX_FILE_SIZE_MB
      if (f.size > limitMb * 1024 * 1024) {
        return { file: f, status: 'error', error: ERROR_MESSAGES[413] }
      }
      return { file: f, status: 'pending' }
    })
    setFiles(validated)
    setFormError(null)
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
    setFiles((prev) => prev.map((f) =>
      f.status === 'pending' ? { ...f, status: 'uploading' } : f
    ))

    for (const item of pending) {
      try {
        const result = await uploadFile(gallerySlug, item.file, guestName.trim() || undefined)
        setFiles((prev) =>
          prev.map((f) => f.file === item.file ? { ...f, status: 'done', result } : f)
        )
      } catch (err) {
        const message =
          err instanceof ApiError
            ? (ERROR_MESSAGES[err.status] ?? 'Ein Fehler ist aufgetreten. Bitte versuche es erneut.')
            : 'Netzwerkfehler. Bitte versuche es erneut.'
        setFiles((prev) =>
          prev.map((f) => f.file === item.file ? { ...f, status: 'error', error: message } : f)
        )
      }
    }

    const allDone = files.every((f) => f.status === 'done' || f.status === 'error')
    if (allDone) setSubmitted(true)
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
          onClick={() => { setFiles([]); setSubmitted(false) }}
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
              <span className="text-xs text-text-muted flex-shrink-0">
                {item.status === 'uploading' && 'Lädt…'}
                {item.status === 'done' && '✓'}
                {item.status === 'error' && '✗'}
              </span>
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
