'use client'

import { PhotoCard } from './PhotoCard'
import type { PhotoResponse } from '@wedding/shared'

interface PhotoGridProps {
  photos: PhotoResponse[]
  layout: 'MASONRY' | 'GRID'
  onPhotoClick?: (photo: PhotoResponse) => void
}

export function PhotoGrid({ photos, layout, onPhotoClick }: PhotoGridProps) {
  if (layout === 'GRID') {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {photos.map((photo, i) => (
          <PhotoCard
            key={photo.id}
            photo={photo}
            onClick={onPhotoClick}
            priority={i < 4}
          />
        ))}
      </div>
    )
  }

  // Masonry layout using CSS columns
  return (
    <div className="columns-2 sm:columns-3 md:columns-4 gap-2">
      {photos.map((photo, i) => (
        <div
          key={photo.id}
          className="mb-2 break-inside-avoid"
          style={{ animationDelay: i < 20 ? `${i * 60}ms` : '0ms' }}
        >
          <PhotoCard photo={photo} onClick={onPhotoClick} priority={i < 4} />
        </div>
      ))}
    </div>
  )
}
