import type { FastifyInstance } from 'fastify'
import { getClient } from '@wedding/db'
import type { SseManager } from '../../services/sse.js'
import type { PhotoResponse } from '@wedding/shared'
import type { StorageService } from '../../services/storage.js'
import { ingestUploadedPhoto, PhotoIngestError } from '../../services/photoIngest.js'
import type { MediaProcessor } from '../../services/mediaProcessor.js'

export async function adminPhotoRoutes(
  fastify: FastifyInstance,
  opts: { sse: SseManager; storage: StorageService; mediaProcessor: MediaProcessor }
): Promise<void> {
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
    const db = getClient()
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
      const response = await ingestUploadedPhoto({
        gallery: {
          id: gallery.id,
          slug: gallery.slug,
          moderationMode: effectiveModerationMode as 'MANUAL' | 'AUTO',
          stripExif: gallery.stripExif,
        },
        upload: await req.file(),
        storage: opts.storage,
        sse: opts.sse,
        mediaProcessor: opts.mediaProcessor,
      })

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

    const db = getClient()
    const gallery = await db.gallery.findUnique({ where: { id } })
    if (!gallery) return reply.code(404).send({ type: 'gallery-not-found', status: 404 })

    const photos = await db.photo.findMany({
      where: {
        galleryId: id,
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    })

    const hasMore = photos.length > limit
    const items = photos.slice(0, limit)
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ''

    return reply.send({
      data: items.map((p) => ({
        id: p.id,
        mediaType: p.mediaType,
        thumbUrl: `${apiBase}/api/v1/files/${gallery.slug}/${p.id}?v=thumb`,
        displayUrl: `${apiBase}/api/v1/files/${gallery.slug}/${p.id}?v=display`,
        duration: p.duration,
        guestName: p.guestName,
        status: p.status,
        rejectionReason: p.rejectionReason,
        createdAt: p.createdAt.toISOString(),
      })),
      pagination: { nextCursor: hasMore ? items[items.length - 1].id : null, hasMore },
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

    const db = getClient()
    const photo = await db.photo.update({
      where: { id },
      data: { status, rejectionReason: rejectionReason ?? null },
      include: { gallery: true },
    })

    if (status === 'APPROVED') {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ''
      const photoResponse: PhotoResponse = {
        id: photo.id,
        mediaType: photo.mediaType as 'IMAGE' | 'VIDEO',
        thumbUrl: `${apiBase}/api/v1/files/${photo.gallery.slug}/${photo.id}?v=thumb`,
        displayUrl: `${apiBase}/api/v1/files/${photo.gallery.slug}/${photo.id}?v=display`,
        duration: photo.duration,
        guestName: photo.guestName,
        createdAt: photo.createdAt.toISOString(),
      }
      opts.sse.broadcast(photo.galleryId, 'new-photo', photoResponse)
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

    const db = getClient()
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
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ''
      for (const photo of photos) {
        const photoResponse: PhotoResponse = {
          id: photo.id,
          mediaType: photo.mediaType as 'IMAGE' | 'VIDEO',
          thumbUrl: `${apiBase}/api/v1/files/${photo.gallery.slug}/${photo.id}?v=thumb`,
          displayUrl: `${apiBase}/api/v1/files/${photo.gallery.slug}/${photo.id}?v=display`,
          duration: photo.duration,
          guestName: photo.guestName,
          createdAt: photo.createdAt.toISOString(),
        }
        opts.sse.broadcast(photo.galleryId, 'new-photo', photoResponse)
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
    const db = getClient()
    await db.photo.update({ where: { id }, data: { deletedAt: new Date() } })
    return reply.send({ ok: true })
  })
}
