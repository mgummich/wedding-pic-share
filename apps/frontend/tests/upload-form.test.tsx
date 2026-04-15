import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UploadForm } from '../src/app/g/[slug]/upload/UploadForm.js'
import { uploadFile, deletePendingUpload, ApiError } from '../src/lib/api.js'

const { replace } = vi.hoisted(() => ({
  replace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}))

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
    deleteToken: 'delete-token-1',
  }),
  deletePendingUpload: vi.fn().mockResolvedValue(undefined),
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
      deleteToken: 'delete-token-1',
    }
  }

  beforeEach(() => {
    vi.mocked(uploadFile).mockReset()
    vi.mocked(deletePendingUpload).mockReset()
    vi.mocked(uploadFile).mockResolvedValue(createUploadResponse('photo-1'))
    vi.mocked(deletePendingUpload).mockResolvedValue(undefined)
    replace.mockReset()
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

  it('uploads multiple files in parallel', async () => {
    const resolvers: Array<(value: ReturnType<typeof createUploadResponse>) => void> = []
    vi.mocked(uploadFile).mockImplementation(() => new Promise((resolve) => {
      resolvers.push(resolve as (value: ReturnType<typeof createUploadResponse>) => void)
    }))

    const user = userEvent.setup()
    render(<UploadForm {...defaultProps} />)

    const input = screen.getByLabelText(/fotos/i)
    const first = new File(['one'], 'one.png', { type: 'image/png' })
    const second = new File(['two'], 'two.png', { type: 'image/png' })
    await user.upload(input, [first, second])
    await user.click(screen.getByRole('button', { name: /hochladen/i }))

    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(2))
    resolvers[0](createUploadResponse('photo-1'))
    resolvers[1](createUploadResponse('photo-2'))

    expect(await screen.findByRole('heading', { name: /danke/i })).toBeInTheDocument()
  })

  it('validates guest name length before upload starts', async () => {
    const user = userEvent.setup()
    render(<UploadForm {...defaultProps} />)

    const input = screen.getByLabelText(/fotos/i)
    const file = new File(['x'], 'guestname.png', { type: 'image/png' })
    await user.upload(input, file)
    fireEvent.change(screen.getByLabelText(/dein name/i), { target: { value: 'x'.repeat(81) } })
    await user.click(screen.getByRole('button', { name: /hochladen/i }))

    expect(await screen.findByText(/maximal 80 zeichen/i)).toBeInTheDocument()
    expect(uploadFile).not.toHaveBeenCalled()
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

  it('allows deleting a pending uploaded file', async () => {
    vi.mocked(uploadFile).mockResolvedValueOnce(createUploadResponse('photo-pending'))

    const user = userEvent.setup()
    render(<UploadForm {...defaultProps} />)

    const input = screen.getByLabelText(/fotos/i)
    const file = new File(['x'], 'pending.png', { type: 'image/png' })
    await user.upload(input, file)
    await user.click(screen.getByRole('button', { name: /hochladen/i }))

    const deleteButton = await screen.findByRole('button', { name: /upload löschen/i })
    await user.click(deleteButton)

    expect(deletePendingUpload).toHaveBeenCalledTimes(1)
    expect(deletePendingUpload).toHaveBeenCalledWith('test', 'photo-pending', 'delete-token-1')
    expect(screen.queryByText('pending.png')).not.toBeInTheDocument()
  })
})
