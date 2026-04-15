'use client'

import { FormEvent, use, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { ApiError, verifyGalleryAccess } from '@/lib/api'
import { useGuestI18n } from '@/lib/guestI18n'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default function GalleryUnlockPage({ params }: PageProps) {
  const { slug } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const { t } = useGuestI18n()
  const [secretKey, setSecretKey] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nextPath = useMemo(() => {
    const next = searchParams.get('next')
    if (!next) return `/g/${slug}`
    if (!next.startsWith(`/g/${slug}`)) return `/g/${slug}`
    return next
  }, [searchParams, slug])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const value = secretKey.trim()
    if (value.length === 0) {
      setError(t('guest.unlock.error.emptyPin'))
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await verifyGalleryAccess(slug, value)
      router.replace(nextPath)
      router.refresh()
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 429) {
        setError(t('guest.unlock.error.rateLimited'))
        return
      }
      setError(t('guest.unlock.error.invalid'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-surface-base flex items-center justify-center px-4">
      <section className="w-full max-w-sm rounded-card border border-ui-border bg-surface-card p-6 space-y-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl text-text-primary">{t('guest.unlock.title')}</h1>
          <p className="text-sm text-text-muted">
            {t('guest.unlock.description')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <label htmlFor="secret-key" className="block text-sm font-medium text-text-primary">
            {t('guest.unlock.pinLabel')}
          </label>
          <input
            id="secret-key"
            type="password"
            autoComplete="off"
            value={secretKey}
            onChange={(event) => setSecretKey(event.target.value)}
            className="w-full px-4 py-2.5 rounded-card border border-ui-border focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 bg-surface-card text-text-primary"
          />
          {error && <p className="text-sm text-error">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            aria-busy={submitting}
            className="w-full py-2.5 rounded-full bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-50"
          >
            <span className="inline-flex items-center">
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              <span>{t('guest.unlock.submit')}</span>
              {submitting && <span className="sr-only"> {t('guest.unlock.submitting')}</span>}
            </span>
          </button>
        </form>

        <p className="text-xs text-text-muted">
          {t('guest.unlock.noPinHint')}
        </p>
        <Link href={`/g/${slug}`} className="text-sm text-accent hover:underline">
          {t('guest.unlock.back')}
        </Link>
      </section>
    </main>
  )
}
