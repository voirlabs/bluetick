# Working on Bluetick

- Work on a branch and open a pull request. Never push to `main`.
- Run `pnpm check` (lint, typecheck, tests) and `pnpm build` before you finish. Both must pass with no API keys set.
- Layout: `apps/web` (Next.js app), `packages/agent` (`@bluetick/agent` runtime), `examples/*` (agents with tests).

## Invariants

- One agent per deployment: the `agent` row with id `default` (`AGENT_ID` in `apps/web/src/lib/agent/definition.ts`). Don't add multi-agent or multi-user code paths.
- `packages/agent` has no I/O. Everything external goes through `AgentServices`, so WhatsApp, the simulator and tests share one code path.
- The webhook verifies `X-Hub-Signature-256` over the raw body before parsing. Keep secret comparisons constant-time (`safeEqual` in `lib/auth.ts`).
- Every API route checks `isSignedIn()` (except login, sign-out and the webhook) and validates input with Zod from `lib/schemas.ts`. `proxy.ts` rejects cross-site mutations.
- Every inbound message is stored, even when the agent is paused, missing or in handoff. Show failures in the UI instead of swallowing them.
- Never log message content or phone numbers.
- Schema changes need a migration in `apps/web/prisma/migrations`.
- The product name and repo URL come from `apps/web/src/lib/site.ts`.
