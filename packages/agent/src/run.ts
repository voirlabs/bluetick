import { generateText, isStepCount, tool as aiTool, type ModelMessage } from 'ai'
import { isHandoffTool } from './builtins'
import { buildDefaultInstructions, matchKeywordRule, PLATFORM_RULES } from './instructions'
import type { AgentContext, AnyTool, RunInput, RunResult, Sender, ToolCallRecord } from './types'

const DEFAULT_MAX_STEPS = 5
const DEFAULT_MAX_OUTPUT_TOKENS = 600
/** Tool executions per reply, across all tools, so one message can't fan out into many side effects. */
const MAX_TOOL_CALLS_PER_RUN = 10

const HANDOFF_NOTE = `## Handoff
This conversation is being passed to a human team member. Briefly tell the customer a person will reply here soon. Do not try to resolve the request yourself.`

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

function tokens(n: number | undefined) {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

function toMessages(input: RunInput): ModelMessage[] {
  const messages: ModelMessage[] = input.history.map((m) => ({ role: m.role, content: m.content }))
  const last = messages[messages.length - 1]
  if (last?.role === 'user' && last.content === input.inbound.text) messages.pop()
  const { text, image } = input.inbound
  messages.push(
    image
      ? {
          role: 'user',
          content: [
            { type: 'text', text },
            { type: 'file', data: image.data, mediaType: image.mediaType },
          ],
        }
      : { role: 'user', content: text }
  )
  return messages
}

/**
 * Produces the agent's reply to one inbound message. It does no I/O itself:
 * everything external goes through `input.services`, so the same function
 * runs on WhatsApp, in the dashboard simulator and in tests.
 */
export async function runAgent(input: RunInput): Promise<RunResult> {
  const { definition, settings, inbound } = input
  const hooks = definition.hooks ?? {}
  const toolCalls: ToolCallRecord[] = []
  const zero = { inputTokens: 0, outputTokens: 0 }
  let handoffReason: string | null = null
  let sentDirectly = false

  const send: Sender = {
    text: async (body) => {
      sentDirectly = true
      await input.services.send.text(body)
    },
    buttons: async (body, buttons) => {
      sentDirectly = true
      await input.services.send.buttons(body, buttons)
    },
    location: async (pin) => {
      sentDirectly = true
      await input.services.send.location(pin)
    },
  }

  const ctx: AgentContext = {
    ...input.services,
    send,
    settings,
    business: settings.business,
    customer: input.customer,
    conversationId: input.conversationId,
    simulated: input.simulated ?? false,
    handoff(reason) {
      handoffReason ??= reason
    },
  }

  async function finish(
    reply: string | null,
    source: RunResult['source'],
    usage: RunResult['usage'],
    error?: string
  ): Promise<RunResult> {
    let finalReply = reply
    if (hooks.afterReply && source !== 'skipped') {
      try {
        const result = await hooks.afterReply({ inbound, reply, toolCalls }, ctx)
        if (result && 'reply' in result) finalReply = result.reply
      } catch (err) {
        ctx.log('afterReply hook failed', { error: errorMessage(err) })
      }
    }
    if (handoffReason && hooks.onHandoff) {
      try {
        await hooks.onHandoff({ reason: handoffReason }, ctx)
      } catch (err) {
        ctx.log('onHandoff hook failed', { error: errorMessage(err) })
      }
    }
    return {
      reply: finalReply?.trim() ? finalReply.trim() : null,
      handoffReason,
      toolCalls,
      usage,
      source,
      ...(error ? { error } : {}),
    }
  }

  // 1. The beforeReply hook can answer, skip, or force a handoff.
  let forcedHandoff = false
  if (hooks.beforeReply) {
    try {
      const result = await hooks.beforeReply(inbound, ctx)
      if (result && 'skip' in result) return finish(null, 'skipped', zero)
      if (result && 'reply' in result) return finish(result.reply, 'hook', zero)
      if (result && 'handoff' in result) {
        ctx.handoff(result.handoff)
        forcedHandoff = true
      }
    } catch (err) {
      ctx.log('beforeReply hook failed', { error: errorMessage(err) })
    }
  }

  // 2. Keyword escalation rules from the dashboard, matched without the model.
  if (!forcedHandoff) {
    const rule = matchKeywordRule(settings.escalationRules, inbound.text)
    if (rule?.action === 'fallback') return finish(settings.fallbackMessage, 'rule', zero)
    if (rule?.action === 'handoff') {
      ctx.handoff(`Customer said "${rule.value}"`)
      forcedHandoff = true
    }
  }

  // 3. Tools defined in code and switched on in the dashboard.
  const enabled = Object.entries(definition.tools ?? {}).filter(([name]) =>
    settings.toolsEnabled.includes(name)
  ) as Array<[string, AnyTool]>

  const callCounts = new Map<string, number>()
  let totalCalls = 0
  const tools = forcedHandoff
    ? {}
    : Object.fromEntries(
        enabled.map(([name, def]) => [
          name,
          aiTool({
            description: def.description,
            inputSchema: def.input,
            execute: async (args: unknown, { toolCallId }: { toolCallId: string }) => {
              // Counted before running, so parallel calls in one step see each other.
              const callsOfTool = (callCounts.get(name) ?? 0) + 1
              callCounts.set(name, callsOfTool)
              totalCalls += 1
              if (callsOfTool > (def.maxCallsPerRun ?? Infinity) || totalCalls > MAX_TOOL_CALLS_PER_RUN) {
                const output = {
                  skipped: true,
                  note: 'This tool has already run as often as allowed for this message. Do not call it again; carry on with what you have.',
                }
                toolCalls.push({ id: toolCallId, tool: name, input: args, output, durationMs: 0 })
                return output
              }
              const started = Date.now()
              try {
                const output = (await def.run(args, ctx)) ?? { ok: true }
                toolCalls.push({
                  id: toolCallId,
                  tool: name,
                  input: args,
                  output,
                  durationMs: Date.now() - started,
                })
                return output
              } catch (err) {
                const message = errorMessage(err)
                toolCalls.push({
                  id: toolCallId,
                  tool: name,
                  input: args,
                  output: null,
                  durationMs: Date.now() - started,
                  error: message,
                })
                // The details stay in toolCalls (the inbox shows them); the model only
                // learns that it failed, so it can't repeat internal errors to the customer.
                return { error: 'The tool failed. Apologise and offer another way to help.' }
              }
            },
          }),
        ])
      )

  // 4. System prompt.
  const handoffToolName = enabled.find(([, def]) => isHandoffTool(def))?.[0] ?? null
  const defaults = buildDefaultInstructions(settings, {
    isFirstReply: !input.history.some((m) => m.role === 'assistant'),
    handoffToolName,
  })
  let system: string
  try {
    system =
      typeof definition.instructions === 'function'
        ? await definition.instructions({ settings, customer: input.customer, defaults, ctx })
        : definition.instructions
          ? `${defaults}\n\n## Additional instructions\n${definition.instructions}`
          : defaults
  } catch (err) {
    ctx.log('instructions function failed, using defaults', { error: errorMessage(err) })
    system = defaults
  }
  system = [system, PLATFORM_RULES, forcedHandoff ? HANDOFF_NOTE : ''].filter(Boolean).join('\n\n')

  // 5. Model call.
  try {
    const result = await generateText({
      model: definition.model ?? input.defaultModel,
      instructions: system,
      messages: toMessages(input),
      tools,
      stopWhen: isStepCount(definition.maxSteps ?? DEFAULT_MAX_STEPS),
      maxOutputTokens: definition.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    })
    const usage = {
      inputTokens: tokens(result.totalUsage?.inputTokens),
      outputTokens: tokens(result.totalUsage?.outputTokens),
    }
    const text = result.text.trim()
    if (text) return finish(text, 'model', usage)
    // A tool may already have messaged the customer (buttons, location pin).
    return sentDirectly
      ? finish(null, 'model', usage)
      : finish(settings.fallbackMessage, 'fallback', usage)
  } catch (err) {
    const error = errorMessage(err)
    ctx.log('model call failed', { error })
    return finish(settings.fallbackMessage, 'fallback', zero, error)
  }
}
