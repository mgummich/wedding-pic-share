import type { FastifyInstance } from 'fastify'
import archiver from 'archiver'
import type { StorageService } from '../../services/storage.js'
import { hasGalleryAccess } from '../../services/galleryAccess.js'

export async function guestDownloadRoutes(
  fastify: FastifyInstance,
  opts: { storage: StorageService }
): Promise<void> {
  fastify.get('/g/:slug/download', {
    schema: {
      params: { type: 'object', properties: { slug: { type: 'string', pattern: '^[a-z0-9-]+$' } } },
    },
  }, async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const db = fastify.db

    const gallery = await db.gallery.findFirst({ where: { slug } })
    if (!gallery) return reply.code(404).send({ type: 'gallery-not-found', status: 404 })
    if (!hasGalleryAccess(req, gallery, fastify.config.sessionSecret)) {
      return reply.code(401).send({
        type: 'invalid-pin',
        title: 'Invalid secret key.',
        status: 401,
      })
    }
    if (!gallery.allowGuestDownload) {
      return reply.code(403).send({ type: 'forbidden', title: 'Download not allowed', status: 403 })
    }

    const photos = await db.photo.findMany({
      where: { galleryId: gallery.id, status: 'APPROVED', deletedAt: null },
      orderBy: { createdAt: 'asc' },
    })

    reply.header('Content-Type', 'application/zip')
    reply.header('Content-Disposition', `attachment; filename="${slug}-photos.zip"`)

    const archive = archiver('zip', { zlib: { level: 6 } })
    reply.raw.on('close', () => archive.abort())

    archive.pipe(reply.raw)

    for (const photo of photos) {
      const filename = photo.originalPath
      const stream = opts.storage.openReadStream(slug, filename)
      const ext = filename.split('.').pop() ?? 'jpg'
      archive.append(stream, { name: `${photo.id}.${ext}` })
    }

    await archive.finalize()
  })
}
