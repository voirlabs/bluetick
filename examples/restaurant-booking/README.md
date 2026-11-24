# Restaurant booking agent

Takes table requests on WhatsApp: checks seating hours, offers times as quick-reply buttons and records the request for staff to confirm.

```
Customer: Table for 2 on Friday around 7?
Agent:    [ 18:30 ] [ 19:00 ] [ 19:30 ]      ← tappable buttons
Customer: 19:00
Agent:    Great. What name should I put it under?
Customer: Sam
Agent:    Thanks Sam, I've requested 19:00 on Friday for 2. The team will confirm shortly.
```

## What it shows

| Feature                                                | Where                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| Custom tools with real logic                           | `checkAvailability`, `requestTable`                              |
| Quick-reply buttons                                    | `ctx.send.buttons(...)` in `checkAvailability`                   |
| Per-conversation memory                                | `ctx.memory` in `checkAvailability`, read back in `instructions` |
| Dynamic prompt (today's date in the business timezone) | `instructions: async ({ settings, defaults, ctx }) => ...`       |
| Answering without the model                            | `hooks.beforeReply` for "menu"                                   |
| Notifying your team                                    | `hooks.onHandoff` posts to Slack                                 |
| Testing your agent                                     | `agent.test.ts`                                                  |

## Use it

```bash
cp examples/restaurant-booking/agent.config.ts apps/web/agent.config.ts
```

Then in the dashboard, open **Agent** and switch on `checkAvailability`, `requestTable` and anything else you want. Tool names are stored per agent, so tools from a previous `agent.config.ts` are switched off. Set **Timezone** under **Business** so "Friday" resolves correctly, and the latitude and longitude if you want `sendLocation` to send a map pin.

Optional: set `SLACK_WEBHOOK_URL` to get a Slack message on every handoff.

## Make it yours

`SEATING`, `MAX_PARTY_SIZE` and `slotsFor()` are placeholders. Replace `slotsFor()` with a call to your reservation system and keep the rest.

```bash
pnpm --filter @examples/restaurant-booking test
```
