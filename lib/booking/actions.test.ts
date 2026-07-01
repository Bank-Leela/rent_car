import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addBusinessDays, addDays, startOfDay } from "date-fns";

// Mock Next runtime + i18n + email so the action runs outside a request.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (k: string, v?: Record<string, unknown>) =>
    v ? `${k}:${JSON.stringify(v)}` : k,
  ),
}));
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({
    user: { id: "seed-user-requester", roles: ["REQUESTER"] },
  })),
}));
vi.mock("@/lib/email/client", () => ({
  sendEmail: vi.fn(async () => {}),
}));
vi.mock("@/lib/line/client", () => ({
  sendLineNotification: vi.fn(async () => {}),
}));

import { prisma } from "@/lib/db";
import { createBookingAction } from "@/lib/booking/actions";
import { BANGKOK_PROVINCE, LEAD_TIME_BANGKOK_DAYS } from "@/lib/booking/rules";

const REQUESTER_ID = "seed-user-requester";
const createdIds: string[] = [];
// Department is now locked to the requester's profile and resolved server-side,
// so the requester must have one set. Captured for assertions.
let deptId = "";

beforeAll(async () => {
  const u = await prisma.user.findUnique({ where: { id: REQUESTER_ID } });
  if (!u) {
    throw new Error(
      "Seed requester missing. Run `npx prisma db seed` against the dev DB first.",
    );
  }
  const dept =
    (await prisma.department.findUnique({ where: { id: "seed-dept-medicine" } })) ??
    (await prisma.department.findFirst());
  if (!dept) throw new Error("No department seeded. Run `npx prisma db seed`.");
  deptId = dept.id;
  await prisma.user.update({ where: { id: REQUESTER_ID }, data: { departmentId: deptId } });
  // Clear pending evaluations that would block submission.
  await prisma.trip.deleteMany({
    where: { booking: { requesterId: REQUESTER_ID, status: "COMPLETED" }, evaluation: null },
  });
});

afterAll(async () => {
  // Sweep by marker purposes so leaked rows from failed assertions get cleaned too.
  const markerPurposes = [
    "Integration smoke trip",
    "Recurring smoke",
    "Should be rejected",
    "End before start",
  ];
  const rows = await prisma.booking.findMany({
    where: { purpose: { in: markerPurposes } },
    select: { id: true },
  });
  const ids = [...new Set([...createdIds, ...rows.map((r) => r.id)])];
  if (ids.length > 0) {
    await prisma.auditLog.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.recurrenceRule.deleteMany({ where: { parentBookingId: { in: ids } } });
    await prisma.booking.deleteMany({ where: { recurrenceParentId: { in: ids } } });
    await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

function formDataFor(input: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(input)) fd.append(k, v);
  return fd;
}

function isoLocal(d: Date) {
  // yyyy-MM-ddTHH:mm in local timezone, the shape <input type="datetime-local"> emits.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

describe("createBookingAction", () => {
  it("creates a PENDING_APPROVAL booking and redirects to detail", async () => {
    const start = new Date(startOfDay(addBusinessDays(new Date(), LEAD_TIME_BANGKOK_DAYS + 1)));
    start.setHours(9, 0, 0, 0);
    const end = new Date(start);
    end.setHours(start.getHours() + 4);

    await expect(
      createBookingAction(
        formDataFor({
          departmentId: "seed-dept-medicine",
          purpose: "Integration smoke trip",
          destination: "Lab",
          pickupLocation: "Test lobby",
          waitingLocation: "Test parking",
          province: BANGKOK_PROVINCE,
          googleMapsUrl: "https://maps.app.goo.gl/smoke",
          startAt: isoLocal(start),
          endAt: isoLocal(end),
          passengerCount: "3",
          passengerNotes: "",
          estimatedDistance: "",
          ajarnName: "ศ. ดร. ทดสอบ",
          ajarnPhone: "0812345678",
          ajarnEmail: "ajarn@chula.ac.th",
          coordinatorName: "นางสาว ประสาน",
          coordinatorPhone: "0898765432",
          jobType: "OT",
          recurringWeekdays: "",
          recurringUntil: "",
        }),
      ),
    ).rejects.toMatchObject({ message: "NEXT_REDIRECT" });

    const after = await prisma.booking.findMany({
      where: { requesterId: REQUESTER_ID, purpose: "Integration smoke trip" },
      orderBy: { createdAt: "desc" },
      include: { auditLogs: true },
    });
    expect(after).toHaveLength(1);
    const booking = after[0]!;
    expect(booking.status).toBe("PENDING_APPROVAL");
    expect(booking.jobNumber).toMatch(/^VB-\d{6}-\d+$/);
    expect(booking.auditLogs).toHaveLength(1);
    expect(booking.auditLogs[0]!.action).toBe("BOOKING_SUBMITTED");
    // Department comes from the profile, not the payload; coordinator persisted.
    expect(booking.departmentId).toBe(deptId);
    expect(booking.coordinatorName).toBe("นางสาว ประสาน");
    expect(booking.coordinatorPhone).toBe("0898765432");
    expect(booking.googleMapsUrl).toBe("https://maps.app.goo.gl/smoke");
    createdIds.push(booking.id);
  });

  it("persists a no-wait split (dropOffDone + waitAtDestination=false)", async () => {
    const start = new Date(startOfDay(addBusinessDays(new Date(), LEAD_TIME_BANGKOK_DAYS + 1)));
    start.setHours(9, 0, 0, 0);
    const drop = new Date(start); drop.setHours(11, 0, 0, 0);
    const end = new Date(start); end.setHours(16, 0, 0, 0);

    await expect(
      createBookingAction(
        formDataFor({
          departmentId: "seed-dept-medicine",
          purpose: "No-wait split smoke",
          destination: "Lab",
          pickupLocation: "Test lobby",
          province: BANGKOK_PROVINCE,
          googleMapsUrl: "https://maps.app.goo.gl/smoke",
          startAt: isoLocal(start),
          endAt: isoLocal(end),
          waitAtDestination: "",
          dropOffDone: isoLocal(drop),
          pickupReturnTime: "14:00",
          passengerCount: "2",
          passengerNotes: "",
          estimatedDistance: "",
          ajarnName: "ศ. ดร. ทดสอบ",
          ajarnPhone: "0812345678",
          ajarnEmail: "ajarn@chula.ac.th",
          coordinatorName: "นางสาว ประสาน",
          coordinatorPhone: "0898765432",
          jobType: "OT",
          recurringWeekdays: "",
          recurringUntil: "",
        }),
      ),
    ).rejects.toMatchObject({ message: "NEXT_REDIRECT" });

    const after = await prisma.booking.findMany({
      where: { requesterId: REQUESTER_ID, purpose: "No-wait split smoke" },
      orderBy: { createdAt: "desc" },
    });
    expect(after).toHaveLength(1);
    const booking = after[0]!;
    expect(booking.waitAtDestination).toBe(false);
    expect(booking.pickupReturnTime).toBe("14:00");
    expect(booking.dropOffDone).not.toBeNull();
    expect(booking.dropOffDone!.getHours()).toBe(11);
    createdIds.push(booking.id);
  });

  it("rejects when start violates Bangkok lead time", async () => {
    const tooSoon = new Date();
    tooSoon.setHours(tooSoon.getHours() + 1);
    const end = new Date(tooSoon);
    end.setHours(end.getHours() + 2);

    const res = await createBookingAction(
      formDataFor({
        departmentId: "seed-dept-medicine",
        purpose: "Should be rejected",
        destination: "Lab",
        pickupLocation: "Test lobby",
        waitingLocation: "Test parking",
        province: BANGKOK_PROVINCE,
        googleMapsUrl: "https://maps.app.goo.gl/smoke",
        startAt: isoLocal(tooSoon),
        endAt: isoLocal(end),
        passengerCount: "1",
        passengerNotes: "",
        estimatedDistance: "",
        ajarnName: "ศ. ดร. ทดสอบ",
        ajarnPhone: "0812345678",
        ajarnEmail: "ajarn@chula.ac.th",
        coordinatorName: "นางสาว ประสาน",
        coordinatorPhone: "0898765432",
        jobType: "OT",
        recurringWeekdays: "",
        recurringUntil: "",
      }),
    );
    expect(res).toMatchObject({ ok: false, field: "startAt" });
  });

  it("rejects when endAt is before startAt", async () => {
    const start = new Date(startOfDay(addBusinessDays(new Date(), LEAD_TIME_BANGKOK_DAYS + 1)));
    start.setHours(10, 0, 0, 0);
    const end = new Date(start);
    end.setHours(start.getHours() - 1);

    const res = await createBookingAction(
      formDataFor({
        departmentId: "seed-dept-medicine",
        purpose: "End before start",
        destination: "Lab",
        pickupLocation: "Test lobby",
        waitingLocation: "Test parking",
        province: BANGKOK_PROVINCE,
        googleMapsUrl: "https://maps.app.goo.gl/smoke",
        startAt: isoLocal(start),
        endAt: isoLocal(end),
        passengerCount: "1",
        passengerNotes: "",
        estimatedDistance: "",
        ajarnName: "ศ. ดร. ทดสอบ",
        ajarnPhone: "0812345678",
        ajarnEmail: "ajarn@chula.ac.th",
        coordinatorName: "นางสาว ประสาน",
        coordinatorPhone: "0898765432",
        jobType: "OT",
        recurringWeekdays: "",
        recurringUntil: "",
      }),
    );
    expect(res).toMatchObject({ ok: false });
    if (res && !res.ok) expect(res.field).toBe("endAt");
  });

  it("expands recurrence into children when weekdays + until are set", async () => {
    const start = new Date(startOfDay(addBusinessDays(new Date(), LEAD_TIME_BANGKOK_DAYS + 1)));
    start.setHours(8, 0, 0, 0);
    const end = new Date(start);
    end.setHours(start.getHours() + 3);
    const until = addDays(start, 21);
    const wd = start.getDay();

    await expect(
      createBookingAction(
        formDataFor({
          departmentId: "seed-dept-medicine",
          purpose: "Recurring smoke",
          destination: "Campus",
          pickupLocation: "Test lobby",
          waitingLocation: "Test parking",
          province: BANGKOK_PROVINCE,
          googleMapsUrl: "https://maps.app.goo.gl/smoke",
          startAt: isoLocal(start),
          endAt: isoLocal(end),
          passengerCount: "2",
          passengerNotes: "",
          estimatedDistance: "",
          ajarnName: "ศ. ดร. ทดสอบ",
          ajarnPhone: "0812345678",
          ajarnEmail: "ajarn@chula.ac.th",
          coordinatorName: "นางสาว ประสาน",
          coordinatorPhone: "0898765432",
          jobType: "OT",
          recurringWeekdays: String(wd),
          recurringUntil: isoLocal(until).slice(0, 10),
        }),
      ),
    ).rejects.toMatchObject({ message: "NEXT_REDIRECT" });

    const parent = await prisma.booking.findFirst({
      where: { requesterId: REQUESTER_ID, purpose: "Recurring smoke", recurrenceParentId: null },
      orderBy: { createdAt: "desc" },
    });
    expect(parent).not.toBeNull();
    const children = await prisma.booking.findMany({
      where: { recurrenceParentId: parent!.id },
    });
    expect(children.length).toBeGreaterThanOrEqual(2);
    const rule = await prisma.recurrenceRule.findUnique({ where: { parentBookingId: parent!.id } });
    expect(rule).not.toBeNull();
    createdIds.push(parent!.id, ...children.map((c) => c.id));
  });
});
