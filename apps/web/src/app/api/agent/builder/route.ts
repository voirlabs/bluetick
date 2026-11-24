import { NextRequest } from 'next/server'
import { convertToModelMessages, isStepCount, streamText, tool, type UIMessage } from 'ai'
import { z } from 'zod'
import { isSignedIn } from '@/lib/auth'
import { availableTools } from '@/lib/agent/definition'
import { builderModel } from '@/lib/agent/models'
import { LIMITS } from '@/lib/schemas'
import { logger } from '@/lib/log'

const log = logger('builder')

const toolNames = availableTools.map((t) => t.name)
const toolGuide = availableTools.map((t) => `- ${t.name}: ${t.description}`).join('\n')

const SYSTEM = `You are a setup assistant that helps a business configure its AI agent on WhatsApp.

Have a short conversation with the business owner and gather enough to produce a complete agent configuration.

Rules:
1. Refuse to create romantic companions, general-purpose assistants, open-ended chat partners or anything without a defined business task. WhatsApp Business terms do not allow general-purpose AI assistants.
2. Every agent needs a concrete business purpose: support, FAQs, bookings, lead capture, orders.
3. After 2-4 turns, call generateAgentConfig.
4. Be concise, friendly and professional. Ask one or two questions at a time.

When you know the business type, the agent's role and tasks, the tone and when to hand off to a human, call generateAgentConfig.

Tools you can enable (only these exist):
${toolGuide}`

const text = (max: number, description: string) => z.string().max(max).describe(description)

const configParameters = z.object({
  name: text(LIMITS.name, 'Agent display name'),
  systemPrompt: text(
    LIMITS.systemPrompt,
    `Full system prompt for the agent, under ${LIMITS.systemPrompt} characters. Include tone, what to do, what not to do and when to escalate.`
  ),
  businessContext: z.object({
    businessName: text(200, 'Business name'),
    industry: text(100, 'Industry').optional(),
    description: text(2000, 'What the business does').optional(),
    hours: text(500, 'Opening hours').optional(),
    timezone: text(100, 'IANA timezone, e.g. Europe/London').optional(),
    location: text(500, 'Street address').optional(),
  }),
  toolsEnabled: z
    .array(toolNames.length > 0 ? z.enum(toolNames as [string, ...string[]]) : z.string())
    .describe('Which tools to enable for this business'),
  greetingMessage: text(LIMITS.message, 'Opening line of the first reply. Must say it is an AI.'),
  fallbackMessage: text(LIMITS.message, "Sent when the agent can't help. Should offer a human."),
  escalationRules: z
    .array(
      z.object({
        condition: z.enum(['keyword', 'intent', 'attempts_exceeded', 'sentiment']),
        value: text(LIMITS.ruleValue, 'The keyword, intent, attempt count or sentiment'),
        action: z.enum(['handoff', 'fallback']),
      })
    )
    .max(LIMITS.rules)
    .describe('Conditions that trigger a human handoff'),
  allowedTopics: z
    .array(text(LIMITS.topic, 'A topic'))
    .max(LIMITS.topics)
    .describe('Topics the agent should help with'),
  language: text(20, 'Primary reply language code, e.g. en, es, ar'),
  summary: text(500, 'A 1-2 sentence summary for the owner of what the agent will do'),
})

// UI messages from useChat. Only user and assistant turns: a client can't add system prompts.
const bodySchema = z.object({
  messages: z
    .array(
      z.looseObject({
        role: z.enum(['user', 'assistant']),
        parts: z.array(z.looseObject({ type: z.string(), text: z.string().max(10_000).optional() })),
      })
    )
    .min(1)
    .max(40),
})

export async function POST(req: NextRequest) {
  if (!(await isSignedIn())) return new Response('Unauthorized', { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return new Response('Invalid input', { status: 400 })

  const tools = {
    generateAgentConfig: tool({
      description:
        'Generate the complete agent configuration from the conversation so far. Call this when you have enough information.',
      inputSchema: configParameters,
      execute: async (config) => ({ success: true, config }),
    }),
  }

  let messages
  try {
    messages = await convertToModelMessages(parsed.data.messages as unknown as UIMessage[], {
      tools,
      ignoreIncompleteToolCalls: true,
    })
  } catch {
    return new Response('Invalid input', { status: 400 })
  }

  const result = streamText({
    model: builderModel(),
    instructions: SYSTEM,
    messages,
    tools,
    stopWhen: isStepCount(3),
  })

  return result.toUIMessageStreamResponse({
    onError: (err) => {
      log.error('builder model call failed', err)
      return 'The model call failed. Check OPENAI_API_KEY and the server logs.'
    },
  })
}
