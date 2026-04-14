import { createHmac, timingSafeEqual } from 'crypto'

const DELETE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

type UploadDeleteTokenPayload = {
  photoId: string
  gallerySlug: string
  exp: number
}

function safeEqual(value: string, expected: string): boolean {
  const valueBuffer = Buffer.from(value)
  const expectedBuffer = Buffer.from(expected)
  if (valueBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(valueBuffer, expectedBuffer)
}

export function createUploadDeleteToken(
  payload: Pick<UploadDeleteTokenPayload, 'photoId' | 'gallerySlug'>,
  secret: string
): string {
  const body: UploadDeleteTokenPayload = {
    photoId: payload.photoId,
    gallerySlug: payload.gallerySlug,
    exp: Date.now() + DELETE_TOKEN_TTL_MS,
  }
  const encodedPayload = Buffer.from(JSON.stringify(body)).toString('base64url')
  const signature = createHmac('sha256', secret).update(encodedPayload).digest('base64url')
  return `${encodedPayload}.${signature}`
}

export function readUploadDeleteToken(
  token: string,
  secret: string
): UploadDeleteTokenPayload | null {
  const [encodedPayload, providedSignature] = token.split('.')
  if (!encodedPayload || !providedSignature) return null

  const expectedSignature = createHmac('sha256', secret).update(encodedPayload).digest('base64url')
  if (!safeEqual(providedSignature, expectedSignature)) return null

  let parsed: { photoId?: unknown; gallerySlug?: unknown; exp?: unknown } | null = null
  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
      photoId?: unknown
      gallerySlug?: unknown
      exp?: unknown
    }
  } catch {
    return null
  }

  if (
    !parsed
    || typeof parsed.photoId !== 'string'
    || typeof parsed.gallerySlug !== 'string'
    || typeof parsed.exp !== 'number'
  ) {
    return null
  }

  if (parsed.exp <= Date.now()) return null

  return {
    photoId: parsed.photoId,
    gallerySlug: parsed.gallerySlug,
    exp: parsed.exp,
  }
}
