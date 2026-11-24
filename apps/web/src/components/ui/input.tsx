import * as React from 'react'
import { cn } from '@/lib/utils'

/** Shared field look: inputs, textareas and selects. */
export const fieldClass =
  'w-full rounded-[10px] border border-line-2 bg-field px-3 text-sm text-text placeholder:text-faint transition-colors focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger'

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input className={cn(fieldClass, 'h-10 py-2', className)} {...props} />
}
