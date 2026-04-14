import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminLoginPage from '../src/app/admin/login/page'
import { adminLogin, ApiError } from '../src/lib/api'

const { replace } = vi.hoisted(() => ({
  replace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}))

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual('../src/lib/api')
  return {
    ...actual,
    adminLogin: vi.fn(),
  }
})

describe('AdminLoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows totp input when backend requires a second factor', async () => {
    vi.mocked(adminLogin).mockRejectedValueOnce(
      new ApiError(401, { type: 'totp-required' }, '401')
    )

    const user = userEvent.setup()
    render(<AdminLoginPage />)

    await user.type(screen.getByLabelText(/benutzername/i), 'admin')
    await user.type(screen.getByLabelText(/^passwort$/i), 'Password123!')
    await user.click(screen.getByRole('button', { name: /anmelden/i }))

    await waitFor(() => {
      expect(adminLogin).toHaveBeenCalledWith('admin', 'Password123!', undefined)
    })

    expect(await screen.findByLabelText(/2fa-code/i)).toBeInTheDocument()
    expect(screen.getByText(/2fa-code erforderlich/i)).toBeInTheDocument()
  })

  it('submits totp code on second login attempt and redirects on success', async () => {
    vi.mocked(adminLogin)
      .mockRejectedValueOnce(new ApiError(401, { type: 'totp-required' }, '401'))
      .mockResolvedValueOnce(undefined)

    const user = userEvent.setup()
    render(<AdminLoginPage />)

    await user.type(screen.getByLabelText(/benutzername/i), 'admin')
    await user.type(screen.getByLabelText(/^passwort$/i), 'Password123!')
    await user.click(screen.getByRole('button', { name: /anmelden/i }))

    const totpField = await screen.findByLabelText(/2fa-code/i)
    await user.type(totpField, '123456')
    await user.click(screen.getByRole('button', { name: /anmelden/i }))

    await waitFor(() => {
      expect(adminLogin).toHaveBeenNthCalledWith(2, 'admin', 'Password123!', '123456')
      expect(replace).toHaveBeenCalledWith('/admin')
    })
  })
})
