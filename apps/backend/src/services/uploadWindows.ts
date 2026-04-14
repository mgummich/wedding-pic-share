import type { UploadWindow, Gallery } from '@wedding/db'
import type { UploadWindowResponse, GalleryResponse } from '@wedding/shared'
import { createHash } from 'node:crypto'

type GalleryWithWindows = Pick<
  Gallery,
  | 'id'
  | 'name'
  | 'slug'
  | 'description'
  | 'layout'
  | 'allowGuestDownload'
  | 'guestNameMode'
  | 'isActive'
  | 'isArchived'
  | 'archivedAt'
  | 'archiveSizeBytes'
  | 'archiveStatus'
  | 'archiveError'
  | 'archiveRequestedAt'
  | 'stripExif'
> & {
  uploadWindows: UploadWindow[]
}

export function computeUploadWindowsVersion(
  windows: Array<Pick<UploadWindow, 'id' | 'start' | 'end' | 'createdAt'>>
): string {
  const canonical = windows
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((window) => `${window.id}:${window.start.toISOString()}:${window.end.toISOString()}:${window.createdAt.toISOString()}`)
    .join('|')
  return createHash('sha256').update(canonical).digest('base64url')
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
    stripExif: gallery.stripExif,
    photoCount,
    isActive: gallery.isActive,
    isArchived: gallery.isArchived,
    archivedAt: gallery.archivedAt?.toISOString() ?? null,
    archiveSizeBytes: gallery.archiveSizeBytes,
    archiveStatus: gallery.archiveStatus,
    archiveError: gallery.archiveError,
    archiveRequestedAt: gallery.archiveRequestedAt?.toISOString() ?? null,
    isUploadOpen: gallery.isArchived ? false : isUploadOpenAt(gallery.uploadWindows),
    uploadWindowsVersion: computeUploadWindowsVersion(gallery.uploadWindows),
    uploadWindows: gallery.uploadWindows.map(toUploadWindowResponse),
  }
}
