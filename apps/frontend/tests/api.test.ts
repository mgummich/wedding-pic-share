import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getGallery, updateGallery } from '../src/lib/api.js'

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

  it('updateGallery sends active state and upload windows', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'g1',
        name: 'Test',
        slug: 'test',
        description: null,
        layout: 'MASONRY',
        allowGuestDownload: false,
        guestNameMode: 'OPTIONAL',
        photoCount: 0,
        isActive: true,
        isUploadOpen: true,
        uploadWindows: [],
      }),
    } as Response)

    await updateGallery('g1', {
      isActive: true,
      uploadWindows: [
        {
          start: '2035-06-01T12:00:00.000Z',
          end: '2035-06-01T16:00:00.000Z',
        },
      ],
    })

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/admin/galleries/g1'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          isActive: true,
          uploadWindows: [
            {
              start: '2035-06-01T12:00:00.000Z',
              end: '2035-06-01T16:00:00.000Z',
            },
          ],
        }),
      })
    )
  })
})
