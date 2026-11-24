import { NextRequest, NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { db } from '@/lib/db'
import { conversationActionSchema, idSchema } from '@/lib/schemas'

type Params = { params: Promise<{ conversationId: string }> }

/** The conversation with its messages and what the agent captured (leads, bookings). */
export async function GET(_req: NextRequest, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { conversationId } = await params
  if (!idSchema.safeParse(conversationId).success) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      leads: { orderBy: { createdAt: 'desc' } },
      bookings: { orderBy: { createdAt: 'desc' } },
    },
  })
  if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ conversation })
}

const ACTIONS = {
  take_over: { handoffMode: true, status: 'needs_attention', resolvedAt: null },
  return_to_agent: { handoffMode: false, status: 'active', resolvedAt: null },
  // Resolving also hands back to the agent, so the customer's next message gets a reply.
  resolve: { handoffMode: false, status: 'resolved' },
} as const

export async function PATCH(req: NextRequest, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = conversationActionSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  const { conversationId } = await params
  if (!idSchema.safeParse(conversationId).success) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const { action } = parsed.data
  const updated = await db.conversation
    .update({
      where: { id: conversationId },
      data: { ...ACTIONS[action], ...(action === 'resolve' ? { resolvedAt: new Date() } : {}) },
    })
    .catch(() => null)
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ conversation: updated })
}

/**
 * Deletes the conversation with its messages, leads and bookings (they
 * cascade). An opt-out is kept: it's keyed by phone number, so the agent still
 * honours STOP if the customer writes again.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { conversationId } = await params
  if (!idSchema.safeParse(conversationId).success) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const { count } = await db.conversation.deleteMany({ where: { id: conversationId } })
  if (count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
