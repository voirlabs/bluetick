import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = [
  '/auth/login',
  '/api/auth/login',
  '/api/webhooks/whatsapp',
  '/privacy',
  '/data-deletion',
  '/favicon.ico',
  '/icon.svg',
  '/apple-icon.png',
  '/logo.svg',
]
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS']

/** Browsers send Origin on every cross-site POST; reject mutations from other sites. */
function isCrossSite(req: NextRequest) {
  const origin = req.headers.get('origin')
  if (!origin) return false
  try {
    return new URL(origin).host !== req.headers.get('host')
  } catch {
    return true
  }
}

/**
 * Cheap gate: requires a session cookie on every non-public path. Pages and
 * API routes still verify the JWT itself with isSignedIn().
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const isApi = pathname.startsWith('/api/')

  if (
    isApi &&
    pathname !== '/api/webhooks/whatsapp' &&
    !SAFE_METHODS.includes(req.method) &&
    isCrossSite(req)
  ) {
    return NextResponse.json({ error: 'Cross-site request blocked' }, { status: 403 })
  }

  if (PUBLIC_PATHS.includes(pathname) || req.cookies.has('session')) return NextResponse.next()

  if (isApi) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.redirect(new URL('/auth/login', req.url))
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
