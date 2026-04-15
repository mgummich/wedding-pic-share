'use client'

import { useEffect, useRef } from 'react'
import type { PhotoResponse } from '@wedding/shared'

// SSE runs client-side only; use empty base URL so requests go through the
// Next.js rewrite proxy (/api/v1/* → backend), matching the api.ts pattern.
const BASE_URL = ''

const INITIAL_RECONNECT_DELAY_MS = 1000
const MAX_RECONNECT_DELAY_MS = 30_000

interface UseSSEOptions {
  onPhoto: (photo: PhotoResponse) => void
  onGalleryClosed?: () => void
  onConnectionStateChange?: (state: 'connecting' | 'connected' | 'reconnecting' | 'closed') => void
  enabled?: boolean
}

export function useSSE(gallerySlug: string, opts: UseSSEOptions): void {
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    if (opts.enabled === false) return

    let es: EventSource | null = null
    let reconnectDelay = INITIAL_RECONNECT_DELAY_MS
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let destroyed = false

    function connect() {
      if (destroyed) return
      optsRef.current.onConnectionStateChange?.('connecting')
      es = new EventSource(`${BASE_URL}/api/v1/g/${gallerySlug}/slideshow/stream`)

      es.onopen = () => {
        optsRef.current.onConnectionStateChange?.('connected')
      }

      es.addEventListener('new-photo', (event: MessageEvent) => {
        try {
          const photo = JSON.parse(event.data) as PhotoResponse
          optsRef.current.onPhoto(photo)
          reconnectDelay = INITIAL_RECONNECT_DELAY_MS // reset on success
        } catch { /* malformed data */ }
      })

      es.addEventListener('gallery-closed', () => {
        optsRef.current.onGalleryClosed?.()
        optsRef.current.onConnectionStateChange?.('closed')
        es?.close()
      })

      es.onerror = () => {
        es?.close()
        if (destroyed) return
        optsRef.current.onConnectionStateChange?.('reconnecting')
        timeoutId = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
          connect()
        }, reconnectDelay)
      }
    }

    connect()

    return () => {
      destroyed = true
      if (timeoutId) clearTimeout(timeoutId)
      es?.close()
      optsRef.current.onConnectionStateChange?.('closed')
    }
  }, [gallerySlug, opts.enabled])
}
