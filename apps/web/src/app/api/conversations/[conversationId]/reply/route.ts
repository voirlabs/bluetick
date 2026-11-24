import { NextRequest, NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { db } from '@/lib/db'
import { manualReplySchema, idSchema } from '@/lib/schemas'
import { getWhatsAppConfig } from '@/lib/whatsapp/config'
import { sendText, WhatsAppApiError } from '@/lib/whatsapp/cloud-api'
import { isWithinServiceWindow } from '@/lib/whatsapp/service-window'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { conversationId } = await params
  if (!idSchema.safeParse(conversationId).success) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const conv = await db.conversation.findUnique({ where: { id: conversationId } })
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!conv.handoffMode) {
    return NextResponse.json({ error: 'Conversation is not in handoff mode' }, { status: 400 })
  }
  if (await db.optOut.findUnique({ where: { customerPhone: conv.customerPhone } })) {
    return NextResponse.json(
      { error: 'This customer sent STOP. They get no messages until they send START.' },
      { status: 409 }
    )
  }
  if (!getWhatsAppConfig()) {
    return NextResponse.json({ error: 'WhatsApp is not configured' }, { status: 400 })
  }
  if (!isWithinServiceWindow(conv.lastInboundAt)) {
    return NextResponse.json(
      {
        error:
          'More than 24 hours since the customer last wrote. WhatsApp only allows approved template messages now.',
      },
      { status: 409 }
    )
  }

  const parsed = manualReplySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Write a message first' }, { status: 400 })

  let waMessageId: string
  try {
    waMessageId = await sendText(conv.customerPhone, parsed.data.message)
  } catch (err) {
    const message =
      err instanceof WhatsAppApiError && err.isOutsideServiceWindow
        ? 'More than 24 hours since the customer last wrote. WhatsApp only allows approved template messages now.'
        : `Failed to send: ${err instanceof Error ? err.message : 'unknown error'}`
    return NextResponse.json({ error: message }, { status: 502 })
  }

  const message = await db.message.create({
    data: {
      conversationId,
      direction: 'outbound',
      content: parsed.data.message,
      waMessageId,
    },
  })

  return NextResponse.json({ message })
}
