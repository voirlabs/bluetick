import type { LanguageModel } from 'ai'
import type { z } from 'zod'

// Settings edited in the dashboard

export interface BusinessContext {
  businessName?: string
  industry?: string
  description?: string
  hours?: string
  location?: string
  latitude?: number
  longitude?: number
  timezone?: string
  [key: string]: unknown
}

export interface EscalationRule {
  condition: 'keyword' | 'intent' | 'attempts_exceeded' | 'sentiment'
  value: string
  action: 'handoff' | 'fallback'
}

/** The agent's settings, stored in the database and editable in the dashboard. */
export interface AgentSettings {
  id: string
  name: string
  systemPrompt: string
  business: BusinessContext
  /** Names of tools (keys of `AgentDefinition.tools`) switched on in the dashboard. */
  toolsEnabled: string[]
  greetingMessage: string
  fallbackMessage: string
  escalationRules: EscalationRule[]
  allowedTopics: string[]
  language: string
}

// Conversation data

export interface Customer {
  /** E.164 phone number, e.g. "+15551234567". */
  phone: string
  name?: string | undefined
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface InboundImage {
  data: Uint8Array
  /** e.g. "image/jpeg". */
  mediaType: string
}

export interface InboundEvent {
  /**
   * What the customer said. A voice note arrives as its transcript; other
   * non-text messages as a short description.
   */
  text: string
  kind: 'text' | 'voice' | 'image' | 'interactive' | 'location' | 'media' | 'other'
  messageId?: string | undefined
  /** A photo the customer sent with this message, shown to the model. */
  image?: InboundImage | undefined
}

// Services the host app provides to tools and hooks

export interface KnowledgeService {
  /** Semantic search over the agent's knowledge base. */
  search(query: string, topK?: number): Promise<string[]>
}

export interface LeadService {
  save(fields: Record<string, unknown>): Promise<void>
}

export interface BookingRequest {
  /** Free text as the customer said it, e.g. "Friday 7pm". */
  requestedFor: string
  service?: string | undefined
  partySize?: number | undefined
  customerName?: string | undefined
  notes?: string | undefined
}

export interface BookingService {
  /** Records a booking request for the team to confirm. */
  request(details: BookingRequest): Promise<{ id: string }>
}

/** Small per-conversation key/value store that survives between messages. */
export interface MemoryStore {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
}

export interface ReplyButton {
  /** Returned to you when tapped; max 256 chars. */
  id: string
  /** Max 20 chars. */
  title: string
}

export interface LocationPin {
  latitude: number
  longitude: number
  name?: string | undefined
  address?: string | undefined
}

/** Posts JSON to your own systems (CRM, sheet, ticketing). Throws when the request fails. */
export interface WebhookService {
  post(url: string, payload: unknown): Promise<void>
}

/** Send WhatsApp messages directly, in addition to the agent's text reply. */
export interface Sender {
  text(body: string): Promise<void>
  /** Up to 3 quick-reply buttons. */
  buttons(body: string, buttons: ReplyButton[]): Promise<void>
  location(pin: LocationPin): Promise<void>
}

export interface AgentServices {
  knowledge: KnowledgeService
  leads: LeadService
  bookings: BookingService
  memory: MemoryStore
  send: Sender
  webhooks: WebhookService
  log(message: string, fields?: Record<string, unknown>): void
}

/** Everything a tool or hook can see and do. */
export interface AgentContext extends AgentServices {
  settings: AgentSettings
  business: BusinessContext
  customer: Customer
  conversationId: string
  /** True in the dashboard simulator: leads, bookings and sends are not real. */
  simulated: boolean
  /** Hand the conversation to a human. The agent stops replying until a person returns it. */
  handoff(reason: string): void
}

// Definitions written by developers

export interface ToolDefinition<TInput extends z.ZodTypeAny = z.ZodTypeAny, TOutput = unknown> {
  /** Tells the model when to use the tool. Also shown in the dashboard. */
  description: string
  /** Zod schema for the arguments the model must supply. */
  input: TInput
  run(input: z.infer<TInput>, ctx: AgentContext): Promise<TOutput> | TOutput
  /**
   * How many times the tool may run for one customer message. Set it on tools
   * with side effects (saving, sending, posting) so the model can't repeat them.
   * Every reply also has a cap of 10 tool calls in total.
   */
  maxCallsPerRun?: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = ToolDefinition<any, any>

export interface ToolCallRecord {
  id: string
  tool: string
  input: unknown
  output: unknown
  durationMs: number
  error?: string | undefined
}

export type BeforeReplyResult =
  /** Send this text instead of calling the model. */
  | { reply: string }
  /** Don't reply at all. */
  | { skip: true }
  /** Hand off to a human; the model still writes a short acknowledgement. */
  | { handoff: string }

export interface AfterReplyEvent {
  inbound: InboundEvent
  reply: string | null
  toolCalls: ToolCallRecord[]
}

export interface AgentHooks {
  /** Runs before the model. Return a result to short-circuit it. */
  beforeReply?(
    event: InboundEvent,
    ctx: AgentContext
  ): void | BeforeReplyResult | Promise<void | BeforeReplyResult>
  /** Runs after the model. Return `{ reply }` to rewrite or (with null) suppress the reply. */
  afterReply?(
    event: AfterReplyEvent,
    ctx: AgentContext
  ): void | { reply: string | null } | Promise<void | { reply: string | null }>
  /** Runs once when the conversation is handed to a human, e.g. to notify your team. */
  onHandoff?(event: { reason: string }, ctx: AgentContext): void | Promise<void>
}

export interface InstructionsArgs {
  settings: AgentSettings
  customer: Customer
  /** The prompt built from dashboard settings. Include it unless you want to replace it. */
  defaults: string
  /** Full context, e.g. to read `ctx.memory` into the prompt. */
  ctx: AgentContext
}

export interface AgentDefinition {
  /** Any AI SDK language model. Defaults to the host's model (OPENAI_MODEL, gpt-5.4-mini). */
  model?: LanguageModel
  /**
   * A string is appended to the dashboard prompt. A function returns the
   * complete prompt (use `defaults` to keep the dashboard settings).
   */
  instructions?: string | ((args: InstructionsArgs) => string | Promise<string>)
  /** Tools the agent can use. Keys are tool names; switch them on in the dashboard. */
  tools?: Record<string, AnyTool>
  /** Max model/tool round trips per reply. Default 5. */
  maxSteps?: number
  /** Max tokens the model may write per step, reasoning included. Default 600. */
  maxOutputTokens?: number
  hooks?: AgentHooks
}

// Running

export interface RunInput {
  definition: AgentDefinition
  settings: AgentSettings
  /** Recent messages, oldest first, ending with the customer's current message. */
  history: ChatMessage[]
  inbound: InboundEvent
  customer: Customer
  conversationId: string
  services: AgentServices
  simulated?: boolean
  /** Used when the definition does not set `model`. */
  defaultModel: LanguageModel
}

export interface RunResult {
  /** Text to send to the customer, or null when nothing should be sent. */
  reply: string | null
  handoffReason: string | null
  toolCalls: ToolCallRecord[]
  usage: { inputTokens: number; outputTokens: number }
  /** Where the reply came from. */
  source: 'model' | 'hook' | 'rule' | 'fallback' | 'skipped'
  /** Why the model call failed, when the fallback message was used because of an error. */
  error?: string
}
