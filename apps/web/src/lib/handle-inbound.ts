import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { logger } from '@/lib/log'
import { isOptInMessage, isOptOutMessage } from '@/lib/opt-out'
import { runAgent } from '@bluetick/agent'
import { agentDefinition, getAgent, toAgentSettings } from '@/lib/agent/definition'
import { defaultModel } from '@/lib/agent/models'
import { sendAlert } from '@/lib/alerts'
import { HANDOFF_NOTE } from '@/lib/usage'
import { createLiveServices } from '@/lib/agent/services'
import { flagLimitedOnce, isCustomerOverLimit } from '@/lib/customer-limit'
import { readMedia } from '@/lib/media'
import { markReadAndShowTyping, sendText } from '@/lib/whatsapp/cloud-api'
import type { InboundWhatsAppMessage } from '@/lib/whatsapp/webhook'

const log = logger('inbound')
const HISTORY_LIMIT = 20

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Puts a conversation in front of a person, with a note saying why. Never throws. */
async function flagForPerson(conversationId: string, note: string) {
  await Promise.all([
    db.conversation.update({
      where: { id: conversationId },
      data: { status: 'needs_attention', resolvedAt: null },
    }),
    db.message.create({ data: { conversationId, direction: 'system', content: note } }),
  ]).catch((err) => log.error('could not flag the conversation', err, { conversationId }))
}

type Conversation = Awaited<ReturnType<typeof db.conversation.upsert>>
type StoredMessage = Awaited<ReturnType<typeof db.message.create>>

/**
 * Full lifecycle of one customer message: store, dedupe, opt-out, handoff,
 * agent reply, send. Safe to call more than once for the same message.
 */
export async function handleInboundMessage(msg: InboundWhatsAppMessage) {
  const customerPhone = `+${msg.from}`
  const conversation = await db.conversation.upsert({
    where: { customerPhone },
    create: {
      customerPhone,
      customerName: msg.contactName ?? null,
      lastInboundAt: msg.timestamp,
    },
    update: msg.contactName ? { customerName: msg.contactName } : {},
  })

  // Meta retries webhooks; the unique wa_message_id makes this insert our dedupe point.
  let inbound
  try {
    inbound = await db.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'inbound',
        content: msg.text,
        contentType: msg.type,
        waMessageId: msg.id,
      },
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      log.info('duplicate delivery ignored', { messageId: msg.id })
      return
    }
    throw err
  }

  // The message is stored. Anything that goes wrong from here would leave it
  // unanswered, so it goes to a person with the reason.
  try {
    await respond(msg, conversation, inbound)
  } catch (err) {
    log.error('inbound processing failed', err, { conversationId: conversation.id })
    await flagForPerson(
      conversation.id,
      `The agent couldn't answer this message (${errorText(err)}). Reply from here.`
    )
  }
}

async function respond(
  msg: InboundWhatsAppMessage,
  conversation: Conversation,
  inbound: StoredMessage
) {
  const customerPhone = `+${msg.from}`

  // The 24-hour window runs from the latest message. Retries and out-of-order
  // deliveries must not move it backwards.
  await db.conversation.updateMany({
    where: {
      id: conversation.id,
      OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: msg.timestamp } }],
    },
    data: { lastInboundAt: msg.timestamp },
  })

  if (isOptOutMessage(msg.text)) {
    await db.optOut.upsert({ where: { customerPhone }, create: { customerPhone }, update: {} })
    log.info('customer opted out', { conversationId: conversation.id })
    return
  }
  const optedOut = await db.optOut.findUnique({ where: { customerPhone } })
  if (optedOut) {
    if (!isOptInMessage(msg.text)) return
    await db.optOut.delete({ where: { customerPhone } })
  }

  // Past the per-customer limit the message waits in the inbox: no model call,
  // no transcription and no reply. A person hears about it once a day.
  if (await isCustomerOverLimit(conversation.id)) {
    log.info('customer over the message limit', { conversationId: conversation.id })
    if (await flagLimitedOnce(conversation.id)) {
      const reason = 'they sent more messages than the per-customer limit allows'
      await db.message.create({
        data: {
          conversationId: conversation.id,
          direction: 'system',
          content: `The agent stopped answering: ${reason} (CUSTOMER_MESSAGES_PER_10_MIN, CUSTOMER_MESSAGES_PER_DAY). Reply from here if it's genuine.`,
        },
      })
      await sendAlert({
        kind: 'handoff',
        conversationId: conversation.id,
        customerName: msg.contactName ?? conversation.customerName,
        reason,
      })
    }
    return
  }

  const agent = await getAgent()
  const agentReplies = agent?.status === 'active' && !conversation.handoffMode
  const typing = agentReplies ? markReadAndShowTyping(msg.id) : null

  // A voice note becomes its transcript, for the agent and for whoever reads
  // the inbox. A photo is only fetched when the agent will look at it.
  const media =
    msg.kind === 'voice' || (msg.kind === 'image' && agentReplies)
      ? await readMedia(msg)
      : { text: msg.text }
  if (media.text !== msg.text) {
    await db.message.update({ where: { id: inbound.id }, data: { content: media.text } })
  }

  // In handoff, a person is replying: the message just waits in the inbox.
  if (conversation.handoffMode) {
    await db.conversation.update({
      where: { id: conversation.id },
      data: { status: 'needs_attention', resolvedAt: null },
    })
    log.info('message left for a human', { conversationId: conversation.id })
    return
  }
  // With no agent, or a paused one, the message waits for a person too. The
  // conversation isn't handed off, so the agent answers the next message
  // once it's switched back on.
  if (!agent || !agentReplies) {
    const reason = !agent ? 'no agent is set up yet' : 'the agent is paused'
    // Only the first of several concurrent messages notes it and alerts.
    const flagged = await db.conversation.updateMany({
      where: { id: conversation.id, status: { not: 'needs_attention' } },
      data: { status: 'needs_attention', resolvedAt: null },
    })
    log.info('message left for a human', { conversationId: conversation.id })
    if (flagged.count === 1) {
      await db.message.create({
        data: {
          conversationId: conversation.id,
          direction: 'system',
          content: `Waiting for a person: ${reason}.`,
        },
      })
      await sendAlert({
        kind: 'handoff',
        conversationId: conversation.id,
        customerName: msg.contactName ?? conversation.customerName,
        reason,
      })
    }
    return
  }
  if (conversation.status === 'resolved') {
    await db.conversation.update({
      where: { id: conversation.id },
      data: { status: 'active', resolvedAt: null },
    })
  }

  const recent = await db.message.findMany({
    where: { conversationId: conversation.id, direction: { in: ['inbound', 'outbound'] } },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT,
  })
  const history = recent.reverse().map((m) => ({
    role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: m.content,
  }))

  const result = await runAgent({
    definition: agentDefinition,
    settings: toAgentSettings(agent),
    history,
    inbound: { text: media.text, kind: msg.kind, messageId: msg.id, image: media.image },
    customer: {
      phone: customerPhone,
      name: msg.contactName ?? conversation.customerName ?? undefined,
    },
    conversationId: conversation.id,
    services: createLiveServices({
      conversationId: conversation.id,
      customerPhone,
      customerName: msg.contactName ?? conversation.customerName,
      memory: conversation.memory,
    }),
    defaultModel: defaultModel(),
  })
  await typing

  if (result.handoffReason) {
    // Only the run that moves the conversation to a person notes it and alerts.
    const handedOff = await db.conversation.updateMany({
      where: { id: conversation.id, handoffMode: false },
      data: { status: 'needs_attention', handoffMode: true },
    })
    if (handedOff.count === 1) {
      log.info('handed off to human', { conversationId: conversation.id })
      await db.message.create({
        data: { conversationId: conversation.id, direction: 'system', content: `${HANDOFF_NOTE}${result.handoffReason}` },
      })
      await sendAlert({
        kind: 'handoff',
        conversationId: conversation.id,
        customerName: msg.contactName ?? conversation.customerName,
        reason: result.handoffReason,
      })
    }
  }

  // Failures the customer can't see: a failed model call (they got the
  // fallback message) and failed tools. Show them in the inbox.
  if (result.error) {
    await flagForPerson(
      conversation.id,
      `The model call failed (${result.error}), so the customer got the fallback message. Check OPENAI_API_KEY.`
    )
  }
  for (const call of result.toolCalls.filter((c) => c.error)) {
    await db.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'system',
        content: `The ${call.tool} tool failed: ${call.error}`,
      },
    })
  }

  if (!result.reply) return

  // If the customer sent another message while we were thinking, let that run
  // answer: its history already includes this message.
  const [newer, current] = await Promise.all([
    db.message.findFirst({
      where: {
        conversationId: conversation.id,
        direction: 'inbound',
        createdAt: { gt: inbound.createdAt },
      },
      select: { id: true },
    }),
    db.conversation.findUnique({
      where: { id: conversation.id },
      select: { handoffMode: true },
    }),
  ])
  // A handoff reply is still sent: the newer message's run won't answer once
  // the conversation is with a person.
  if (newer && !result.handoffReason) {
    log.info('reply superseded by newer message', { conversationId: conversation.id })
    return
  }
  // A person may have clicked "Take over" while the model was running.
  if (current?.handoffMode && !result.handoffReason) {
    log.info('reply dropped: a person took over', { conversationId: conversation.id })
    return
  }

  let waMessageId: string
  try {
    waMessageId = await sendText(customerPhone, result.reply)
  } catch (err) {
    log.error('failed to send reply', err, { conversationId: conversation.id })
    await db.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'system',
        content: `Reply failed to send: ${errorText(err)}`,
      },
    })
    return
  }

  await db.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'outbound',
      content: result.reply,
      waMessageId,
      toolCalls: result.toolCalls as unknown as Prisma.InputJsonValue,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    },
  })
}
