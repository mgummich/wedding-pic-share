import type { FastifyInstance } from 'fastify'
import { fileTypeFromBuffer } from 'file-type'
import { getClient } from '@wedding/db'
import { processImage, processVideo, computeSha256 } from '../../services/media.js'
import type { StorageService } from '../../services/storage.js'
import type { SseManager } from '../../services/sse.js'
import type { UploadResponse, PhotoResponse } from '@wedding/shared'
import { isUploadOpenAt } from '../../services/uploadWindows.js'

const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic',
  'video/mp4', 'video/quicktime',
])

export async function guestUploadRoutes(
  fastify: FastifyInstance,
  opts: { storage: StorageService; sse: SseManager }
): Promise<void> {
  fastify.post('/g/:slug/upload', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const db = getClient()

    const gallery = await db.gallery.findFirst({
      where: { slug },
      include: { uploadWindows: true },
    })
    if (!gallery) {
      return reply.code(404).send({ type: 'gallery-not-found', title: 'Gallery Not Found', status: 404 })
    }

    if (!isUploadOpenAt(gallery.uploadWindows)) {
      return reply.code(403).send({
        type: 'upload-window-closed',
        title: 'Upload-Zeitfenster abgelaufen',
        status: 403,
      })
    }

    const data = await req.file()
    if (!data) {
      return reply.code(400).send({ type: 'bad-request', title: 'No file provided', status: 400 })
    }

    const buffer = await data.toBuffer()
    const detectedType = await fileTypeFromBuffer(buffer)

    if (!detectedType || !ALLOWED_MIMES.has(detectedType.mime)) {
      return reply.code(415).send({
        type: 'unsupported-mime-type',
        title: 'Unsupported Media Type',
        status: 415,
        detail: `MIME type "${detectedType?.mime ?? 'unknown'}" is not allowed.`,
      })
    }

    const fileHash = computeSha256(buffer)
    const existingDup = await db.photo.findUnique({
      where: { galleryId_fileHash: { galleryId: gallery.id, fileHash } },
    })
    if (existingDup) {
      return reply.code(409).send({
        type: 'duplicate-photo',
        title: 'Duplicate Photo',
        status: 409,
        detail: 'This photo has already been uploaded to this gallery.',
      })
    }

    const isVideo = detectedType.mime.startsWith('video/')
    const photoId = `photo_${Date.now()}_${Math.random().toString(36).slice(2)}`

    let thumbPath: string
    let displayPath: string
    let blurDataUrl: string
    let duration: number | null = null

    if (!isVideo) {
      const result = await processImage(buffer, detectedType.mime)
      await opts.storage.save(slug, `${photoId}_thumb.webp`, result.thumb)
      await opts.storage.save(slug, `${photoId}_display.webp`, result.display)
      await opts.storage.save(slug, `${photoId}_original.webp`, result.original)
      thumbPath = `${photoId}_thumb.webp`
      displayPath = `${photoId}_display.webp`
      blurDataUrl = result.blurDataUrl
    } else {
      const result = await processVideo(buffer)
      const ext = detectedType.mime === 'video/quicktime' ? 'mov' : 'mp4'
      await opts.storage.save(slug, `${photoId}_original.${ext}`, buffer)
      await opts.storage.save(slug, `${photoId}_poster.webp`, result.poster)
      thumbPath = `${photoId}_poster.webp`
      displayPath = `${photoId}_original.${ext}`
      blurDataUrl = result.blurDataUrl
      duration = result.durationSeconds
    }

    const guestName = typeof (data.fields as Record<string, unknown>)?.guestName === 'object'
      ? ((data.fields as Record<string, { value: string }>)?.guestName?.value ?? null)
      : null

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
        exifStripped: !isVideo,
        status: autoApprove ? 'APPROVED' : 'PENDING',
      },
    })

    const thumbUrl = `/api/v1/files/${slug}/${photo.id}?v=thumb`

    if (autoApprove) {
      const photoResponse: PhotoResponse = {
        id: photo.id,
        mediaType: photo.mediaType as 'IMAGE' | 'VIDEO',
        thumbUrl,
        displayUrl: `/api/v1/files/${slug}/${photo.id}?v=display`,
        duration: photo.duration,
        guestName: photo.guestName,
        createdAt: photo.createdAt.toISOString(),
      }
      opts.sse.broadcast(gallery.id, 'new-photo', photoResponse)
    }

    const response: UploadResponse = {
      id: photo.id,
      status: photo.status as 'PENDING' | 'APPROVED',
      mediaType: photo.mediaType as 'IMAGE' | 'VIDEO',
      thumbUrl,
      duration: photo.duration,
    }

    return reply.code(201).send(response)
  })
}
