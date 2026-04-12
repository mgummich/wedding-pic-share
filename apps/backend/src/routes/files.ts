import type { FastifyInstance } from 'fastify'
import { createReadStream } from 'fs'
import { getClient } from '@wedding/db'
import type { StorageService } from '../services/storage.js'

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
          photoId: { type: 'string' },
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

    // Validate photoId contains no path traversal
    if (photoId.includes('/') || photoId.includes('..') || photoId.includes('\0')) {
      return reply.code(400).send({ type: 'bad-request', status: 400 })
    }

    const db = getClient()
    const photo = await db.photo.findFirst({
      where: { id: photoId, gallery: { slug: gallerySlug }, deletedAt: null },
      include: { gallery: true },
    })

    if (!photo) return reply.code(404).send({ type: 'not-found', status: 404 })

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

    const filePath = opts.storage.filePath(gallerySlug, filename)

    reply.header('Content-Type', contentType)
    reply.header('Cache-Control', 'public, max-age=31536000, immutable')
    if (download) {
      reply.header('Content-Disposition', `attachment; filename="${photoId}.webp"`)
    }

    const stream = createReadStream(filePath)
    return reply.send(stream)
  })
}
