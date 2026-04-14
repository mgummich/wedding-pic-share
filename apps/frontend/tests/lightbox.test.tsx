import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Lightbox } from '../src/components/Lightbox'
import type { PhotoResponse } from '@wedding/shared'

function makePhoto(id: string): PhotoResponse {
  return {
    id,
    mediaType: 'IMAGE',
    thumbUrl: `/thumb/${id}.webp`,
    displayUrl: `/display/${id}.webp`,
    blurDataUrl: undefined,
    guestName: null,
    duration: null,
    createdAt: new Date().toISOString(),
  } as PhotoResponse
}

function makeVideo(id: string): PhotoResponse {
  return {
    id,
    mediaType: 'VIDEO',
    thumbUrl: `/thumb/${id}.jpg`,
    displayUrl: `/display/${id}.mp4`,
    blurDataUrl: undefined,
    guestName: null,
    duration: 12,
    createdAt: new Date().toISOString(),
  } as PhotoResponse
}

const photos = [makePhoto('p1'), makePhoto('p2'), makePhoto('p3')]

describe('Lightbox', () => {
  const onClose = vi.fn()
  const onNext = vi.fn()
  const onPrev = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the photo at the given index', () => {
    render(<Lightbox photos={photos} index={1} onClose={onClose} onNext={onNext} onPrev={onPrev} />)
    expect(screen.getByRole('img')).toHaveAttribute('src', '/display/p2.webp')
  })

  it('calls onClose when close button is clicked', async () => {
    render(<Lightbox photos={photos} index={0} onClose={onClose} onNext={onNext} onPrev={onPrev} />)
    await userEvent.click(screen.getByRole('button', { name: /schließen/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onNext when next button is clicked', async () => {
    render(<Lightbox photos={photos} index={0} onClose={onClose} onNext={onNext} onPrev={onPrev} />)
    await userEvent.click(screen.getByRole('button', { name: /nächstes/i }))
    expect(onNext).toHaveBeenCalledOnce()
  })

  it('calls onPrev when prev button is clicked', async () => {
    render(<Lightbox photos={photos} index={2} onClose={onClose} onNext={onNext} onPrev={onPrev} />)
    await userEvent.click(screen.getByRole('button', { name: /vorheriges/i }))
    expect(onPrev).toHaveBeenCalledOnce()
  })

  it('hides next button on last photo', () => {
    render(<Lightbox photos={photos} index={2} onClose={onClose} onNext={onNext} onPrev={onPrev} />)
    expect(screen.queryByRole('button', { name: /nächstes/i })).toBeNull()
  })

  it('hides prev button on first photo', () => {
    render(<Lightbox photos={photos} index={0} onClose={onClose} onNext={onNext} onPrev={onPrev} />)
    expect(screen.queryByRole('button', { name: /vorheriges/i })).toBeNull()
  })

  it('calls onClose on Escape key', () => {
    render(<Lightbox photos={photos} index={0} onClose={onClose} onNext={onNext} onPrev={onPrev} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onNext on ArrowRight key', () => {
    render(<Lightbox photos={photos} index={0} onClose={onClose} onNext={onNext} onPrev={onPrev} />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onNext).toHaveBeenCalledOnce()
  })

  it('calls onPrev on ArrowLeft key', () => {
    render(<Lightbox photos={photos} index={2} onClose={onClose} onNext={onNext} onPrev={onPrev} />)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(onPrev).toHaveBeenCalledOnce()
  })

  it('does not call onNext on ArrowRight when on last photo', () => {
    render(<Lightbox photos={photos} index={2} onClose={onClose} onNext={onNext} onPrev={onPrev} />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onNext).not.toHaveBeenCalled()
  })

  it('does not call onPrev on ArrowLeft when on first photo', () => {
    render(<Lightbox photos={photos} index={0} onClose={onClose} onNext={onNext} onPrev={onPrev} />)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(onPrev).not.toHaveBeenCalled()
  })

  it('shows download link when allowDownload is true', () => {
    render(<Lightbox photos={photos} index={1} onClose={onClose} onNext={onNext} onPrev={onPrev} allowDownload />)
    expect(screen.getByRole('link', { name: /herunterladen/i })).toBeInTheDocument()
  })

  it('does not show download link when allowDownload is false', () => {
    render(<Lightbox photos={photos} index={1} onClose={onClose} onNext={onNext} onPrev={onPrev} />)
    expect(screen.queryByRole('link', { name: /herunterladen/i })).toBeNull()
  })

  it('renders video media with native controls', () => {
    render(
      <Lightbox
        photos={[makeVideo('v1')]}
        index={0}
        onClose={onClose}
        onNext={onNext}
        onPrev={onPrev}
      />
    )

    const video = document.body.querySelector('video') as HTMLVideoElement | null
    expect(video).not.toBeNull()
    expect(video?.controls).toBe(true)
    expect(video).toHaveAttribute('src', '/display/v1.mp4')
  })
})
