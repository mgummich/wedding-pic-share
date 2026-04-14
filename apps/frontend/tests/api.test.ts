import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  __resetApiClientStateForTests,
  adminLogin,
  adminUploadFile,
  archiveGallery,
  deletePendingUpload,
  getAdminTwoFactorStatus,
  getGallery,
  setupAdminTwoFactor,
  updateGallery,
  verifyAdminTwoFactor,
  verifyGalleryAccess,
} from '../src/lib/api.js'

describe('api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    __resetApiClientStateForTests()
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
      json: async () => ({ csrfToken: 'csrf-token-1' }),
    } as Response).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'g1',
        name: 'Test',
        slug: 'test',
        description: null,
        layout: 'MASONRY',
        allowGuestDownload: false,
        guestNameMode: 'OPTIONAL',
        stripExif: true,
        photoCount: 0,
        isActive: true,
        isArchived: false,
        archivedAt: null,
        archiveSizeBytes: null,
        isUploadOpen: true,
        uploadWindows: [],
      }),
    } as Response)

    await updateGallery('g1', {
      isActive: true,
      stripExif: false,
      secretKey: '4321',
      uploadWindows: [
        {
          start: '2035-06-01T12:00:00.000Z',
          end: '2035-06-01T16:00:00.000Z',
        },
      ],
    })

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/api/v1/admin/galleries/g1'),
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          'x-csrf-token': 'csrf-token-1',
        }),
        body: JSON.stringify({
          isActive: true,
          stripExif: false,
          secretKey: '4321',
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

  it('verifyGalleryAccess posts pin to unlock gallery', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response)

    await verifyGalleryAccess('party', '2468')

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/g/party/access'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ secretKey: '2468' }),
        credentials: 'include',
      })
    )
  })

  it('deletePendingUpload sends signed token to guest delete endpoint', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response)

    await deletePendingUpload('party', 'photo-1', 'delete-token-1')

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/g/party/uploads/photo-1'),
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ deleteToken: 'delete-token-1' }),
        credentials: 'include',
      })
    )
  })

  it('adminUploadFile posts multipart form data to the admin gallery upload endpoint', async () => {
    const file = new File(['hello'], 'photo.jpg', { type: 'image/jpeg' })
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ csrfToken: 'csrf-token-2' }),
    } as Response).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'photo-1',
        status: 'PENDING',
        mediaType: 'IMAGE',
        thumbUrl: '/thumb.webp',
        duration: null,
      }),
    } as Response)

    const result = await adminUploadFile('gallery-1', file, 'Alex')

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/api/v1/admin/galleries/gallery-1/upload'),
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
        headers: expect.objectContaining({
          'x-csrf-token': 'csrf-token-2',
        }),
        credentials: 'include',
      })
    )
    const [, init] = vi.mocked(fetch).mock.calls[1] ?? []
    expect((init?.body as FormData).get('file')).toBe(file)
    expect((init?.body as FormData).get('guestName')).toBe('Alex')
    expect(result.status).toBe('PENDING')
  })

  it('adminUploadFile supports photographer mode query flag for auto-approval', async () => {
    const file = new File(['hello'], 'photo.jpg', { type: 'image/jpeg' })
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ csrfToken: 'csrf-token-3' }),
    } as Response).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'photo-1',
        status: 'APPROVED',
        mediaType: 'IMAGE',
        thumbUrl: '/thumb.webp',
        duration: null,
      }),
    } as Response)

    await adminUploadFile('gallery-1', file, undefined, { autoApprove: true })

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/api/v1/admin/galleries/gallery-1/upload?mode=photographer'),
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
        headers: expect.objectContaining({
          'x-csrf-token': 'csrf-token-3',
        }),
        credentials: 'include',
      })
    )
  })

  it('archiveGallery posts to archive endpoint', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ csrfToken: 'csrf-token-4' }),
    } as Response).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'g1',
        name: 'Test',
        slug: 'test',
        description: null,
        layout: 'MASONRY',
        allowGuestDownload: false,
        guestNameMode: 'OPTIONAL',
        stripExif: true,
        photoCount: 0,
        isActive: false,
        isArchived: true,
        archivedAt: '2026-04-14T18:00:00.000Z',
        archiveSizeBytes: 1024,
        isUploadOpen: false,
        uploadWindows: [],
      }),
    } as Response)

    const result = await archiveGallery('g1')

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/api/v1/admin/galleries/g1/archive'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-csrf-token': 'csrf-token-4',
        }),
        credentials: 'include',
      })
    )
    expect(result.isArchived).toBe(true)
  })

  it('adminLogin includes optional totpCode when provided', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response)

    await adminLogin('admin', 'Password123!', '123456')

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/admin/login'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          username: 'admin',
          password: 'Password123!',
          totpCode: '123456',
        }),
      })
    )
  })

  it('calls admin 2fa setup, verify, and status endpoints', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ enabled: true, configured: false }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ csrfToken: 'csrf-token-5' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          secret: 'ABCDEF1234',
          otpauthUrl: 'otpauth://totp/Wedding%20Pic%20Share',
          setupToken: 'setup-token',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      } as Response)

    const status = await getAdminTwoFactorStatus()
    expect(status).toEqual({ enabled: true, configured: false })

    const setup = await setupAdminTwoFactor('Password123!')
    expect(setup.setupToken).toBe('setup-token')

    await verifyAdminTwoFactor('123456', 'setup-token')

    const firstCall = vi.mocked(fetch).mock.calls[0]
    const secondCall = vi.mocked(fetch).mock.calls[1]
    const thirdCall = vi.mocked(fetch).mock.calls[2]
    const fourthCall = vi.mocked(fetch).mock.calls[3]

    expect(firstCall?.[0]).toEqual(expect.stringContaining('/api/v1/admin/2fa/status'))
    expect(secondCall?.[0]).toEqual(expect.stringContaining('/api/v1/admin/csrf'))
    expect(thirdCall?.[0]).toEqual(expect.stringContaining('/api/v1/admin/2fa/setup'))
    expect(thirdCall?.[1]).toEqual(expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'x-csrf-token': 'csrf-token-5',
      }),
      body: JSON.stringify({ password: 'Password123!' }),
    }))
    expect(fourthCall?.[0]).toEqual(expect.stringContaining('/api/v1/admin/2fa/verify'))
    expect(fourthCall?.[1]).toEqual(expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'x-csrf-token': 'csrf-token-5',
      }),
      body: JSON.stringify({ code: '123456', setupToken: 'setup-token' }),
    }))
  })
})
