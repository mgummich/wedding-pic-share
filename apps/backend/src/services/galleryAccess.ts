import { createHash, createHmac, timingSafeEqual } from 'crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'

const ACCESS_COOKIE_PREFIX = 'gallery_access_'
const ACCESS_TOKEN_TTL_MS = 12 * 60 * 60 * 1000
const ACCESS_COOKIE_MAX_AGE_SECONDS = Math.floor(ACCESS_TOKEN_TTL_MS / 1000)

type GalleryAccessTarget = {
  slug: string
  secretKey: string | null
}

function safeEqual(value: string, expected: string): boolean {
  const valueBuffer = Buffer.from(value)
  const expectedBuffer = Buffer.from(expected)
  if (valueBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(valueBuffer, expectedBuffer)
}

export function galleryAccessCookieName(slug: string): string {
  return `${ACCESS_COOKIE_PREFIX}${slug}`
}

export function hasGalleryAccess(
  req: FastifyRequest,
  gallery: GalleryAccessTarget,
  sessionSecret: string
): boolean {
  // Public galleries bypass cookie-based access checks.
  if (!gallery.secretKey) return true
  const cookieValue = req.cookies[galleryAccessCookieName(gallery.slug)]
  if (!cookieValue) return false
  const [encodedPayload, encodedSignature] = cookieValue.split('.')
  if (!encodedPayload || !encodedSignature) return false

  // HMAC binds payload integrity to server-side secret and prevents tampering.
  const expectedSignature = createHmac('sha256', sessionSecret)
    .update(encodedPayload)
    .digest('base64url')
  if (!safeEqual(encodedSignature, expectedSignature)) return false

  let payload: { slug?: string; exp?: number; keyDigest?: string } | null = null
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
      slug?: string
      exp?: number
      keyDigest?: string
    }
  } catch {
    return false
  }

  if (!payload || payload.slug !== gallery.slug) return false
  if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) return false

  // Hash of the current gallery key revokes old cookies after PIN rotation.
  const currentDigest = createHash('sha256')
    .update(gallery.secretKey)
    .digest('base64url')
  return typeof payload.keyDigest === 'string' && safeEqual(payload.keyDigest, currentDigest)
}

export function setGalleryAccessCookie(
  reply: FastifyReply,
  gallery: GalleryAccessTarget,
  cookieSecure: boolean,
  sessionSecret: string
): void {
  if (!gallery.secretKey) return
  // Key digest allows stateless invalidation when gallery.secretKey changes.
  const payload = {
    slug: gallery.slug,
    exp: Date.now() + ACCESS_TOKEN_TTL_MS,
    keyDigest: createHash('sha256').update(gallery.secretKey).digest('base64url'),
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const encodedSignature = createHmac('sha256', sessionSecret)
    .update(encodedPayload)
    .digest('base64url')
  const token = `${encodedPayload}.${encodedSignature}`

  reply.setCookie(galleryAccessCookieName(gallery.slug), token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: cookieSecure,
    maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS,
    path: '/',
  })
}
