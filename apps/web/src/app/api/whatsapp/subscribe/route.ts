import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { getWhatsAppConfig } from '@/lib/whatsapp/config'
import { subscribeApp } from '@/lib/whatsapp/cloud-api'

/** Subscribes the app to the WhatsApp account's webhooks, so Meta delivers its messages here. */
export async function POST() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!getWhatsAppConfig())
    return NextResponse.json({ error: 'WhatsApp is not configured' }, { status: 400 })

  try {
    await subscribeApp()
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Subscribing failed' },
      { status: 502 }
    )
  }
}
