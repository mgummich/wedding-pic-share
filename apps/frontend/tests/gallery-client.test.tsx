import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GalleryClient } from '../src/app/g/[slug]/GalleryClient'
import { getGallery } from '../src/lib/api'

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual('../src/lib/api')
  return {
    ...actual,
    getGallery: vi.fn(),
  }
})

vi.mock('../src/lib/sse', () => ({
  useSSE: vi.fn(),
}))

vi.mock('../src/components/PhotoGrid', () => ({
  PhotoGrid: () => <div data-testid="photo-grid" />,
}))

vi.mock('../src/components/UploadButton', () => ({
  UploadButton: () => <button type="button">Upload</button>,
}))

vi.mock('../src/components/EmptyState', () => ({
  EmptyState: ({ title }: { title: string }) => <p>{title}</p>,
}))

vi.mock('../src/components/Lightbox', () => ({
  Lightbox: () => <div data-testid="lightbox" />,
}))

const gallery = {
  id: 'gallery-1',
  name: 'Main Gallery',
  slug: 'main-gallery',
  description: null,
  layout: 'MASONRY' as const,
  allowGuestDownload: false,
  stripExif: true,
  photoCount: 1,
  guestNameMode: 'OPTIONAL' as const,
  isActive: false,
  isArchived: false,
  archivedAt: null,
  archiveSizeBytes: null,
  isUploadOpen: true,
  uploadWindows: [],
}

const photo = {
  id: 'p1',
  mediaType: 'IMAGE' as const,
  thumbUrl: '/thumb/p1.webp',
  displayUrl: '/display/p1.webp',
  blurDataUrl: undefined,
  guestName: null,
  duration: null,
  createdAt: new Date().toISOString(),
}

describe('GalleryClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows an error when load-more fails', async () => {
    vi.mocked(getGallery).mockRejectedValueOnce(new TypeError('network'))

    const user = userEvent.setup()
    render(
      <GalleryClient
        gallery={gallery}
        initialPhotos={[photo]}
        initialCursor="cursor-1"
        initialHasMore
      />
    )

    await user.click(screen.getByRole('button', { name: /mehr laden/i }))

    expect(await screen.findByText(/mehr laden fehlgeschlagen/i)).toBeInTheDocument()
  })
})
