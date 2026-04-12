import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'

const IP_BLOCK_THRESHOLD = 15
const IP_BLOCK_DURATION_MS = 15 * 60 * 1000
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000

interface IpFailureEntry {
  count: number
  resetAt: number
}

declare module 'fastify' {
  interface FastifyInstance {
    checkIpBlocked: (ip: string) => boolean
    recordIpFailure: (ip: string) => void
    resetIpFailures: (ip: string) => void
  }
}

export const bruteForcePlugin = fp(async (fastify: FastifyInstance) => {
  const failures = new Map<string, IpFailureEntry>()

  function getActiveEntry(ip: string): IpFailureEntry | null {
    const entry = failures.get(ip)
    if (!entry) return null
    if (entry.resetAt <= Date.now()) {
      failures.delete(ip)
      return null
    }
    return entry
  }

  const cleanup = setInterval(() => {
    const now = Date.now()
    for (const [ip, entry] of failures.entries()) {
      if (entry.resetAt <= now) {
        failures.delete(ip)
      }
    }
  }, CLEANUP_INTERVAL_MS)
  cleanup.unref()

  fastify.decorate('checkIpBlocked', (ip: string) => {
    const entry = getActiveEntry(ip)
    return entry !== null && entry.count >= IP_BLOCK_THRESHOLD
  })

  fastify.decorate('recordIpFailure', (ip: string) => {
    const entry = getActiveEntry(ip)
    if (entry) {
      entry.count += 1
      return
    }

    failures.set(ip, {
      count: 1,
      resetAt: Date.now() + IP_BLOCK_DURATION_MS,
    })
  })

  fastify.decorate('resetIpFailures', (ip: string) => {
    failures.delete(ip)
  })

  fastify.addHook('onClose', async () => {
    clearInterval(cleanup)
    failures.clear()
  })
})
