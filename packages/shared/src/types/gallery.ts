export interface UploadWindowResponse {
  id: string
  /** ISO 8601 timestamp */
  start: string
  /** ISO 8601 timestamp */
  end: string
  /** ISO 8601 timestamp */
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
  /** Exactly one gallery can be active at a time for /g/active */
  isActive: boolean
  isArchived: boolean
  /** ISO 8601 timestamp when archive completed, null when not archived */
  archivedAt: string | null
  archiveSizeBytes: number | null
  /** Async archive workflow state; omitted in older responses */
  archiveStatus?: 'IDLE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  archiveError?: string | null
  /** ISO 8601 timestamp for last archive trigger */
  archiveRequestedAt?: string | null
  /** Current upload-state projection for guests */
  isUploadOpen: boolean
  /** Optimistic lock token for uploadWindows updates */
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
