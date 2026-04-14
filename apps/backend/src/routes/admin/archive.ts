import type { FastifyInstance } from 'fastify'
import type { StorageService } from '../../services/storage.js'
import type { SseManager } from '../../services/sse.js'
import { createGalleryArchive } from '../../services/galleryArchive.js'
import { toGalleryResponse } from '../../services/uploadWindows.js'

const ARCHIVE_STALE_AFTER_MS = 10 * 60 * 1000
const ARCHIVE_CLOSE_TIMEOUT_MS = 30 * 1000

function toArchiveErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 500)
}

async function runArchiveJob(params: {
  galleryId: string
  storage: StorageService
  sse: SseManager
  fastify: FastifyInstance
}): Promise<void> {
  const db = params.fastify.db
  const gallery = await db.gallery.findUnique({
    where: { id: params.galleryId },
    include: { uploadWindows: { orderBy: { start: 'asc' } } },
  })
  if (!gallery) {
    return
  }

  if (gallery.isArchived && gallery.archivePath && gallery.archiveSizeBytes !== null) {
    await db.gallery.update({
      where: { id: gallery.id },
      data: {
        archiveStatus: 'COMPLETED',
        archiveError: null,
      },
    })
    return
  }

  try {
    const photos = await db.photo.findMany({
      where: { galleryId: gallery.id, status: 'APPROVED', deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, originalPath: true },
    })

    const archive = await createGalleryArchive({
      galleryId: gallery.id,
      gallerySlug: gallery.slug,
      photos,
      storage: params.storage,
      existingArchive: {
        archivePath: gallery.archivePath,
        archiveSizeBytes: gallery.archiveSizeBytes,
      },
    })

    const archivedAt = new Date()
    await db.$transaction(async (tx) => {
      await tx.uploadWindow.deleteMany({ where: { galleryId: gallery.id } })
      await tx.gallery.update({
        where: { id: gallery.id },
        data: {
          isArchived: true,
          archivedAt,
          archivePath: archive.archivePath,
          archiveSizeBytes: archive.archiveSizeBytes,
          archiveStatus: 'COMPLETED',
          archiveError: null,
        },
      })
    })

    await params.sse.broadcast(gallery.id, 'gallery-closed', {
      reason: 'archived',
      archivedAt: archivedAt.toISOString(),
    })
  } catch (error) {
    params.fastify.log.error({ err: error, galleryId: gallery.id }, 'archive job failed')
    await db.gallery.update({
      where: { id: gallery.id },
      data: {
        archiveStatus: 'FAILED',
        archiveError: toArchiveErrorMessage(error),
      },
    }).catch(() => {})
  }
}

export async function adminArchiveRoutes(
  fastify: FastifyInstance,
  opts: { storage: StorageService; sse: SseManager }
): Promise<void> {
  const activeJobs = new Set<Promise<void>>()

  fastify.addHook('onClose', async () => {
    if (activeJobs.size === 0) return
    await Promise.race([
      Promise.allSettled(Array.from(activeJobs)).then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, ARCHIVE_CLOSE_TIMEOUT_MS)),
    ])
  })

  fastify.post('/admin/galleries/:id/archive', {
    preHandler: fastify.requireAdmin,
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = fastify.db

    const gallery = await db.gallery.findUnique({
      where: { id },
      include: { uploadWindows: { orderBy: { start: 'asc' } } },
    })
    if (!gallery) return reply.code(404).send({ type: 'gallery-not-found', status: 404 })

    if (gallery.isArchived && gallery.archivePath && gallery.archiveSizeBytes !== null) {
      if (gallery.archiveStatus !== 'COMPLETED') {
        await db.gallery.update({
          where: { id: gallery.id },
          data: { archiveStatus: 'COMPLETED', archiveError: null },
        }).catch(() => {})
      }
      const photoCount = await db.photo.count({
        where: { galleryId: gallery.id, status: 'APPROVED', deletedAt: null },
      })
      return reply.send(toGalleryResponse(gallery, photoCount))
    }

    const archiveIsStale = gallery.archiveStatus === 'IN_PROGRESS' && (
      !gallery.archiveRequestedAt ||
      (Date.now() - gallery.archiveRequestedAt.getTime()) > ARCHIVE_STALE_AFTER_MS
    )

    if (archiveIsStale) {
      await db.gallery.update({
        where: { id: gallery.id },
        data: {
          archiveStatus: 'FAILED',
          archiveError: 'Archive job timed out and can be retried.',
        },
      }).catch(() => {})
    } else if (gallery.archiveStatus === 'IN_PROGRESS') {
      const photoCount = await db.photo.count({
        where: { galleryId: gallery.id, status: 'APPROVED', deletedAt: null },
      })
      return reply.code(202).send(toGalleryResponse(gallery, photoCount))
    }

    const started = await db.gallery.updateMany({
      where: {
        id: gallery.id,
        archiveStatus: { in: ['IDLE', 'FAILED'] },
      },
      data: {
        archiveStatus: 'IN_PROGRESS',
        archiveError: null,
        archiveRequestedAt: new Date(),
      },
    })

    if (started.count > 0) {
      let job: Promise<void>
      job = runArchiveJob({
        galleryId: gallery.id,
        storage: opts.storage,
        sse: opts.sse,
        fastify,
      }).finally(() => {
        activeJobs.delete(job)
      })
      activeJobs.add(job)
      void job
    }

    const latest = await db.gallery.findUnique({
      where: { id: gallery.id },
      include: { uploadWindows: { orderBy: { start: 'asc' } } },
    })
    if (!latest) {
      return reply.code(404).send({ type: 'gallery-not-found', status: 404 })
    }
    const photoCount = await db.photo.count({
      where: { galleryId: latest.id, status: 'APPROVED', deletedAt: null },
    })

    return reply.code(202).send(toGalleryResponse(latest, photoCount))
  })
}
