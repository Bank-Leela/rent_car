import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (k: string) => k),
}));
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "seed-user-admin", roles: ["ADMIN"] } })),
}));
// Stand in for "this is production, and nobody opted in". Mocking the flag rather
// than NODE_ENV because the bundler may inline NODE_ENV, which would leave the
// guard reading a value this test never changed — a test that proves nothing.
vi.mock("@/lib/config/features", () => ({ isSimulationEnabled: () => false }));

import { prisma } from "@/lib/db";
import { simulateAndRunBatchAction, clearBatchDemoAction } from "@/lib/booking/batch-demo-actions";

/**
 * The two demo controls were guarded by requireRole("ADMIN") alone — and ADMIN is
 * the role that runs the real office. In production a stray click on จำลอง injected
 * eight fake APPROVED trips into the live schedule, overwrote that day's decided
 * เวร driver, and dispatched real drivers to the fakes; ล้างข้อมูลตัวอย่าง — with no
 * confirmation — nulled the rotation stamps for EVERY active driver on every date,
 * which is the fairness history the whole priority order is computed from and is
 * not recoverable from the bookings.
 *
 * These assert the SERVER-side refusal. Hiding the buttons is not a guard: a server
 * action is callable whether or not its button ever rendered.
 */
describe("demo actions refuse to run when the simulator is disabled", () => {
  it("simulate is refused, and seeds nothing", async () => {
    const before = await prisma.booking.count({ where: { purpose: { startsWith: "BatchDemo:" } } });

    const fd = new FormData();
    fd.set("date", "2027-10-05");
    const res = await simulateAndRunBatchAction(fd);

    expect(res.ok).toBe(false);
    const after = await prisma.booking.count({ where: { purpose: { startsWith: "BatchDemo:" } } });
    expect(after, "a refused simulate must not write demo bookings").toBe(before);
  });

  it("clear demo data is refused, and every driver keeps their rotation history", async () => {
    // The assertion that matters: the stamps SURVIVE. They are what the rotation
    // priority is computed from, and nulling them cannot be undone.
    const snapshot = () =>
      prisma.driver.findMany({
        where: { isActive: true },
        select: { id: true, lastAssignedAt: true, lastDutyAt: true, lastOtAt: true, lastTjwAt: true },
        orderBy: { id: "asc" },
      });

    const before = await snapshot();
    const res = await clearBatchDemoAction(new FormData());

    expect(res.ok).toBe(false);
    expect(await snapshot(), "rotation history must be untouched by a refused call").toEqual(before);
  });
});

describe("the flag itself", () => {
  it("is off in production unless an operator opts in", async () => {
    // Tested directly on the pure function, with no bundler indirection.
    vi.resetModules();
    vi.doUnmock("@/lib/config/features");
    const env = process.env as Record<string, string | undefined>;
    const [origEnv, origFlag] = [env.NODE_ENV, env.ENABLE_SIMULATION];
    try {
      const real = await vi.importActual<typeof import("@/lib/config/features")>(
        "@/lib/config/features",
      );
      env.NODE_ENV = "production";
      delete env.ENABLE_SIMULATION;
      expect(real.isSimulationEnabled(), "off in production by default").toBe(false);

      env.ENABLE_SIMULATION = "true";
      expect(real.isSimulationEnabled(), "explicit opt-in still works for debugging").toBe(true);

      env.NODE_ENV = "development";
      delete env.ENABLE_SIMULATION;
      expect(real.isSimulationEnabled(), "on in development, where the demo flow lives").toBe(true);
    } finally {
      env.NODE_ENV = origEnv;
      if (origFlag === undefined) delete env.ENABLE_SIMULATION;
      else env.ENABLE_SIMULATION = origFlag;
    }
  });
});
