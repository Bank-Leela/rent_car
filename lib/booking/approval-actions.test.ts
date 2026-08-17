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
import {
  approveBookingAction,
  approveDocumentAction,
  denyByApproverAction,
} from "@/lib/booking/approval-actions";

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

    // Must stay PENDING_APPROVAL: a refusal that also moved the status would
    // take the decision away from the approver it was handed back to.
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

  // The bug this pins: approving onto an outside rental left the booking
  // OUTSOURCED with adHocVehicleId null, and EVERY admin surface filtered it
  // out — the queues key on PENDING_APPROVAL / AWAITING_DOCUMENT / APPROVED /
  // ASSIGNED, and both board views reach outsourced trips only THROUGH an
  // AdHocVehicle row. The requester's own list still showed it, so they believed
  // a vehicle was coming while nobody in the office had been told to hire one.
  //
  // The query below is the one /admin and the day's board now both run. If a
  // future change moves an approved-outsourced booking out of it without adding
  // another surface, the trip goes invisible to the office again.
  it("stays visible to the office until a vendor row is actually picked", async () => {
    const id = await bookingOn(offDay, { needsOutsourcing: true });
    const fd = new FormData();
    fd.append("bookingId", id);
    expect((await approveBookingAction(fd)).ok).toBe(true);

    const waitingForVendor = async () =>
      (
        await prisma.booking.findMany({
          where: { status: "OUTSOURCED", adHocVehicleId: null },
          select: { id: true },
        })
      ).some((b) => b.id === id);

    expect(await waitingForVendor(), "an approved outside rental with no vendor must be listed").toBe(true);

    // Attaching it to a hired vehicle is what resolves it — then it belongs to
    // that row and must drop out of the waiting list.
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id } });
    const day = startOfDay(booking.startAt);
    const row = await prisma.adHocVehicle.create({ data: { date: day, label: "ทดสอบ รถเช่า" } });
    await prisma.booking.update({ where: { id }, data: { adHocVehicleId: row.id } });

    expect(await waitingForVendor(), "once on a vendor row it is no longer outstanding").toBe(false);

    await prisma.booking.update({ where: { id }, data: { adHocVehicleId: null } });
    await prisma.adHocVehicle.delete({ where: { id: row.id } });
  });

  // A WAITLIST row IS the over-capacity case, so refusing it is the commonest
  // decision it gets. The queue card used to offer อนุมัติ and nothing else,
  // which the capacity gate then refused — the row could only be left to rot.
  it("denies a WAITLIST booking, which is the whole point of that queue", async () => {
    const id = await bookingOn(offDay, { status: "WAITLIST" });
    const fd = new FormData();
    fd.append("bookingId", id);
    fd.append("comment", "รถเต็มทั้งวัน ขอปฏิเสธ");
    expect((await denyByApproverAction(fd)).ok).toBe(true);

    const after = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("DENIED");
    expect(after.denialReason).toBe("รถเต็มทั้งวัน ขอปฏิเสธ");

    // The history has to say it was refused OFF the waitlist, not as an
    // ordinary pending request — that is why it was refused.
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { bookingId: id, action: "BOOKING_DENIED" },
    });
    expect(log.fromStatus).toBe("WAITLIST");
  });

  it("still refuses to deny a status that is past the decision", async () => {
    const id = await bookingOn(freeDay, { status: "ASSIGNED" });
    const fd = new FormData();
    fd.append("bookingId", id);
    fd.append("comment", "ไม่ควรทำได้");
    const res = await denyByApproverAction(fd);
    expect(res.ok).toBe(false);

    const after = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("ASSIGNED");
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
