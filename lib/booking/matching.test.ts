import { describe, expect, it } from "vitest";
import type { JobType } from "@prisma/client";
import { match, LONG_TRIP_KM } from "./matching";
import { buildDriverMatrix, type DriverInput, type DriverAvailabilityInput } from "./driver-capacity";

const drivers: DriverInput[] = [
  { driverId: "A", joinedAt: new Date("2026-01-01"), lastAssignedAt: null },
  { driverId: "B", joinedAt: new Date("2026-01-01"), lastAssignedAt: null },
  { driverId: "C", joinedAt: new Date("2026-01-01"), lastAssignedAt: null },
];

// car=driver: each driver drives a fixed car.
const driverCar = new Map<string, string>([
  ["A", "vA"],
  ["B", "vB"],
  ["C", "vC"],
]);

const rankInputs = drivers.map((d) => ({
  driverId: d.driverId,
  earningsScore: 0,
  tripsThisMonth: 0,
  lastAssignedAt: d.lastAssignedAt,
}));

function availabilityForAll(): DriverAvailabilityInput[] {
  return drivers.map((d) => ({ driverId: d.driverId, existing: [] }));
}

const morningTrip = {
  startAt: new Date("2026-06-10T09:00:00"),
  endAt: new Date("2026-06-10T11:00:00"),
};

describe("match", () => {
  it("assigns the primary driver and that driver's car for a short trip", () => {
    const r = match({
      jobType: "NORMAL",
      timeBucket: "MORNING_08_12",
      newTrip: morningTrip,
      estimatedDistance: 100,
      driverCar,
      driverMatrix: buildDriverMatrix(drivers, []),
      driverAvailability: availabilityForAll(),
      driverRankInputs: rankInputs,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.primaryDriverId).toBe("A");
      expect(r.result.vehicleId).toBe("vA"); // A's car
      expect(r.result.secondaryDriverId).toBeNull();
    }
  });

  it("returns NO_SLOT when the picked driver has no assigned car", () => {
    const r = match({
      jobType: "NORMAL",
      timeBucket: "MORNING_08_12",
      newTrip: morningTrip,
      estimatedDistance: null,
      driverCar: new Map(), // nobody paired
      driverMatrix: buildDriverMatrix(drivers, []),
      driverAvailability: availabilityForAll(),
      driverRankInputs: rankInputs,
    });
    expect(r).toEqual({ ok: false, error: "NO_SLOT" });
  });

  it("CR-06: returns NO_PRIMARY_DRIVER when 1/day cap blocks everyone", () => {
    const existingMorning = {
      startAt: new Date("2026-06-10T08:30:00"),
      endAt: new Date("2026-06-10T15:00:00"),
    };
    const r = match({
      jobType: "NORMAL",
      timeBucket: "MORNING_08_12",
      newTrip: morningTrip,
      estimatedDistance: null,
      driverCar,
      driverMatrix: buildDriverMatrix(drivers, []),
      driverAvailability: drivers.map((d) => ({
        driverId: d.driverId,
        existing: [existingMorning],
      })),
      driverRankInputs: rankInputs,
    });
    expect(r).toEqual({ ok: false, error: "NO_PRIMARY_DRIVER" });
  });

  it("CR-06: morning + afternoon with 2h gap allowed for the same driver", () => {
    const afternoonTrip = {
      startAt: new Date("2026-06-10T13:00:00"),
      endAt: new Date("2026-06-10T15:00:00"),
    };
    // A already has earnings (morning trip), C has none → C wins fairness.
    // B is blocked by an overlapping all-day trip.
    const r = match({
      jobType: "NORMAL",
      timeBucket: "AFTERNOON_12_16",
      newTrip: afternoonTrip,
      estimatedDistance: 50,
      driverCar,
      driverMatrix: buildDriverMatrix(drivers, []),
      driverAvailability: [
        { driverId: "A", existing: [morningTrip] },
        { driverId: "B", existing: [{ startAt: new Date("2026-06-10T08:00:00"), endAt: new Date("2026-06-10T15:30:00") }] },
        { driverId: "C", existing: [] },
      ],
      driverRankInputs: [
        { driverId: "A", earningsScore: 1, tripsThisMonth: 1, lastAssignedAt: morningTrip.endAt },
        { driverId: "B", earningsScore: 0, tripsThisMonth: 0, lastAssignedAt: null },
        { driverId: "C", earningsScore: 0, tripsThisMonth: 0, lastAssignedAt: null },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.primaryDriverId).toBe("C");
      expect(r.result.vehicleId).toBe("vC");
    }
  });

  it("CR-06: a driver with only a morning trip is still eligible for afternoon", () => {
    const afternoonTrip = {
      startAt: new Date("2026-06-10T13:30:00"),
      endAt: new Date("2026-06-10T15:30:00"),
    };
    // Only A is eligible (the other two have overlapping all-day commitments).
    const r = match({
      jobType: "NORMAL",
      timeBucket: "AFTERNOON_12_16",
      newTrip: afternoonTrip,
      estimatedDistance: 50,
      driverCar,
      driverMatrix: buildDriverMatrix(drivers, []),
      driverAvailability: [
        { driverId: "A", existing: [morningTrip] },
        { driverId: "B", existing: [{ startAt: new Date("2026-06-10T13:00:00"), endAt: new Date("2026-06-10T16:00:00") }] },
        { driverId: "C", existing: [{ startAt: new Date("2026-06-10T13:00:00"), endAt: new Date("2026-06-10T16:00:00") }] },
      ],
      driverRankInputs: rankInputs,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.primaryDriverId).toBe("A");
  });

  it("assigns a secondary (co-)driver when distance exceeds 400 km", () => {
    const r = match({
      jobType: "TJW",
      timeBucket: "MORNING_08_12",
      newTrip: morningTrip,
      estimatedDistance: LONG_TRIP_KM + 1,
      driverCar,
      driverMatrix: buildDriverMatrix(drivers, []),
      driverAvailability: availabilityForAll(),
      driverRankInputs: rankInputs,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.primaryDriverId).toBe("A");
      expect(r.result.vehicleId).toBe("vA"); // one car; the co-driver rides along
      expect(r.result.secondaryDriverId).toBe("B");
    }
  });

  it("returns NO_SECONDARY_DRIVER for >400 km when only one driver is free", () => {
    const r = match({
      jobType: "TJW",
      timeBucket: "MORNING_08_12",
      newTrip: morningTrip,
      estimatedDistance: LONG_TRIP_KM + 100,
      driverCar,
      driverMatrix: buildDriverMatrix(drivers, []),
      driverAvailability: [
        { driverId: "A", existing: [] },
        { driverId: "B", existing: [{ startAt: new Date("2026-06-10T08:00:00"), endAt: new Date("2026-06-10T18:00:00") }] },
        { driverId: "C", existing: [{ startAt: new Date("2026-06-10T08:00:00"), endAt: new Date("2026-06-10T18:00:00") }] },
      ],
      driverRankInputs: rankInputs,
    });
    expect(r).toEqual({ ok: false, error: "NO_SECONDARY_DRIVER" });
  });

  // The on-call (WERN duty) driver is reserved for the whole day, exactly like
  // the batch solver's dutyDriverId.
  const wernWindow = {
    startAt: new Date("2026-06-10T08:00:00"),
    endAt: new Date("2026-06-10T16:00:00"),
  };
  const preDawnTrip = {
    startAt: new Date("2026-06-10T04:00:00"),
    endAt: new Date("2026-06-10T05:00:00"),
  };

  it("reserves the on-call driver all day: picks another driver for a pre-dawn trip", () => {
    const r = match({
      jobType: "OT",
      timeBucket: "MORNING_08_12",
      newTrip: preDawnTrip,
      estimatedDistance: 50,
      driverCar,
      driverMatrix: buildDriverMatrix(drivers, []),
      driverAvailability: [
        { driverId: "A", existing: [wernWindow] },
        { driverId: "B", existing: [] },
        { driverId: "C", existing: [] },
      ],
      driverRankInputs: rankInputs,
      onCallDriverId: "A",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.primaryDriverId).toBe("B");
  });

  it("reserves the on-call driver all day: NO_PRIMARY_DRIVER when they are the only one free", () => {
    const blockAllDay = {
      startAt: new Date("2026-06-10T00:00:00"),
      endAt: new Date("2026-06-10T23:59:00"),
    };
    const r = match({
      jobType: "OT",
      timeBucket: "MORNING_08_12",
      newTrip: preDawnTrip,
      estimatedDistance: 50,
      driverCar,
      driverMatrix: buildDriverMatrix(drivers, []),
      driverAvailability: [
        { driverId: "A", existing: [wernWindow] },
        { driverId: "B", existing: [blockAllDay] },
        { driverId: "C", existing: [blockAllDay] },
      ],
      driverRankInputs: rankInputs,
      onCallDriverId: "A",
    });
    expect(r).toEqual({ ok: false, error: "NO_PRIMARY_DRIVER" });
  });

  it("does not require a secondary at exactly 400 km", () => {
    const r = match({
      jobType: "TJW",
      timeBucket: "MORNING_08_12",
      newTrip: morningTrip,
      estimatedDistance: LONG_TRIP_KM,
      driverCar,
      driverMatrix: buildDriverMatrix(drivers, []),
      driverAvailability: availabilityForAll(),
      driverRankInputs: rankInputs,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.secondaryDriverId).toBeNull();
  });
});

describe("match — OT cap exemption flows through the matcher (job-type-aware chaining)", () => {
  const T = (hm: string) => new Date(`2026-06-10T${hm}:00`);
  const fullNormalDay = [
    { startAt: T("08:00"), endAt: T("11:00"), jobType: "NORMAL" as JobType },
    { startAt: T("13:00"), endAt: T("16:00"), jobType: "NORMAL" as JobType },
  ];

  it("an OT is assignable to a driver who already has a full 2-NORMAL day (cap-exempt)", () => {
    const eveningOverlap = [{ startAt: T("18:00"), endAt: T("20:00") }];
    const r = match({
      jobType: "OT",
      timeBucket: "AFTER_16",
      newTrip: { startAt: T("18:00"), endAt: T("20:00"), jobType: "OT" },
      estimatedDistance: 50,
      driverCar,
      driverMatrix: buildDriverMatrix(drivers, []),
      driverAvailability: [
        { driverId: "A", existing: fullNormalDay }, // full day, but OT is exempt
        { driverId: "B", existing: eveningOverlap }, // busy at the OT time
        { driverId: "C", existing: eveningOverlap },
      ],
      driverRankInputs: rankInputs,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.primaryDriverId).toBe("A");
  });

  it("an existing OT does not count toward the NORMAL cap (a new afternoon NORMAL is allowed)", () => {
    const afternoonOverlap = [{ startAt: T("13:00"), endAt: T("15:00") }];
    const r = match({
      jobType: "NORMAL",
      timeBucket: "AFTERNOON_12_16",
      newTrip: { startAt: T("13:00"), endAt: T("15:00"), jobType: "NORMAL" },
      estimatedDistance: null,
      driverCar,
      driverMatrix: buildDriverMatrix(drivers, []),
      driverAvailability: [
        // A: an early OT + one morning NORMAL → still room for an afternoon NORMAL
        {
          driverId: "A",
          existing: [
            { startAt: T("05:00"), endAt: T("07:00"), jobType: "OT" },
            { startAt: T("08:00"), endAt: T("11:00"), jobType: "NORMAL" },
          ],
        },
        { driverId: "B", existing: afternoonOverlap },
        { driverId: "C", existing: afternoonOverlap },
      ],
      driverRankInputs: rankInputs,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.primaryDriverId).toBe("A");
  });
});

describe("match — WERN routes to the on-call duty driver", () => {
  const T = (hm: string) => new Date(`2026-06-10T${hm}:00`);
  const wernInput = (onCallDriverId: string | null) => ({
    jobType: "WERN" as const,
    timeBucket: "MORNING_08_12" as const,
    newTrip: { startAt: T("08:00"), endAt: T("12:00"), jobType: "WERN" as const },
    estimatedDistance: null,
    driverCar,
    driverMatrix: buildDriverMatrix(drivers, []),
    driverAvailability: availabilityForAll(),
    driverRankInputs: rankInputs,
    onCallDriverId,
  });

  it("assigns a WERN slot to the on-call driver, bypassing the fair pick", () => {
    expect(match(wernInput("A"))).toEqual({
      ok: true,
      result: { vehicleId: "vA", primaryDriverId: "A", secondaryDriverId: null },
    });
  });

  it("NO_PRIMARY_DRIVER when no on-call driver is rostered", () => {
    expect(match(wernInput(null))).toEqual({ ok: false, error: "NO_PRIMARY_DRIVER" });
  });
});
