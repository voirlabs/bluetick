import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Lockup } from '@/components/lockup'
import { buttonVariants } from '@/components/ui/button'

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12 text-center">
      <Lockup size={34} className="mb-10" />
      <p className="section-label mb-5">404 · Not found</p>
      <h1 className="display mb-4 text-[44px] sm:text-5xl">
        Page <span className="text-accent">not found</span>
      </h1>
      <p className="mb-8 max-w-sm text-base leading-relaxed text-balance text-muted">
        This page doesn&apos;t exist or has moved. A conversation link stops working once it&apos;s
        deleted.
      </p>
      <Link href="/dashboard" className={buttonVariants({ className: 'h-11' })}>
        <ArrowLeft aria-hidden /> Dashboard
      </Link>
    </main>
  )
}
