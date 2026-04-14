import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminUploadPanel } from '../src/components/AdminUploadPanel.js'
import { adminUploadFile } from '../src/lib/api.js'

vi.mock('../src/lib/api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api.js')>()
  return {
    ...actual,
    adminUploadFile: vi.fn(),
  }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('AdminUploadPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uploads queued files sequentially and refreshes approved photos once', async () => {
    const user = userEvent.setup()
    const first = deferred<{
      id: string
      status: 'APPROVED'
      mediaType: 'IMAGE'
      thumbUrl: string
      duration: null
    }>()
    const second = deferred<{
      id: string
      status: 'PENDING'
      mediaType: 'IMAGE'
      thumbUrl: string
      duration: null
    }>()
    const onApprovedUploads = vi.fn().mockResolvedValue(undefined)

    vi.mocked(adminUploadFile)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)

    render(
      <AdminUploadPanel
        galleryId="gallery-1"
        guestNameMode="OPTIONAL"
        onApprovedUploads={onApprovedUploads}
      />
    )

    const input = screen.getByLabelText(/dateien auswählen/i)
    const fileA = new File(['a'], 'a.jpg', { type: 'image/jpeg' })
    const fileB = new File(['b'], 'b.jpg', { type: 'image/jpeg' })
    await user.upload(input, [fileA, fileB])
    await user.click(screen.getByRole('button', { name: /uploads starten/i }))

    await waitFor(() => {
      expect(adminUploadFile).toHaveBeenCalledTimes(1)
      expect(adminUploadFile).toHaveBeenNthCalledWith(1, 'gallery-1', fileA, undefined)
    })

    first.resolve({
      id: 'photo-1',
      status: 'APPROVED',
      mediaType: 'IMAGE',
      thumbUrl: '/thumb-1.webp',
      duration: null,
    })

    await waitFor(() => {
      expect(adminUploadFile).toHaveBeenCalledTimes(2)
      expect(adminUploadFile).toHaveBeenNthCalledWith(2, 'gallery-1', fileB, undefined)
    })

    second.resolve({
      id: 'photo-2',
      status: 'PENDING',
      mediaType: 'IMAGE',
      thumbUrl: '/thumb-2.webp',
      duration: null,
    })

    expect(await screen.findByText(/upload abgeschlossen: 1 freigegeben, 1 in moderation\./i)).toBeInTheDocument()
    expect(await screen.findByText('Freigegeben')).toBeInTheDocument()
    expect(await screen.findByText('In Moderation')).toBeInTheDocument()
    expect(onApprovedUploads).toHaveBeenCalledTimes(1)
  })

  it('retries only failed entries', async () => {
    const user = userEvent.setup()
    const first = deferred<{
      id: string
      status: 'APPROVED'
      mediaType: 'IMAGE'
      thumbUrl: string
      duration: null
    }>()
    const second = deferred<never>()
    const retry = deferred<{
      id: string
      status: 'PENDING'
      mediaType: 'IMAGE'
      thumbUrl: string
      duration: null
    }>()

    vi.mocked(adminUploadFile)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => retry.promise)

    render(<AdminUploadPanel galleryId="gallery-1" guestNameMode="HIDDEN" />)

    const input = screen.getByLabelText(/dateien auswählen/i)
    const okFile = new File(['ok'], 'ok.jpg', { type: 'image/jpeg' })
    const retryFile = new File(['retry'], 'retry.jpg', { type: 'image/jpeg' })
    await user.upload(input, [okFile, retryFile])

    await user.click(screen.getByRole('button', { name: /uploads starten/i }))

    await waitFor(() => {
      expect(adminUploadFile).toHaveBeenCalledTimes(1)
    })

    first.resolve({
      id: 'photo-1',
      status: 'APPROVED',
      mediaType: 'IMAGE',
      thumbUrl: '/thumb-1.webp',
      duration: null,
    })

    await waitFor(() => {
      expect(adminUploadFile).toHaveBeenCalledTimes(2)
    })

    second.reject(new Error('network'))

    expect(await screen.findByText(/1 freigegeben, 1 fehlgeschlagen/i)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /erneut versuchen/i })).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: /erneut versuchen/i }))
    await user.click(screen.getByRole('button', { name: /uploads starten/i }))

    await waitFor(() => {
      expect(adminUploadFile).toHaveBeenCalledTimes(3)
    })

    retry.resolve({
      id: 'photo-2',
      status: 'PENDING',
      mediaType: 'IMAGE',
      thumbUrl: '/thumb-2.webp',
      duration: null,
    })

    await screen.findByText(/1 in moderation/i)
    expect(adminUploadFile).toHaveBeenNthCalledWith(3, 'gallery-1', retryFile, undefined)
  })
})
