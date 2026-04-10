'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getAdminGalleries, adminLogout, ApiError } from '@/lib/api.js'
import { Plus, LogOut, Settings } from 'lucide-react'

export default function AdminDashboardPage() {
  const router = useRouter()
  const [galleries, setGalleries] = useState<Awaited<ReturnType<typeof getAdminGalleries>>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getAdminGalleries()
      .then(setGalleries)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/admin/login')
      })
      .finally(() => setLoading(false))
  }, [router])

  async function handleLogout() {
    await adminLogout()
    router.replace('/admin/login')
  }

  return (
    <main className="min-h-screen bg-surface-base">
      <header className="flex items-center justify-between px-4 pt-6 pb-4 border-b border-border">
        <h1 className="font-display text-2xl text-text-primary">Galerien</h1>
        <div className="flex items-center gap-3">
          <Link
            href="/admin/galleries/new"
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-accent text-white text-sm hover:bg-accent-hover transition-colors"
          >
            <Plus className="w-4 h-4" />
            Neu
          </Link>
          <button
            onClick={handleLogout}
            className="p-2 text-text-muted hover:text-text-primary transition-colors"
            title="Abmelden"
          >
            <LogOut className="w-5 h-5" />
          </button>
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
            <p className="text-text-muted mb-4">Noch keine Galerien. Erstelle die erste!</p>
            <Link
              href="/admin/galleries/new"
              className="px-5 py-2.5 rounded-full bg-accent text-white hover:bg-accent-hover transition-colors"
            >
              Erste Galerie erstellen
            </Link>
          </div>
        )}

        {galleries.map((gallery) => (
          <div
            key={gallery.id}
            className="bg-surface-card border border-border rounded-card p-4"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-medium text-text-primary">{gallery.name}</h2>
                <p className="text-sm text-text-muted mt-0.5">{gallery.photoCount} Fotos</p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/admin/galleries/${gallery.id}/moderate`}
                  className="text-xs px-3 py-1.5 rounded-full bg-surface-base border border-border text-text-muted hover:border-accent hover:text-accent transition-colors"
                >
                  Moderieren
                </Link>
                <Link
                  href={`/admin/galleries/${gallery.id}`}
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
