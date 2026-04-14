import type { FastifyInstance } from 'fastify'
import { getClient } from '@wedding/db'
import type { StorageService } from '../../services/storage.js'
import type { SseManager } from '../../services/sse.js'
import { createGalleryArchive } from '../../services/galleryArchive.js'
import { toGalleryResponse } from '../../services/uploadWindows.js'

export async function adminArchiveRoutes(
  fastify: FastifyInstance,
  opts: { storage: StorageService; sse: SseManager }
): Promise<void> {
  fastify.post('/admin/galleries/:id/archive', {
    preHandler: fastify.requireAdmin,
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getClient()

    const gallery = await db.gallery.findUnique({
      where: { id },
      include: { uploadWindows: { orderBy: { start: 'asc' } } },
    })
    if (!gallery) return reply.code(404).send({ type: 'gallery-not-found', status: 404 })

    if (gallery.isArchived && gallery.archivePath && gallery.archiveSizeBytes !== null) {
      const photoCount = await db.photo.count({
        where: { galleryId: gallery.id, status: 'APPROVED', deletedAt: null },
      })
      return reply.send(toGalleryResponse(gallery, photoCount))
    }

    const photos = await db.photo.findMany({
      where: { galleryId: id, status: 'APPROVED', deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, originalPath: true },
    })

    const archive = await createGalleryArchive({
      galleryId: gallery.id,
      gallerySlug: gallery.slug,
      photos,
      storage: opts.storage,
      existingArchive: {
        archivePath: gallery.archivePath,
        archiveSizeBytes: gallery.archiveSizeBytes,
      },
    })

    const archivedAt = new Date()

    const updated = await db.$transaction(async (tx) => {
      await tx.uploadWindow.deleteMany({ where: { galleryId: id } })
      return tx.gallery.update({
        where: { id },
        data: {
          isArchived: true,
          archivedAt,
          archivePath: archive.archivePath,
          archiveSizeBytes: archive.archiveSizeBytes,
        },
        include: { uploadWindows: { orderBy: { start: 'asc' } } },
      })
    })

    opts.sse.broadcast(gallery.id, 'gallery-closed', {
      reason: 'archived',
      archivedAt: archivedAt.toISOString(),
    })

    const photoCount = await db.photo.count({
      where: { galleryId: updated.id, status: 'APPROVED', deletedAt: null },
    })

    return reply.send(toGalleryResponse(updated, photoCount))
  })
}
