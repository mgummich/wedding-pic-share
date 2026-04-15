'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createGallery, ApiError } from '@/lib/api'
import { useAdminI18n } from '@/components/AdminLocaleContext'

function toSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default function NewGalleryPage() {
  const router = useRouter()
  const { t } = useAdminI18n()
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
        setError(t('newGallery.error.conflict'))
      } else {
        setError(t('newGallery.error.generic'))
      }
      setLoading(false)
    }
  }

  function handleBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }
    router.push('/admin')
  }

  return (
    <main className="min-h-screen bg-surface-base">
      <header className="border-b border-ui-border px-4 pt-4 pb-4">
        <nav className="mb-2 text-xs text-text-muted">
          <Link href="/admin" className="hover:text-accent transition-colors">{t('dashboard.title')}</Link>
          <span className="mx-1">/</span>
          <span>{t('newGallery.title')}</span>
        </nav>
        <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleBack}
          aria-label={t('newGallery.backAria')}
          className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-display text-2xl text-text-primary">{t('newGallery.title')}</h1>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="px-4 py-6 space-y-5 max-w-4xl">
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium text-text-muted uppercase tracking-wide">{t('newGallery.wedding.section')}</legend>

          <div>
            <label htmlFor="wedding-name" className="block text-sm font-medium text-text-primary mb-1">
              {t('newGallery.wedding.name')}
            </label>
            <input
              id="wedding-name"
              type="text"
              required
              maxLength={100}
              value={weddingName}
              onChange={(e) => handleWeddingNameChange(e.target.value)}
              placeholder={t('newGallery.wedding.namePlaceholder')}
              className="w-full px-4 py-2.5 rounded-card border border-ui-border focus:outline-none focus:border-accent bg-surface-card text-text-primary"
            />
          </div>

          <div>
            <label htmlFor="wedding-slug" className="block text-sm font-medium text-text-primary mb-1">
              {t('newGallery.wedding.slug')}
            </label>
            <input
              id="wedding-slug"
              type="text"
              required
              maxLength={60}
              pattern="[a-z0-9-]+"
              value={weddingSlug}
              onChange={(e) => setWeddingSlug(e.target.value)}
              placeholder={t('newGallery.wedding.slugPlaceholder')}
              className="w-full px-4 py-2.5 rounded-card border border-ui-border focus:outline-none focus:border-accent bg-surface-card text-text-primary font-mono text-sm"
            />
            <p className="text-xs text-text-muted mt-1">{t('newGallery.slugHint')}</p>
          </div>
        </fieldset>

        <fieldset className="space-y-4 pt-2">
          <legend className="text-sm font-medium text-text-muted uppercase tracking-wide">{t('newGallery.gallery.section')}</legend>

          <div>
            <label htmlFor="gallery-name" className="block text-sm font-medium text-text-primary mb-1">
              {t('newGallery.gallery.name')}
            </label>
            <input
              id="gallery-name"
              type="text"
              required
              maxLength={100}
              value={galleryName}
              onChange={(e) => handleGalleryNameChange(e.target.value)}
              placeholder={t('newGallery.gallery.namePlaceholder')}
              className="w-full px-4 py-2.5 rounded-card border border-ui-border focus:outline-none focus:border-accent bg-surface-card text-text-primary"
            />
          </div>

          <div>
            <label htmlFor="gallery-slug" className="block text-sm font-medium text-text-primary mb-1">
              {t('newGallery.gallery.slug')}
            </label>
            <input
              id="gallery-slug"
              type="text"
              required
              maxLength={60}
              pattern="[a-z0-9-]+"
              value={gallerySlug}
              onChange={(e) => setGallerySlug(e.target.value)}
              placeholder={t('newGallery.gallery.slugPlaceholder')}
              className="w-full px-4 py-2.5 rounded-card border border-ui-border focus:outline-none focus:border-accent bg-surface-card text-text-primary font-mono text-sm"
            />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-text-primary mb-1">
              {t('newGallery.description')} <span className="text-text-muted font-normal">{t('newGallery.optional')}</span>
            </label>
            <textarea
              id="description"
              rows={2}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('newGallery.descriptionPlaceholder')}
              className="w-full px-4 py-2.5 rounded-card border border-ui-border focus:outline-none focus:border-accent bg-surface-card text-text-primary resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">{t('newGallery.layout')}</label>
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
                    {l === 'MASONRY' ? t('newGallery.layout.masonry') : t('newGallery.layout.grid')}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">{t('newGallery.guestName')}</label>
            <div className="flex flex-col gap-2">
              {([['OPTIONAL', t('newGallery.guestName.optional')], ['REQUIRED', t('newGallery.guestName.required')], ['HIDDEN', t('newGallery.guestName.hidden')]] as const).map(([val, label]) => (
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
            <label className="block text-sm font-medium text-text-primary mb-2">{t('newGallery.moderation')}</label>
            <div className="flex gap-3">
              {([['MANUAL', t('newGallery.moderation.manual')], ['AUTO', t('newGallery.moderation.auto')]] as const).map(([val, label]) => (
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
            <span className="text-sm text-text-primary">{t('newGallery.allowDownload')}</span>
          </label>
        </fieldset>

        {error && <p className="text-sm text-error">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-50"
        >
          {loading ? t('newGallery.submit.loading') : t('newGallery.submit.create')}
        </button>
      </form>
    </main>
  )
}
