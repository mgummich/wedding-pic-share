import { describe, it, expect, vi, afterEach } from 'vitest'
import { ApiError } from '../src/lib/api.js'
import { isTransientUploadError, runWithRetry } from '../src/lib/uploadRetry.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('isTransientUploadError', () => {
  it('returns true for 5xx ApiError responses', () => {
    expect(isTransientUploadError(new ApiError(500, {}, 'server error'))).toBe(true)
  })

  it('returns false for 4xx ApiError responses', () => {
    expect(isTransientUploadError(new ApiError(400, {}, 'bad request'))).toBe(false)
  })

  it('returns true for network TypeError failures', () => {
    expect(isTransientUploadError(new TypeError('fetch failed'))).toBe(true)
  })

  it('returns false for generic non-ApiError errors', () => {
    expect(isTransientUploadError(new Error('application failure'))).toBe(false)
  })
})

describe('runWithRetry', () => {
  it('retries transient failure and succeeds', async () => {
    vi.useFakeTimers()

    let attempts = 0
    const resultPromise = runWithRetry({
      operation: async () => {
        attempts += 1
        if (attempts < 3) {
          throw new TypeError('temporary failure')
        }
        return 'ok'
      },
      shouldRetry: isTransientUploadError,
      maxAttempts: 3,
      backoffMs: [10, 20],
    })

    await vi.runAllTimersAsync()

    await expect(resultPromise).resolves.toEqual({
      ok: true,
      value: 'ok',
      attempts: 3,
    })
    expect(attempts).toBe(3)
  })

  it('waits for the configured backoff before retrying', async () => {
    vi.useFakeTimers()

    let attempts = 0
    const resultPromise = runWithRetry({
      operation: async () => {
        attempts += 1
        if (attempts < 2) {
          throw new TypeError('temporary failure')
        }
        return 'ok'
      },
      shouldRetry: isTransientUploadError,
      maxAttempts: 2,
      backoffMs: [50],
    })

    await vi.advanceTimersByTimeAsync(49)
    expect(attempts).toBe(1)

    await vi.advanceTimersByTimeAsync(1)
    await expect(resultPromise).resolves.toEqual({
      ok: true,
      value: 'ok',
      attempts: 2,
    })
    expect(attempts).toBe(2)
  })

  it('stops after max attempts for transient failures', async () => {
    vi.useFakeTimers()

    let attempts = 0
    const resultPromise = runWithRetry({
      operation: async () => {
        attempts += 1
        throw new TypeError('temporary failure')
      },
      shouldRetry: isTransientUploadError,
      maxAttempts: 3,
      backoffMs: [10, 20],
    })

    await vi.runAllTimersAsync()

    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      attempts: 3,
    })
    expect(attempts).toBe(3)
  })

  it('does not auto-retry non-transient failures', async () => {
    const result = await runWithRetry({
      operation: async () => {
        throw new ApiError(400, {}, 'bad request')
      },
      shouldRetry: isTransientUploadError,
      maxAttempts: 3,
      backoffMs: [10],
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.attempts).toBe(1)
      expect(result.error).toBeInstanceOf(ApiError)
    }
  })

  it('uses the last backoff value when retries exceed the array length', async () => {
    vi.useFakeTimers()

    let attempts = 0
    const resultPromise = runWithRetry({
      operation: async () => {
        attempts += 1
        if (attempts < 3) {
          throw new TypeError('temporary failure')
        }
        return 'ok'
      },
      shouldRetry: isTransientUploadError,
      maxAttempts: 3,
      backoffMs: [25],
    })

    await vi.advanceTimersByTimeAsync(24)
    expect(attempts).toBe(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(attempts).toBe(2)

    await vi.advanceTimersByTimeAsync(24)
    expect(attempts).toBe(2)

    await vi.advanceTimersByTimeAsync(1)
    await expect(resultPromise).resolves.toEqual({
      ok: true,
      value: 'ok',
      attempts: 3,
    })
    expect(attempts).toBe(3)
  })
})
