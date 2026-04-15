'use client'

import Image from 'next/image'
import { Expand, Play } from 'lucide-react'
import type { PhotoResponse } from '@wedding/shared'
import { useGuestI18n } from '@/lib/guestI18n'

interface PhotoCardProps {
  photo: PhotoResponse
  onClick?: (photo: PhotoResponse) => void
  priority?: boolean
}

export function PhotoCard({ photo, onClick, priority = false }: PhotoCardProps) {
  const { t } = useGuestI18n()
  const isVideo = photo.mediaType === 'VIDEO'

  return (
    <div
      className={[
        'relative overflow-hidden rounded-thumb shadow-sm group',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        isVideo ? 'cursor-pointer transition-transform duration-[--transition-fast] hover:scale-[1.01]' : 'cursor-pointer transition-transform duration-[--transition-fast] hover:scale-[1.02]',
      ].join(' ')}
      onClick={() => onClick?.(photo)}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (!onClick) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.(photo)
        }
      }}
      aria-label={isVideo
        ? t('photoCard.openVideo')
        : (
            photo.guestName
              ? t('photoCard.openPhotoByGuest', { guest: photo.guestName })
              : t('photoCard.openPhotoDefault')
          )}
    >
      {!isVideo && (
        <Image
          src={photo.thumbUrl}
          alt={photo.guestName
            ? t('photoCard.imageAltByGuest', { guest: photo.guestName })
            : t('photoCard.imageAltDefault')}
          width={400}
          height={300}
          className="w-full h-auto object-cover"
          placeholder={photo.blurDataUrl ? 'blur' : 'empty'}
          blurDataURL={photo.blurDataUrl ?? undefined}
          priority={priority}
          unoptimized // served directly from backend
        />
      )}

      {isVideo && (
        <>
          <Image
            src={photo.thumbUrl}
            alt={photo.guestName
              ? t('photoCard.imageAltByGuest', { guest: photo.guestName })
              : t('photoCard.imageAltDefault')}
            width={400}
            height={300}
            className="w-full h-auto object-cover bg-black"
            placeholder={photo.blurDataUrl ? 'blur' : 'empty'}
            blurDataURL={photo.blurDataUrl ?? undefined}
            priority={priority}
            unoptimized
          />
          <span className="pointer-events-none absolute inset-0 bg-black/20" />
          <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-card bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
            <Play className="h-3 w-3 fill-current" />
            Video
          </span>
          <span className="pointer-events-none absolute top-2 right-2 rounded-full bg-black/60 p-1.5 text-white">
            <Expand className="h-4 w-4" />
          </span>
          {photo.duration && (
            <span className="pointer-events-none absolute bottom-2 right-2 text-xs text-white bg-black/60 px-1.5 py-0.5 rounded">
              {formatDuration(photo.duration)}
            </span>
          )}
        </>
      )}
    </div>
  )
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
