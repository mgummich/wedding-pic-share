'use client'

import Image from 'next/image'
import { Play } from 'lucide-react'
import type { PhotoResponse } from '@wedding/shared'

interface PhotoCardProps {
  photo: PhotoResponse
  onClick?: (photo: PhotoResponse) => void
  priority?: boolean
}

export function PhotoCard({ photo, onClick, priority = false }: PhotoCardProps) {
  return (
    <div
      className="relative overflow-hidden rounded-thumb shadow-sm cursor-pointer group
                 transition-transform duration-[--transition-fast] hover:scale-[1.02]"
      onClick={() => onClick?.(photo)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.(photo)}
      aria-label={photo.guestName ? `Photo by ${photo.guestName}` : 'Gallery photo'}
    >
      <Image
        src={photo.thumbUrl}
        alt={photo.guestName ? `Photo by ${photo.guestName}` : 'Wedding photo'}
        width={400}
        height={300}
        className="w-full h-auto object-cover"
        placeholder={photo.blurDataUrl ? 'blur' : 'empty'}
        blurDataURL={photo.blurDataUrl ?? undefined}
        priority={priority}
        unoptimized // served directly from backend
      />

      {photo.mediaType === 'VIDEO' && (
        <div className="absolute inset-0 flex items-center justify-center
                        bg-black/30 group-hover:bg-black/10 transition-colors">
          <div className="w-12 h-12 rounded-full bg-white/80 flex items-center justify-center">
            <Play className="w-6 h-6 text-text-primary fill-current ml-0.5" />
          </div>
          {photo.duration && (
            <span className="absolute bottom-2 right-2 text-xs text-white bg-black/60 px-1.5 py-0.5 rounded">
              {formatDuration(photo.duration)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
