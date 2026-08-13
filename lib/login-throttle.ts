/**
 * Failed-sign-in throttle.
 *
 * Before this, `authorize()` in auth.ts was a bare lookup-and-compare: no attempt
 * counter, no lockout, no per-IP cap, and no log line. An unauthenticated caller
 * could POST unlimited password guesses straight at
 * /api/auth/callback/credentials — bypassing the login form entirely — against a
 * known-good username like `admin`, with bcrypt's cost the only thing slowing them
 * down. Accounts are admin-provisioned and sign-in accepts username OR email, so
 * the identifier space is guessable.
 *
 * In-memory on purpose. The deploy target is a single self-hosted Node process
 * behind nginx (docs/deployment.md), so one process sees every attempt and this
 * needs no table and no migration. The tradeoffs, stated rather than hidden:
 *   - a restart clears the counters (an attacker cannot trigger a restart, and the
 *     window is minutes)
 *   - it does not span processes, so if this is ever run multi-instance behind a
 *     load balancer the effective limit multiplies by the instance count; that is
 *     the point at which it should move to Postgres or Redis
 *
 * Counted on TWO keys, whichever trips first: the identifier (so one account
 * cannot be ground down from many addresses) and the client IP (so one address
 * cannot sweep many accounts). A success clears only the identifier's counter —
 * one user signing in correctly must not reset an address that is mid-sweep.
 */
const WINDOW_MS = 15 * 60_000;
const LOCK_MS = 15 * 60_000;
/** Failures inside the window before the key is locked. */
const MAX_FAILS = 8;
/** Hard cap so a flood of distinct keys cannot grow the map without bound. */
const MAX_KEYS = 20_000;

type Bucket = { fails: number; windowStart: number; lockedUntil: number };

const buckets = new Map<string, Bucket>();

function prune(now: number) {
  for (const [k, b] of buckets) {
    if (b.lockedUntil <= now && now - b.windowStart > WINDOW_MS) buckets.delete(k);
  }
  if (buckets.size > MAX_KEYS) {
    // Oldest-window-first; Map preserves insertion order, which is close enough
    // for a safety valve that should never fire in normal use.
    const excess = buckets.size - MAX_KEYS;
    let dropped = 0;
    for (const k of buckets.keys()) {
      buckets.delete(k);
      if (++dropped >= excess) break;
    }
  }
}

export type ThrottleVerdict = { blocked: boolean; retryAfterSeconds: number };

/** Is any of these keys currently locked out? Does not record anything. */
export function checkLoginThrottle(keys: readonly string[], now = Date.now()): ThrottleVerdict {
  prune(now);
  let until = 0;
  for (const k of keys) {
    const b = buckets.get(k);
    if (b && b.lockedUntil > now) until = Math.max(until, b.lockedUntil);
  }
  return until > now
    ? { blocked: true, retryAfterSeconds: Math.ceil((until - now) / 1000) }
    : { blocked: false, retryAfterSeconds: 0 };
}

/** Count a failed attempt against every key; locks a key once it passes the cap. */
export function recordLoginFailure(keys: readonly string[], now = Date.now()): void {
  for (const k of keys) {
    const b = buckets.get(k);
    if (!b || now - b.windowStart > WINDOW_MS) {
      buckets.set(k, { fails: 1, windowStart: now, lockedUntil: 0 });
      continue;
    }
    b.fails += 1;
    if (b.fails >= MAX_FAILS) {
      b.lockedUntil = now + LOCK_MS;
      // Reset the window so the lock is not immediately re-extended by stragglers
      // that were already in flight.
      b.fails = 0;
      b.windowStart = now;
    }
  }
}

/** A correct password clears that identifier's counter. */
export function clearLoginFailures(key: string): void {
  buckets.delete(key);
}

/** Test seam only. */
export function __resetLoginThrottle(): void {
  buckets.clear();
}

export const LOGIN_THROTTLE = { WINDOW_MS, LOCK_MS, MAX_FAILS } as const;
