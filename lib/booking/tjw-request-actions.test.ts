import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (k: string) => k),
}));
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "seed-user-admin", roles: ["ADMIN"] } })),
}));

import { prisma } from "@/lib/db";
import { assignTjwByRequestOrder } from "@/lib/booking/tjw-request-actions";

const MARKERS = ["TJWReqTest-1", "TJWReqTest-2", "TJWReqTest-3"];
let deptId = "";

async function cleanup() {
  const rows = await prisma.booking.findMany({ where: { purpose: { in: MARKERS } }, select: { id: true } });
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await prisma.auditLog.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  const req = await prisma.user.findUnique({ where: { id: "seed-user-requester" }, select: { departmentId: true } });
  const dept = req?.departmentId ?? (await prisma.department.findFirst())?.id;
  if (!dept) throw new Error("Seed a department first (npx prisma db seed)");
  deptId = dept;
  await prisma.user.update({ where: { id: "seed-user-requester" }, data: { departmentId: dept } });
  const paired = await prisma.vehicle.count({
    where: { isActive: true, assignedDriver: { is: { isActive: true, user: { is: { isActive: true } } } } },
  });
  if (paired < 2) throw new Error("Need >=2 car-paired active drivers in the seed");
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

function tjw(purpose: string, createdAt: string) {
  return prisma.booking.create({
    data: {
      requesterId: "seed-user-requester",
      departmentId: deptId,
      purpose,
      destination: "Chiang Mai",
      province: "เชียงใหม่",
      startAt: new Date("2026-07-10T08:00:00"),
      endAt: new Date("2026-07-12T18:00:00"),
      passengerCount: 1,
      jobType: "TJW",
      timeBucket: "MORNING_08_12",
      status: "APPROVED",
      outOfProvince: true,
      estimatedDistance: 120,
      createdAt: new Date(createdAt),
    },
  });
}

describe("assignTjwByRequestOrder", () => {
  it("assigns overlapping TJW in request order to distinct drivers", async () => {
    // r1 requested earlier (25 Jun); r2 later (26 Jun). Same span ⇒ distinct drivers.
    const r1 = await tjw("TJWReqTest-1", "2026-06-25T00:00:00");
    const r2 = await tjw("TJWReqTest-2", "2026-06-26T00:00:00");

    const res = await assignTjwByRequestOrder();
    expect(res.ok).toBe(true);

    const [a, b] = await Promise.all([
      prisma.booking.findUnique({ where: { id: r1.id }, select: { status: true, primaryDriverId: true } }),
      prisma.booking.findUnique({ where: { id: r2.id }, select: { status: true, primaryDriverId: true } }),
    ]);
    expect(a!.status).toBe("ASSIGNED");
    expect(b!.status).toBe("ASSIGNED");
    expect(a!.primaryDriverId).toBeTruthy();
    expect(b!.primaryDriverId).toBeTruthy();
    // Overlapping spans ⇒ they cannot share a driver.
    expect(a!.primaryDriverId).not.toBe(b!.primaryDriverId);
  });

  it("never places a TJW on a driver already busy on an overlapping NON-TJW trip", async () => {
    // The commitment loader used to filter jobType="TJW", so a driver on an
    // overlapping NORMAL/OT looked free and a TJW double-booked over it. Make every
    // paired, duty-free driver EXCEPT one busy on an overlapping NORMAL; the pending
    // TJW must land on the remaining free driver, never a busy one.
    const span = { start: new Date("2026-07-10T08:00:00"), end: new Date("2026-07-12T18:00:00") };
    // orderBy is load-bearing: without it Postgres returns rows in physical
    // order, which shifts whenever the table is updated (a re-seed is enough).
    // "the last candidate" then silently became a different driver between runs.
    const paired = await prisma.vehicle.findMany({
      where: { isActive: true, assignedDriver: { is: { isActive: true, user: { is: { isActive: true } } } } },
      orderBy: { registrationNumber: "asc" },
      select: { assignedDriverId: true },
    });
    const shifts = await prisma.onCallShift.findMany({
      where: { date: { gte: new Date("2026-07-09"), lte: new Date("2026-07-13") } },
      select: { driverId: true },
    });
    const dutyIds = new Set(shifts.map((s) => s.driverId));

    // Anyone ALREADY committed across the span is not a candidate either — this
    // file cleans up only in afterAll, so the previous test's assigned TJW is
    // still live right now, and picking its driver as "the free one" made this
    // test fail for a reason that had nothing to do with the rule it guards.
    const committed = await prisma.booking.findMany({
      where: {
        status: { in: ["APPROVED", "ASSIGNED", "COMPLETED"] },
        startAt: { lt: span.end },
        endAt: { gt: span.start },
      },
      select: { primaryDriverId: true, secondaryDriverId: true },
    });
    const busyAlready = new Set(
      committed.flatMap((b) => [b.primaryDriverId, b.secondaryDriverId]).filter((x): x is string => !!x),
    );

    const candidates = paired
      .map((v) => v.assignedDriverId!)
      .filter((id): id is string => !!id && !dutyIds.has(id) && !busyAlready.has(id));
    if (candidates.length < 2) {
      // Not enough duty-free paired drivers in the seed to run this scenario.
      expect(candidates.length).toBeGreaterThanOrEqual(0);
      return;
    }
    const freeDriver = candidates[candidates.length - 1]!;
    const busy = candidates.slice(0, -1);
    for (const d of busy) {
      await prisma.booking.create({
        data: {
          requesterId: "seed-user-requester",
          departmentId: deptId,
          purpose: "TJWReqTest-3",
          destination: "BKK",
          province: "กรุงเทพมหานคร",
          startAt: new Date("2026-07-11T08:00:00"), // inside the TJW span
          endAt: new Date("2026-07-11T12:00:00"),
          passengerCount: 1,
          jobType: "NORMAL",
          timeBucket: "MORNING_08_12",
          status: "ASSIGNED",
          outOfProvince: false,
          primaryDriverId: d,
        },
      });
    }

    const r = await tjw("TJWReqTest-3", "2026-06-25T00:00:00");
    void span;
    const res = await assignTjwByRequestOrder();
    expect(res.ok).toBe(true);

    const after = await prisma.booking.findUnique({ where: { id: r.id }, select: { primaryDriverId: true } });
    // The core regression: a busy (overlapping-NORMAL) driver is NEVER chosen.
    expect(busy).not.toContain(after!.primaryDriverId);
    // And with everyone else busy, it must land on the one free driver.
    expect(after!.primaryDriverId).toBe(freeDriver);
  });
});
