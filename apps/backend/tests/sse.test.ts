import { describe, it, expect, beforeEach } from 'vitest'
import { createSseManager } from '../src/services/sse.js'

describe('SseManager', () => {
  let manager: ReturnType<typeof createSseManager>

  beforeEach(() => {
    manager = createSseManager({ redisUrl: null })
  })

  it('tracks connection count per gallery', () => {
    const send = () => {}
    manager.add('gallery-1', 'conn-1', send)
    manager.add('gallery-1', 'conn-2', send)
    manager.add('gallery-2', 'conn-3', send)

    expect(manager.connectionCount('gallery-1')).toBe(2)
    expect(manager.connectionCount('gallery-2')).toBe(1)
    expect(manager.connectionCount('gallery-unknown')).toBe(0)
  })

  it('removes connections on disconnect', () => {
    const send = () => {}
    manager.add('gallery-1', 'conn-1', send)
    manager.remove('gallery-1', 'conn-1')
    expect(manager.connectionCount('gallery-1')).toBe(0)
  })

  it('cleans up empty gallery map entries after remove', () => {
    const send = () => {}
    manager.add('gallery-1', 'conn-1', send)
    manager.remove('gallery-1', 'conn-1')
    // Adding again should still work (map was cleared but gallery can be re-added)
    manager.add('gallery-1', 'conn-2', send)
    expect(manager.connectionCount('gallery-1')).toBe(1)
  })

  it('broadcasts to all connections in a gallery', async () => {
    const received: string[] = []
    const send1 = (data: string) => received.push(`c1:${data}`)
    const send2 = (data: string) => received.push(`c2:${data}`)

    manager.add('gallery-1', 'conn-1', send1)
    manager.add('gallery-1', 'conn-2', send2)

    await manager.broadcast('gallery-1', 'new-photo', { id: 'photo-1' })

    expect(received).toHaveLength(2)
    expect(received.some((r) => r.startsWith('c1:'))).toBe(true)
    expect(received.some((r) => r.startsWith('c2:'))).toBe(true)
    // Verify SSE format
    expect(received[0]).toContain('event: new-photo')
    expect(received[0]).toContain('data: {"id":"photo-1"}')
  })

  it('broadcast does nothing for unknown gallery', async () => {
    await expect(manager.broadcast('unknown', 'test', {})).resolves.toBeUndefined()
  })

  it('sendHeartbeat sends ping event', async () => {
    const received: string[] = []
    manager.add('gallery-1', 'conn-1', (d) => received.push(d))
    await manager.sendHeartbeat('gallery-1')

    expect(received).toHaveLength(1)
    expect(received[0]).toContain('event: ping')
    expect(received[0]).toContain('"ts":')
  })
})
