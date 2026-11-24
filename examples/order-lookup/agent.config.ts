/**
 * E-commerce order lookup agent.
 *
 * Shows: calling your own API from a tool, checking the order belongs to the
 * WhatsApp number asking (never leak other customers' orders), memory, and
 * handing returns to a human.
 *
 * Use it: cp examples/order-lookup/agent.config.ts apps/web/agent.config.ts
 * Then set ORDER_API_URL (and ORDER_API_TOKEN) or leave unset for demo data.
 */
import { builtin, defineAgent, defineTool } from '@bluetick/agent'
import { z } from 'zod'

export interface Order {
  id: string
  /** Customer phone in E.164, as stored by your shop. */
  phone: string
  status: 'processing' | 'shipped' | 'delivered' | 'cancelled'
  items: string[]
  total: string
  eta?: string
  trackingUrl?: string
}

// Used when ORDER_API_URL is not set, so you can try the agent in the simulator.
const DEMO_ORDERS: Record<string, Order> = {
  AC1001: {
    id: 'AC1001',
    phone: 'demo',
    status: 'shipped',
    items: ['Linen shirt (M)'],
    total: '$48.00',
    eta: 'Thursday',
    trackingUrl: 'https://example.com/track/AC1001',
  },
  AC1002: {
    id: 'AC1002',
    phone: 'demo',
    status: 'processing',
    items: ['Canvas tote', 'Socks x3'],
    total: '$36.00',
  },
}

/** Replace with your store's API (Shopify, WooCommerce, your backend). */
async function fetchOrder(id: string): Promise<Order | null> {
  const base = process.env['ORDER_API_URL']
  if (!base) return DEMO_ORDERS[id.toUpperCase()] ?? null

  const res = await fetch(`${base.replace(/\/$/, '')}/orders/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${process.env['ORDER_API_TOKEN'] ?? ''}` },
    signal: AbortSignal.timeout(8_000),
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Order API returned HTTP ${res.status}`)
  return (await res.json()) as Order
}

const digits = (phone: string) => phone.replace(/\D/g, '')

/** An order is visible only to the phone number that placed it (demo orders to anyone). */
export function ownsOrder(order: Order, customerPhone: string) {
  return order.phone === 'demo' || digits(order.phone) === digits(customerPhone)
}

const orderId = z.string().min(3).max(40).describe('Order number, e.g. AC1001')

async function findOwnOrder(id: string, customerPhone: string) {
  const order = await fetchOrder(id)
  // Same answer for "doesn't exist" and "not yours", so order numbers can't be probed.
  return order && ownsOrder(order, customerPhone) ? order : null
}

const lookupOrder = defineTool({
  description: "Get the status, items and delivery estimate of one of the customer's orders.",
  input: z.object({ orderId }),
  run: async ({ orderId }, ctx) => {
    const order = await findOwnOrder(orderId, ctx.customer.phone)
    if (!order) return { found: false, note: 'No order with that number for this WhatsApp number.' }
    await ctx.memory.set('lastOrderId', order.id)
    const { phone: _phone, ...visible } = order
    return { found: true, ...visible }
  },
})

const requestReturn = defineTool({
  description: 'Start a return or refund for an order. A team member takes over the conversation.',
  input: z.object({ orderId, reason: z.string().min(2) }),
  run: async ({ orderId, reason }, ctx) => {
    const order = await findOwnOrder(orderId, ctx.customer.phone)
    if (!order)
      return { started: false, note: 'No order with that number for this WhatsApp number.' }
    if (order.status !== 'delivered' && order.status !== 'shipped') {
      return { started: false, note: `Order is ${order.status}; returns open once it has shipped.` }
    }
    ctx.handoff(`Return request for ${order.id}: ${reason}`)
    return { started: true }
  },
})

export default defineAgent({
  // A function gets the dashboard prompt as `defaults` plus `ctx`, so it can use memory.
  instructions: async ({ defaults, ctx }) => {
    const lastOrderId = await ctx.memory.get<string>('lastOrderId')
    return `${defaults}

## Orders
Ask for the order number if the customer has not given one. Order numbers look like AC1001.
Share tracking links as plain URLs.${lastOrderId ? `\nEarlier in this chat you looked up order ${lastOrderId}. Use it when they say "my order".` : ''}`
  },

  tools: {
    lookupOrder,
    requestReturn,
    answerFromKnowledge: builtin.knowledge(),
    requestHuman: builtin.requestHuman(),
  },
})
