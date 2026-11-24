# Order lookup agent

Answers "where is my order?" on WhatsApp from your store's API and hands returns to a person.

```
Customer: Where's my order AC1001?
Agent:    It shipped and should arrive Thursday. Track it here: https://example.com/track/AC1001
Customer: The shirt is the wrong size, can I return it?
Agent:    Sure. A team member will reply here shortly to sort out the return.
          (conversation moves to "Needs attention" in the inbox)
```

## What it shows

| Feature                             | Where                                                          |
| ----------------------------------- | -------------------------------------------------------------- |
| Calling your own API from a tool    | `fetchOrder()`                                                 |
| Never leaking other customers' data | `ownsOrder()` checks the order belongs to `ctx.customer.phone` |
| Memory used in the prompt           | `instructions` reads `ctx.memory.get('lastOrderId')`           |
| Handing off from a tool             | `requestReturn` calls `ctx.handoff(...)`                       |
| Testing with a stubbed API          | `agent.test.ts`                                                |

## Use it

```bash
cp examples/order-lookup/agent.config.ts apps/web/agent.config.ts
```

Switch on `lookupOrder` and `requestReturn` under **Agent** in the dashboard.

Without configuration it uses two demo orders (`AC1001`, `AC1002`) that anyone can look up, so you can try it in the simulator. For real data set:

```env
ORDER_API_URL=https://your-shop.example.com/api   # GET {ORDER_API_URL}/orders/{id}
ORDER_API_TOKEN=...                               # sent as a Bearer token
```

The endpoint should return the `Order` shape defined at the top of `agent.config.ts`. If your store has a different API (Shopify, WooCommerce), change `fetchOrder()` only.

```bash
pnpm --filter @examples/order-lookup test
```
