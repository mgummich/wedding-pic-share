'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutGrid, Camera, Play } from 'lucide-react'

interface GuestNavClientProps {
  gallerySlug: string
}

const NAV_LINKS = [
  { getHref: (slug: string) => `/g/${slug}`, icon: LayoutGrid, label: 'Galerie' },
  { getHref: (slug: string) => `/g/${slug}/upload`, icon: Camera, label: 'Hochladen' },
  { getHref: (slug: string) => `/g/${slug}/slideshow`, icon: Play, label: 'Slideshow' },
]

export function GuestNavClient({ gallerySlug }: GuestNavClientProps) {
  const pathname = usePathname()

  return (
    <div className="flex items-center gap-1">
      {NAV_LINKS.map(({ getHref, icon: Icon, label }) => {
        const href = getHref(gallerySlug)
        const active = pathname === href
        return (
          <Link
            key={label}
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
