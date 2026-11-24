/**
 * Helpers for testing your agent without WhatsApp, a database or an API key.
 *
 *   const model = mockModel([{ toolCalls: [{ name: 'lookupOrder', args: { orderId: 'A1' } }] }, { text: 'Shipped!' }])
 *   const { input, record } = testRun(myAgent, 'Where is my order A1?', { model })
 *   const result = await runAgent(input)
 *   // result.reply, result.toolCalls, record.sent, record.leads, record.bookings, record.memory, record.posted
 */
import type { LanguageModel } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import type {
  AgentDefinition,
  AgentServices,
  AgentSettings,
  BookingRequest,
  ChatMessage,
  RunInput,
} from './types'

export interface MockStep {
  text?: string
  toolCalls?: Array<{ name: string; args: unknown }>
}

/** One model response in the AI SDK's provider format, for mock models. */
export function mockResponse(step: MockStep, callIndex = 0) {
  return {
    content: [
      ...(step.text ? [{ type: 'text' as const, text: step.text }] : []),
      ...(step.toolCalls ?? []).map((c, n) => ({
        type: 'tool-call' as const,
        toolCallId: `call-${callIndex}-${n}`,
        toolName: c.name,
        input: JSON.stringify(c.args),
      })),
    ],
    finishReason: { unified: step.toolCalls ? ('tool-calls' as const) : ('stop' as const), raw: undefined },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 5, text: 5, reasoning: undefined },
    },
    warnings: [],
  }
}

/** A model that replies with `steps` in order (the last one repeats). */
export function mockModel(steps: MockStep[]) {
  let i = 0
  return new MockLanguageModelV4({
    doGenerate: async () => mockResponse(steps[Math.min(i, steps.length - 1)] ?? {}, i++),
  })
}

export function testSettings(overrides: Partial<AgentSettings> = {}): AgentSettings {
  return {
    id: 'test-agent',
    name: 'Test agent',
    systemPrompt: 'You are a helpful assistant for a test business.',
    business: { businessName: 'Test business' },
    toolsEnabled: [],
    greetingMessage: '',
    fallbackMessage: 'Sorry, something went wrong.',
    escalationRules: [],
    allowedTopics: [],
    language: 'en',
    ...overrides,
  }
}

/** In-memory services that record everything the agent does. */
export function testServices(knowledge: string[] = []) {
  const record = {
    sent: [] as Array<{ type: 'text' | 'buttons' | 'location'; body: unknown }>,
    leads: [] as Array<Record<string, unknown>>,
    bookings: [] as BookingRequest[],
    memory: new Map<string, unknown>(),
    posted: [] as Array<{ url: string; payload: unknown }>,
  }
  const services: AgentServices = {
    knowledge: { search: async () => knowledge },
    leads: { save: async (fields) => void record.leads.push(fields) },
    bookings: {
      request: async (details) => {
        record.bookings.push(details)
        return { id: `booking-${record.bookings.length}` }
      },
    },
    memory: {
      get: async <T>(key: string) => record.memory.get(key) as T | undefined,
      set: async (key, value) => void record.memory.set(key, value),
    },
    send: {
      text: async (body) => void record.sent.push({ type: 'text', body }),
      buttons: async (body, buttons) =>
        void record.sent.push({ type: 'buttons', body: { body, buttons } }),
      location: async (pin) => void record.sent.push({ type: 'location', body: pin }),
    },
    webhooks: { post: async (url, payload) => void record.posted.push({ url, payload }) },
    log: () => {},
  }
  return { services, record }
}

/**
 * Builds a complete RunInput for one customer message. All tools are enabled
 * unless `settings.toolsEnabled` says otherwise. Pass `history` (oldest first)
 * for the messages before this one.
 */
export function testRun(
  definition: AgentDefinition,
  text: string,
  opts: {
    model: LanguageModel
    settings?: Partial<AgentSettings>
    history?: ChatMessage[]
    customerPhone?: string
    customerName?: string
    knowledge?: string[]
  }
) {
  const { services, record } = testServices(opts.knowledge)
  const input: RunInput = {
    definition,
    settings: testSettings({ toolsEnabled: Object.keys(definition.tools ?? {}), ...opts.settings }),
    history: [...(opts.history ?? []), { role: 'user', content: text }],
    inbound: { text, kind: 'text' },
    customer: {
      phone: opts.customerPhone ?? '+15550001111',
      name: opts.customerName ?? 'Test customer',
    },
    conversationId: 'test-conversation',
    services,
    defaultModel: opts.model,
  }
  return { input, services, record }
}
