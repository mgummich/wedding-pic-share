import type { UploadWindow, Gallery } from '@wedding/db'
import type { UploadWindowResponse, GalleryResponse } from '@wedding/shared'

type GalleryWithWindows = Pick<
  Gallery,
  'id' | 'name' | 'slug' | 'description' | 'layout' | 'allowGuestDownload' | 'guestNameMode' | 'isActive'
> & {
  uploadWindows: UploadWindow[]
}

export function isUploadOpenAt(windows: Array<Pick<UploadWindow, 'start' | 'end'>>, now = new Date()): boolean {
  if (windows.length === 0) return true
  const time = now.getTime()
  return windows.some((window) => window.start.getTime() <= time && window.end.getTime() >= time)
}

export function toUploadWindowResponse(window: UploadWindow): UploadWindowResponse {
  return {
    id: window.id,
    start: window.start.toISOString(),
    end: window.end.toISOString(),
    createdAt: window.createdAt.toISOString(),
  }
}

export function toGalleryResponse(
  gallery: GalleryWithWindows,
  photoCount: number
): GalleryResponse {
  return {
    id: gallery.id,
    name: gallery.name,
    slug: gallery.slug,
    description: gallery.description,
    layout: gallery.layout,
    allowGuestDownload: gallery.allowGuestDownload,
    guestNameMode: gallery.guestNameMode,
    photoCount,
    isActive: gallery.isActive,
    isUploadOpen: isUploadOpenAt(gallery.uploadWindows),
    uploadWindows: gallery.uploadWindows.map(toUploadWindowResponse),
  }
}
