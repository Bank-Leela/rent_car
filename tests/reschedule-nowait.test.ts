import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (k: string) => k),
}));
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "seed-user-requester", roles: ["REQUESTER"] } })),
}));
vi.mock("@/lib/email/client", () => ({ sendEmail: vi.fn(async () => {}) }));

import { updateBookingTimeAction } from "@/lib/booking/actions";

// A no-wait trip occupies TWO intervals. The occupancy trigger builds
// tsrange(startAt, dropOffDone), so a reschedule that leaves dropOffDone on the
// old day produces lower > upper — which Postgres refuses on the NEXT
// assignment, aborting that whole day's batch rather than failing here.
const MARK = "NOWAIT-RESCHED";
const ids: string[] = [];

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

async function makeNoWait(day: string) {
  const req = await prisma.user.findUniqueOrThrow({
    where: { id: "seed-user-requester" },
    select: { departmentId: true },
  });
  const b = await prisma.booking.create({
    data: {
      requesterId: "seed-user-requester",
      departmentId: req.departmentId!,
      purpose: `${MARK} ${day}`,
      destination: "ทดสอบไม่คอย",
      province: "กรุงเทพมหานคร",
      startAt: new Date(`${day}T08:00:00`),
      endAt: new Date(`${day}T18:00:00`),
      passengerCount: 1,
      jobType: "NORMAL",
      timeBucket: "MORNING_08_12",
      status: "APPROVED",
      waitAtDestination: false,
      dropOffDone: new Date(`${day}T10:00:00`),
      pickupReturnTime: "15:00",
    },
    select: { id: true },
  });
  ids.push(b.id);
  return b.id;
}

describe("rescheduling a no-wait booking", () => {
  it("moves dropOffDone onto the new day instead of leaving it behind", async () => {
    const id = await makeNoWait("2028-03-06");
    const fd = new FormData();
    fd.set("bookingId", id);
    fd.set("startAt", "2028-03-13T08:00");
    fd.set("endAt", "2028-03-13T18:00");
    const res = await updateBookingTimeAction(fd);
    expect(res.ok, JSON.stringify(res)).toBe(true);

    const after = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(after.startAt.toISOString().slice(0, 10)).toBe("2028-03-13");
    // The whole point: same day as the new start, and strictly inside the trip.
    expect(after.dropOffDone!.toISOString().slice(0, 10)).toBe("2028-03-13");
    expect(after.dropOffDone!.getTime()).toBeGreaterThan(after.startAt.getTime());
    expect(after.dropOffDone!.getTime()).toBeLessThan(after.endAt.getTime());
  });

  it("refuses rather than writing a split the constraint would later reject", async () => {
    const id = await makeNoWait("2028-04-10");
    const fd = new FormData();
    fd.set("bookingId", id);
    // New window ends before the 15:00 pickup — the split cannot fit.
    fd.set("startAt", "2028-04-17T08:00");
    fd.set("endAt", "2028-04-17T11:00");
    const res = await updateBookingTimeAction(fd);
    expect(res.ok).toBe(false);

    const after = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(after.startAt.toISOString().slice(0, 10), "unchanged on refusal").toBe("2028-04-10");
  });
});
