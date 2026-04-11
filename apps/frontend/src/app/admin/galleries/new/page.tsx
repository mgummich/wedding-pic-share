'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createGallery, ApiError } from '@/lib/api'

function toSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default function NewGalleryPage() {
  const router = useRouter()
  const [weddingName, setWeddingName] = useState('')
  const [weddingSlug, setWeddingSlug] = useState('')
  const [galleryName, setGalleryName] = useState('')
  const [gallerySlug, setGallerySlug] = useState('')
  const [description, setDescription] = useState('')
  const [layout, setLayout] = useState<'MASONRY' | 'GRID'>('MASONRY')
  const [guestNameMode, setGuestNameMode] = useState<'OPTIONAL' | 'REQUIRED' | 'HIDDEN'>('OPTIONAL')
  const [moderationMode, setModerationMode] = useState<'MANUAL' | 'AUTO'>('MANUAL')
  const [allowGuestDownload, setAllowGuestDownload] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function handleWeddingNameChange(v: string) {
    setWeddingName(v)
    setWeddingSlug(toSlug(v))
  }

  function handleGalleryNameChange(v: string) {
    setGalleryName(v)
    setGallerySlug(toSlug(v))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await createGallery({
        weddingName,
        weddingSlug,
        galleryName,
        gallerySlug,
        description: description.trim() || undefined,
        layout,
        guestNameMode,
        moderationMode,
        allowGuestDownload,
      })
      router.replace('/admin')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('Eine Galerie mit diesem Slug existiert bereits.')
      } else {
        setError('Ein Fehler ist aufgetreten. Bitte versuche es erneut.')
      }
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-surface-base">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4 border-b border-border">
        <Link href="/admin" className="p-1.5 text-text-muted hover:text-text-primary transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="font-display text-2xl text-text-primary">Neue Galerie</h1>
      </header>

      <form onSubmit={handleSubmit} className="px-4 py-6 space-y-5 max-w-lg">
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium text-text-muted uppercase tracking-wide">Hochzeit</legend>

          <div>
            <label htmlFor="wedding-name" className="block text-sm font-medium text-text-primary mb-1">
              Name der Hochzeit
            </label>
            <input
              id="wedding-name"
              type="text"
              required
              maxLength={100}
              value={weddingName}
              onChange={(e) => handleWeddingNameChange(e.target.value)}
              placeholder="Anna & Max"
              className="w-full px-4 py-2.5 rounded-card border border-border focus:outline-none focus:border-accent bg-surface-card text-text-primary"
            />
          </div>

          <div>
            <label htmlFor="wedding-slug" className="block text-sm font-medium text-text-primary mb-1">
              Slug
            </label>
            <input
              id="wedding-slug"
              type="text"
              required
              maxLength={60}
              pattern="[a-z0-9-]+"
              value={weddingSlug}
              onChange={(e) => setWeddingSlug(e.target.value)}
              placeholder="anna-max"
              className="w-full px-4 py-2.5 rounded-card border border-border focus:outline-none focus:border-accent bg-surface-card text-text-primary font-mono text-sm"
            />
            <p className="text-xs text-text-muted mt-1">Nur Kleinbuchstaben, Zahlen und Bindestriche</p>
          </div>
        </fieldset>

        <fieldset className="space-y-4 pt-2">
          <legend className="text-sm font-medium text-text-muted uppercase tracking-wide">Galerie</legend>

          <div>
            <label htmlFor="gallery-name" className="block text-sm font-medium text-text-primary mb-1">
              Name der Galerie
            </label>
            <input
              id="gallery-name"
              type="text"
              required
              maxLength={100}
              value={galleryName}
              onChange={(e) => handleGalleryNameChange(e.target.value)}
              placeholder="Hochzeitsfeier"
              className="w-full px-4 py-2.5 rounded-card border border-border focus:outline-none focus:border-accent bg-surface-card text-text-primary"
            />
          </div>

          <div>
            <label htmlFor="gallery-slug" className="block text-sm font-medium text-text-primary mb-1">
              Slug
            </label>
            <input
              id="gallery-slug"
              type="text"
              required
              maxLength={60}
              pattern="[a-z0-9-]+"
              value={gallerySlug}
              onChange={(e) => setGallerySlug(e.target.value)}
              placeholder="hochzeitsfeier"
              className="w-full px-4 py-2.5 rounded-card border border-border focus:outline-none focus:border-accent bg-surface-card text-text-primary font-mono text-sm"
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
              placeholder="Kurze Beschreibung der Galerie…"
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

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Moderation</label>
            <div className="flex gap-3">
              {([['MANUAL', 'Manuell'], ['AUTO', 'Automatisch']] as const).map(([val, label]) => (
                <label key={val} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="moderationMode"
                    value={val}
                    checked={moderationMode === val}
                    onChange={() => setModerationMode(val)}
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
        </fieldset>

        {error && <p className="text-sm text-error">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-50"
        >
          {loading ? 'Wird erstellt…' : 'Galerie erstellen'}
        </button>
      </form>
    </main>
  )
}
