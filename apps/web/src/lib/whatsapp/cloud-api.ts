import { getWhatsAppConfig, requireWhatsAppConfig, type WhatsAppConfig } from './config'
import type { RawTemplate } from './templates'

/** WhatsApp limits: text body 4096 chars, reply button title 20 chars, max 3 buttons. */
const MAX_TEXT_LENGTH = 4096
const MAX_BUTTON_TITLE = 20
const MAX_BUTTONS = 3

/** Graph error codes we treat specially. */
const WA_ERROR = {
  /** More than 24 hours since the customer last messaged: free-form messages are not allowed. */
  OUTSIDE_SERVICE_WINDOW: 131047,
  RATE_LIMITED: 130429,
  PAIR_RATE_LIMITED: 131056,
} as const

export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'WhatsAppApiError'
  }

  get isOutsideServiceWindow() {
    return this.code === WA_ERROR.OUTSIDE_SERVICE_WINDOW
  }
}

/**
 * A rate-limit error means Meta refused the request, so any request can be
 * retried. A timeout or 5xx may come after Meta accepted it: only reads are
 * retried then, so a POST never sends the customer the same message twice.
 */
function isRetryable(err: unknown, idempotent: boolean) {
  if (err instanceof WhatsAppApiError) {
    if (err.code === WA_ERROR.RATE_LIMITED || err.code === WA_ERROR.PAIR_RATE_LIMITED) return true
    return idempotent && err.status >= 500
  }
  return idempotent // network error or timeout
}

async function graphRequest<T>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; token?: string } = {},
  config: WhatsAppConfig = requireWhatsAppConfig()
): Promise<T> {
  const url = `${config.graphBaseUrl}/${config.graphVersion}/${path}`
  let lastError: unknown

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: init.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${init.token ?? config.accessToken}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(15_000),
        cache: 'no-store',
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: { message?: string; code?: number; error_data?: unknown }
      }
      if (!res.ok || data.error) {
        throw new WhatsAppApiError(
          data.error?.message ?? `Graph API request failed with HTTP ${res.status}`,
          res.status,
          data.error?.code,
          data.error?.error_data
        )
      }
      return data as T
    } catch (err) {
      lastError = err
      if (!isRetryable(err, (init.method ?? 'GET') === 'GET') || attempt === 2) break
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    }
  }
  throw lastError
}

/** WhatsApp IDs are digits only; accept "+1 555 ..." style input too. */
function toWaId(phone: string) {
  return phone.replace(/\D/g, '')
}

type SendResponse = { messages?: Array<{ id: string }> }

async function sendMessage(to: string, message: Record<string, unknown>): Promise<string> {
  const config = requireWhatsAppConfig()
  const data = await graphRequest<SendResponse>(
    `${config.phoneNumberId}/messages`,
    {
      method: 'POST',
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toWaId(to),
        ...message,
      },
    },
    config
  )
  const id = data.messages?.[0]?.id
  if (!id) throw new WhatsAppApiError('Graph API returned no message id', 502)
  return id
}

/** Split text into WhatsApp-sized chunks, preferring paragraph and line boundaries. */
export function splitText(text: string, max = MAX_TEXT_LENGTH): string[] {
  const chunks: string[] = []
  let rest = text.trim()
  while (rest.length > max) {
    const window = rest.slice(0, max)
    const cut = Math.max(
      window.lastIndexOf('\n\n'),
      window.lastIndexOf('\n'),
      window.lastIndexOf(' ')
    )
    const at = cut > max / 2 ? cut : max
    chunks.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest) chunks.push(rest)
  return chunks
}

/** Sends a text message (split if longer than 4096 chars). Returns the id of the last message sent. */
export async function sendText(to: string, body: string): Promise<string> {
  let lastId = ''
  for (const chunk of splitText(body)) {
    lastId = await sendMessage(to, { type: 'text', text: { body: chunk, preview_url: false } })
  }
  return lastId
}

export interface ReplyButton {
  id: string
  title: string
}

export async function sendButtons(
  to: string,
  body: string,
  buttons: ReplyButton[]
): Promise<string> {
  if (buttons.length === 0) return sendText(to, body)
  return sendMessage(to, {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body.slice(0, 1024) },
      action: {
        buttons: buttons.slice(0, MAX_BUTTONS).map((b) => ({
          type: 'reply',
          reply: { id: b.id.slice(0, 256), title: b.title.slice(0, MAX_BUTTON_TITLE) },
        })),
      },
    },
  })
}

export interface LocationPin {
  latitude: number
  longitude: number
  name?: string
  address?: string
}

export async function sendLocation(to: string, location: LocationPin): Promise<string> {
  return sendMessage(to, { type: 'location', location })
}

/** Template messages are the only way to start a conversation outside the 24-hour window. */
export async function sendTemplate(
  to: string,
  name: string,
  languageCode = 'en_US',
  components: unknown[] = []
): Promise<string> {
  return sendMessage(to, {
    type: 'template',
    template: { name, language: { code: languageCode }, ...(components.length ? { components } : {}) },
  })
}

export class TemplatesNotConfiguredError extends Error {
  constructor() {
    super(
      'Set WHATSAPP_BUSINESS_ACCOUNT_ID (Customize use case → API Setup, the Messaging account ID) to send approved templates from the inbox.'
    )
  }
}

/** The account's approved templates. Needs WHATSAPP_BUSINESS_ACCOUNT_ID. */
export async function listApprovedTemplates(): Promise<RawTemplate[]> {
  const config = requireWhatsAppConfig()
  if (!config.businessAccountId) throw new TemplatesNotConfiguredError()
  const data = await graphRequest<{ data?: RawTemplate[] }>(
    `${config.businessAccountId}/message_templates?fields=name,language,status,category,components,parameter_format&status=APPROVED&limit=100`,
    {},
    config
  )
  return (data.data ?? []).filter((t) => !t.status || t.status.toUpperCase() === 'APPROVED')
}

/** Marks an inbound message as read and shows a typing indicator. Never throws. */
export async function markReadAndShowTyping(messageId: string): Promise<void> {
  const config = getWhatsAppConfig()
  if (!config) return
  const body = { messaging_product: 'whatsapp', status: 'read', message_id: messageId }
  try {
    await graphRequest(
      `${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        body: { ...body, typing_indicator: { type: 'text' } },
      },
      config
    )
  } catch {
    // Older Graph versions reject typing_indicator; fall back to a plain read receipt.
    await graphRequest(`${config.phoneNumberId}/messages`, { method: 'POST', body }, config).catch(
      () => {}
    )
  }
}

/** Largest media file we download: WhatsApp caps voice notes at 16 MB and photos at 5 MB. */
const MAX_MEDIA_BYTES = 16 * 1024 * 1024

export class MediaTooLargeError extends Error {
  constructor() {
    super('Media file is too large')
    this.name = 'MediaTooLargeError'
  }
}

/**
 * Downloads a customer's media (voice note, photo). The Graph API returns a
 * short-lived URL that needs the same access token. Files over `maxBytes` are
 * refused before downloading when Meta reports the size, and after otherwise.
 */
export async function downloadMedia(
  mediaId: string,
  maxBytes = MAX_MEDIA_BYTES
): Promise<{ data: Uint8Array; mimeType: string }> {
  const config = requireWhatsAppConfig()
  const info = await graphRequest<{ url?: string; mime_type?: string; file_size?: number }>(
    mediaId,
    {},
    config
  )
  if (!info.url) throw new WhatsAppApiError('Graph API returned no media URL', 502)
  if ((info.file_size ?? 0) > maxBytes) throw new MediaTooLargeError()
  const res = await fetch(info.url, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  })
  if (!res.ok) throw new WhatsAppApiError(`Media download failed with HTTP ${res.status}`, res.status)
  const data = new Uint8Array(await res.arrayBuffer())
  if (data.byteLength > maxBytes) throw new MediaTooLargeError()
  return { data, mimeType: info.mime_type ?? res.headers.get('content-type') ?? 'application/octet-stream' }
}

export interface PhoneNumberInfo {
  id: string
  display_phone_number?: string
  verified_name?: string
  quality_rating?: string
}

export async function getPhoneNumberInfo(): Promise<PhoneNumberInfo> {
  const config = requireWhatsAppConfig()
  return graphRequest<PhoneNumberInfo>(
    `${config.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
    {},
    config
  )
}

/** How the token, the app and the WhatsApp account fit together, for the setup checklist. */
export interface AppLink {
  appId: string
  appName: string | null
  /** null when the token never expires. */
  tokenExpiresAt: Date | null
  /** Whether WHATSAPP_APP_SECRET is the secret of the token's app. */
  secretMatches: boolean
  /** The WhatsApp Business Account: the configured one, or the only one the token can reach. */
  businessAccountId: string | null
  /** Whether that account sends the app its webhooks. null when there's no account to check. */
  subscribed: boolean | null
}

interface DebugToken {
  data?: {
    app_id?: string
    application?: string
    is_valid?: boolean
    expires_at?: number
    granular_scopes?: Array<{ scope: string; target_ids?: string[] }>
  }
}

function accountFromScopes(scopes: NonNullable<DebugToken['data']>['granular_scopes']): string | null {
  const ids = new Set(
    (scopes ?? [])
      .filter((s) => s.scope.startsWith('whatsapp_business_'))
      .flatMap((s) => s.target_ids ?? [])
  )
  return ids.size === 1 ? [...ids][0]! : null
}

async function debugToken(config: WhatsAppConfig) {
  const res = await graphRequest<DebugToken>(
    `debug_token?input_token=${encodeURIComponent(config.accessToken)}`,
    {},
    config
  )
  return res.data
}

function resolveBusinessAccount(config: WhatsAppConfig, debug: DebugToken['data']) {
  return config.businessAccountId ?? accountFromScopes(debug?.granular_scopes)
}

export async function checkAppLink(): Promise<AppLink> {
  const config = requireWhatsAppConfig()
  const debug = await debugToken(config)
  const appId = debug?.app_id
  if (!appId) throw new WhatsAppApiError("Meta didn't say which app the access token belongs to", 502)

  // An app access token is "<app id>|<app secret>", so Meta only accepts it with the right secret.
  const secretMatches = await graphRequest(`${appId}?fields=id`, { token: `${appId}|${config.appSecret}` }, config)
    .then(() => true)
    .catch((err) => {
      if (err instanceof WhatsAppApiError && err.code === 190) return false
      throw err
    })

  const businessAccountId = resolveBusinessAccount(config, debug)
  let subscribed: boolean | null = null
  if (businessAccountId) {
    const apps = await graphRequest<{ data?: Array<{ whatsapp_business_api_data?: { id?: string } }> }>(
      `${businessAccountId}/subscribed_apps`,
      {},
      config
    )
    subscribed = (apps.data ?? []).some((a) => a.whatsapp_business_api_data?.id === appId)
  }

  return {
    appId,
    appName: debug?.application ?? null,
    tokenExpiresAt: debug?.expires_at ? new Date(debug.expires_at * 1000) : null,
    secretMatches,
    businessAccountId,
    subscribed,
  }
}

/** Subscribes the token's app to the WhatsApp account's webhooks. */
export async function subscribeApp(): Promise<void> {
  const config = requireWhatsAppConfig()
  const debug = await debugToken(config)
  const businessAccountId = resolveBusinessAccount(config, debug)
  if (!businessAccountId) {
    throw new Error(
      'Set WHATSAPP_BUSINESS_ACCOUNT_ID (Customize use case → API Setup, the Messaging account ID) so the app knows which WhatsApp account to subscribe.'
    )
  }
  await graphRequest(`${businessAccountId}/subscribed_apps`, { method: 'POST' }, config)
}
