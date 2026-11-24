import { createHmac } from 'crypto'
import { describe, expect, it } from 'vitest'
import { VOICE_NOTE, parseWebhookPayload, verifySignature } from './webhook'
import { splitText } from './cloud-api'
import { isWithinServiceWindow, serviceWindowLeft } from './service-window'
import { isOptInMessage, isOptOutMessage } from '../opt-out'

const PHONE_ID = '1234567890'

function payload(messages: unknown[], phoneNumberId = PHONE_ID) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550000000', phone_number_id: phoneNumberId },
              contacts: [{ wa_id: '15551112222', profile: { name: 'Sam' } }],
              messages,
            },
          },
        ],
      },
    ],
  }
}

describe('verifySignature', () => {
  const secret = 'app-secret'
  const body = JSON.stringify({ hello: 'world' })
  const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')

  it('accepts a valid signature', () => {
    expect(verifySignature(body, sig, secret)).toBe(true)
  })
  it('rejects a tampered body, wrong secret, or missing header', () => {
    expect(verifySignature(body + ' ', sig, secret)).toBe(false)
    expect(verifySignature(body, sig, 'other')).toBe(false)
    expect(verifySignature(body, null, secret)).toBe(false)
    expect(verifySignature(body, 'sha256=abc', secret)).toBe(false)
  })
})

describe('parseWebhookPayload', () => {
  it('parses a text message with contact name', () => {
    const [msg, ...rest] = parseWebhookPayload(
      payload([
        {
          id: 'wamid.1',
          from: '15551112222',
          timestamp: '1700000000',
          type: 'text',
          text: { body: ' Hi ' },
        },
      ]),
      PHONE_ID
    )
    expect(rest).toHaveLength(0)
    expect(msg).toMatchObject({
      id: 'wamid.1',
      from: '15551112222',
      contactName: 'Sam',
      kind: 'text',
      text: 'Hi',
    })
    expect(msg?.timestamp.toISOString()).toBe('2023-11-14T22:13:20.000Z')
  })

  it('treats a blank profile name as no name', () => {
    const body = payload([{ id: 'a', from: '15551112222', type: 'text', text: { body: 'hi' } }])
    body.entry[0]!.changes[0]!.value.contacts[0]!.profile.name = '  '
    expect(parseWebhookPayload(body, PHONE_ID)[0]?.contactName).toBeUndefined()
  })

  it('uses the title of interactive button and list replies', () => {
    const out = parseWebhookPayload(
      payload([
        {
          id: 'a',
          from: '1',
          type: 'interactive',
          interactive: { type: 'button_reply', button_reply: { id: 'x', title: 'Yes' } },
        },
        {
          id: 'b',
          from: '1',
          type: 'interactive',
          interactive: { type: 'list_reply', list_reply: { id: 'y', title: 'Tuesday' } },
        },
      ]),
      PHONE_ID
    )
    expect(out.map((m) => m.text)).toEqual(['Yes', 'Tuesday'])
  })

  it('keeps the media id of photos and voice notes so they can be downloaded', () => {
    const [photo, voice] = parseWebhookPayload(
      payload([
        { id: 'a', from: '1', type: 'image', image: { id: 'm1', mime_type: 'image/jpeg', caption: 'my receipt' } },
        { id: 'b', from: '1', type: 'audio', audio: { id: 'm2', mime_type: 'audio/ogg; codecs=opus', voice: true } },
      ]),
      PHONE_ID
    )
    expect(photo).toMatchObject({ kind: 'image', text: '[Photo] my receipt', media: { id: 'm1', mimeType: 'image/jpeg' } })
    expect(voice).toMatchObject({ kind: 'voice', text: VOICE_NOTE, media: { id: 'm2' } })
  })

  it('describes other media so the agent knows it cannot open it', () => {
    const [msg] = parseWebhookPayload(
      payload([{ id: 'a', from: '1', type: 'video', video: { caption: 'the leak' } }]),
      PHONE_ID
    )
    expect(msg?.kind).toBe('media')
    expect(msg?.text).toContain('a video')
    expect(msg?.text).toContain('the leak')
    expect(msg?.media).toBeUndefined()
  })

  it('ignores reactions, status-only payloads and other phone numbers', () => {
    expect(
      parseWebhookPayload(
        payload([{ id: 'a', from: '1', type: 'reaction', reaction: { emoji: '👍' } }]),
        PHONE_ID
      )
    ).toEqual([])
    expect(parseWebhookPayload(payload([]), PHONE_ID)).toEqual([])
    expect(
      parseWebhookPayload(
        payload([{ id: 'a', from: '1', type: 'text', text: { body: 'hi' } }], 'other'),
        PHONE_ID
      )
    ).toEqual([])
    expect(parseWebhookPayload({ object: 'page' }, PHONE_ID)).toEqual([])
    expect(parseWebhookPayload(null, PHONE_ID)).toEqual([])
  })
})

describe('splitText', () => {
  it('keeps short text as one chunk and splits long text on whitespace', () => {
    expect(splitText('hello')).toEqual(['hello'])
    const chunks = splitText('word '.repeat(2000), 4096)
    expect(chunks.length).toBe(3)
    expect(chunks.every((c) => c.length <= 4096)).toBe(true)
  })
})

describe('service window', () => {
  it('is open for 24 hours after the last inbound message', () => {
    const now = Date.parse('2026-01-02T12:00:00Z')
    expect(isWithinServiceWindow('2026-01-02T00:00:00Z', now)).toBe(true)
    expect(isWithinServiceWindow('2026-01-01T11:59:00Z', now)).toBe(false)
    expect(isWithinServiceWindow(null, now)).toBe(false)
  })

  it('reports the time left, never negative', () => {
    const now = Date.parse('2026-01-02T12:00:00Z')
    expect(serviceWindowLeft('2026-01-02T00:00:00Z', now)).toBe(12 * 3600 * 1000)
    expect(serviceWindowLeft('2026-01-01T00:00:00Z', now)).toBe(0)
  })
})

describe('opt-out keywords', () => {
  it('matches exact keywords only', () => {
    expect(isOptOutMessage('STOP')).toBe(true)
    expect(isOptOutMessage('Unsubscribe!')).toBe(true)
    expect(isOptOutMessage('cancel my booking')).toBe(false)
    expect(isOptOutMessage('stop sending me the menu please')).toBe(false)
    expect(isOptInMessage('start')).toBe(true)
  })
})
