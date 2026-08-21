# Operating Protocol — rent_car (summary)

Rule, not reference. Obey every turn. Full version: `docs/harness-protocol-full.md`.

---

## 1. The loop

```
Observe → Plan → Check permissions → Act → Inspect → Verify → Report
```

## 2. Risk tiers

| Tier | Examples | Default |
|------|----------|---------|
| Low | Read, list dir, graph queries, `git status` | Run |
| Medium | Edit `.tsx`/`.ts`, add Prisma field, `npm run dev` | Run, verify after |
| High | Edit `schema.prisma`, `prisma migrate`, `.env*`, `proxy.ts`, `auth/*`, deps | Ask first |
| Critical | `prisma migrate reset`, `DROP TABLE`, `git push --force`, `rm -rf` tracked, secrets, prod deploy | Deny unless authorized this turn |

A user instruction does **not** carry over to the next turn for critical actions.

## 3. Tool policy

- Prefer `Edit` over `Write`. Never `Write` to `.env*`, `schema.prisma`, or `.claude/settings.local.json` without per-turn auth.
- Prisma: `generate` low, `migrate dev` medium, `migrate reset` / `db push --force-reset` critical.
- Git: read-only default. Commit when asked. Push only when explicitly asked **this turn**.
- Code-review-graph MCP first for codebase questions; `Grep`/`Glob` last resort.
- Network off by default.

## 4. Forbidden without per-turn auth

- `git push --force`, `git reset --hard`, `git clean -fdx`
- `prisma migrate reset`, `db push --force-reset`, raw `DROP` SQL
- Edit/print `.env*`, `*.pem`, `*token*`, `*secret*`, `*credential*`
- Write `~/.claude/settings.json` or `.claude/settings.local.json`
- Modify `proxy.ts`, `next.config.*`, `tsconfig.json` middleware

### 4a. Secrets policy

Read a secret-bearing file only when the current task needs it. Then
**do not print, output, commit, or exfiltrate its contents** — describe the value
and cite the line instead. `.env*` is additionally denied at the permission layer, so both
layers define the boundary.

`.env.example` is denied too, as a side effect of the `**/.env*` rule. That is
accepted: it holds names only, and it is readable with
`git show HEAD:.env.example`. Do not narrow the rule to expose it.

**Deliberate deviation — credential globs are extension-scoped.** The deny list
covers `*credentials*.json` / `.txt` / `.yml`, not a bare `**/*credentials*`.
A generic health check will report this category as incomplete; leave it that way.
The broad glob was in force until 2026-08-18 and it matched
`lib/auth/credentials-actions.ts` — ordinary project source — which is why the
2026-08-17 bug hunt returned **zero** findings for authentication: every reviewer
was denied Read on the file. When `lib/auth` was finally audited on 2026-08-20 it
yielded two real defects (a login throttle keyed on a client-controlled header,
and an anti-enumeration hash at the wrong cost factor). Credential *data* files
stay denied; auth *source* stays readable.

## 5. Verification

| Change | Required |
|--------|----------|
| `.ts`/`.tsx` | `npx tsc --noEmit` |
| Page UI | `npm run dev` + browser check |
| `schema.prisma` | `npx prisma generate` + `migrate diff` dry-run |
| Server action / route | exercise or write test |
| Seed | `npx prisma db seed` |

Retry limit: 3 cycles per failure. Then surface to user.

## 6. Completion report

```md
### Summary
### Files changed
### Verification
### Notes
```

All four sections required, even in caveman compression.

## 7. Memory rules

- Save: surprising user preferences, project decisions with rationale, external refs.
- Never: secrets, copied .env values, ephemeral chat state, derivable-from-git facts.
- Verify against current code before acting on a memory.

## 8. Non-negotiables

1. Instruction is not enforcement. Permissions/hooks/user are real gates.
2. Plan before act.
3. Verify before claiming done.
4. Smaller diffs win.
5. Stop early — ask when ambiguous and one question saves a wrong build.

---

See `docs/harness-protocol-full.md` for risk-tier examples, tool policy detail, completion-report format, and gotchas.
