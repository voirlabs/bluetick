import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, Circle } from 'lucide-react'
import { requireSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { getAgent } from '@/lib/agent/definition'
import { getWhatsAppConfig } from '@/lib/whatsapp/config'
import { FREE_SERVICE_MESSAGES, loadUsage } from '@/lib/usage'
import { cn } from '@/lib/utils'
import { PageHeader, PAGE } from '@/components/dashboard/page-header'
import { TickMark } from '@/components/tick-mark'

export const metadata: Metadata = { title: 'Overview' }

/** The counts the overview needs besides this month's usage. */
async function loadStatus() {
  const [needsAttention, sources, firstInbound] = await Promise.all([
    db.conversation.count({ where: { status: 'needs_attention' } }),
    db.knowledgeSource.count({ where: { indexStatus: 'indexed' } }),
    db.message.findFirst({ where: { direction: 'inbound' }, select: { id: true } }),
  ])
  return { needsAttention, sources, hasCustomers: firstInbound !== null }
}

export default async function OverviewPage() {
  await requireSession()

  const agent = await getAgent()
  if (!agent) redirect('/dashboard/setup')

  const [{ needsAttention, sources, hasCustomers }, usage] = await Promise.all([
    loadStatus(),
    loadUsage(),
  ])
  const fmt = (n: number) => n.toLocaleString('en-US')
  const breakdown = (items: { label: string; count: number }[]) =>
    items.map((x) => `${x.label} ${fmt(x.count)}`).join(' · ') || 'None yet'
  const month = new Date().toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
  const stats = [
    {
      label: 'Conversations',
      value: fmt(usage.conversations),
      hint: 'With customers',
    },
    {
      label: 'Handed to a person',
      value: usage.handoffRate === null ? 'n/a' : `${usage.handoffRate}%`,
      hint: 'Of those conversations',
    },
    { label: 'Customer messages', value: fmt(usage.customerMessages), hint: breakdown(usage.customerBreakdown) },
    { label: 'Replies sent', value: fmt(usage.replies), hint: breakdown(usage.replyBreakdown) },
    {
      label: 'Model tokens',
      value: fmt(usage.inputTokens + usage.outputTokens),
      hint: `${fmt(usage.inputTokens)} in · ${fmt(usage.outputTokens)} out`,
    },
  ]
  const whatsapp = !!getWhatsAppConfig()
  const active = agent.status === 'active'

  const steps = [
    { done: true, label: 'Set up the agent', href: '/dashboard/agent', action: 'Edit' },
    {
      done: sources > 0,
      label: 'Add knowledge: documents, pages or snippets',
      href: '/dashboard/agent?tab=knowledge',
      action: 'Add',
    },
    { done: whatsapp, label: 'Connect WhatsApp', href: '/dashboard/whatsapp', action: 'Connect' },
    {
      done: hasCustomers,
      label: 'Get your first customer message',
      href: '/dashboard/whatsapp',
      action: 'Test',
    },
  ]
  const live = steps.every((s) => s.done)

  return (
    <div className={PAGE}>
      <PageHeader
        title="Overview"
        description={
          <p className="flex items-center gap-2">
            <span
              className={cn(
                'inline-block h-2 w-2 shrink-0 rounded-full',
                active ? 'bg-success' : 'bg-warning'
              )}
              aria-hidden
            />
            {agent.name} is {active ? 'replying to customers' : 'paused: messages wait in the inbox'}
          </p>
        }
      />

      {!live && (
        <section aria-labelledby="steps-title" className="mb-10">
          <h2 id="steps-title" className="section-label mb-3">
            Getting live
          </h2>
          <ol className="divide-y divide-line border-y border-line">
            {steps.map((step) => (
              <li key={step.label} className="flex items-center gap-3 py-4">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  {step.done ? (
                    <TickMark className="h-4 w-4 text-accent" label="Done" />
                  ) : (
                    <Circle className="h-4 w-4 text-faint" aria-label="To do" />
                  )}
                </span>
                <span className={cn('flex-1 text-sm', step.done ? 'text-muted' : 'text-text')}>
                  {step.label}
                </span>
                {!step.done && (
                  <Link
                    href={step.href}
                    className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-accent transition-colors hover:text-accent-2"
                  >
                    {step.action}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section aria-labelledby="usage-title">
        <h2 id="usage-title" className="section-label mb-3">
          {month} so far
        </h2>
        <dl className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <div className="col-span-2 rounded-xl border border-card-line bg-card p-6 lg:col-span-5">
            <dt className="section-label">Needs attention</dt>
            <dd
              className={cn(
                'figure mt-3 text-[40px]',
                needsAttention > 0 ? 'text-warning' : 'text-text'
              )}
            >
              {fmt(needsAttention)}
            </dd>
            <dd className="mt-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm text-faint">
              {needsAttention === 1 ? 'Conversation' : 'Conversations'} waiting for a person now
              {needsAttention > 0 && (
                <Link
                  href="/dashboard/inbox"
                  className="inline-flex items-center gap-1 rounded-md font-medium text-accent transition-colors hover:text-accent-2"
                >
                  Open inbox
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              )}
            </dd>
          </div>
          {stats.map((s) => (
            <div key={s.label} className="min-w-0 rounded-xl border border-card-line bg-card p-5">
              <dt className="section-label truncate">{s.label}</dt>
              <dd className="figure mt-3 text-[28px] text-text">{s.value}</dd>
              <dd className="mt-2 truncate text-xs text-faint" title={s.hint}>
                {s.hint}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm text-muted">
          {fmt(usage.serviceMessages)} of Meta&apos;s {fmt(FREE_SERVICE_MESSAGES)} free service
          replies used this month ({fmt(usage.freeServiceLeft)} left). After that, and for
          templates, Meta charges by the customer&apos;s country:{' '}
          <a
            href="https://developers.facebook.com/docs/whatsapp/pricing"
            target="_blank"
            rel="noreferrer"
            className="text-accent underline-offset-4 hover:underline"
          >
            Meta&apos;s pricing
          </a>
          .
        </p>
      </section>
    </div>
  )
}
