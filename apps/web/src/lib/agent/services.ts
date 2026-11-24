import type { AgentServices } from '@bluetick/agent'
import { Prisma } from '@prisma/client'
import { sendCaptureAlert } from '@/lib/alerts'
import { db } from '@/lib/db'
import { logger } from '@/lib/log'
import { searchKnowledge } from '@/lib/knowledge'
import { sendButtons, sendLocation, sendText } from '@/lib/whatsapp/cloud-api'

const agentLog = logger('agent')

function toLogFields(fields?: Record<string, unknown>) {
  if (!fields) return undefined
  return Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [
      k,
      v === null || ['string', 'number', 'boolean'].includes(typeof v)
        ? (v as string)
        : JSON.stringify(v),
    ])
  )
}

/** Services backed by Postgres and the WhatsApp Cloud API. */
export function createLiveServices(opts: {
  conversationId: string
  customerPhone: string
  customerName?: string | null
  memory: unknown
}): AgentServices {
  const { conversationId, customerPhone, customerName } = opts
  const memory: Record<string, unknown> =
    opts.memory && typeof opts.memory === 'object' && !Array.isArray(opts.memory)
      ? { ...(opts.memory as Record<string, unknown>) }
      : {}

  async function recordOutbound(content: string, waMessageId: string) {
    await db.message.create({
      data: { conversationId, direction: 'outbound', content, waMessageId },
    })
  }

  return {
    knowledge: { search: (query, topK = 5) => searchKnowledge(query, topK) },
    leads: {
      save: async (fields) => {
        await db.lead.create({ data: { conversationId, fields: fields as Prisma.InputJsonValue } })
        await sendCaptureAlert({ kind: 'lead', conversationId, customerName, fields })
      },
    },
    bookings: {
      request: async (details) => {
        const booking = await db.booking.create({
          data: {
            conversationId,
            status: 'pending',
            details: details as unknown as Prisma.InputJsonValue,
          },
        })
        await sendCaptureAlert({
          kind: 'booking',
          conversationId,
          customerName,
          details: details as unknown as Record<string, unknown>,
        })
        return { id: booking.id }
      },
    },
    memory: {
      get: async <T>(key: string) => memory[key] as T | undefined,
      // Merge one key in the database, so two replies running at once
      // (the customer sent two quick messages) don't overwrite each other's keys.
      set: async (key, value) => {
        memory[key] = value
        await db.$executeRaw`
          UPDATE conversations
          SET memory = memory || jsonb_build_object(${key}::text, ${JSON.stringify(value ?? null)}::jsonb),
              updated_at = NOW()
          WHERE id = ${conversationId}
        `
      },
    },
    send: {
      text: async (body) => recordOutbound(body, await sendText(customerPhone, body)),
      buttons: async (body, buttons) =>
        recordOutbound(
          `${body}\n[${buttons.map((b) => b.title).join(' | ')}]`,
          await sendButtons(customerPhone, body, buttons)
        ),
      location: async (pin) =>
        recordOutbound(
          `📍 ${[pin.name, pin.address].filter(Boolean).join(', ') || `${pin.latitude}, ${pin.longitude}`}`,
          await sendLocation(customerPhone, pin)
        ),
    },
    webhooks: { post: postJson },
    log: (message, fields) => agentLog.info(message, { conversationId, ...toLogFields(fields) }),
  }
}

/** POSTs JSON for the webhook and sheet tools. Throws so the tool reports the failure. */
async function postJson(url: string, payload: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`The webhook answered HTTP ${res.status}`)
}

/**
 * Services for the dashboard simulator. Knowledge search is real (read-only);
 * leads, bookings and messages are captured instead of saved or sent.
 */
export function createSimulatedServices() {
  const sent: string[] = []
  const posted: string[] = []
  const memory = new Map<string, unknown>()
  const services: AgentServices = {
    knowledge: { search: (query, topK = 5) => searchKnowledge(query, topK) },
    leads: { save: async () => {} },
    bookings: { request: async () => ({ id: 'simulated' }) },
    memory: {
      get: async <T>(key: string) => memory.get(key) as T | undefined,
      set: async (key, value) => void memory.set(key, value),
    },
    send: {
      text: async (body) => void sent.push(body),
      buttons: async (body, buttons) =>
        void sent.push(`${body}\n${buttons.map((b) => `[ ${b.title} ]`).join(' ')}`),
      location: async (pin) =>
        void sent.push(
          `📍 ${[pin.name, pin.address].filter(Boolean).join(', ')} (${pin.latitude}, ${pin.longitude})`
        ),
    },
    // Nothing leaves the simulator: the run notes where it would have posted.
    webhooks: { post: async (url) => void posted.push(new URL(url).host) },
    log: (message, fields) => agentLog.info(`[simulator] ${message}`, toLogFields(fields)),
  }
  return { services, sent, posted }
}

/** Notes about a simulated run (fallback used, handoff), shown under the reply. */
export interface SimulatorMetadata {
  notes: string[]
}
