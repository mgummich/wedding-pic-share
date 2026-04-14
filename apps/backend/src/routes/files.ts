import type { FastifyInstance } from 'fastify'
import type { StorageService } from '../services/storage.js'
import { hasGalleryAccess } from '../services/galleryAccess.js'

export async function fileRoutes(
  fastify: FastifyInstance,
  opts: { storage: StorageService }
): Promise<void> {
  fastify.get('/files/:gallerySlug/:photoId', {
    schema: {
      params: {
        type: 'object',
        properties: {
          gallerySlug: { type: 'string', pattern: '^[a-z0-9-]+$' },
          photoId: { type: 'string', pattern: '^[A-Za-z0-9_-]{3,128}$' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          v: { type: 'string', enum: ['thumb', 'display', 'original', 'poster'] },
          download: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { gallerySlug, photoId } = req.params as { gallerySlug: string; photoId: string }
    const { v = 'display', download } = req.query as { v?: string; download?: string }

    const db = fastify.db
    const photo = await db.photo.findFirst({
      where: { id: photoId, gallery: { slug: gallerySlug }, deletedAt: null },
      include: { gallery: true },
    })

    if (!photo) return reply.code(404).send({ type: 'not-found', status: 404 })

    const requestHasGalleryAccess = hasGalleryAccess(req, photo.gallery, fastify.config.sessionSecret)
    const requireAdminIfNeeded = async (): Promise<boolean> => {
      await fastify.requireAdmin(req, reply)
      return !reply.sent
    }

    if (!requestHasGalleryAccess) {
      if (typeof req.cookies['session'] !== 'string') {
        return reply.code(401).send({
          type: 'invalid-pin',
          title: 'Falscher Secret Key.',
          status: 401,
        })
      }
      const isAdmin = await requireAdminIfNeeded()
      if (!isAdmin) return
    }

    if (photo.status !== 'APPROVED') {
      const isAdmin = await requireAdminIfNeeded()
      if (!isAdmin) return
    }

    let filename: string
    let contentType: string

    if (v === 'thumb') {
      filename = photo.thumbPath
      contentType = 'image/webp'
    } else if (v === 'display') {
      filename = photo.displayPath
      contentType = photo.mediaType === 'VIDEO' ? photo.mimeType : 'image/webp'
    } else if (v === 'poster' && photo.posterPath) {
      filename = photo.posterPath
      contentType = 'image/webp'
    } else {
      filename = photo.originalPath
      contentType = photo.mimeType
    }

    if (v === 'original' && !photo.gallery.allowGuestDownload) {
      const isAdmin = await requireAdminIfNeeded()
      if (!isAdmin) return
    }

    try {
      await opts.storage.stat(gallerySlug, filename)
    } catch {
      return reply.code(404).send({ type: 'not-found', status: 404 })
    }

    reply.header('Content-Type', contentType)
    reply.header('Cache-Control', 'public, max-age=31536000, immutable')
    if (download) {
      const ext = filename.split('.').pop() ?? 'bin'
      const encodedFileName = encodeURIComponent(`${photoId}.${ext}`)
      reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodedFileName}`)
    }

    const stream = opts.storage.openReadStream(gallerySlug, filename)
    stream.on('error', (error: NodeJS.ErrnoException) => {
      req.log.warn({ err: error, gallerySlug, filename, photoId }, 'failed to stream file')
      if (reply.sent) return

      if (error.code === 'ENOENT') {
        reply.code(404).send({ type: 'not-found', status: 404 })
        return
      }

      reply.code(500).send({ type: 'internal-server-error', status: 500 })
    })

    return reply.send(stream)
  })
}
