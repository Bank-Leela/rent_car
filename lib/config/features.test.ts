import { afterEach, describe, expect, it, vi } from "vitest";
import { isSimulationEnabled } from "./features";

afterEach(() => vi.unstubAllEnvs());

describe("isSimulationEnabled", () => {
  it("is on in dev by default, off in production", () => {
    vi.stubEnv("ENABLE_SIMULATION", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(isSimulationEnabled()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(isSimulationEnabled()).toBe(false);
  });

  it("is on in production only when explicitly enabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_SIMULATION", "true");
    expect(isSimulationEnabled()).toBe(true);
  });
});
