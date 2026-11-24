import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-sm font-medium transition-[color,background-color,border-color,transform] active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'border border-pill bg-pill text-pill-ink hover:border-pill-hover hover:bg-pill-hover',
        outline:
          'border border-outline bg-transparent text-text hover:border-muted hover:bg-white/5',
        destructive: 'border border-danger/70 bg-transparent text-danger hover:bg-danger/10',
        ghost: 'text-muted hover:bg-white/5 hover:text-text',
      },
      size: {
        default: 'h-10 px-5',
        sm: 'h-9 rounded-lg px-4',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  ref?: React.Ref<HTMLButtonElement>
}

function Button({ className, variant, size, ref, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  )
}

export { Button, buttonVariants }
