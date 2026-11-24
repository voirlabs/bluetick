import { cn } from '@/lib/utils'

/**
 * The tick from the Bluetick mark, drawn flat in the current colour. Used as the
 * one "done" mark: finished setup steps and resolved conversations.
 */
export function TickMark({ className, label }: { className?: string; label?: string }) {
  return (
    <svg
      viewBox="10 1 51 51"
      className={cn('h-4 w-4 shrink-0', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path
        d="M15 33l9.5 9.5L56 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
