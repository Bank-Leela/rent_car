import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({ getTranslations: vi.fn(async () => (k: string) => k) }));
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "seed-user-admin", roles: ["ADMIN"] } })),
}));

import { prisma } from "@/lib/db";
import { runDemoSimulation } from "@/lib/booking/batch-demo-actions";

async function wipe() {
  await prisma.booking.deleteMany({ where: { purpose: { startsWith: "BatchDemo:" } } });
  await prisma.driver.updateMany({
    where: { isActive: true },
    data: { lastTjwAt: null, lastOtAt: null, lastDutyAt: null, lastAssignedAt: null },
  });
}

beforeAll(wipe);
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe("runDemoSimulation — fuzz", () => {
  it("random 3-day month: pipeline runs, ZERO rule violations (overflow is fine)", async () => {
    const summary = await runDemoSimulation(new Date("2026-09-01T00:00:00"), 3, 4242);

    expect(summary.seed).toBe(4242);
    expect(summary.days).toBe(3);
    expect(summary.seededCount).toBeGreaterThan(0);
    expect(summary.perDay).toHaveLength(3);
    // The whole point: random load may overflow, but the schedule must stay legal.
    expect(summary.ruleViolations).toEqual([]);
  }, 60000);
});
