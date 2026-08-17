import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, startOfDay } from "date-fns";

// Run the server actions outside a request: mock Next runtime + i18n + session
// (as ADMIN) + side-effect clients. Seeds against the real dev DB (like
// actions.test.ts), so this exercises the actual overlap SELECT + persistence —
// the no-double-book rule the whole subsystem exists to enforce.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (k: string) => k),
}));
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "seed-user-admin", roles: ["ADMIN"] } })),
}));
vi.mock("@/lib/email/client", () => ({ sendEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/line/client", () => ({ sendLineNotification: vi.fn(async () => {}) }));

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  reassignVehicleAction,
  reassignSecondaryAction,
  unassignBookingAction,
  setBookingTimeAction,
} from "@/lib/booking/schedule-actions";

const REQ_ID = "seed-user-requester";
const DEPT = "seed-dept-medicine";
const MARKER = "RESCH-TEST"; // purpose of every fixture here — afterAll sweeps on it
// A quiet far-future day (beyond the seed's ~21-day duty roster + demo data) so
// nothing else collides on the cars we test.
const DAY = startOfDay(addDays(new Date(), 90));

const createdIds: string[] = [];
const at = (h: number, m = 0) => {
  const d = new Date(DAY);
  d.setHours(h, m, 0, 0);
  return d;
};
function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
}

type V = { id: string; driverId: string };
let vA: V;
let vB: V;

async function mkBooking(
  over: Partial<Prisma.BookingUncheckedCreateInput> & { startAt: Date; endAt: Date },
) {
  const b = await prisma.booking.create({
    data: {
      requesterId: REQ_ID,
      departmentId: DEPT,
      purpose: MARKER,
      destination: "Test",
      province: "กรุงเทพมหานคร",
      passengerCount: 1,
      jobType: "NORMAL",
      timeBucket: "MORNING_08_12",
      status: "APPROVED",
      ...over,
    },
  });
  createdIds.push(b.id);
  return b;
}

beforeAll(async () => {
  const admin = await prisma.user.findUnique({ where: { id: "seed-user-admin" } });
  const req = await prisma.user.findUnique({ where: { id: REQ_ID } });
  if (!admin || !req) throw new Error("Seed users missing — run `npm run db:seed` first.");

  const vehicles = await prisma.vehicle.findMany({
    where: { isActive: true, assignedDriverId: { not: null } },
    orderBy: { registrationNumber: "asc" },
    select: { id: true, assignedDriverId: true },
  });
  if (vehicles.length < 2) throw new Error("Need ≥2 paired active vehicles — run the seed.");
  vA = { id: vehicles[0].id, driverId: vehicles[0].assignedDriverId! };
  vB = { id: vehicles[1].id, driverId: vehicles[1].assignedDriverId! };
});

afterAll(async () => {
  // Sweep by id + the marker purpose (catches rows from a failed assertion).
  const extra = await prisma.booking.findMany({ where: { purpose: MARKER }, select: { id: true } });
  const ids = [...new Set([...createdIds, ...extra.map((r) => r.id)])];
  if (ids.length) {
    await prisma.auditLog.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.bookingClaim.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

describe("reassignVehicleAction — the no-overlap rule", () => {
  it("BLOCKS an overlapping drop on the same car and names the conflict", async () => {
    const kept = await mkBooking({
      startAt: at(9), endAt: at(11), vehicleId: vA.id, primaryDriverId: vA.driverId, status: "ASSIGNED",
    });
    const mover = await mkBooking({ startAt: at(10), endAt: at(12) }); // overlaps kept

    const res = await reassignVehicleAction(fd({ bookingId: mover.id, vehicleId: vA.id }));

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("vehicleBusy");
      // Every fixture here shares one purpose and one destination, so the
      // departure time is what tells the named conflict apart from the others.
      expect(res.conflicts?.map((c) => c.startAt.getTime())).toContain(kept.startAt.getTime());
    }
    // mover is untouched — still unassigned.
    const after = await prisma.booking.findUnique({ where: { id: mover.id } });
    expect(after?.vehicleId).toBeNull();
    expect(after?.status).toBe("APPROVED");
  });

  it("ASSIGNS to a free car (status ASSIGNED + that car's driver)", async () => {
    const mover = await mkBooking({ startAt: at(13), endAt: at(15) });
    const res = await reassignVehicleAction(fd({ bookingId: mover.id, vehicleId: vB.id }));

    expect(res.ok).toBe(true);
    const after = await prisma.booking.findUnique({ where: { id: mover.id } });
    expect(after?.vehicleId).toBe(vB.id);
    expect(after?.primaryDriverId).toBe(vB.driverId);
    expect(after?.status).toBe("ASSIGNED");
  });
});

// A separate quiet day so these seeds never collide with the cases above.
const DAY2 = startOfDay(addDays(new Date(), 120));
const at2 = (h: number, m = 0) => {
  const d = new Date(DAY2);
  d.setHours(h, m, 0, 0);
  return d;
};

describe("reassignVehicleAction — driver double-book guard (co-driver on another car)", () => {
  it("BLOCKS a drop when the target car's driver is already a co-driver on another car at that time", async () => {
    // vA.driver co-drives a long trip L that RIDES IN car vB (20:00–22:00), so
    // vA's own car is free and neither the per-vehicle check nor the DB EXCLUDE
    // can see the clash — only the driver-elsewhere guard can.
    const L = await mkBooking({
      startAt: at2(20), endAt: at2(22),
      vehicleId: vB.id, primaryDriverId: vB.driverId, secondaryDriverId: vA.driverId,
      status: "ASSIGNED", estimatedDistance: 500,
    });
    const mover = await mkBooking({ startAt: at2(20, 30), endAt: at2(21, 30) }); // overlaps L
    const res = await reassignVehicleAction(fd({ bookingId: mover.id, vehicleId: vA.id }));

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("vehicleBusy");
      expect(res.conflicts?.map((c) => c.startAt.getTime())).toContain(L.startAt.getTime());
    }
    const after = await prisma.booking.findUnique({ where: { id: mover.id } });
    expect(after?.vehicleId).toBeNull();
    expect(after?.status).toBe("APPROVED");
  });
});

describe("reassignVehicleAction — COMPLETED overlap is a NAMED conflict", () => {
  it("names the conflicting COMPLETED trip instead of a bare unnamed vehicleBusy", async () => {
    const done = await mkBooking({
      startAt: at2(9), endAt: at2(11),
      vehicleId: vA.id, primaryDriverId: vA.driverId, status: "COMPLETED",
    });
    const mover = await mkBooking({ startAt: at2(10), endAt: at2(12) }); // overlaps the COMPLETED trip

    const res = await reassignVehicleAction(fd({ bookingId: mover.id, vehicleId: vA.id }));

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("vehicleBusy");
      expect(res.conflicts?.map((c) => c.startAt.getTime())).toContain(done.startAt.getTime());
    }
  });
});

describe("reassignSecondaryAction — per-leg overlap (no-wait freed middle)", () => {
  it("ALLOWS a co-driver whose only same-time trip is a no-wait split with a freed middle", async () => {
    // vB.driver runs a no-wait split on car vB: out 06:00, drop-off 07:00,
    // return-pickup 15:00, back 16:00 → legs [06–07] + [15–16], middle 07–15 free.
    await mkBooking({
      startAt: at2(6), endAt: at2(16),
      vehicleId: vB.id, primaryDriverId: vB.driverId, status: "ASSIGNED",
      waitAtDestination: false, dropOffDone: at2(7), pickupReturnTime: "15:00",
    });
    // A long trip Z (12:00–13:00) sits in vB.driver's freed middle; making vB.driver
    // its co-driver is legal per-leg and must NOT be blocked as whole-trip overlap.
    const z = await mkBooking({
      startAt: at2(12), endAt: at2(13),
      vehicleId: vA.id, primaryDriverId: vA.driverId, status: "ASSIGNED", estimatedDistance: 500,
    });

    const res = await reassignSecondaryAction(fd({ bookingId: z.id, vehicleId: vB.id }));

    expect(res.ok).toBe(true);
    const after = await prisma.booking.findUnique({ where: { id: z.id } });
    expect(after?.secondaryDriverId).toBe(vB.driverId);
  });
});

describe("unassignBookingAction", () => {
  it("clears car + driver and returns the trip to APPROVED / UNCLAIMED", async () => {
    const b = await mkBooking({
      startAt: at(16), endAt: at(18), vehicleId: vA.id, primaryDriverId: vA.driverId, status: "ASSIGNED",
    });
    const res = await unassignBookingAction(fd({ bookingId: b.id }));

    expect(res.ok).toBe(true);
    const after = await prisma.booking.findUnique({ where: { id: b.id } });
    expect(after?.vehicleId).toBeNull();
    expect(after?.primaryDriverId).toBeNull();
    expect(after?.status).toBe("APPROVED");
    expect(after?.driverScheduleStatus).toBe("UNCLAIMED");
  });
});

// A third quiet day, so the time-edit fixtures can't collide with the reassign
// ones above (which park trips on the same two cars).
const DAY3 = startOfDay(addDays(new Date(), 150));
const at3 = (h: number, m = 0) => {
  const d = new Date(DAY3);
  d.setHours(h, m, 0, 0);
  return d;
};

describe("setBookingTimeAction — hours move, the date never does", () => {
  it("re-times a NORMAL trip (not just เวร) and keeps its calendar day", async () => {
    const b = await mkBooking({
      startAt: at3(9), endAt: at3(11),
      vehicleId: vA.id, primaryDriverId: vA.driverId, status: "ASSIGNED",
    });

    const res = await setBookingTimeAction(
      fd({ bookingId: b.id, startHHmm: "13:00", endHHmm: "15:30" }),
    );

    expect(res.ok).toBe(true);
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.startAt.getTime()).toBe(at3(13).getTime());
    expect(after.endAt.getTime()).toBe(at3(15, 30).getTime());
  });

  it("keeps an overnight trip overnight — each end keeps ITS own day", async () => {
    const start = at3(6);
    const end = new Date(at3(18));
    end.setDate(end.getDate() + 2); // 2-night TJW
    const b = await mkBooking({
      startAt: start, endAt: end, jobType: "TJW",
      vehicleId: vB.id, primaryDriverId: vB.driverId, status: "ASSIGNED",
    });

    const res = await setBookingTimeAction(
      fd({ bookingId: b.id, startHHmm: "07:30", endHHmm: "20:00" }),
    );

    expect(res.ok).toBe(true);
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.startAt.getDate()).toBe(start.getDate());
    expect(after.endAt.getDate()).toBe(end.getDate());
    expect(after.startAt.getHours()).toBe(7);
    expect(after.endAt.getHours()).toBe(20);
  });

  it("REFUSES a move that collides with another trip on the same car", async () => {
    const kept = await mkBooking({
      startAt: at3(8), endAt: at3(10),
      vehicleId: vA.id, primaryDriverId: vA.driverId, status: "ASSIGNED",
    });
    const mover = await mkBooking({
      startAt: at3(16), endAt: at3(17),
      vehicleId: vA.id, primaryDriverId: vA.driverId, status: "ASSIGNED",
    });

    const res = await setBookingTimeAction(
      fd({ bookingId: mover.id, startHHmm: "09:00", endHHmm: "09:30" }),
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("vehicleBusy");
      expect(res.conflicts?.map((c) => c.startAt.getTime())).toContain(kept.startAt.getTime());
    }
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: mover.id } });
    expect(after.startAt.getTime()).toBe(at3(16).getTime()); // untouched
  });

  it("rejects a backwards window and a malformed clock", async () => {
    // No car: the input guards run before any occupancy query, and an unassigned
    // trip can't collide with the overnight fixture parked on vB above.
    const b = await mkBooking({ startAt: at3(20), endAt: at3(21) });

    const backwards = await setBookingTimeAction(
      fd({ bookingId: b.id, startHHmm: "14:00", endHHmm: "13:00" }),
    );
    expect(backwards.ok).toBe(false);
    if (!backwards.ok) expect(backwards.error).toBe("endBeforeStart");

    const junk = await setBookingTimeAction(
      fd({ bookingId: b.id, startHHmm: "25:99", endHHmm: "13:00" }),
    );
    expect(junk.ok).toBe(false);
    if (!junk.ok) expect(junk.error).toBe("invalidInput");
  });
});
