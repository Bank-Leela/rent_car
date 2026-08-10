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
      jobNumber: `VB-TEST-${Date.now()}`,
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
