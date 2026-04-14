import type { FastifyInstance } from 'fastify'
import type { StorageService } from '../../services/storage.js'
import type { SseManager } from '../../services/sse.js'
import type { UploadNotifier } from '../../services/uploadNotifier.js'
import { isUploadOpenAt } from '../../services/uploadWindows.js'
import { ingestUploadedPhoto, PhotoIngestError } from '../../services/photoIngest.js'
import { hasGalleryAccess } from '../../services/galleryAccess.js'
import type { MediaProcessor } from '../../services/mediaProcessor.js'
import { createUploadDeleteToken, readUploadDeleteToken } from '../../services/uploadDeleteToken.js'

const UPLOAD_SHUTDOWN_TIMEOUT_MS = 30 * 1000
const GUEST_UPLOAD_MAX_PER_MINUTE = 30

export async function guestUploadRoutes(
  fastify: FastifyInstance,
  opts: { storage: StorageService; sse: SseManager; uploadNotifier: UploadNotifier; mediaProcessor: MediaProcessor }
): Promise<void> {
  const inFlightUploads = new Set<Promise<unknown>>()
  fastify.addHook('onClose', async () => {
    if (inFlightUploads.size === 0) return
    await Promise.race([
      Promise.allSettled(Array.from(inFlightUploads)).then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, UPLOAD_SHUTDOWN_TIMEOUT_MS)),
    ])
  })

  fastify.post('/g/:slug/upload', {
    config: {
      rateLimit: {
        max: GUEST_UPLOAD_MAX_PER_MINUTE,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const db = fastify.db

    const gallery = await db.gallery.findFirst({
      where: { slug },
      include: { uploadWindows: true },
    })
    if (!gallery) {
      return reply.code(404).send({ type: 'gallery-not-found', title: 'Gallery Not Found', status: 404 })
    }
    if (!hasGalleryAccess(req, gallery, fastify.config.sessionSecret)) {
      return reply.code(401).send({
        type: 'invalid-pin',
        title: 'Falscher Secret Key.',
        status: 401,
      })
    }

    if (gallery.isArchived) {
      return reply.code(403).send({
        type: 'gallery-archived',
        title: 'Galerie ist abgeschlossen',
        status: 403,
      })
    }

    if (!isUploadOpenAt(gallery.uploadWindows)) {
      return reply.code(403).send({
        type: 'upload-window-closed',
        title: 'Upload-Zeitfenster abgelaufen',
        status: 403,
      })
    }

    try {
      const uploadTask = ingestUploadedPhoto({
        gallery: {
          id: gallery.id,
          slug: gallery.slug,
          moderationMode: gallery.moderationMode as 'MANUAL' | 'AUTO',
          stripExif: gallery.stripExif,
        },
        upload: await req.file(),
        db,
        storage: opts.storage,
        sse: opts.sse,
        mediaProcessor: opts.mediaProcessor,
        requestId: req.id,
        limits: {
          maxFileSizeMb: fastify.config.maxFileSizeMb,
          maxVideoSizeMb: fastify.config.maxVideoSizeMb,
        },
        beforePersist: async () => {
          const latestGallery = await db.gallery.findUnique({
            where: { id: gallery.id },
            include: { uploadWindows: true },
          })
          if (!latestGallery) {
            throw new PhotoIngestError(404, {
              type: 'gallery-not-found',
              title: 'Gallery Not Found',
              status: 404,
            })
          }
          if (latestGallery.isArchived) {
            throw new PhotoIngestError(403, {
              type: 'gallery-archived',
              title: 'Galerie ist abgeschlossen',
              status: 403,
            })
          }
          if (!isUploadOpenAt(latestGallery.uploadWindows)) {
            throw new PhotoIngestError(403, {
              type: 'upload-window-closed',
              title: 'Upload-Zeitfenster abgelaufen',
              status: 403,
            })
          }
        },
      })
      inFlightUploads.add(uploadTask)
      let response: Awaited<typeof uploadTask>
      try {
        response = await uploadTask
      } finally {
        inFlightUploads.delete(uploadTask)
      }

      void opts.uploadNotifier.notifyGuestUpload({
        galleryName: gallery.name,
        gallerySlug: gallery.slug,
        photoId: response.id,
        mediaType: response.mediaType,
        status: response.status,
      })

      if (response.status === 'PENDING') {
        return reply.code(201).send({
          ...response,
          deleteToken: createUploadDeleteToken(
            { photoId: response.id, gallerySlug: gallery.slug },
            fastify.config.sessionSecret
          ),
        })
      }

      return reply.code(201).send(response)
    } catch (error) {
      if (error instanceof PhotoIngestError) {
        return reply.code(error.statusCode).send(error.body)
      }
      throw error
    }
  })

  fastify.delete('/g/:slug/uploads/:photoId', {
    schema: {
      params: {
        type: 'object',
        required: ['slug', 'photoId'],
        properties: {
          slug: { type: 'string', pattern: '^[a-z0-9-]+$' },
          photoId: { type: 'string', minLength: 3, maxLength: 128 },
        },
      },
      body: {
        type: 'object',
        required: ['deleteToken'],
        properties: {
          deleteToken: { type: 'string', minLength: 20, maxLength: 4096 },
        },
      },
    },
  }, async (req, reply) => {
    const { slug, photoId } = req.params as { slug: string; photoId: string }
    const { deleteToken } = req.body as { deleteToken: string }

    const tokenPayload = readUploadDeleteToken(deleteToken, fastify.config.sessionSecret)
    if (!tokenPayload || tokenPayload.photoId !== photoId || tokenPayload.gallerySlug !== slug) {
      return reply.code(401).send({
        type: 'invalid-delete-token',
        title: 'Ungueltiger Upload-Loesch-Token.',
        status: 401,
      })
    }

    const db = fastify.db
    const photo = await db.photo.findFirst({
      where: { id: photoId, gallery: { slug }, deletedAt: null },
      select: {
        id: true,
        status: true,
        gallery: { select: { slug: true } },
        thumbPath: true,
        displayPath: true,
        originalPath: true,
        posterPath: true,
      },
    })
    if (!photo) {
      return reply.code(404).send({
        type: 'upload-not-found',
        title: 'Upload nicht gefunden.',
        status: 404,
      })
    }

    if (photo.status !== 'PENDING') {
      return reply.code(409).send({
        type: 'upload-not-pending',
        title: 'Upload kann nicht mehr geloescht werden.',
        status: 409,
      })
    }

    await db.photo.update({
      where: { id: photo.id },
      data: { deletedAt: new Date() },
    })

    const filePaths = [
      photo.thumbPath,
      photo.displayPath,
      photo.originalPath,
      photo.posterPath,
    ].filter((value): value is string => Boolean(value))

    await Promise.allSettled(
      filePaths.map((filename) => opts.storage.delete(photo.gallery.slug, filename))
    )

    return reply.send({ ok: true })
  })
}
