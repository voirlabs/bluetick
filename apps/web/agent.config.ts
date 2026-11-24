/**
 * Your agent, in code.
 *
 * The dashboard controls the prompt, business details and which tools are
 * switched on. This file controls what the agent *can* do: the model, extra
 * instructions, tools and hooks. See docs/customizing-the-agent.md, and
 * examples/ for complete agents you can copy over this file.
 */
import { builtin, defineAgent } from '@bluetick/agent'

export default defineAgent({
  // Any AI SDK model works, e.g. anthropic('claude-...') from '@ai-sdk/anthropic'.
  // Leave unset to use OPENAI_MODEL (default gpt-5.4-mini).
  // model: anthropic('claude-sonnet-4-5'),

  // Appended to the prompt from the dashboard.
  // instructions: 'Always offer the weekly special when someone asks about the menu.',

  tools: {
    ...builtin.all(),
    // Send what customers share to your systems (docs/customizing-the-agent.md):
    // sendToCrm: builtin.webhook({ url: 'https://hooks.zapier.com/hooks/catch/...' }),
    // saveToSheet: builtin.saveToSheet({ url: 'https://script.google.com/macros/s/.../exec', secret: process.env.SHEET_SECRET }),
    // Add your own with defineTool(). Then switch it on in the dashboard.
    // checkOrder: defineTool({
    //   description: 'Look up an order by its ID',
    //   input: z.object({ orderId: z.string() }),
    //   run: async ({ orderId }, ctx) => myShop.getOrder(orderId),
    // }),
  },

  hooks: {
    // beforeReply: async (message, ctx) => { /* return { reply } | { skip: true } | { handoff } */ },
    // onHandoff: async ({ reason }, ctx) => { /* notify Slack, email, your CRM */ },
  },
})
