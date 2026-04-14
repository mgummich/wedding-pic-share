import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ImgHTMLAttributes } from 'react'
import ModerationPage from '../src/app/admin/galleries/[id]/moderate/page'
import { getAdminPhotos, moderatePhoto, batchModerate, ApiError } from '../src/lib/api'

const { replace } = vi.hoisted(() => ({
  replace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useParams: () => ({ id: 'gallery-1' }),
}))

vi.mock('next/image', () => ({
  default: ({ alt, ...props }: ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => {
    const { unoptimized: _unoptimized, ...rest } = props
    return <img alt={alt} {...rest} />
  },
}))

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual('../src/lib/api')
  return {
    ...actual,
    getAdminPhotos: vi.fn(),
    moderatePhoto: vi.fn(),
    batchModerate: vi.fn(),
  }
})

function photo(id: string, guestName: string) {
  return {
    id,
    mediaType: 'IMAGE' as const,
    thumbUrl: `/thumb/${id}.webp`,
    displayUrl: `/display/${id}.webp`,
    blurDataUrl: undefined,
    guestName,
    duration: null,
    createdAt: new Date().toISOString(),
    status: 'PENDING' as const,
    rejectionReason: null,
  }
}

function renderPage() {
  return render(<ModerationPage />)
}

describe('ModerationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAdminPhotos).mockResolvedValue({
      data: [],
      pagination: { nextCursor: null, hasMore: false },
    })
    vi.mocked(moderatePhoto).mockResolvedValue(photo('noop', 'noop'))
    vi.mocked(batchModerate).mockResolvedValue({ processed: 0, failed: [] })
  })

  it('shows load error on non-401 API failures', async () => {
    vi.mocked(getAdminPhotos).mockRejectedValue(new ApiError(500, {}, '500'))

    renderPage()

    expect(await screen.findByText(/ausstehende fotos konnten nicht geladen werden/i)).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it('shows an error and keeps the photo when moderation fails', async () => {
    vi.mocked(getAdminPhotos).mockResolvedValue({
      data: [photo('p1', 'Anna')],
      pagination: { nextCursor: null, hasMore: false },
    })
    vi.mocked(moderatePhoto).mockRejectedValue(new ApiError(500, {}, '500'))

    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('Anna')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^freigeben$/i }))

    expect(await screen.findByText(/aktion fehlgeschlagen/i)).toBeInTheDocument()
    expect(screen.getByText('Anna')).toBeInTheDocument()
  })

  it('removes a photo from the queue after successful moderation', async () => {
    vi.mocked(getAdminPhotos).mockResolvedValue({
      data: [photo('p1', 'Anna')],
      pagination: { nextCursor: null, hasMore: false },
    })
    vi.mocked(moderatePhoto).mockResolvedValue(photo('p1', 'Anna'))

    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('Anna')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^freigeben$/i }))

    await waitFor(() => {
      expect(moderatePhoto).toHaveBeenCalledWith('p1', { status: 'APPROVED' })
    })
    expect(screen.queryByText(/aktion fehlgeschlagen/i)).not.toBeInTheDocument()
  })

  it('clears the queue when approve-all succeeds without failed ids', async () => {
    vi.mocked(getAdminPhotos).mockResolvedValue({
      data: [photo('p1', 'Anna'), photo('p2', 'Ben')],
      pagination: { nextCursor: null, hasMore: false },
    })
    vi.mocked(batchModerate).mockResolvedValue({ processed: 2, failed: [] })

    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('Anna')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /alle freigeben/i }))

    await waitFor(() => {
      expect(batchModerate).toHaveBeenCalledWith({ action: 'approve', photoIds: ['p1', 'p2'] })
    })
    expect(screen.queryByText(/aktion fehlgeschlagen/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/konnten nicht freigegeben werden/i)).not.toBeInTheDocument()
  })

  it('shows partial-batch feedback and sends all ids on approve-all', async () => {
    vi.mocked(getAdminPhotos).mockResolvedValue({
      data: [photo('p1', 'Anna'), photo('p2', 'Ben')],
      pagination: { nextCursor: null, hasMore: false },
    })
    vi.mocked(batchModerate).mockResolvedValue({ processed: 1, failed: ['p2'] })

    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('Anna')).toBeInTheDocument()
    expect(screen.getByText('Ben')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /alle freigeben/i }))

    await waitFor(() => {
      expect(batchModerate).toHaveBeenCalledWith({ action: 'approve', photoIds: ['p1', 'p2'] })
      expect(screen.getByText(/1 foto\(s\) konnten nicht freigegeben werden\./i)).toBeInTheDocument()
      expect(screen.getByText('Ben')).toBeInTheDocument()
    })
  })
})
