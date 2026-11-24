import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaTooLargeError, checkAppLink, downloadMedia, sendText } from './cloud-api'

const ok = () =>
  new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
const graphError = (status: number, code: number) =>
  new Response(JSON.stringify({ error: { message: 'nope', code } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })

describe('sending messages', () => {
  beforeEach(() => {
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '123')
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'token')
    vi.stubEnv('WHATSAPP_APP_SECRET', 'secret')
    vi.stubEnv('WHATSAPP_VERIFY_TOKEN', 'verify')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('refuses media over the size limit before downloading it', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ url: 'https://lookaside.example/m', file_size: 3_000_000 }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetch)
    await expect(downloadMedia('media-1', 2_000_000)).rejects.toBeInstanceOf(MediaTooLargeError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not resend after a timeout, which may come after Meta accepted it', async () => {
    const fetch = vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    vi.stubGlobal('fetch', fetch)
    await expect(sendText('+15550001111', 'Hi')).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not resend after a server error', async () => {
    const fetch = vi.fn().mockResolvedValue(graphError(500, 1))
    vi.stubGlobal('fetch', fetch)
    await expect(sendText('+15550001111', 'Hi')).rejects.toThrow('nope')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('retries when Meta refused the send for rate limiting', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(graphError(400, 130429)).mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', fetch)
    await expect(sendText('+15550001111', 'Hi')).resolves.toBe('wamid.1')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('checkAppLink', () => {
  beforeEach(() => {
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '123')
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'token')
    vi.stubEnv('WHATSAPP_APP_SECRET', 'secret')
    vi.stubEnv('WHATSAPP_VERIFY_TOKEN', 'verify')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

  function graph(secretOk: boolean, subscribedIds: string[]) {
    return vi.fn(async (url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization
      if (url.includes('debug_token'))
        return json({
          data: {
            app_id: '42',
            application: 'Bistro',
            expires_at: 1795521600,
            granular_scopes: [{ scope: 'whatsapp_business_messaging', target_ids: ['999'] }],
          },
        })
      if (url.includes('/42?')) {
        expect(auth).toBe('Bearer 42|secret')
        return secretOk ? json({ id: '42' }) : graphError(400, 190)
      }
      if (url.includes('999/subscribed_apps'))
        return json({ data: subscribedIds.map((id) => ({ whatsapp_business_api_data: { id } })) })
      throw new Error(`unexpected ${url}`)
    })
  }

  it('checks the secret, the expiry and the subscription', async () => {
    vi.stubGlobal('fetch', graph(true, ['7', '42']))
    expect(await checkAppLink()).toEqual({
      appId: '42',
      appName: 'Bistro',
      tokenExpiresAt: new Date(1795521600 * 1000),
      secretMatches: true,
      businessAccountId: '999',
      subscribed: true,
    })
  })

  it('spots a secret from another app and a missing subscription', async () => {
    vi.stubGlobal('fetch', graph(false, ['7']))
    const link = await checkAppLink()
    expect(link.secretMatches).toBe(false)
    expect(link.subscribed).toBe(false)
  })
})
