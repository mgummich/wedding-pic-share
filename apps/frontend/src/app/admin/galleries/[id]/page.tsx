'use client'

import { useEffect, useState, use, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { getAdminGalleries, updateGallery, deleteGallery, ApiError } from '@/lib/api'

interface PageProps {
  params: Promise<{ id: string }>
}

type GalleryData = Awaited<ReturnType<typeof getAdminGalleries>>[number]

export default function GallerySettingsPage({ params }: PageProps) {
  const { id } = use(params)
  const router = useRouter()

  const [gallery, setGallery] = useState<GalleryData | null>(null)
  const [loadError, setLoadError] = useState(false)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [layout, setLayout] = useState<'MASONRY' | 'GRID'>('MASONRY')
  const [guestNameMode, setGuestNameMode] = useState<'OPTIONAL' | 'REQUIRED' | 'HIDDEN'>('OPTIONAL')
  const [allowGuestDownload, setAllowGuestDownload] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

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
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/admin/login')
        else setLoadError(true)
      })
  }, [id, router])

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setSaveError(null)
    setSaving(true)
    setSaved(false)
    try {
      await updateGallery(id, {
        name,
        description: description.trim() || null,
        layout,
        guestNameMode,
        allowGuestDownload,
      })
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
    </main>
  )
}
