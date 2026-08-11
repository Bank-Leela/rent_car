import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, startOfDay } from "date-fns";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (k: string, v?: Record<string, unknown>) =>
    v ? `${k}:${JSON.stringify(v)}` : k,
  ),
}));
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({
    user: { id: "seed-user-admin", roles: ["ADMIN"] },
  })),
}));
const mocks = vi.hoisted(() => ({ sendEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/email/client", () => ({ sendEmail: mocks.sendEmail }));
const sendEmailMock = mocks.sendEmail;
vi.mock("@/lib/pdf/generate", () => ({
  generateBookingPdf: vi.fn(async () => "stub://pdf"),
}));

import { prisma } from "@/lib/db";
import { approveBookingAction, approveDocumentAction } from "@/lib/booking/approval-actions";

const REQUESTER_ID = "seed-user-requester";
const cleanup: string[] = [];

async function makePendingBooking() {
  const requester = await prisma.user.findUniqueOrThrow({
    where: { id: REQUESTER_ID },
    select: { departmentId: true },
  });
  const start = startOfDay(addDays(new Date(), 10));
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(start.getHours() + 4);
  const b = await prisma.booking.create({
    data: {
      requesterId: REQUESTER_ID,
      departmentId: requester.departmentId!,
      purpose: "Approval email smoke",
      destination: "Lab",
      province: "กรุงเทพมหานคร",
      startAt: start,
      endAt: end,
      passengerCount: 2,
      status: "PENDING_APPROVAL",
      jobType: "OT",
      timeBucket: "MORNING_08_12",
    },
  });
  cleanup.push(b.id);
  return b.id;
}

beforeAll(async () => {
  const u = await prisma.user.findUnique({ where: { id: REQUESTER_ID } });
  if (!u) throw new Error("Seed missing — run `npx prisma db seed`.");
});

beforeEach(() => {
  sendEmailMock.mockClear();
});

afterAll(async () => {
  const rows = await prisma.booking.findMany({
    where: { purpose: "Approval email smoke" },
    select: { id: true },
  });
  const ids = [...new Set([...cleanup, ...rows.map((r) => r.id)])];
  if (ids.length > 0) {
    await prisma.auditLog.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.approval.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

describe("approveBookingAction email", () => {
  it("sends requester an approval email", async () => {
    const bookingId = await makePendingBooking();
    const requester = await prisma.user.findUniqueOrThrow({
      where: { id: REQUESTER_ID },
      select: { email: true },
    });
    const fd = new FormData();
    fd.append("bookingId", bookingId);

    const res = await approveBookingAction(fd);
    expect(res).toEqual({ ok: true });

    const calls = sendEmailMock.mock.calls.map(
      (c: unknown[]) => c[0] as { to: string | string[]; subject: string },
    );
    const toRequester = calls.find((c) => c.to === requester.email);
    expect(toRequester, "should email requester").toBeDefined();
    // Emails are Thai-only (the "/ Approved" half was removed with the EN locale).
    expect(toRequester!.subject).toMatch(/อนุมัติแล้ว/);

    // จัด no longer runs on approval. The booking waits for the signed official
    // form, so it must leave this call with a car conspicuously NOT assigned.
    const updated = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(updated.status).toBe("AWAITING_DOCUMENT");
    expect(updated.primaryDriverId, "no car until the document is confirmed").toBeNull();
    expect(updated.vehicleId).toBeNull();
  });

  // The step that replaced "จัด runs on approval": confirming the document is
  // what dispatches. A booking that fits comes back already on a car; one that
  // does not stays APPROVED for the schedule board's bar.
  it("confirming the document runs จัด", async () => {
    const bookingId = await makePendingBooking();
    const fd = new FormData();
    fd.append("bookingId", bookingId);
    expect(await approveBookingAction(fd)).toEqual({ ok: true });

    const doc = new FormData();
    doc.append("bookingId", bookingId);
    expect(await approveDocumentAction(doc)).toEqual({ ok: true });

    const after = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (after.status === "ASSIGNED") {
      expect(after.primaryDriverId, "an assigned booking has a driver").not.toBeNull();
      expect(after.vehicleId, "an assigned booking has a car").not.toBeNull();
    } else {
      expect(after.status).toBe("APPROVED");
      expect(after.primaryDriverId).toBeNull();
    }

    // Re-confirming an already-confirmed document must not re-run anything.
    const again = await approveDocumentAction(doc);
    expect(again.ok).toBe(false);
  });

  it("notifies admins", async () => {
    const bookingId = await makePendingBooking();
    const fd = new FormData();
    fd.append("bookingId", bookingId);

    await approveBookingAction(fd);
    const calls = sendEmailMock.mock.calls.map(
      (c: unknown[]) => c[0] as { to: string | string[]; subject: string },
    );
    const adminCall = calls.find((c) => Array.isArray(c.to));
    expect(adminCall, "should email admins").toBeDefined();
  });
});

// The capacity gate at approval. "Full" is forced deterministically by marking
// every active driver off for the day, so recommendForBookings finds no pool and
// returns kind:"none" — the same verdict a genuinely saturated day produces,
// without having to fabricate a full fleet's worth of trips.
describe("approval capacity gate", () => {
  const offDay = new Date("2027-03-17T00:00:00");
  // A day nobody is marked off for, so the gate says there IS room. Used to
  // prove `force` does nothing when the fleet can serve the trip.
  const freeDay = new Date("2027-03-24T00:00:00");
  let driverIds: string[] = [];

  beforeAll(async () => {
    const drivers = await prisma.driver.findMany({
      where: { isActive: true, user: { is: { isActive: true } } },
      select: { id: true },
    });
    driverIds = drivers.map((d) => d.id);
    for (const id of driverIds) {
      await prisma.driverUnavailability.upsert({
        where: { driverId_date: { driverId: id, date: offDay } },
        create: { driverId: id, date: offDay, reason: "capacity-gate test" },
        update: {},
      });
    }
  });

  afterAll(async () => {
    await prisma.driverUnavailability.deleteMany({ where: { date: offDay } });
  });

  async function bookingOn(day: Date, extra: Record<string, unknown> = {}) {
    const requester = await prisma.user.findUniqueOrThrow({
      where: { id: REQUESTER_ID },
      select: { departmentId: true },
    });
    const start = new Date(day);
    start.setHours(9, 0, 0, 0);
    const end = new Date(start);
    end.setHours(11, 0, 0, 0);
    const b = await prisma.booking.create({
      data: {
        requesterId: REQUESTER_ID,
        departmentId: requester.departmentId!,
        purpose: "capacity gate",
        destination: "Test",
        province: "กรุงเทพมหานคร",
        startAt: start,
        endAt: end,
        passengerCount: 1,
        status: "PENDING_APPROVAL",
        jobType: "NORMAL",
        timeBucket: "MORNING_08_12",
        ...extra,
      },
      select: { id: true },
    });
    cleanup.push(b.id);
    return b.id;
  }

  it("refuses approval when no car can serve the day and no outside rental was accepted", async () => {
    const id = await bookingOn(offDay, { needsOutsourcing: false });
    const fd = new FormData();
    fd.append("bookingId", id);
    const res = (await approveBookingAction(fd)) as { ok: boolean; dayFull?: boolean };

    expect(res.ok).toBe(false);
    expect(res.dayFull, "the queue needs this flag to reveal its Deny button").toBe(true);

    // Must stay PENDING_APPROVAL — the only status denyByApproverAction accepts,
    // so the refusal leaves the approver able to act on it.
    const after = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("PENDING_APPROVAL");
  });

  // ── force: P'Top approving a full day anyway ──────────────────────────────
  //
  // The override does not invent capacity. It puts the trip on the ordinary
  // pipeline with no car, where the day's board shows it as approved-and-unplaced
  // for a human to sort out.
  it("force approves a full day, and keeps it INTERNAL rather than filing it as an outside rental", async () => {
    const id = await bookingOn(offDay, { needsOutsourcing: false });
    const fd = new FormData();
    fd.append("bookingId", id);
    fd.append("force", "1");
    fd.append("comment", "อธิการบดีสั่งการ ต้องไปให้ได้");
    expect((await approveBookingAction(fd)).ok).toBe(true);

    const after = await prisma.booking.findUniqueOrThrow({ where: { id } });
    // NOT OUTSOURCED: the requester never accepted an outside vehicle, and
    // filing an override as one would quietly change what was agreed.
    expect(after.status).toBe("AWAITING_DOCUMENT");
    expect(after.needsOutsourcing).toBe(false);
    // Still no car — the override was a decision, not a dispatch.
    expect(after.primaryDriverId).toBeNull();
    expect(after.vehicleId).toBeNull();
  });

  it("records the override under its own audit action, because the history renders the action and never the metadata", async () => {
    const id = await bookingOn(offDay, { needsOutsourcing: false });
    const fd = new FormData();
    fd.append("bookingId", id);
    fd.append("force", "1");
    fd.append("comment", "ผู้บริหารยืนยันให้เดินทาง");
    expect((await approveBookingAction(fd)).ok).toBe(true);

    const logs = await prisma.auditLog.findMany({ where: { bookingId: id } });
    const forced = logs.find((l) => l.action === "BOOKING_APPROVED_FORCED_DAY_FULL");
    expect(forced, "a forced approval must not read as an ordinary one").toBeTruthy();
    expect(logs.some((l) => l.action === "BOOKING_APPROVED_OUTSOURCED_DAY_FULL")).toBe(false);
    // The justification is kept where a deny keeps its reason too.
    const approval = await prisma.approval.findFirstOrThrow({ where: { bookingId: id } });
    expect(approval.comment).toBe("ผู้บริหารยืนยันให้เดินทาง");
  });

  it("refuses to force without a reason — the server checks, not just the button", async () => {
    const id = await bookingOn(offDay, { needsOutsourcing: false });
    const fd = new FormData();
    fd.append("bookingId", id);
    fd.append("force", "1");
    fd.append("comment", "ok"); // 2 chars, under the minimum
    const res = await approveBookingAction(fd);

    expect(res.ok).toBe(false);
    const after = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("PENDING_APPROVAL");
  });

  it("force is inert on a day that is not full — it never changes an ordinary approval", async () => {
    // The flag is an escape hatch for the capacity gate, not a mode. On a free
    // day the result must be byte-for-byte the ordinary approve.
    const id = await bookingOn(freeDay, { needsOutsourcing: false });
    const fd = new FormData();
    fd.append("bookingId", id);
    fd.append("force", "1");
    fd.append("comment", "ไม่จำเป็นต้องใช้");
    expect((await approveBookingAction(fd)).ok).toBe(true);

    const after = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("AWAITING_DOCUMENT");
    const logs = await prisma.auditLog.findMany({ where: { bookingId: id } });
    expect(logs.some((l) => l.action === "BOOKING_APPROVED")).toBe(true);
    expect(logs.some((l) => l.action === "BOOKING_APPROVED_FORCED_DAY_FULL")).toBe(false);
  });

  it("sends it to ส่งรถนอก instead of refusing when the requester accepted an outside rental", async () => {
    const id = await bookingOn(offDay, { needsOutsourcing: true });
    const fd = new FormData();
    fd.append("bookingId", id);
    expect((await approveBookingAction(fd)).ok).toBe(true);

    const after = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("OUTSOURCED");
    expect(after.needsOutsourcing).toBe(true);
  });

  it("does not gate a เวร booking — the duty car serves it, so the recommender always says none", async () => {
    // Without the jobType exemption this would refuse EVERY in-Chula booking as
    // "day full", because recommendPlacement returns none for WERN by design.
    const id = await bookingOn(offDay, { jobType: "WERN", travelWithinChula: true });
    const fd = new FormData();
    fd.append("bookingId", id);
    const res = await approveBookingAction(fd);
    expect(res.ok, "WERN must pass the gate untouched").toBe(true);

    const after = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("AWAITING_DOCUMENT");
  });
});
