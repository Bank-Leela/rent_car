import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidCronAuth, getCronSecret } from "./cron";

afterEach(() => vi.unstubAllEnvs());

describe("cron auth", () => {
  it("is null / rejects everything when CRON_SECRET is unset", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(getCronSecret()).toBeNull();
    expect(isValidCronAuth("Bearer anything")).toBe(false);
    expect(isValidCronAuth(null)).toBe(false);
  });

  it("accepts only the exact bearer, case-insensitive prefix", () => {
    vi.stubEnv("CRON_SECRET", "s3cr3t-token");
    expect(isValidCronAuth("Bearer s3cr3t-token")).toBe(true);
    expect(isValidCronAuth("bearer s3cr3t-token")).toBe(true);
    expect(isValidCronAuth("s3cr3t-token")).toBe(true); // bare, no prefix
    expect(isValidCronAuth("Bearer wrong")).toBe(false);
    expect(isValidCronAuth("Bearer s3cr3t-token ")).toBe(false); // trailing space differs
    expect(isValidCronAuth(null)).toBe(false);
  });
});
