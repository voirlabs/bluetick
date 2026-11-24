import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center whitespace-nowrap gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        secondary: 'border-line-2 bg-transparent text-muted',
        success: 'border-success/30 bg-success/10 text-success',
        warning: 'border-warning/30 bg-warning/10 text-warning',
        destructive: 'border-danger/30 bg-danger/10 text-danger',
      },
    },
    defaultVariants: { variant: 'secondary' },
  }
)

interface BadgeProps extends React.ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
