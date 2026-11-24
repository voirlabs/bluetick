import { requireSession } from '@/lib/auth'
import { getAgent } from '@/lib/agent/definition'
import { DashboardSidebar } from '@/components/dashboard/sidebar'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireSession()
  // Until setup has made the agent, Overview and Agent would both open setup, so
  // the sidebar offers "Set up" in their place.
  const hasAgent = (await getAgent()) !== null

  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      <DashboardSidebar hasAgent={hasAgent} />
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
