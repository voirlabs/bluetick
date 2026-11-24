'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Booking, Conversation, Lead, Message } from '@prisma/client'
import { ArrowLeft, Loader2, MapPin, Search, Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn, timeAgo } from '@/lib/utils'
import { serviceWindowLeft } from '@/lib/whatsapp/service-window'
import { TickMark } from '@/components/tick-mark'
import { TemplateComposer } from './template-composer'

type Detail = Conversation & { messages: Message[]; leads: Lead[]; bookings: Booking[] }
type Action = 'take_over' | 'return_to_agent' | 'resolve' | 'delete'
type ListItem = Conversation & { lastMessage: Pick<Message, 'content' | 'direction'> | null }

interface Props {
  conversations: ListItem[]
  /** Conversation to open first, from ?c=<id> (alerts link here). */
  initialId: string | null
}

const POLL_MS = 5000
const HOUR_MS = 3600 * 1000

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'needs_attention', label: 'Attention' },
  { value: 'active', label: 'Active' },
  { value: 'resolved', label: 'Resolved' },
] as const

const statusLabels: Record<string, string> = {
  active: 'Active',
  needs_attention: 'Needs attention',
  resolved: 'Resolved',
}

const statusVariants: Record<string, 'success' | 'warning' | 'secondary'> = {
  active: 'success',
  needs_attention: 'warning',
  resolved: 'secondary',
}

const PIN = '📍 '

/**
 * Message text as stored. Location pins are stored with a 📍 prefix; on screen
 * that becomes a line icon, so the stored text stays as it is.
 */
function MessageText({ content }: { content: string }) {
  if (!content.startsWith(PIN)) return <>{content}</>
  return (
    <>
      <MapPin className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-faint" aria-label="Location" />
      {content.slice(PIN.length)}
    </>
  )
}

/** "key: value · key: value" for a lead or booking's JSON fields. */
function describeFields(value: unknown) {
  return Object.entries(
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  )
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
}

/** Leads and bookings the agent's tools saved for this customer. */
function Captured({ leads, bookings }: { leads: Lead[]; bookings: Booking[] }) {
  if (leads.length === 0 && bookings.length === 0) return null
  return (
    <section aria-label="Captured" className="border-b border-line bg-surface-2 px-4 py-3 text-sm">
      <h3 className="section-label mb-1">Captured</h3>
      <ul className="space-y-1">
        {bookings.map((b) => (
          <li key={b.id}>
            <span className="font-medium text-text">Booking request</span>{' '}
            <Badge variant="secondary" className="mx-1 capitalize">
              {b.status}
            </Badge>
            <span className="text-muted">{describeFields(b.details)}</span>
          </li>
        ))}
        {leads.map((l) => (
          <li key={l.id}>
            <span className="font-medium text-text">Lead</span>{' '}
            <span className="text-muted">{describeFields(l.fields)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Bubble({ message }: { message: Message }) {
  if (message.direction === 'system') {
    return (
      <p role="note" className="mx-auto max-w-md text-center text-xs text-danger">
        {message.content}
      </p>
    )
  }
  const inbound = message.direction === 'inbound'
  return (
    <div className={cn('flex flex-col gap-1', inbound ? 'items-start' : 'items-end')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl border px-4 py-2 text-sm whitespace-pre-wrap md:max-w-md',
          inbound
            ? 'rounded-bl-sm border-line-2 bg-card text-text'
            : 'rounded-br-sm border-accent-line bg-accent-strong text-text'
        )}
      >
        <MessageText content={message.content} />
      </div>
      <time dateTime={new Date(message.createdAt).toISOString()} className="text-xs text-faint">
        {inbound ? 'Customer' : 'Sent'} · {timeAgo(message.createdAt)}
      </time>
    </div>
  )
}

export function InboxView({ conversations, initialId }: Props) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState<string | null>(initialId)
  const [selected, setSelected] = useState<Detail | null>(null)
  const [loadingMessages, setLoadingMessages] = useState(initialId !== null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [replyText, setReplyText] = useState('')
  const [sendingReply, setSendingReply] = useState(false)
  const [pendingAction, setPendingAction] = useState<Action | null>(null)
  const [error, setError] = useState('')
  // The conversation on screen. Responses for any other one are dropped, so a
  // slow request can't overwrite the conversation you just switched to.
  const selectedIdRef = useRef<string | null>(initialId)
  const messagesRef = useRef<HTMLDivElement>(null)

  const loadDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/conversations/${id}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`Could not load the conversation (HTTP ${res.status})`)
    const { conversation } = (await res.json()) as { conversation: Detail }
    if (selectedIdRef.current === id) setSelected(conversation)
  }, [])

  // Opened from a link (an alert, ?c=<id>): load that conversation.
  useEffect(() => {
    if (!initialId) return
    loadDetail(initialId)
      .catch((err) => {
        if (selectedIdRef.current === initialId) {
          setError(err instanceof Error ? err.message : 'Could not load the conversation')
        }
      })
      .finally(() => {
        if (selectedIdRef.current === initialId) setLoadingMessages(false)
      })
  }, [initialId, loadDetail])

  // New messages arrive through the webhook; poll so the inbox stays current.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return
      router.refresh()
      if (selectedId) loadDetail(selectedId).catch(() => {})
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [router, selectedId, loadDetail])

  const messageCount = selected?.messages.length ?? 0
  useEffect(() => {
    const el = messagesRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [selectedId, messageCount])

  async function selectConversation(id: string) {
    selectedIdRef.current = id
    setSelectedId(id)
    setSelected(null)
    setError('')
    setReplyText('')
    setLoadingMessages(true)
    try {
      await loadDetail(id)
    } catch (err) {
      if (selectedIdRef.current === id) {
        setError(err instanceof Error ? err.message : 'Could not load the conversation')
      }
    } finally {
      if (selectedIdRef.current === id) setLoadingMessages(false)
    }
  }

  function closeConversation() {
    selectedIdRef.current = null
    setSelectedId(null)
    setSelected(null)
    setError('')
  }

  async function sendReply() {
    if (!selected || !replyText.trim() || sendingReply) return
    setSendingReply(true)
    setError('')
    try {
      const res = await fetch(`/api/conversations/${selected.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: replyText }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setReplyText('')
        await loadDetail(selected.id)
      } else {
        setError(data.error ?? 'Failed to send')
      }
    } catch {
      setError('Failed to send. Check your connection.')
    } finally {
      setSendingReply(false)
    }
  }

  async function act(action: Action) {
    if (!selected) return
    setError('')
    setPendingAction(action)
    try {
      const res = await fetch(`/api/conversations/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error()
      await loadDetail(selected.id)
      router.refresh()
    } catch {
      setError('Could not update the conversation. Try again.')
    } finally {
      setPendingAction(null)
    }
  }

  async function deleteConversation() {
    if (!selected) return
    const who = selected.customerName || selected.customerPhone
    const ok = window.confirm(
      `Delete the conversation with ${who}? Its messages, leads and booking requests are removed for good. An opt-out (STOP) is kept.`
    )
    if (!ok) return
    setError('')
    setPendingAction('delete')
    try {
      const res = await fetch(`/api/conversations/${selected.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      closeConversation()
      router.refresh()
    } catch {
      setError('Could not delete the conversation. Try again.')
    } finally {
      setPendingAction(null)
    }
  }

  const query = search.trim().toLowerCase()
  const filtered = conversations.filter((c) => {
    const matchSearch =
      !query ||
      c.customerPhone.includes(query) ||
      (c.customerName?.toLowerCase().includes(query) ?? false)
    return matchSearch && (statusFilter === 'all' || c.status === statusFilter)
  })
  const count = (status: string) =>
    status === 'all'
      ? conversations.length
      : conversations.filter((c) => c.status === status).length

  const windowLeft = selected ? serviceWindowLeft(selected.lastInboundAt) : 0

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Conversation list. On phones it gives way to the open conversation. */}
      <div
        className={cn(
          'w-full flex-col border-r border-line md:flex md:w-80 md:shrink-0',
          selectedId ? 'hidden' : 'flex'
        )}
      >
        <div className="space-y-3 border-b border-line p-3">
          <div className="relative">
            <Search
              className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint"
              aria-hidden
            />
            <Input
              className="pl-9"
              placeholder="Search name or number"
              aria-label="Search conversations"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div
            className="-mx-3 flex flex-nowrap gap-2 overflow-x-auto px-3"
            role="group"
            aria-label="Filter by status"
          >
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={statusFilter === f.value}
                onClick={() => setStatusFilter(f.value)}
                className={cn(
                  'h-7 shrink-0 cursor-pointer rounded-md border px-2 text-xs font-medium whitespace-nowrap transition-colors',
                  statusFilter === f.value
                    ? 'border-accent-line bg-accent-strong text-accent'
                    : 'border-line-2 text-muted hover:text-text'
                )}
              >
                {f.label} <span className="text-faint tabular-nums">{count(f.value)}</span>
              </button>
            ))}
          </div>
        </div>

        <ul className="flex-1 overflow-y-auto" aria-label="Conversations">
          {filtered.length === 0 ? (
            <li className="px-6 py-12 text-center text-sm text-muted">
              {conversations.length === 0
                ? 'No conversations yet. They appear here when customers message your WhatsApp number.'
                : 'No conversations match.'}
            </li>
          ) : (
            filtered.map((conv) => (
              <li key={conv.id}>
                <button
                  type="button"
                  onClick={() => selectConversation(conv.id)}
                  aria-current={selectedId === conv.id ? 'true' : undefined}
                  className={cn(
                    'w-full cursor-pointer border-b border-line px-4 py-3 text-left transition-colors hover:bg-white/[0.03] focus-visible:-outline-offset-2',
                    selectedId === conv.id && 'bg-accent-strong/60'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-text">
                        {conv.customerName || conv.customerPhone}
                      </p>
                      {conv.customerName && (
                        <p className="text-xs text-faint">{conv.customerPhone}</p>
                      )}
                    </div>
                    <Badge variant={statusVariants[conv.status] ?? 'secondary'}>
                      {conv.status === 'resolved' && <TickMark className="h-3 w-3 text-accent" />}
                      {statusLabels[conv.status] ?? conv.status}
                    </Badge>
                  </div>
                  {conv.lastMessage && (
                    <p className="mt-2 truncate text-xs text-muted">
                      {conv.lastMessage.direction === 'outbound' && (
                        <span className="text-faint">Sent: </span>
                      )}
                      <MessageText content={conv.lastMessage.content} />
                    </p>
                  )}
                  <p className="mt-1 flex justify-between text-xs text-faint">
                    <span>{conv.handoffMode ? 'A person is replying' : 'Agent replying'}</span>
                    <span>{timeAgo(conv.updatedAt)}</span>
                  </p>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>

      <div className={cn('min-w-0 flex-1 flex-col', selectedId ? 'flex' : 'hidden md:flex')}>
        {selectedId && !selected ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
            {loadingMessages ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted" aria-label="Loading" />
            ) : (
              <>
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
                <Button variant="outline" size="sm" onClick={closeConversation}>
                  Back to the list
                </Button>
              </>
            )}
          </div>
        ) : selected ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="-ml-2 h-9 w-9 md:hidden"
                  onClick={closeConversation}
                  aria-label="Back to conversations"
                >
                  <ArrowLeft aria-hidden />
                </Button>
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">
                    {selected.customerName || selected.customerPhone}
                  </h2>
                  <p className="text-xs text-faint">
                    {selected.customerName ? `${selected.customerPhone} · ` : ''}
                    {windowLeft > 0
                      ? `Reply window open for ${Math.max(1, Math.round(windowLeft / HOUR_MS))}h`
                      : 'Reply window closed'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={selected.handoffMode ? 'outline' : 'default'}
                  disabled={pendingAction !== null}
                  onClick={() => act(selected.handoffMode ? 'return_to_agent' : 'take_over')}
                >
                  {(pendingAction === 'take_over' || pendingAction === 'return_to_agent') && (
                    <Loader2 className="animate-spin" aria-hidden />
                  )}
                  {selected.handoffMode ? 'Return to agent' : 'Take over'}
                </Button>
                {selected.status !== 'resolved' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pendingAction !== null}
                    onClick={() => act('resolve')}
                  >
                    {pendingAction === 'resolve' && (
                      <Loader2 className="animate-spin" aria-hidden />
                    )}
                    Resolve
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={pendingAction !== null}
                  onClick={deleteConversation}
                >
                  {pendingAction === 'delete' && <Loader2 className="animate-spin" aria-hidden />}
                  Delete
                </Button>
              </div>
            </div>

            <Captured leads={selected.leads} bookings={selected.bookings} />

            <div
              ref={messagesRef}
              className="flex-1 space-y-3 overflow-y-auto bg-surface p-4"
              role="log"
              aria-label="Messages"
            >
              {selected.messages.map((m) => (
                <Bubble key={m.id} message={m} />
              ))}
            </div>

            {error && (
              <p role="alert" className="border-t border-line px-4 py-2 text-sm text-danger">
                {error}
              </p>
            )}

            {windowLeft === 0 ? (
              <TemplateComposer
                conversationId={selected.id}
                onSent={() => {
                  router.refresh()
                  loadDetail(selected.id).catch(() => {})
                }}
              />
            ) : !selected.handoffMode ? (
              <p className="border-t border-line px-4 py-3 text-center text-sm text-muted">
                The agent is handling this conversation. Take over to reply yourself.
              </p>
            ) : (
              <form
                className="border-t border-line p-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  sendReply()
                }}
              >
                <div className="flex items-end gap-2">
                  <Textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Write a reply…"
                    aria-label="Reply"
                    maxLength={4096}
                    rows={2}
                    className="min-h-11 resize-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        sendReply()
                      }
                    }}
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={sendingReply || !replyText.trim()}
                    aria-label="Send reply"
                  >
                    {sendingReply ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Send aria-hidden />
                    )}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-faint">
                  You are replying. The agent stays silent until you return the conversation to it.
                  Enter sends, Shift+Enter adds a line.
                </p>
              </form>
            )}
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
            <p className="display text-2xl text-text">Pick a conversation</p>
            <p className="mt-2 max-w-xs text-sm text-muted">
              Ones that need a person are marked{' '}
              <span className="text-warning">Needs attention</span>.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
