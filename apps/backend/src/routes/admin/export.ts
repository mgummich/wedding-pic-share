import type { FastifyInstance } from 'fastify'
import archiver from 'archiver'
import { createReadStream } from 'fs'
import { getClient } from '@wedding/db'
import type { StorageService } from '../../services/storage.js'

export async function adminExportRoutes(
  fastify: FastifyInstance,
  opts: { storage: StorageService }
): Promise<void> {
  fastify.get('/admin/galleries/:id/export', {
    preHandler: fastify.requireAdmin,
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getClient()

    const gallery = await db.gallery.findUnique({ where: { id } })
    if (!gallery) return reply.code(404).send({ type: 'gallery-not-found', status: 404 })

    const photos = await db.photo.findMany({
      where: { galleryId: id, status: 'APPROVED', deletedAt: null },
      orderBy: { createdAt: 'asc' },
    })

    reply.header('Content-Type', 'application/zip')
    reply.header('Content-Disposition', `attachment; filename="${gallery.slug}-export.zip"`)

    const archive = archiver('zip', { zlib: { level: 6 } })
    archive.pipe(reply.raw)

    for (const photo of photos) {
      const stream = createReadStream(opts.storage.filePath(gallery.slug, photo.originalPath))
      const ext = photo.originalPath.split('.').pop() ?? 'jpg'
      archive.append(stream, { name: `${photo.id}.${ext}` })
    }

    await archive.finalize()
  })
}
