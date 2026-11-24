import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAgent } from '@bluetick/agent'
import { mockModel, testRun } from '@bluetick/agent/testing'
import agent, { ownsOrder, type Order } from './agent.config'

const SAM = '+15551112222'
const order = (overrides: Partial<Order> = {}): Order => ({
  id: 'AC2001',
  phone: SAM,
  status: 'shipped',
  items: ['Linen shirt'],
  total: '$48.00',
  eta: 'Thursday',
  ...overrides,
})

/** Point the agent at a fake store API that knows one order. */
function stubStore(o: Order) {
  vi.stubEnv('ORDER_API_URL', 'https://shop.test/api')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith(`/orders/${o.id}`)
        ? new Response(JSON.stringify(o), { status: 200 })
        : new Response('not found', { status: 404 })
    )
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const lookup = (orderId: string) =>
  mockModel([
    { toolCalls: [{ name: 'lookupOrder', args: { orderId } }] },
    { text: 'Here is your order.' },
  ])

describe('ownership', () => {
  it('matches phone numbers regardless of formatting', () => {
    expect(ownsOrder(order({ phone: '+1 (555) 111-2222' }), SAM)).toBe(true)
    expect(ownsOrder(order(), '+15559999999')).toBe(false)
  })
})

describe('order agent', () => {
  it('returns the order to its owner, without the phone number, and remembers it', async () => {
    stubStore(order())
    const { input, record } = testRun(agent, 'Where is AC2001?', {
      model: lookup('AC2001'),
      customerPhone: SAM,
    })
    const result = await runAgent(input)

    const output = result.toolCalls[0]?.output as Record<string, unknown>
    expect(output).toMatchObject({ found: true, status: 'shipped', eta: 'Thursday' })
    expect(output).not.toHaveProperty('phone')
    expect(record.memory.get('lastOrderId')).toBe('AC2001')
  })

  it("does not reveal someone else's order", async () => {
    stubStore(order())
    const { input } = testRun(agent, 'Where is AC2001?', {
      model: lookup('AC2001'),
      customerPhone: '+15559999999',
    })
    const result = await runAgent(input)
    expect(result.toolCalls[0]?.output).toMatchObject({ found: false })
  })

  it('uses demo orders when no store API is configured', async () => {
    const { input } = testRun(agent, 'AC1001?', { model: lookup('AC1001') })
    const result = await runAgent(input)
    expect(result.toolCalls[0]?.output).toMatchObject({ found: true, id: 'AC1001' })
  })

  it('hands shipped orders to a human for returns', async () => {
    stubStore(order())
    const model = mockModel([
      { toolCalls: [{ name: 'requestReturn', args: { orderId: 'AC2001', reason: 'wrong size' } }] },
      { text: 'A team member will help with your return.' },
    ])
    const { input } = testRun(agent, 'I want to return AC2001, wrong size', {
      model,
      customerPhone: SAM,
    })
    const result = await runAgent(input)
    expect(result.handoffReason).toBe('Return request for AC2001: wrong size')
  })

  it('does not start returns for orders that have not shipped', async () => {
    stubStore(order({ status: 'processing' }))
    const model = mockModel([
      {
        toolCalls: [{ name: 'requestReturn', args: { orderId: 'AC2001', reason: 'changed mind' } }],
      },
      { text: 'You can cancel instead.' },
    ])
    const { input } = testRun(agent, 'Return AC2001', { model, customerPhone: SAM })
    const result = await runAgent(input)
    expect(result.handoffReason).toBeNull()
  })

  it('puts the remembered order in the prompt', async () => {
    const { input, record } = testRun(agent, 'and my order?', {
      model: mockModel([{ text: 'ok' }]),
    })
    record.memory.set('lastOrderId', 'AC1001')
    if (typeof agent.instructions !== 'function')
      throw new Error('expected an instructions function')
    const prompt = await agent.instructions({
      settings: input.settings,
      customer: input.customer,
      defaults: 'DEFAULTS',
      ctx: {
        ...input.services,
        settings: input.settings,
        business: {},
        customer: input.customer,
        conversationId: 'c',
        simulated: false,
        handoff: () => {},
      },
    })
    expect(prompt).toContain('DEFAULTS')
    expect(prompt).toContain('looked up order AC1001')
  })
})
