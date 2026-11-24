# Contributing to Bluetick

Thanks for helping out. This guide covers what you need to open a good pull request.

## Getting set up

```bash
pnpm install
docker compose up -d                      # Postgres with pgvector
cp apps/web/.env.example apps/web/.env    # set ADMIN_PASSWORD; OPENAI_API_KEY for the model
pnpm db:setup
pnpm dev
```

You don't need WhatsApp credentials to work on the dashboard, the setup assistant or the
simulator. For model calls without spending OpenAI credits, point `OPENAI_BASE_URL` at a local
OpenAI-compatible server such as Ollama (knowledge-base embeddings need a model with 1536
dimensions, set with `OPENAI_EMBEDDING_MODEL`).

## Before you open a PR

```bash
pnpm check   # lint, typecheck and tests
pnpm build
```

CI runs the same commands. Keep PRs focused on one change and describe what you tested.

## Where things live

- `packages/agent`: the runtime (`runAgent`), `defineAgent`/`defineTool`, built-in tools and
  test helpers. It has no I/O of its own; keep it that way so agents stay testable.
- `apps/web`: the Next.js app. API routes validate input with Zod schemas from
  `src/lib/schemas.ts` and check the session with `isSignedIn()`.
- `examples/`: complete agents with tests. New examples should have tests and a README.

## Changing the database

Edit `apps/web/prisma/schema.prisma`, then create a migration against a local database:

```bash
pnpm --filter @bluetick/web exec prisma migrate dev --name describe-the-change
```

Commit the generated folder under `apps/web/prisma/migrations`.

## Code guidelines

- TypeScript strict mode, no `any`.
- Validate every request body with Zod.
- Show errors to the user; don't swallow them.
- Never log message content or phone numbers (`src/lib/log.ts` explains why).
- Add or update tests for logic you change.

## Commit messages

Short imperative subject line, for example `Add a menu tool to the restaurant example` or
`Fix handoff when the agent is paused`.

## Code of conduct

By taking part you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
