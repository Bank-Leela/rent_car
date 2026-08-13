import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "seed-user-admin", roles: ["ADMIN"] } })),
}));

import { startOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import {
  addAdHocRowAction,
  outsourceToRowAction,
  removeAdHocRowAction,
  carryVendorToSeriesAction,
} from "@/lib/booking/adhoc-actions";

const REQUESTER_ID = "seed-user-requester";
const TAG = "SERIES-OUTSOURCE:";
const VENDOR = "หจก. ทดสอบ ซีรีส์";
// Three Tuesdays, well clear of anything else in the dev database.
const DATES = ["2027-09-07", "2027-09-14", "2027-09-21"];

async function seedSeries() {
  const requester = await prisma.user.findUniqueOrThrow({
    where: { id: REQUESTER_ID },
    select: { departmentId: true },
  });
  const mk = async (iso: string, parentId: string | null) => {
    const startAt = new Date(`${iso}T08:00:00`);
    const endAt = new Date(`${iso}T14:00:00`);
    const b = await prisma.booking.create({
      data: {
        requesterId: REQUESTER_ID,
        departmentId: requester.departmentId!,
        purpose: `${TAG} weekly outside trip`,
        destination: "ศาลายา",
        province: "กรุงเทพมหานคร",
        startAt,
        endAt,
        passengerCount: 20,
        status: "APPROVED",
        jobType: "NORMAL",
        timeBucket: "MORNING_08_12",
        preferredVehicleType: "BUS_OUTSOURCED",
        needsOutsourcing: true,
        ...(parentId ? { recurrenceParentId: parentId } : {}),
      },
      select: { id: true },
    });
    return b.id;
  };
  const first = await mk(DATES[0]!, null);
  const second = await mk(DATES[1]!, first);
  const third = await mk(DATES[2]!, first);
  return { first, second, third };
}

async function makeRow(iso: string) {
  const fd = new FormData();
  fd.set("date", iso);
  fd.set("label", VENDOR);
  fd.set("cost", "12000");
  fd.set("contactName", "สมชาย ใจดี");
  fd.set("contactPhone", "081-111-2222");
  expect((await addAdHocRowAction(fd)).ok).toBe(true);
  return prisma.adHocVehicle.findFirstOrThrow({
    where: { date: startOfDay(new Date(`${iso}T00:00:00`)), label: VENDOR },
    select: { id: true },
  });
}

afterEach(async () => {
  const rows = await prisma.booking.findMany({
    where: { purpose: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = rows.map((r) => r.id);
  await prisma.auditLog.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids }, recurrenceParentId: { not: null } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  await prisma.adHocVehicle.deleteMany({ where: { label: VENDOR } });
  const left = await prisma.booking.count({ where: { purpose: { startsWith: TAG } } });
  if (left > 0) throw new Error(`cleanup failed: ${left} ${TAG} rows survive`);
});

describe("outsourcing one occurrence of a recurring booking", () => {
  it("carries the vendor and contact to the later dates, each on its own row", async () => {
    // AdHocVehicle is scoped to one date, so the later occurrences cannot share
    // the first date's row — the vendor identity is what travels, not the row.
    const { first, second, third } = await seedSeries();
    const row = await makeRow(DATES[0]!);

    const fd = new FormData();
    fd.set("bookingId", first);
    fd.set("rowId", row.id);
    const res = (await outsourceToRowAction(fd)) as { ok: boolean; carriedForward?: number };
    expect(res.ok).toBe(true);
    expect(res.carriedForward, "both later occurrences should be carried").toBe(2);

    for (const [i, id] of [first, second, third].entries()) {
      const b = await prisma.booking.findUniqueOrThrow({ where: { id } });
      expect(b.status, `occurrence ${i}`).toBe("OUTSOURCED");
      expect(b.outsourceVendor).toBe(VENDOR);
      expect(b.outsourceContactName).toBe("สมชาย ใจดี");
      expect(b.outsourceContactPhone).toBe("081-111-2222");
      expect(b.adHocVehicleId, "each occurrence sits on a row").not.toBeNull();
      // Asserted the way the BOARD asks the question — "give me the rows for this
      // day", keyed on local midnight — not by comparing the stored column.
      //
      // `AdHocVehicle.date` is `@db.Date`, and Prisma truncates a local-midnight
      // timestamp to its UTC date, so in Asia/Bangkok the stored value is the day
      // BEFORE the one intended (measured: writing 2027-09-14T00:00+07 stores
      // 2027-09-13). Reads shift identically, so every screen agrees with every
      // write and the app is correct end to end — but the raw column is off by a
      // day, and a test that compared it would fail for a reason that has nothing
      // to do with this feature. That shift is a known separate defect.
      const forThatDay = await prisma.adHocVehicle.findFirst({
        where: { date: startOfDay(b.startAt), label: VENDOR },
        select: { id: true },
      });
      expect(forThatDay?.id, "the row is the one that day's board renders").toBe(b.adHocVehicleId);
    }

    const rowIds = new Set(
      (
        await prisma.booking.findMany({
          where: { id: { in: [first, second, third] } },
          select: { adHocVehicleId: true },
        })
      ).map((b) => b.adHocVehicleId),
    );
    expect(rowIds.size, "one row per date, not one shared row").toBe(3);
  });

  it("never displaces an occurrence that already has a faculty car", async () => {
    const { first, second, third } = await seedSeries();
    const driver = await prisma.driver.findFirstOrThrow({
      where: { isActive: true, assignedVehicle: { isNot: null } },
      include: { assignedVehicle: true },
    });
    await prisma.booking.update({
      where: { id: second },
      data: { status: "ASSIGNED", primaryDriverId: driver.id, vehicleId: driver.assignedVehicle!.id },
    });

    const row = await makeRow(DATES[0]!);
    const fd = new FormData();
    fd.set("bookingId", first);
    fd.set("rowId", row.id);
    const res = (await outsourceToRowAction(fd)) as { ok: boolean; carriedForward?: number };
    expect(res.carriedForward, "only the third occurrence is free to carry").toBe(1);

    const kept = await prisma.booking.findUniqueOrThrow({ where: { id: second } });
    expect(kept.status, "an assigned week keeps its car").toBe("ASSIGNED");
    expect(kept.primaryDriverId).toBe(driver.id);
    expect(kept.adHocVehicleId).toBeNull();
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: third } })).status).toBe("OUTSOURCED");
  });

  it("does not touch EARLIER occurrences", async () => {
    // Arranging the middle week says nothing about the week already past.
    const { first, second, third } = await seedSeries();
    const row = await makeRow(DATES[1]!);
    const fd = new FormData();
    fd.set("bookingId", second);
    fd.set("rowId", row.id);
    const res = (await outsourceToRowAction(fd)) as { carriedForward?: number };
    expect(res.carriedForward).toBe(1);

    expect((await prisma.booking.findUniqueOrThrow({ where: { id: first } })).status).toBe("APPROVED");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: third } })).status).toBe("OUTSOURCED");
  });

  it("reuses a row already hired from the same vendor on that date", async () => {
    const { first } = await seedSeries();
    const preexisting = await makeRow(DATES[1]!); // same vendor, second date, made first
    const row = await makeRow(DATES[0]!);

    const fd = new FormData();
    fd.set("bookingId", first);
    fd.set("rowId", row.id);
    await outsourceToRowAction(fd);

    const onSecondDate = await prisma.adHocVehicle.count({
      where: { date: startOfDay(new Date(`${DATES[1]}T00:00:00`)), label: VENDOR },
    });
    expect(onSecondDate, "no duplicate row added for the same vendor and day").toBe(1);
    const second = await prisma.booking.findFirstOrThrow({
      where: { purpose: { startsWith: TAG }, startAt: { gte: new Date(`${DATES[1]}T00:00:00`) },
               adHocVehicleId: { not: null } },
    });
    expect(second.adHocVehicleId).toBe(preexisting.id);
  });

  it("a non-recurring booking carries nothing", async () => {
    const requester = await prisma.user.findUniqueOrThrow({
      where: { id: REQUESTER_ID },
      select: { departmentId: true },
    });
    const solo = await prisma.booking.create({
      data: {
        requesterId: REQUESTER_ID,
        departmentId: requester.departmentId!,
        purpose: `${TAG} one-off`,
        destination: "ศาลายา",
        province: "กรุงเทพมหานคร",
        startAt: new Date(`${DATES[0]}T08:00:00`),
        endAt: new Date(`${DATES[0]}T14:00:00`),
        passengerCount: 4,
        status: "APPROVED",
        jobType: "NORMAL",
        timeBucket: "MORNING_08_12",
      },
      select: { id: true },
    });
    const row = await makeRow(DATES[0]!);
    const fd = new FormData();
    fd.set("bookingId", solo.id);
    fd.set("rowId", row.id);
    const res = (await outsourceToRowAction(fd)) as { ok: boolean; carriedForward?: number };
    expect(res.ok).toBe(true);
    expect(res.carriedForward).toBe(0);
  });

  // The retro-fit path. Everything attached BEFORE the carry-forward existed has
  // a first date on a vendor and its siblings stranded — exactly the state the
  // real 18/24/31 ส.ค. series was left in. This is how the board catches it up
  // without detaching and redoing the arrangement.
  it("catches up a series whose first date was attached before carry-forward existed", async () => {
    const { first, second, third } = await seedSeries();
    const row = await makeRow(DATES[0]!);

    // Simulate the pre-fix state: attach ONLY the first occurrence, by hand.
    await prisma.booking.update({
      where: { id: first },
      data: {
        status: "OUTSOURCED", adHocVehicleId: row.id, needsOutsourcing: true,
        outsourceVendor: VENDOR, outsourceContactName: "สมชาย ใจดี",
        outsourceContactPhone: "081-111-2222",
      },
    });
    for (const id of [second, third]) {
      expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe("APPROVED");
    }

    const fd = new FormData();
    fd.set("bookingId", first);
    const res = (await carryVendorToSeriesAction(fd)) as { ok: boolean; carriedForward?: number };
    expect(res.ok).toBe(true);
    expect(res.carriedForward).toBe(2);

    for (const id of [second, third]) {
      const b = await prisma.booking.findUniqueOrThrow({ where: { id } });
      expect(b.status).toBe("OUTSOURCED");
      expect(b.outsourceVendor).toBe(VENDOR);
      expect(b.outsourceContactPhone).toBe("081-111-2222");
      expect(b.adHocVehicleId).not.toBeNull();
    }
  });

  it("carrying again is a no-op rather than a duplicate", async () => {
    const { first } = await seedSeries();
    const row = await makeRow(DATES[0]!);
    const attachFd = new FormData();
    attachFd.set("bookingId", first);
    attachFd.set("rowId", row.id);
    await outsourceToRowAction(attachFd); // already carries both forward

    const again = new FormData();
    again.set("bookingId", first);
    const res = (await carryVendorToSeriesAction(again)) as { ok: boolean; carriedForward?: number };
    expect(res.ok, "safe to press twice").toBe(true);
    expect(res.carriedForward, "nothing left stranded").toBe(0);
    // And no extra rows appeared on the later dates.
    for (const iso of DATES.slice(1)) {
      const n = await prisma.adHocVehicle.count({
        where: { date: startOfDay(new Date(`${iso}T00:00:00`)), label: VENDOR },
      });
      expect(n).toBe(1);
    }
  });

  it("refuses a booking that is not on a vendor row", async () => {
    const { first } = await seedSeries();
    const fd = new FormData();
    fd.set("bookingId", first); // still APPROVED, no row
    expect((await carryVendorToSeriesAction(fd)).ok).toBe(false);
  });

  it("removing one date's row frees only that date", async () => {
    const { first, second } = await seedSeries();
    const row = await makeRow(DATES[0]!);
    const fd = new FormData();
    fd.set("bookingId", first);
    fd.set("rowId", row.id);
    await outsourceToRowAction(fd);

    const del = new FormData();
    del.set("id", row.id);
    expect((await removeAdHocRowAction(del)).ok).toBe(true);

    const a = await prisma.booking.findUniqueOrThrow({ where: { id: first } });
    expect(a.status, "its own date reverts").toBe("APPROVED");
    expect(a.outsourceContactPhone).toBeNull();
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: second } });
    expect(b.status, "the other dates keep their arrangement").toBe("OUTSOURCED");
    expect(b.outsourceContactPhone).toBe("081-111-2222");
  });
});
