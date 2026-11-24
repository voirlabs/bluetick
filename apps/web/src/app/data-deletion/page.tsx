import type { Metadata } from 'next'
import { Contact, LegalPage, Section } from '@/components/legal/legal-page'
import { getOperator } from '@/lib/legal'

export const metadata: Metadata = { title: 'Delete your data' }
export const dynamic = 'force-dynamic'

export default async function DataDeletionPage() {
  const { name, email } = await getOperator()

  return (
    <LegalPage title="Delete your data">
      <p>
        You can ask {name ?? 'us'} to delete everything we hold about you from our WhatsApp conversations
        at any time.
      </p>

      <Section title="How to ask">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            <Contact email={email} start /> and say you want your data deleted. Write from the WhatsApp number
            the conversation used, or include it, so we can find it.
          </li>
          <li>We confirm the request and delete your data within 30 days, usually much sooner.</li>
        </ol>
      </Section>

      <Section title="What gets deleted">
        <p>
          Your conversation with us, including every message, the text of your voice notes, and any
          requests or bookings it created.
        </p>
        <p>
          If you also asked us to stop messaging you, we keep your number on a do-not-message list so
          that we keep honouring it. Copies in our backups and in our providers&apos; logs expire on
          their own schedule.
        </p>
      </Section>

      <Section title="Just want the messages to stop?">
        <p>
          Send <strong className="font-semibold text-text">STOP</strong>. You&apos;ll get no more
          messages from us until you send <strong className="font-semibold text-text">START</strong>.
        </p>
      </Section>
    </LegalPage>
  )
}
