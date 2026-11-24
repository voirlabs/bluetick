import { describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod'
import { builtin, defineAgent, defineTool, listTools, runAgent } from './index'
import { mockResponse, type MockStep } from './testing'
import type { AgentDefinition, AgentServices, AgentSettings, ChatMessage, RunInput } from './types'

type GenerateOptions = Parameters<MockLanguageModelV4['doGenerate']>[0]

/** A model that plays back `steps` in order and records what it was sent. */
function mockModel(steps: MockStep[]) {
  const calls: GenerateOptions[] = []
  let i = 0
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      calls.push(options)
      return mockResponse(steps[Math.min(i, steps.length - 1)] ?? {}, i++)
    },
  })
  const systemPrompt = (n = 0) => {
    const msg = calls[n]?.prompt.find((m) => m.role === 'system')
    return typeof msg?.content === 'string' ? msg.content : ''
  }
  const toolNames = (n = 0) => (calls[n]?.tools ?? []).map((t) => t.name)
  return { model, calls, systemPrompt, toolNames }
}

function settings(overrides: Partial<AgentSettings> = {}): AgentSettings {
  return {
    id: 'agent-1',
    name: 'Test agent',
    systemPrompt: 'You are the assistant for Acme Bakery.',
    business: { businessName: 'Acme Bakery', hours: '8am-6pm' },
    toolsEnabled: [],
    greetingMessage: 'Hi! I am the Acme assistant.',
    fallbackMessage: 'Sorry, something went wrong.',
    escalationRules: [],
    allowedTopics: [],
    language: 'en',
    ...overrides,
  }
}

function services(): AgentServices & { sent: string[]; leads: { save: ReturnType<typeof vi.fn> } } {
  const sent: string[] = []
  const memory = new Map<string, unknown>()
  return {
    sent,
    knowledge: { search: vi.fn(async () => ['Sourdough costs $8.']) },
    leads: { save: vi.fn(async () => {}) },
    bookings: { request: vi.fn(async () => ({ id: 'booking-1' })) },
    memory: {
      get: async <T>(key: string) => memory.get(key) as T | undefined,
      set: async (key, value) => void memory.set(key, value),
    },
    send: {
      text: async (body) => void sent.push(body),
      buttons: async (body, buttons) =>
        void sent.push(`${body} [${buttons.map((b) => b.title).join('|')}]`),
      location: async (pin) => void sent.push(`pin ${pin.latitude},${pin.longitude}`),
    },
    webhooks: { post: async () => {} },
    log: () => {},
  }
}

function input(
  definition: AgentDefinition,
  model: MockLanguageModelV4,
  overrides: Partial<RunInput> = {},
  text = 'How much is sourdough?'
): RunInput {
  const history: ChatMessage[] = [{ role: 'user', content: text }]
  return {
    definition,
    settings: settings(),
    history,
    inbound: { text, kind: 'text' },
    customer: { phone: '+15551112222', name: 'Sam' },
    conversationId: 'conv-1',
    services: services(),
    defaultModel: model,
    ...overrides,
  }
}

describe('runAgent', () => {
  it('returns the model reply and builds the prompt from dashboard settings', async () => {
    const m = mockModel([{ text: 'Hello Sam!' }])
    const result = await runAgent(input(defineAgent({}), m.model))

    expect(result).toMatchObject({ reply: 'Hello Sam!', source: 'model', handoffReason: null })
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    const system = m.systemPrompt()
    expect(system).toContain('You are the assistant for Acme Bakery.')
    expect(system).toContain('Hours: 8am-6pm')
    expect(system).toContain('## WhatsApp rules')
    expect(system).toContain('Hi! I am the Acme assistant.')
  })

  it('only includes the greeting on the first reply', async () => {
    const m = mockModel([{ text: 'ok' }])
    await runAgent(
      input(defineAgent({}), m.model, {
        history: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
          { role: 'user', content: 'How much is sourdough?' },
        ],
      })
    )
    expect(m.systemPrompt()).not.toContain('## Greeting')
  })

  it('passes only tools that are enabled in settings', async () => {
    const m = mockModel([{ text: 'ok' }])
    await runAgent(
      input(defineAgent({ tools: builtin.all() }), m.model, {
        settings: settings({ toolsEnabled: ['answerFromKnowledge', 'requestHuman', 'notDefined'] }),
      })
    )
    expect(m.toolNames().sort()).toEqual(['answerFromKnowledge', 'requestHuman'])
  })

  it('runs custom tools with typed input and context, and records the call', async () => {
    const run = vi.fn(
      async ({ orderId }: { orderId: string }, ctx: { customer: { phone: string } }) => ({
        orderId,
        status: 'shipped',
        phone: ctx.customer.phone,
      })
    )
    const checkOrder = defineTool({
      description: 'Look up an order',
      input: z.object({ orderId: z.string() }),
      run,
    })
    const m = mockModel([
      { toolCalls: [{ name: 'checkOrder', args: { orderId: 'A1' } }] },
      { text: 'Your order shipped.' },
    ])

    const result = await runAgent(
      input(defineAgent({ tools: { checkOrder } }), m.model, {
        settings: settings({ toolsEnabled: ['checkOrder'] }),
      })
    )

    expect(result.reply).toBe('Your order shipped.')
    expect(run).toHaveBeenCalledOnce()
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0]).toMatchObject({
      tool: 'checkOrder',
      input: { orderId: 'A1' },
      output: { status: 'shipped', phone: '+15551112222' },
    })
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10 })
  })

  it('reports tool errors to the model instead of failing the reply', async () => {
    const broken = defineTool({
      description: 'Always fails',
      input: z.object({}),
      run: () => {
        throw new Error('API down')
      },
    })
    const m = mockModel([
      { toolCalls: [{ name: 'broken', args: {} }] },
      { text: 'Sorry, try again later.' },
    ])
    const result = await runAgent(
      input(defineAgent({ tools: { broken } }), m.model, {
        settings: settings({ toolsEnabled: ['broken'] }),
      })
    )
    expect(result.reply).toBe('Sorry, try again later.')
    expect(result.toolCalls[0]?.error).toBe('API down')
    // The model sees a generic error, never the internal message.
    expect(JSON.stringify(m.calls[1]?.prompt)).not.toContain('API down')
    expect(JSON.stringify(m.calls[1]?.prompt)).toContain('The tool failed.')
  })

  it('caps how often a tool runs for one message', async () => {
    const run = vi.fn(async () => ({ ok: true }))
    const ping = defineTool({ description: 'Ping', input: z.object({}), run, maxCallsPerRun: 1 })
    const search = defineTool({ description: 'Search', input: z.object({}), run: async () => ({ found: true }) })
    const m = mockModel([
      { toolCalls: [{ name: 'ping', args: {} }, { name: 'ping', args: {} }] },
      { toolCalls: Array.from({ length: 12 }, () => ({ name: 'search', args: {} })) },
      { text: 'Done.' },
    ])
    const result = await runAgent(
      input(defineAgent({ tools: { ping, search } }), m.model, {
        settings: settings({ toolsEnabled: ['ping', 'search'] }),
      })
    )
    expect(result.reply).toBe('Done.')
    expect(run).toHaveBeenCalledOnce()
    const ran = result.toolCalls.filter((c) => !(c.output as { skipped?: boolean })?.skipped)
    // 10 calls are allowed in total (the refused second ping counts): 1 ping and 8 searches ran.
    expect(ran).toHaveLength(9)
    expect(result.toolCalls).toHaveLength(14)
  })

  it('saves at most one lead per message with the built-in tool', async () => {
    const m = mockModel([
      {
        toolCalls: [
          { name: 'collectLead', args: { name: 'Sam' } },
          { name: 'collectLead', args: { name: 'Sam' } },
          { name: 'collectLead', args: { name: 'Sam' } },
        ],
      },
      { text: 'Thanks!' },
    ])
    const svc = services()
    await runAgent(
      input(defineAgent({ tools: builtin.all() }), m.model, {
        services: svc,
        settings: settings({ toolsEnabled: ['collectLead'] }),
      })
    )
    expect(svc.leads.save).toHaveBeenCalledOnce()
  })

  it('limits how much the model may write', async () => {
    const m = mockModel([{ text: 'ok' }])
    await runAgent(input(defineAgent({}), m.model))
    expect(m.calls[0]?.maxOutputTokens).toBe(600)
    const m2 = mockModel([{ text: 'ok' }])
    await runAgent(input(defineAgent({ maxOutputTokens: 2000 }), m2.model))
    expect(m2.calls[0]?.maxOutputTokens).toBe(2000)
  })

  it('hands off via the requestHuman tool and calls onHandoff once', async () => {
    const onHandoff = vi.fn()
    const m = mockModel([
      { toolCalls: [{ name: 'requestHuman', args: { reason: 'wants refund' } }] },
      { text: 'A person will reply soon.' },
    ])
    const result = await runAgent(
      input(defineAgent({ tools: builtin.all(), hooks: { onHandoff } }), m.model, {
        settings: settings({ toolsEnabled: ['requestHuman'] }),
      })
    )
    expect(result.handoffReason).toBe('wants refund')
    expect(onHandoff).toHaveBeenCalledOnce()
    expect(onHandoff.mock.calls[0]?.[0]).toEqual({ reason: 'wants refund' })
  })

  it('names a renamed handoff tool in the escalation instructions', async () => {
    const m = mockModel([{ text: 'ok' }])
    await runAgent(
      input(defineAgent({ tools: { escalate: builtin.requestHuman() } }), m.model, {
        settings: settings({
          toolsEnabled: ['escalate'],
          escalationRules: [{ condition: 'sentiment', value: 'angry', action: 'handoff' }],
        }),
      })
    )
    expect(m.systemPrompt()).toContain('Use the escalate tool when:\n- The customer seems angry')
  })

  it('beforeReply can answer without calling the model', async () => {
    const m = mockModel([{ text: 'model' }])
    const result = await runAgent(
      input(
        defineAgent({ hooks: { beforeReply: () => ({ reply: 'We are closed today.' }) } }),
        m.model
      )
    )
    expect(result).toMatchObject({ reply: 'We are closed today.', source: 'hook' })
    expect(m.calls).toHaveLength(0)
  })

  it('beforeReply can skip replying', async () => {
    const m = mockModel([{ text: 'model' }])
    const result = await runAgent(
      input(defineAgent({ hooks: { beforeReply: () => ({ skip: true }) } }), m.model)
    )
    expect(result).toMatchObject({ reply: null, source: 'skipped' })
    expect(m.calls).toHaveLength(0)
  })

  it('keyword rules hand off deterministically and remove tools', async () => {
    const m = mockModel([{ text: 'A team member will reply here soon.' }])
    const result = await runAgent(
      input(
        defineAgent({ tools: builtin.all() }),
        m.model,
        {
          settings: settings({
            toolsEnabled: ['answerFromKnowledge'],
            escalationRules: [{ condition: 'keyword', value: 'refund', action: 'handoff' }],
          }),
        },
        'I want a REFUND now'
      )
    )
    expect(result.handoffReason).toBe('Customer said "refund"')
    expect(m.toolNames()).toEqual([])
    expect(m.systemPrompt()).toContain('## Handoff')
  })

  it('keyword rules match whole words only', async () => {
    const m = mockModel([{ text: 'ok' }])
    const result = await runAgent(
      input(
        defineAgent({}),
        m.model,
        {
          settings: settings({
            escalationRules: [{ condition: 'keyword', value: 'art', action: 'fallback' }],
          }),
        },
        'Do you have party cakes?'
      )
    )
    expect(result.source).toBe('model')
  })

  it('falls back when the model fails', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('rate limited')
      },
    })
    const result = await runAgent(input(defineAgent({}), model))
    expect(result).toMatchObject({
      reply: 'Sorry, something went wrong.',
      source: 'fallback',
      error: 'rate limited',
    })
  })

  it('sends nothing extra when a tool already messaged the customer', async () => {
    const svc = services()
    const m = mockModel([{ toolCalls: [{ name: 'sendLocation', args: {} }] }, { text: '' }])
    const result = await runAgent(
      input(defineAgent({ tools: builtin.all() }), m.model, {
        services: svc,
        settings: settings({
          toolsEnabled: ['sendLocation'],
          business: { businessName: 'Acme', location: '1 Main St', latitude: 1.5, longitude: 2.5 },
        }),
      })
    )
    expect(svc.sent).toEqual(['pin 1.5,2.5'])
    expect(result.reply).toBeNull()
  })

  it('afterReply can rewrite the reply', async () => {
    const m = mockModel([{ text: 'Hello' }])
    const result = await runAgent(
      input(
        defineAgent({ hooks: { afterReply: ({ reply }) => ({ reply: `${reply} 👋` }) } }),
        m.model
      )
    )
    expect(result.reply).toBe('Hello 👋')
  })

  it('an instructions function can replace the prompt and still use defaults', async () => {
    const m = mockModel([{ text: 'ok' }])
    await runAgent(
      input(
        defineAgent({
          instructions: ({ customer, defaults }) => `Customer is ${customer.name}.\n${defaults}`,
        }),
        m.model
      )
    )
    expect(m.systemPrompt()).toMatch(/^Customer is Sam\./)
    expect(m.systemPrompt()).toContain('Acme Bakery')
    expect(m.systemPrompt()).toContain('## WhatsApp rules')
  })

  it("shows the model a customer's photo with their message", async () => {
    const m = mockModel([{ text: 'That looks like a cracked tile.' }])
    const image = { data: new Uint8Array([1, 2, 3]), mediaType: 'image/jpeg' }
    await runAgent(
      input(defineAgent({}), m.model, {
        inbound: { text: '[Photo] what is this?', kind: 'image', image },
        history: [{ role: 'user', content: '[Photo] what is this?' }],
      })
    )
    const last = m.calls[0]?.prompt.at(-1)
    expect(last?.role).toBe('user')
    expect(last?.content).toEqual([
      { type: 'text', text: '[Photo] what is this?' },
      expect.objectContaining({ type: 'file', mediaType: 'image/jpeg' }),
    ])
    // The text isn't repeated as a separate message.
    expect(m.calls[0]?.prompt.filter((p) => p.role === 'user')).toHaveLength(1)
  })

  it('uses the definition model over the default model', async () => {
    const fallback = mockModel([{ text: 'default' }])
    const own = mockModel([{ text: 'own' }])
    const result = await runAgent(input(defineAgent({ model: own.model }), fallback.model))
    expect(result.reply).toBe('own')
    expect(fallback.calls).toHaveLength(0)
  })
})

describe('listTools', () => {
  it('lists names and descriptions', () => {
    const tools = listTools(defineAgent({ tools: builtin.all() }))
    expect(tools.map((t) => t.name)).toContain('answerFromKnowledge')
    expect(tools.every((t) => t.description.length > 0)).toBe(true)
  })
})
