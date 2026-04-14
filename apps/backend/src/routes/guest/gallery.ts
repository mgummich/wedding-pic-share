import type { FastifyInstance } from 'fastify'
import { getClient } from '@wedding/db'
import type { PhotoResponse, PaginatedResponse } from '@wedding/shared'
import { toGalleryResponse } from '../../services/uploadWindows.js'

export async function guestGalleryRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/g/active', async (_req, reply) => {
    const db = getClient()
    const gallery = await db.gallery.findFirst({
      where: { isActive: true },
      include: { uploadWindows: { orderBy: { start: 'asc' } } },
    })

    if (!gallery) {
      return reply.code(404).send({
        type: 'active-gallery-not-found',
        title: 'No active gallery configured',
        status: 404,
      })
    }

    const photoCount = await db.photo.count({
      where: { galleryId: gallery.id, status: 'APPROVED', deletedAt: null },
    })

    return reply.send(toGalleryResponse(gallery, photoCount))
  })

  fastify.get('/g/:slug', {
    schema: {
      params: {
        type: 'object',
        properties: { slug: { type: 'string', pattern: '^[a-z0-9-]+$' } },
        required: ['slug'],
      },
      querystring: {
        type: 'object',
        properties: {
          cursor: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        },
      },
    },
  }, async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const { cursor, limit = 20 } = req.query as { cursor?: string; limit?: number }
    const db = getClient()

    const gallery = await db.gallery.findFirst({
      where: { slug },
      include: { uploadWindows: { orderBy: { start: 'asc' } } },
    })
    if (!gallery) {
      return reply.code(404).send({
        type: 'gallery-not-found',
        title: 'Gallery Not Found',
        status: 404,
        detail: `No gallery found with slug "${slug}"`,
      })
    }

    const photos = await db.photo.findMany({
      where: {
        galleryId: gallery.id,
        status: 'APPROVED',
        deletedAt: null,
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    })

    const hasMore = photos.length > limit
    const items = photos.slice(0, limit)
    const nextCursor = hasMore ? items[items.length - 1].id : null

    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ''

    const photoCount = await db.photo.count({
      where: { galleryId: gallery.id, status: 'APPROVED', deletedAt: null },
    })

    return reply.send({
      ...toGalleryResponse(gallery, photoCount),
      data: items.map((p): PhotoResponse => ({
        id: p.id,
        mediaType: p.mediaType as 'IMAGE' | 'VIDEO',
        thumbUrl: `${apiBase}/api/v1/files/${gallery.slug}/${p.id}?v=thumb`,
        displayUrl: `${apiBase}/api/v1/files/${gallery.slug}/${p.id}?v=display`,
        duration: p.duration,
        guestName: p.guestName,
        createdAt: p.createdAt.toISOString(),
        blurDataUrl: p.blurDataUrl || undefined,
      })),
      pagination: {
        nextCursor,
        hasMore,
      } satisfies PaginatedResponse<PhotoResponse>['pagination'],
    })
  })
}
