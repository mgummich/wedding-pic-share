type ErrorWithCode = {
  code?: unknown
}

export function isPrismaNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  return (error as ErrorWithCode).code === 'P2025'
}
