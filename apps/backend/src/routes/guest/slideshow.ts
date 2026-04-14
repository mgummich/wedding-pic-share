import type { FastifyInstance } from 'fastify'
import { getClient } from '@wedding/db'
import type { SseManager } from '../../services/sse.js'
import { randomUUID } from 'crypto'
import { hasGalleryAccess } from '../../services/galleryAccess.js'

const HEARTBEAT_INTERVAL_MS = 30_000

export async function guestSlideshowRoutes(
  fastify: FastifyInstance,
  opts: { sse: SseManager }
): Promise<void> {
  fastify.get('/g/:slug/slideshow/stream', {
    schema: {
      params: { type: 'object', properties: { slug: { type: 'string', pattern: '^[a-z0-9-]+$' } } },
    },
  }, async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const db = getClient()

    const gallery = await db.gallery.findFirst({ where: { slug } })
    if (!gallery) {
      return reply.code(404).send({ type: 'gallery-not-found', status: 404 })
    }
    if (!hasGalleryAccess(req, gallery, fastify.config.sessionSecret)) {
      return reply.code(401).send({
        type: 'invalid-pin',
        title: 'Falscher Secret Key.',
        status: 401,
      })
    }

    const connectionId = randomUUID()

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const send = (data: string) => reply.raw.write(data)

    opts.sse.add(gallery.id, connectionId, send)
    fastify.log.debug({ galleryId: gallery.id, connectionId }, 'sse.connect')

    const heartbeat = setInterval(() => {
      opts.sse.sendHeartbeat(gallery.id)
    }, HEARTBEAT_INTERVAL_MS)

    req.raw.on('close', () => {
      clearInterval(heartbeat)
      opts.sse.remove(gallery.id, connectionId)
      fastify.log.debug({ galleryId: gallery.id, connectionId }, 'sse.disconnect')
    })

    // Send initial ping so the client knows the connection is live
    send(`event: ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`)

    // Keep connection open — don't call reply.send()
    await new Promise<void>((resolve) => req.raw.on('close', resolve))
  })
}
