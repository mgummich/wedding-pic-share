import type { FastifyInstance } from 'fastify'
import { getClient } from '@wedding/db'
import type { StorageService } from '../../services/storage.js'
import type { SseManager } from '../../services/sse.js'
import { isUploadOpenAt } from '../../services/uploadWindows.js'
import { ingestUploadedPhoto, PhotoIngestError } from '../../services/photoIngest.js'

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

    try {
      const response = await ingestUploadedPhoto({
        gallery: {
          id: gallery.id,
          slug: gallery.slug,
          moderationMode: gallery.moderationMode as 'MANUAL' | 'AUTO',
        },
        upload: await req.file(),
        storage: opts.storage,
        sse: opts.sse,
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
