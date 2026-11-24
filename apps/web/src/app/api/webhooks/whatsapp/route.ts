import { NextRequest, after } from 'next/server'
import { getWhatsAppConfig } from '@/lib/whatsapp/config'
import { parseWebhookPayload, verifySignature } from '@/lib/whatsapp/webhook'
import { recordSignatureFailure, recordVerifyFailure } from '@/lib/whatsapp/webhook-health'
import { handleInboundMessage } from '@/lib/handle-inbound'
import { logger } from '@/lib/log'
import { safeEqual } from '@/lib/auth'
import { readBodyText } from '@/lib/http'

const log = logger('webhook')

// Replies run in after(): the model call plus Graph API send must fit in this budget.
export const maxDuration = 60

/** Meta's webhook payloads are a few KB; anything far bigger isn't from Meta. */
const MAX_BODY_BYTES = 1024 * 1024

/** Meta's one-time verification handshake when you register the webhook URL. */
export async function GET(req: NextRequest) {
  const config = getWhatsAppConfig()
  const params = req.nextUrl.searchParams
  if (
    config &&
    params.get('hub.mode') === 'subscribe' &&
    safeEqual(params.get('hub.verify_token') ?? '', config.verifyToken)
  ) {
    return new Response(params.get('hub.challenge') ?? '', { status: 200 })
  }
  // Meta's handshake with the wrong token: the setup checklist says so.
  if (config && params.get('hub.mode') === 'subscribe') recordVerifyFailure()
  return new Response('Forbidden', { status: 403 })
}

export async function POST(req: NextRequest) {
  const config = getWhatsAppConfig()
  if (!config) {
    log.error('webhook received but WhatsApp env vars are missing')
    return new Response('Not configured', { status: 503 })
  }

  // Size is checked before the signature, so an unsigned flood can't make us
  // buffer and hash large bodies.
  const rawBody = await readBodyText(req, MAX_BODY_BYTES)
  if (rawBody === null) return new Response('Payload too large', { status: 413 })
  if (!verifySignature(rawBody, req.headers.get('x-hub-signature-256'), config.appSecret)) {
    log.warn('rejected webhook with invalid signature')
    recordSignatureFailure()
    return new Response('Forbidden', { status: 403 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  const messages = parseWebhookPayload(payload, config.phoneNumberId)
  if (messages.length > 0) {
    // Acknowledge immediately; Meta retries if we take too long.
    after(async () => {
      for (const msg of messages) {
        await handleInboundMessage(msg).catch((err) =>
          log.error('failed to handle message', err, { messageId: msg.id })
        )
      }
    })
  }

  return new Response('OK', { status: 200 })
}
