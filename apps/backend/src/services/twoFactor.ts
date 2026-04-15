import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { generateSecret, generateURI, verifySync } from 'otplib'

// Secrets and setup tokens are encrypted at rest/in transit using AES-256-GCM.
// Format: version:iv:authTag:ciphertext (hex-encoded parts).
const AES_ALGO = 'aes-256-gcm'
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16

export type TotpSetupTokenPayload = {
  secret: string
  userId: string
  nonce: string
  exp: number
}

function getKeyBuffer(keyHex: string): Buffer {
  const key = Buffer.from(keyHex, 'hex')
  if (key.length !== 32) {
    throw new Error('invalid-2fa-key')
  }
  return key
}

function encryptRaw(plain: string, keyHex: string): string {
  const key = getKeyBuffer(keyHex)
  // 96-bit IV per message is required for safe GCM usage.
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(AES_ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

function decryptRaw(token: string, keyHex: string): string {
  const key = getKeyBuffer(keyHex)
  const [ivHex, tagHex, encryptedHex] = token.split(':')
  if (!ivHex || !tagHex || !encryptedHex) {
    throw new Error('invalid-2fa-token-format')
  }

  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const encrypted = Buffer.from(encryptedHex, 'hex')
  if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES || encrypted.length < 1) {
    throw new Error('invalid-2fa-token-format')
  }

  const decipher = createDecipheriv(AES_ALGO, key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8')
}

export function encryptTotpSecret(secret: string, keyHex: string): string {
  // Stored in AdminUser.totpSecretEncrypted.
  return `v1:${encryptRaw(secret, keyHex)}`
}

export function decryptTotpSecret(encryptedSecret: string, keyHex: string): string {
  if (!encryptedSecret.startsWith('v1:')) {
    throw new Error('invalid-2fa-secret-version')
  }
  return decryptRaw(encryptedSecret.slice(3), keyHex)
}

export function createTotpSetupToken(
  payload: Pick<TotpSetupTokenPayload, 'secret' | 'userId'>,
  keyHex: string,
  ttlMs = 10 * 60 * 1000
): string {
  // Nonce prevents setup-token replay after successful verification.
  const fullPayload: TotpSetupTokenPayload = {
    secret: payload.secret,
    userId: payload.userId,
    nonce: randomBytes(16).toString('hex'),
    exp: Date.now() + ttlMs,
  }
  const rawPayload = JSON.stringify({
    secret: fullPayload.secret,
    userId: fullPayload.userId,
    nonce: fullPayload.nonce,
    exp: fullPayload.exp,
  })
  return `setup-v1:${encryptRaw(rawPayload, keyHex)}`
}

export function readTotpSetupToken(token: string, keyHex: string): TotpSetupTokenPayload {
  // Decrypt + structural validation + expiry validation.
  if (!token.startsWith('setup-v1:')) {
    throw new Error('invalid-2fa-setup-token-version')
  }
  const payload = decryptRaw(token.slice('setup-v1:'.length), keyHex)
  const parsed = JSON.parse(payload) as {
    secret?: unknown
    userId?: unknown
    nonce?: unknown
    exp?: unknown
  }
  if (
    typeof parsed.secret !== 'string' ||
    typeof parsed.userId !== 'string' ||
    typeof parsed.nonce !== 'string' ||
    typeof parsed.exp !== 'number'
  ) {
    throw new Error('invalid-2fa-setup-token-payload')
  }
  if (Date.now() > parsed.exp) {
    throw new Error('expired-2fa-setup-token')
  }
  return {
    secret: parsed.secret,
    userId: parsed.userId,
    nonce: parsed.nonce,
    exp: parsed.exp,
  }
}

export function generateTotpSecret(): string {
  return generateSecret()
}

export function buildTotpOtpAuthUrl(secret: string, accountName: string, issuer = 'Wedding Pic Share'): string {
  return generateURI({
    strategy: 'totp',
    issuer,
    label: accountName,
    secret,
    digits: 6,
    period: 30,
  })
}

export function verifyTotpCode(secret: string, code: string): boolean {
  const normalized = code.replace(/\s+/g, '')
  const result = verifySync({
    strategy: 'totp',
    secret,
    token: normalized,
    digits: 6,
    period: 30,
    epochTolerance: 30,
  })
  return result.valid
}
