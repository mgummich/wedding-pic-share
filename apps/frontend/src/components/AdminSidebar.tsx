'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { LogOut, Plus, Menu, X } from 'lucide-react'
import { getAdminGalleries, adminLogout, ApiError } from '@/lib/api'

export function AdminSidebar() {
  const router = useRouter()
  const pathname = usePathname()
  const [galleries, setGalleries] = useState<Awaited<ReturnType<typeof getAdminGalleries>>>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    getAdminGalleries()
      .then(setGalleries)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/admin/login')
        }
      })
  }, [router])

  async function handleLogout() {
    await adminLogout()
    router.replace('/admin/login')
  }

  return (
    <>
      <button
        className="fixed top-3 left-3 z-50 rounded-full border border-border bg-surface-card p-2 text-text-muted shadow-sm md:hidden"
        onClick={() => setOpen((current) => !current)}
        aria-label={open ? 'Seitenleiste schließen' : 'Seitenleiste öffnen'}
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={[
          'fixed left-0 top-0 z-40 flex h-full w-60 flex-col border-r border-border bg-surface-card transition-transform duration-200',
          open ? 'translate-x-0' : '-translate-x-full',
          'md:translate-x-0',
        ].join(' ')}
      >
        <div className="shrink-0 border-b border-border px-5 pb-4 pt-6">
          <p className="font-display text-xl text-text-primary">Wedding Pics</p>
        </div>

        <nav className="flex-1 overflow-y-auto py-3" aria-label="Admin navigation">
          <div className="mb-1 flex items-center justify-between px-4">
            <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Galerien
            </span>
            <Link
              href="/admin/galleries/new"
              onClick={() => setOpen(false)}
              className="p-1 text-text-muted transition-colors hover:text-accent"
              aria-label="Neue Galerie erstellen"
            >
              <Plus className="h-4 w-4" />
            </Link>
          </div>

          {galleries.map((gallery) => {
            const isActive = pathname.startsWith(`/admin/galleries/${gallery.id}`)

            return (
              <Link
                key={gallery.id}
                href={`/admin/galleries/${gallery.id}`}
                onClick={() => setOpen(false)}
                className={[
                  'flex flex-col border-l-2 px-4 py-2.5 transition-colors',
                  isActive
                    ? 'border-accent bg-surface-base text-text-primary'
                    : 'border-transparent text-text-muted hover:bg-surface-base hover:text-text-primary',
                ].join(' ')}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{gallery.name}</span>
                  {gallery.isActive && (
                    <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                      Root
                    </span>
                  )}
                </div>
                <span className="truncate text-xs opacity-60">{gallery.weddingName}</span>
              </Link>
            )
          })}

          {galleries.length === 0 && (
            <p className="px-4 py-3 text-xs text-text-muted">Noch keine Galerien</p>
          )}
        </nav>

        <div className="shrink-0 border-t border-border px-4 py-4">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 text-sm text-text-muted transition-colors hover:text-text-primary"
          >
            <LogOut className="h-4 w-4" />
            Abmelden
          </button>
        </div>
      </aside>
    </>
  )
}
