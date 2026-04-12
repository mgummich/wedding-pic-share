'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { adminLogin, ApiError } from '@/lib/api'

export default function AdminLoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await adminLogin(username, password)
      router.replace('/admin')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Falscher Benutzername oder Passwort.')
      } else if (err instanceof ApiError && err.status === 429) {
        const title = (err.body as { title?: unknown })?.title
        setError(typeof title === 'string'
          ? title
          : 'Zu viele Fehlversuche. Bitte versuche es später erneut.')
      } else {
        setError('Ein Fehler ist aufgetreten. Bitte versuche es erneut.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-surface-base flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-3xl text-text-primary text-center mb-8">
          Admin-Bereich
        </h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-text-primary mb-1">
              Benutzername
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full px-4 py-2.5 rounded-card border border-border
                         focus:outline-none focus:border-accent bg-surface-card text-text-primary"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-text-primary mb-1">
              Passwort
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-2.5 rounded-card border border-border
                         focus:outline-none focus:border-accent bg-surface-card text-text-primary"
            />
          </div>
          {error && <p className="text-sm text-error">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-full bg-accent hover:bg-accent-hover text-white
                       font-medium transition-colors disabled:opacity-50"
          >
            {loading ? 'Anmelden…' : 'Anmelden'}
          </button>
        </form>
      </div>
    </main>
  )
}
