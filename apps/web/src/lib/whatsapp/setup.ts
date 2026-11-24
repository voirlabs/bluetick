/**
 * The WhatsApp setup checklist, worked out from what the server can see. Pure,
 * so every message a step can show is tested. Each step that isn't done says
 * what to do next.
 */
type StepState = 'done' | 'todo' | 'waiting'

export interface SetupStep {
  id: 'credentials' | 'connection' | 'public-url' | 'webhook' | 'agent'
  title: string
  state: StepState
  detail: string
  /** A fix the dashboard can do in one click. */
  action?: 'subscribe'
}

export interface SetupInput {
  /** Names of required env vars that are empty. Never their values. */
  missingEnv: string[]
  phone: { display_phone_number?: string; verified_name?: string } | null
  phoneError: { message: string; status?: number; code?: number } | null
  /** How the token, app secret and WhatsApp account fit together. null if it couldn't be checked. */
  link: {
    appName: string | null
    tokenExpiresAt: Date | null
    secretMatches: boolean
    subscribed: boolean | null
  } | null
  webhookUrl: string
  lastInboundAt: Date | null
  verifyFailedAt: Date | null
  signatureFailedAt: Date | null
  activeAgentName: string | null
}

const WEBHOOK_STEPS =
  'In your Meta app, open Customize use case → Configuration, paste the callback URL below, enter your WHATSAPP_VERIFY_TOKEN as the verify token, and subscribe to the "messages" field. Then send a WhatsApp message to your business number. Meta only delivers real messages once the app is published (Publish, in the app\'s left menu).'

/** A token that expires within this long needs replacing now. */
const TOKEN_WARNING_MS = 7 * 24 * 60 * 60 * 1000

export function timeUntil(date: Date, now = new Date()) {
  const minutes = Math.round((date.getTime() - now.getTime()) / 60_000)
  if (minutes < 60) return `${Math.max(minutes, 1)} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`
  return `${Math.round(hours / 24)} days`
}

const PERMANENT_TOKEN =
  'In Business Settings → System users, add a system user, assign it your app and WhatsApp account, and generate a token that never expires with the business_management, whatsapp_business_messaging and whatsapp_business_management permissions. Set it as WHATSAPP_ACCESS_TOKEN and redeploy.'

export function timeAgo(date: Date, now = new Date()) {
  const minutes = Math.round((now.getTime() - date.getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  return `${Math.round(hours / 24)} days ago`
}

function connectionFix(err: NonNullable<SetupInput['phoneError']>): string {
  if (err.code === 190 || err.status === 401) {
    return `Meta rejected the access token: it is wrong or has expired. Tokens from API Setup expire quickly. ${PERMANENT_TOKEN}`
  }
  if (err.code === 100 || err.code === 803 || err.status === 404) {
    return "The token works, but WHATSAPP_PHONE_NUMBER_ID isn't a number it can reach. Copy the Phone number ID (not the phone number) from Customize use case → API Setup and redeploy."
  }
  if (err.code === 10 || err.code === 200 || err.status === 403) {
    return "The token can't manage this number. In Business Settings → System users, assign this WhatsApp account to the System User (Manage WhatsApp Business accounts), then generate a new token with the business_management, whatsapp_business_messaging and whatsapp_business_management permissions."
  }
  return `The WhatsApp Cloud API call failed: ${err.message}. Check the server can reach graph.facebook.com, then reload this page.`
}

export function setupSteps(input: SetupInput, now = new Date()): SetupStep[] {
  const credentialsDone = input.missingEnv.length === 0

  const credentials: SetupStep = {
    id: 'credentials',
    title: 'Add your WhatsApp credentials',
    state: credentialsDone ? 'done' : 'todo',
    detail: credentialsDone
      ? 'All four values are set.'
      : `Add ${input.missingEnv.join(', ')} to the server environment, then restart or redeploy. The setup guide shows where each one is in Meta.`,
  }

  const expiresAt = input.link?.tokenExpiresAt ?? null
  const expiringSoon = !!expiresAt && expiresAt.getTime() - now.getTime() < TOKEN_WARNING_MS
  const connected = input.phone
    ? `Connected to ${[input.phone.verified_name, input.phone.display_phone_number].filter(Boolean).join(', ') || 'your number'}`
    : ''
  const connection: SetupStep = !credentialsDone
    ? { id: 'connection', title: 'Connect to your number', state: 'waiting', detail: 'Checked once the credentials are set.' }
    : input.phone
      ? {
          id: 'connection',
          title: 'Connect to your number',
          state: expiringSoon ? 'todo' : 'done',
          detail: expiringSoon
            ? `${connected}, but the access token expires in ${timeUntil(expiresAt!, now)}, and then replies stop. ${PERMANENT_TOKEN}`
            : `${connected}.${expiresAt ? ` The access token expires on ${expiresAt.toISOString().slice(0, 10)}.` : ''}`,
        }
      : {
          id: 'connection',
          title: 'Connect to your number',
          state: 'todo',
          detail: input.phoneError ? connectionFix(input.phoneError) : 'Reload this page to check the connection.',
        }

  let host = ''
  let https = false
  try {
    const url = new URL(input.webhookUrl)
    host = url.hostname
    https = url.protocol === 'https:'
  } catch {
    // An invalid NEXT_PUBLIC_APP_URL fails the check below.
  }
  const local = !host || host === 'localhost' || host.endsWith('.local') || /^(127\.|10\.|192\.168\.|0\.0\.0\.0)/.test(host)
  const publicUrl: SetupStep = {
    id: 'public-url',
    title: 'Use a public HTTPS address',
    state: https && !local ? 'done' : 'todo',
    detail:
      https && !local
        ? `Meta will call ${input.webhookUrl}.`
        : 'Meta can only call a public HTTPS address. Set NEXT_PUBLIC_APP_URL to your deployment URL (or a tunnel such as ngrok while testing), then redeploy.',
  }

  const newer = (a: Date | null, b: Date | null) => !!a && (!b || a > b)
  const appName = input.link?.appName ? `the ${input.link.appName} app` : 'your Meta app'
  let webhook: SetupStep
  if (input.link && !input.link.secretMatches) {
    webhook = {
      id: 'webhook',
      title: 'Receive messages',
      state: 'todo',
      detail: `WHATSAPP_APP_SECRET isn't the App secret of ${appName}, the app your access token belongs to, so Meta's messages would fail the signature check. Copy the App secret from App settings → Basic in that app and redeploy.`,
    }
  } else if (input.link?.subscribed === false) {
    webhook = {
      id: 'webhook',
      title: 'Receive messages',
      state: 'todo',
      detail: `Your WhatsApp account doesn't send ${appName} its messages yet. Subscribe it below.`,
      action: 'subscribe',
    }
  } else if (newer(input.signatureFailedAt, input.lastInboundAt)) {
    webhook = {
      id: 'webhook',
      title: 'Receive messages',
      state: 'todo',
      detail:
        "Meta is calling your webhook, but the signature check fails, so messages are refused. WHATSAPP_APP_SECRET doesn't match your Meta app's App secret (App settings → Basic). Fix it and redeploy.",
    }
  } else if (input.lastInboundAt) {
    webhook = {
      id: 'webhook',
      title: 'Receive messages',
      state: 'done',
      detail: `Messages are arriving. The last one came in ${timeAgo(input.lastInboundAt, now)}.`,
    }
  } else if (input.verifyFailedAt) {
    webhook = {
      id: 'webhook',
      title: 'Receive messages',
      state: 'todo',
      detail: `Meta tried to verify the webhook ${timeAgo(input.verifyFailedAt, now)}, but the verify token didn't match WHATSAPP_VERIFY_TOKEN. Enter exactly that value in Meta and verify again.`,
    }
  } else {
    webhook = { id: 'webhook', title: 'Receive messages', state: 'todo', detail: `No messages yet. ${WEBHOOK_STEPS}` }
  }

  const agent: SetupStep = input.activeAgentName
    ? { id: 'agent', title: 'Turn the agent on', state: 'done', detail: `${input.activeAgentName} is answering.` }
    : {
        id: 'agent',
        title: 'Turn the agent on',
        state: 'todo',
        detail: 'No active agent, so messages wait in the inbox for a person. Set up the agent, or switch on Replying to customers under Agent.',
      }

  return [credentials, connection, publicUrl, webhook, agent]
}
