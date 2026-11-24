import { cn } from '@/lib/utils'

/** The padding and width every scrolling dashboard page uses. */
export const PAGE = 'w-full max-w-5xl p-5 md:p-10'

/**
 * A dashboard page's title, one-line description and actions. `bar` is for
 * full-height pages (inbox, setup), where the header is a bordered strip.
 */
export function PageHeader({
  title,
  description,
  actions,
  bar,
  children,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  bar?: boolean
  children?: React.ReactNode
}) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-end justify-between gap-x-6 gap-y-3',
        bar ? 'shrink-0 border-b border-line px-5 py-5 md:px-10 md:py-6' : 'mb-8'
      )}
    >
      <div className="min-w-0">
        <h1 className="display truncate text-4xl">{title}</h1>
        {description && <div className="mt-2 max-w-2xl text-muted">{description}</div>}
        {children}
      </div>
      {actions}
    </header>
  )
}
