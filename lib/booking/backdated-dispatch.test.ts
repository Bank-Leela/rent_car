import { afterAll, describe, expect, it, vi } from "vitest";
import { format, startOfDay, subDays } from "date-fns";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({ getTranslations: vi.fn(async () => (k: string) => k) }));
vi.mock("@/lib/email/client", () => ({ sendEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/line/client", () => ({ sendLineNotification: vi.fn(async () => {}) }));

import { prisma } from "@/lib/db";
import { runBatchForDay } from "@/lib/booking/batch-core";
import { dayHasRoomFor } from "@/lib/booking/approval-capacity";
import { stampRotationForward } from "@/lib/booking/rotation-stamp";

const MARK = "BACKDATED-DISPATCH:";

afterAll(async () => {
  const rows = await prisma.booking.findMany({
    where: { purpose: { startsWith: MARK } }, select: { id: true },
  });
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await prisma.auditLog.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

async function makePast(purpose: string) {
  const req = await prisma.user.findUniqueOrThrow({
    where: { id: "seed-user-requester" }, select: { departmentId: true },
  });
  const day = startOfDay(subDays(new Date(), 9));
  const start = new Date(day); start.setHours(9, 0, 0, 0);
  const end = new Date(day); end.setHours(12, 0, 0, 0);
  const b = await prisma.booking.create({
    data: {
      requesterId: "seed-user-requester", departmentId: req.departmentId!,
      purpose: `${MARK} ${purpose}`, destination: "X", province: "กรุงเทพมหานคร",
      startAt: start, endAt: end, passengerCount: 1,
      status: "APPROVED", jobType: "NORMAL", timeBucket: "MORNING_08_12",
    },
  });
  return { booking: b, day };
}

describe("จัด leaves days that already happened alone", () => {
  it("does not invent a driver for a past trip", async () => {
    // Measured before the guard: the solver assigned a driver AND a car to a
    // nine-day-old trip, and moved a driver's lastAssignedAt backwards.
    const { booking, day } = await makePast("solver must skip");
    const res = await runBatchForDay(format(day, "yyyy-MM-dd"), "seed-user-admin");
    expect(res.ok).toBe(true);
    expect(res.stats?.pendingCount, "a past day has no pending work to solve").toBe(0);

    const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.primaryDriverId, "the office says who drove, not the rotation").toBeNull();
    expect(after.vehicleId).toBeNull();
    expect(after.status).toBe("APPROVED");
  });

  it("still solves today", async () => {
    // The guard must not disable the feature it is protecting.
    const today = startOfDay(new Date());
    const res = await runBatchForDay(format(today, "yyyy-MM-dd"), "seed-user-admin");
    expect(res.ok).toBe(true);
    expect(res.stats, "today still runs the solver").toBeDefined();
  });
});

describe("the rotation clock only moves forward", () => {
  it("ignores a stamp older than the one already stored", async () => {
    const d = await prisma.driver.findFirstOrThrow({ select: { id: true, lastAssignedAt: true } });
    const original = d.lastAssignedAt;
    // Pin a known baseline. The seeded fleet carries demo trips dated into 2027,
    // so an arbitrary driver's clock is already ahead of anything "3 days from
    // now" — reading the guard as broken when it is simply doing its job.
    const baseline = new Date("2026-06-15T09:00:00");
    await prisma.driver.update({ where: { id: d.id }, data: { lastAssignedAt: baseline } });

    // Forward moves.
    const later = new Date("2026-06-20T09:00:00");
    await stampRotationForward(prisma, d.id, later);
    const ahead = await prisma.driver.findUniqueOrThrow({
      where: { id: d.id }, select: { lastAssignedAt: true },
    });
    expect(ahead.lastAssignedAt?.getTime()).toBe(later.getTime());

    // Backwards does not — this is the backdated case.
    await stampRotationForward(prisma, d.id, new Date("2026-05-01T09:00:00"));
    const still = await prisma.driver.findUniqueOrThrow({
      where: { id: d.id }, select: { lastAssignedAt: true },
    });
    expect(still.lastAssignedAt?.getTime(), "a past trip cannot reorder the queue").toBe(
      later.getTime(),
    );

    await prisma.driver.update({ where: { id: d.id }, data: { lastAssignedAt: original } });
  });
});

describe("the capacity gate does not judge a trip that already ran", () => {
  it("is not gated at all", async () => {
    const { booking } = await makePast("capacity");
    const verdict = await dayHasRoomFor({
      id: booking.id,
      startAt: booking.startAt,
      endAt: booking.endAt,
      estimatedDistance: null,
      needsSecondaryDriver: false,
      jobType: "NORMAL",
      isEmergency: false,
      preferredVehicleType: "VAN",
    });
    // Otherwise every backdated booking wears a red วันเต็ม and can only be
    // approved through the force-override, with a written justification.
    expect(verdict.gated).toBe(false);
    expect(verdict.fits).toBe(true);
  });
});
