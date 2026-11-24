import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Verifies Meta's `X-Hub-Signature-256` header: an HMAC-SHA256 of the raw
 * request body, keyed with the app secret.
 */
export function verifySignature(
  rawBody: string,
  header: string | null,
  appSecret: string
): boolean {
  if (!header?.startsWith('sha256=')) return false
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
  const a = Buffer.from(header.slice('sha256='.length), 'utf8')
  const b = Buffer.from(expected, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

type InboundKind = 'text' | 'voice' | 'image' | 'interactive' | 'location' | 'media' | 'other'

/** A customer message, normalised to the text the agent will read. */
export interface InboundWhatsAppMessage {
  id: string
  /** Customer WhatsApp ID (digits, e.g. "15551234567"). */
  from: string
  contactName?: string
  timestamp: Date
  kind: InboundKind
  /** Original WhatsApp message type, e.g. "text", "image". */
  type: string
  text: string
  /** For voice notes and photos: the media to download from the Graph API. */
  media?: { id: string; mimeType?: string }
}

// Only the parts of Meta's payload we read. Everything is optional because
// webhook payloads vary by message type and API version.
interface RawMessage {
  id?: string
  from?: string
  timestamp?: string
  type?: string
  text?: { body?: string }
  interactive?: {
    type?: string
    button_reply?: { id?: string; title?: string }
    list_reply?: { id?: string; title?: string; description?: string }
  }
  button?: { text?: string; payload?: string }
  location?: { latitude?: number; longitude?: number; name?: string; address?: string }
  image?: { id?: string; mime_type?: string; caption?: string }
  audio?: { id?: string; mime_type?: string }
  video?: { caption?: string }
  document?: { caption?: string; filename?: string }
}

interface RawPayload {
  object?: string
  entry?: Array<{
    changes?: Array<{
      field?: string
      value?: {
        metadata?: { phone_number_id?: string }
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>
        messages?: RawMessage[]
      }
    }>
  }>
}

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker'])

/** Stored for a voice note until its transcript replaces it. */
export const VOICE_NOTE = '[Voice note]'
// Types that should never trigger a reply.
const IGNORED_TYPES = new Set(['reaction', 'system', 'ephemeral', 'request_welcome'])

function describe(
  msg: RawMessage
): { kind: InboundKind; text: string; media?: InboundWhatsAppMessage['media'] } | null {
  const type = msg.type ?? 'unknown'
  if (IGNORED_TYPES.has(type)) return null

  if (type === 'text') {
    const body = msg.text?.body?.trim()
    return body ? { kind: 'text', text: body } : null
  }
  if (type === 'interactive') {
    const reply = msg.interactive?.button_reply ?? msg.interactive?.list_reply
    return reply?.title ? { kind: 'interactive', text: reply.title } : null
  }
  if (type === 'button') {
    const text = msg.button?.text ?? msg.button?.payload
    return text ? { kind: 'interactive', text } : null
  }
  if (type === 'location' && msg.location) {
    const { latitude, longitude, name, address } = msg.location
    const label = [name, address].filter(Boolean).join(', ')
    return {
      kind: 'location',
      text: `[The customer shared a location${label ? `: ${label}` : ''} (${latitude}, ${longitude})]`,
    }
  }
  // Voice notes are transcribed and photos shown to the model; handle-inbound
  // replaces these placeholders once the media is downloaded.
  if (type === 'audio' && msg.audio?.id) {
    return {
      kind: 'voice',
      text: VOICE_NOTE,
      media: { id: msg.audio.id, mimeType: msg.audio.mime_type },
    }
  }
  if (type === 'image' && msg.image?.id) {
    const caption = msg.image.caption?.trim()
    return {
      kind: 'image',
      text: caption ? `[Photo] ${caption}` : '[Photo]',
      media: { id: msg.image.id, mimeType: msg.image.mime_type },
    }
  }
  if (MEDIA_TYPES.has(type)) {
    const media = (msg as Record<string, { caption?: string } | undefined>)[type]
    const caption = media?.caption?.trim()
    const what = type === 'audio' ? 'an audio file' : `a ${type}`
    return {
      kind: 'media',
      text: `[The customer sent ${what}${caption ? ` with the caption "${caption}"` : ''}. You cannot open it.]`,
    }
  }
  return { kind: 'other', text: `[The customer sent a message type you cannot read (${type}).]` }
}

/**
 * Extracts customer messages addressed to `phoneNumberId` from a webhook
 * payload. Status updates (sent/delivered/read) and reactions are ignored.
 */
export function parseWebhookPayload(
  payload: unknown,
  phoneNumberId: string
): InboundWhatsAppMessage[] {
  const body = payload as RawPayload
  if (body?.object !== 'whatsapp_business_account') return []

  const out: InboundWhatsAppMessage[] = []
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue
      const value = change.value
      if (!value || value.metadata?.phone_number_id !== phoneNumberId) continue

      for (const msg of value.messages ?? []) {
        if (!msg.id || !msg.from) continue
        const described = describe(msg)
        if (!described) continue
        const contact = value.contacts?.find((c) => c.wa_id === msg.from) ?? value.contacts?.[0]
        const seconds = Number(msg.timestamp)
        out.push({
          id: msg.id,
          from: msg.from,
          contactName: contact?.profile?.name?.trim() || undefined,
          timestamp: Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date(),
          kind: described.kind,
          type: msg.type ?? 'unknown',
          text: described.text,
          ...(described.media ? { media: described.media } : {}),
        })
      }
    }
  }
  return out
}
