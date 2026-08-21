@AGENTS.md
@HARNESS_PROTOCOL.md

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

There is a knowledge graph of this repo, kept current by a PostToolUse hook
(`.claude/settings.json`). It answers *structural* questions — who calls this,
what breaks if I change it, what tests cover it — from an index, without reading
the files. For an exact string — a literal, a Thai message, a config key — Grep
is still faster and exact. The graph is for structure and for the questions where
you do not yet know the name to grep for.

This section used to say ALWAYS use the graph before Grep/Glob/Read. That rule
was followed once in 2060 tool calls, because it is not how the work actually
goes — so it is now scoped to the three questions the graph genuinely answers
better, and Grep/Read are the ordinary way to read this codebase.

| Tool | Use when |
| ------ | ---------- |
| `query_graph` | callers_of / callees_of / imports_of / **tests_for** — beats grepping for a symbol's uses |
| `get_impact_radius` | blast radius before changing a shared helper |
| `get_affected_flows` | which execution paths a change touches |
| `detect_changes` + `get_review_context` | reviewing a diff without reading whole files |
| `get_architecture_overview` / `list_communities` | orienting in an unfamiliar area |
| `refactor_tool` | planning a rename, finding dead code |
| `semantic_search_nodes` | you know the BEHAVIOUR but not the name — "the rule that decides whether two bookings may share a car" finds §5c without knowing `sharesCarWith` exists |

`semantic_search_nodes` works as of 2026-08-21 — 1,724 nodes embedded locally
with `all-MiniLM-L6-v2`, no API key and no network at query time. It runs
`hybrid` (vectors + keyword), so it degrades to keyword matching rather than
returning nothing.

Embeddings are **not** refreshed by the PostToolUse hook, which only updates the
graph structure. After a large change, re-run:

```bash
code-review-graph embed --repo .        # incremental; only new nodes
```

If it ever reports 0 embeddings, `sentence-transformers` has been dropped from
the tool environment — reinstall with
`uv tool install code-review-graph --with sentence-transformers --force`, which
records the dependency so `uv tool upgrade` keeps it.

## Verify before done

Run `make check` (typecheck + lint + test) after `.ts`/`.tsx` changes — lint is
part of the gate and CI runs all three. Scheduling changes additionally need
`make sim` (all seven scenarios; it exits non-zero on any rule violation). Full
risk-tier + verification rules: `@HARNESS_PROTOCOL.md` §5. Scope/boundary (what
needs per-turn auth): §2 risk tiers.

## Secrets

Read a secret-bearing file only when the current task needs it. Then
**do not print, output, commit, or exfiltrate its contents** — describe the value
and cite the line instead. `.env*` is denied at the permission layer as well, so
both layers define the boundary; `.env.example` is caught by the same rule on
purpose (`git show HEAD:.env.example` to read it). Credential globs are
deliberately extension-scoped so `lib/auth/*credentials*.ts` stays readable —
`@HARNESS_PROTOCOL.md` §4a says why, and why a health check will call that
category incomplete.
