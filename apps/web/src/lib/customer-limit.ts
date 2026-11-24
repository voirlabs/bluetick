import { db } from '@/lib/db'

const TEN_MINUTES_MS = 10 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

interface CustomerLimits {
  per10Minutes: number
  perDay: number
}

function limitFrom(value: string | undefined, fallback: number) {
  const n = Number.parseInt(value ?? '', 10)
  return Number.isInteger(n) && n >= 0 ? n : fallback
}

/**
 * How many messages one customer may send before the agent stops answering
 * them: CUSTOMER_MESSAGES_PER_10_MIN (default 20) and CUSTOMER_MESSAGES_PER_DAY
 * (default 150). 0 turns a limit off.
 */
export function customerLimits(env: Record<string, string | undefined> = process.env): CustomerLimits {
  return {
    per10Minutes: limitFrom(env['CUSTOMER_MESSAGES_PER_10_MIN'], 20),
    perDay: limitFrom(env['CUSTOMER_MESSAGES_PER_DAY'], 150),
  }
}

export function isOverLimit(
  counts: { last10Minutes: number; lastDay: number },
  limits: CustomerLimits
): boolean {
  return (
    (limits.per10Minutes > 0 && counts.last10Minutes > limits.per10Minutes) ||
    (limits.perDay > 0 && counts.lastDay > limits.perDay)
  )
}

/**
 * True when the customer has sent more messages than the limits allow, this
 * one included. It counts stored messages, so it holds across serverless
 * instances. A conversation is one customer phone number.
 */
export async function isCustomerOverLimit(conversationId: string, now = new Date()) {
  const limits = customerLimits()
  if (!limits.per10Minutes && !limits.perDay) return false
  const since = (ms: number) =>
    db.message.count({
      where: { conversationId, direction: 'inbound', createdAt: { gte: new Date(now.getTime() - ms) } },
    })
  const [last10Minutes, lastDay] = await Promise.all([since(TEN_MINUTES_MS), since(DAY_MS)])
  return isOverLimit({ last10Minutes, lastDay }, limits)
}

/**
 * Marks the conversation as limited and puts it in front of a person. True
 * only for the first message over the limit in a day, so the note and the
 * alert go out once.
 */
export async function flagLimitedOnce(conversationId: string, now = new Date()) {
  const { count } = await db.conversation.updateMany({
    where: {
      id: conversationId,
      OR: [{ limitedAt: null }, { limitedAt: { lt: new Date(now.getTime() - DAY_MS) } }],
    },
    data: { limitedAt: now, status: 'needs_attention', resolvedAt: null },
  })
  return count === 1
}
