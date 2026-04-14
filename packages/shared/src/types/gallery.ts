export interface UploadWindowResponse {
  id: string
  start: string
  end: string
  createdAt: string
}

export interface GalleryResponse {
  id: string
  name: string
  slug: string
  description: string | null
  layout: 'MASONRY' | 'GRID'
  allowGuestDownload: boolean
  guestNameMode: 'OPTIONAL' | 'REQUIRED' | 'HIDDEN'
  stripExif: boolean
  photoCount: number
  isActive: boolean
  isArchived: boolean
  archivedAt: string | null
  archiveSizeBytes: number | null
  archiveStatus?: 'IDLE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  archiveError?: string | null
  archiveRequestedAt?: string | null
  isUploadOpen: boolean
  uploadWindowsVersion: string
  uploadWindows: UploadWindowResponse[]
}

export interface WeddingResponse {
  id: string
  name: string
  slug: string
  galleries: GalleryResponse[]
  createdAt: string
}
