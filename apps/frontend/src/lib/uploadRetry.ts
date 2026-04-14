import { ApiError } from './api'

type RetrySuccess<T> = {
  ok: true
  value: T
  attempts: number
}

type RetryFailure = {
  ok: false
  error: unknown
  attempts: number
}

type RetryResult<T> = RetrySuccess<T> | RetryFailure

type RetryOptions<T> = {
  operation: () => Promise<T> | T
  shouldRetry: (error: unknown) => boolean
  maxAttempts: number
  backoffMs: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isTransientUploadError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status >= 500
  }
  return true
}

async function runWithRetry<T>({
  operation,
  shouldRetry,
  maxAttempts,
  backoffMs,
}: RetryOptions<T>): Promise<RetryResult<T>> {
  let attempts = 0

  while (attempts < maxAttempts) {
    attempts += 1

    try {
      const value = await operation()
      return { ok: true, value, attempts }
    } catch (error) {
      if (attempts >= maxAttempts || !shouldRetry(error)) {
        return { ok: false, error, attempts }
      }

      await sleep(backoffMs)
    }
  }

  return { ok: false, error: new Error('unreachable'), attempts }
}

export { isTransientUploadError, runWithRetry }
