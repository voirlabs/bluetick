import { afterEach, describe, expect, it, vi } from 'vitest'

const updateMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ db: { conversation: { updateMany }, message: { create: vi.fn() } } }))

const { alertPayload, alertWebhookUrl, conversationUrl, sendCaptureAlert } = await import('./alerts')

const APP = 'https://bluetick.example.com'

describe('alertPayload', () => {
  it('says who needs a person and why, with a link to the conversation', () => {
    const p = alertPayload({ kind: 'handoff', conversationId: 'c1', customerName: 'Sam', reason: 'wants a refund' }, APP)
    expect(p.text).toBe(
      'Bluetick: Sam needs a person: wants a refund. Open the conversation: https://bluetick.example.com/dashboard/inbox?c=c1'
    )
    expect(p).toMatchObject({ event: 'handoff', conversationId: 'c1', url: conversationUrl('c1', APP) })
  })

  it('summarises lead fields and booking details, skipping empty ones', () => {
    const lead = alertPayload(
      { kind: 'lead', conversationId: 'c2', customerName: null, fields: { name: 'Lena', email: '', intent: 'catering for 40' } },
      APP
    )
    expect(lead.text).toContain('New lead from a customer: name: Lena, intent: catering for 40.')
    const booking = alertPayload(
      { kind: 'booking', conversationId: 'c3', customerName: 'Lena', details: { requestedFor: 'Friday 8pm', partySize: 4 } },
      APP
    )
    expect(booking.text).toContain('Booking request from Lena: requestedFor: Friday 8pm, partySize: 4.')
  })

  it('escapes Slack and Discord markup in customer and model text', () => {
    const handoff = alertPayload(
      { kind: 'handoff', conversationId: 'c', customerName: '<!channel> Sam & co', reason: 'click <https://evil.example|here> @everyone' },
      APP
    )
    expect(handoff.text).toContain('&lt;!channel&gt; Sam &amp; co needs a person: click &lt;https://evil.example|here&gt; @\u200beveryone.')
    const lead = alertPayload(
      { kind: 'lead', conversationId: 'c', customerName: 'Sam', fields: { notes: '<@U123> hi @here', nested: { a: '<b>' } } },
      APP
    )
    expect(lead.text).not.toMatch(/[<>]/)
    expect(lead.text).toContain('notes: &lt;@U123&gt; hi @\u200bhere')
    // The app's own link is left intact.
    expect(lead.text).toContain('https://bluetick.example.com/dashboard/inbox?c=c')
  })

  it('caps long details', () => {
    const p = alertPayload({ kind: 'lead', conversationId: 'c', fields: { notes: 'x'.repeat(1000) } }, APP)
    expect(p.text.length).toBeLessThan(450)
  })
})

describe('alertWebhookUrl', () => {
  const env = (v?: string) => ({ ALERT_WEBHOOK_URL: v }) as unknown as NodeJS.ProcessEnv
  it('accepts http(s) URLs and ignores anything else', () => {
    expect(alertWebhookUrl(env('https://hooks.slack.com/services/T/B/x'))).toBe('https://hooks.slack.com/services/T/B/x')
    expect(alertWebhookUrl(env(''))).toBeNull()
    expect(alertWebhookUrl(env('not a url'))).toBeNull()
    expect(alertWebhookUrl(env('file:///etc/passwd'))).toBeNull()
  })
})

describe('sendCaptureAlert', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('alerts once an hour per conversation, claiming the slot in the database', async () => {
    vi.stubEnv('ALERT_WEBHOOK_URL', 'https://hooks.slack.com/services/T/B/x')
    const fetch = vi.fn().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetch)
    const now = new Date('2026-01-01T12:00:00Z')

    updateMany.mockResolvedValueOnce({ count: 1 })
    await sendCaptureAlert({ kind: 'lead', conversationId: 'c1', fields: { name: 'Sam' } }, now)
    expect(fetch).toHaveBeenCalledOnce()
    expect(updateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: 'c1', OR: [{ leadAlertAt: null }, { leadAlertAt: { lt: new Date('2026-01-01T11:00:00Z') } }] },
      data: { leadAlertAt: now },
    })

    // Another run already alerted within the hour.
    updateMany.mockResolvedValueOnce({ count: 0 })
    await sendCaptureAlert({ kind: 'booking', conversationId: 'c1', details: {} }, now)
    expect(fetch).toHaveBeenCalledOnce()
    expect(updateMany.mock.calls[1]?.[0].data).toEqual({ bookingAlertAt: now })
  })
})
