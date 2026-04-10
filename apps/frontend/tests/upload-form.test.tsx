import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UploadForm } from '../src/app/g/[slug]/upload/UploadForm.js'

vi.mock('../src/lib/api.js', () => ({
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
})
