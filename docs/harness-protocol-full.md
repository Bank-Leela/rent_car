# Operating Protocol — rent_car

Distilled from `HARNESS_PROTOCOL.md`. This file is **rule**, not
reference. The agent must obey it on every turn. Where it conflicts with
older guidance, this file wins. Where it is silent, fall back to `CLAUDE.md`
and `AGENTS.md`.

---

## 0. The Loop

For every task, run exactly this sequence:

```
Observe → Plan → Check permissions → Act → Inspect → Verify → Report
```

Skipping a stage is a defect. Looping back is fine; jumping ahead is not.

---

## 1. Observe (Intake)

Before any tool call:

1. Read the request literally. Capture the exact target (file, function, route, table).
2. Classify the task: `read | edit | debug | refactor | test | docs | review | deploy`.
3. Classify risk: `low | medium | high | critical` using §3.
4. State the goal in one sentence so it can be checked at §7.

If goal, target, or risk is unclear, **ask one question** before acting. Do
not guess on destructive or stateful tasks.

---

## 2. Context Preparation

Project-specific rule: this repo has a knowledge graph (code-review-graph
MCP). It is faster and cheaper than file scans.

**Order of operations:**

1. `mcp__code-review-graph__semantic_search_nodes` / `query_graph` — locate code.
2. `mcp__code-review-graph__get_review_context` / `get_minimal_context` — pull snippets.
3. `Read` — only when graph cannot answer (config files, JSON, SQL fixtures, markdown).
4. `Grep` / `Glob` — last resort.

Rules:

- Read the **minimum** needed to plan. Re-reading a 2000-line file you saw two
  turns ago is waste.
- Compact or drop stale context before it crowds out the current task.
- Memory at `~/.claude/projects/-Users-bank-Downloads-rent-car/memory/` is authoritative
  for user preferences; verify against current code before acting on facts.

---

## 3. Risk Classification & Approval Gates

| Tier | Examples in this repo | Default |
|------|----------------------|---------|
| Low | Read source, list dir, `git status`, graph queries | Run, log |
| Medium | Edit a `.tsx`/`.ts` source file, add a Prisma model field, run `npm run dev` | Run, verify after |
| High | Edit `schema.prisma`, run `npx prisma migrate`, edit `.env*`, change `proxy.ts`, touch `auth/*`, modify `package.json` deps | Ask before running |
| Critical | `prisma migrate reset`, `DROP TABLE`, `git push --force`, `git reset --hard`, `rm -rf` on tracked paths, secrets export, production deploy | Deny unless user authorizes this turn |

A single user instruction does **not** authorize an action in a later turn.
Re-confirm on each critical action.

---

## 4. Tool Policy (rent_car-specific)

- **File edits:** prefer `Edit` (diff) over `Write` (full rewrite). Never use
  `Write` on `.claude/settings.local.json`, `.env*`, or `schema.prisma`
  without explicit per-turn authorization.
- **Bash:** preview the command in the `description` field. Commands with
  shell expansion, redirects, or piped destructive verbs (`rm`, `kill`, `dd`,
  `find … -delete`) require step §3 approval gating.
- **Prisma:** `npx prisma generate` is low risk; `migrate dev` is medium;
  `migrate reset` and `db push --force-reset` are critical.
- **Git:** read-only by default. Commits only when user asks. Never push
  without an explicit user instruction in the same turn.
- **MCP:** prefer code-review-graph for codebase questions. token-savior tools
  are also project-scoped. Avoid Google Drive unless user references a file
  there.
- **Network:** off by default. `WebFetch` / `WebSearch` only when the task
  cannot be solved with local knowledge.

---

## 5. Pre-Act / Post-Act Checks

Run these mentally before and after every tool call.

**PreToolUse:**

- Does this call match the §1 goal?
- Is the risk tier (§3) covered by current authorization?
- Is the path inside this repo (`/Users/bank/Downloads/rent_car`)?
- Will it leave the workspace in a worse state if it errors mid-way?

**PostToolUse:**

- Did it succeed? Read the actual output; do not assume.
- Did it print a secret, token, or password? If yes, redact before reuse.
- Did it produce a diff? Inspect the diff before the next action.
- Did it violate an assumption from §1? If yes, replan, do not patch over.

---

## 6. Verification

Before claiming completion on code changes, run the relevant subset:

| Change type | Required check |
|-------------|----------------|
| TypeScript/TSX edit | `npx tsc --noEmit` |
| Component / page UI | `npm run dev` + manual browser check + describe what was verified |
| Prisma schema | `npx prisma generate` + `npx prisma migrate dev` (or `migrate diff` for dry-run) |
| Server action / route | exercise the path or write a test |
| Seed / fixture | `npx prisma db seed` against a disposable DB |

If a check cannot be run (no terminal, no DB up), say so explicitly in the
report. Do not claim "should work."

Retry limit: at most 3 fix-and-rerun cycles for the same failure. After that,
stop and surface the failure to the user.

---

## 7. Completion Report

Final response on any non-trivial task must include:

```md
### Summary
<one or two sentences of what changed>

### Files changed
- path/to/file — what changed and why

### Verification
- `<command>` → pass | fail | not run (reason)

### Notes
- approval-gated actions taken / declined
- assumptions made
- limitations or follow-up
```

Caveman mode is allowed to compress this block, but every section must remain
present and parseable.

---

## 8. Memory Hygiene

- Save: surprising user preferences, project decisions with rationale,
  external references.
- Do not save: code snippets derivable from `git`, recent task state,
  ephemeral chat context.
- Verify a memory against current code before acting on it. Stale memory loses
  to current source.
- Never persist secrets, tokens, paths to private credentials, or copy/pasted
  `.env` values into memory.

---

## 9. Forbidden Without Per-Turn Authorization

- `git push --force` to `main`, `git reset --hard`, `git clean -fdx`
- `prisma migrate reset`, `db push --force-reset`, raw `DROP` SQL on `rent_car` DB
- editing or printing `.env*`, `*.pem`, anything matching `*token*`, `*secret*`, `*credential*`
- writing to `~/.claude/settings.json` or `~/.claude.json`
- installing new global packages, modifying `~/.zshrc` / `~/.config/fish/`
- creating files outside `/Users/bank/Downloads/rent_car` unless the user named the path
- modifying `proxy.ts`, `next.config.*`, `tsconfig.json` middleware glue

---

## 10. Non-Negotiables

1. **Instruction is not enforcement.** Permissions, hooks, and the user are the
   real gates. This file documents intent; the harness enforces.
2. **Plan, then act.** Acting before planning is the most common failure mode.
3. **Verify before claiming done.** No "should work." No "looks good."
4. **Smaller diffs win.** Touch the minimum needed. Refactors require an
   explicit user request, not a side quest.
5. **Stop early.** If the request is ambiguous and one question saves a wrong
   build, ask.

---

## 11. Quick Reference

```
risk?   →  §3
tools?  →  §4
gate?   →  §5
check?  →  §6
done?   →  §7
```
