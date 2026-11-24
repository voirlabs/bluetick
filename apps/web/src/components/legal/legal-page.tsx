import Link from 'next/link'
import { Lockup } from '@/components/lockup'
import { LEGAL_UPDATED } from '@/lib/legal'

/** Public, signed-out page for the privacy policy and data deletion instructions. */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
      <Lockup size={28} className="mb-12" />
      <h1 className="display mb-2 text-[40px] leading-tight">{title}</h1>
      <p className="mb-10 text-sm text-faint">Last updated {LEGAL_UPDATED}</p>
      <div className="legal space-y-8 text-[15px] leading-relaxed text-text-2">{children}</div>
      <nav className="mt-16 flex gap-6 border-t border-line pt-6 text-sm text-muted">
        <Link href="/privacy" className="hover:text-text">
          Privacy policy
        </Link>
        <Link href="/data-deletion" className="hover:text-text">
          Delete your data
        </Link>
      </nav>
    </main>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      {children}
    </section>
  )
}

/** "email us at x" or "message us on WhatsApp", depending on what's configured. */
export function Contact({ email, start = false }: { email: string | null; start?: boolean }) {
  return email ? (
    <>
      {start ? 'Email' : 'email'}{' '}
      <a href={`mailto:${email}`} className="text-accent underline-offset-4 hover:underline">
        {email}
      </a>{' '}
      or send us a message on WhatsApp
    </>
  ) : (
    <>{start ? 'Send' : 'send'} us a message on WhatsApp</>
  )
}
