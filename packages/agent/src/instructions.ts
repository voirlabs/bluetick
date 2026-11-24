import type { AgentSettings, EscalationRule } from './types'

/** Always appended, even when a definition replaces the rest of the prompt. */
export const PLATFORM_RULES = `## WhatsApp rules
- You are an AI assistant replying on WhatsApp for this business. Say you are an AI assistant in your first reply and whenever asked.
- Keep replies short and conversational. Plain text only: WhatsApp shows *bold* and _italic_, but not headings, tables or markdown links.
- Never invent prices, availability, policies or order details. Use your tools, or say you don't know.
- Only help with this business. Politely decline unrelated requests.`

function businessSection(settings: AgentSettings) {
  const b = settings.business
  const lines = [
    b.businessName && `Business: ${b.businessName}`,
    b.industry && `Industry: ${b.industry}`,
    b.description && `About: ${b.description}`,
    b.hours && `Hours: ${b.hours}`,
    b.location && `Address: ${b.location}`,
    b.timezone && `Timezone: ${b.timezone}`,
  ].filter(Boolean)
  return lines.length ? `## Business details\n${lines.join('\n')}` : ''
}

function escalationSection(rules: EscalationRule[], handoffToolName: string | null) {
  if (!handoffToolName) return ''
  const described = rules
    .filter((r) => r.action === 'handoff' && r.condition !== 'keyword')
    .map((r) => {
      if (r.condition === 'attempts_exceeded')
        return `- You have tried ${r.value} times without resolving the request`
      if (r.condition === 'sentiment') return `- The customer seems ${r.value}`
      return `- The customer wants: ${r.value}`
    })
  if (!described.length) return ''
  return `## When to hand off\nUse the ${handoffToolName} tool when:\n${described.join('\n')}`
}

interface InstructionOptions {
  isFirstReply: boolean
  /** Name of the enabled handoff tool, if any. */
  handoffToolName: string | null
}

/** Builds the system prompt from the dashboard settings. */
export function buildDefaultInstructions(
  settings: AgentSettings,
  options: InstructionOptions
): string {
  const sections = [
    settings.systemPrompt.trim(),
    businessSection(settings),
    `## Language\nReply in the language the customer writes in. If unsure, use "${settings.language || 'en'}".`,
    settings.allowedTopics.length
      ? `## Topics\nOnly help with: ${settings.allowedTopics.join(', ')}. Politely decline anything else.`
      : '',
    escalationSection(settings.escalationRules, options.handoffToolName),
    options.isFirstReply && settings.greetingMessage.trim()
      ? `## Greeting\nThis is the start of the conversation. Open your reply with this greeting, translated if needed:\n"${settings.greetingMessage.trim()}"`
      : '',
  ]
  return sections.filter(Boolean).join('\n\n')
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** First keyword rule whose value appears as a whole word or phrase in the text. */
export function matchKeywordRule(rules: EscalationRule[], text: string): EscalationRule | null {
  for (const rule of rules) {
    if (rule.condition !== 'keyword' || !rule.value.trim()) continue
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeRegExp(rule.value.trim())}($|[^\\p{L}\\p{N}])`,
      'iu'
    )
    if (pattern.test(text)) return rule
  }
  return null
}
