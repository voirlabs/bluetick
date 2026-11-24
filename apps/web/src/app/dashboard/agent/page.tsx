import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { availableTools, getAgent, toAgentSettings } from '@/lib/agent/definition'
import { PageHeader, PAGE } from '@/components/dashboard/page-header'
import { AgentCard, type AgentTab } from '@/components/dashboard/agent-card'

export const metadata: Metadata = { title: 'Agent' }

const TABS: AgentTab[] = ['config', 'business', 'knowledge', 'simulator']

export default async function AgentPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  await requireSession()

  const agent = await getAgent()
  if (!agent) redirect('/dashboard/setup')

  const sources = await db.knowledgeSource.findMany({ orderBy: { createdAt: 'asc' } })
  const { tab } = await searchParams
  const initialTab = TABS.includes(tab as AgentTab) ? (tab as AgentTab) : 'config'

  return (
    <div className={PAGE}>
      <PageHeader
        title={agent.name}
        description="Tune the prompt and business details, add knowledge and test replies"
        actions={
          <Link
            href="/dashboard/setup"
            className="rounded-md text-sm font-medium text-muted transition-colors hover:text-text"
          >
            Run setup again
          </Link>
        }
      />
      <AgentCard
        settings={toAgentSettings(agent)}
        status={agent.status}
        knowledgeSources={sources}
        availableTools={availableTools}
        initialTab={initialTab}
      />
    </div>
  )
}
