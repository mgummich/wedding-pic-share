import type { FastifyInstance } from 'fastify'
import type { UploadNotifier } from '../../services/uploadNotifier.js'

export async function adminWebhookRoutes(
  fastify: FastifyInstance,
  opts: { uploadNotifier: UploadNotifier }
): Promise<void> {
  fastify.post('/admin/webhooks/test', {
    preHandler: [fastify.requireAdmin],
  }, async (_req, reply) => {
    void opts.uploadNotifier.notifyGuestUpload({
      galleryName: 'Test Event',
      gallerySlug: 'test-event',
      photoId: 'test-event',
      mediaType: 'IMAGE',
      status: 'PENDING',
    }).catch((error: unknown) => {
      fastify.log.error({ error }, 'admin.webhook.test.notification.failed')
    })
    return reply.code(202).send({ ok: true })
  })
}
