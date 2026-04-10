export interface PhotoResponse {
  id: string
  mediaType: 'IMAGE' | 'VIDEO'
  thumbUrl: string
  displayUrl: string
  duration: number | null
  guestName: string | null
  createdAt: string
  blurDataUrl?: string
}
