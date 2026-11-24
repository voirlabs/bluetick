/**
 * Login throttle with backoff, in memory per instance (on serverless
 * platforms each instance keeps its own counters, so treat it as a speed
 * bump). Only failed attempts count: after `freeAttempts` wrong passwords a
 * key is locked for 30 seconds, doubling with each further failure up to 15
 * minutes. A key is forgotten an hour after its last failure.
 */
interface Failures {
  count: number
  lockedUntil: number
  lastAt: number
}

export function createLoginThrottle({
  freeAttempts = 5,
  baseLockMs = 30_000,
  maxLockMs = 15 * 60_000,
  forgetAfterMs = 60 * 60_000,
  maxKeys = 10_000,
} = {}) {
  const failures = new Map<string, Failures>()

  function current(key: string, now: number) {
    const f = failures.get(key)
    if (f && now - f.lastAt > forgetAfterMs) {
      failures.delete(key)
      return undefined
    }
    return f
  }

  return {
    /** Milliseconds until `key` may try again; 0 when it may try now. */
    retryAfter(key: string, now = Date.now()): number {
      const f = current(key, now)
      return f ? Math.max(0, f.lockedUntil - now) : 0
    },
    fail(key: string, now = Date.now()) {
      const f = current(key, now) ?? { count: 0, lockedUntil: 0, lastAt: now }
      f.count += 1
      f.lastAt = now
      if (f.count > freeAttempts) {
        f.lockedUntil = now + Math.min(baseLockMs * 2 ** (f.count - freeAttempts - 1), maxLockMs)
      }
      failures.delete(key)
      if (failures.size >= maxKeys) {
        // Maps iterate in insertion order, so this drops the longest-idle keys.
        for (const k of failures.keys()) {
          if (failures.size < maxKeys) break
          failures.delete(k)
        }
      }
      failures.set(key, f)
    },
    succeed(key: string) {
      failures.delete(key)
    },
  }
}

/**
 * The client address for rate limiting. Each trusted proxy appends the address
 * it received the request from to X-Forwarded-For, so the client is the entry
 * `trustedProxyHops` from the end; anything further left can be spoofed. With
 * no trusted proxies there is no reliable address, so all requests share one key.
 */
export function clientIp(headers: Headers, trustedProxyHops: number): string {
  if (trustedProxyHops <= 0) return 'direct'
  const hops = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return hops[Math.max(0, hops.length - trustedProxyHops)] ?? 'unknown'
}

/** TRUSTED_PROXY_HOPS, defaulting to 1 on Vercel (one proxy in front) and 0 elsewhere. */
export function trustedProxyHops(env: Record<string, string | undefined> = process.env): number {
  const n = Number.parseInt(env['TRUSTED_PROXY_HOPS'] ?? '', 10)
  if (Number.isInteger(n) && n >= 0) return n
  return env['VERCEL'] ? 1 : 0
}
