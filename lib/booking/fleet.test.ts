import { describe, it, expect } from "vitest";
import { pairCarsToDrivers, vehicleDriverMap, driverVehicleMap } from "./fleet";

describe("pairCarsToDrivers", () => {
  it("pairs each car with a distinct driver in stable order", () => {
    const cars = [{ id: "c2" }, { id: "c1" }];
    const drivers = [{ id: "d2" }, { id: "d1" }];
    const pairs = pairCarsToDrivers(cars, drivers);
    // sorted by id: c1->d1, c2->d2
    expect(pairs).toEqual([
      { vehicleId: "c1", driverId: "d1" },
      { vehicleId: "c2", driverId: "d2" },
    ]);
  });

  it("leaves extra cars unpaired when drivers run out", () => {
    const pairs = pairCarsToDrivers([{ id: "c1" }, { id: "c2" }], [{ id: "d1" }]);
    expect(pairs).toEqual([{ vehicleId: "c1", driverId: "d1" }]);
  });
});

describe("vehicleDriverMap", () => {
  it("maps vehicleId -> assignedDriverId, skipping unpaired", () => {
    const m = vehicleDriverMap([
      { id: "c1", assignedDriverId: "d1" },
      { id: "c2", assignedDriverId: null },
    ]);
    expect(m.get("c1")).toBe("d1");
    expect(m.has("c2")).toBe(false);
  });
});

describe("driverVehicleMap", () => {
  it("maps assignedDriverId -> vehicleId, skipping unpaired", () => {
    const m = driverVehicleMap([
      { id: "c1", assignedDriverId: "d1" },
      { id: "c2", assignedDriverId: null },
    ]);
    expect(m.get("d1")).toBe("c1");
    expect(m.size).toBe(1);
  });
});
