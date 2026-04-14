import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import UploadPage from '../src/app/g/[slug]/upload/page.js'

const { getGallery, notFound } = vi.hoisted(() => ({
  getGallery: vi.fn(),
  notFound: vi.fn(),
}))
const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn(),
}))

vi.mock('../src/lib/api.js', () => ({
  getGallery,
  ApiError: class ApiError extends Error {
    constructor(public status: number) {
      super(String(status))
    }
  },
}))

vi.mock('next/navigation', () => ({
  notFound,
  redirect,
}))

vi.mock('../src/components/GuestNav.js', () => ({
  GuestNav: ({ galleryName }: { galleryName: string }) => <div>{galleryName}</div>,
}))

vi.mock('../src/app/g/[slug]/upload/UploadForm.js', () => ({
  UploadForm: ({ gallerySlug }: { gallerySlug: string }) => <div>Form {gallerySlug}</div>,
}))

describe('UploadPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a closed-state message instead of the upload form when uploads are disabled', async () => {
    getGallery.mockResolvedValueOnce({
      id: 'g1',
      name: 'Test Gallery',
      slug: 'test',
      description: null,
      layout: 'MASONRY',
      allowGuestDownload: false,
      guestNameMode: 'OPTIONAL',
      photoCount: 0,
      isActive: false,
      isUploadOpen: false,
      uploadWindows: [
        {
          id: 'w1',
          start: '2035-06-01T12:00:00.000Z',
          end: '2035-06-01T16:00:00.000Z',
          createdAt: '2035-05-01T00:00:00.000Z',
        },
      ],
      data: [],
      pagination: { nextCursor: null, hasMore: false },
    })

    render(await UploadPage({ params: Promise.resolve({ slug: 'test' }) }))

    expect(screen.getByText(/uploads sind zur zeit geschlossen/i)).toBeInTheDocument()
    expect(screen.queryByText(/form test/i)).not.toBeInTheDocument()
  })

  it('redirects to unlock page when gallery requires PIN', async () => {
    getGallery.mockRejectedValueOnce({ status: 401 })

    await UploadPage({ params: Promise.resolve({ slug: 'test' }) })

    expect(redirect).toHaveBeenCalledWith('/g/test/unlock?next=%2Fg%2Ftest%2Fupload')
  })
})
