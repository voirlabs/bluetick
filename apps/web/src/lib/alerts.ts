import { db } from '@/lib/db'
import { logger } from '@/lib/log'
import { APP_NAME, APP_URL } from '@/lib/site'

const log = logger('alerts')

/**
 * Tells the owner when something needs them: a handoff, a new lead, a booking
 * request. Alerts go to ALERT_WEBHOOK_URL as Slack-style JSON ({ "text": ... }),
 * which Slack accepts directly, Discord accepts at its "/slack" webhook URL, and
 * Zapier, Make or n8n can forward to email, SMS or anywhere else.
 */
type AlertEvent =
  | { kind: 'handoff'; conversationId: string; customerName?: string | null; reason: string }
  | { kind: 'lead'; conversationId: string; customerName?: string | null; fields: Record<string, unknown> }
  | { kind: 'booking'; conversationId: string; customerName?: string | null; details: Record<string, unknown> }

const MAX_DETAIL = 300

/**
 * Customer and model text must not become markup: Slack (and Discord's /slack
 * endpoint) read <...> as links and mentions like <!channel>, and Discord
 * pings on @everyone and @here.
 */
function escapeMarkup(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@(everyone|here)\b/gi, '@\u200b$1')
}

/** "name: Sam, intent: catering" from captured fields, skipping empty ones. */
function summarize(fields: Record<string, unknown>): string {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
  const text = parts.join(', ')
  return escapeMarkup(text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 1)}…` : text)
}

export function conversationUrl(conversationId: string, appUrl = APP_URL) {
  return `${appUrl}/dashboard/inbox?c=${encodeURIComponent(conversationId)}`
}

/** The alert's one-line text and the JSON body sent to the webhook. */
export function alertPayload(event: AlertEvent, appUrl = APP_URL) {
  const who = escapeMarkup(event.customerName?.trim() || 'a customer')
  const url = conversationUrl(event.conversationId, appUrl)
  const line =
    event.kind === 'handoff'
      ? `${who} needs a person: ${escapeMarkup(event.reason)}`
      : event.kind === 'lead'
        ? `New lead from ${who}${summarize(event.fields) ? `: ${summarize(event.fields)}` : ''}`
        : `Booking request from ${who}${summarize(event.details) ? `: ${summarize(event.details)}` : ''}`
  return {
    text: `${APP_NAME}: ${line}. Open the conversation: ${url}`,
    event: event.kind,
    conversationId: event.conversationId,
    url,
  }
}

export function alertWebhookUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env['ALERT_WEBHOOK_URL']?.trim()
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

/**
 * Sends an alert if ALERT_WEBHOOK_URL is set. Never throws: a broken webhook
 * must not stop a customer's reply. A failure is noted in the conversation,
 * so it shows in the inbox, and logged.
 */
export async function sendAlert(event: AlertEvent): Promise<void> {
  const url = alertWebhookUrl()
  if (!url) return
  let problem: string | null = null
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(alertPayload(event)),
      signal: AbortSignal.timeout(5_000),
      cache: 'no-store',
    })
    if (!res.ok) problem = `HTTP ${res.status}`
  } catch (err) {
    problem = err instanceof Error ? err.message : String(err)
  }
  if (!problem) return
  log.warn('alert failed', { kind: event.kind, conversationId: event.conversationId, problem })
  await db.message
    .create({
      data: {
        conversationId: event.conversationId,
        direction: 'system',
        content: `The ${event.kind} alert to ALERT_WEBHOOK_URL failed (${problem}). Check the URL.`,
      },
    })
    .catch(() => {})
}

const LEAD_ALERT_EVERY_MS = 60 * 60 * 1000

/**
 * Sends a lead or booking alert unless one went out for this conversation in
 * the last hour, so a customer (or the model) repeating the request can't
 * flood the owner's channel. The lead or booking itself is always saved.
 */
export async function sendCaptureAlert(
  event: Extract<AlertEvent, { kind: 'lead' | 'booking' }>,
  now = new Date()
): Promise<void> {
  const since = new Date(now.getTime() - LEAD_ALERT_EVERY_MS)
  const claimed =
    event.kind === 'lead'
      ? await db.conversation.updateMany({
          where: { id: event.conversationId, OR: [{ leadAlertAt: null }, { leadAlertAt: { lt: since } }] },
          data: { leadAlertAt: now },
        })
      : await db.conversation.updateMany({
          where: { id: event.conversationId, OR: [{ bookingAlertAt: null }, { bookingAlertAt: { lt: since } }] },
          data: { bookingAlertAt: now },
        })
  if (claimed.count === 1) await sendAlert(event)
}
