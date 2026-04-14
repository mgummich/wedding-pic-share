import type { FastifyInstance } from 'fastify'
import type { PhotoResponse, PaginatedResponse } from '@wedding/shared'
import bcrypt from 'bcryptjs'
import { toGalleryResponse } from '../../services/uploadWindows.js'
import { hasGalleryAccess, setGalleryAccessCookie } from '../../services/galleryAccess.js'

const DUMMY_PIN_HASH = '$2a$12$aaaaaaaaaaaaaaaaaaaaaaOaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

type PaginationCursor = {
  id: string
  createdAt: Date
}

function encodePaginationCursor(id: string, createdAt: Date): string {
  return Buffer.from(JSON.stringify({
    id,
    createdAt: createdAt.toISOString(),
  })).toString('base64url')
}

function decodePaginationCursor(cursor: string): PaginationCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      id?: unknown
      createdAt?: unknown
    }
    if (typeof parsed.id !== 'string' || typeof parsed.createdAt !== 'string') return null
    const createdAt = new Date(parsed.createdAt)
    if (Number.isNaN(createdAt.getTime())) return null
    return { id: parsed.id, createdAt }
  } catch {
    return null
  }
}

export async function guestGalleryRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/g/active', async (_req, reply) => {
    const db = fastify.db
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

  fastify.post('/g/:slug/access', {
    schema: {
      params: {
        type: 'object',
        properties: { slug: { type: 'string', pattern: '^[a-z0-9-]+$' } },
        required: ['slug'],
      },
      body: {
        type: 'object',
        required: ['secretKey'],
        properties: {
          secretKey: { type: 'string', minLength: 1, maxLength: 64 },
        },
      },
    },
  }, async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const { secretKey } = req.body as { secretKey: string }
    const ip = req.ip

    if (await fastify.checkPinBlocked(ip, slug)) {
      return reply.code(429).send({
        type: 'pin-attempts-exceeded',
        title: 'Zu viele PIN-Fehlversuche. Bitte versuche es spaeter erneut.',
        status: 429,
      })
    }

    const db = fastify.db
    const gallery = await db.gallery.findFirst({
      where: { slug },
      select: { slug: true, secretKey: true },
    })

    if (gallery && !gallery.secretKey) {
      return reply.send({ ok: true })
    }

    const hashToCheck = gallery?.secretKey ?? DUMMY_PIN_HASH
    const valid = await bcrypt.compare(secretKey, hashToCheck)
    if (!valid) {
      await fastify.recordPinFailure(ip, slug)
      return reply.code(401).send({
        type: 'invalid-pin',
        title: 'Falscher Secret Key.',
        status: 401,
      })
    }

    if (!gallery) {
      await fastify.recordPinFailure(ip, slug)
      return reply.code(401).send({
        type: 'invalid-pin',
        title: 'Falscher Secret Key.',
        status: 401,
      })
    }

    await fastify.resetPinFailures(ip, slug)
    setGalleryAccessCookie(reply, gallery, fastify.config.cookieSecure, fastify.config.sessionSecret)
    return reply.send({ ok: true })
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
    const decodedCursor = cursor ? decodePaginationCursor(cursor) : null
    if (cursor && !decodedCursor) {
      return reply.code(400).send({
        type: 'invalid-cursor',
        title: 'Ungueltiger Cursor.',
        status: 400,
      })
    }
    const db = fastify.db

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
    if (!hasGalleryAccess(req, gallery, fastify.config.sessionSecret)) {
      return reply.code(401).send({
        type: 'invalid-pin',
        title: 'Falscher Secret Key.',
        status: 401,
      })
    }

    const photos = await db.photo.findMany({
      where: {
        galleryId: gallery.id,
        status: 'APPROVED',
        deletedAt: null,
        ...(decodedCursor
          ? {
            OR: [
              { createdAt: { lt: decodedCursor.createdAt } },
              {
                AND: [
                  { createdAt: decodedCursor.createdAt },
                  { id: { lt: decodedCursor.id } },
                ],
              },
            ],
          }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    })

    const hasMore = photos.length > limit
    const items = photos.slice(0, limit)
    const nextCursor = hasMore
      ? encodePaginationCursor(items[items.length - 1].id, items[items.length - 1].createdAt)
      : null

    const photoCount = await db.photo.count({
      where: { galleryId: gallery.id, status: 'APPROVED', deletedAt: null },
    })

    return reply.send({
      ...toGalleryResponse(gallery, photoCount),
      data: items.map((p): PhotoResponse => ({
        id: p.id,
        mediaType: p.mediaType as 'IMAGE' | 'VIDEO',
        thumbUrl: `/api/v1/files/${gallery.slug}/${p.id}?v=thumb`,
        displayUrl: `/api/v1/files/${gallery.slug}/${p.id}?v=display`,
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
