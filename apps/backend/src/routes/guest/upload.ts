import type { FastifyInstance } from 'fastify'
import { getClient } from '@wedding/db'
import type { StorageService } from '../../services/storage.js'
import type { SseManager } from '../../services/sse.js'
import type { UploadNotifier } from '../../services/uploadNotifier.js'
import { isUploadOpenAt } from '../../services/uploadWindows.js'
import { ingestUploadedPhoto, PhotoIngestError } from '../../services/photoIngest.js'
import { hasGalleryAccess } from '../../services/galleryAccess.js'

export async function guestUploadRoutes(
  fastify: FastifyInstance,
  opts: { storage: StorageService; sse: SseManager; uploadNotifier: UploadNotifier }
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
    if (!hasGalleryAccess(req, gallery, fastify.config.sessionSecret)) {
      return reply.code(401).send({
        type: 'invalid-pin',
        title: 'Falscher Secret Key.',
        status: 401,
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
      const response = await ingestUploadedPhoto({
        gallery: {
          id: gallery.id,
          slug: gallery.slug,
          moderationMode: gallery.moderationMode as 'MANUAL' | 'AUTO',
          stripExif: gallery.stripExif,
        },
        upload: await req.file(),
        storage: opts.storage,
        sse: opts.sse,
      })

      void opts.uploadNotifier.notifyGuestUpload({
        galleryName: gallery.name,
        gallerySlug: gallery.slug,
        photoId: response.id,
        mediaType: response.mediaType,
        status: response.status,
      }).catch((error: unknown) => {
        fastify.log.error({ error, gallerySlug: gallery.slug, photoId: response.id }, 'smtp.notification.failed')
      })

      return reply.code(201).send(response)
    } catch (error) {
      if (error instanceof PhotoIngestError) {
        return reply.code(error.statusCode).send(error.body)
      }
      throw error
    }
  })
}
