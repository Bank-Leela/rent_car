import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "seed-user-admin", roles: ["ADMIN"] } })),
}));

import { prisma } from "@/lib/db";
import {
  addAdHocRowAction,
  outsourceToRowAction,
  setAdHocContactAction,
  unoutsourceAction,
} from "@/lib/booking/adhoc-actions";

const REQUESTER_ID = "seed-user-requester";
const TAG = "CONTACT-TEST:";
const day = new Date("2027-05-19T00:00:00");

async function makeApproved() {
  const requester = await prisma.user.findUniqueOrThrow({
    where: { id: REQUESTER_ID },
    select: { departmentId: true },
  });
  const startAt = new Date(day);
  startAt.setHours(9, 0, 0, 0);
  const endAt = new Date(day);
  endAt.setHours(11, 0, 0, 0);
  const b = await prisma.booking.create({
    data: {
      requesterId: REQUESTER_ID,
      departmentId: requester.departmentId!,
      purpose: `${TAG} trip`,
      destination: "ศาลายา",
      province: "กรุงเทพมหานคร",
      startAt,
      endAt,
      passengerCount: 1,
      status: "APPROVED",
      jobType: "NORMAL",
      timeBucket: "MORNING_08_12",
    },
    select: { id: true },
  });
  return b.id;
}

async function rowFor(label: string, contact?: { name?: string; phone?: string }) {
  const fd = new FormData();
  fd.set("date", "2027-05-19");
  fd.set("label", label);
  if (contact?.name) fd.set("contactName", contact.name);
  if (contact?.phone) fd.set("contactPhone", contact.phone);
  expect((await addAdHocRowAction(fd)).ok).toBe(true);
  return prisma.adHocVehicle.findFirstOrThrow({ where: { date: day, label }, select: { id: true } });
}

afterAll(async () => {
  const trips = await prisma.booking.findMany({
    where: { purpose: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = trips.map((t) => t.id);
  await prisma.auditLog.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  await prisma.adHocVehicle.deleteMany({ where: { date: day } });
  const left = await prisma.booking.count({ where: { purpose: { startsWith: TAG } } });
  if (left > 0) throw new Error(`cleanup failed: ${left} ${TAG} rows left`);
});

describe("outside-vehicle contact", () => {
  it("copies the row's contact onto a trip when it is attached", async () => {
    const row = await rowFor("บริษัท ก", { name: "สมชาย", phone: "081-234-5678" });
    const id = await makeApproved();
    const fd = new FormData();
    fd.set("bookingId", id);
    fd.set("rowId", row.id);
    expect((await outsourceToRowAction(fd)).ok).toBe(true);

    const after = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("OUTSOURCED");
    expect(after.outsourceVendor).toBe("บริษัท ก");
    // The requester's page reads the booking, not the row — so the copy is what
    // makes a contact visible to them at all.
    expect(after.outsourceContactName).toBe("สมชาย");
    expect(after.outsourceContactPhone).toBe("081-234-5678");
  });

  it("fills in a contact added AFTER the trips were attached", async () => {
    // The real sequence: a row is created before the vendor names a driver, so
    // the trips are already on it when the phone number arrives. Without the
    // propagation the board would show the contact and the requester would not.
    const row = await rowFor("บริษัท ข");
    const id = await makeApproved();
    const attach = new FormData();
    attach.set("bookingId", id);
    attach.set("rowId", row.id);
    expect((await outsourceToRowAction(attach)).ok).toBe(true);

    const before = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(before.outsourceContactPhone).toBeNull();

    const setC = new FormData();
    setC.set("id", row.id);
    setC.set("contactName", "วิชัย");
    setC.set("contactPhone", "089-999-0000");
    expect((await setAdHocContactAction(setC)).ok).toBe(true);

    const after = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(after.outsourceContactName).toBe("วิชัย");
    expect(after.outsourceContactPhone).toBe("089-999-0000");
    // And the row itself keeps it, for the next trip attached to it.
    const rowAfter = await prisma.adHocVehicle.findUniqueOrThrow({ where: { id: row.id } });
    expect(rowAfter.contactPhone).toBe("089-999-0000");
  });

  it("clears the contact when a trip comes back in-house", async () => {
    // A stale contact on a faculty-car trip would name someone with no
    // involvement, so un-outsourcing drops the whole outside-vehicle record.
    const row = await rowFor("บริษัท ค", { name: "ประสิทธิ์", phone: "02-000-0000" });
    const id = await makeApproved();
    const attach = new FormData();
    attach.set("bookingId", id);
    attach.set("rowId", row.id);
    expect((await outsourceToRowAction(attach)).ok).toBe(true);

    const off = new FormData();
    off.set("bookingId", id);
    expect((await unoutsourceAction(off)).ok).toBe(true);

    const after = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("APPROVED");
    expect(after.outsourceVendor).toBeNull();
    expect(after.outsourceContactName).toBeNull();
    expect(after.outsourceContactPhone).toBeNull();
  });
});
