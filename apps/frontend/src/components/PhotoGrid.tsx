'use client'

import { PhotoCard } from './PhotoCard'
import type { PhotoResponse } from '@wedding/shared'

interface PhotoGridProps {
  photos: PhotoResponse[]
  layout: 'MASONRY' | 'GRID'
  onPhotoClick?: (photo: PhotoResponse) => void
}

export function PhotoGrid({ photos, layout, onPhotoClick }: PhotoGridProps) {
  const optimizeLargeList = photos.length > 50

  if (layout === 'GRID') {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {photos.map((photo, i) => (
          <div
            key={photo.id}
            style={optimizeLargeList ? { contentVisibility: 'auto', containIntrinsicSize: '300px 300px' } : undefined}
          >
            <PhotoCard
              photo={photo}
              onClick={onPhotoClick}
              priority={i < 4}
            />
          </div>
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
          className="mb-2 break-inside-avoid opacity-0 animate-fade-up"
          style={optimizeLargeList
            ? {
              animationDelay: i < 20 ? `${i * 60}ms` : '0ms',
              contentVisibility: 'auto',
              containIntrinsicSize: '300px 300px',
            }
            : { animationDelay: i < 20 ? `${i * 60}ms` : '0ms' }}
        >
          <PhotoCard photo={photo} onClick={onPhotoClick} priority={i < 4} />
        </div>
      ))}
    </div>
  )
}
