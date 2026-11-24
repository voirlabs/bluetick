import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { getWhatsAppConfig } from '@/lib/whatsapp/config'
import { listApprovedTemplates, TemplatesNotConfiguredError } from '@/lib/whatsapp/cloud-api'
import { parseTemplate } from '@/lib/whatsapp/templates'

/** Approved templates the inbox can offer, with the reason any can't be sent. */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!getWhatsAppConfig()) {
    return NextResponse.json({ error: 'WhatsApp is not configured' }, { status: 400 })
  }
  try {
    const templates = (await listApprovedTemplates()).map(parseTemplate)
    return NextResponse.json({ templates })
  } catch (err) {
    const status = err instanceof TemplatesNotConfiguredError ? 400 : 502
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not load templates' },
      { status }
    )
  }
}
