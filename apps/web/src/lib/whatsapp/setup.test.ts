import { describe, expect, it } from 'vitest'
import { setupSteps, timeAgo, timeUntil, type SetupInput } from './setup'

const now = new Date('2026-11-20T12:00:00Z')
const ready: SetupInput = {
  missingEnv: [],
  phone: { verified_name: 'Harbour Bistro', display_phone_number: '+44 117 000 0000' },
  phoneError: null,
  link: { appName: 'Bistro', tokenExpiresAt: null, secretMatches: true, subscribed: true },
  webhookUrl: 'https://bluetick.example.com/api/webhooks/whatsapp',
  lastInboundAt: new Date('2026-11-20T09:00:00Z'),
  verifyFailedAt: null,
  signatureFailedAt: null,
  activeAgentName: 'Harbour assistant',
}
const step = (input: Partial<SetupInput>, id: string) => setupSteps({ ...ready, ...input }, now).find((s) => s.id === id)!

describe('setupSteps', () => {
  it('is all done for a working setup', () => {
    const steps = setupSteps(ready, now)
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'done'])
    expect(steps[3]!.detail).toContain('3 hours ago')
  })

  it('names missing env vars and holds the connection check', () => {
    const s = setupSteps({ ...ready, missingEnv: ['WHATSAPP_APP_SECRET'], phone: null }, now)
    expect(s[0]!.detail).toContain('WHATSAPP_APP_SECRET')
    expect(s[1]!.state).toBe('waiting')
  })

  it('explains a bad token, a wrong phone number id and missing permissions', () => {
    expect(step({ phone: null, phoneError: { message: 'x', status: 401, code: 190 } }, 'connection').detail).toContain('access token')
    expect(step({ phone: null, phoneError: { message: 'x', status: 400, code: 100 } }, 'connection').detail).toContain('Phone number ID')
    expect(step({ phone: null, phoneError: { message: 'x', status: 403, code: 200 } }, 'connection').detail).toContain('permissions')
  })

  it('needs a public https address', () => {
    expect(step({ webhookUrl: 'http://localhost:3000/api/webhooks/whatsapp' }, 'public-url').state).toBe('todo')
    expect(step({ webhookUrl: 'https://192.168.1.4/api/webhooks/whatsapp' }, 'public-url').state).toBe('todo')
  })

  it('spots a wrong app secret or verify token from what the webhook saw', () => {
    const secret = step({ signatureFailedAt: new Date('2026-11-20T11:00:00Z') }, 'webhook')
    expect(secret.state).toBe('todo')
    expect(secret.detail).toContain('WHATSAPP_APP_SECRET')
    const verify = step({ lastInboundAt: null, verifyFailedAt: new Date('2026-11-20T11:55:00Z') }, 'webhook')
    expect(verify.detail).toContain('WHATSAPP_VERIFY_TOKEN')
    expect(step({ lastInboundAt: null }, 'webhook').detail).toContain('subscribe to the "messages" field')
  })

  it('warns before the access token expires', () => {
    const link = { ...ready.link!, tokenExpiresAt: new Date('2026-11-20T13:00:00Z') }
    const soon = step({ link }, 'connection')
    expect(soon.state).toBe('todo')
    expect(soon.detail).toContain('expires in 1 hour')
    expect(soon.detail).toContain('System users')
    const later = step({ link: { ...link, tokenExpiresAt: new Date('2027-01-20T00:00:00Z') } }, 'connection')
    expect(later.state).toBe('done')
    expect(later.detail).toContain('2027-01-20')
  })

  it("catches an app secret from another app before Meta sends anything", () => {
    const s = step({ lastInboundAt: null, link: { ...ready.link!, secretMatches: false } }, 'webhook')
    expect(s.state).toBe('todo')
    expect(s.detail).toContain('the Bistro app')
  })

  it('offers to subscribe the app to the WhatsApp account', () => {
    const s = step({ lastInboundAt: null, link: { ...ready.link!, subscribed: false } }, 'webhook')
    expect(s.action).toBe('subscribe')
    expect(step({ link: null, lastInboundAt: null }, 'webhook').action).toBeUndefined()
  })

  it('asks to turn the agent on', () => {
    expect(step({ activeAgentName: null }, 'agent').state).toBe('todo')
  })
})

describe('timeUntil', () => {
  it('reads naturally', () => {
    expect(timeUntil(new Date('2026-11-20T12:30:00Z'), now)).toBe('30 minutes')
    expect(timeUntil(new Date('2026-11-23T12:00:00Z'), now)).toBe('3 days')
  })
})

describe('timeAgo', () => {
  it('reads naturally', () => {
    expect(timeAgo(new Date('2026-11-20T11:59:40Z'), now)).toBe('just now')
    expect(timeAgo(new Date('2026-11-20T11:59:00Z'), now)).toBe('1 minute ago')
    expect(timeAgo(new Date('2026-11-17T12:00:00Z'), now)).toBe('3 days ago')
  })
})
