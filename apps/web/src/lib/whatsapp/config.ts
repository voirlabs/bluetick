export interface WhatsAppConfig {
  phoneNumberId: string
  accessToken: string
  appSecret: string
  verifyToken: string
  graphVersion: string
  /** Override for tests or a proxy. Defaults to https://graph.facebook.com. */
  graphBaseUrl: string
  /** Optional: lists the approved templates the inbox can send. */
  businessAccountId: string | null
}

const DEFAULT_GRAPH_VERSION = 'v26.0'

function env(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

/** Which of the required WhatsApp settings are present (never exposes values). */
export function getWhatsAppConfigStatus() {
  return {
    phoneNumberId: !!env('WHATSAPP_PHONE_NUMBER_ID'),
    accessToken: !!env('WHATSAPP_ACCESS_TOKEN'),
    appSecret: !!env('WHATSAPP_APP_SECRET'),
    verifyToken: !!env('WHATSAPP_VERIFY_TOKEN'),
  }
}

/** Returns the full config, or null if any required value is missing. */
export function getWhatsAppConfig(): WhatsAppConfig | null {
  const phoneNumberId = env('WHATSAPP_PHONE_NUMBER_ID')
  const accessToken = env('WHATSAPP_ACCESS_TOKEN')
  const appSecret = env('WHATSAPP_APP_SECRET')
  const verifyToken = env('WHATSAPP_VERIFY_TOKEN')
  if (!phoneNumberId || !accessToken || !appSecret || !verifyToken) return null
  return {
    phoneNumberId,
    accessToken,
    appSecret,
    verifyToken,
    graphVersion: env('WHATSAPP_GRAPH_VERSION') ?? DEFAULT_GRAPH_VERSION,
    businessAccountId: env('WHATSAPP_BUSINESS_ACCOUNT_ID') ?? null,
    graphBaseUrl: (env('WHATSAPP_GRAPH_BASE_URL') ?? 'https://graph.facebook.com').replace(
      /\/$/,
      ''
    ),
  }
}

export function requireWhatsAppConfig(): WhatsAppConfig {
  const config = getWhatsAppConfig()
  if (!config) {
    throw new Error(
      'WhatsApp is not configured. Set WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN.'
    )
  }
  return config
}
