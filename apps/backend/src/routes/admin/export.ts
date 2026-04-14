import type { FastifyInstance } from 'fastify'
import archiver from 'archiver'
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
    const db = fastify.db

    const gallery = await db.gallery.findUnique({ where: { id } })
    if (!gallery) return reply.code(404).send({ type: 'gallery-not-found', status: 404 })

    if (gallery.isArchived && gallery.archivePath) {
      try {
        await opts.storage.stat(gallery.slug, gallery.archivePath)

        reply.header('Content-Type', 'application/zip')
        reply.header('Content-Disposition', `attachment; filename="${gallery.slug}-export.zip"`)

        return reply.send(opts.storage.openReadStream(gallery.slug, gallery.archivePath))
      } catch {
        // Persisted archive metadata exists but file is missing.
        // Fall back to on-demand stream generation below.
      }
    }

    const photos = await db.photo.findMany({
      where: { galleryId: id, status: 'APPROVED', deletedAt: null },
      orderBy: { createdAt: 'asc' },
    })

    reply.header('Content-Type', 'application/zip')
    reply.header('Content-Disposition', `attachment; filename="${gallery.slug}-export.zip"`)

    const archive = archiver('zip', { zlib: { level: 6 } })
    reply.raw.on('close', () => archive.abort())
    archive.pipe(reply.raw)

    for (const photo of photos) {
      const stream = opts.storage.openReadStream(gallery.slug, photo.originalPath)
      const ext = photo.originalPath.split('.').pop() ?? 'jpg'
      archive.append(stream, { name: `${photo.id}.${ext}` })
    }

    await archive.finalize()
  })
}
