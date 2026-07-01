import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, startOfDay } from "date-fns";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: vi.fn(async () => ({ user: { id: "seed-user-admin", roles: ["ADMIN"] } })) }));

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const MARKER = "OCCUPANCY-TEST";
const DAY = startOfDay(addDays(new Date(), 200)); // quiet far-future day
const at = (h: number, m = 0) => { const d = new Date(DAY); d.setHours(h, m, 0, 0); return d; };
const createdIds: string[] = [];
let seq = 0;
const jn = () => `VB-OCC-${Date.now()}-${seq++}`;
let carA: string;

async function mk(over: Partial<Prisma.BookingUncheckedCreateInput> & { startAt: Date; endAt: Date }) {
  const b = await prisma.booking.create({
    data: {
      jobNumber: jn(), requesterId: "seed-user-requester", departmentId: "seed-dept-medicine",
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
