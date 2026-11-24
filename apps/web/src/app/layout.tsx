import type { Metadata, Viewport } from 'next'
import { JetBrains_Mono, Urbanist } from 'next/font/google'
import { APP_NAME } from '@/lib/site'
import './globals.css'

// Self-hosted at build time: no requests to Google at runtime.
const urbanist = Urbanist({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-urbanist',
})
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-jetbrains',
})

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: 'AI agents for WhatsApp, defined in code.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = { themeColor: '#080809', colorScheme: 'dark' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${urbanist.variable} ${jetbrains.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  )
}
