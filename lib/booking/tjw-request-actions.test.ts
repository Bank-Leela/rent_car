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

const MARKERS = ["TJWReqTest-1", "TJWReqTest-2"];
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

function tjw(purpose: string, createdAt: string, jobNumber: string) {
  return prisma.booking.create({
    data: {
      jobNumber,
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
    const r1 = await tjw("TJWReqTest-1", "2026-06-25T00:00:00", "VB-TJWREQ-1");
    const r2 = await tjw("TJWReqTest-2", "2026-06-26T00:00:00", "VB-TJWREQ-2");

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
});
