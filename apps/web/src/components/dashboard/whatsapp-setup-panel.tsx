'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Circle, Copy, Link2, Loader2, RefreshCw, Send, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { SetupStep } from '@/lib/whatsapp/setup'
import { cn } from '@/lib/utils'
import { TickMark } from '@/components/tick-mark'
import { SaveStatus, type SaveMessage } from './save-status'

interface Props {
  steps: SetupStep[]
  /** The number is connected, so a test message can go out. */
  canSend: boolean
  qualityRating: string | null
  webhookUrl: string
}

const STATE_ICON = {
  done: <TickMark className="text-accent" />,
  todo: <XCircle className="h-4 w-4 text-danger" aria-hidden />,
  waiting: <Circle className="h-4 w-4 text-faint" aria-hidden />,
} as const

/** Meta's GREEN / YELLOW / RED number quality, as a status dot. */
const QUALITY_DOT: Record<string, string> = {
  green: 'bg-success',
  yellow: 'bg-warning',
  red: 'bg-danger',
}

const STATE_LABEL = { done: 'Done', todo: 'To do', waiting: 'Waiting on an earlier step' } as const

export function WhatsAppSetupPanel({ steps, canSend, qualityRating, webhookUrl }: Props) {
  const router = useRouter()
  const [checking, startCheck] = useTransition()
  const [copied, setCopied] = useState<boolean | null>(null)
  const [to, setTo] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<SaveMessage>(null)
  const [subscribing, setSubscribing] = useState(false)
  const [subscribeResult, setSubscribeResult] = useState<SaveMessage>(null)
  const doneCount = steps.filter((s) => s.state === 'done').length

  async function copyWebhook() {
    try {
      await navigator.clipboard.writeText(webhookUrl)
      setCopied(true)
    } catch {
      // Clipboard access needs HTTPS or localhost; the field is selectable either way.
      setCopied(false)
    }
    setTimeout(() => setCopied(null), 2000)
  }

  async function subscribe() {
    setSubscribing(true)
    setSubscribeResult(null)
    try {
      const res = await fetch('/api/whatsapp/subscribe', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) startCheck(() => router.refresh())
      else setSubscribeResult({ ok: false, text: data.error ?? `Subscribing failed (HTTP ${res.status})` })
    } catch {
      setSubscribeResult({ ok: false, text: 'Subscribing failed. Check your connection.' })
    } finally {
      setSubscribing(false)
    }
  }

  async function sendTest(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)
    setResult(null)
    try {
      const res = await fetch('/api/whatsapp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      })
      const data = await res.json().catch(() => ({}))
      setResult(
        res.ok
          ? { ok: true, text: 'Sent. Check WhatsApp on that phone, then reply to it.' }
          : { ok: false, text: data.error ?? `Sending failed (HTTP ${res.status})` }
      )
    } catch {
      setResult({ ok: false, text: 'Sending failed. Check your connection.' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>
              Setup: {doneCount} of {steps.length} done
            </CardTitle>
            {qualityRating && (
              <p className="mt-1 flex items-center gap-2 text-sm text-muted">
                <span
                  className={cn(
                    'inline-block h-2 w-2 shrink-0 rounded-full',
                    QUALITY_DOT[qualityRating.toLowerCase()] ?? 'bg-faint'
                  )}
                  aria-hidden
                />
                Meta quality rating: {qualityRating.toLowerCase()}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => startCheck(() => router.refresh())}
            disabled={checking}
          >
            {checking ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
            Check again
          </Button>
        </CardHeader>
        <CardContent>
          <ol className="space-y-5">
            {steps.map((step, i) => (
              <li key={step.id} className="flex gap-3">
                <span className="flex h-6 w-4 shrink-0 items-center">{STATE_ICON[step.state]}</span>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="font-medium text-text">
                    {i + 1}. {step.title}
                    <span className="sr-only">: {STATE_LABEL[step.state]}</span>
                  </p>
                  <p className={step.state === 'todo' ? 'text-sm text-text' : 'text-sm text-muted'}>
                    {step.detail}
                  </p>
                  {step.action === 'subscribe' && (
                    <div className="space-y-1">
                      <Button size="sm" onClick={subscribe} disabled={subscribing || checking}>
                        {subscribing ? <Loader2 className="animate-spin" aria-hidden /> : <Link2 aria-hidden />}
                        Subscribe
                      </Button>
                      <SaveStatus message={subscribeResult} />
                    </div>
                  )}
                  {step.id === 'webhook' && (
                    <div className="space-y-1">
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={webhookUrl}
                          aria-label="Webhook callback URL"
                          className="font-mono text-xs"
                          onFocus={(e) => e.currentTarget.select()}
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={copyWebhook}
                          aria-label="Copy webhook URL"
                        >
                          {copied ? <Check className="text-success" aria-hidden /> : <Copy aria-hidden />}
                        </Button>
                      </div>
                      <p role="status" className="text-xs text-faint">
                        {copied === true && 'Copied'}
                        {copied === false && 'Copying is blocked here. Select the URL and copy it.'}
                      </p>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Send a test message</CardTitle>
          <p className="text-sm text-muted">
            Sends Meta&apos;s <code>hello_world</code> template, the one kind of message allowed before
            someone has written to you. With a test number, the recipient must be on your app&apos;s
            allowed list. Reply to it and your agent answers, which also completes step 4.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={sendTest} className="space-y-2">
            <Label htmlFor="test-to">Recipient, with country code</Label>
            <div className="flex gap-2">
              <Input
                id="test-to"
                type="tel"
                autoComplete="off"
                placeholder="+15551234567"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
              <Button type="submit" disabled={!canSend || sending || !to.trim()}>
                {sending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
                Send
              </Button>
            </div>
            {!canSend && <p className="text-xs text-faint">Available once step 2 is done.</p>}
            <SaveStatus message={result} />
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
