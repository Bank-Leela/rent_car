import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, format, startOfDay } from "date-fns";
import type { Prisma } from "@prisma/client";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (k: string) => k),
}));

import { prisma } from "@/lib/db";
import { BATCH_SOLVABLE_WHERE, runBatchForDay } from "@/lib/booking/batch-core";

/**
 * The cron's nightly sweep asks "which days still have batch work?" and then
 * calls runBatchForDay on each. Those two questions have to be the SAME question.
 *
 * They were not: the sweep matched any APPROVED booking with no driver, while the
 * solver additionally skips จองเร่งด่วน, SMUS, TJW and outsourced buses. A booking
 * of one of those kinds therefore kept its day on the outstanding list forever —
 * swept nightly, skipped every time, never cleared — and each one permanently
 * enlarged the nightly run.
 *
 * These tests pin the shared predicate. A booking the solver will not touch must
 * not put its day on the sweep list.
 */
const TAG = "CRON-SWEEP:";
const REQUESTER_ID = "seed-user-requester";
const DAY = addDays(startOfDay(new Date()), 40);
const DAY_STR = format(DAY, "yyyy-MM-dd");

async function booking(extra: Prisma.BookingUncheckedCreateInput extends never ? never : Record<string, unknown>) {
  const requester = await prisma.user.findUniqueOrThrow({
    where: { id: REQUESTER_ID },
    select: { departmentId: true },
  });
  const startAt = new Date(DAY);
  startAt.setHours(9, 0, 0, 0);
  const endAt = new Date(DAY);
  endAt.setHours(11, 0, 0, 0);
  const b = await prisma.booking.create({
    data: {
      requesterId: REQUESTER_ID,
      departmentId: requester.departmentId!,
      purpose: `${TAG} probe`,
      destination: "ศาลายา",
      province: "กรุงเทพมหานคร",
      startAt,
      endAt,
      passengerCount: 2,
      status: "APPROVED",
      jobType: "NORMAL",
      timeBucket: "MORNING_08_12",
      ...extra,
    } as Prisma.BookingUncheckedCreateInput,
    select: { id: true },
  });
  return b.id;
}

/** Exactly the query the cron route runs to build its day list. */
async function sweptDays(): Promise<string[]> {
  const rows = await prisma.booking.findMany({
    where: { ...BATCH_SOLVABLE_WHERE, startAt: { gte: startOfDay(new Date()) } },
    select: { startAt: true },
  });
  return [...new Set(rows.map((r) => format(r.startAt, "yyyy-MM-dd")))];
}

afterEach(async () => {
  const rows = await prisma.booking.findMany({
    where: { purpose: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = rows.map((r) => r.id);
  await prisma.auditLog.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  const left = await prisma.booking.count({ where: { purpose: { startsWith: TAG } } });
  if (left > 0) throw new Error(`cleanup failed: ${left} ${TAG} rows survive`);
});

describe("cron outstanding-day sweep", () => {
  it("includes a day whose booking the solver CAN place", async () => {
    await booking({});
    expect(await sweptDays()).toContain(DAY_STR);
  });

  // Each of these is a kind runBatchForDay filters out. Before the shared
  // predicate, every one of them pinned its day on the nightly list forever.
  const neverSolvable: [string, Record<string, unknown>][] = [
    ["จองเร่งด่วน (isEmergency)", { isEmergency: true }],
    ["SMUS external charter", { jobType: "SMUS", externalBusCount: 2, externalVanCount: 1 }],
    ["TJW (own solver)", { jobType: "TJW", outOfProvince: true }],
    ["outsourced bus", { preferredVehicleType: "BUS_OUTSOURCED" }],
  ];

  for (const [name, extra] of neverSolvable) {
    it(`does NOT sweep a day held only by ${name}`, async () => {
      await booking(extra);
      expect(
        await sweptDays(),
        `${name} can never be placed by the batch, so it must not schedule nightly work`,
      ).not.toContain(DAY_STR);
    });
  }

  it("still sweeps a day that ALSO has solvable work", async () => {
    // A manual-only booking must not suppress the day when there is real work.
    await booking({ isEmergency: true });
    await booking({});
    expect(await sweptDays()).toContain(DAY_STR);
  });

  // Guards against the tests above going vacuous. If someone widens
  // BATCH_SOLVABLE_WHERE back out, this proves the old predicate really did match
  // these bookings — so the assertions above are testing a real difference and not
  // a day that was never swept for some unrelated reason.
  it("the OLD broad predicate did match them — the tests above are not vacuous", async () => {
    await booking({ isEmergency: true });
    const old = await prisma.booking.findMany({
      where: {
        status: "APPROVED",
        primaryDriverId: null,
        startAt: { gte: startOfDay(new Date()) },
      },
      select: { startAt: true },
    });
    const oldDays = [...new Set(old.map((r) => format(r.startAt, "yyyy-MM-dd")))];
    expect(oldDays, "the pre-fix sweep swept this day").toContain(DAY_STR);
    expect(await sweptDays(), "the fixed sweep does not").not.toContain(DAY_STR);
  });

  // The reason the old behaviour was a LOOP and not merely a wasted query: the
  // solver cannot clear these bookings, so the condition that put the day on the
  // list is still true after the run. Re-solving it nightly changes nothing,
  // forever.
  it("running the batch on such a day changes nothing, which is why it never converged", async () => {
    const id = await booking({ isEmergency: true });
    const before = await prisma.booking.findUniqueOrThrow({ where: { id } });

    const res = await runBatchForDay(DAY_STR, "seed-user-admin");
    expect(res.ok, "the run itself succeeds — it just has nothing to do here").toBe(true);
    expect(res.stats?.pendingCount, "the solver sees zero placeable bookings").toBe(0);

    const after = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe(before.status);
    expect(after.primaryDriverId).toBeNull();
    expect(after.overflowReason).toBe(before.overflowReason);
  });

  it("ignores a booking that already has a driver", async () => {
    const driver = await prisma.driver.findFirstOrThrow({
      where: { isActive: true },
      select: { id: true },
    });
    await booking({ primaryDriverId: driver.id, status: "ASSIGNED" });
    expect(await sweptDays()).not.toContain(DAY_STR);
  });
});
