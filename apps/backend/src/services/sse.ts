export type SseSendFn = (data: string) => void

interface SseConnection {
  id: string
  send: SseSendFn
}

export interface SseManager {
  add(galleryId: string, connectionId: string, send: SseSendFn): void
  remove(galleryId: string, connectionId: string): void
  broadcast(galleryId: string, event: string, data: unknown): void
  sendHeartbeat(galleryId: string): void
  connectionCount(galleryId: string): number
}

export function createSseManager(): SseManager {
  const map = new Map<string, Map<string, SseConnection>>()

  function getOrCreate(galleryId: string): Map<string, SseConnection> {
    if (!map.has(galleryId)) map.set(galleryId, new Map())
    return map.get(galleryId)!
  }

  return {
    add(galleryId, connectionId, send) {
      getOrCreate(galleryId).set(connectionId, { id: connectionId, send })
    },

    remove(galleryId, connectionId) {
      const gallery = map.get(galleryId)
      if (!gallery) return
      gallery.delete(connectionId)
      if (gallery.size === 0) map.delete(galleryId)
    },

    broadcast(galleryId, event, data) {
      const gallery = map.get(galleryId)
      if (!gallery) return
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
      for (const conn of gallery.values()) {
        try { conn.send(payload) } catch { /* dead connection */ }
      }
    },

    sendHeartbeat(galleryId) {
      const gallery = map.get(galleryId)
      if (!gallery) return
      const payload = `event: ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`
      for (const conn of gallery.values()) {
        try { conn.send(payload) } catch { /* dead connection */ }
      }
    },

    connectionCount(galleryId) {
      return map.get(galleryId)?.size ?? 0
    },
  }
}
