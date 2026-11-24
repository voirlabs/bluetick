import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const jar = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

const { createSession, deviceId, isSignedIn, setupProblem } = await import('./auth')

describe('setupProblem', () => {
  const prod = { NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(64) }
  it('rejects the placeholder and short passwords in production', () => {
    expect(setupProblem({ ...prod, ADMIN_PASSWORD: 'change-me' })).toContain('too weak')
    expect(setupProblem({ ...prod, ADMIN_PASSWORD: 'short-pass1' })).toContain('at least 12')
    expect(setupProblem({ ...prod, ADMIN_PASSWORD: 'a-long-enough-password' })).toBeNull()
  })
  it('allows any password in development', () => {
    expect(setupProblem({ NODE_ENV: 'development', ADMIN_PASSWORD: 'change-me' })).toBeNull()
    expect(setupProblem({ NODE_ENV: 'development' })).toContain('Set ADMIN_PASSWORD')
  })
})

describe('sessions', () => {
  beforeEach(() => {
    jar.clear()
    vi.stubEnv('SESSION_SECRET', 'test-secret')
    vi.stubEnv('ADMIN_PASSWORD', 'first-password-123')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('signs in, and changing ADMIN_PASSWORD signs every session out', async () => {
    await createSession()
    expect(await isSignedIn()).toBe(true)
    vi.stubEnv('ADMIN_PASSWORD', 'second-password-456')
    expect(await isSignedIn()).toBe(false)
  })

  it('changing SESSION_SECRET signs sessions out too', async () => {
    await createSession()
    vi.stubEnv('SESSION_SECRET', 'rotated')
    expect(await isSignedIn()).toBe(false)
  })

  it('remembers the browser after a successful sign-in', async () => {
    expect(await deviceId()).toBeNull()
    await createSession()
    const id = await deviceId()
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    await createSession()
    expect(await deviceId()).toBe(id)
  })
})
