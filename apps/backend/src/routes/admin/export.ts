import type { FastifyInstance } from 'fastify'
import archiver from 'archiver'
import type { StorageService } from '../../services/storage.js'

const MAX_EXPORT_ITEMS = 5000

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
        const archiveStat = await opts.storage.stat(gallery.slug, gallery.archivePath)

        reply.header('Content-Type', 'application/zip')
        reply.header('Content-Disposition', `attachment; filename="${gallery.slug}-export.zip"`)
        reply.header('Content-Length', String(archiveStat.size))

        const archiveStream = opts.storage.openReadStream(gallery.slug, gallery.archivePath)
        archiveStream.on('error', (error: NodeJS.ErrnoException) => {
          req.log.warn({ err: error, galleryId: id }, 'failed to stream persisted gallery archive')
          if (reply.sent) {
            reply.raw.destroy(error)
            return
          }

          if (error.code === 'ENOENT') {
            reply.code(404).send({ type: 'archive-not-found', status: 404 })
            return
          }

          reply.code(500).send({ type: 'internal-server-error', status: 500 })
        })

        return reply.send(archiveStream)
      } catch {
        // Persisted archive metadata exists but file is missing.
        // Fall back to on-demand stream generation below.
      }
    }

    const photos = await db.photo.findMany({
      where: { galleryId: id, status: 'APPROVED', deletedAt: null },
      orderBy: { createdAt: 'asc' },
    })
    if (photos.length > MAX_EXPORT_ITEMS) {
      return reply.code(413).send({
        type: 'export-too-large',
        title: 'Export contains too many files.',
        status: 413,
        detail: `Maximum export item count is ${MAX_EXPORT_ITEMS}.`,
      })
    }

    reply.header('Content-Type', 'application/zip')
    reply.header('Content-Disposition', `attachment; filename="${gallery.slug}-export.zip"`)

    const archive = archiver('zip', { zlib: { level: 6 } })
    let streamFailed = false
    const handleArchiveError = (error: unknown) => {
      if (streamFailed) return
      streamFailed = true
      req.log.error({ err: error, galleryId: id }, 'failed to build export archive')
      if (reply.sent) {
        reply.raw.destroy(error instanceof Error ? error : new Error(String(error)))
        return
      }
      void reply.code(500).send({ type: 'internal-server-error', status: 500 })
    }

    archive.on('warning', handleArchiveError)
    archive.on('error', handleArchiveError)
    reply.raw.on('close', () => archive.abort())
    archive.pipe(reply.raw)

    for (const photo of photos) {
      let stream: ReturnType<StorageService['openReadStream']>
      try {
        stream = opts.storage.openReadStream(gallery.slug, photo.originalPath)
      } catch (error) {
        handleArchiveError(error)
        return
      }
      stream.on('error', handleArchiveError)
      const ext = photo.originalPath.split('.').pop() ?? 'jpg'
      archive.append(stream, { name: `${photo.id}.${ext}` })
      if (streamFailed) return
    }

    try {
      await archive.finalize()
    } catch (error) {
      handleArchiveError(error)
    }
  })
}
