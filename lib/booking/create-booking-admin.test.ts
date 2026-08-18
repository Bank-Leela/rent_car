import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, startOfDay } from "date-fns";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (k: string) => k),
}));
vi.mock("@/lib/email/client", () => ({ sendEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/line/client", () => ({ sendLineNotification: vi.fn(async () => {}) }));

// The role under test is swapped per case, so the session mock reads a mutable
// holder rather than a constant.
const who = vi.hoisted(() => ({
  user: { id: "seed-user-admin", roles: ["ADMIN"] as string[] },
}));
vi.mock("@/lib/session", () => ({ getSession: vi.fn(async () => who) }));

import { prisma } from "@/lib/db";
import { createBookingAction } from "@/lib/booking/create-booking-action";
import { BANGKOK_PROVINCE } from "@/lib/booking/rules";

const MARKER = "ADMIN-FILED:";
const REQUESTER_ID = "seed-user-requester";

const isoLocal = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function payload(extra: Record<string, string>, when: Date): FormData {
  const end = new Date(when);
  end.setHours(when.getHours() + 3);
  const fd = new FormData();
  const base: Record<string, string> = {
    purpose: `${MARKER} ${extra.purpose ?? "trip"}`,
    destination: "ศาลายา",
    pickupLocation: "หน้าอาคารอานันทมหิดล",
    waitingLocation: "ลานจอด",
    province: BANGKOK_PROVINCE,
    startAt: isoLocal(when),
    endAt: isoLocal(end),
    passengerCount: "2",
    ajarnName: "ผอ. ทดสอบ",
    ajarnPhone: "0812345678",
    ajarnEmail: "director@chula.ac.th",
    coordinatorName: "ธุรการ",
    coordinatorPhone: "0898765432",
    recurringWeekdays: "",
    recurringUntil: "",
    ...extra,
  };
  base.purpose = `${MARKER} ${extra.purpose ?? "trip"}`;
  for (const [k, v] of Object.entries(base)) fd.append(k, v);
  return fd;
}

async function bookingsFiled() {
  return prisma.booking.findMany({
    where: { purpose: { startsWith: MARKER } },
    include: { auditLogs: true },
    orderBy: { createdAt: "desc" },
  });
}

beforeAll(async () => {
  const [a, r] = await Promise.all([
    prisma.user.findUnique({ where: { id: "seed-user-admin" }, select: { departmentId: true } }),
    prisma.user.findUnique({ where: { id: REQUESTER_ID }, select: { departmentId: true } }),
  ]);
  if (!a?.departmentId || !r?.departmentId) {
    throw new Error("Seed users need departments — run `npx prisma db seed` first.");
  }
});

afterAll(async () => {
  const rows = await bookingsFiled();
  const ids = rows.map((b) => b.id);
  if (ids.length > 0) {
    await prisma.auditLog.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

describe("admin files a booking on someone's behalf", () => {
  it("records it under the REQUESTER, with the requester's department", async () => {
    who.user = { id: "seed-user-admin", roles: ["ADMIN"] };
    const tomorrow = startOfDay(addDays(new Date(), 1));
    tomorrow.setHours(9, 0, 0, 0);

    await expect(
      createBookingAction(
        payload({ purpose: "on-behalf", onBehalfOfUserId: REQUESTER_ID, isEmergency: "true" }, tomorrow),
      ),
    ).rejects.toMatchObject({ message: "NEXT_REDIRECT" });

    const [b] = await bookingsFiled();
    expect(b, "the booking exists").toBeTruthy();
    // The whole point: department reporting is per-requester, and a dean's-office
    // trip filed against P'Top's department is a wrong number in every report.
    const requester = await prisma.user.findUniqueOrThrow({
      where: { id: REQUESTER_ID },
      select: { departmentId: true },
    });
    expect(b!.requesterId).toBe(REQUESTER_ID);
    expect(b!.departmentId).toBe(requester.departmentId);
    // And the history says a human filed it for them — the action, not metadata,
    // because the booking page renders the action and never the metadata.
    expect(b!.auditLogs.map((l) => l.action)).toContain("BOOKING_SUBMITTED_ON_BEHALF");
  });

  it("records a BACKDATED trip and says so in the history", async () => {
    who.user = { id: "seed-user-admin", roles: ["ADMIN"] };
    const lastWeek = startOfDay(addDays(new Date(), -7));
    lastWeek.setHours(8, 0, 0, 0);

    await expect(
      createBookingAction(payload({ purpose: "backdated", backdated: "true" }, lastWeek)),
    ).rejects.toMatchObject({ message: "NEXT_REDIRECT" });

    const [b] = await bookingsFiled();
    expect(b!.startAt.getTime()).toBeLessThan(Date.now());
    expect(b!.auditLogs.map((l) => l.action)).toContain("BOOKING_SUBMITTED_BACKDATED");
    // Still goes through approval — backdating records a trip, it does not
    // pre-approve one.
    expect(["PENDING_APPROVAL", "WAITLIST"]).toContain(b!.status);
  });
});

describe("a REQUESTER cannot use the admin fields", () => {
  // The schema parses both keys off ANY payload (it has to — strip mode would
  // drop them otherwise), so the role check in the action is the only thing
  // between a requester and filing under someone else's department.
  it("refuses on-behalf", async () => {
    who.user = { id: REQUESTER_ID, roles: ["REQUESTER"] };
    const tomorrow = startOfDay(addDays(new Date(), 1));
    tomorrow.setHours(9, 0, 0, 0);
    // Count before/after: the admin cases above legitimately left rows behind,
    // so "none exist" would be asserting the wrong thing.
    const before = (await bookingsFiled()).length;
    const res = await createBookingAction(
      payload(
        { purpose: "sneaky-behalf", onBehalfOfUserId: "seed-user-admin", isEmergency: "true" },
        tomorrow,
      ),
    );
    expect(res && "ok" in res ? res.ok : true, "must be refused, not redirected").toBe(false);
    expect(await bookingsFiled()).toHaveLength(before);
  });

  it("refuses backdating", async () => {
    who.user = { id: REQUESTER_ID, roles: ["REQUESTER"] };
    const lastWeek = startOfDay(addDays(new Date(), -7));
    lastWeek.setHours(8, 0, 0, 0);
    const before = (await bookingsFiled()).length;
    const res = await createBookingAction(payload({ purpose: "sneaky-past", backdated: "true" }, lastWeek));
    expect(res && "ok" in res ? res.ok : true, "must be refused, not redirected").toBe(false);
    expect(await bookingsFiled()).toHaveLength(before);
  });
});
