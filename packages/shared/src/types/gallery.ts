export interface GalleryResponse {
  id: string
  name: string
  slug: string
  description: string | null
  layout: 'MASONRY' | 'GRID'
  allowGuestDownload: boolean
  guestNameMode: 'OPTIONAL' | 'REQUIRED' | 'HIDDEN'
  photoCount: number
}

export interface WeddingResponse {
  id: string
  name: string
  slug: string
  galleries: GalleryResponse[]
  createdAt: string
}
