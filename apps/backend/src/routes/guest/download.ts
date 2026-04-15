import type { FastifyInstance } from 'fastify'
import archiver from 'archiver'
import type { StorageService } from '../../services/storage.js'
import { hasGalleryAccess } from '../../services/galleryAccess.js'

const MAX_GUEST_DOWNLOAD_ITEMS = 5000

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
    if (photos.length > MAX_GUEST_DOWNLOAD_ITEMS) {
      return reply.code(413).send({
        type: 'download-too-large',
        title: 'Download contains too many files.',
        status: 413,
        detail: `Maximum download item count is ${MAX_GUEST_DOWNLOAD_ITEMS}.`,
      })
    }

    reply.header('Content-Type', 'application/zip')
    reply.header('Content-Disposition', `attachment; filename="${slug}-photos.zip"`)

    const archive = archiver('zip', { zlib: { level: 6 } })
    let streamFailed = false
    const handleArchiveError = (error: unknown) => {
      if (streamFailed) return
      streamFailed = true
      req.log.error({ err: error, gallerySlug: slug }, 'failed to build guest download archive')
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
      const filename = photo.originalPath
      let stream: ReturnType<StorageService['openReadStream']>
      try {
        stream = opts.storage.openReadStream(slug, filename)
      } catch (error) {
        handleArchiveError(error)
        return
      }
      stream.on('error', handleArchiveError)
      const ext = filename.split('.').pop() ?? 'jpg'
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
