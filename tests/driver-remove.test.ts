import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

// Run adminRemoveDriverAction outside a request (mock Next cache + admin session).
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({
  requireRole: vi.fn(async () => ({ user: { id: "seed-user-admin", roles: ["ADMIN"] } })),
}));
import { adminRemoveDriverAction } from "@/lib/admin/driver-actions";

const stamp = Date.now();
const ids: { userId?: string; driverId?: string } = {};

afterAll(async () => {
  if (ids.driverId) await prisma.onCallShift.deleteMany({ where: { driverId: ids.driverId } });
  if (ids.driverId) await prisma.driver.deleteMany({ where: { id: ids.driverId } });
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } });
  await prisma.$disconnect();
});

describe("adminRemoveDriverAction — a driver on a duty rotation is deactivated, not FK-500'd", () => {
  it("deactivates (not deletes) a driver who has an OnCallShift but no bookings", async () => {
    const user = await prisma.user.create({
      data: { email: `rm-${stamp}@test.local`, username: `rm-${stamp}`, name: "Remove Test", isActive: true },
      select: { id: true },
    });
    ids.userId = user.id;
    const driver = await prisma.driver.create({
      data: { userId: user.id, pool: "PUBLIC", isActive: true },
      select: { id: true },
    });
    ids.driverId = driver.id;
    // On a duty rotation — the OnCallShift FK is ON DELETE RESTRICT and NOT in the
    // User→Driver cascade, so a hard-delete would 500. A far-future unique date
    // avoids colliding with the seeded roster.
    // Beyond the roster auto-fill horizon (MAX_LOOKAHEAD_DAYS), so viewing a
    // future board can never have rostered this date and collided with us.
    await prisma.onCallShift.create({ data: { date: new Date("2032-06-09T00:00:00"), driverId: driver.id } });

    const fd = new FormData();
    fd.append("driverId", driver.id);
    const res = await adminRemoveDriverAction(fd);
    expect(res.ok).toBe(true);

    // Deactivated, NOT deleted — the OnCallShift row is preserved.
    const drvAfter = await prisma.driver.findUnique({ where: { id: driver.id }, select: { isActive: true } });
    expect(drvAfter?.isActive).toBe(false);
    const userAfter = await prisma.user.findUnique({ where: { id: user.id }, select: { isActive: true } });
    expect(userAfter?.isActive).toBe(false);
    const shift = await prisma.onCallShift.findFirst({ where: { driverId: driver.id } });
    expect(shift).not.toBeNull();
  });
});
