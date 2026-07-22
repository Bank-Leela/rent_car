import { afterAll, describe, expect, it, vi } from "vitest";
import { startOfDay } from "date-fns";
import { prisma } from "@/lib/db";

// For the release-integration test below: run setDriverUnavailableAction outside a
// request (mock Next cache + admin session + side-effect clients). Harmless to the
// raw-prisma tests above, which don't touch these modules.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({
  requireRole: vi.fn(async () => ({ user: { id: "seed-user-admin", roles: ["ADMIN"] } })),
}));
vi.mock("@/lib/email/client", () => ({ sendEmail: vi.fn(async () => {}) }));
import { setDriverUnavailableAction } from "@/lib/booking/availability-actions";

// Proves the sick-day exclusion filter works against the real dev DB: a driver
// with a DriverUnavailability row for a day is excluded by the same
// `unavailabilities: { none: { date } }` predicate the pool loaders use, and the
// @db.Date column makes the local-midnight (action) vs startOfDay (loader) match
// line up. Uses a throwaway user+driver, cleaned up after.
const stamp = Date.now();
const ids: { userId?: string; driverId?: string } = {};

afterAll(async () => {
  if (ids.driverId) await prisma.driverUnavailability.deleteMany({ where: { driverId: ids.driverId } });
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } });
  await prisma.$disconnect();
});

// The day off, parsed the way the action does (local midnight) and the way the
// loaders query (startOfDay) — must resolve to the same calendar day.
const dateStr = "2026-09-15";
const actionDate = new Date(`${dateStr}T00:00:00`); // setDriverUnavailableAction
const loaderDate = startOfDay(new Date(`${dateStr}T00:00:00`)); // pool loaders
const otherDay = startOfDay(new Date("2026-09-16T00:00:00"));

describe("driver unavailability exclusion", () => {
  it("excludes a driver marked off for the day, keeps them on other days", async () => {
    const user = await prisma.user.create({
      data: { email: `unavail-${stamp}@test.local`, username: `unavail-${stamp}`, name: "Unavail Test", isActive: true },
      select: { id: true },
    });
    ids.userId = user.id;
    const driver = await prisma.driver.create({
      data: { userId: user.id, pool: "PUBLIC", isActive: true },
      select: { id: true },
    });
    ids.driverId = driver.id;
    await prisma.driverUnavailability.create({ data: { driverId: driver.id, date: actionDate } });

    // Same predicate the loaders use. On the off day → excluded (none-match fails).
    const offDay = await prisma.driver.findMany({
      where: { id: driver.id, unavailabilities: { none: { date: loaderDate } } },
      select: { id: true },
    });
    expect(offDay).toHaveLength(0);

    // A different day → still in the pool.
    const otherDayPool = await prisma.driver.findMany({
      where: { id: driver.id, unavailabilities: { none: { date: otherDay } } },
      select: { id: true },
    });
    expect(otherDayPool.map((d) => d.id)).toEqual([driver.id]);
  });

  it("rotation timestamps are untouched while off (self-heal: no penalty)", async () => {
    // The exclusion is a filter only — it never writes lastTjwAt/lastOtAt/lastDutyAt,
    // so a missed day leaves the driver's rotation stamps old → picked first on return.
    const d = await prisma.driver.findUniqueOrThrow({
      where: { id: ids.driverId! },
      select: { lastTjwAt: true, lastOtAt: true, lastDutyAt: true },
    });
    expect(d.lastTjwAt).toBeNull();
    expect(d.lastOtAt).toBeNull();
    expect(d.lastDutyAt).toBeNull();
  });
});

// Marking a driver off must release a CLAIMED-but-not-yet-ASSIGNED trip (status
// APPROVED, driverScheduleStatus CLAIMED) — not only ASSIGNED ones — else the trip
// stays stuck on a driver who is now off.
describe("setDriverUnavailableAction releases claimed (APPROVED) trips, not only ASSIGNED", () => {
  const relStamp = Date.now();
  const rel: { userId?: string; driverId?: string; bookingId?: string } = {};
  const relDay = "2026-09-20";

  afterAll(async () => {
    if (rel.bookingId) {
      await prisma.auditLog.deleteMany({ where: { bookingId: rel.bookingId } });
      await prisma.booking.deleteMany({ where: { id: rel.bookingId } });
    }
    if (rel.driverId) await prisma.driverUnavailability.deleteMany({ where: { driverId: rel.driverId } });
    if (rel.userId) await prisma.driver.deleteMany({ where: { userId: rel.userId } });
    if (rel.userId) await prisma.user.deleteMany({ where: { id: rel.userId } });
  });

  it("frees a claimed APPROVED trip and logs the transition from APPROVED", async () => {
    const admin = await prisma.user.findUnique({ where: { id: "seed-user-admin" } });
    const requester = await prisma.user.findUnique({ where: { id: "seed-user-requester" } });
    if (!admin || !requester) throw new Error("Seed users missing — run `npm run db:seed` first.");

    const user = await prisma.user.create({
      data: { email: `rel-${relStamp}@test.local`, username: `rel-${relStamp}`, name: "Release Test", isActive: true },
      select: { id: true },
    });
    rel.userId = user.id;
    const driver = await prisma.driver.create({ data: { userId: user.id, pool: "PUBLIC", isActive: true }, select: { id: true } });
    rel.driverId = driver.id;

    // A CLAIMED-but-not-confirmed trip: status APPROVED, primaryDriverId set.
    const booking = await prisma.booking.create({
      data: {
        jobNumber: `REL-${relStamp}`,
        requesterId: "seed-user-requester",
        departmentId: "seed-dept-medicine",
        purpose: "release-test",
        destination: "Test",
        province: "กรุงเทพมหานคร",
        passengerCount: 1,
        jobType: "NORMAL",
        timeBucket: "MORNING_08_12",
        status: "APPROVED",
        driverScheduleStatus: "CLAIMED",
        primaryDriverId: driver.id,
        startAt: new Date(`${relDay}T10:00:00`),
        endAt: new Date(`${relDay}T12:00:00`),
      },
      select: { id: true },
    });
    rel.bookingId = booking.id;

    const fd = new FormData();
    fd.append("driverId", driver.id);
    fd.append("date", relDay);
    fd.append("off", "true");
    const res = await setDriverUnavailableAction(fd);
    expect(res.ok).toBe(true);

    const after = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(after?.primaryDriverId).toBeNull();
    expect(after?.status).toBe("APPROVED");
    expect(after?.driverScheduleStatus).toBe("UNCLAIMED");

    const audit = await prisma.auditLog.findFirst({
      where: { bookingId: booking.id, action: "DRIVER_OFF_RELEASE" },
      select: { fromStatus: true },
    });
    expect(audit?.fromStatus).toBe("APPROVED");
  });
});
