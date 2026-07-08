import { afterEach, describe, expect, it, vi } from "vitest";
import { getAdobeSignConfig, isAdobeSignConfigured } from "./config";

const KEYS = ["ADOBE_SIGN_CLIENT_ID", "ADOBE_SIGN_CLIENT_SECRET", "ADOBE_SIGN_REFRESH_TOKEN", "ADOBE_SIGN_SHARD"] as const;

function setAll(present: boolean) {
  for (const k of KEYS) {
    if (present) vi.stubEnv(k, "x");
    else vi.stubEnv(k, "");
  }
}

afterEach(() => vi.unstubAllEnvs());

describe("adobe-sign config", () => {
  it("is null / not configured when any var is missing", () => {
    setAll(false);
    expect(getAdobeSignConfig()).toBeNull();
    expect(isAdobeSignConfigured()).toBe(false);
    // three of four present is still not configured
    setAll(true);
    vi.stubEnv("ADOBE_SIGN_SHARD", "");
    expect(isAdobeSignConfigured()).toBe(false);
  });

  it("returns the config when all four are set", () => {
    setAll(true);
    vi.stubEnv("ADOBE_SIGN_SHARD", "na1");
    const cfg = getAdobeSignConfig();
    expect(cfg).not.toBeNull();
    expect(cfg?.shard).toBe("na1");
    expect(isAdobeSignConfigured()).toBe(true);
  });
});
