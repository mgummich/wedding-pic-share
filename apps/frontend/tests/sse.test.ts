import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSSE } from '../src/lib/sse.js'
import type { PhotoResponse } from '@wedding/shared'

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  listeners: Map<string, ((e: MessageEvent) => void)[]> = new Map()
  readyState = 1
  OPEN = 1

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, handler: (e: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type)!.push(handler)
  }

  removeEventListener(type: string, handler: (e: MessageEvent) => void) {
    const handlers = this.listeners.get(type) ?? []
    this.listeners.set(type, handlers.filter((h) => h !== handler))
  }

  emit(type: string, data: unknown) {
    const handlers = this.listeners.get(type) ?? []
    const event = { data: JSON.stringify(data), type } as MessageEvent
    handlers.forEach((h) => h(event))
  }

  close() { this.readyState = 2 }
}

afterEach(() => {
  MockEventSource.instances = []
  vi.unstubAllGlobals()
})

describe('useSSE', () => {
  it('calls onPhoto when new-photo event is received', async () => {
    vi.stubGlobal('EventSource', MockEventSource)

    const onPhoto = vi.fn()
    const { unmount } = renderHook(() =>
      useSSE('test-gallery-slug', { onPhoto })
    )

    const es = MockEventSource.instances[0]
    expect(es).toBeDefined()

    const photo: PhotoResponse = {
      id: 'p1',
      mediaType: 'IMAGE',
      thumbUrl: '/thumb.webp',
      displayUrl: '/display.webp',
      duration: null,
      guestName: 'Max',
      createdAt: new Date().toISOString(),
    }

    act(() => { es.emit('new-photo', photo) })

    expect(onPhoto).toHaveBeenCalledWith(photo)
    unmount()
  })

  it('closes EventSource on unmount', () => {
    vi.stubGlobal('EventSource', MockEventSource)

    const { unmount } = renderHook(() => useSSE('slug', { onPhoto: vi.fn() }))
    const es = MockEventSource.instances[0]
    unmount()
    expect(es.readyState).toBe(2) // CLOSED
  })

  it('calls onGalleryClosed and closes stream on gallery-closed event', () => {
    vi.stubGlobal('EventSource', MockEventSource)

    const onGalleryClosed = vi.fn()
    renderHook(() => useSSE('slug', { onPhoto: vi.fn(), onGalleryClosed }))
    const es = MockEventSource.instances[0]

    act(() => {
      es.emit('gallery-closed', { reason: 'archived' })
    })

    expect(onGalleryClosed).toHaveBeenCalledTimes(1)
    expect(es.readyState).toBe(2)
  })
})
