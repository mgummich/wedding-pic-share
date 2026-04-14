import type { FastifyInstance } from 'fastify'
import type { SseManager } from '../../services/sse.js'
import type { PhotoResponse } from '@wedding/shared'
import type { StorageService } from '../../services/storage.js'
import { ingestUploadedPhoto, PhotoIngestError } from '../../services/photoIngest.js'
import type { MediaProcessor } from '../../services/mediaProcessor.js'
import { isPrismaNotFoundError } from '../../services/prismaErrors.js'

const ADMIN_UPLOAD_SHUTDOWN_TIMEOUT_MS = 30 * 1000

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

export async function adminPhotoRoutes(
  fastify: FastifyInstance,
  opts: { sse: SseManager; storage: StorageService; mediaProcessor: MediaProcessor }
): Promise<void> {
  const inFlightUploads = new Set<Promise<unknown>>()
  fastify.addHook('onClose', async () => {
    if (inFlightUploads.size === 0) return
    await Promise.race([
      Promise.allSettled(Array.from(inFlightUploads)).then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, ADMIN_UPLOAD_SHUTDOWN_TIMEOUT_MS)),
    ])
  })

  fastify.post('/admin/galleries/:id/upload', {
    preHandler: fastify.requireAdmin,
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } } },
      querystring: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['default', 'photographer'] },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { mode } = req.query as { mode?: 'default' | 'photographer' }
    const db = fastify.db
    const gallery = await db.gallery.findUnique({
      where: { id },
      select: { id: true, slug: true, moderationMode: true, stripExif: true, isArchived: true },
    })

    if (!gallery) {
      return reply.code(404).send({ type: 'gallery-not-found', title: 'Gallery Not Found', status: 404 })
    }
    if (gallery.isArchived) {
      return reply.code(409).send({ type: 'gallery-archived', title: 'Gallery Archived', status: 409 })
    }

    const effectiveModerationMode = mode === 'photographer'
      ? 'AUTO'
      : gallery.moderationMode

    try {
      const uploadTask = ingestUploadedPhoto({
        gallery: {
          id: gallery.id,
          slug: gallery.slug,
          moderationMode: effectiveModerationMode as 'MANUAL' | 'AUTO',
          stripExif: gallery.stripExif,
        },
        upload: await req.file(),
        db,
        storage: opts.storage,
        sse: opts.sse,
        mediaProcessor: opts.mediaProcessor,
        requestId: req.id,
        limits: {
          maxFileSizeMb: fastify.config.maxFileSizeMb,
          maxVideoSizeMb: fastify.config.maxVideoSizeMb,
        },
      })
      inFlightUploads.add(uploadTask)
      let response: Awaited<typeof uploadTask>
      try {
        response = await uploadTask
      } finally {
        inFlightUploads.delete(uploadTask)
      }

      return reply.code(201).send(response)
    } catch (error) {
      if (error instanceof PhotoIngestError) {
        return reply.code(error.statusCode).send(error.body)
      }
      throw error
    }
  })

  // GET photos by gallery and status
  fastify.get('/admin/galleries/:id/photos', {
    preHandler: fastify.requireAdmin,
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } } },
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
          cursor: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { status, cursor, limit = 50 } = req.query as {
      status?: 'PENDING' | 'APPROVED' | 'REJECTED'
      cursor?: string
      limit?: number
    }
    const decodedCursor = cursor ? decodePaginationCursor(cursor) : null
    if (cursor && !decodedCursor) {
      return reply.code(400).send({
        type: 'invalid-cursor',
        title: 'Invalid cursor',
        status: 400,
      })
    }

    const db = fastify.db
    const gallery = await db.gallery.findUnique({
      where: { id },
      select: {
        slug: true,
        photos: {
          where: {
            deletedAt: null,
            ...(status ? { status } : {}),
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
        },
      },
    })
    if (!gallery) return reply.code(404).send({ type: 'gallery-not-found', status: 404 })

    const photos = gallery.photos

    const hasMore = photos.length > limit
    const items = photos.slice(0, limit)
    return reply.send({
      data: items.map((p) => ({
        id: p.id,
        mediaType: p.mediaType,
        thumbUrl: `/api/v1/files/${gallery.slug}/${p.id}?v=thumb`,
        displayUrl: `/api/v1/files/${gallery.slug}/${p.id}?v=display`,
        duration: p.duration,
        guestName: p.guestName,
        status: p.status,
        rejectionReason: p.rejectionReason,
        createdAt: p.createdAt.toISOString(),
      })),
      pagination: {
        nextCursor: hasMore
          ? encodePaginationCursor(items[items.length - 1].id, items[items.length - 1].createdAt)
          : null,
        hasMore,
      },
    })
  })

  // PATCH single photo (approve/reject)
  fastify.patch('/admin/photos/:id', {
    preHandler: fastify.requireAdmin,
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['APPROVED', 'REJECTED'] },
          rejectionReason: { type: 'string', maxLength: 200 },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { status, rejectionReason } = req.body as {
      status: 'APPROVED' | 'REJECTED'
      rejectionReason?: string
    }

    const db = fastify.db
    let photo: {
      id: string
      galleryId: string
      mediaType: string
      duration: number | null
      guestName: string | null
      createdAt: Date
      status: string
      gallery: { slug: string }
    }
    try {
      photo = await db.photo.update({
        where: { id },
        data: { status, rejectionReason: rejectionReason ?? null },
        include: { gallery: { select: { slug: true } } },
      })
    } catch (error) {
      if (isPrismaNotFoundError(error)) {
        return reply.code(404).send({
          type: 'photo-not-found',
          title: 'Photo not found',
          status: 404,
        })
      }
      throw error
    }

    if (status === 'APPROVED') {
      const photoResponse: PhotoResponse = {
        id: photo.id,
        mediaType: photo.mediaType as 'IMAGE' | 'VIDEO',
        thumbUrl: `/api/v1/files/${photo.gallery.slug}/${photo.id}?v=thumb`,
        displayUrl: `/api/v1/files/${photo.gallery.slug}/${photo.id}?v=display`,
        duration: photo.duration,
        guestName: photo.guestName,
        createdAt: photo.createdAt.toISOString(),
      }
      await opts.sse.broadcast(photo.galleryId, 'new-photo', photoResponse)
    }

    return reply.send({ ...photo, status: photo.status })
  })

  // POST batch action
  fastify.post('/admin/photos/batch', {
    preHandler: fastify.requireAdmin,
    schema: {
      body: {
        type: 'object',
        required: ['action', 'photoIds'],
        properties: {
          action: { type: 'string', enum: ['approve', 'reject'] },
          photoIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100 },
          rejectionReason: { type: 'string', maxLength: 200 },
        },
      },
    },
  }, async (req, reply) => {
    const { action, photoIds, rejectionReason } = req.body as {
      action: 'approve' | 'reject'
      photoIds: string[]
      rejectionReason?: string
    }

    const db = fastify.db
    const status = action === 'approve' ? 'APPROVED' : 'REJECTED'

    const result = await db.photo.updateMany({
      where: { id: { in: photoIds } },
      data: { status, rejectionReason: action === 'reject' ? (rejectionReason ?? null) : null },
    })

    if (status === 'APPROVED') {
      const photos = await db.photo.findMany({
        where: { id: { in: photoIds } },
        include: { gallery: true },
      })
      for (const photo of photos) {
        const photoResponse: PhotoResponse = {
          id: photo.id,
          mediaType: photo.mediaType as 'IMAGE' | 'VIDEO',
          thumbUrl: `/api/v1/files/${photo.gallery.slug}/${photo.id}?v=thumb`,
          displayUrl: `/api/v1/files/${photo.gallery.slug}/${photo.id}?v=display`,
          duration: photo.duration,
          guestName: photo.guestName,
          createdAt: photo.createdAt.toISOString(),
        }
        await opts.sse.broadcast(photo.galleryId, 'new-photo', photoResponse)
      }
    }

    return reply.send({ processed: result.count, failed: [] })
  })

  // DELETE single photo (soft delete)
  fastify.delete('/admin/photos/:id', {
    preHandler: fastify.requireAdmin,
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = fastify.db
    try {
      await db.photo.update({ where: { id }, data: { deletedAt: new Date() } })
    } catch (error) {
      if (isPrismaNotFoundError(error)) {
        return reply.code(404).send({
          type: 'photo-not-found',
          title: 'Photo not found',
          status: 404,
        })
      }
      throw error
    }
    return reply.send({ ok: true })
  })
}
