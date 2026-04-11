import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GuestNavClient } from '../src/components/GuestNavClient'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
}))

import { usePathname } from 'next/navigation'

describe('GuestNavClient', () => {
  it('renders all three nav links', () => {
    vi.mocked(usePathname).mockReturnValue('/g/test-slug')
    render(<GuestNavClient gallerySlug="test-slug" />)
    expect(screen.getByRole('link', { name: /galerie/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /hochladen/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /slideshow/i })).toBeInTheDocument()
  })

  it('links point to the correct slug URLs', () => {
    vi.mocked(usePathname).mockReturnValue('/g/my-wedding')
    render(<GuestNavClient gallerySlug="my-wedding" />)
    expect(screen.getByRole('link', { name: /galerie/i })).toHaveAttribute('href', '/g/my-wedding')
    expect(screen.getByRole('link', { name: /hochladen/i })).toHaveAttribute('href', '/g/my-wedding/upload')
    expect(screen.getByRole('link', { name: /slideshow/i })).toHaveAttribute('href', '/g/my-wedding/slideshow')
  })

  it('highlights the gallery link when on the gallery page', () => {
    vi.mocked(usePathname).mockReturnValue('/g/test-slug')
    render(<GuestNavClient gallerySlug="test-slug" />)
    expect(screen.getByRole('link', { name: /galerie/i })).toHaveClass('text-accent')
    expect(screen.getByRole('link', { name: /hochladen/i })).not.toHaveClass('text-accent')
  })

  it('highlights the upload link when on the upload page', () => {
    vi.mocked(usePathname).mockReturnValue('/g/test-slug/upload')
    render(<GuestNavClient gallerySlug="test-slug" />)
    expect(screen.getByRole('link', { name: /hochladen/i })).toHaveClass('text-accent')
    expect(screen.getByRole('link', { name: /galerie/i })).not.toHaveClass('text-accent')
  })

  it('highlights the slideshow link when on the slideshow page', () => {
    vi.mocked(usePathname).mockReturnValue('/g/test-slug/slideshow')
    render(<GuestNavClient gallerySlug="test-slug" />)
    expect(screen.getByRole('link', { name: /slideshow/i })).toHaveClass('text-accent')
  })
})
