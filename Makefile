# Stable entrypoints for agents + humans. The real commands live in package.json;
# these are the one-word aliases (`make check` is the default verifier).
.PHONY: check verify test typecheck lint build dev seed migrate sim help

# Full pre-commit gate: types + lint + tests — the same three CI runs, minus the
# DB setup steps (generate / migrate deploy / db seed) that CI does against its
# own Postgres service. Keep this list and ci.yml in step: for a while `check`
# ran lint and CI did not, so lint breakage could reach main unseen.
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
# All seven scenarios, not just `mixed`: AGENTS.md names the whole set, and the
# ones that actually stress the rule are `tight`, `chain` and `reclaim`. The
# script exits non-zero on any violation, so `set -e` in make stops at the first
# failing scenario.
# NOT piped into tail: a pipeline's exit status is the LAST command's, so
# `... | tail -5 || exit 1` would report tail's success and swallow every
# violation — the exact failure this target was just fixed to stop.
sim:
	@for s in mixed normal ot tjw tight chain reclaim; do \
		echo "── scenario=$$s"; \
		npx tsx scripts/simulate-cr07.ts --scenario=$$s || exit 1; \
	done

help:
	@echo "make check    - typecheck + lint + test (the verifier)"
	@echo "make build    - production build (runs migrate deploy)"
	@echo "make sim      - scheduling scenario check (counters must be 0)"
	@echo "make dev/seed/migrate/typecheck/lint/test - individual steps"
