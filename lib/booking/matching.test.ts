import { describe, expect, it } from "vitest";
import { match } from "./matching";
import { buildSlotTable } from "./slot-allocation";
import { buildDriverMatrix, type DriverInput, type DriverAvailabilityInput } from "./driver-capacity";

const vehicles = [
  { vehicleId: "v1", registrationNumber: "B-1", isDutyVehicle: false },
  { vehicleId: "v2", registrationNumber: "B-2", isDutyVehicle: false },
];

const drivers: DriverInput[] = [
  { driverId: "A", joinedAt: new Date("2026-01-01"), lastAssignedAt: null },
  { driverId: "B", joinedAt: new Date("2026-01-01"), lastAssignedAt: null },
  { driverId: "C", joinedAt: new Date("2026-01-01"), lastAssignedAt: null },
];

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
  it("assigns a primary driver and a vehicle for a short trip", () => {
    const r = match({
      jobType: "NORMAL",
      timeBucket: "MORNING_08_12",
      newTrip: morningTrip,
      needsSecondaryDriver: false,
      slotTable: buildSlotTable(vehicles, []),
      driverMatrix: buildDriverMatrix(drivers, []),
      driverAvailability: availabilityForAll(),
      driverRankInputs: rankInputs,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.vehicleId).toBe("v1");
      expect(r.result.primaryDriverId).toBe("A");
      expect(r.result.secondaryDriverId).toBeNull();
    }
  });

  it("returns NO_SLOT when every vehicle is busy in that bucket", () => {
    const r = match({
      jobType: "NORMAL",
      timeBucket: "MORNING_08_12",
      newTrip: morningTrip,
      needsSecondaryDriver: false,
      slotTable: buildSlotTable(vehicles, [
        { vehicleId: "v1", timeBucket: "MORNING_08_12" },
        { vehicleId: "v2", timeBucket: "MORNING_08_12" },
      ]),
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
      needsSecondaryDriver: false,
      slotTable: buildSlotTable(vehicles, []),
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
      needsSecondaryDriver: false,
      slotTable: buildSlotTable(vehicles, []),
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
      needsSecondaryDriver: false,
      slotTable: buildSlotTable(vehicles, []),
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

  it("assigns a secondary driver when needsSecondaryDriver is true", () => {
    const r = match({
      jobType: "TJW",
      timeBucket: "MORNING_08_12",
      newTrip: morningTrip,
      needsSecondaryDriver: true,
      slotTable: buildSlotTable(vehicles, []),
      driverMatrix: buildDriverMatrix(drivers, []),
      driverAvailability: availabilityForAll(),
      driverRankInputs: rankInputs,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.primaryDriverId).toBe("A");
      expect(r.result.secondaryDriverId).toBe("B");
    }
  });

  it("returns NO_SECONDARY_DRIVER when needsSecondaryDriver is true but only one driver is free", () => {
    const r = match({
      jobType: "TJW",
      timeBucket: "MORNING_08_12",
      newTrip: morningTrip,
      needsSecondaryDriver: true,
      slotTable: buildSlotTable(vehicles, []),
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
  // the batch solver's dutyDriverId. The 08:00–16:00 WERN pseudo-trip alone
  // leaks pre-dawn trips ending ≥2h before 08:00 (they satisfy the morning-
  // chain rule), so match() must hard-exclude the on-call driver.
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
      needsSecondaryDriver: false,
      slotTable: buildSlotTable(vehicles, []),
      driverMatrix: buildDriverMatrix(drivers, []),
      driverAvailability: [
        { driverId: "A", existing: [wernWindow] }, // on-call; pre-dawn clears the WERN window
        { driverId: "B", existing: [] },
        { driverId: "C", existing: [] },
      ],
      driverRankInputs: rankInputs, // all tie → input order A,B,C; A would win without the reserve
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
      needsSecondaryDriver: false,
      slotTable: buildSlotTable(vehicles, []),
      driverMatrix: buildDriverMatrix(drivers, []),
      driverAvailability: [
        { driverId: "A", existing: [wernWindow] }, // on-call; pre-dawn would slip through
        { driverId: "B", existing: [blockAllDay] }, // blocked
        { driverId: "C", existing: [blockAllDay] }, // blocked
      ],
      driverRankInputs: rankInputs,
      onCallDriverId: "A",
    });
    expect(r).toEqual({ ok: false, error: "NO_PRIMARY_DRIVER" });
  });

  it("does not assign a secondary when needsSecondaryDriver is false", () => {
    const r = match({
      jobType: "TJW",
      timeBucket: "MORNING_08_12",
      newTrip: morningTrip,
      needsSecondaryDriver: false,
      slotTable: buildSlotTable(vehicles, []),
      driverMatrix: buildDriverMatrix(drivers, []),
      driverAvailability: availabilityForAll(),
      driverRankInputs: rankInputs,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.secondaryDriverId).toBeNull();
  });
});
