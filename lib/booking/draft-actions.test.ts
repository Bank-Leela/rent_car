import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, startOfDay } from "date-fns";

// Run the ADMIN draft-apply server action outside a request: mock Next runtime +
// session (ADMIN) + side-effect clients. Seeds against the real dev DB (like
// schedule-actions.test.ts), so this exercises the actual two-phase apply
// (detach → reattach) against the real overlap SELECT — the swap-deadlock fix the
// rewrite exists to enable. The driver-side draft authoring is gone (P'Top decides),
// so drafts are seeded directly here.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({ getTranslations: vi.fn(async () => (k: string) => k) }));
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "seed-user-admin", roles: ["ADMIN", "DRIVER"] } })),
}));
vi.mock("@/lib/email/client", () => ({ sendEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/line/client", () => ({ sendLineNotification: vi.fn(async () => {}) }));

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { applyDraftAction } from "@/lib/booking/draft-actions";

const REQ_ID = "seed-user-requester";
const DEPT = "seed-dept-medicine";
const MARKER = "DRAFT-TEST";
// A quiet far-future day, distinct from schedule-actions.test.ts (+90) so the two
// files never collide on the shared cars even though file order isn't guaranteed.
const DAY = startOfDay(addDays(new Date(), 120));

const createdIds: string[] = [];
let jnSeq = 0;
const jn = () => `VB-DRAFT-${Date.now()}-${jnSeq++}`;
const at = (base: Date, h: number) => {
  const d = new Date(base);
  d.setHours(h, 0, 0, 0);
  return d;
};

type V = { id: string; driverId: string };
let vA: V;
let vB: V;

async function mkBooking(
  over: Partial<Prisma.BookingUncheckedCreateInput> & { startAt: Date; endAt: Date },
) {
  const b = await prisma.booking.create({
    data: {
      jobNumber: jn(),
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

// Seed a SUBMITTED draft directly (the driver authoring path is gone), so the
// admin apply action has something to consume.
async function seedSubmittedDraft(bookingId: string, proposedVehicleId: string | null) {
  await prisma.bookingDraft.create({
    data: { bookingId, proposedVehicleId, submitted: true, submittedAt: new Date() },
  });
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
  const extra = await prisma.booking.findMany({ where: { purpose: MARKER }, select: { id: true } });
  const ids = [...new Set([...createdIds, ...extra.map((r) => r.id)])];
  if (ids.length) {
    await prisma.bookingDraft.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.bookingClaim.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

describe("applyDraftAction — same-time swap (the trade-board's core case)", () => {
  it("applies an A↔B car swap that would deadlock a one-at-a-time apply", async () => {
    // A on vA 09–11, B on vB 09–11 — same time, different cars.
    const a = await mkBooking({ startAt: at(DAY, 9), endAt: at(DAY, 11), vehicleId: vA.id, primaryDriverId: vA.driverId, status: "ASSIGNED" });
    const b = await mkBooking({ startAt: at(DAY, 9), endAt: at(DAY, 11), vehicleId: vB.id, primaryDriverId: vB.driverId, status: "ASSIGNED" });

    // Submitted swap: A→vB, B→vA.
    await seedSubmittedDraft(a.id, vB.id);
    await seedSubmittedDraft(b.id, vA.id);

    const res = await applyDraftAction();
    expect(res.ok).toBe(true);
    expect(res.applied).toBe(2);
    expect(res.skipped).toBe(0);

    const aAfter = await prisma.booking.findUnique({ where: { id: a.id } });
    const bAfter = await prisma.booking.findUnique({ where: { id: b.id } });
    expect(aAfter?.vehicleId).toBe(vB.id);
    expect(aAfter?.primaryDriverId).toBe(vB.driverId);
    expect(aAfter?.status).toBe("ASSIGNED");
    expect(bAfter?.vehicleId).toBe(vA.id);
    expect(bAfter?.primaryDriverId).toBe(vA.driverId);
    // Both drafts consumed.
    expect(await prisma.bookingDraft.count({ where: { bookingId: { in: [a.id, b.id] } } })).toBe(0);
  });
});

describe("applyDraftAction — move to queue", () => {
  it("detaches the car + driver and returns the trip to the queue (APPROVED)", async () => {
    const b = await mkBooking({ startAt: at(DAY, 13), endAt: at(DAY, 15), vehicleId: vA.id, primaryDriverId: vA.driverId, status: "ASSIGNED" });
    // proposedVehicleId null == back to the queue.
    await seedSubmittedDraft(b.id, null);

    const res = await applyDraftAction();
    expect(res.applied).toBe(1);
    const after = await prisma.booking.findUnique({ where: { id: b.id } });
    expect(after?.vehicleId).toBeNull();
    expect(after?.primaryDriverId).toBeNull();
    expect(after?.status).toBe("APPROVED");
  });
});

describe("applyDraftAction — stale/terminal booking", () => {
  it("never resurrects a booking P'Top cancelled after submit, and skipped excludes it", async () => {
    const b = await mkBooking({ startAt: at(DAY, 16), endAt: at(DAY, 18), vehicleId: vA.id, primaryDriverId: vA.driverId, status: "ASSIGNED" });
    await seedSubmittedDraft(b.id, vB.id);
    // P'Top cancels the trip after the move was submitted.
    await prisma.booking.update({ where: { id: b.id }, data: { status: "CANCELLED", vehicleId: null, primaryDriverId: null } });

    const res = await applyDraftAction();
    expect(res.applied).toBe(0);
    // Dead draft is NOT counted as "still pending" and NOT resurrected.
    expect(res.skipped).toBe(0);
    const after = await prisma.booking.findUnique({ where: { id: b.id } });
    expect(after?.status).toBe("CANCELLED");
    expect(after?.vehicleId).toBeNull();
    // The dead draft is dropped.
    expect(await prisma.bookingDraft.count({ where: { bookingId: b.id } })).toBe(0);
  });
});
