'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function LoginForm() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        router.push('/dashboard')
        router.refresh()
        return
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setError(
        res.status === 429
          ? 'Too many attempts. Wait a few minutes and try again.'
          : (data.error ?? 'Sign-in failed. Try again.')
      )
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.")
    }
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="password" className="mb-2 block">
          Password
        </Label>
        <div className="relative">
          <Input
            id="password"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'password-error' : undefined}
            className="h-11 pr-12"
          />
          <button
            type="button"
            onClick={() => setShow(!show)}
            aria-label={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
            className="absolute top-1/2 right-2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-faint transition-colors hover:text-text"
          >
            {show ? (
              <EyeOff className="h-5 w-5" aria-hidden />
            ) : (
              <Eye className="h-5 w-5" aria-hidden />
            )}
          </button>
        </div>
        {error && (
          <p id="password-error" role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      <Button type="submit" disabled={loading || !password} className="h-11 w-full">
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden /> Signing in…
          </>
        ) : (
          <>
            Sign in <ArrowRight aria-hidden />
          </>
        )}
      </Button>
    </form>
  )
}
