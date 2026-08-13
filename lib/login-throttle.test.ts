import { beforeEach, describe, expect, it } from "vitest";
import {
  checkLoginThrottle,
  recordLoginFailure,
  clearLoginFailures,
  __resetLoginThrottle,
  LOGIN_THROTTLE,
} from "@/lib/login-throttle";

const { MAX_FAILS, WINDOW_MS, LOCK_MS } = LOGIN_THROTTLE;
const ID = "id:admin";
const IP = "ip:203.0.113.9";

beforeEach(() => __resetLoginThrottle());

describe("login throttle", () => {
  it("allows attempts below the cap", () => {
    for (let i = 0; i < MAX_FAILS - 1; i++) recordLoginFailure([ID, IP]);
    expect(checkLoginThrottle([ID, IP]).blocked).toBe(false);
  });

  it("locks out at the cap and reports how long", () => {
    for (let i = 0; i < MAX_FAILS; i++) recordLoginFailure([ID, IP]);
    const v = checkLoginThrottle([ID, IP]);
    expect(v.blocked).toBe(true);
    expect(v.retryAfterSeconds).toBeGreaterThan(0);
    expect(v.retryAfterSeconds).toBeLessThanOrEqual(LOCK_MS / 1000);
  });

  it("blocks if EITHER key is locked — one account from many IPs, or one IP over many accounts", () => {
    // Sweep: same address, a different identifier each time. The identifier
    // counters never reach the cap, but the address's does.
    const now = Date.now();
    for (let i = 0; i < MAX_FAILS; i++) recordLoginFailure([`id:user${i}`, IP], now);
    // A fresh identifier from that address is still refused.
    expect(checkLoginThrottle(["id:brand-new", IP], now).blocked).toBe(true);
    // ...while the same fresh identifier from a different address is fine.
    expect(checkLoginThrottle(["id:brand-new", "ip:198.51.100.4"], now).blocked).toBe(false);
  });

  it("expires the lock after LOCK_MS", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < MAX_FAILS; i++) recordLoginFailure([ID], t0);
    expect(checkLoginThrottle([ID], t0).blocked).toBe(true);
    expect(checkLoginThrottle([ID], t0 + LOCK_MS + 1).blocked).toBe(false);
  });

  it("forgets stale failures instead of accumulating them across the window", () => {
    // Attempts spread wider than the window must never add up to a lockout —
    // otherwise a user who mistypes once a day eventually locks themselves out.
    let t = 1_000_000;
    for (let i = 0; i < MAX_FAILS * 3; i++) {
      recordLoginFailure([ID], t);
      expect(checkLoginThrottle([ID], t).blocked, `attempt ${i} must not lock`).toBe(false);
      t += WINDOW_MS + 1;
    }
  });

  it("a correct password clears that identifier but NOT the address", () => {
    const now = Date.now();
    for (let i = 0; i < MAX_FAILS; i++) recordLoginFailure([ID, IP], now);
    clearLoginFailures(ID);
    // The identifier is forgiven...
    expect(checkLoginThrottle([ID], now).blocked).toBe(false);
    // ...but the address that was guessing is still locked, which is the point.
    expect(checkLoginThrottle([IP], now).blocked).toBe(true);
  });

  it("counts each key independently", () => {
    const now = Date.now();
    for (let i = 0; i < MAX_FAILS; i++) recordLoginFailure([ID], now);
    expect(checkLoginThrottle([ID], now).blocked).toBe(true);
    expect(checkLoginThrottle(["id:someone-else"], now).blocked).toBe(false);
  });
});
