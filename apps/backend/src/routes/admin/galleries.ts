import type { FastifyInstance } from 'fastify'
import { getClient } from '@wedding/db'
import type { GalleryResponse, WeddingResponse } from '@wedding/shared'

export async function adminGalleryRoutes(fastify: FastifyInstance): Promise<void> {
  // GET all weddings with galleries
  fastify.get('/admin/galleries', {
    preHandler: [fastify.requireAdmin],
  }, async (_req, reply) => {
    const db = getClient()
    const weddings = await db.wedding.findMany({
      include: {
        galleries: {
          include: { _count: { select: { photos: true } } },
        },
      },
    })
    return reply.send(weddings.map((w) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
      createdAt: w.createdAt.toISOString(),
      galleries: w.galleries.map((g) => ({
        id: g.id,
        name: g.name,
        slug: g.slug,
        description: g.description,
        layout: g.layout,
        allowGuestDownload: g.allowGuestDownload,
        guestNameMode: g.guestNameMode,
        photoCount: g._count.photos,
      } satisfies GalleryResponse)),
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
      ...gallery,
      weddingId: wedding.id,
      photoCount: 0,
      layout: gallery.layout,
      guestNameMode: gallery.guestNameMode,
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
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as Record<string, unknown>
    const db = getClient()

    try {
      const gallery = await db.gallery.update({ where: { id }, data: body })
      const count = await db.photo.count({ where: { galleryId: id } })
      return reply.send({ ...gallery, photoCount: count })
    } catch {
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
