import { Redis } from 'ioredis'

export type AttemptStore = {
  getCount(key: string): Promise<number>
  increment(key: string, ttlMs: number): Promise<number>
  reset(key: string): Promise<void>
  close(): Promise<void>
}

type MemoryEntry = {
  count: number
  resetAt: number
}

export function createAttemptStore(
  options: { redisUrl: string | null; keyPrefix?: string }
): AttemptStore {
  const keyPrefix = options.keyPrefix ?? 'wps:attempts'
  if (options.redisUrl) {
    return createRedisAttemptStore(options.redisUrl, keyPrefix)
  }
  return createMemoryAttemptStore()
}

function createMemoryAttemptStore(): AttemptStore {
  const entries = new Map<string, MemoryEntry>()
  const cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of entries.entries()) {
      if (entry.resetAt <= now) {
        entries.delete(key)
      }
    }
  }, 5 * 60 * 1000)
  cleanupTimer.unref()

  function getActiveEntry(key: string): MemoryEntry | null {
    const entry = entries.get(key)
    if (!entry) return null
    if (entry.resetAt <= Date.now()) {
      entries.delete(key)
      return null
    }
    return entry
  }

  return {
    async getCount(key) {
      return getActiveEntry(key)?.count ?? 0
    },

    async increment(key, ttlMs) {
      const now = Date.now()
      const entry = getActiveEntry(key)
      if (entry) {
        entry.count += 1
        return entry.count
      }

      entries.set(key, {
        count: 1,
        resetAt: now + ttlMs,
      })
      return 1
    },

    async reset(key) {
      entries.delete(key)
    },

    async close() {
      clearInterval(cleanupTimer)
      entries.clear()
    },
  }
}

function createRedisAttemptStore(redisUrl: string, keyPrefix: string): AttemptStore {
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  })

  function scopedKey(key: string): string {
    return `${keyPrefix}:${key}`
  }

  return {
    async getCount(key) {
      const raw = await redis.get(scopedKey(key))
      const count = Number(raw)
      if (!Number.isFinite(count) || count < 0) return 0
      return Math.floor(count)
    },

    async increment(key, ttlMs) {
      const redisKey = scopedKey(key)
      const value = await redis.incr(redisKey)
      if (value === 1) {
        await redis.pexpire(redisKey, ttlMs)
      }
      return value
    },

    async reset(key) {
      await redis.del(scopedKey(key))
    },

    async close() {
      await redis.quit()
    },
  }
}
