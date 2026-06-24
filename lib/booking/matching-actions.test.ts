import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, startOfDay } from "date-fns";

// The away-on-TJW rule for WERN at the MATCHER level: a WERN (campus duty) booking
// must never be auto-assigned to the on-call driver when that driver is away on a
// multi-day TJW — it falls back to a present driver (docs §1 + §6). Seeds the real
// dev DB, like schedule-actions.test.ts.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({ getTranslations: vi.fn(async () => (k: string) => k) }));
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "seed-user-admin", roles: ["ADMIN"] } })),
}));
vi.mock("@/lib/email/client", () => ({ sendEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/line/client", () => ({ sendLineNotification: vi.fn(async () => {}) }));

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { matchBookingAction, setOnCallShiftAction } from "@/lib/booking/matching-actions";

const REQ_ID = "seed-user-requester";
const DEPT = "seed-dept-medicine";
const MARKER = "MATCH-WERN-TEST";
const DAY = startOfDay(addDays(new Date(), 175));
const dayStart = DAY;

const createdIds: string[] = [];
let jnSeq = 0;
const jn = () => `VB-MWERN-${Date.now()}-${jnSeq++}`;
const at = (base: Date, h: number) => { const d = new Date(base); d.setHours(h, 0, 0, 0); return d; };
const iso = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
}

type V = { id: string; driverId: string };
let oncall: V;
let other: V;

async function mkBooking(over: Partial<Prisma.BookingUncheckedCreateInput> & { startAt: Date; endAt: Date; jobType: Prisma.BookingUncheckedCreateInput["jobType"] }) {
  const b = await prisma.booking.create({
    data: {
      jobNumber: jn(), requesterId: REQ_ID, departmentId: DEPT, purpose: MARKER,
      destination: "Test", province: "กรุงเทพมหานคร", passengerCount: 1,
      timeBucket: "MORNING_08_12", status: "APPROVED", ...over,
    },
  });
  createdIds.push(b.id);
  return b;
}

beforeAll(async () => {
  const admin = await prisma.user.findUnique({ where: { id: "seed-user-admin" } });
  if (!admin) throw new Error("Seed users missing — run `npm run db:seed`.");
  const vehicles = await prisma.vehicle.findMany({
    where: { isActive: true, assignedDriverId: { not: null } },
    orderBy: { registrationNumber: "asc" },
    select: { id: true, assignedDriverId: true },
  });
  if (vehicles.length < 2) throw new Error("Need ≥2 paired active vehicles — run the seed.");
  oncall = { id: vehicles[0].id, driverId: vehicles[0].assignedDriverId! };
  other = { id: vehicles[1].id, driverId: vehicles[1].assignedDriverId! };
});

afterAll(async () => {
  const extra = await prisma.booking.findMany({ where: { purpose: MARKER }, select: { id: true } });
  const ids = [...new Set([...createdIds, ...extra.map((r) => r.id)])];
  if (ids.length) {
    await prisma.auditLog.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.bookingClaim.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.onCallShift.deleteMany({ where: { date: dayStart } });
  await prisma.$disconnect();
});

describe("matchBookingAction — WERN never lands on an away-on-TJW on-call driver", () => {
  it("falls back to a present driver when the on-call driver is away overnight", async () => {
    // on-call driver is away on a multi-day TJW that spans the WERN day.
    await mkBooking({
      jobType: "TJW", startAt: at(DAY, 6), endAt: at(addDays(DAY, 1), 18),
      vehicleId: oncall.id, primaryDriverId: oncall.driverId, status: "ASSIGNED",
      outOfProvince: true, estimatedDistance: 700,
    });
    await prisma.onCallShift.upsert({
      where: { date: dayStart }, create: { date: dayStart, driverId: oncall.driverId }, update: { driverId: oncall.driverId },
    });

    const wern = await mkBooking({
      jobType: "WERN", startAt: at(DAY, 8), endAt: at(DAY, 12), status: "APPROVED", estimatedDistance: 15,
    });

    const res = await matchBookingAction(fd({ bookingId: wern.id }));
    expect(res.ok).toBe(true);

    const after = await prisma.booking.findUnique({ where: { id: wern.id } });
    // Must NOT be the away on-call driver — and must have fallen back to someone present.
    expect(after?.primaryDriverId).not.toBe(oncall.driverId);
    expect(after?.primaryDriverId).not.toBeNull();
  });
});

describe("setOnCallShiftAction — auto-rotate skips a driver away on a TJW", () => {
  it("never rosters an away-on-TJW driver as the day's duty", async () => {
    const day2 = startOfDay(addDays(new Date(), 176));
    // `other` is away on a multi-day TJW spanning day2.
    await mkBooking({
      jobType: "TJW", startAt: at(day2, 6), endAt: at(addDays(day2, 1), 18),
      vehicleId: other.id, primaryDriverId: other.driverId, status: "ASSIGNED",
      outOfProvince: true, estimatedDistance: 700,
    });
    // Make `other` the most-overdue for duty so it WOULD be picked without the rule:
    // give every other active driver a recent on-call shift; leave `other` without one near day2.
    const actives = await prisma.driver.findMany({ where: { isActive: true }, select: { id: true } });
    let off = 1;
    for (const d of actives) {
      if (d.id === other.driverId) continue;
      const dd = startOfDay(addDays(day2, off++));
      await prisma.onCallShift.upsert({ where: { date: dd }, create: { date: dd, driverId: d.id }, update: { driverId: d.id } });
    }

    const res = await setOnCallShiftAction(fd({ date: iso(day2) })); // empty driverId → auto-rotate
    expect(res.ok).toBe(true);

    const shift = await prisma.onCallShift.findUnique({ where: { date: day2 } });
    expect(shift?.driverId).not.toBe(other.driverId);

    // cleanup the recent-shift rows + day2 shift
    await prisma.onCallShift.deleteMany({ where: { date: { gte: day2, lte: startOfDay(addDays(day2, off)) } } });
  });
});
