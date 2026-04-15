'use client'

import { useEffect, useState, use, FormEvent, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, Trash2, QrCode, Download, FileText, Archive, Eye, EyeOff, Loader2 } from 'lucide-react'
import { getAdminGalleries, updateGallery, deleteGallery, getAdminPhotos, archiveGallery, exportGallery, ApiError } from '@/lib/api'
import { Lightbox } from '@/components/Lightbox'
import { AdminUploadPanel } from '@/components/AdminUploadPanel'
import { useAdminI18n } from '@/components/AdminLocaleContext'
import { useToast } from '@/components/ToastProvider'
import type { AdminPhotoResponse } from '@/lib/api'
import type { UploadWindowResponse } from '@wedding/shared'

interface PageProps {
  params: Promise<{ id: string }>
}

type GalleryData = Awaited<ReturnType<typeof getAdminGalleries>>[number]
type UploadWindowDraft = Pick<UploadWindowResponse, 'id'> & { start: string; end: string }
type UploadWindowValidation = 'incomplete' | 'invalidDateTime' | 'endBeforeStart' | null
const ARCHIVE_POLL_INTERVAL_MS = 1500
const ARCHIVE_POLL_TIMEOUT_MS = 90 * 1000

function toDateTimeLocal(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const localDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60_000))
  return localDate.toISOString().slice(0, 16)
}

function toIsoString(value: string): string | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function formatArchiveSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function dateLocale(locale: string): string {
  if (locale === 'de') return 'de-DE'
  if (locale === 'es') return 'es-ES'
  if (locale === 'fr') return 'fr-FR'
  return 'en-US'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function validateUploadWindow(window: UploadWindowDraft): UploadWindowValidation {
  if (!window.start || !window.end) return 'incomplete'
  const startIso = toIsoString(window.start)
  const endIso = toIsoString(window.end)
  if (!startIso || !endIso) return 'invalidDateTime'
  if (new Date(startIso) >= new Date(endIso)) return 'endBeforeStart'
  return null
}

export default function GallerySettingsPage({ params }: PageProps) {
  const { id } = use(params)
  const router = useRouter()
  const { locale, t } = useAdminI18n()
  const { showToast } = useToast()

  const [gallery, setGallery] = useState<GalleryData | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [photos, setPhotos] = useState<AdminPhotoResponse[]>([])
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [layout, setLayout] = useState<'MASONRY' | 'GRID'>('MASONRY')
  const [guestNameMode, setGuestNameMode] = useState<'OPTIONAL' | 'REQUIRED' | 'HIDDEN'>('OPTIONAL')
  const [allowGuestDownload, setAllowGuestDownload] = useState(false)
  const [stripExif, setStripExif] = useState(true)
  const [secretKeyInput, setSecretKeyInput] = useState('')
  const [showSecretKeyInput, setShowSecretKeyInput] = useState(false)
  const [clearSecretKey, setClearSecretKey] = useState(false)
  const [isActive, setIsActive] = useState(false)
  const [uploadWindowsVersion, setUploadWindowsVersion] = useState('')
  const [uploadWindows, setUploadWindows] = useState<UploadWindowDraft[]>([])
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [archiving, setArchiving] = useState(false)

  const uploadWindowValidationErrors = useMemo(
    () => uploadWindows.map(validateUploadWindow),
    [uploadWindows]
  )

  const refreshApprovedPhotos = useCallback(async () => {
    try {
      const response = await getAdminPhotos(id, { status: 'APPROVED' })
      setPhotos(response.data)
    } catch {
      // Ignore background refresh failures; the settings page can still function.
    }
  }, [id])

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
        setStripExif(found.stripExif)
        setIsActive(found.isActive)
        setUploadWindowsVersion(found.uploadWindowsVersion)
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
  }, [id, refreshApprovedPhotos, router])

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setSaveError(null)
    setSaving(true)
    setSaved(false)
    try {
      const firstWindowError = uploadWindowValidationErrors.find((value) => value !== null)
      if (firstWindowError === 'incomplete') {
        setSaveError(t('gallerySettings.saveError.incompleteWindow'))
        return
      }
      if (firstWindowError === 'invalidDateTime') {
        setSaveError(t('gallerySettings.saveError.invalidDateTime'))
        return
      }
      if (firstWindowError === 'endBeforeStart') {
        setSaveError(t('gallerySettings.saveError.invalidWindow'))
        return
      }
      const normalizedUploadWindows = uploadWindows.map((window) => ({
        start: toIsoString(window.start) ?? '',
        end: toIsoString(window.end) ?? '',
      }))
      const normalizedSecretKey = secretKeyInput.trim()

      const updated = await updateGallery(id, {
        name,
        description: description.trim() || null,
        layout,
        guestNameMode,
        allowGuestDownload,
        stripExif,
        secretKey: clearSecretKey ? null : (normalizedSecretKey.length > 0 ? normalizedSecretKey : undefined),
        isActive,
        uploadWindowsVersion,
        uploadWindows: normalizedUploadWindows,
      })
      setGallery((prev) => prev ? { ...prev, ...updated } : prev)
      setStripExif(updated.stripExif)
      setIsActive(updated.isActive)
      setUploadWindowsVersion(updated.uploadWindowsVersion)
      setUploadWindows(updated.uploadWindows.map((window) => ({
        id: window.id,
        start: toDateTimeLocal(window.start),
        end: toDateTimeLocal(window.end),
      })))
      setSecretKeyInput('')
      setClearSecretKey(false)
      setSaved(true)
      showToast(t('gallerySettings.saveSuccess'), 'success')
    } catch {
      const message = t('gallerySettings.saveError.saveFailed')
      setSaveError(message)
      showToast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!gallery || deleteConfirmText.trim() !== gallery.slug) return
    setDeleting(true)
    try {
      await deleteGallery(id)
      showToast(t('gallerySettings.danger.deletedSuccess'), 'success')
      router.replace('/admin')
    } catch {
      const message = t('gallerySettings.saveError.deleteFailed')
      setSaveError(message)
      showToast(message, 'error')
      setDeleting(false)
      setConfirmDelete(false)
      setDeleteConfirmText('')
    }
  }

  function handleBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }
    router.push('/admin')
  }

  function inlineUploadWindowError(error: UploadWindowValidation): string | null {
    if (error === 'incomplete') return t('gallerySettings.windows.error.incomplete')
    if (error === 'invalidDateTime') return t('gallerySettings.windows.error.invalidDateTime')
    if (error === 'endBeforeStart') return t('gallerySettings.windows.error.endBeforeStart')
    return null
  }

  async function handleExport() {
    if (!gallery) return
    setExporting(true)
    try {
      const blob = await exportGallery(id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${gallery.slug}-export.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 100)
    } catch {
      const message = t('gallerySettings.saveError.exportFailed')
      setSaveError(message)
      showToast(message, 'error')
    } finally {
      setExporting(false)
    }
  }

  async function handleArchive() {
    if (!gallery || gallery.isArchived) return
    setArchiving(true)
    setSaveError(null)

    try {
      const initial = await archiveGallery(id)
      setGallery((prev) => prev ? { ...prev, ...initial } : prev)
      setUploadWindowsVersion(initial.uploadWindowsVersion)

      let latest = initial
      const deadline = Date.now() + ARCHIVE_POLL_TIMEOUT_MS
      while (!latest.isArchived && latest.archiveStatus === 'IN_PROGRESS' && Date.now() < deadline) {
        await sleep(ARCHIVE_POLL_INTERVAL_MS)
        const galleries = await getAdminGalleries()
        const next = galleries.find((item) => item.id === id)
        if (!next) break
        latest = next
        setGallery((prev) => prev ? { ...prev, ...next } : prev)
        setUploadWindowsVersion(next.uploadWindowsVersion)
      }

      if (!latest.isArchived) {
        const message = latest.archiveError ?? t('gallerySettings.saveError.archiveFailed')
        setSaveError(message)
        showToast(message, 'error')
        return
      }

      setUploadWindows([])
      setUploadWindowsVersion(latest.uploadWindowsVersion)
      setSaved(false)
      showToast(t('gallerySettings.actions.archived'), 'success')
    } catch {
      const message = t('gallerySettings.saveError.archiveFailed')
      setSaveError(message)
      showToast(message, 'error')
    } finally {
      setArchiving(false)
    }
  }

  if (loadError) {
    return (
      <main className="min-h-screen bg-surface-base flex flex-col items-center justify-center px-4">
        <p className="text-text-muted mb-4">{t('gallerySettings.notFound')}</p>
        <Link href="/admin" className="text-accent hover:underline">{t('gallerySettings.backToOverview')}</Link>
      </main>
    )
  }

  if (!gallery) {
    return (
      <main className="min-h-screen bg-surface-base px-4 py-6">
        <div className="max-w-4xl space-y-5 animate-pulse">
          <div className="h-6 w-48 rounded-card bg-ui-border" />
          <div className="space-y-2">
            <div className="h-4 w-24 rounded-card bg-ui-border" />
            <div className="h-11 w-full rounded-card bg-ui-border" />
          </div>
          <div className="space-y-2">
            <div className="h-4 w-32 rounded-card bg-ui-border" />
            <div className="h-24 w-full rounded-card bg-ui-border" />
          </div>
          <div className="h-11 w-36 rounded-card bg-ui-border" />
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-surface-base">
      <header className="border-b border-ui-border px-4 pt-4 pb-4">
        <nav className="mb-2 text-xs text-text-muted">
          <Link href="/admin" className="hover:text-accent transition-colors">{t('dashboard.title')}</Link>
          <span className="mx-1">/</span>
          <span>{t('gallerySettings.field.name')}</span>
        </nav>
        <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleBack}
          aria-label={t('gallerySettings.backAria')}
          className="inline-flex h-11 w-11 items-center justify-center rounded-card text-text-muted transition-colors hover:text-text-primary"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-2xl text-text-primary truncate">{gallery.name}</h1>
          <p className="text-xs text-text-muted font-mono mt-0.5">/g/{gallery.slug}</p>
        </div>
        </div>
      </header>

      <form onSubmit={handleSave} className="px-4 py-6 space-y-5 max-w-4xl">
        {saveError && (
          <div className="rounded-card border border-error/40 bg-error/5 px-3 py-2" role="alert">
            <p className="text-sm text-error">{saveError}</p>
          </div>
        )}

        <div>
          <label htmlFor="name" className="block text-sm font-medium text-text-primary mb-1">
            {t('gallerySettings.field.name')}
          </label>
          <input
            id="name"
            type="text"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-2.5 rounded-card border border-ui-border focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 bg-surface-card text-text-primary"
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-text-primary mb-1">
            {t('gallerySettings.field.description')} <span className="text-text-muted font-normal">{t('common.optional')}</span>
          </label>
          <textarea
            id="description"
            rows={2}
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-4 py-2.5 rounded-card border border-ui-border focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 bg-surface-card text-text-primary resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">{t('gallerySettings.layout')}</label>
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
                <span className="text-sm text-text-primary">
                  {l === 'MASONRY' ? t('gallerySettings.layout.masonry') : t('gallerySettings.layout.grid')}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">{t('gallerySettings.guestName')}</label>
          <div className="flex flex-col gap-2">
            {([
              ['OPTIONAL', t('gallerySettings.guestName.optional')],
              ['REQUIRED', t('gallerySettings.guestName.required')],
              ['HIDDEN', t('gallerySettings.guestName.hidden')],
            ] as const).map(([val, label]) => (
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
          <span className="text-sm text-text-primary">{t('gallerySettings.allowDownload')}</span>
        </label>

        <section className="space-y-2 rounded-card border border-ui-border p-4">
          <h2 className="text-sm font-medium text-text-primary">{t('gallerySettings.exif.title')}</h2>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={stripExif}
              onChange={(e) => setStripExif(e.target.checked)}
              className="w-4 h-4 accent-accent"
            />
            <span className="text-sm text-text-primary">{t('gallerySettings.exif.strip')}</span>
          </label>
          <p className="text-xs text-text-muted">
            {t('gallerySettings.exif.recommended')}
          </p>
        </section>

        <section className="space-y-3 rounded-card border border-ui-border p-4">
          <div>
            <h2 className="text-sm font-medium text-text-primary">{t('gallerySettings.pin.title')}</h2>
            <p className="text-xs text-text-muted mt-1">
              {t('gallerySettings.pin.description')}
            </p>
          </div>
          <label htmlFor="secretKey" className="block text-sm text-text-primary">
            {t('gallerySettings.pin.new')}
          </label>
          <div className="relative rounded-card focus-within-ring">
            <input
              id="secretKey"
              type={showSecretKeyInput ? 'text' : 'password'}
              autoComplete="new-password"
              minLength={4}
              maxLength={32}
              value={secretKeyInput}
              onChange={(e) => {
                setSecretKeyInput(e.target.value)
                if (clearSecretKey) {
                  setClearSecretKey(false)
                }
              }}
              placeholder={t('gallerySettings.pin.placeholder')}
              className="w-full px-4 py-2.5 pr-11 rounded-card border border-ui-border focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 bg-surface-card text-text-primary"
            />
            <button
              type="button"
              onClick={() => setShowSecretKeyInput((current) => !current)}
              aria-label={showSecretKeyInput ? t('gallerySettings.pin.hide') : t('gallerySettings.pin.show')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
            >
              {showSecretKeyInput ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={clearSecretKey}
              onChange={(e) => setClearSecretKey(e.target.checked)}
              className="w-4 h-4 accent-accent"
            />
            <span className="text-sm text-text-primary">{t('gallerySettings.pin.clear')}</span>
          </label>
        </section>

        <section className="space-y-3 rounded-card border border-ui-border p-4">
          <div>
            <h2 className="text-sm font-medium text-text-primary">{t('gallerySettings.root.title')}</h2>
            <p className="text-xs text-text-muted mt-1">
              {t('gallerySettings.root.description')}
            </p>
          </div>
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
            <span className="text-sm text-text-primary">{t('gallerySettings.root.markActive')}</span>
          </label>
          <p className="text-xs text-text-muted font-mono">
            / → /g/{gallery.slug} · /upload → /g/{gallery.slug}/upload · /slideshow → /g/{gallery.slug}/slideshow
          </p>
          {isActive && (
            <p className="text-xs text-accent">
              {t('gallerySettings.root.activeHint')}
            </p>
          )}
        </section>

        <section className="space-y-3 rounded-card border border-ui-border p-4">
          <div>
            <h2 className="text-sm font-medium text-text-primary">{t('gallerySettings.windows.title')}</h2>
            <p className="text-xs text-text-muted mt-1">
              {t('gallerySettings.windows.description')}
            </p>
          </div>

          {uploadWindows.length === 0 ? (
            <p className="text-sm text-text-muted">{t('gallerySettings.windows.empty')}</p>
          ) : (
            <div className="space-y-3">
              {uploadWindows.map((window, index) => (
                <div key={window.id} className="rounded-card border border-ui-border p-3 space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-sm text-text-primary">
                      <span className="block mb-1">{t('gallerySettings.windows.start')}</span>
                      <input
                        type="datetime-local"
                        value={window.start}
                        onChange={(e) => {
                          setUploadWindows((prev) => prev.map((entry, entryIndex) => (
                            entryIndex === index ? { ...entry, start: e.target.value } : entry
                          )))
                          setSaved(false)
                        }}
                        aria-invalid={uploadWindowValidationErrors[index] !== null}
                        className="w-full px-4 py-2.5 rounded-card border border-ui-border focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 bg-surface-card text-text-primary"
                      />
                    </label>
                    <label className="text-sm text-text-primary">
                      <span className="block mb-1">{t('gallerySettings.windows.end')}</span>
                      <input
                        type="datetime-local"
                        value={window.end}
                        onChange={(e) => {
                          setUploadWindows((prev) => prev.map((entry, entryIndex) => (
                            entryIndex === index ? { ...entry, end: e.target.value } : entry
                          )))
                          setSaved(false)
                        }}
                        aria-invalid={uploadWindowValidationErrors[index] !== null}
                        className="w-full px-4 py-2.5 rounded-card border border-ui-border focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 bg-surface-card text-text-primary"
                      />
                    </label>
                  </div>
                  {inlineUploadWindowError(uploadWindowValidationErrors[index]) && (
                    <p className="text-xs text-error">
                      {inlineUploadWindowError(uploadWindowValidationErrors[index])}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setUploadWindows((prev) => prev.filter((entry) => entry.id !== window.id))
                      setSaved(false)
                    }}
                    className="text-sm text-error hover:underline"
                  >
                    {t('gallerySettings.windows.delete')}
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
            className="px-4 py-2 rounded-full border border-ui-border text-text-muted text-sm hover:border-accent hover:text-accent transition-colors"
          >
            {t('gallerySettings.windows.add')}
          </button>
        </section>

        {saved && <p className="text-sm text-success">{t('gallerySettings.saveSuccess')}</p>}

        <button
          type="submit"
          disabled={saving}
          aria-busy={saving}
          className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-50"
        >
          <span className="inline-flex items-center">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            <span>{t('gallerySettings.submit.save')}</span>
            {saving && <span className="sr-only"> {t('gallerySettings.submit.saving')}</span>}
          </span>
        </button>
      </form>

      {/* Gallery actions: QR download + ZIP export */}
      {gallery && (
        <section className="px-4 pb-6 max-w-4xl">
          <h2 className="text-sm font-medium text-text-muted uppercase tracking-wide mb-3">
            {t('gallerySettings.actions.title')}
          </h2>
          <div className="flex flex-wrap gap-3">
            <a
              href={`/api/v1/g/${gallery.slug}/qr?format=png`}
              download={`${gallery.slug}-qr.png`}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-ui-border
                         text-text-muted hover:border-accent hover:text-accent transition-colors text-sm"
              aria-label={t('gallerySettings.actions.qrPngAria')}
            >
              <QrCode className="w-4 h-4" />
              {t('gallerySettings.actions.qrPng')}
            </a>
            <a
              href={`/api/v1/g/${gallery.slug}/qr?format=svg`}
              download={`${gallery.slug}-qr.svg`}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-ui-border
                         text-text-muted hover:border-accent hover:text-accent transition-colors text-sm"
              aria-label={t('gallerySettings.actions.qrSvgAria')}
            >
              <QrCode className="w-4 h-4" />
              {t('gallerySettings.actions.qrSvg')}
            </a>
            <a
              href={`/api/v1/g/${gallery.slug}/qr?format=pdf&locale=${locale}`}
              download={`${gallery.slug}-table-card.pdf`}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-ui-border
                         text-text-muted hover:border-accent hover:text-accent transition-colors text-sm"
              aria-label={t('gallerySettings.actions.tableCardPdfAria')}
            >
              <FileText className="w-4 h-4" />
              {t('gallerySettings.actions.tableCardPdf')}
            </a>
            <button
              onClick={handleArchive}
              disabled={archiving || gallery.isArchived}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-ui-border
                         text-text-muted hover:border-accent hover:text-accent transition-colors text-sm
                         disabled:opacity-50"
              aria-label={t('gallerySettings.actions.archiveAria')}
            >
              <Archive className="w-4 h-4" />
              {gallery.isArchived
                ? t('gallerySettings.actions.archived')
                : (archiving ? t('gallerySettings.actions.archiving') : t('gallerySettings.actions.archive'))}
            </button>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-ui-border
                         text-text-muted hover:border-accent hover:text-accent transition-colors text-sm
                         disabled:opacity-50"
              aria-label={t('gallerySettings.actions.exportZipAria')}
            >
              <Download className="w-4 h-4" />
              {exporting ? t('gallerySettings.actions.exporting') : t('gallerySettings.actions.exportZip')}
            </button>
          </div>
          {gallery.isArchived && gallery.archivedAt && (
            <p className="mt-3 text-xs text-text-muted">
              {t('gallerySettings.actions.archiveMeta', {
                archivedAt: new Date(gallery.archivedAt).toLocaleString(dateLocale(locale)),
                size: formatArchiveSize(gallery.archiveSizeBytes),
              })}
            </p>
          )}
        </section>
      )}

      <AdminUploadPanel
        galleryId={id}
        guestNameMode={guestNameMode}
        onApprovedUploads={refreshApprovedPhotos}
      />

      {photos.length > 0 && (
        <section className="max-w-4xl px-4 pb-8">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-text-muted">
            {t('gallerySettings.approvedPhotos', { count: photos.length })}
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo, index) => (
              <button
                key={photo.id}
                onClick={() => setOpenIndex(index)}
                className="group relative aspect-square overflow-hidden rounded-card"
                aria-label={t('gallerySettings.photoEnlargeAria')}
              >
                <Image
                  src={photo.thumbUrl}
                  alt={photo.guestName ?? t('lightbox.photoAltDefault')}
                  fill
                  className="object-cover transition-transform duration-200 group-hover:scale-105"
                />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Danger zone */}
      <div className="px-4 pb-10 max-w-4xl">
        <div className="border border-error/30 rounded-card p-4">
          <p className="text-sm font-medium text-text-primary mb-1">{t('gallerySettings.danger.title')}</p>
          <p className="text-xs text-text-muted mb-3">
            {t('gallerySettings.danger.description')}
          </p>
          {!confirmDelete ? (
            <button
              onClick={() => {
                setConfirmDelete(true)
                setDeleteConfirmText('')
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-error text-error text-sm hover:bg-error hover:text-white transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              {t('gallerySettings.danger.delete')}
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-text-muted">
                {t('gallerySettings.danger.typeConfirmHint', { slug: gallery.slug })}
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(event) => setDeleteConfirmText(event.target.value)}
                className="w-full rounded-card border border-ui-border bg-surface-card px-3 py-2 text-sm text-text-primary focus:border-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/40"
                aria-label={t('gallerySettings.danger.typeConfirmAria')}
              />
              <div className="flex items-center gap-3">
              <button
                onClick={handleDelete}
                disabled={deleting || deleteConfirmText.trim() !== gallery.slug}
                className="px-4 py-2 rounded-full bg-error text-white text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {deleting ? t('gallerySettings.danger.deleting') : t('gallerySettings.danger.confirmDelete')}
              </button>
              <button
                onClick={() => {
                  setConfirmDelete(false)
                  setDeleteConfirmText('')
                }}
                className="px-4 py-2 rounded-full border border-ui-border text-text-muted text-sm hover:border-accent hover:text-accent transition-colors"
              >
                {t('common.cancel')}
              </button>
              </div>
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
          t={t}
        />
      )}
    </main>
  )
}
