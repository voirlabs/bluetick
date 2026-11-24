import { NextRequest, NextResponse } from 'next/server'
import { createSession, deviceId, isAdminPassword, setupProblem } from '@/lib/auth'
import { clientIp, createLoginThrottle, trustedProxyHops } from '@/lib/rate-limit'
import { loginSchema } from '@/lib/schemas'

const globalForThrottle = globalThis as unknown as {
  loginThrottle?: ReturnType<typeof createLoginThrottle>
}
const throttle = (globalForThrottle.loginThrottle ??= createLoginThrottle())

function waitText(ms: number) {
  const seconds = Math.ceil(ms / 1000)
  return seconds < 90 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`
}

export async function POST(req: NextRequest) {
  const problem = setupProblem()
  if (problem) return NextResponse.json({ error: problem }, { status: 503 })

  // A browser that signed in before has its own counter, so wrong guesses from
  // elsewhere (which may all share one key without trusted proxies) can't
  // lock the owner out.
  const device = await deviceId()
  const key = device ? `device:${device}` : `ip:${clientIp(req.headers, trustedProxyHops())}`
  const parsed = loginSchema.safeParse(await req.json().catch(() => null))

  // Checked right before the password, with nothing awaited in between, so
  // parallel requests can't slip past the lock.
  const wait = throttle.retryAfter(key)
  if (wait > 0) {
    return NextResponse.json(
      { error: `Too many wrong passwords. Try again in ${waitText(wait)}.` },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(wait / 1000)) } }
    )
  }
  if (!parsed.success || !isAdminPassword(parsed.data.password)) {
    throttle.fail(key)
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 })
  }

  throttle.succeed(key)
  await createSession()
  return NextResponse.json({ ok: true })
}
