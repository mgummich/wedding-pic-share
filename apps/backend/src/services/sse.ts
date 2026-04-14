import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'

export type SseSendFn = (data: string) => void
export type SseCloseFn = () => void

interface SseConnection {
  id: string
  send: SseSendFn
  close?: SseCloseFn
}

export interface SseManager {
  add(galleryId: string, connectionId: string, send: SseSendFn, close?: SseCloseFn): void
  remove(galleryId: string, connectionId: string): void
  broadcast(galleryId: string, event: string, data: unknown): Promise<void>
  sendHeartbeat(galleryId: string): Promise<void>
  connectionCount(galleryId: string): number
  close(): Promise<void>
}

type SseBusMessage = {
  origin: string
  galleryId: string
  event: string
  data: unknown
}

type SseManagerOptions = {
  redisUrl: string | null
  channelPrefix?: string
}

export function createSseManager(options: SseManagerOptions): SseManager {
  const map = new Map<string, Map<string, SseConnection>>()
  const instanceId = randomUUID()
  const channelPrefix = options.channelPrefix ?? 'wps:sse'
  const channelName = `${channelPrefix}:events`

  let pub: Redis | null = null
  let sub: Redis | null = null

  if (options.redisUrl) {
    pub = new Redis(options.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    })
    sub = pub.duplicate()
    void sub.subscribe(channelName)
    sub.on('message', (_channel, payload) => {
      let message: SseBusMessage
      try {
        message = JSON.parse(payload) as SseBusMessage
      } catch {
        return
      }
      if (message.origin === instanceId) return
      deliverLocal(message.galleryId, message.event, message.data)
    })
  }

  function getOrCreate(galleryId: string): Map<string, SseConnection> {
    if (!map.has(galleryId)) map.set(galleryId, new Map())
    return map.get(galleryId)!
  }

  function deliverLocal(galleryId: string, event: string, data: unknown): void {
    const gallery = map.get(galleryId)
    if (!gallery) return
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const [connectionId, conn] of gallery.entries()) {
      try {
        conn.send(payload)
      } catch {
        try {
          conn.close?.()
        } catch {
          // ignore
        }
        gallery.delete(connectionId)
      }
    }
    if (gallery.size === 0) {
      map.delete(galleryId)
    }
  }

  async function publish(galleryId: string, event: string, data: unknown): Promise<void> {
    if (!pub) return
    const message: SseBusMessage = {
      origin: instanceId,
      galleryId,
      event,
      data,
    }
    await pub.publish(channelName, JSON.stringify(message))
  }

  return {
    add(galleryId, connectionId, send, close) {
      getOrCreate(galleryId).set(connectionId, { id: connectionId, send, close })
    },

    remove(galleryId, connectionId) {
      const gallery = map.get(galleryId)
      if (!gallery) return
      gallery.delete(connectionId)
      if (gallery.size === 0) map.delete(galleryId)
    },

    async broadcast(galleryId, event, data) {
      deliverLocal(galleryId, event, data)
      await publish(galleryId, event, data)
    },

    async sendHeartbeat(galleryId) {
      const payload = { ts: Date.now() }
      deliverLocal(galleryId, 'ping', payload)
      await publish(galleryId, 'ping', payload)
    },

    connectionCount(galleryId) {
      return map.get(galleryId)?.size ?? 0
    },

    async close() {
      for (const gallery of map.values()) {
        for (const conn of gallery.values()) {
          try {
            conn.close?.()
          } catch {
            // best-effort close
          }
        }
      }
      map.clear()

      if (sub) {
        await sub.unsubscribe(channelName).catch(() => {})
        await sub.quit().catch(() => {})
      }
      if (pub) {
        await pub.quit().catch(() => {})
      }
    },
  }
}
