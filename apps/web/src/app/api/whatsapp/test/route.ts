import { NextRequest, NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { testMessageSchema } from '@/lib/schemas'
import { getWhatsAppConfig } from '@/lib/whatsapp/config'
import { sendTemplate } from '@/lib/whatsapp/cloud-api'

/**
 * Sends Meta's pre-approved `hello_world` template. Templates are the only
 * message type allowed before the recipient has written to you, so this works
 * on a brand-new test number.
 */
export async function POST(req: NextRequest) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!getWhatsAppConfig())
    return NextResponse.json({ error: 'WhatsApp is not configured' }, { status: 400 })

  const parsed = testMessageSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 }
    )
  }

  try {
    const messageId = await sendTemplate(parsed.data.to, 'hello_world', 'en_US')
    return NextResponse.json({ ok: true, messageId })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to send test message' },
      { status: 502 }
    )
  }
}
