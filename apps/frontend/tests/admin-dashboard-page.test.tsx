import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import AdminDashboardPage from '../src/app/admin/page'
import { getAdminGalleries, getAdminTwoFactorStatus, ApiError } from '../src/lib/api'

const { replace } = vi.hoisted(() => ({
  replace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual('../src/lib/api')
  return {
    ...actual,
    getAdminGalleries: vi.fn(),
    getAdminTwoFactorStatus: vi.fn(),
  }
})

describe('AdminDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAdminGalleries).mockResolvedValue([])
    vi.mocked(getAdminTwoFactorStatus).mockResolvedValue({
      enabled: false,
      configured: false,
    })
  })

  it('shows a load error message on non-401 failures', async () => {
    vi.mocked(getAdminGalleries).mockRejectedValue(new ApiError(500, {}, '500'))

    render(<AdminDashboardPage />)

    expect(await screen.findByText(/(galerien konnten nicht geladen werden|failed to load galleries)/i)).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it('redirects to login on 401 failures', async () => {
    vi.mocked(getAdminGalleries).mockRejectedValue(new ApiError(401, {}, '401'))

    render(<AdminDashboardPage />)

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/admin/login')
    })
  })
})
