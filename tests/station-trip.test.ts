import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, startOfDay } from "date-fns";

// Lock the shared-station trip-recording boundary: the kiosk account (DRIVER role,
// no driver profile) may start/end ANY trip; a regular driver may not record a
// trip they aren't assigned to. Seeds against the real dev DB.
const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (k: string) => k),
  getLocale: vi.fn(async () => "en"),
}));
vi.mock("@/lib/session", () => ({ getSession: getSessionMock }));
vi.mock("@/lib/email/client", () => ({ sendEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/line/client", () => ({ sendLineNotification: vi.fn(async () => {}) }));

import { prisma } from "@/lib/db";
import { startTripAction, endTripAction } from "@/lib/booking/driver-actions";
import { getStationTripDetailAction } from "@/lib/booking/station-actions";

const STATION = "seed-user-driverstation";
const REQ_ID = "seed-user-requester";
const DEPT = "seed-dept-medicine";
const MARKER = "STATION-TEST";
const DAY = startOfDay(addDays(new Date(), 150));

const createdIds: string[] = [];
let jnSeq = 0;
const jn = () => `VB-STN-${Date.now()}-${jnSeq++}`;
const at = (h: number) => { const d = new Date(DAY); d.setHours(h, 0, 0, 0); return d; };
const asUser = (id: string) => getSessionMock.mockResolvedValue({ user: { id, roles: ["DRIVER"] } });
function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
}

let driverA: { id: string; userId: string; vehicleId: string };
let driverBUserId: string;
let ghostId: string; // a DRIVER-role user with NO profile and a non-station email

beforeAll(async () => {
  const station = await prisma.user.findUnique({
    where: { id: STATION },
    select: { driverProfile: { select: { id: true } } },
  });
  if (!station) throw new Error("Seed station account missing — run `npm run db:seed`.");
  if (station.driverProfile) throw new Error("Station account unexpectedly has a driver profile.");

  const ds = await prisma.driver.findMany({
    where: { isActive: true, user: { is: { isActive: true } }, assignedVehicle: { isNot: null } },
    select: { id: true, userId: true, assignedVehicle: { select: { id: true } } },
    take: 2,
  });
  if (ds.length < 2) throw new Error("Need ≥2 car-paired drivers — run the seed.");
  driverA = { id: ds[0].id, userId: ds[0].userId, vehicleId: ds[0].assignedVehicle!.id };
  driverBUserId = ds[1].userId;

  const ghost = await prisma.user.create({
    data: { email: `ghost-${Date.now()}@test.local`, name: "Ghost Driver", roles: { create: { role: "DRIVER" } } },
  });
  ghostId = ghost.id;
});

afterAll(async () => {
  const extra = await prisma.booking.findMany({ where: { purpose: MARKER }, select: { id: true } });
  const ids = [...new Set([...createdIds, ...extra.map((r) => r.id)])];
  if (ids.length) {
    await prisma.trip.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  }
  if (ghostId) await prisma.user.deleteMany({ where: { id: ghostId } }); // cascades UserRole
  await prisma.$disconnect();
});

async function mkAssigned(h: number) {
  const b = await prisma.booking.create({
    data: {
      jobNumber: jn(), requesterId: REQ_ID, departmentId: DEPT, purpose: MARKER,
      destination: "Test", province: "กรุงเทพมหานคร", passengerCount: 1, jobType: "NORMAL",
      timeBucket: "MORNING_08_12", status: "ASSIGNED",
      startAt: at(h), endAt: at(h + 2), primaryDriverId: driverA.id, vehicleId: driverA.vehicleId,
    },
  });
  createdIds.push(b.id);
  return b;
}

describe("shared station — trip recording", () => {
  it("lets the station start AND end a trip for a booking it isn't assigned to", async () => {
    const b = await mkAssigned(9);
    asUser(STATION);

    const start = await startTripAction(fd({ bookingId: b.id, startMileage: "1000" }));
    expect(start.ok).toBe(true);

    const end = await endTripAction(fd({ bookingId: b.id, endMileage: "1080", fuelCost: "500", tollwayCost: "60" }));
    expect(end.ok).toBe(true);

    const after = await prisma.booking.findUnique({ where: { id: b.id }, include: { trip: true } });
    expect(after?.status).toBe("COMPLETED");
    expect(after?.trip?.distanceKm).toBe(80);
  });

  it("blocks a regular driver from recording a trip they aren't assigned to", async () => {
    const b = await mkAssigned(13);
    asUser(driverBUserId); // a real driver, NOT assigned to b (driverA is)

    const res = await startTripAction(fd({ bookingId: b.id, startMileage: "1000" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("notAssignedToTrip");
    expect(await prisma.trip.findUnique({ where: { bookingId: b.id } })).toBeNull();
  });

  it("does NOT treat a profile-less, non-station DRIVER as the kiosk (no escalation)", async () => {
    const b = await mkAssigned(19);
    asUser(ghostId); // DRIVER role, no profile, email NOT in the station allowlist

    const rec = await startTripAction(fd({ bookingId: b.id, startMileage: "1000" }));
    expect(rec.ok).toBe(false);
    if (!rec.ok) expect(rec.error).toBe("notAssignedToTrip");
    expect(await prisma.trip.findUnique({ where: { bookingId: b.id } })).toBeNull();

    const view = await getStationTripDetailAction(b.id);
    expect(view.ok).toBe(false);
    if (!view.ok) expect(view.error).toBe("forbidden");
  });
});

describe("getStationTripDetailAction — view gate", () => {
  it("returns detail to the station for any booking", async () => {
    const b = await mkAssigned(15);
    asUser(STATION);
    const res = await getStationTripDetailAction(b.id);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.detail.jobNumber).toBe(b.jobNumber);
      expect(res.detail.canRecord).toBe(true);
    }
  });

  it("forbids a non-assigned regular driver from viewing an ASSIGNED booking", async () => {
    const b = await mkAssigned(17);
    asUser(driverBUserId);
    const res = await getStationTripDetailAction(b.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("forbidden");
  });
});
