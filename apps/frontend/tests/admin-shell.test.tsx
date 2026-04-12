import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { AdminSidebar } from '../src/components/AdminSidebar'
import AdminLayout from '../src/app/admin/layout'
import { adminLogout, getAdminGalleries } from '../src/lib/api'

const { replace, usePathname } = vi.hoisted(() => ({
  replace: vi.fn(),
  usePathname: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname,
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
    adminLogout: vi.fn(),
  }
})

describe('Admin shell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePathname.mockReturnValue('/admin')
    vi.mocked(getAdminGalleries).mockResolvedValue([
      {
        id: 'gallery-1',
        name: 'Sommerfest',
        slug: 'sommerfest',
        weddingName: 'Lea & Tom',
        weddingSlug: 'lea-tom',
        photoCount: 12,
      },
    ] as Awaited<ReturnType<typeof getAdminGalleries>>)
  })

  it('renders the sidebar with galleries from the API', async () => {
    render(<AdminSidebar />)

    expect(screen.getByRole('button', { name: /seitenleiste öffnen/i })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /sommerfest/i })).toBeInTheDocument()
    })

    expect(screen.getByText('Lea & Tom')).toBeInTheDocument()
  })

  it('logs out and redirects to login', async () => {
    vi.mocked(adminLogout).mockResolvedValue(undefined)
    render(<AdminSidebar />)

    await userEvent.click(screen.getByRole('button', { name: /abmelden/i }))

    expect(adminLogout).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenCalledWith('/admin/login')
  })

  it('does not render the sidebar on the login page layout', () => {
    usePathname.mockReturnValue('/admin/login')

    render(
      <AdminLayout>
        <div>Login page</div>
      </AdminLayout>,
    )

    expect(screen.getByText('Login page')).toBeInTheDocument()
    expect(screen.queryByText('Wedding Pics')).not.toBeInTheDocument()
  })

  it('wraps admin pages with the sidebar outside login', async () => {
    render(
      <AdminLayout>
        <div>Dashboard</div>
      </AdminLayout>,
    )

    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('Wedding Pics')).toBeInTheDocument()
    })
  })
})
