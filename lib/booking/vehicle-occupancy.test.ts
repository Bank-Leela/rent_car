import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, startOfDay } from "date-fns";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: vi.fn(async () => ({ user: { id: "seed-user-admin", roles: ["ADMIN"] } })) }));

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { tripLegs } from "@/lib/booking/trip-legs";

const MARKER = "OCCUPANCY-TEST"; // purpose of every fixture here — afterAll sweeps on it
const DAY = startOfDay(addDays(new Date(), 200)); // quiet far-future day
const DAY2 = addDays(DAY, 1); // one distinct day per describe so they don't collide on carA
const DAY3 = addDays(DAY, 2);
const DAY4 = addDays(DAY, 3);
const at = (h: number, m = 0, base: Date = DAY) => { const d = new Date(base); d.setHours(h, m, 0, 0); return d; };
const createdIds: string[] = [];
let carA: string;

async function mk(over: Partial<Prisma.BookingUncheckedCreateInput> & { startAt: Date; endAt: Date }) {
  const b = await prisma.booking.create({
    data: {
      requesterId: "seed-user-requester", departmentId: "seed-dept-medicine",
      purpose: MARKER, destination: "T", province: "กรุงเทพมหานคร", passengerCount: 1,
      jobType: "NORMAL", timeBucket: "MORNING_08_12", status: "ASSIGNED", ...over,
    },
  });
  createdIds.push(b.id);
  return b;
}

beforeAll(async () => {
  const v = await prisma.vehicle.findFirst({ where: { isActive: true, assignedDriverId: { not: null } }, select: { id: true } });
  if (!v) throw new Error("Need an active paired vehicle — run the seed.");
  carA = v.id;
});
afterAll(async () => {
  const extra = await prisma.booking.findMany({ where: { purpose: MARKER }, select: { id: true } });
  const ids = [...new Set([...createdIds, ...extra.map((r) => r.id)])];
  if (ids.length) {
    await prisma.vehicleOccupancy.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

describe("no-double-book EXCLUDE", () => {
  it("blocks a second overlapping waiting trip on the same car", async () => {
    await mk({ startAt: at(9), endAt: at(11), vehicleId: carA });
    await expect(
      mk({ startAt: at(10), endAt: at(12), vehicleId: carA }),
    ).rejects.toThrow(); // Postgres 23P01 exclusion_violation
  });
});

describe("no-wait legs", () => {
  it("allows a trip in the freed middle, blocks one overlapping a leg", async () => {
    // No-wait: depart 09:00, drop-off done 10:00, return-pickup 14:00, back 15:00 → free 10–14.
    await mk({ startAt: at(9, 0, DAY2), endAt: at(15, 0, DAY2), vehicleId: carA, waitAtDestination: false, dropOffDone: at(10, 0, DAY2), pickupReturnTime: "14:00" });
    // Sits fully in the freed middle 11:00–13:00 → allowed.
    await expect(mk({ startAt: at(11, 0, DAY2), endAt: at(13, 0, DAY2), vehicleId: carA })).resolves.toBeTruthy();
    // Overlaps leg 1 (09:00–10:00) → blocked.
    await expect(mk({ startAt: at(9, 30, DAY2), endAt: at(10, 30, DAY2), vehicleId: carA })).rejects.toThrow();
  });
});

describe("trigger keeps occupancy in sync", () => {
  it("adds rows on assign, removes them on cancel", async () => {
    const b = await mk({ startAt: at(16, 0, DAY3), endAt: at(17, 0, DAY3), vehicleId: carA });
    expect(await prisma.vehicleOccupancy.count({ where: { bookingId: b.id } })).toBe(1);
    await prisma.booking.update({ where: { id: b.id }, data: { status: "CANCELLED", vehicleId: null } });
    expect(await prisma.vehicleOccupancy.count({ where: { bookingId: b.id } })).toBe(0);
  });
});

describe("SQL legs match trip-legs.ts", () => {
  it("stores exactly the intervals tripLegs() computes for a no-wait trip", async () => {
    const b = await mk({ startAt: at(6, 0, DAY4), endAt: at(8, 0, DAY4), vehicleId: carA, waitAtDestination: false, dropOffDone: at(6, 30, DAY4), pickupReturnTime: "07:30" });
    const rows = await prisma.vehicleOccupancy.findMany({ where: { bookingId: b.id }, orderBy: { startAt: "asc" } });
    const legs = tripLegs({ startAt: b.startAt, endAt: b.endAt, waitAtDestination: b.waitAtDestination, dropOffDone: b.dropOffDone, pickupReturnTime: b.pickupReturnTime });
    expect(rows.length).toBe(legs.length);
    rows.forEach((r, i) => {
      expect(r.startAt.getTime()).toBe(legs[i]!.startAt.getTime());
      expect(r.endAt.getTime()).toBe(legs[i]!.endAt.getTime());
    });
  });
});
