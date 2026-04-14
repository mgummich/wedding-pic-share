import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UploadForm } from '../src/app/g/[slug]/upload/UploadForm.js'
import { uploadFile, ApiError } from '../src/lib/api.js'

vi.mock('../src/lib/api.js', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public body: unknown,
      message: string
    ) {
      super(message)
    }
  },
  uploadFile: vi.fn().mockResolvedValue({
    id: 'photo-1',
    status: 'PENDING',
    mediaType: 'IMAGE',
    thumbUrl: '/thumb.webp',
    duration: null,
  }),
  getGallery: vi.fn().mockResolvedValue({
    id: 'g1',
    name: 'Test Gallery',
    slug: 'test',
    guestNameMode: 'OPTIONAL',
    description: null,
    layout: 'MASONRY',
    allowGuestDownload: false,
    photoCount: 0,
  }),
}))

describe('UploadForm', () => {
  const defaultProps = {
    gallerySlug: 'test',
    guestNameMode: 'OPTIONAL' as const,
  }

  function createUploadResponse(id: string) {
    return {
      id,
      status: 'PENDING' as const,
      mediaType: 'IMAGE' as const,
      thumbUrl: '/thumb.webp',
      duration: null,
    }
  }

  beforeEach(() => {
    vi.mocked(uploadFile).mockReset()
    vi.mocked(uploadFile).mockResolvedValue(createUploadResponse('photo-1'))
  })

  it('renders file input and submit button', () => {
    render(<UploadForm {...defaultProps} />)
    expect(screen.getByLabelText(/fotos/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /hochladen/i })).toBeInTheDocument()
  })

  it('shows guest name field when guestNameMode is OPTIONAL', () => {
    render(<UploadForm {...defaultProps} />)
    expect(screen.getByLabelText(/dein name/i)).toBeInTheDocument()
  })

  it('hides guest name field when guestNameMode is HIDDEN', () => {
    render(<UploadForm {...defaultProps} guestNameMode="HIDDEN" />)
    expect(screen.queryByLabelText(/dein name/i)).not.toBeInTheDocument()
  })

  it('shows error when no file is selected and form is submitted', async () => {
    render(<UploadForm {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /hochladen/i }))
    expect(await screen.findByText(/bitte.*datei/i)).toBeInTheDocument()
  })

  it('auto-retries transient errors and succeeds', async () => {
    vi.mocked(uploadFile)
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(createUploadResponse('photo-1'))

    const user = userEvent.setup()
    render(<UploadForm {...defaultProps} />)

    const input = screen.getByLabelText(/fotos/i)
    const file = new File(['x'], 'retry.png', { type: 'image/png' })
    await user.upload(input, file)
    await user.click(screen.getByRole('button', { name: /hochladen/i }))

    expect(await screen.findByRole('heading', { name: /danke/i })).toBeInTheDocument()
    expect(uploadFile).toHaveBeenCalledTimes(2)
  })

  it('does not auto-retry 409 and shows manual retry button', async () => {
    vi.mocked(uploadFile).mockRejectedValueOnce(new ApiError(409, {}, '409'))

    const user = userEvent.setup()
    render(<UploadForm {...defaultProps} />)

    const input = screen.getByLabelText(/fotos/i)
    const file = new File(['x'], 'duplicate.png', { type: 'image/png' })
    await user.upload(input, file)
    await user.click(screen.getByRole('button', { name: /hochladen/i }))

    expect(await screen.findByText(/bereits hochgeladen/i)).toBeInTheDocument()
    expect(uploadFile).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /erneut versuchen/i })).toBeInTheDocument()
  })

  it('manual retry only retries failed file and can complete submission', async () => {
    vi.mocked(uploadFile)
      .mockResolvedValueOnce(createUploadResponse('photo-good'))
      .mockRejectedValueOnce(new ApiError(409, {}, '409'))
      .mockResolvedValueOnce(createUploadResponse('photo-retried'))

    const user = userEvent.setup()
    render(<UploadForm {...defaultProps} />)

    const input = screen.getByLabelText(/fotos/i)
    const goodFile = new File(['ok'], 'good.png', { type: 'image/png' })
    const badFile = new File(['bad'], 'bad.png', { type: 'image/png' })
    await user.upload(input, [goodFile, badFile])
    await user.click(screen.getByRole('button', { name: /hochladen/i }))

    expect(await screen.findByRole('button', { name: /erneut versuchen/i })).toBeInTheDocument()
    expect(uploadFile).toHaveBeenCalledTimes(2)

    await user.click(screen.getByRole('button', { name: /erneut versuchen/i }))

    expect(uploadFile).toHaveBeenCalledTimes(3)
    expect(vi.mocked(uploadFile).mock.calls[2]?.[1]).toBe(badFile)
    expect(await screen.findByRole('heading', { name: /danke/i })).toBeInTheDocument()
  })
})
