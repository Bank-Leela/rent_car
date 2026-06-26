import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { loadWeightedEarnings } from "@/lib/booking/earnings";

// Regression for the day-17 "TJW keeps falling to the same person" bug: a trip
// claimed via the board matcher is left at status APPROVED (driverScheduleStatus
// CLAIMED). loadWeightedEarnings used to filter ASSIGNED|COMPLETED only, so the
// claimed driver looked idle and the fairness pick kept landing on them. The
// ledger must count APPROVED-with-driver trips.
const MARKER = "EarningsClaimedTest:";

let driverId: string;
let requesterId: string;
let departmentId: string;

beforeAll(async () => {
  const d = await prisma.driver.findFirst({ where: { isActive: true }, select: { id: true } });
  const r = await prisma.user.findFirst({
    where: { roles: { some: { role: "REQUESTER" } }, departmentId: { not: null } },
    select: { id: true, departmentId: true },
  });
  if (!d || !r?.departmentId) throw new Error("Seed the dev DB first (npx prisma db seed).");
  driverId = d.id;
  requesterId = r.id;
  departmentId = r.departmentId;
  await prisma.booking.deleteMany({ where: { purpose: { startsWith: MARKER } } });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { booking: { purpose: { startsWith: MARKER } } } });
  await prisma.booking.deleteMany({ where: { purpose: { startsWith: MARKER } } });
});

describe("loadWeightedEarnings — claimed trips count toward fairness", () => {
  it("includes a board-claimed (APPROVED + driver) TJW in the driver's score", async () => {
    const before = (await loadWeightedEarnings([driverId])).get(driverId) ?? 0;

    const startAt = new Date();
    startAt.setHours(6, 0, 0, 0);
    const endAt = new Date(startAt);
    endAt.setDate(endAt.getDate() + 1);
    endAt.setHours(18, 0, 0, 0);

    await prisma.booking.create({
      data: {
        jobNumber: `${MARKER}${startAt.getTime()}`,
        requesterId,
        departmentId,
        purpose: `${MARKER} claimed tjw`,
        destination: "Chiang Mai",
        province: "เชียงใหม่",
        startAt,
        endAt,
        passengerCount: 1,
        pickupLocation: "x",
        ajarnName: "x",
        ajarnPhone: "0",
        ajarnEmail: "x@example.com",
        // The matcher leaves a claimed trip here: APPROVED, not ASSIGNED.
        status: "APPROVED",
        driverScheduleStatus: "CLAIMED",
        jobType: "TJW",
        timeBucket: "BEFORE_08",
        outOfProvince: true,
        estimatedDistance: 700,
        primaryDriverId: driverId,
      },
    });

    const after = (await loadWeightedEarnings([driverId])).get(driverId) ?? 0;
    // Pre-fix this was `before` (APPROVED excluded) → driver looked idle.
    expect(after).toBeGreaterThan(before);
  });
});
