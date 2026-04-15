export interface PhotoResponse {
  id: string
  mediaType: 'IMAGE' | 'VIDEO'
  thumbUrl: string
  displayUrl: string
  /** Duration in seconds; null for images */
  duration: number | null
  guestName: string | null
  /** ISO 8601 timestamp */
  createdAt: string
  /** Optional low-res placeholder data URL (e.g. data:image/webp;base64,...) */
  blurDataUrl?: string
}
