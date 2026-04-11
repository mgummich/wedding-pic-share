import { GuestNavClient } from './GuestNavClient'

interface GuestNavProps {
  gallerySlug: string
  galleryName: string
}

export function GuestNav({ gallerySlug, galleryName }: GuestNavProps) {
  return (
    <nav className="sticky top-0 z-30 bg-surface-base/95 backdrop-blur border-b border-border">
      <div className="flex items-center justify-between px-4 h-14">
        <span className="font-display text-lg text-text-primary truncate mr-4">
          {galleryName}
        </span>
        <GuestNavClient gallerySlug={gallerySlug} />
      </div>
    </nav>
  )
}
