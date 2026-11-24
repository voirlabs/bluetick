'use client'

import { useEffect, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { Info, Loader2, RotateCcw, Send, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { SimulatorMetadata } from '@/lib/agent/services'

interface Props {
  agentName: string
}

type SimulatorMessage = UIMessage<SimulatorMetadata>

const textOf = (m: SimulatorMessage) =>
  m.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('')

export function SimulatorPanel({ agentName }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const [input, setInput] = useState('')
  const [transport] = useState(
    () => new DefaultChatTransport<SimulatorMessage>({ api: '/api/agent/simulate' })
  )
  const { messages, setMessages, sendMessage, status, error, stop } = useChat<SimulatorMessage>({
    transport,
  })
  const isLoading = status === 'submitted' || status === 'streaming'

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || isLoading) return
    setInput('')
    void sendMessage({ text })
  }

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages, isLoading])

  function restart() {
    stop()
    setMessages([])
  }

  return (
    <Card className="flex h-[70dvh] min-h-[28rem] flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-line p-5">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">Simulator: {agentName}</h2>
          <p className="mt-1 text-xs text-faint">
            Runs your real agent, prompt and tools. Knowledge search is real; leads, bookings and
            messages are not saved or sent.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={restart} disabled={messages.length === 0}>
          <RotateCcw aria-hidden /> New chat
        </Button>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto bg-surface p-4"
        role="log"
        aria-live="polite"
        aria-label="Simulated conversation"
      >
        {messages.length === 0 && !isLoading && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="display text-2xl text-text">Say hello as a customer</p>
            <p className="mt-2 max-w-sm text-sm text-muted">
              The first reply includes your greeting. Try a question your knowledge base answers, or
              ask for a person to test the handoff.
            </p>
          </div>
        )}
        {messages.map((m) => {
          const mine = m.role === 'user'
          const notes = m.metadata?.notes ?? []
          const text = textOf(m)
          return (
            <div
              key={m.id}
              className={cn('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}
            >
              <span className="text-xs text-faint">{mine ? 'Customer (you)' : 'Agent'}</span>
              {m.parts.map((p) =>
                p.type === 'dynamic-tool' ? (
                  <details
                    key={p.toolCallId}
                    className="max-w-[85%] rounded-lg border border-dashed border-line-2 px-3 py-2 font-mono text-xs text-muted"
                  >
                    <summary className="flex cursor-pointer items-center gap-2">
                      <Wrench className="h-3.5 w-3.5" aria-hidden /> {p.toolName}
                      {p.state === 'output-error' && <span className="text-danger">failed</span>}
                    </summary>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-faint">
                      {JSON.stringify(p.input ?? {}, null, 2)}
                    </pre>
                    {p.state === 'output-available' && (
                      <pre className="mt-1 overflow-x-auto border-t border-line pt-1 whitespace-pre-wrap text-accent">
                        {JSON.stringify(p.output, null, 2)}
                      </pre>
                    )}
                    {p.state === 'output-error' && (
                      <pre className="mt-1 overflow-x-auto border-t border-line pt-1 whitespace-pre-wrap text-danger">
                        {p.errorText}
                      </pre>
                    )}
                  </details>
                ) : null
              )}
              {text && (
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl border px-4 py-2 text-sm whitespace-pre-wrap',
                    mine
                      ? 'rounded-br-sm border-accent-line bg-accent-strong text-text'
                      : 'rounded-bl-sm border-line-2 bg-card text-text'
                  )}
                >
                  {text}
                </div>
              )}
              {notes.map((note) => (
                <p key={note} className="flex max-w-[85%] items-start gap-2 text-xs text-warning">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> {note}
                </p>
              ))}
            </div>
          )
        })}
        {isLoading && (
          <p className="flex items-center gap-2 text-xs text-faint">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> The agent is replying…
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error.message || 'The simulator request failed.'}
          </p>
        )}
      </div>

      <form onSubmit={submit} className="flex gap-2 border-t border-line p-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message as a customer…"
          aria-label="Message as a customer"
          maxLength={4000}
          className="flex-1"
        />
        <Button type="submit" size="icon" disabled={isLoading || !input.trim()} aria-label="Send">
          {isLoading ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
        </Button>
      </form>
    </Card>
  )
}
