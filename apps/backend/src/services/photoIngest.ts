import type { MultipartFile } from '@fastify/multipart'
import { fileTypeFromBuffer } from 'file-type'
import { getClient } from '@wedding/db'
import { computeSha256 } from './media.js'
import type { StorageService } from './storage.js'
import type { SseManager } from './sse.js'
import type { PhotoResponse, UploadResponse } from '@wedding/shared'
import type { MediaProcessor } from './mediaProcessor.js'

const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic',
  'video/mp4', 'video/quicktime',
])

type IngestGallery = {
  id: string
  slug: string
  moderationMode: 'MANUAL' | 'AUTO'
  stripExif: boolean
}

type IngestUploadInput = {
  gallery: IngestGallery
  upload: MultipartFile | undefined
  storage: StorageService
  sse: SseManager
  mediaProcessor: MediaProcessor
  limits: {
    maxFileSizeMb: number
    maxVideoSizeMb: number
  }
}

export class PhotoIngestError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: Record<string, unknown>
  ) {
    super(typeof body.title === 'string' ? body.title : 'Photo ingest failed')
  }
}

export async function ingestUploadedPhoto({
  gallery,
  upload,
  storage,
  sse,
  mediaProcessor,
  limits,
}: IngestUploadInput): Promise<UploadResponse> {
  if (!upload) {
    throw new PhotoIngestError(400, {
      type: 'bad-request',
      title: 'No file provided',
      status: 400,
    })
  }

  const buffer = await upload.toBuffer()
  const detectedType = await fileTypeFromBuffer(buffer)

  if (!detectedType || !ALLOWED_MIMES.has(detectedType.mime)) {
    throw new PhotoIngestError(415, {
      type: 'unsupported-mime-type',
      title: 'Unsupported Media Type',
      status: 415,
      detail: `MIME type "${detectedType?.mime ?? 'unknown'}" is not allowed.`,
    })
  }

  const isVideo = detectedType.mime.startsWith('video/')
  const maxBytes = Math.floor(
    (isVideo ? limits.maxVideoSizeMb : limits.maxFileSizeMb) * 1024 * 1024
  )
  if (buffer.length > maxBytes) {
    throw new PhotoIngestError(413, {
      type: 'file-too-large',
      title: 'Payload Too Large',
      status: 413,
    })
  }

  const db = getClient()
  const fileHash = computeSha256(buffer)
  const existingDup = await db.photo.findUnique({
    where: { galleryId_fileHash: { galleryId: gallery.id, fileHash } },
  })
  if (existingDup) {
    throw new PhotoIngestError(409, {
      type: 'duplicate-photo',
      title: 'Duplicate Photo',
      status: 409,
      detail: 'This photo has already been uploaded to this gallery.',
    })
  }

  const photoId = `photo_${Date.now()}_${Math.random().toString(36).slice(2)}`

  let thumbPath: string
  let displayPath: string
  let blurDataUrl: string
  let duration: number | null = null

  if (!isVideo) {
    const result = await mediaProcessor.processImage(buffer, detectedType.mime, { stripExif: gallery.stripExif })
    await storage.save(gallery.slug, `${photoId}_thumb.webp`, result.thumb)
    await storage.save(gallery.slug, `${photoId}_display.webp`, result.display)
    await storage.save(gallery.slug, `${photoId}_original.webp`, result.original)
    thumbPath = `${photoId}_thumb.webp`
    displayPath = `${photoId}_display.webp`
    blurDataUrl = result.blurDataUrl
  } else {
    const result = await mediaProcessor.processVideo(buffer)
    const ext = detectedType.mime === 'video/quicktime' ? 'mov' : 'mp4'
    await storage.save(gallery.slug, `${photoId}_original.${ext}`, buffer)
    await storage.save(gallery.slug, `${photoId}_poster.webp`, result.poster)
    thumbPath = `${photoId}_poster.webp`
    displayPath = `${photoId}_original.${ext}`
    blurDataUrl = result.blurDataUrl
    duration = result.durationSeconds
  }

  const guestName = getMultipartFieldValue(upload, 'guestName')
  const autoApprove = gallery.moderationMode === 'AUTO'

  const photo = await db.photo.create({
    data: {
      id: photoId,
      galleryId: gallery.id,
      guestName,
      fileHash,
      mediaType: isVideo ? 'VIDEO' : 'IMAGE',
      originalPath: isVideo
        ? `${photoId}_original.${detectedType.mime === 'video/quicktime' ? 'mov' : 'mp4'}`
        : `${photoId}_original.webp`,
      thumbPath,
      displayPath,
      posterPath: isVideo ? `${photoId}_poster.webp` : null,
      blurDataUrl,
      duration,
      mimeType: detectedType.mime,
      exifStripped: !isVideo && gallery.stripExif,
      status: autoApprove ? 'APPROVED' : 'PENDING',
    },
  })

  const thumbUrl = `/api/v1/files/${gallery.slug}/${photo.id}?v=thumb`

  if (autoApprove) {
    const photoResponse: PhotoResponse = {
      id: photo.id,
      mediaType: photo.mediaType as 'IMAGE' | 'VIDEO',
      thumbUrl,
      displayUrl: `/api/v1/files/${gallery.slug}/${photo.id}?v=display`,
      duration: photo.duration,
      guestName: photo.guestName,
      createdAt: photo.createdAt.toISOString(),
    }
    sse.broadcast(gallery.id, 'new-photo', photoResponse)
  }

  return {
    id: photo.id,
    status: photo.status as 'PENDING' | 'APPROVED',
    mediaType: photo.mediaType as 'IMAGE' | 'VIDEO',
    thumbUrl,
    duration: photo.duration,
  }
}

function getMultipartFieldValue(upload: MultipartFile, key: string): string | null {
  const fields = upload.fields as Record<string, unknown> | undefined
  const field = fields?.[key]

  if (!field || typeof field !== 'object' || !('value' in field)) {
    return null
  }

  const value = (field as { value?: unknown }).value
  return typeof value === 'string' && value.length > 0 ? value : null
}
