import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { proxy } from './proxy'

function request(path: string, init: { method?: string; origin?: string; cookie?: boolean } = {}) {
  const headers = new Headers({ host: 'app.example' })
  if (init.origin) headers.set('origin', init.origin)
  if (init.cookie) headers.set('cookie', 'session=token')
  return new NextRequest(`https://app.example${path}`, { method: init.method ?? 'GET', headers })
}

describe('proxy', () => {
  it('blocks cross-site mutations of the API, even with a session cookie', () => {
    const res = proxy(request('/api/agent', { method: 'POST', origin: 'https://evil.example', cookie: true }))
    expect(res.status).toBe(403)
    expect(proxy(request('/api/conversations/c1', { method: 'DELETE', origin: 'null', cookie: true })).status).toBe(403)
  })

  it('allows same-origin mutations and the webhook from Meta', () => {
    expect(proxy(request('/api/agent', { method: 'POST', origin: 'https://app.example', cookie: true })).status).toBe(200)
    expect(proxy(request('/api/webhooks/whatsapp', { method: 'POST', origin: 'https://meta.example' })).status).toBe(200)
  })

  it('needs a session cookie outside public paths', () => {
    expect(proxy(request('/api/agent')).status).toBe(401)
    expect(proxy(request('/dashboard')).status).toBe(307)
    expect(proxy(request('/auth/login')).status).toBe(200)
    expect(proxy(request('/privacy')).status).toBe(200)
    expect(proxy(request('/data-deletion')).status).toBe(200)
  })
})
