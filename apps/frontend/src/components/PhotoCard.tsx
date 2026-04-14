'use client'

import Image from 'next/image'
import { Expand } from 'lucide-react'
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
        isVideo ? '' : 'cursor-pointer transition-transform duration-[--transition-fast] hover:scale-[1.02]',
      ].join(' ')}
      onClick={isVideo ? undefined : () => onClick?.(photo)}
      role={isVideo ? undefined : 'button'}
      tabIndex={isVideo ? undefined : 0}
      onKeyDown={isVideo ? undefined : (e) => e.key === 'Enter' && onClick?.(photo)}
      aria-label={isVideo
        ? undefined
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
          <video
            src={photo.displayUrl}
            poster={photo.thumbUrl}
            controls
            playsInline
            preload="metadata"
            className="w-full h-auto object-cover bg-black"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
          {onClick && (
            <button
              type="button"
              aria-label={t('photoCard.openVideo')}
              onClick={(e) => {
                e.stopPropagation()
                onClick(photo)
              }}
              className="absolute top-2 right-2 rounded-full bg-black/60 p-1.5 text-white transition-colors hover:bg-black/75"
            >
              <Expand className="h-4 w-4" />
            </button>
          )}
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
