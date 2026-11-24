'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

// Shown in place of a dashboard page that failed to load; the sidebar stays.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="w-full max-w-5xl p-5 md:p-10">
      <div role="alert" className="max-w-lg rounded-xl border border-card-line bg-card p-8">
        <h1 className="display mb-3 text-3xl">
          Something <span className="text-accent">went wrong</span>
        </h1>
        <p className="mb-5 text-base leading-relaxed text-muted">
          This page couldn&apos;t load. It&apos;s usually temporary, so try again.
        </p>
        <Button onClick={() => reset()}>Try again</Button>
      </div>
    </div>
  )
}
