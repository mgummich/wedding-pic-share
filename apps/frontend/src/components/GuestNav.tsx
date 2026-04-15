'use client'

import { GuestNavClient } from './GuestNavClient'
import { useGuestI18n } from '@/lib/guestI18n'

interface GuestNavProps {
  gallerySlug: string
  galleryName: string
}

export function GuestNav({ gallerySlug, galleryName }: GuestNavProps) {
  const { t } = useGuestI18n()

  return (
    <nav aria-label={t('guest.nav.aria')} className="sticky top-0 z-30 bg-surface-base/95 backdrop-blur border-b border-ui-border">
      <div className="flex items-center justify-between px-4 h-14">
        <span className="font-display text-lg text-text-primary truncate mr-4">
          {galleryName}
        </span>
        <GuestNavClient gallerySlug={gallerySlug} />
      </div>
    </nav>
  )
}
