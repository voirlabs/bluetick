import Image from 'next/image'
import { APP_NAME } from '@/lib/site'
import { cn } from '@/lib/utils'

/** The Bluetick mark plus the lowercase wordmark, spaced at 0.4× the mark. */
export function Lockup({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center font-medium tracking-[-0.04em] text-text', className)}
      style={{ gap: size * 0.4, fontSize: size * 0.8 }}
    >
      <Image src="/logo.svg" alt="" width={size} height={size} priority />
      {APP_NAME.toLowerCase()}
    </span>
  )
}
