import { db } from '@/lib/db'

/** Written into a conversation each time it's handed to a person; the usage panel counts them. */
export const HANDOFF_NOTE = 'Handed to a person: '

/** Meta's free tier: the first 1,000 service messages per number each month (pricing as of October 2026). */
export const FREE_SERVICE_MESSAGES = 1000

export interface UsageCounts {
  inboundByType: Record<string, number>
  agentReplies: number
  personReplies: number
  templates: number
  conversations: number
  handedOff: number
  needsPerson: number
  inputTokens: number
  outputTokens: number
}

interface UsageSummary {
  customerMessages: number
  customerBreakdown: { label: string; count: number }[]
  replies: number
  replyBreakdown: { label: string; count: number }[]
  conversations: number
  handoffRate: number | null
  needsPerson: number
  inputTokens: number
  outputTokens: number
  /** Free-form replies inside the 24-hour window, what Meta calls service messages. */
  serviceMessages: number
  freeServiceLeft: number
}

const KIND_LABEL: Record<string, string> = {
  text: 'Text',
  interactive: 'Buttons',
  button: 'Buttons',
  audio: 'Voice notes',
  image: 'Photos',
}

/** The numbers the usage panel shows, from raw counts. Pure, so it's tested. */
export function usageSummary(c: UsageCounts): UsageSummary {
  const byLabel = new Map<string, number>()
  for (const [type, count] of Object.entries(c.inboundByType)) {
    const label = KIND_LABEL[type] ?? 'Other'
    byLabel.set(label, (byLabel.get(label) ?? 0) + count)
  }
  const customerBreakdown = [...byLabel.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
  const serviceMessages = c.agentReplies + c.personReplies
  return {
    customerMessages: customerBreakdown.reduce((n, x) => n + x.count, 0),
    customerBreakdown,
    replies: serviceMessages + c.templates,
    replyBreakdown: [
      { label: 'Agent', count: c.agentReplies },
      { label: 'You', count: c.personReplies },
      { label: 'Templates', count: c.templates },
    ].filter((x) => x.count > 0),
    conversations: c.conversations,
    handoffRate: c.conversations ? Math.round((c.handedOff / c.conversations) * 100) : null,
    needsPerson: c.needsPerson,
    inputTokens: c.inputTokens,
    outputTokens: c.outputTokens,
    serviceMessages,
    freeServiceLeft: Math.max(0, FREE_SERVICE_MESSAGES - serviceMessages),
  }
}

/** Midnight UTC on the first of this month, when Meta's monthly counts reset. */
export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

export async function loadUsage(now = new Date()): Promise<UsageSummary> {
  const since = monthStart(now)
  const thisMonth = { createdAt: { gte: since } }
  const [inbound, agentReplies, templates, outbound, conversations, handoffs, needsPerson, tokens] =
    await Promise.all([
      db.message.groupBy({
        by: ['contentType'],
        where: { direction: 'inbound', ...thisMonth },
        _count: { _all: true },
      }),
      db.message.count({ where: { direction: 'outbound', inputTokens: { not: null }, ...thisMonth } }),
      db.message.count({ where: { direction: 'outbound', contentType: 'template', ...thisMonth } }),
      db.message.count({ where: { direction: 'outbound', ...thisMonth } }),
      db.conversation.count({ where: { lastInboundAt: { gte: since } } }),
      db.message.findMany({
        where: { direction: 'system', content: { startsWith: HANDOFF_NOTE }, ...thisMonth },
        distinct: ['conversationId'],
        select: { conversationId: true },
      }),
      db.conversation.count({ where: { status: 'needs_attention' } }),
      db.message.aggregate({ where: thisMonth, _sum: { inputTokens: true, outputTokens: true } }),
    ])
  return usageSummary({
    inboundByType: Object.fromEntries(inbound.map((g) => [g.contentType, g._count._all])),
    agentReplies,
    templates,
    // Everything else sent: the person's inbox replies and messages tools sent directly.
    personReplies: Math.max(0, outbound - agentReplies - templates),
    conversations,
    handedOff: handoffs.length,
    needsPerson,
    inputTokens: tokens._sum.inputTokens ?? 0,
    outputTokens: tokens._sum.outputTokens ?? 0,
  })
}
