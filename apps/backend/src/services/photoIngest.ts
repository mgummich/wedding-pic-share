import type { MultipartFile } from '@fastify/multipart'
import { fileTypeFromBuffer } from 'file-type'
import type { PrismaClient } from '@wedding/db'
import { randomBytes } from 'crypto'
import { computeSha256 } from './media.js'
import type { StorageService } from './storage.js'
import type { SseManager } from './sse.js'
import type { PhotoResponse, UploadResponse } from '@wedding/shared'
import type { MediaProcessor } from './mediaProcessor.js'

const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic',
  'video/mp4', 'video/quicktime',
])
const MAX_GUEST_NAME_LENGTH = 80

type IngestGallery = {
  id: string
  slug: string
  moderationMode: 'MANUAL' | 'AUTO'
  stripExif: boolean
}

type IngestUploadInput = {
  gallery: IngestGallery
  upload: MultipartFile | undefined
  db: PrismaClient
  storage: StorageService
  sse: SseManager
  mediaProcessor: MediaProcessor
  requestId?: string
  limits: {
    maxFileSizeMb: number
    maxVideoSizeMb: number
  }
  // Optional guard executed after files are processed but before DB persistence.
  // Used for race-sensitive checks (e.g. upload window closed while processing).
  beforePersist?: () => Promise<void>
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
  db,
  storage,
  sse,
  mediaProcessor,
  requestId,
  limits,
  beforePersist,
}: IngestUploadInput): Promise<UploadResponse> {
  if (!upload) {
    throw new PhotoIngestError(400, {
      type: 'bad-request',
      title: 'No file provided',
      status: 400,
    })
  }

  const guestName = getMultipartFieldValue(upload, 'guestName')
  if (guestName && guestName.length > MAX_GUEST_NAME_LENGTH) {
    throw new PhotoIngestError(400, {
      type: 'guest-name-too-long',
      title: 'Guest name exceeds maximum length',
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

  const photoId = `photo_${Date.now()}_${randomBytes(8).toString('hex')}`

  let thumbPath = ''
  let displayPath = ''
  let blurDataUrl = ''
  let duration: number | null = null
  const savedFiles: string[] = []

  const autoApprove = gallery.moderationMode === 'AUTO'
  let photo: Awaited<ReturnType<typeof db.photo.create>>
  try {
    if (!isVideo) {
      const result = await mediaProcessor.processImage(buffer, detectedType.mime, {
        stripExif: gallery.stripExif,
        requestId,
      })
      thumbPath = `${photoId}_thumb.webp`
      displayPath = `${photoId}_display.webp`
      const originalPath = `${photoId}_original.webp`
      await storage.save(gallery.slug, thumbPath, result.thumb)
      savedFiles.push(thumbPath)
      await storage.save(gallery.slug, displayPath, result.display)
      savedFiles.push(displayPath)
      await storage.save(gallery.slug, originalPath, result.original)
      savedFiles.push(originalPath)
      blurDataUrl = result.blurDataUrl
    } else {
      const result = await mediaProcessor.processVideo(buffer, { requestId })
      const ext = detectedType.mime === 'video/quicktime' ? 'mov' : 'mp4'
      displayPath = `${photoId}_original.${ext}`
      thumbPath = `${photoId}_poster.webp`
      await storage.save(gallery.slug, displayPath, buffer)
      savedFiles.push(displayPath)
      await storage.save(gallery.slug, thumbPath, result.poster)
      savedFiles.push(thumbPath)
      blurDataUrl = result.blurDataUrl
      duration = result.durationSeconds
    }

    if (beforePersist) {
      // Contract: throw to abort DB write; saved files are cleaned up in catch block.
      await beforePersist()
    }

    photo = await db.photo.create({
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
  } catch (error) {
    await Promise.allSettled(savedFiles.map((file) => storage.delete(gallery.slug, file)))
    throw error
  }

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
    void sse.broadcast(gallery.id, 'new-photo', photoResponse).catch(() => {})
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
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}
