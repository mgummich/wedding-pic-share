# Contributing

## Prerequisites
- Node.js 20+
- pnpm 9.x
- Docker / docker-compose (optional for full-stack runs)

## Setup
```bash
pnpm install
pnpm --filter @wedding/db run db:generate
```

## Local Development
```bash
pnpm dev
```

## Quality Gates (before pushing)
```bash
pnpm lint
pnpm typecheck
pnpm test
```

For frontend E2E:
```bash
pnpm --filter @wedding/frontend exec playwright install --with-deps chromium
pnpm --filter @wedding/frontend test:e2e
```

## Commit Guidance
- Keep commits scoped to one concern.
- Use conventional-style prefixes where possible (e.g. `feat:`, `fix:`, `docs:`, `chore:`).
- Include tests or rationale for non-testable changes.

## API Documentation
- OpenAPI source: `docs/api/openapi.yaml`
- Update it when adding/changing endpoints or response shapes.

## Operations Documentation
- Operator runbook: `docs/runbook.md`
- Deployment notes: `docs/deployment.md`
- Architecture decisions: `docs/architecture-decisions.md`
