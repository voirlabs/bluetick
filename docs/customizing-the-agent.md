# Customizing the agent

The agent is defined in one file: [`apps/web/agent.config.ts`](../apps/web/agent.config.ts). The platform handles WhatsApp, conversation history, the 24-hour window, opt-outs, human handoff, the inbox and the simulator. You decide what the agent knows and does.

Some of the agent lives in code and some in the dashboard:

| Code (`agent.config.ts`)                           | Dashboard                                                  |
| -------------------------------------------------- | ---------------------------------------------------------- |
| Which model to use                                 | System prompt, greeting, fallback message                  |
| Extra or dynamic instructions                      | Business details (name, hours, address, timezone)          |
| Which tools exist and what they do                 | Which tools are switched on                                |
| Hooks that run before/after replies and on handoff | Language, allowed topics, escalation rules, knowledge base |

A developer adds a `checkOrder` tool once; the business owner switches it on and tunes the prompt without touching code.

## A complete example

```ts
import { builtin, defineAgent, defineTool } from '@bluetick/agent'
import { z } from 'zod'

const checkOrder = defineTool({
  description: 'Look up an order by its number',
  input: z.object({ orderId: z.string() }),
  run: async ({ orderId }, ctx) => {
    const order = await myShop.getOrder(orderId)
    if (!order || order.phone !== ctx.customer.phone) return { found: false }
    return { found: true, status: order.status, eta: order.eta }
  },
})

export default defineAgent({
  instructions: 'Ask for the order number before looking anything up.',
  tools: { ...builtin.all(), checkOrder },
  hooks: {
    onHandoff: async ({ reason }, ctx) => notifyTeam(`${ctx.customer.name}: ${reason}`),
  },
})
```

Then open **Agent** in the dashboard and switch on `checkOrder`. Try it in the **Simulator** tab: it runs this exact definition.

Complete, tested agents live in [`examples/`](../examples).

## `defineAgent(options)`

| Option            | Type                                                                                                                            | Default                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `model`           | Any [AI SDK](https://ai-sdk.dev/providers) language model                                                                       | `OPENAI_MODEL` (gpt-5.4-mini) |
| `instructions`    | `string` appended to the dashboard prompt, or `({ settings, customer, defaults, ctx }) => string` that returns the whole prompt | none                          |
| `tools`           | `Record<name, Tool>`                                                                                                            | none                          |
| `maxSteps`        | Max model/tool round trips per reply                                                                                            | `5`                           |
| `maxOutputTokens` | Max tokens the model writes per step, reasoning included. Raise it for models that reason at length                             | `600`                         |
| `hooks`           | See below                                                                                                                       | none                          |

Use a function for `instructions` when the prompt depends on something at runtime: today's date, the customer, or `ctx.memory`. Include `defaults` to keep the dashboard settings. Platform rules (identify as AI, plain text, don't invent facts, stay on topic) are always appended.

### Using another model

```bash
# The app is on AI SDK 7: install the current provider package
pnpm --filter @bluetick/web add @ai-sdk/anthropic
```

```ts
import { anthropic } from '@ai-sdk/anthropic'
export default defineAgent({ model: anthropic('claude-sonnet-4-5'), tools: builtin.all() })
```

Pick the model ID from the provider's docs. For any OpenAI-compatible server (Ollama, OpenRouter, LM Studio) you don't need code: set `OPENAI_BASE_URL` and `OPENAI_MODEL`. Knowledge-base embeddings go through the same base URL with `OPENAI_EMBEDDING_MODEL`, which must return 1536 dimensions.

## `defineTool({ description, input, run, maxCallsPerRun })`

- `description` tells the model when to use the tool and is shown in the dashboard. Be specific.
- `input` is a zod schema. Use `.describe()` on fields to guide the model.
- `run(input, ctx)` returns anything JSON-serializable. The model reads it and writes the reply.
- `maxCallsPerRun` (optional) caps how often the tool runs for one customer message. Set it to `1` on tools with side effects. Every reply also stops after 10 tool calls in total.

If `run` throws, the model only learns that the tool failed and is told to apologise, so one failing API doesn't break the conversation and internal error text never reaches the customer. The error itself shows in the inbox and in the simulator, next to each tool call and its result.

The key in `tools: { ... }` is the tool's name. Names are what the dashboard stores, so renaming a tool means switching it on again.

## `ctx`

| Field                                                       | What it is                                                                                                                                |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx.customer`                                              | `{ phone, name }`. Phone is E.164, e.g. `+15551234567`                                                                                    |
| `ctx.business`                                              | Business details from the dashboard (`businessName`, `industry`, `description`, `hours`, `location`, `timezone`, `latitude`, `longitude`) |
| `ctx.settings`                                              | All dashboard settings for the agent                                                                                                      |
| `ctx.conversationId`                                        | Stable ID for this customer's conversation                                                                                                |
| `ctx.knowledge.search(query, topK?)`                        | Semantic search over the knowledge base                                                                                                   |
| `ctx.leads.save(fields)`                                    | Store a lead. It shows under **Captured** in the inbox                                                                                    |
| `ctx.bookings.request(details)`                             | Store a booking request with status `pending`. It shows under **Captured** in the inbox                                                   |
| `ctx.memory.get(key)` / `set(key, value)`                   | Per-conversation storage that survives between messages                                                                                   |
| `ctx.send.text(body)`                                       | Send an extra WhatsApp message now                                                                                                        |
| `ctx.send.buttons(body, [{ id, title }])`                   | Up to 3 quick-reply buttons (titles max 20 chars). A tapped button arrives as a normal message with its title as text                     |
| `ctx.send.location({ latitude, longitude, name, address })` | A map pin                                                                                                                                 |
| `ctx.webhooks.post(url, payload)`                           | POST JSON to your own system; throws on a non-2xx answer. In the simulator nothing is sent                                                |
| `ctx.handoff(reason)`                                       | Hand the conversation to a human. The agent stops replying until someone clicks **Return to agent** in the inbox                          |
| `ctx.simulated`                                             | `true` in the dashboard simulator. Leads, bookings and sends are not saved there, and memory lasts for one reply                          |
| `ctx.log(message, fields)`                                  | Structured server log                                                                                                                     |

If a tool sends something with `ctx.send` and the model has nothing to add, no extra text is sent.

Tools run with your server's credentials. Treat tool input as untrusted (it comes from the model, which reads customer messages), and check that data belongs to `ctx.customer` before returning it. The [order lookup example](../examples/order-lookup) shows how.

## Hooks

```ts
hooks: {
  beforeReply: async (message, ctx) => {
    // message: { text, kind: 'text' | 'voice' | 'image' | 'interactive' | 'location' | 'media' | 'other', image? }
    if (isClosedNow()) return { reply: 'We are closed right now, we open at 9am.' } // skip the model
    if (message.kind === 'media') return { handoff: 'Customer sent a file' }        // a human takes over
    if (isSpam(message.text)) return { skip: true }                                  // don't reply
  },
  afterReply: async ({ reply, toolCalls }, ctx) => {
    return { reply: `${reply}\n\nReply STOP to opt out.` }                          // rewrite (or null to suppress)
  },
  onHandoff: async ({ reason }, ctx) => {
    // runs once per handoff, from a tool, a hook or a keyword rule
  },
}
```

Errors in hooks are logged and the reply continues without them.

## Built-in tools

`builtin.all()` returns these under their standard names. Use them individually to rename or pick a subset: `tools: { faq: builtin.knowledge() }`. A renamed `builtin.requestHuman()` still drives the escalation rules.

| Name                  | Factory                     | Does                                                        |
| --------------------- | --------------------------- | ----------------------------------------------------------- |
| `answerFromKnowledge` | `builtin.knowledge()`       | Searches the knowledge base                                 |
| `collectLead`         | `builtin.collectLead()`     | Saves contact details and intent                            |
| `bookAppointment`     | `builtin.bookAppointment()` | Records a booking request (never confirms)                  |
| `requestHuman`        | `builtin.requestHuman()`    | Hands off to a human                                        |
| `sendBusinessHours`   | `builtin.businessHours()`   | Returns hours from the dashboard                            |
| `sendLocation`        | `builtin.location()`        | Returns the address; sends a map pin if coordinates are set |

### Send data to your own systems

Two more built-ins need a URL, so they're not in `builtin.all()`. The URL is fixed in your code; the model never chooses where data goes. In the simulator nothing is sent: the reply notes where it would have gone.

```ts
tools: {
  ...builtin.all(),
  // POSTs { summary, details, customer, conversationId, test, sentAt } to your CRM, Zapier or Make.
  sendToCrm: builtin.webhook({ url: 'https://hooks.zapier.com/hooks/catch/123/abc' }),
  // Adds a row to a Google Sheet (script below). The secret must match the script's SECRET.
  saveToSheet: builtin.saveToSheet({
    url: 'https://script.google.com/macros/s/.../exec',
    secret: process.env.SHEET_SECRET,
  }),
},
```

For the sheet, open **Extensions → Apps Script** in your Google Sheet, paste this, set `SECRET` to a long random string (`openssl rand -hex 16`, the same value as `SHEET_SECRET` on your server), then **Deploy → New deployment → Web app** with access set to **Anyone**, and use the web app URL:

```js
const SECRET = 'paste-a-long-random-string-here'

// A cell starting with = + - @ (or a tab or carriage return) would run as a
// formula; the apostrophe makes Sheets keep it as text.
const asText = (value) => {
  const text = String(value ?? '')
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents)
  if (body.secret !== SECRET) return ContentService.createTextOutput('forbidden')
  const row = {}
  for (const [key, value] of Object.entries(body.row)) row[asText(key)] = asText(value)
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0]
  const headers = sheet.getLastRow()
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    : []
  for (const key of Object.keys(row)) if (!headers.includes(key)) headers.push(key)
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
  sheet.appendRow(headers.map((h) => row[h] ?? ''))
  return ContentService.createTextOutput('ok')
}
```

The web app URL is public, so the script only accepts rows that carry the secret. Keep both in your server's environment, not in the browser. The built-in tool already escapes formula characters; the script does it again so rows from anywhere else are safe too.

## Security

Customers are strangers on the internet, and anything they write reaches the model. Plan for that:

- **Everything the agent can read, a customer can get it to repeat.** That includes the knowledge base, the system prompt, the business details and whatever your tools return. Don't upload internal documents, prices you don't publish, staff details or credentials.
- **Pages added by URL are third-party text.** The agent reads them as context, so a page you don't control can carry instructions aimed at the model (indirect prompt injection). Add only pages you trust, and re-check them when they change.
- **Tools with side effects need caps and idempotency.** The model can call a tool again, or a customer can ask it to. Set `maxCallsPerRun: 1` on tools that save, send or post; make the receiving end ignore repeats (for example, key on `ctx.conversationId`); and check that data belongs to `ctx.customer` before returning it.
- **Escape what you forward.** Customer and model text sent to Slack or Discord can carry markup and mentions (`<!channel>`, `@everyone`); text sent to a spreadsheet can carry formulas (`=IMPORTXML(...)`). The built-in alerts and `saveToSheet` escape it. Do the same in your own tools and hooks.
- Each customer can send a limited number of messages (`CUSTOMER_MESSAGES_PER_10_MIN`, `CUSTOMER_MESSAGES_PER_DAY`); past that the agent stops answering them and the conversation waits in the inbox. Lead and booking alerts go out at most once an hour per conversation.

## Dashboard settings the runtime applies

- **Greeting** is used on the first reply of a conversation.
- **Language** is the default; the agent replies in the customer's language.
- **Allowed topics** restrict what the agent helps with.
- **Escalation rules**: `keyword` rules are matched in code (whole words, case-insensitive) and either hand off or send the fallback message without calling the model. `intent`, `sentiment` and `attempts_exceeded` rules always hand off: they become instructions for when to use the handoff tool, so they need `requestHuman` switched on.

## Testing your agent

`@bluetick/agent/testing` runs your agent with a scripted model and in-memory services, so tests need no API key, database or WhatsApp.

```ts
import { runAgent } from '@bluetick/agent'
import { mockModel, testRun } from '@bluetick/agent/testing'
import agent from './agent.config'

it('looks up the order', async () => {
  const model = mockModel([
    { toolCalls: [{ name: 'checkOrder', args: { orderId: 'A1' } }] },
    { text: 'It shipped yesterday.' },
  ])
  const { input, record } = testRun(agent, 'Where is A1?', { model })
  const result = await runAgent(input)
  expect(result.reply).toBe('It shipped yesterday.')
  expect(result.toolCalls[0]?.output).toMatchObject({ found: true })
})
```

`record` holds everything the agent did: `sent`, `leads`, `bookings`, `memory` and `posted` (webhook and sheet calls). Pass `history: [{ role: 'user', content: '...' }, { role: 'assistant', content: '...' }]` to test a later turn, `settings` to override dashboard settings such as `toolsEnabled` or `escalationRules`, and `knowledge` (an array of strings) for what knowledge search returns.

## What the agent can't be

WhatsApp Business terms do not allow general-purpose AI assistants (open-ended "ask me anything" bots) on the Business API. Agents must serve a business purpose: support, sales, bookings, orders, notifications. The setup assistant refuses general-purpose agents for this reason.
