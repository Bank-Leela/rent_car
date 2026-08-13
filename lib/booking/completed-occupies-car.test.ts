import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, startOfDay } from "date-fns";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (k: string) => k),
}));
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "seed-user-admin", roles: ["ADMIN"] } })),
}));
vi.mock("@/lib/email/client", () => ({ sendEmail: vi.fn(async () => {}) }));

import { prisma } from "@/lib/db";
import { assignBookingAction } from "@/lib/booking/actions";
import { loadBookingDetailContext } from "@/lib/booking/detail-context";

/**
 * A COMPLETED trip still holds its car.
 *
 * The occupancy trigger writes rows for APPROVED, ASSIGNED *and* COMPLETED, and
 * the GiST EXCLUDE enforces them — and occupancy comes from startAt/endAt, never
 * from completedAt, so finishing early does not release the car. Two places
 * disagreed with the database: the allocation pre-check and the car picker's
 * greyed-out flag both listed only APPROVED and ASSIGNED. A car whose sole clash
 * was a finished trip therefore rendered as free and enabled, and choosing it
 * failed on the constraint — as an unhandled rejection, so the admin got the error
 * boundary instead of "car busy".
 */
const TAG = "COMPLETED-HOLDS-CAR:";
const REQUESTER_ID = "seed-user-requester";
const DAY = startOfDay(addDays(new Date(), 260));

async function makeBooking(opts: {
  hour: number;
  hours: number;
  status: "APPROVED" | "COMPLETED";
  vehicleId?: string;
  driverId?: string;
}) {
  const requester = await prisma.user.findUniqueOrThrow({
    where: { id: REQUESTER_ID },
    select: { departmentId: true },
  });
  const startAt = new Date(DAY);
  startAt.setHours(opts.hour, 0, 0, 0);
  const endAt = new Date(DAY);
  endAt.setHours(opts.hour + opts.hours, 0, 0, 0);
  const b = await prisma.booking.create({
    data: {
      requesterId: REQUESTER_ID,
      departmentId: requester.departmentId!,
      purpose: `${TAG} ${opts.status} ${opts.hour}:00`,
      destination: "ศาลายา",
      province: "กรุงเทพมหานคร",
      startAt,
      endAt,
      passengerCount: 2,
      status: opts.status,
      jobType: "NORMAL",
      timeBucket: opts.hour < 12 ? "MORNING_08_12" : "AFTERNOON_12_16",
      ...(opts.vehicleId ? { vehicleId: opts.vehicleId } : {}),
      ...(opts.driverId ? { primaryDriverId: opts.driverId } : {}),
      ...(opts.status === "COMPLETED" ? { completedAt: new Date() } : {}),
    },
  });
  return b;
}

afterEach(async () => {
  const rows = await prisma.booking.findMany({
    where: { purpose: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = rows.map((r) => r.id);
  await prisma.auditLog.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.approval.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  const left = await prisma.booking.count({ where: { purpose: { startsWith: TAG } } });
  if (left > 0) throw new Error(`cleanup failed: ${left} ${TAG} rows survive`);
});

describe("a COMPLETED trip blocks its car", () => {
  it("the picker greys the car out instead of offering it as free", async () => {
    const driver = await prisma.driver.findFirstOrThrow({
      where: { isActive: true, assignedVehicle: { isNot: null } },
      include: { assignedVehicle: true },
    });
    const car = driver.assignedVehicle!;
    // Finished, but its window still covers the afternoon.
    await makeBooking({ hour: 9, hours: 7, status: "COMPLETED", vehicleId: car.id, driverId: driver.id });
    const wants = await makeBooking({ hour: 13, hours: 2, status: "APPROVED" });

    const ctx = await loadBookingDetailContext(
      {
        id: wants.id,
        requesterId: wants.requesterId,
        startAt: wants.startAt,
        endAt: wants.endAt,
        province: wants.province,
        isEmergency: wants.isEmergency,
        estimatedDistance: wants.estimatedDistance,
      },
      false,
    );
    const option = ctx.vehicleOptions.find((v) => v.id === car.id);
    expect(option, "the car should be listed").toBeTruthy();
    expect(option!.conflict, "a finished trip still occupies the car, so it is not free").toBe(true);
  });

  it("allocating that car is refused with a message, not an error boundary", async () => {
    const driver = await prisma.driver.findFirstOrThrow({
      where: { isActive: true, assignedVehicle: { isNot: null } },
      include: { assignedVehicle: true },
    });
    const car = driver.assignedVehicle!;
    await makeBooking({ hour: 9, hours: 7, status: "COMPLETED", vehicleId: car.id, driverId: driver.id });
    const wants = await makeBooking({ hour: 13, hours: 2, status: "APPROVED" });

    const fd = new FormData();
    fd.set("bookingId", wants.id);
    fd.set("vehicleId", car.id);
    const res = await assignBookingAction(fd);

    // Refused as DATA. Before, the pre-check passed and the DB threw, which
    // surfaced as an unhandled rejection rather than a result.
    expect(res.ok).toBe(false);
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: wants.id } });
    expect(after.vehicleId, "nothing is allocated on a refusal").toBeNull();
  });

  it("still allocates a car whose only clash is outside the window", async () => {
    // The guard must not become "COMPLETED blocks everything".
    const driver = await prisma.driver.findFirstOrThrow({
      where: { isActive: true, assignedVehicle: { isNot: null } },
      include: { assignedVehicle: true },
    });
    const car = driver.assignedVehicle!;
    await makeBooking({ hour: 6, hours: 2, status: "COMPLETED", vehicleId: car.id, driverId: driver.id });
    const wants = await makeBooking({ hour: 14, hours: 2, status: "APPROVED" });

    const fd = new FormData();
    fd.set("bookingId", wants.id);
    fd.set("vehicleId", car.id);
    const res = await assignBookingAction(fd);

    expect(res.ok, "06:00-08:00 finished does not block 14:00-16:00").toBe(true);
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: wants.id } });
    expect(after.vehicleId).toBe(car.id);
  });
});
