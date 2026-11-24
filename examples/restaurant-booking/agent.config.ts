/**
 * Restaurant booking agent.
 *
 * Shows: custom tools with real logic, quick-reply buttons, per-conversation
 * memory, a dynamic prompt (today's date), a beforeReply shortcut and an
 * onHandoff notification.
 *
 * Use it: cp examples/restaurant-booking/agent.config.ts apps/web/agent.config.ts
 */
import { builtin, defineAgent, defineTool } from '@bluetick/agent'
import { z } from 'zod'

// Restaurant data. Replace with calls to your reservation system.

/** Seating hours per weekday (0 = Sunday). null = closed. Times are 24h "HH:MM". */
const SEATING: Record<number, { first: string; last: string } | null> = {
  0: { first: '12:00', last: '20:30' },
  1: null,
  2: { first: '17:00', last: '21:30' },
  3: { first: '17:00', last: '21:30' },
  4: { first: '17:00', last: '21:30' },
  5: { first: '17:00', last: '22:30' },
  6: { first: '12:00', last: '22:30' },
}
export const MAX_PARTY_SIZE = 8
const SLOT_MINUTES = 30

const MENU_REPLY =
  'Here is our menu: https://example.com/menu\nTell me a day, time and party size and I can request a table for you.'

// Pure helpers, exported for the tests

const toMinutes = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number)
  return h * 60 + m
}
const toHHMM = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** Bookable times on a date (YYYY-MM-DD), or why there are none. */
export function slotsFor(date: string, partySize: number): { slots: string[]; reason?: string } {
  if (partySize > MAX_PARTY_SIZE) {
    return { slots: [], reason: `Parties over ${MAX_PARTY_SIZE} need to talk to our team.` }
  }
  const day = new Date(`${date}T12:00:00Z`)
  if (Number.isNaN(day.getTime())) return { slots: [], reason: 'Invalid date.' }
  const hours = SEATING[day.getUTCDay()]
  if (!hours) return { slots: [], reason: 'We are closed that day.' }

  const slots: string[] = []
  for (let t = toMinutes(hours.first); t <= toMinutes(hours.last); t += SLOT_MINUTES)
    slots.push(toHHMM(t))
  return { slots }
}

/** Up to `count` slots closest to the preferred time. */
export function nearestSlots(slots: string[], preferred: string | undefined, count = 3) {
  if (!preferred) return slots.slice(0, count)
  const target = toMinutes(preferred)
  return [...slots]
    .sort((a, b) => Math.abs(toMinutes(a) - target) - Math.abs(toMinutes(b) - target))
    .slice(0, count)
    .sort()
}

// Tools

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('Date as YYYY-MM-DD')

const checkAvailability = defineTool({
  description:
    'Check which times are free on a date for a party size. Sends the best options to the customer as buttons.',
  input: z.object({
    date: dateSchema,
    partySize: z.number().int().positive(),
    preferredTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional()
      .describe('24h HH:MM, if the customer gave one'),
  }),
  run: async ({ date, partySize, preferredTime }, ctx) => {
    const { slots, reason } = slotsFor(date, partySize)
    if (slots.length === 0) return { available: false, reason }

    const options = nearestSlots(slots, preferredTime)
    await ctx.memory.set('pendingRequest', { date, partySize })
    await ctx.send.buttons(
      `Free times on ${date} for ${partySize}:`,
      options.map((time) => ({ id: `slot:${date}:${time}`, title: time }))
    )
    return {
      available: true,
      buttonsSent: options,
      note: 'The customer has the times as buttons. Reply with one short line, or nothing.',
    }
  },
  // It messages the customer, so once per reply is enough.
  maxCallsPerRun: 1,
})

const requestTable = defineTool({
  description:
    'Request a table once the customer has chosen a date, time and party size and given a name.',
  input: z.object({
    date: dateSchema,
    time: z.string().regex(/^\d{2}:\d{2}$/),
    partySize: z.number().int().positive(),
    name: z.string().min(1),
    notes: z.string().optional().describe('Allergies, occasion, seating preference'),
  }),
  run: async ({ date, time, partySize, name, notes }, ctx) => {
    const { slots, reason } = slotsFor(date, partySize)
    if (!slots.includes(time))
      return { requested: false, reason: reason ?? `${time} is not available on ${date}.` }

    const { id } = await ctx.bookings.request({
      requestedFor: `${date} ${time}`,
      partySize,
      customerName: name,
      notes,
    })
    await ctx.memory.set('lastBooking', { id, date, time, partySize })
    return {
      requested: true,
      requestId: id,
      note: 'Tell the customer the team will confirm shortly.',
    }
  },
  maxCallsPerRun: 1,
})

// Agent

export default defineAgent({
  instructions: async ({ settings, defaults, ctx }) => {
    const timeZone = settings.business.timezone ?? 'UTC'
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      weekday: 'long',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    // A tapped button arrives as just its title ("19:00"), so remind the model what it offered.
    const pending = await ctx.memory.get<{ date: string; partySize: number }>('pendingRequest')
    return `${defaults}

## Bookings
Today is ${today} (${timeZone}). Convert relative dates like "Friday" or "tomorrow" to YYYY-MM-DD.
Ask for date, time and party size, then use checkAvailability. When they pick a time, ask for a name and use requestTable.
Never say a table is confirmed: the team confirms every request.${
      pending
        ? `\nYou last offered times on ${pending.date} for ${pending.partySize}. A reply that is just a time picks that slot.`
        : ''
    }`
  },

  tools: {
    checkAvailability,
    requestTable,
    answerFromKnowledge: builtin.knowledge(),
    sendLocation: builtin.location(),
    requestHuman: builtin.requestHuman(),
  },

  hooks: {
    // A fixed answer, no model call.
    beforeReply: ({ text }) => {
      if (/^(menu|the menu|menu please)\??$/i.test(text.trim())) return { reply: MENU_REPLY }
    },

    // Post to Slack when a conversation needs a person.
    onHandoff: async ({ reason }, ctx) => {
      const url = process.env['SLACK_WEBHOOK_URL']
      if (!url || ctx.simulated) return
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `WhatsApp handoff (${ctx.customer.name ?? 'customer'}): ${reason}`,
        }),
      })
    },
  },
})
