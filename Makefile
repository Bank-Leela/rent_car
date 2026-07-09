# Stable entrypoints for agents + humans. The real commands live in package.json;
# these are the one-word aliases (`make check` is the default verifier).
.PHONY: check verify test typecheck lint build dev seed migrate sim help

# Full pre-commit gate: types + lint + tests. Matches CI (minus the DB steps).
check: typecheck lint test
verify: check

typecheck:
	npm run typecheck
lint:
	npm run lint
# DB-backed booking tests need --no-file-parallelism (see AGENTS.md / toolchain memory).
test:
	npx vitest run --no-file-parallelism
build:
	npm run build
dev:
	npm run dev
seed:
	npx prisma db seed
migrate:
	npx prisma migrate deploy
# Scheduling scenario check — rule-check counters must stay 0 (AGENTS.md).
sim:
	npx tsx scripts/simulate-cr07.ts --scenario=mixed

help:
	@echo "make check    - typecheck + lint + test (the verifier)"
	@echo "make build    - production build (runs migrate deploy)"
	@echo "make sim      - scheduling scenario check (counters must be 0)"
	@echo "make dev/seed/migrate/typecheck/lint/test - individual steps"
