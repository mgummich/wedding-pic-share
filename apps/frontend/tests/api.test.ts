import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getGallery, uploadFile } from '../src/lib/api.js'

describe('api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('getGallery builds correct URL and returns parsed JSON', async () => {
    const mockResponse = {
      id: 'g1',
      name: 'Test',
      slug: 'test',
      data: [],
      pagination: { nextCursor: null, hasMore: false },
    }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response)

    const result = await getGallery('test')
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/g/test'),
      expect.any(Object)
    )
    expect(result.name).toBe('Test')
  })

  it('getGallery passes cursor param when provided', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], pagination: { nextCursor: null, hasMore: false } }),
    } as Response)

    await getGallery('test', { cursor: 'abc123' })
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('cursor=abc123'),
      expect.any(Object)
    )
  })

  it('throws on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ type: 'gallery-not-found' }),
    } as Response)

    await expect(getGallery('not-found')).rejects.toThrow('404')
  })
})
