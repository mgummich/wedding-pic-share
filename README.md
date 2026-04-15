# Wedding Pic Share

Self-hosted photo sharing app for weddings: guests upload photos/videos, admins moderate and publish, and viewers see live updates in gallery/slideshow views.

## Monorepo

- `apps/frontend`: Next.js web app (guest + admin UI)
- `apps/backend`: Fastify API (auth, uploads, moderation, SSE, archive/export)
- `packages/db`: Prisma schema/client
- `packages/shared`: shared API/UI types
- `docs`: VitePress documentation + OpenAPI

## Requirements

- Node.js `>=20`
- pnpm `>=9`

## Quick Start (Local)

1. Install dependencies:

```bash
pnpm install
```

2. Create your environment:

```bash
cp .env.example .env
```

3. Set required values in `.env`:

- `SESSION_SECRET` (min 32 chars)
- `ADMIN_PASSWORD` (min 12 chars)
- `SETUP_TOKEN` (for first-time setup endpoint)

4. Generate DB client and run migrations:

```bash
pnpm db:generate
pnpm db:migrate
```

5. Start development:

```bash
pnpm dev
```

Default local URLs:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:4000`

## Docker (Production-like)

Start stack:

```bash
docker compose up -d --build
```

Services:

- `backend-migrate` (one-shot migration job before backend boot)
- `backend`
- `frontend`
- `backup` (scheduled volume snapshots)

## Common Commands

```bash
pnpm dev
pnpm build
pnpm test
pnpm lint
pnpm typecheck
pnpm docs:dev
pnpm docs:build
```

Package-scoped examples:

```bash
pnpm --filter @wedding/backend test
pnpm --filter @wedding/frontend test
pnpm --filter @wedding/frontend test:e2e
```

## Documentation

- Docs homepage: `docs/index.md`
- Deployment: `docs/deployment.md`
- Operator runbook: `docs/runbook.md`
- Architecture decisions: `docs/architecture-decisions.md`
- API docs: `docs/api/`
- OpenAPI spec: `docs/api/openapi.yaml`

Run docs locally:

```bash
pnpm docs:dev
```

## Security Notes

- Do not deploy with default `.env` values.
- Keep `SETUP_TOKEN` secret and rotate after initial setup.
- In production, configure `REDIS_URL` for distributed brute-force protection and SSE fan-out.
- Use HTTPS and secure cookie settings (`COOKIE_SECURE=true`).

## Contributing

See `CONTRIBUTING.md`.
