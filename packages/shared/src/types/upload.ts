export interface UploadResponse {
  id: string
  status: 'PENDING' | 'APPROVED'
  mediaType: 'IMAGE' | 'VIDEO'
  thumbUrl: string
  /** Duration in seconds; null for images */
  duration: number | null
  /** Present for pending guest uploads to allow self-delete before moderation */
  deleteToken?: string
}
