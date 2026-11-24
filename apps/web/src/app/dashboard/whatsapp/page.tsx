import type { Metadata } from 'next'
import { requireSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { APP_URL, REPO_URL } from '@/lib/site'
import { getAgent } from '@/lib/agent/definition'
import { getWhatsAppConfig, getWhatsAppConfigStatus } from '@/lib/whatsapp/config'
import {
  checkAppLink,
  getPhoneNumberInfo,
  WhatsAppApiError,
  type AppLink,
  type PhoneNumberInfo,
} from '@/lib/whatsapp/cloud-api'
import { logger } from '@/lib/log'
import { setupSteps, type SetupInput } from '@/lib/whatsapp/setup'
import { webhookHealth } from '@/lib/whatsapp/webhook-health'
import { PageHeader, PAGE } from '@/components/dashboard/page-header'
import { WhatsAppSetupPanel } from '@/components/dashboard/whatsapp-setup-panel'

export const metadata: Metadata = { title: 'WhatsApp' }

const log = logger('whatsapp-setup')

const ENV_NAMES = {
  phoneNumberId: 'WHATSAPP_PHONE_NUMBER_ID',
  accessToken: 'WHATSAPP_ACCESS_TOKEN',
  appSecret: 'WHATSAPP_APP_SECRET',
  verifyToken: 'WHATSAPP_VERIFY_TOKEN',
} as const

export default async function WhatsAppPage() {
  await requireSession()

  const status = getWhatsAppConfigStatus()
  const configured = !!getWhatsAppConfig()

  let phone: PhoneNumberInfo | null = null
  let phoneError: SetupInput['phoneError'] = null
  let link: AppLink | null = null
  if (configured) {
    try {
      ;[phone, link] = await Promise.all([
        getPhoneNumberInfo(),
        // A hint, not a gate: if Meta won't answer this, the other steps still work.
        checkAppLink().catch((err) => {
          log.warn('could not check the Meta app link', { error: err instanceof Error ? err.message : String(err) })
          return null
        }),
      ])
    } catch (err) {
      phoneError =
        err instanceof WhatsAppApiError
          ? { message: err.message, status: err.status, code: err.code }
          : { message: err instanceof Error ? err.message : 'Could not reach the WhatsApp Cloud API' }
    }
  }

  const [agent, lastInbound] = await Promise.all([
    getAgent(),
    db.message.findFirst({
      where: { direction: 'inbound' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ])
  const webhookUrl = `${APP_URL}/api/webhooks/whatsapp`
  const health = webhookHealth()

  const steps = setupSteps({
    missingEnv: (Object.keys(ENV_NAMES) as Array<keyof typeof ENV_NAMES>)
      .filter((k) => !status[k])
      .map((k) => ENV_NAMES[k]),
    phone,
    phoneError,
    link,
    webhookUrl,
    lastInboundAt: lastInbound?.createdAt ?? null,
    verifyFailedAt: health.verifyFailedAt,
    signatureFailedAt: health.signatureFailedAt,
    activeAgentName: agent?.status === 'active' ? agent.name : null,
  })

  return (
    <div className={PAGE}>
      <PageHeader
        title="WhatsApp"
        description={
          <>
            Connect your number through Meta&apos;s official Cloud API. Work down the list; each step
            checks itself when you reload. The{' '}
          <a
            href={`${REPO_URL}/blob/main/docs/whatsapp-setup.md`}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline-offset-4 hover:underline"
          >
            setup guide
          </a>{' '}
            has screenshots of each Meta screen.
          </>
        }
      />
      <div className="max-w-3xl">
        <WhatsAppSetupPanel
        steps={steps}
        canSend={configured && !!phone}
        qualityRating={phone?.quality_rating ?? null}
          webhookUrl={webhookUrl}
        />
      </div>
    </div>
  )
}
