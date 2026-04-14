'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutGrid, Camera, Play } from 'lucide-react'
import { useAdminI18n } from './AdminLocaleContext'

interface GuestNavClientProps {
  gallerySlug: string
}

const NAV_LINKS = [
  { getHref: (slug: string) => `/g/${slug}`, icon: LayoutGrid, key: 'guest.nav.gallery' },
  { getHref: (slug: string) => `/g/${slug}/upload`, icon: Camera, key: 'guest.nav.upload' },
  { getHref: (slug: string) => `/g/${slug}/slideshow`, icon: Play, key: 'guest.nav.slideshow' },
] as const

export function GuestNavClient({ gallerySlug }: GuestNavClientProps) {
  const pathname = usePathname()
  const { t } = useAdminI18n()

  return (
    <div className="flex items-center gap-1">
      {NAV_LINKS.map(({ getHref, icon: Icon, key }) => {
        const href = getHref(gallerySlug)
        const active = pathname === href
        const label = t(key)
        return (
          <Link
            key={key}
            href={href}
            aria-label={label}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors
              ${active ? 'text-accent bg-accent/10' : 'text-text-muted hover:text-text-primary'}`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        )
      })}
    </div>
  )
}
