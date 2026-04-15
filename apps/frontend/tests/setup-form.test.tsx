import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SetupPage from '../src/app/setup/page'
import { getSetupStatus, submitSetup } from '../src/lib/api'

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
    getSetupStatus: vi.fn(),
    submitSetup: vi.fn(),
  }
})

describe('SetupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getSetupStatus).mockResolvedValue({ setupRequired: true })
    vi.mocked(submitSetup).mockResolvedValue(undefined)
  })

  it('shows step 1 when setup is required', async () => {
    render(<SetupPage />)

    expect(await screen.findByRole('heading', { name: /admin-zugangsdaten/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/benutzername/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/setup-token/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^passwort$/i)).toBeInTheDocument()
  })

  it('redirects to /admin/login when setup is already complete', async () => {
    vi.mocked(getSetupStatus).mockResolvedValue({ setupRequired: false })

    render(<SetupPage />)

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/admin/login')
    })
  })

  it('submits without wedding data when step 2 is skipped', async () => {
    const user = userEvent.setup()
    render(<SetupPage />)

    await screen.findByRole('heading', { name: /admin-zugangsdaten/i })

    await user.type(screen.getByLabelText(/benutzername/i), 'setup-admin')
    await user.type(screen.getByLabelText(/setup-token/i), 'setup-token-1234567890')
    await user.type(screen.getByLabelText(/^passwort$/i), 'Password123!')
    await user.click(screen.getByRole('button', { name: /weiter/i }))

    await screen.findByRole('heading', { name: /erste galerie/i })
    await user.click(screen.getByRole('button', { name: /überspringen/i }))

    expect(submitSetup).toHaveBeenCalledWith({
      username: 'setup-admin',
      password: 'Password123!',
      setupToken: 'setup-token-1234567890',
    })
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/admin/login')
    })
  })

  it('shows an inline error for passwords shorter than 12 characters', async () => {
    const user = userEvent.setup()
    render(<SetupPage />)

    await screen.findByRole('heading', { name: /admin-zugangsdaten/i })

    await user.type(screen.getByLabelText(/benutzername/i), 'setup-admin')
    await user.type(screen.getByLabelText(/setup-token/i), 'setup-token-1234567890')
    await user.type(screen.getByLabelText(/^passwort$/i), 'short')
    await user.click(screen.getByRole('button', { name: /weiter/i }))

    expect(await screen.findByText(/das passwort muss mindestens 12 zeichen lang sein/i)).toBeInTheDocument()
    expect(submitSetup).not.toHaveBeenCalled()
  })
})
