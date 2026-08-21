import { describe, expect, it } from "vitest";
import type { PreferredVehicleType } from "@prisma/client";
import { FLEET_TYPE_FOR_PREFERENCE, fleetTypeFor } from "@/lib/booking/vehicle-type";
import { match } from "@/lib/booking/matching";
import { recommendPlacement } from "@/lib/booking/placement-reco";

/**
 * §5b — the requested vehicle CATEGORY versus the fleet's own classification.
 *
 * PreferredVehicleType and VehicleType are different enums that share only VAN
 * and PICKUP. Comparing them raw therefore *looks* correct on two of five values
 * and silently matches nothing on SEDAN_DEAN and TRUCK_6_WHEEL. The day solver
 * translated; the single matcher and the placement reco did not, so the three
 * engines disagreed about the same booking while every comment claimed they
 * agreed. These tests pin the translation and the agreement.
 */
const at = (h: number) => new Date(2026, 8, 1, h, 0, 0, 0);

describe("fleetTypeFor", () => {
  it("maps every preference the enum can hold", () => {
    // Exhaustive over the real enum, so a new value cannot be added without a
    // decision here — the failure mode being "matches no car and nobody notices".
    for (const pref of Object.keys(FLEET_TYPE_FOR_PREFERENCE) as PreferredVehicleType[]) {
      expect(fleetTypeFor(pref), `${pref} has no mapping`).not.toBeUndefined();
    }
    expect(fleetTypeFor("SEDAN_DEAN")).toBe("SEDAN");
    expect(fleetTypeFor("TRUCK_6_WHEEL")).toBe("OTHER");
    expect(fleetTypeFor("VAN")).toBe("VAN");
    expect(fleetTypeFor("PICKUP")).toBe("PICKUP");
  });

  it("treats a bus as no constraint, not as an impossible one", () => {
    // A bus is always an outside rental. Narrowing the internal pick to zero
    // cars would turn a placeable trip into "no car available".
    expect(fleetTypeFor("BUS_OUTSOURCED")).toBeNull();
  });

  it("returns null for absent or unknown input rather than throwing", () => {
    expect(fleetTypeFor(null)).toBeNull();
    expect(fleetTypeFor(undefined)).toBeNull();
    expect(fleetTypeFor("")).toBeNull();
    expect(fleetTypeFor("NOT_A_REAL_VALUE")).toBeNull();
  });
});

describe("§5b is honoured by every engine, not just the solver", () => {
  // Two drivers, equally fair, differing only in the car they bring. `sedan` is
  // ranked SECOND, so an engine that ignores the preference picks `van` and an
  // engine that honours it picks `sedan` — the assertion cannot pass by accident.
  const drivers = [
    { id: "van", vehicleId: "v-van", vehicleType: "VAN" },
    { id: "sedan", vehicleId: "v-sedan", vehicleType: "SEDAN" },
  ];

  it("the single matcher picks the requested category", () => {
    const res = match({
      jobType: "NORMAL",
      timeBucket: "MORNING_08_12",
      newTrip: { startAt: at(9), endAt: at(11), jobType: "NORMAL" },
      estimatedDistance: null,
      needsSecondaryDriver: false,
      preferredVehicleType: "SEDAN_DEAN",
      driverCar: new Map(drivers.map((d) => [d.id, d.vehicleId])),
      vehicleTypeByDriver: new Map(drivers.map((d) => [d.id, d.vehicleType])),
      driverMatrix: [],
      driverAvailability: drivers.map((d) => ({ driverId: d.id, existing: [] })),
      driverRankInputs: drivers.map((d, i) => ({
        driverId: d.id, earningsScore: i, tripsThisMonth: 0, lastAssignedAt: null,
      })),
    } as never) as { ok: boolean; result?: { primaryDriverId: string } };

    expect(res.ok).toBe(true);
    expect(res.result?.primaryDriverId, "SEDAN_DEAN must reach the SEDAN car").toBe("sedan");
  });

  it("the placement reco recommends the requested category", () => {
    const reco = recommendPlacement({
      booking: {
        startAt: at(9), endAt: at(11), jobType: "NORMAL",
        preferredVehicleType: "SEDAN_DEAN",
      },
      needsSecondary: false,
      dutyDriverId: null,
      drivers: drivers.map((d, i) => ({
        driverId: d.id, vehicleId: d.vehicleId, vehicleType: d.vehicleType,
        registrationNumber: null, driverName: null,
        earningsScore: i, lastAssignedAt: null, trips: [],
      })),
    } as never) as { kind: string; driverId?: string };

    expect(reco.kind).toBe("fit");
    expect(reco.driverId, "SEDAN_DEAN must reach the SEDAN car").toBe("sedan");
  });

  it("still falls back to any car — the preference is never a filter", () => {
    const vanOnly = [{ id: "van", vehicleId: "v-van", vehicleType: "VAN" }];
    const reco = recommendPlacement({
      booking: {
        startAt: at(9), endAt: at(11), jobType: "NORMAL",
        preferredVehicleType: "TRUCK_6_WHEEL",
      },
      needsSecondary: false,
      dutyDriverId: null,
      drivers: vanOnly.map((d) => ({
        driverId: d.id, vehicleId: d.vehicleId, vehicleType: d.vehicleType,
        registrationNumber: null, driverName: null,
        earningsScore: 0, lastAssignedAt: null, trips: [],
      })),
    } as never) as { kind: string; driverId?: string };

    expect(reco.kind, "a wrong-shaped car beats no car").toBe("fit");
    expect(reco.driverId).toBe("van");
  });
});
