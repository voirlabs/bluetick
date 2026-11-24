import { NextRequest } from 'next/server'
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { z } from 'zod'
import { runAgent, type ChatMessage } from '@bluetick/agent'
import { isSignedIn } from '@/lib/auth'
import { agentDefinition, getAgent, toAgentSettings } from '@/lib/agent/definition'
import { defaultModel } from '@/lib/agent/models'
import { createSimulatedServices, type SimulatorMetadata } from '@/lib/agent/services'

export const maxDuration = 60

// The chat UI sends its messages as parts; the simulator only needs their text.
const bodySchema = z.object({
  messages: z
    .array(
      z.looseObject({
        role: z.string(),
        parts: z.array(z.looseObject({ type: z.string(), text: z.string().max(10_000).optional() })),
      })
    )
    .max(100),
})

/**
 * Runs the real agent (same definition, prompt, tools and hooks as WhatsApp)
 * with simulated side effects, then replays the result as a UI message stream for useChat.
 */
export async function POST(req: NextRequest) {
  if (!(await isSignedIn())) return new Response('Unauthorized', { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return new Response('Invalid input', { status: 400 })

  const agent = await getAgent()
  if (!agent) return new Response('Set up the agent first', { status: 404 })

  const history: ChatMessage[] = parsed.data.messages
    .flatMap((m): ChatMessage[] => {
      if (m.role !== 'user' && m.role !== 'assistant') return []
      const content = m.parts.flatMap((p) => (p.type === 'text' && p.text ? [p.text] : [])).join('')
      return content.trim() ? [{ role: m.role, content }] : []
    })
    .slice(-20)
  const last = history[history.length - 1]
  if (!last || last.role !== 'user')
    return new Response('Last message must be from the user', { status: 400 })

  const { services, sent, posted } = createSimulatedServices()
  const result = await runAgent({
    definition: agentDefinition,
    settings: toAgentSettings(agent),
    history,
    inbound: { text: last.content, kind: 'text' },
    customer: { phone: '+10000000000', name: 'Simulator' },
    conversationId: 'simulator',
    services,
    simulated: true,
    defaultModel: defaultModel(),
  })

  // What the customer would see becomes the message text (and the history
  // for the next turn); notes about the run travel as message metadata.
  const notes: string[] = []
  if (result.source === 'fallback') {
    notes.push(
      result.error
        ? `The model call failed (${result.error}), so the fallback message was used. Check OPENAI_API_KEY.`
        : 'The model returned nothing, so the fallback message was used.'
    )
  }
  if (result.source === 'rule') notes.push('A keyword rule sent the fallback message.')
  if (result.source === 'hook') notes.push('Answered by the beforeReply hook.')
  for (const host of posted) notes.push(`Would send data to ${host}. The simulator doesn't send it.`)
  if (result.handoffReason) {
    notes.push(
      `Handed off to a person: ${result.handoffReason}. On WhatsApp the agent now stays silent until someone returns the conversation from the inbox.`
    )
  }
  const parts = [...sent]
  if (result.reply) parts.push(result.reply)
  if (parts.length === 0) notes.push('No reply would be sent.')

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: 'start', messageMetadata: { notes } satisfies SimulatorMetadata })
      for (const call of result.toolCalls) {
        writer.write({
          type: 'tool-input-available',
          toolCallId: call.id,
          toolName: call.tool,
          input: call.input,
          dynamic: true,
        })
        writer.write(
          call.error
            ? { type: 'tool-output-error', toolCallId: call.id, errorText: call.error, dynamic: true }
            : { type: 'tool-output-available', toolCallId: call.id, output: call.output, dynamic: true }
        )
      }
      if (parts.length > 0) {
        writer.write({ type: 'text-start', id: 'reply' })
        writer.write({ type: 'text-delta', id: 'reply', delta: parts.join('\n\n') })
        writer.write({ type: 'text-end', id: 'reply' })
      }
      writer.write({ type: 'finish' })
    },
  })
  return createUIMessageStreamResponse({ stream })
}
