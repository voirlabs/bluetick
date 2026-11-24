import { z } from 'zod'
import { defineTool } from './define'
import type { AnyTool } from './types'

// Handoff tools are recognised by identity, so escalation instructions still
// name the right tool when you rename it: tools: { escalate: builtin.requestHuman() }.
const handoffTools = new WeakSet<AnyTool>()

/** True for tools made with builtin.requestHuman(). */
export function isHandoffTool(tool: AnyTool) {
  return handoffTools.has(tool)
}

const knowledge = () =>
  defineTool({
    description:
      "Search the business's knowledge base (uploaded documents, web pages, snippets). Use it before answering any question about the business, its products, prices or policies.",
    input: z.object({
      question: z.string().describe('The question to look up, in your own words'),
    }),
    run: async ({ question }, ctx) => {
      const chunks = await ctx.knowledge.search(question, 5)
      return chunks.length > 0
        ? { found: true, context: chunks.join('\n---\n') }
        : { found: false, note: 'Nothing relevant in the knowledge base. Do not guess.' }
    },
  })

const collectLead = () =>
  defineTool({
    description:
      "Save the customer's contact details and what they are interested in, once they have shared them.",
    input: z.object({
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional().describe('Only if different from the WhatsApp number'),
      intent: z.string().optional().describe('What they want, in a few words'),
      notes: z.string().optional(),
    }),
    run: async (fields, ctx) => {
      await ctx.leads.save({ ...fields, whatsapp: ctx.customer.phone })
      return { saved: true }
    },
    maxCallsPerRun: 1,
  })

const bookAppointment = () =>
  defineTool({
    description:
      'Record a booking request with the time the customer wants. The team confirms it later, so never tell the customer the booking is confirmed.',
    input: z.object({
      requestedFor: z
        .string()
        .describe('Requested date and time as the customer said it, e.g. "Friday 7pm"'),
      service: z.string().optional(),
      partySize: z.number().int().positive().optional(),
      customerName: z.string().optional(),
      notes: z.string().optional(),
    }),
    run: async (details, ctx) => {
      const { id } = await ctx.bookings.request(details)
      return { requestId: id, status: 'pending_confirmation' }
    },
    maxCallsPerRun: 1,
  })

const requestHuman = () => {
  const tool = defineTool({
    description:
      'Hand the conversation to a human team member. Use when the customer asks for a person, is upset, or you cannot help.',
    input: z.object({ reason: z.string().describe('Short reason for the team') }),
    run: async ({ reason }, ctx) => {
      ctx.handoff(reason)
      return { escalated: true, note: 'Tell the customer a team member will reply here soon.' }
    },
    maxCallsPerRun: 1,
  })
  handoffTools.add(tool)
  return tool
}

const businessHours = () =>
  defineTool({
    description: 'Get the business opening hours.',
    input: z.object({}),
    run: (_input, ctx) => ({
      hours: ctx.business.hours ?? null,
      timezone: ctx.business.timezone ?? null,
    }),
  })

const location = () =>
  defineTool({
    description:
      'Get the business address. Sends a map pin to the customer when coordinates are configured.',
    input: z.object({}),
    run: async (_input, ctx) => {
      const { latitude, longitude, location: address, businessName } = ctx.business
      if (typeof latitude === 'number' && typeof longitude === 'number') {
        await ctx.send.location({ latitude, longitude, name: businessName, address })
        return { address: address ?? null, pinSent: true }
      }
      return { address: address ?? null, pinSent: false }
    },
    maxCallsPerRun: 1,
  })

function checkUrl(url: string) {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Not a valid URL: ${url}`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error(`Use an http(s) URL: ${url}`)
  return parsed.toString()
}

/**
 * Sends what the customer shared to your own system: a CRM, a ticketing tool,
 * Zapier or Make. The URL is fixed in code, never chosen by the model.
 */
const webhook = (opts: { url: string; description?: string }) => {
  const url = checkUrl(opts.url)
  return defineTool({
    description:
      opts.description ??
      "Send the details the customer gave to the team's system. Use it once the customer has shared what the team needs.",
    input: z.object({
      summary: z.string().describe('One line on what this is about'),
      details: z
        .record(z.string(), z.string())
        .optional()
        .describe('Field name to value, e.g. name, email, order id'),
    }),
    run: async ({ summary, details }, ctx) => {
      await ctx.webhooks.post(url, {
        summary,
        details: details ?? {},
        customer: { phone: ctx.customer.phone, name: ctx.customer.name ?? null },
        conversationId: ctx.conversationId,
        test: ctx.simulated,
        sentAt: new Date().toISOString(),
      })
      return { sent: true }
    },
    maxCallsPerRun: 1,
  })
}

/**
 * A spreadsheet runs a cell that starts with = + - or @ as a formula, so text
 * from a customer could call IMPORTXML or HYPERLINK. A leading apostrophe
 * makes Sheets and Excel store it as plain text.
 */
function sheetSafe(value: string) {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

/**
 * Adds a row to a Google Sheet through an Apps Script web app (see
 * docs/customizing-the-agent.md for the script). Columns follow the keys.
 * `secret` is sent with each row so the script can refuse anyone else.
 */
const saveToSheet = (opts: { url: string; secret?: string; description?: string }) => {
  const url = checkUrl(opts.url)
  return defineTool({
    description:
      opts.description ??
      'Add a row to the team\'s spreadsheet with what the customer shared, once they have shared it.',
    input: z.object({
      row: z
        .record(z.string(), z.string())
        .describe('Column name to value, e.g. { "name": "Sam", "request": "catering for 40" }'),
    }),
    run: async ({ row }, ctx) => {
      const full: Record<string, string> = {
        ...row,
        whatsapp: ctx.customer.phone,
        time: new Date().toISOString(),
        ...(ctx.simulated ? { test: 'yes' } : {}),
      }
      await ctx.webhooks.post(url, {
        ...(opts.secret ? { secret: opts.secret } : {}),
        row: Object.fromEntries(Object.entries(full).map(([k, v]) => [sheetSafe(k), sheetSafe(v)])),
      })
      return { saved: true }
    },
    maxCallsPerRun: 1,
  })
}

/**
 * Built-in tools. Use `builtin.all()` for the standard set, or pick individual
 * ones and give them any name: `tools: { faq: builtin.knowledge() }`.
 * `webhook` and `saveToSheet` need a URL, so they're not in `all()`.
 */
export const builtin = {
  knowledge,
  collectLead,
  bookAppointment,
  requestHuman,
  businessHours,
  location,
  webhook,
  saveToSheet,
  /** All built-ins under their standard names. */
  all: (): Record<string, AnyTool> => ({
    answerFromKnowledge: knowledge(),
    collectLead: collectLead(),
    bookAppointment: bookAppointment(),
    requestHuman: requestHuman(),
    sendBusinessHours: businessHours(),
    sendLocation: location(),
  }),
}
