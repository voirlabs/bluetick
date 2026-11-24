import type { Metadata } from 'next'
import { Contact, LegalPage, Section } from '@/components/legal/legal-page'
import { getOperator } from '@/lib/legal'

export const metadata: Metadata = { title: 'Privacy policy' }
export const dynamic = 'force-dynamic'

export default async function PrivacyPage() {
  const { name, email } = await getOperator()

  return (
    <LegalPage title="Privacy policy">
      <p>
        This policy covers {name ? `the WhatsApp assistant run by ${name}` : 'our WhatsApp assistant'}. When you message us on WhatsApp, an
        automated assistant answers, and our staff can read the conversation and reply themselves.
      </p>

      <Section title="What we collect">
        <ul className="list-disc space-y-2 pl-5">
          <li>Your WhatsApp phone number and the profile name WhatsApp shows us.</li>
          <li>
            The messages you send and our replies. Voice notes are turned into text and we keep the
            text, not the recording. Photos are looked at to answer you and aren&apos;t stored.
          </li>
          <li>A location, if you share one.</li>
          <li>
            Details you give us for a request, such as your name, contact details, a booking time or an
            order number.
          </li>
          <li>Whether you&apos;ve asked us to stop messaging you.</li>
        </ul>
      </Section>

      <Section title="How we use it">
        <p>
          Only to answer your messages and handle what you ask for: questions, bookings, orders or
          passing you to a person. We don&apos;t sell your data or use it for advertising.
        </p>
      </Section>

      <Section title="Who else handles it">
        <ul className="list-disc space-y-2 pl-5">
          <li>Meta, which runs WhatsApp and delivers the messages.</li>
          <li>
            The AI model provider that writes the assistant&apos;s replies, which receives the text of the
            conversation.
          </li>
          <li>Our hosting and database providers, which store the conversation for us.</li>
          <li>
            Our own team chat or alert tools, which may get a short summary when a request comes in or
            a conversation needs a person.
          </li>
        </ul>
      </Section>

      <Section title="How long we keep it">
        <p>
          We keep conversations, requests and bookings until we delete them or you ask us to. If you
          ask us to stop messaging you, we keep your number on a do-not-message list so we can honour
          that.
        </p>
      </Section>

      <Section title="Your choices">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Send <strong className="font-semibold text-text">STOP</strong> and you&apos;ll get no more
            messages from us. Send <strong className="font-semibold text-text">START</strong> to undo it.
          </li>
          <li>
            To see, correct or delete what we hold about you, <Contact email={email} />. See{' '}
            <a href="/data-deletion" className="text-accent underline-offset-4 hover:underline">
              how to delete your data
            </a>
            .
          </li>
        </ul>
      </Section>
    </LegalPage>
  )
}
