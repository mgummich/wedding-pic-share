export interface UploadResponse {
  id: string
  status: 'PENDING' | 'APPROVED'
  mediaType: 'IMAGE' | 'VIDEO'
  thumbUrl: string
  duration: number | null
  deleteToken?: string
}
