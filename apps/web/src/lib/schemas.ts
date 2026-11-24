import { z } from 'zod'

/** Length limits shared by the API and the builder's tool schema. */
export const LIMITS = {
  name: 200,
  systemPrompt: 10_000,
  message: 1000,
  rules: 50,
  ruleValue: 200,
  topics: 50,
  topic: 100,
} as const

/** Knowledge-base sources per deployment. */
export const MAX_SOURCES = 10

const optionalText = (max: number) => z.string().trim().max(max).optional()

const businessContextSchema = z.object({
  businessName: optionalText(200),
  industry: optionalText(100),
  description: optionalText(2000),
  hours: optionalText(500),
  timezone: optionalText(100),
  location: optionalText(500),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
})

const escalationRuleSchema = z.object({
  condition: z.enum(['keyword', 'intent', 'attempts_exceeded', 'sentiment']),
  value: z.string().trim().min(1).max(LIMITS.ruleValue),
  action: z.enum(['handoff', 'fallback']),
})

/** The full agent configuration, as produced by the setup builder. */
export const agentConfigSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.name),
  systemPrompt: z.string().trim().min(10).max(LIMITS.systemPrompt),
  businessContext: businessContextSchema,
  toolsEnabled: z.array(z.string().max(100)).max(50),
  greetingMessage: z.string().max(LIMITS.message),
  fallbackMessage: z.string().trim().min(1).max(LIMITS.message),
  escalationRules: z.array(escalationRuleSchema).max(LIMITS.rules),
  allowedTopics: z.array(z.string().trim().min(1).max(LIMITS.topic)).max(LIMITS.topics),
  language: z.string().trim().min(2).max(20),
})

/** Partial updates from the agent settings page. */
export const agentUpdateSchema = agentConfigSchema
  .partial()
  .extend({ status: z.enum(['active', 'paused']).optional() })

export const conversationActionSchema = z.object({
  action: z.enum(['take_over', 'return_to_agent', 'resolve']),
})

export const manualReplySchema = z.object({
  message: z.string().trim().min(1).max(4096),
})

export const knowledgeSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('url'),
    url: z
      .string()
      .trim()
      .url('Enter a full URL, starting with https://')
      .max(2000)
      .refine((u) => /^https?:\/\//i.test(u), 'Only http and https pages can be added'),
  }),
  z.object({
    type: z.literal('snippet'),
    name: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(5000),
  }),
])

/** Database ids passed in URLs. */
export const idSchema = z.string().min(1).max(64)

export const loginSchema = z.object({ password: z.string().min(1).max(500) })

export const templateSendSchema = z.object({
  name: z.string().trim().min(1).max(512),
  language: z.string().trim().min(2).max(15),
  values: z.record(z.string().max(64), z.string().max(1024)).default({}),
})

export const testMessageSchema = z.object({
  to: z.string().regex(/^\+?[\d\s()-]{8,20}$/, 'Enter a phone number with country code'),
})
