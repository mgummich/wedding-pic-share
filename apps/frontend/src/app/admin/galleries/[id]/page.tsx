'use client'

import { useEffect, useState, use, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, Trash2, QrCode, Download } from 'lucide-react'
import { getAdminGalleries, updateGallery, deleteGallery, getAdminPhotos, ApiError } from '@/lib/api'
import { Lightbox } from '@/components/Lightbox'
import { AdminUploadPanel } from '@/components/AdminUploadPanel'
import type { AdminPhotoResponse } from '@/lib/api'
import type { UploadWindowResponse } from '@wedding/shared'

interface PageProps {
  params: Promise<{ id: string }>
}

type GalleryData = Awaited<ReturnType<typeof getAdminGalleries>>[number]
type UploadWindowDraft = Pick<UploadWindowResponse, 'id'> & { start: string; end: string }

function toDateTimeLocal(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const localDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60_000))
  return localDate.toISOString().slice(0, 16)
}

function toIsoString(value: string): string {
  return new Date(value).toISOString()
}

export default function GallerySettingsPage({ params }: PageProps) {
  const { id } = use(params)
  const router = useRouter()

  const [gallery, setGallery] = useState<GalleryData | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [photos, setPhotos] = useState<AdminPhotoResponse[]>([])
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [layout, setLayout] = useState<'MASONRY' | 'GRID'>('MASONRY')
  const [guestNameMode, setGuestNameMode] = useState<'OPTIONAL' | 'REQUIRED' | 'HIDDEN'>('OPTIONAL')
  const [allowGuestDownload, setAllowGuestDownload] = useState(false)
  const [isActive, setIsActive] = useState(false)
  const [uploadWindows, setUploadWindows] = useState<UploadWindowDraft[]>([])
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)

  async function refreshApprovedPhotos() {
    try {
      const response = await getAdminPhotos(id, { status: 'APPROVED' })
      setPhotos(response.data)
    } catch {
      // Ignore background refresh failures; the settings page can still function.
    }
  }

  useEffect(() => {
    getAdminGalleries()
      .then((galleries) => {
        const found = galleries.find((g) => g.id === id)
        if (!found) { setLoadError(true); return }
        setGallery(found)
        setName(found.name)
        setDescription(found.description ?? '')
        setLayout(found.layout)
        setGuestNameMode(found.guestNameMode)
        setAllowGuestDownload(found.allowGuestDownload)
        setIsActive(found.isActive)
        setUploadWindows(found.uploadWindows.map((window) => ({
          id: window.id,
          start: toDateTimeLocal(window.start),
          end: toDateTimeLocal(window.end),
        })))
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/admin/login')
        else setLoadError(true)
      })

    void refreshApprovedPhotos()
  }, [id, router])

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setSaveError(null)
    setSaving(true)
    setSaved(false)
    try {
      if (uploadWindows.some((window) => !window.start || !window.end)) {
        setSaveError('Bitte fuelle alle Start- und Endzeiten aus oder entferne das unvollstaendige Zeitfenster.')
        return
      }
      if (uploadWindows.some((window) => new Date(window.start) >= new Date(window.end))) {
        setSaveError('Jedes Upload-Zeitfenster braucht ein Ende nach dem Start.')
        return
      }

      const updated = await updateGallery(id, {
        name,
        description: description.trim() || null,
        layout,
        guestNameMode,
        allowGuestDownload,
        isActive,
        uploadWindows: uploadWindows.map((window) => ({
          start: toIsoString(window.start),
          end: toIsoString(window.end),
        })),
      })
      setGallery((prev) => prev ? { ...prev, ...updated } : prev)
      setIsActive(updated.isActive)
      setUploadWindows(updated.uploadWindows.map((window) => ({
        id: window.id,
        start: toDateTimeLocal(window.start),
        end: toDateTimeLocal(window.end),
      })))
      setSaved(true)
    } catch {
      setSaveError('Speichern fehlgeschlagen. Bitte versuche es erneut.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteGallery(id)
      router.replace('/admin')
    } catch {
      setSaveError('Löschen fehlgeschlagen.')
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  async function handleExport() {
    if (!gallery) return
    setExporting(true)
    try {
      const res = await fetch(`/api/v1/admin/galleries/${id}/export`, { credentials: 'include' })
      if (!res.ok) {
        setSaveError('Export fehlgeschlagen. Bitte versuche es erneut.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${gallery.slug}-export.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 100)
    } finally {
      setExporting(false)
    }
  }

  if (loadError) {
    return (
      <main className="min-h-screen bg-surface-base flex flex-col items-center justify-center px-4">
        <p className="text-text-muted mb-4">Galerie nicht gefunden.</p>
        <Link href="/admin" className="text-accent hover:underline">Zurück zur Übersicht</Link>
      </main>
    )
  }

  if (!gallery) {
    return (
      <main className="min-h-screen bg-surface-base px-4 py-6">
        <div className="space-y-3 max-w-lg">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-card bg-border animate-pulse" />
          ))}
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-surface-base">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4 border-b border-border">
        <Link href="/admin" className="p-1.5 text-text-muted hover:text-text-primary transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-2xl text-text-primary truncate">{gallery.name}</h1>
          <p className="text-xs text-text-muted font-mono mt-0.5">/g/{gallery.slug}</p>
        </div>
      </header>

      <form onSubmit={handleSave} className="px-4 py-6 space-y-5 max-w-lg">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-text-primary mb-1">
            Name
          </label>
          <input
            id="name"
            type="text"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-2.5 rounded-card border border-border focus:outline-none focus:border-accent bg-surface-card text-text-primary"
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-text-primary mb-1">
            Beschreibung <span className="text-text-muted font-normal">(optional)</span>
          </label>
          <textarea
            id="description"
            rows={2}
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-4 py-2.5 rounded-card border border-border focus:outline-none focus:border-accent bg-surface-card text-text-primary resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">Layout</label>
          <div className="flex gap-3">
            {(['MASONRY', 'GRID'] as const).map((l) => (
              <label key={l} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="layout"
                  value={l}
                  checked={layout === l}
                  onChange={() => setLayout(l)}
                  className="accent-accent"
                />
                <span className="text-sm text-text-primary">{l === 'MASONRY' ? 'Masonry' : 'Raster'}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">Gastname</label>
          <div className="flex flex-col gap-2">
            {([['OPTIONAL', 'Optional'], ['REQUIRED', 'Pflichtfeld'], ['HIDDEN', 'Ausgeblendet']] as const).map(([val, label]) => (
              <label key={val} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="guestNameMode"
                  value={val}
                  checked={guestNameMode === val}
                  onChange={() => setGuestNameMode(val)}
                  className="accent-accent"
                />
                <span className="text-sm text-text-primary">{label}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={allowGuestDownload}
            onChange={(e) => setAllowGuestDownload(e.target.checked)}
            className="w-4 h-4 accent-accent"
          />
          <span className="text-sm text-text-primary">Gäste dürfen Fotos herunterladen</span>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => {
              setIsActive(e.target.checked)
              setSaved(false)
            }}
            className="w-4 h-4 accent-accent"
          />
          <span className="text-sm text-text-primary">Haupt-Galerie für Root-URLs verwenden</span>
        </label>

        <section className="space-y-3 rounded-card border border-border p-4">
          <div>
            <h2 className="text-sm font-medium text-text-primary">Upload-Zeitfenster</h2>
            <p className="text-xs text-text-muted mt-1">
              Ohne Zeitfenster bleiben Uploads dauerhaft geöffnet.
            </p>
          </div>

          {uploadWindows.length === 0 ? (
            <p className="text-sm text-text-muted">Keine Zeitfenster konfiguriert.</p>
          ) : (
            <div className="space-y-3">
              {uploadWindows.map((window, index) => (
                <div key={window.id} className="rounded-card border border-border p-3 space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-sm text-text-primary">
                      <span className="block mb-1">Start</span>
                      <input
                        type="datetime-local"
                        value={window.start}
                        onChange={(e) => {
                          setUploadWindows((prev) => prev.map((entry, entryIndex) => (
                            entryIndex === index ? { ...entry, start: e.target.value } : entry
                          )))
                          setSaved(false)
                        }}
                        className="w-full px-4 py-2.5 rounded-card border border-border focus:outline-none focus:border-accent bg-surface-card text-text-primary"
                      />
                    </label>
                    <label className="text-sm text-text-primary">
                      <span className="block mb-1">Ende</span>
                      <input
                        type="datetime-local"
                        value={window.end}
                        onChange={(e) => {
                          setUploadWindows((prev) => prev.map((entry, entryIndex) => (
                            entryIndex === index ? { ...entry, end: e.target.value } : entry
                          )))
                          setSaved(false)
                        }}
                        className="w-full px-4 py-2.5 rounded-card border border-border focus:outline-none focus:border-accent bg-surface-card text-text-primary"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadWindows((prev) => prev.filter((entry) => entry.id !== window.id))
                      setSaved(false)
                    }}
                    className="text-sm text-error hover:underline"
                  >
                    Zeitfenster löschen
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setUploadWindows((prev) => [
                ...prev,
                {
                  id: `new-${Date.now()}`,
                  start: '',
                  end: '',
                },
              ])
              setSaved(false)
            }}
            className="px-4 py-2 rounded-full border border-border text-text-muted text-sm hover:border-accent hover:text-accent transition-colors"
          >
            Zeitfenster hinzufügen
          </button>
        </section>

        {saveError && <p className="text-sm text-error">{saveError}</p>}
        {saved && <p className="text-sm text-success">Gespeichert ✓</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-50"
        >
          {saving ? 'Wird gespeichert…' : 'Speichern'}
        </button>
      </form>

      {/* Gallery actions: QR download + ZIP export */}
      {gallery && (
        <section className="px-4 pb-6 max-w-lg">
          <h2 className="text-sm font-medium text-text-muted uppercase tracking-wide mb-3">
            Aktionen
          </h2>
          <div className="flex flex-wrap gap-3">
            <a
              href={`/api/v1/g/${gallery.slug}/qr?format=png`}
              download={`${gallery.slug}-qr.png`}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-border
                         text-text-muted hover:border-accent hover:text-accent transition-colors text-sm"
              aria-label="QR-Code als PNG herunterladen"
            >
              <QrCode className="w-4 h-4" />
              QR-Code (PNG)
            </a>
            <a
              href={`/api/v1/g/${gallery.slug}/qr?format=svg`}
              download={`${gallery.slug}-qr.svg`}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-border
                         text-text-muted hover:border-accent hover:text-accent transition-colors text-sm"
              aria-label="QR-Code als SVG herunterladen"
            >
              <QrCode className="w-4 h-4" />
              QR-Code (SVG)
            </a>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-border
                         text-text-muted hover:border-accent hover:text-accent transition-colors text-sm
                         disabled:opacity-50"
              aria-label="Fotos als ZIP exportieren"
            >
              <Download className="w-4 h-4" />
              {exporting ? 'Wird exportiert…' : 'ZIP exportieren'}
            </button>
          </div>
        </section>
      )}

      <AdminUploadPanel
        galleryId={id}
        guestNameMode={guestNameMode}
        onApprovedUploads={refreshApprovedPhotos}
      />

      {photos.length > 0 && (
        <section className="max-w-lg px-4 pb-8">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-text-muted">
            Freigegebene Fotos ({photos.length})
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo, index) => (
              <button
                key={photo.id}
                onClick={() => setOpenIndex(index)}
                className="group relative aspect-square overflow-hidden rounded-card"
                aria-label="Foto vergrößern"
              >
                <Image
                  src={photo.thumbUrl}
                  alt={photo.guestName ?? 'Hochzeitsfoto'}
                  fill
                  className="object-cover transition-transform duration-200 group-hover:scale-105"
                  unoptimized
                />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Danger zone */}
      <div className="px-4 pb-10 max-w-lg">
        <div className="border border-error/30 rounded-card p-4">
          <p className="text-sm font-medium text-text-primary mb-1">Galerie löschen</p>
          <p className="text-xs text-text-muted mb-3">
            Löscht die Galerie und alle zugehörigen Fotos unwiderruflich.
          </p>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-error text-error text-sm hover:bg-error hover:text-white transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Galerie löschen
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 rounded-full bg-error text-white text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {deleting ? 'Wird gelöscht…' : 'Wirklich löschen'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-4 py-2 rounded-full border border-border text-text-muted text-sm hover:border-accent hover:text-accent transition-colors"
              >
                Abbrechen
              </button>
            </div>
          )}
        </div>
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
