import type { Metadata } from 'next'
import { requireSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { PageHeader } from '@/components/dashboard/page-header'
import { InboxView } from '@/components/dashboard/inbox-view'

export const metadata: Metadata = { title: 'Inbox' }

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>
}) {
  await requireSession()
  const { c } = await searchParams

  const conversations = await db.conversation.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 200,
    include: {
      messages: {
        where: { direction: { in: ['inbound', 'outbound'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { content: true, direction: true },
      },
    },
  })

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        bar
        title="Inbox"
        description="Every WhatsApp conversation. Take over to reply yourself, then hand it back."
      />
      <InboxView
        initialId={typeof c === 'string' && c ? c : null}
        conversations={conversations.map(({ messages, ...c }) => ({
          ...c,
          lastMessage: messages[0] ?? null,
        }))}
      />
    </div>
  )
}
