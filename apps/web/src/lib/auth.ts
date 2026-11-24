import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto'
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

const COOKIE = 'session'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7
/** Marks a browser that has signed in before, so its login attempts are counted on their own. */
const DEVICE_COOKIE = 'device'
const DEVICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365
const MIN_PASSWORD_LENGTH = 12

function sessionSecret() {
  const secret = process.env['SESSION_SECRET']
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'SESSION_SECRET must be set in production (generate one with: openssl rand -hex 32)'
      )
    }
    return 'insecure-dev-only-session-secret'
  }
  return secret
}

/**
 * The signing key depends on ADMIN_PASSWORD as well as SESSION_SECRET, so
 * changing either signs every existing session out. The password itself never
 * goes into the cookie.
 */
function signingKey(purpose: 'session' | 'device') {
  const password = process.env['ADMIN_PASSWORD'] ?? ''
  const material = purpose === 'session' ? `session\0${password}` : 'device'
  return createHmac('sha256', sessionSecret()).update(material).digest()
}

/** Constant-time string comparison, regardless of length. */
export function safeEqual(a: string, b: string) {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

/** What's missing for sign-in to work, worded for the person setting it up; null when ready. */
export function setupProblem(env: Record<string, string | undefined> = process.env): string | null {
  const password = env['ADMIN_PASSWORD']
  if (!password)
    return "Set ADMIN_PASSWORD in the server's environment and restart, then sign in with it."
  if (env['NODE_ENV'] === 'production' && (password === 'change-me' || password.length < MIN_PASSWORD_LENGTH)) {
    return `ADMIN_PASSWORD is too weak for production. Set a password of at least ${MIN_PASSWORD_LENGTH} characters (generate one with: openssl rand -base64 18) and restart.`
  }
  if (!env['SESSION_SECRET'] && env['NODE_ENV'] === 'production') {
    return "Set SESSION_SECRET in the server's environment (generate one with: openssl rand -hex 32) and restart."
  }
  return null
}

/** Checks a login attempt against ADMIN_PASSWORD. Always false when it is unset. */
export function isAdminPassword(password: string) {
  const expected = process.env['ADMIN_PASSWORD']
  return !!expected && safeEqual(password, expected)
}

export async function createSession() {
  const token = await new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(signingKey('session'))

  const cookieStore = await cookies()
  cookieStore.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: MAX_AGE_SECONDS,
    path: '/',
  })
  if (!(await deviceId())) {
    const device = await new SignJWT({ device: randomUUID() })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(`${DEVICE_MAX_AGE_SECONDS}s`)
      .sign(signingKey('device'))
    cookieStore.set(DEVICE_COOKIE, device, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: DEVICE_MAX_AGE_SECONDS,
      path: '/api/auth/login',
    })
  }
}

/**
 * The id of a browser that signed in successfully before, or null. The login
 * rate limit counts its attempts separately, so someone guessing passwords
 * can't lock the owner's own browser out.
 */
export async function deviceId(): Promise<string | null> {
  const token = (await cookies()).get(DEVICE_COOKIE)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, signingKey('device'))
    return typeof payload['device'] === 'string' ? payload['device'] : null
  } catch {
    return null
  }
}

/** True when the request carries a valid admin session. */
export async function isSignedIn(): Promise<boolean> {
  const token = (await cookies()).get(COOKIE)?.value
  if (!token || !process.env['ADMIN_PASSWORD']) return false
  try {
    const { payload } = await jwtVerify(token, signingKey('session'))
    return payload['role'] === 'admin'
  } catch {
    return false
  }
}

/** For pages: redirects to the login page without a valid session. */
export async function requireSession() {
  if (!(await isSignedIn())) redirect('/auth/login')
}

export async function clearSession() {
  ;(await cookies()).delete(COOKIE)
}
