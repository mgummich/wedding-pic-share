import type { FastifyInstance } from 'fastify'
import { getClient } from '@wedding/db'
import type { GalleryResponse, WeddingResponse } from '@wedding/shared'
import bcrypt from 'bcryptjs'
import { toGalleryResponse } from '../../services/uploadWindows.js'

type UploadWindowInput = {
  start: string
  end: string
}

type GalleryPatchBody = {
  name?: string
  description?: string
  layout?: 'MASONRY' | 'GRID'
  allowGuestDownload?: boolean
  guestNameMode?: 'OPTIONAL' | 'REQUIRED' | 'HIDDEN'
  moderationMode?: 'MANUAL' | 'AUTO'
  stripExif?: boolean
  secretKey?: string | null
  isActive?: boolean
  uploadWindows?: UploadWindowInput[]
}

const SECRET_KEY_MIN_LENGTH = 4
const SECRET_KEY_MAX_LENGTH = 32

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

function parseSecretKey(
  input: unknown,
  options: { allowNull: boolean }
): { ok: true; value: string | null | undefined } | { ok: false } {
  if (input === undefined) return { ok: true, value: undefined }
  if (options.allowNull && input === null) return { ok: true, value: null }
  if (typeof input !== 'string') return { ok: false }

  const normalized = input.trim()
  if (normalized.length < SECRET_KEY_MIN_LENGTH || normalized.length > SECRET_KEY_MAX_LENGTH) {
    return { ok: false }
  }

  return { ok: true, value: normalized }
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
          stripExif: { type: 'boolean' },
          secretKey: { type: 'string', minLength: SECRET_KEY_MIN_LENGTH, maxLength: SECRET_KEY_MAX_LENGTH },
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
      stripExif?: boolean
      secretKey?: string
    }

    const parsedSecretKey = parseSecretKey(body.secretKey, { allowNull: false })
    if (!parsedSecretKey.ok) {
      return reply.code(400).send({
        type: 'validation-error',
        title: 'Ungueltige Galerie-PIN.',
        status: 400,
      })
    }
    const hashedSecretKey = parsedSecretKey.value
      ? await bcrypt.hash(parsedSecretKey.value, 12)
      : undefined

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
        stripExif: body.stripExif ?? true,
        secretKey: hashedSecretKey,
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
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          layout: { type: 'string', enum: ['MASONRY', 'GRID'] },
          allowGuestDownload: { type: 'boolean' },
          guestNameMode: { type: 'string', enum: ['OPTIONAL', 'REQUIRED', 'HIDDEN'] },
          moderationMode: { type: 'string', enum: ['MANUAL', 'AUTO'] },
          stripExif: { type: 'boolean' },
          secretKey: {
            anyOf: [
              { type: 'string', minLength: SECRET_KEY_MIN_LENGTH, maxLength: SECRET_KEY_MAX_LENGTH },
              { type: 'null' },
            ],
          },
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
    const body = req.body as GalleryPatchBody
    const db = getClient()

    try {
      const {
        name,
        description,
        layout,
        allowGuestDownload,
        guestNameMode,
        moderationMode,
        stripExif,
        uploadWindows: rawUploadWindows,
        isActive,
        secretKey: rawSecretKey,
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
      const parsedSecretKey = parseSecretKey(rawSecretKey, { allowNull: true })
      if (!parsedSecretKey.ok) {
        return reply.code(400).send({
          type: 'validation-error',
          title: 'Ungueltige Galerie-PIN.',
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

        const updateData: Record<string, unknown> = {}
        if (name !== undefined) {
          updateData.name = name
        }
        if (description !== undefined) {
          updateData.description = description
        }
        if (layout !== undefined) {
          updateData.layout = layout
        }
        if (allowGuestDownload !== undefined) {
          updateData.allowGuestDownload = allowGuestDownload
        }
        if (guestNameMode !== undefined) {
          updateData.guestNameMode = guestNameMode
        }
        if (moderationMode !== undefined) {
          updateData.moderationMode = moderationMode
        }
        if (stripExif !== undefined) {
          updateData.stripExif = stripExif
        }
        if (typeof isActive === 'boolean') {
          updateData.isActive = isActive
        }
        if (parsedSecretKey.value !== undefined) {
          updateData.secretKey = parsedSecretKey.value === null
            ? null
            : await bcrypt.hash(parsedSecretKey.value, 12)
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
      req.log.error({ err: error, galleryId: id }, 'Failed to update gallery settings')
      return reply.code(500).send({ type: 'internal-server-error', status: 500 })
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
