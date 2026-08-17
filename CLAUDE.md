@AGENTS.md
@HARNESS_PROTOCOL.md

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

There is a knowledge graph of this repo, kept current by a PostToolUse hook
(`.claude/settings.json`). It answers *structural* questions — who calls this,
what breaks if I change it, what tests cover it — from an index, without reading
the files. It does not answer "where is the string X", and it is not a search
engine: **it holds no embeddings** (`semantic_search_nodes` returns empty), so
finding code by name or keyword is still Grep's job.

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

`semantic_search_nodes` is non-functional until someone runs
`pip install sentence-transformers && code-review-graph embed --repo .`.

## Verify before done

Run `make check` (typecheck + lint + test) after `.ts`/`.tsx` changes — lint is
part of the gate and CI runs all three. Scheduling changes additionally need
`make sim` (all seven scenarios; it exits non-zero on any rule violation). Full
risk-tier + verification rules: `@HARNESS_PROTOCOL.md` §5. Scope/boundary (what
needs per-turn auth): §2 risk tiers.
