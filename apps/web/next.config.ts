import type { NextConfig } from 'next'

const dev = process.env.NODE_ENV !== 'production'

// Next.js inlines its bootstrap scripts and styles, so they need 'unsafe-inline'
// without a nonce; the dev server also needs eval and a websocket for reloads.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  // Browsers ignore it over plain http, so local development is unaffected.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
]

const nextConfig: NextConfig = {
  transpilePackages: ['@bluetick/agent'],
  serverExternalPackages: ['unpdf'],
  poweredByHeader: false,
  headers: async () => [{ source: '/:path*', headers: securityHeaders }],
}

export default nextConfig
