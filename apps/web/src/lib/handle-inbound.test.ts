import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboundWhatsAppMessage } from '@/lib/whatsapp/webhook'

const m = vi.hoisted(() => ({
  db: {
    conversation: {
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    message: {
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    optOut: { upsert: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
  },
  runAgent: vi.fn(),
  getAgent: vi.fn(),
  sendText: vi.fn(),
  sendAlert: vi.fn(),
  readMedia: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: m.db }))
vi.mock('@bluetick/agent', () => ({ runAgent: m.runAgent }))
vi.mock('@/lib/agent/definition', () => ({
  agentDefinition: {},
  getAgent: m.getAgent,
  toAgentSettings: (agent: unknown) => agent,
}))
vi.mock('@/lib/agent/models', () => ({ defaultModel: () => 'model' }))
vi.mock('@/lib/agent/services', () => ({ createLiveServices: () => ({}) }))
vi.mock('@/lib/alerts', () => ({ sendAlert: m.sendAlert }))
vi.mock('@/lib/media', () => ({ readMedia: m.readMedia }))
vi.mock('@/lib/whatsapp/cloud-api', () => ({
  markReadAndShowTyping: async () => {},
  sendText: m.sendText,
}))

const { handleInboundMessage } = await import('./handle-inbound')

const conversation = {
  id: 'conv-1',
  customerPhone: '+15550001111',
  customerName: 'Sam',
  status: 'active',
  handoffMode: false,
  memory: {},
}

function message(text: string, overrides: Partial<InboundWhatsAppMessage> = {}): InboundWhatsAppMessage {
  return {
    id: `wamid.${Math.random()}`,
    from: '15550001111',
    contactName: 'Sam',
    timestamp: new Date(),
    kind: 'text',
    type: 'text',
    text,
    ...overrides,
  }
}

/** Messages the customer has sent in the last 10 minutes and the last day. */
function sentRecently(last10Minutes: number, lastDay = last10Minutes) {
  m.db.message.count.mockImplementation(async ({ where }: { where: { createdAt: { gte: Date } } }) =>
    Date.now() - where.createdAt.gte.getTime() > 60 * 60 * 1000 ? lastDay : last10Minutes
  )
}

const systemNotes = () =>
  m.db.message.create.mock.calls
    .map(([arg]) => arg.data)
    .filter((d: { direction: string }) => d.direction === 'system')

beforeEach(() => {
  vi.clearAllMocks()
  m.db.conversation.upsert.mockResolvedValue(conversation)
  m.db.conversation.updateMany.mockResolvedValue({ count: 1 })
  m.db.conversation.findUnique.mockResolvedValue({ handoffMode: false })
  m.db.message.create.mockImplementation(async ({ data }: { data: object }) => ({
    id: 'msg-1',
    createdAt: new Date(),
    ...data,
  }))
  m.db.message.findMany.mockResolvedValue([])
  m.db.message.findFirst.mockResolvedValue(null)
  m.db.optOut.findUnique.mockResolvedValue(null)
  sentRecently(1)
  m.getAgent.mockResolvedValue({ id: 'default', status: 'active' })
  m.readMedia.mockImplementation(async (msg: InboundWhatsAppMessage) => ({ text: msg.text }))
  m.runAgent.mockResolvedValue({
    reply: 'Hello!',
    handoffReason: null,
    toolCalls: [],
    usage: { inputTokens: 1, outputTokens: 1 },
    source: 'model',
  })
  m.sendText.mockResolvedValue('wamid.out')
})

describe('handleInboundMessage', () => {
  it('stores the message, runs the agent and sends the reply', async () => {
    await handleInboundMessage(message('Hi'))
    expect(m.db.message.create.mock.calls[0]?.[0].data).toMatchObject({ direction: 'inbound', content: 'Hi' })
    expect(m.runAgent).toHaveBeenCalledOnce()
    expect(m.sendText).toHaveBeenCalledWith('+15550001111', 'Hello!')
  })

  it('ignores a repeated delivery of the same message', async () => {
    m.db.message.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' })
    )
    await handleInboundMessage(message('Hi'))
    expect(m.runAgent).not.toHaveBeenCalled()
    expect(m.sendText).not.toHaveBeenCalled()
  })

  it('opts the customer out on STOP without replying', async () => {
    await handleInboundMessage(message('STOP'))
    expect(m.db.optOut.upsert).toHaveBeenCalledOnce()
    expect(m.runAgent).not.toHaveBeenCalled()
    expect(m.sendText).not.toHaveBeenCalled()
  })

  it('stores but ignores messages from an opted-out customer until START', async () => {
    m.db.optOut.findUnique.mockResolvedValue({ customerPhone: '+15550001111' })
    await handleInboundMessage(message('hello?'))
    expect(m.db.message.create).toHaveBeenCalledOnce()
    expect(m.runAgent).not.toHaveBeenCalled()

    await handleInboundMessage(message('START'))
    expect(m.db.optOut.delete).toHaveBeenCalledOnce()
    expect(m.runAgent).toHaveBeenCalledOnce()
  })

  it('over the limit, stores the message, skips the agent and flags a person once', async () => {
    sentRecently(21)
    await handleInboundMessage(message('spam', { kind: 'voice', type: 'audio', media: { id: 'm1' } }))
    expect(m.db.message.create.mock.calls[0]?.[0].data).toMatchObject({ direction: 'inbound' })
    expect(m.runAgent).not.toHaveBeenCalled()
    expect(m.readMedia).not.toHaveBeenCalled()
    expect(m.sendText).not.toHaveBeenCalled()
    expect(systemNotes()).toHaveLength(1)
    expect(m.sendAlert).toHaveBeenCalledOnce()

    // Already flagged today: the next one is stored without another note or alert.
    m.db.conversation.updateMany.mockResolvedValue({ count: 0 })
    vi.clearAllMocks()
    await handleInboundMessage(message('more spam'))
    expect(m.runAgent).not.toHaveBeenCalled()
    expect(systemNotes()).toHaveLength(0)
    expect(m.sendAlert).not.toHaveBeenCalled()
  })

  it('applies the daily limit too, and STOP still works over the limit', async () => {
    sentRecently(2, 151)
    await handleInboundMessage(message('hi'))
    expect(m.runAgent).not.toHaveBeenCalled()

    await handleInboundMessage(message('stop'))
    expect(m.db.optOut.upsert).toHaveBeenCalledOnce()
  })
})
