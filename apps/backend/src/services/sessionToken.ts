import { createHash, randomBytes } from 'node:crypto'

export function createSessionToken(): string {
  // 256-bit random token set as httpOnly cookie value.
  return randomBytes(32).toString('hex')
}

export function hashSessionToken(token: string): string {
  // Persist only the hash in DB (plaintext only lives in the cookie).
  return createHash('sha256').update(token).digest('hex')
}
