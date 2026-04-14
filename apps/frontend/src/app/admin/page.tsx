'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getAdminGalleries, ApiError } from '@/lib/api'
import { Settings } from 'lucide-react'
import { useAdminI18n } from '@/components/AdminLocaleContext'

export default function AdminDashboardPage() {
  const router = useRouter()
  const { t } = useAdminI18n()
  const [galleries, setGalleries] = useState<Awaited<ReturnType<typeof getAdminGalleries>>>([])
  const [loading, setLoading] = useState(true)
  const sortedGalleries = [...galleries].sort((a, b) => {
    if (a.isActive === b.isActive) return a.name.localeCompare(b.name)
    return a.isActive ? -1 : 1
  })

  useEffect(() => {
    getAdminGalleries()
      .then(setGalleries)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/admin/login')
      })
      .finally(() => setLoading(false))
  }, [router])

  return (
    <main className="min-h-screen bg-surface-base">
      <header className="flex items-center justify-between px-4 pt-6 pb-4 border-b border-border">
        <div>
          <h1 className="font-display text-2xl text-text-primary">{t('dashboard.title')}</h1>
          <p className="text-xs text-text-muted mt-1">
            {t('dashboard.singleGalleryHint')}
          </p>
        </div>
      </header>

      <div className="px-4 py-4 space-y-3">
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-card bg-border animate-pulse" />
            ))}
          </div>
        )}

        {!loading && galleries.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center">
            <p className="text-text-muted mb-4">{t('dashboard.empty')}</p>
            <Link
              href="/admin/galleries/new"
              className="px-5 py-2.5 rounded-full bg-accent text-white hover:bg-accent-hover transition-colors"
            >
              {t('dashboard.createFirst')}
            </Link>
          </div>
        )}

        {sortedGalleries.map((gallery) => (
          <div
            key={gallery.id}
            className="bg-surface-card border border-border rounded-card p-4"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-medium text-text-primary">{gallery.name}</h2>
                  {gallery.isActive && (
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
                      {t('dashboard.rootActive')}
                    </span>
                  )}
                </div>
                <p className="text-sm text-text-muted mt-0.5">
                  {t('dashboard.photos', { count: gallery.photoCount })}
                </p>
                <p className="text-xs text-text-muted mt-0.5 font-mono">/g/{gallery.slug}</p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/admin/galleries/${gallery.id}/moderate`}
                  className="text-xs px-3 py-1.5 rounded-full bg-surface-base border border-border text-text-muted hover:border-accent hover:text-accent transition-colors"
                >
                  {t('dashboard.moderate')}
                </Link>
                <Link
                  href={`/admin/galleries/${gallery.id}`}
                  aria-label={t('dashboard.settingsAria')}
                  className="p-1.5 text-text-muted hover:text-accent transition-colors"
                >
                  <Settings className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
