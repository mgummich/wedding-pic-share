import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import { createAttemptStore } from '../services/attemptStore.js'

const IP_BLOCK_THRESHOLD = 15
const IP_BLOCK_DURATION_MS = 15 * 60 * 1000
const PIN_BLOCK_THRESHOLD = 10
const PIN_BLOCK_DURATION_MS = 15 * 60 * 1000

declare module 'fastify' {
  interface FastifyInstance {
    checkIpBlocked: (ip: string) => Promise<boolean>
    recordIpFailure: (ip: string) => Promise<void>
    resetIpFailures: (ip: string) => Promise<void>
    checkPinBlocked: (ip: string, slug: string) => Promise<boolean>
    recordPinFailure: (ip: string, slug: string) => Promise<void>
    resetPinFailures: (ip: string, slug: string) => Promise<void>
  }
}

export const bruteForcePlugin = fp(async (fastify: FastifyInstance) => {
  const store = createAttemptStore({
    redisUrl: fastify.config.redisUrl,
    keyPrefix: 'wps:attempts',
  })

  function pinKey(ip: string, slug: string): string {
    return `pin:${ip}:${slug}`
  }

  fastify.decorate('checkIpBlocked', async (ip: string) => {
    const count = await store.getCount(`ip:${ip}`)
    return count >= IP_BLOCK_THRESHOLD
  })

  fastify.decorate('recordIpFailure', async (ip: string) => {
    await store.increment(`ip:${ip}`, IP_BLOCK_DURATION_MS)
  })

  fastify.decorate('resetIpFailures', async (ip: string) => {
    await store.reset(`ip:${ip}`)
  })

  fastify.decorate('checkPinBlocked', async (ip: string, slug: string) => {
    const count = await store.getCount(pinKey(ip, slug))
    return count >= PIN_BLOCK_THRESHOLD
  })

  fastify.decorate('recordPinFailure', async (ip: string, slug: string) => {
    await store.increment(pinKey(ip, slug), PIN_BLOCK_DURATION_MS)
  })

  fastify.decorate('resetPinFailures', async (ip: string, slug: string) => {
    await store.reset(pinKey(ip, slug))
  })

  fastify.addHook('onClose', async () => {
    await store.close()
  })
})
