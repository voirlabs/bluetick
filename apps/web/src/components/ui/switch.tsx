import * as React from 'react'
import * as SwitchPrimitives from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitives.Root>) {
  // Inside a form, Radix adds a hidden checkbox next to the button with position:absolute.
  // The relative wrapper keeps it here; without it, it's placed against the page and
  // stretches the document, which shows a second scrollbar.
  return (
    <span className="relative inline-flex shrink-0">
      <SwitchPrimitives.Root
        className={cn(
          'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-accent data-[state=unchecked]:bg-line-2',
          className
        )}
        {...props}
      >
        <SwitchPrimitives.Thumb className="pointer-events-none block h-5 w-5 rounded-full bg-text shadow-lg transition-transform data-[state=checked]:translate-x-5 data-[state=checked]:bg-pill-ink data-[state=unchecked]:translate-x-0" />
      </SwitchPrimitives.Root>
    </span>
  )
}
