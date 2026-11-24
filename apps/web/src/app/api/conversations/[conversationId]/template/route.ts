import { NextRequest, NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { db } from '@/lib/db'
import { templateSendSchema, idSchema } from '@/lib/schemas'
import { getWhatsAppConfig } from '@/lib/whatsapp/config'
import { listApprovedTemplates, sendTemplate } from '@/lib/whatsapp/cloud-api'
import {
  missingValues,
  parseTemplate,
  renderTemplate,
  templateComponents,
} from '@/lib/whatsapp/templates'

/**
 * Sends one approved template to this conversation's customer: the only way to
 * write to them once their 24-hour window has closed. The template is looked up
 * again here, so only an approved one, with every variable filled, goes out.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!getWhatsAppConfig()) {
    return NextResponse.json({ error: 'WhatsApp is not configured' }, { status: 400 })
  }

  const parsed = templateSendSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Choose a template' }, { status: 400 })

  const { conversationId } = await params
  if (!idSchema.safeParse(conversationId).success) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const conv = await db.conversation.findUnique({ where: { id: conversationId } })
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (await db.optOut.findUnique({ where: { customerPhone: conv.customerPhone } })) {
    return NextResponse.json(
      { error: 'This customer sent STOP. They get no messages until they send START.' },
      { status: 409 }
    )
  }

  let raw
  try {
    raw = (await listApprovedTemplates()).find(
      (t) => t.name === parsed.data.name && t.language === parsed.data.language
    )
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not load templates' },
      { status: 502 }
    )
  }
  if (!raw) {
    return NextResponse.json({ error: 'That template is not approved for this account' }, { status: 400 })
  }
  const template = parseTemplate(raw)
  if (template.unsupported) return NextResponse.json({ error: template.unsupported }, { status: 400 })
  const missing = missingValues(template, parsed.data.values)
  if (missing.length) {
    return NextResponse.json({ error: `Fill in ${missing.map((m) => `{{${m}}}`).join(', ')}` }, { status: 400 })
  }

  let waMessageId: string
  try {
    waMessageId = await sendTemplate(
      conv.customerPhone,
      template.name,
      template.language,
      templateComponents(template, parsed.data.values)
    )
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to send: ${err instanceof Error ? err.message : 'unknown error'}` },
      { status: 502 }
    )
  }

  const message = await db.message.create({
    data: {
      conversationId,
      direction: 'outbound',
      contentType: 'template',
      content: renderTemplate(template, parsed.data.values),
      waMessageId,
    },
  })
  return NextResponse.json({ message })
}
