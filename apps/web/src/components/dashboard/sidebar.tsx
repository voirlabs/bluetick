'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bot, Inbox, LayoutDashboard, ListChecks, LogOut, Phone } from 'lucide-react'
import { REPO_URL } from '@/lib/site'
import { cn } from '@/lib/utils'
import { Lockup } from '@/components/lockup'

const agentItems = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/agent', label: 'Agent', icon: Bot },
]
const setupItems = [{ href: '/dashboard/setup', label: 'Set up', icon: ListChecks }]
const sharedItems = [
  { href: '/dashboard/inbox', label: 'Inbox', icon: Inbox },
  { href: '/dashboard/whatsapp', label: 'WhatsApp', icon: Phone },
]

function SignOut({ className }: { className?: string }) {
  return (
    <form action="/api/auth/signout" method="post" className={className}>
      <button
        type="submit"
        className="flex cursor-pointer items-center gap-2 rounded-md text-muted transition-colors hover:text-text"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out
      </button>
    </form>
  )
}

/** A left column on desktop; a header with a scrolling tab row on phones. */
export function DashboardSidebar({ hasAgent }: { hasAgent: boolean }) {
  const pathname = usePathname()
  const navItems = [...(hasAgent ? agentItems : setupItems), ...sharedItems]

  return (
    <aside className="flex shrink-0 flex-col border-b border-line bg-surface md:w-60 md:border-r md:border-b-0">
      <div className="flex h-14 items-center justify-between px-4 md:h-16 md:px-5">
        <Link href="/dashboard" aria-label="Bluetick overview" className="rounded-md">
          <Lockup size={26} />
        </Link>
        <SignOut className="text-xs md:hidden" />
      </div>

      <nav
        aria-label="Dashboard"
        className="flex gap-0.5 overflow-x-auto px-2 pb-2 md:flex-1 md:flex-col md:gap-0.5 md:px-3 md:pt-2"
      >
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = href === '/dashboard' ? pathname === href : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors md:gap-2.5',
                active
                  ? 'bg-accent-strong text-accent'
                  : 'text-muted hover:bg-white/5 hover:text-text'
              )}
            >
              <Icon className="hidden h-4 w-4 sm:block" aria-hidden />
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="hidden space-y-3 border-t border-line px-5 py-4 text-xs md:block">
        <div className="flex items-center justify-between">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-md text-muted transition-colors hover:text-text"
          >
            Source on GitHub
          </a>
          <SignOut />
        </div>
        <a
          href="https://www.voirlabs.io"
          target="_blank"
          rel="noreferrer"
          className="inline-block rounded-md text-faint transition-colors hover:text-accent"
        >
          by Voir Labs
        </a>
      </div>
    </aside>
  )
}
