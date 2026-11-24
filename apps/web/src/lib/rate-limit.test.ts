import { describe, expect, it } from 'vitest'
import { clientIp, createLoginThrottle, trustedProxyHops } from './rate-limit'

describe('createLoginThrottle', () => {
  it('counts only failures, then backs off exponentially up to a cap', () => {
    const t = createLoginThrottle({ freeAttempts: 2, baseLockMs: 1000, maxLockMs: 4000 })
    t.fail('a', 0)
    t.fail('a', 0)
    expect(t.retryAfter('a', 0)).toBe(0)
    t.fail('a', 0)
    expect(t.retryAfter('a', 0)).toBe(1000)
    t.fail('a', 1000)
    expect(t.retryAfter('a', 1000)).toBe(2000)
    t.fail('a', 3000)
    t.fail('a', 7000)
    t.fail('a', 11000)
    expect(t.retryAfter('a', 11000)).toBe(4000)
    expect(t.retryAfter('b', 11000)).toBe(0)
  })

  it('clears on success and forgets old failures', () => {
    const t = createLoginThrottle({ freeAttempts: 0, baseLockMs: 1000, forgetAfterMs: 5000 })
    t.fail('a', 0)
    expect(t.retryAfter('a', 0)).toBe(1000)
    t.succeed('a')
    expect(t.retryAfter('a', 0)).toBe(0)
    t.fail('b', 0)
    t.fail('b', 0)
    expect(t.retryAfter('b', 1000)).toBe(1000)
    expect(t.retryAfter('b', 6000)).toBe(0)
  })
})

describe('clientIp', () => {
  const headers = new Headers({ 'x-forwarded-for': 'spoofed, 203.0.113.7, 10.0.0.1' })

  it('ignores X-Forwarded-For without trusted proxies', () => {
    expect(clientIp(headers, 0)).toBe('direct')
  })

  it('takes the entry added by the outermost trusted proxy', () => {
    expect(clientIp(headers, 1)).toBe('10.0.0.1')
    expect(clientIp(headers, 2)).toBe('203.0.113.7')
  })
})

describe('trustedProxyHops', () => {
  it('defaults to 1 on Vercel and 0 elsewhere', () => {
    expect(trustedProxyHops({ VERCEL: '1' })).toBe(1)
    expect(trustedProxyHops({})).toBe(0)
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: '2' })).toBe(2)
  })
})
