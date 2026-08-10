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

    // The trip must leave the driver going off, either way. The agreed rule is
    // that it goes to the day's เวร driver; only when nobody can take it does it
    // fall back to APPROVED/unassigned for the overflow bar. What must NEVER
    // happen is it staying on the absent driver.
    const after = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(after?.primaryDriverId, "must not stay with the absent driver").not.toBe(driver.id);

    const handedOff = after?.primaryDriverId != null;
    if (handedOff) {
      expect(after?.status).toBe("ASSIGNED");
      expect(after?.vehicleId, "handed-off trip rides the เวร driver's car").not.toBeNull();
    } else {
      expect(after?.status).toBe("APPROVED");
      expect(after?.driverScheduleStatus).toBe("UNCLAIMED");
    }

    const audit = await prisma.auditLog.findFirst({
      where: {
        bookingId: booking.id,
        action: { in: ["DRIVER_OFF_RELEASE", "DRIVER_OFF_HANDOFF_WERN"] },
      },
      select: { fromStatus: true, action: true },
    });
    expect(audit?.fromStatus).toBe("APPROVED");
    expect(audit?.action).toBe(handedOff ? "DRIVER_OFF_HANDOFF_WERN" : "DRIVER_OFF_RELEASE");
  });
});

// The hand-off used to write `primaryDriverId = เวร, secondaryDriverId = null`
// whatever seat the absent driver held. Marking the CO-DRIVER of a >400 km trip
// sick therefore threw the PRIMARY off their own trip and handed it to the เวร
// driver alone — silently dropping the second driver the >400 km rule requires.
describe("a sick CO-DRIVER does not cost the trip its primary driver", () => {
  const s = Date.now();
  const ref: { primaryUserId?: string; coUserId?: string; bookingId?: string; coDriverId?: string } = {};
  const day = "2026-09-24";

  afterAll(async () => {
    if (ref.bookingId) {
      await prisma.auditLog.deleteMany({ where: { bookingId: ref.bookingId } });
      await prisma.booking.deleteMany({ where: { id: ref.bookingId } });
    }
    if (ref.coDriverId) {
      await prisma.driverUnavailability.deleteMany({ where: { driverId: ref.coDriverId } });
      await prisma.auditLog.deleteMany({ where: { entityType: "DRIVER", entityId: ref.coDriverId } });
    }
    for (const uid of [ref.primaryUserId, ref.coUserId].filter(Boolean) as string[]) {
      await prisma.driver.deleteMany({ where: { userId: uid } });
      await prisma.user.deleteMany({ where: { id: uid } });
    }
  });

  it("keeps the primary, and flags the trip when the seat cannot be refilled", async () => {
    const mk = async (tag: string) => {
      const u = await prisma.user.create({
        data: { email: `${tag}-${s}@test.local`, username: `${tag}-${s}`, name: tag, isActive: true },
        select: { id: true },
      });
      const d = await prisma.driver.create({
        data: { userId: u.id, pool: "PUBLIC", isActive: true },
        select: { id: true },
      });
      return { userId: u.id, driverId: d.id };
    };
    const primary = await mk("codrv-primary");
    const co = await mk("codrv-second");
    ref.primaryUserId = primary.userId;
    ref.coUserId = co.userId;
    ref.coDriverId = co.driverId;

    // >400 km ⇒ the co-driver is required, not decorative.
    const booking = await prisma.booking.create({
      data: {
        requesterId: "seed-user-requester",
        departmentId: "seed-dept-medicine",
        purpose: "co-driver-test",
        destination: "Test",
        province: "เชียงใหม่",
        passengerCount: 1,
        jobType: "NORMAL",
        timeBucket: "MORNING_08_12",
        status: "APPROVED",
        driverScheduleStatus: "CLAIMED",
        estimatedDistance: 700,
        primaryDriverId: primary.driverId,
        secondaryDriverId: co.driverId,
        startAt: new Date(`${day}T09:00:00`),
        endAt: new Date(`${day}T17:00:00`),
      },
      select: { id: true },
    });
    ref.bookingId = booking.id;

    const fd = new FormData();
    fd.append("driverId", co.driverId);
    fd.append("date", day);
    fd.append("off", "true");
    expect((await setDriverUnavailableAction(fd)).ok).toBe(true);

    const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.primaryDriverId, "the primary keeps their own trip").toBe(primary.driverId);
    expect(after.secondaryDriverId, "the absent co-driver is out of the seat").not.toBe(co.driverId);
    expect(after.status, "the trip is not released — it still has a driver").toBe("APPROVED");

    // Either the เวร driver took the seat, or nobody could and the trip is
    // flagged. What must never happen is it looking healthy while short a driver.
    if (after.secondaryDriverId === null) {
      expect(after.overflowReason).toBe("NO_SECONDARY_DRIVER");
    }

    const audit = await prisma.auditLog.findFirst({
      where: {
        bookingId: booking.id,
        action: { in: ["DRIVER_OFF_CODRIVER_REPLACED", "DRIVER_OFF_CODRIVER_LOST"] },
      },
      select: { action: true },
    });
    expect(audit, "the seat change is recorded").not.toBeNull();
  });
});

// A trip that began on an earlier day is out of province with its car; handing
// its remaining legs to the on-campus เวร driver is nonsense. The old scope
// (`startAt` within the leave day) could not even see such a trip, so a driver
// marked off mid-ตจว kept it and nothing said so.
describe("a multi-day trip spanning the leave day is flagged, never re-dispatched", () => {
  const s = Date.now();
  const ref: { userId?: string; driverId?: string; bookingId?: string } = {};
  const leaveDay = "2026-09-27"; // the trip runs 26th → 28th

  afterAll(async () => {
    if (ref.bookingId) {
      await prisma.auditLog.deleteMany({ where: { bookingId: ref.bookingId } });
      await prisma.booking.deleteMany({ where: { id: ref.bookingId } });
    }
    if (ref.driverId) {
      await prisma.driverUnavailability.deleteMany({ where: { driverId: ref.driverId } });
      await prisma.auditLog.deleteMany({ where: { entityType: "DRIVER", entityId: ref.driverId } });
    }
    if (ref.userId) {
      await prisma.driver.deleteMany({ where: { userId: ref.userId } });
      await prisma.user.deleteMany({ where: { id: ref.userId } });
    }
  });

  it("leaves the driver on it, flags it, and clearing the leave clears the flag", async () => {
    const user = await prisma.user.create({
      data: { email: `span-${s}@test.local`, username: `span-${s}`, name: "Span Test", isActive: true },
      select: { id: true },
    });
    ref.userId = user.id;
    const driver = await prisma.driver.create({
      data: { userId: user.id, pool: "PUBLIC", isActive: true },
      select: { id: true },
    });
    ref.driverId = driver.id;

    const booking = await prisma.booking.create({
      data: {
        requesterId: "seed-user-requester",
        departmentId: "seed-dept-medicine",
        purpose: "span-test",
        destination: "Test",
        province: "เชียงใหม่",
        passengerCount: 1,
        jobType: "TJW",
        timeBucket: "MORNING_08_12",
        status: "APPROVED",
        driverScheduleStatus: "CLAIMED",
        primaryDriverId: driver.id,
        startAt: new Date("2026-09-26T08:00:00"),
        endAt: new Date("2026-09-28T18:00:00"),
      },
      select: { id: true },
    });
    ref.bookingId = booking.id;

    const off = new FormData();
    off.append("driverId", driver.id);
    off.append("date", leaveDay);
    off.append("off", "true");
    expect((await setDriverUnavailableAction(off)).ok).toBe(true);

    const flagged = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(flagged.primaryDriverId, "the trip is not moved").toBe(driver.id);
    expect(flagged.overflowReason).toBe("DRIVER_OFF_NEEDS_REVIEW");

    // The decision itself is on the record now, not only its consequences.
    const decision = await prisma.auditLog.findFirst({
      where: { entityType: "DRIVER", entityId: driver.id, action: "DRIVER_LEAVE_SET" },
      select: { actorUserId: true, bookingId: true },
    });
    expect(decision?.actorUserId).toBe("seed-user-admin");
    expect(decision?.bookingId).toBeNull();

    // Un-marking the leave takes the flag away — it only existed because the
    // driver was away.
    const on = new FormData();
    on.append("driverId", driver.id);
    on.append("date", leaveDay);
    on.append("off", "false");
    expect((await setDriverUnavailableAction(on)).ok).toBe(true);

    const cleared = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(cleared.overflowReason).toBeNull();
    const clearLog = await prisma.auditLog.findFirst({
      where: { entityType: "DRIVER", entityId: driver.id, action: "DRIVER_LEAVE_CLEARED" },
      select: { id: true },
    });
    expect(clearLog).not.toBeNull();
  });
});
