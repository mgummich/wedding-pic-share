import type { FastifyInstance } from 'fastify'
import { getClient } from '@wedding/db'
import type { GalleryResponse, WeddingResponse } from '@wedding/shared'
import { toGalleryResponse } from '../../services/uploadWindows.js'

type UploadWindowInput = {
  start: string
  end: string
}

function parseUploadWindows(input: unknown): Array<{ start: Date; end: Date }> | null {
  if (!Array.isArray(input)) return null

  const windows = input.map((item) => {
    if (!item || typeof item !== 'object') return null
    const { start, end } = item as UploadWindowInput
    const startDate = new Date(start)
    const endDate = new Date(end)
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate >= endDate) {
      return null
    }
    return { start: startDate, end: endDate }
  })

  return windows.every(Boolean) ? windows as Array<{ start: Date; end: Date }> : null
}

export async function adminGalleryRoutes(fastify: FastifyInstance): Promise<void> {
  // GET all weddings with galleries
  fastify.get('/admin/galleries', {
    preHandler: [fastify.requireAdmin],
  }, async (_req, reply) => {
    const db = getClient()
    const weddings = await db.wedding.findMany({
      include: {
        galleries: {
          include: {
            _count: { select: { photos: true } },
            uploadWindows: { orderBy: { start: 'asc' } },
          },
        },
      },
    })
    return reply.send(weddings.map((w) => ({
      id: w.id,
        name: w.name,
        slug: w.slug,
        createdAt: w.createdAt.toISOString(),
        galleries: w.galleries.map((g) => toGalleryResponse(g, g._count.photos) satisfies GalleryResponse),
      } satisfies WeddingResponse)))
  })

  // POST create gallery (upserts wedding by slug, then creates gallery)
  fastify.post('/admin/galleries', {
    preHandler: [fastify.requireAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['weddingName', 'weddingSlug', 'galleryName', 'gallerySlug'],
        properties: {
          weddingName: { type: 'string', minLength: 1, maxLength: 100 },
          weddingSlug: { type: 'string', pattern: '^[a-z0-9-]+$', minLength: 1, maxLength: 60 },
          galleryName: { type: 'string', minLength: 1, maxLength: 100 },
          gallerySlug: { type: 'string', pattern: '^[a-z0-9-]+$', minLength: 1, maxLength: 60 },
          description: { type: 'string', maxLength: 500 },
          layout: { type: 'string', enum: ['MASONRY', 'GRID'] },
          allowGuestDownload: { type: 'boolean' },
          guestNameMode: { type: 'string', enum: ['OPTIONAL', 'REQUIRED', 'HIDDEN'] },
          moderationMode: { type: 'string', enum: ['MANUAL', 'AUTO'] },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      weddingName: string
      weddingSlug: string
      galleryName: string
      gallerySlug: string
      description?: string
      layout?: 'MASONRY' | 'GRID'
      allowGuestDownload?: boolean
      guestNameMode?: 'OPTIONAL' | 'REQUIRED' | 'HIDDEN'
      moderationMode?: 'MANUAL' | 'AUTO'
    }

    const db = getClient()
    const wedding = await db.wedding.upsert({
      where: { slug: body.weddingSlug },
      create: { name: body.weddingName, slug: body.weddingSlug },
      update: {},
    })

    const existing = await db.gallery.findUnique({
      where: { weddingId_slug: { weddingId: wedding.id, slug: body.gallerySlug } },
    })
    if (existing) {
      return reply.code(409).send({
        type: 'conflict',
        title: 'Gallery slug already exists for this wedding',
        status: 409,
      })
    }

    const gallery = await db.gallery.create({
      data: {
        weddingId: wedding.id,
        name: body.galleryName,
        slug: body.gallerySlug,
        description: body.description,
        layout: body.layout ?? 'MASONRY',
        allowGuestDownload: body.allowGuestDownload ?? false,
        guestNameMode: body.guestNameMode ?? 'OPTIONAL',
        moderationMode: body.moderationMode ?? 'MANUAL',
      },
    })

    return reply.code(201).send({
      ...toGalleryResponse({ ...gallery, uploadWindows: [] }, 0),
      weddingId: wedding.id,
    })
  })

  // PATCH update gallery settings
  fastify.patch('/admin/galleries/:id', {
    preHandler: [fastify.requireAdmin],
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          layout: { type: 'string', enum: ['MASONRY', 'GRID'] },
          allowGuestDownload: { type: 'boolean' },
          guestNameMode: { type: 'string', enum: ['OPTIONAL', 'REQUIRED', 'HIDDEN'] },
          moderationMode: { type: 'string', enum: ['MANUAL', 'AUTO'] },
          isActive: { type: 'boolean' },
          uploadWindows: {
            type: 'array',
            items: {
              type: 'object',
              required: ['start', 'end'],
              properties: {
                start: { type: 'string', format: 'date-time' },
                end: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as Record<string, unknown>
    const db = getClient()

    try {
      const {
        uploadWindows: rawUploadWindows,
        isActive,
        ...rest
      } = body

      const parsedUploadWindows = rawUploadWindows === undefined
        ? undefined
        : parseUploadWindows(rawUploadWindows)

      if (rawUploadWindows !== undefined && parsedUploadWindows === null) {
        return reply.code(400).send({
          type: 'validation-error',
          title: 'Ungueltiges Upload-Zeitfenster.',
          status: 400,
        })
      }

      const uploadWindows = parsedUploadWindows ?? undefined

      const gallery = await db.$transaction(async (tx) => {
        const existing = await tx.gallery.findUnique({ where: { id } })
        if (!existing) {
          throw new Error('gallery-not-found')
        }

        if (isActive === true) {
          await tx.gallery.updateMany({
            where: { id: { not: id } },
            data: { isActive: false },
          })
        }

        if (uploadWindows !== undefined) {
          await tx.uploadWindow.deleteMany({ where: { galleryId: id } })
        }

        const updateData: Record<string, unknown> = { ...rest }
        if (typeof isActive === 'boolean') {
          updateData.isActive = isActive
        }

        await tx.gallery.update({
          where: { id },
          data: updateData,
        })

        if (uploadWindows !== undefined && uploadWindows.length > 0) {
          await tx.uploadWindow.createMany({
            data: uploadWindows.map((window) => ({
              galleryId: id,
              start: window.start,
              end: window.end,
            })),
          })
        }

        return tx.gallery.findUniqueOrThrow({
          where: { id },
          include: {
            uploadWindows: { orderBy: { start: 'asc' } },
          },
        })
      })
      const count = await db.photo.count({ where: { galleryId: id } })
      return reply.send(toGalleryResponse(gallery, count))
    } catch (error) {
      if (error instanceof Error && error.message === 'gallery-not-found') {
        return reply.code(404).send({ type: 'gallery-not-found', status: 404 })
      }
      return reply.code(404).send({ type: 'gallery-not-found', status: 404 })
    }
  })

  // DELETE gallery and its photos
  fastify.delete('/admin/galleries/:id', {
    preHandler: [fastify.requireAdmin],
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getClient()
    await db.photo.deleteMany({ where: { galleryId: id } })
    await db.gallery.delete({ where: { id } }).catch(() => {})
    return reply.send({ ok: true })
  })
}
