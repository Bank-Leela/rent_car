import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, startOfDay } from "date-fns";

// Run the action outside a request, as the DRIVER who owns the trip. Seeds the
// real dev DB (actions.test.ts pattern).
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({ getTranslations: vi.fn(async () => (k: string) => k) }));
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "seed-user-driver", roles: ["DRIVER"] } })),
}));
vi.mock("@/lib/email/client", () => ({ sendEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/line/client", () => ({ sendLineNotification: vi.fn(async () => {}) }));

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { declineAssignmentAction } from "@/lib/booking/driver-actions";

const REQ_ID = "seed-user-requester";
const DEPT = "seed-dept-medicine";
const MARKER = "DECLINE-TEST";
const DAY = startOfDay(addDays(new Date(), 92));

const createdIds: string[] = [];
let seq = 0;
const jn = () => `VB-DECLINE-${Date.now()}-${seq++}`;
const at = (h: number) => {
  const d = new Date(DAY);
  d.setHours(h, 0, 0, 0);
  return d;
};
function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
}

let myDriverId: string; // seed-user-driver's driver profile
let otherDriverId: string;
let vehicleId: string;

async function mkBooking(over: Partial<Prisma.BookingUncheckedCreateInput> & { startAt: Date; endAt: Date }) {
  const b = await prisma.booking.create({
    data: {
      jobNumber: jn(), requesterId: REQ_ID, departmentId: DEPT, purpose: MARKER,
      destination: "Test", province: "กรุงเทพมหานคร", passengerCount: 1,
      jobType: "NORMAL", timeBucket: "MORNING_08_12", status: "APPROVED",
      ...over,
    },
  });
  createdIds.push(b.id);
  return b;
}

beforeAll(async () => {
  const me = await prisma.user.findUnique({ where: { id: "seed-user-driver" }, include: { driverProfile: true } });
  if (!me?.driverProfile) throw new Error("seed-user-driver has no driver profile — run the seed.");
  myDriverId = me.driverProfile.id;
  const other = await prisma.driver.findFirst({ where: { id: { not: myDriverId }, isActive: true }, select: { id: true } });
  if (!other) throw new Error("Need a second driver — run the seed.");
  otherDriverId = other.id;
  const v = await prisma.vehicle.findFirst({ where: { isActive: true }, select: { id: true } });
  vehicleId = v!.id;
});

afterAll(async () => {
  const extra = await prisma.booking.findMany({ where: { purpose: MARKER }, select: { id: true } });
  const ids = [...new Set([...createdIds, ...extra.map((r) => r.id)])];
  if (ids.length) {
    await prisma.auditLog.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.bookingClaim.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

describe("declineAssignmentAction", () => {
  it("sends an owned ASSIGNED trip back to APPROVED, clears the driver, and audits it", async () => {
    const b = await mkBooking({
      status: "ASSIGNED", vehicleId, primaryDriverId: myDriverId,
      driverScheduleStatus: "CONFIRMED", startAt: at(9), endAt: at(11),
    });
    const res = await declineAssignmentAction(fd({ bookingId: b.id, reason: "On leave that day" }));
    expect(res).toMatchObject({ ok: true });

    const after = await prisma.booking.findUnique({ where: { id: b.id }, include: { auditLogs: true } });
    expect(after?.status).toBe("APPROVED");
    expect(after?.primaryDriverId).toBeNull();
    expect(after?.vehicleId).toBeNull();
    expect(after?.driverScheduleStatus).toBe("UNCLAIMED");
    expect(after?.auditLogs.some((l) => l.action === "DRIVER_DECLINED")).toBe(true);
  });

  it("rejects declining a trip assigned to a different driver", async () => {
    const b = await mkBooking({
      status: "ASSIGNED", vehicleId, primaryDriverId: otherDriverId, startAt: at(13), endAt: at(15),
    });
    const res = await declineAssignmentAction(fd({ bookingId: b.id, reason: "not mine" }));
    expect(res).toMatchObject({ ok: false });
    const after = await prisma.booking.findUnique({ where: { id: b.id } });
    expect(after?.status).toBe("ASSIGNED"); // untouched
  });

  it("rejects declining a trip that is not ASSIGNED", async () => {
    const b = await mkBooking({ status: "APPROVED", primaryDriverId: myDriverId, startAt: at(16), endAt: at(18) });
    const res = await declineAssignmentAction(fd({ bookingId: b.id, reason: "too early" }));
    expect(res).toMatchObject({ ok: false });
  });

  it("rejects a too-short reason", async () => {
    const b = await mkBooking({
      status: "ASSIGNED", vehicleId, primaryDriverId: myDriverId, startAt: at(19), endAt: at(20),
    });
    const res = await declineAssignmentAction(fd({ bookingId: b.id, reason: "x" }));
    expect(res).toMatchObject({ ok: false });
  });
});
